import { db, persist } from './db';
import { SettingKey } from './defaults';
import { rawRequest } from './http';
import type {
  AnilistCollection,
  AnilistCollectionEntry,
  AnilistListStatus,
  AnilistMedia,
  AnilistType,
} from '../types/models';

const API_URL = 'https://graphql.anilist.co';
export const ANILIST_OAUTH_URL =
  'https://anilist.co/api/v2/oauth/authorize?client_id=16214&response_type=token';

export function anilistToken(): string {
  return String(db.settings[SettingKey.aniListToken] ?? '');
}

export function anilistUserId(): string {
  return String(db.settings[SettingKey.aniListUserId] ?? '');
}

export function anilistLoggedIn(): boolean {
  return Boolean(anilistToken());
}

export function saveAnilistToken(token: string): void {
  db.settings[SettingKey.aniListToken] = token;
  if (!token) db.settings[SettingKey.aniListUserId] = '';
  persist();
}

export function extractAnilistToken(url: string): string | null {
  const match = url.match(/[?&#]access_token=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message?: string; status?: number }[];
}

async function graphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = anilistToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const result = await rawRequest(API_URL, {
    method: 'POST',
    headers,
    data: { query, variables },
    timeoutMs: 30_000,
  });
  let parsed: GraphQLResponse<T>;
  try {
    parsed = JSON.parse(result.body) as GraphQLResponse<T>;
  } catch {
    throw new Error(`AniList returned invalid JSON (HTTP ${result.status})`);
  }
  if (parsed.errors?.length) {
    throw new Error(parsed.errors.map((error) => error.message ?? 'Unknown error').join('; '));
  }
  if (!parsed.data) {
    throw new Error(`AniList request failed (HTTP ${result.status})`);
  }
  return parsed.data;
}

function mediaType(type: AnilistType): 'ANIME' | 'MANGA' {
  return type === 'anime' ? 'ANIME' : 'MANGA';
}

export interface AnilistUserData {
  name: string;
  id: number;
  avatar: string;
  animeEpisodesWatched: number;
  mangaChaptersRead: number;
}

export async function getAnilistUser(): Promise<AnilistUserData> {
  const data = await graphql<{
    Viewer: {
      name: string;
      id: number;
      avatar?: { medium?: string };
      statistics?: {
        anime?: { episodesWatched?: number };
        manga?: { chaptersRead?: number };
      };
    };
  }>(
    `query {
      Viewer {
        name
        id
        avatar { medium }
        statistics { anime { episodesWatched } manga { chaptersRead } }
      }
    }`,
  );
  const viewer = data.Viewer;
  db.settings[SettingKey.aniListUserId] = String(viewer.id);
  persist();
  return {
    name: viewer.name,
    id: viewer.id,
    avatar: viewer.avatar?.medium ?? '',
    animeEpisodesWatched: viewer.statistics?.anime?.episodesWatched ?? 0,
    mangaChaptersRead: viewer.statistics?.manga?.chaptersRead ?? 0,
  };
}

const COLLECTION_QUERY = `query ($userId: Int, $type: MediaType) {
  MediaListCollection(userId: $userId, type: $type) {
    lists {
      status
      entries {
        status
        progress
        score
        media {
          id
          status
          chapters
          episodes
          meanScore
          isFavourite
          coverImage { large }
          title { userPreferred romaji english native }
        }
      }
    }
  }
}`;

export async function getAnilistCollection(type: AnilistType): Promise<AnilistCollection> {
  const userId = Number(anilistUserId());
  if (!userId) throw new Error('AniList user is not logged in');
  const data = await graphql<{
    MediaListCollection?: {
      lists?: { status: string; entries?: AnilistCollectionEntry[] }[];
    };
  }>(COLLECTION_QUERY, { userId, type: mediaType(type) });
  const collection: AnilistCollection = {};
  for (const list of data.MediaListCollection?.lists ?? []) {
    const entries = list.entries ?? [];
    collection[list.status] = [...(collection[list.status] ?? []), ...entries];
  }
  return collection;
}

const MEDIA_SEARCH_QUERY = `query ($search: String, $type: MediaType, $page: Int) {
  Page(page: $page) {
    media(search: $search, type: $type) {
      id
      type
      seasonYear
      isAdult
      description
      status
      coverImage { large }
      title { romaji english native userPreferred }
    }
  }
}`;

export interface AnilistMediaSearchResult {
  id: number;
  type?: string;
  seasonYear?: number;
  isAdult?: boolean;
  description?: string;
  status?: string;
  coverImage?: { large?: string };
  title?: { romaji?: string; english?: string; native?: string; userPreferred?: string };
}

export async function searchAnilistMedia(
  search: string,
  type: AnilistType,
  page = 1,
): Promise<AnilistMediaSearchResult[]> {
  const data = await graphql<{ Page?: { media?: AnilistMediaSearchResult[] } }>(
    MEDIA_SEARCH_QUERY,
    { search, type: mediaType(type), page },
  );
  return data.Page?.media ?? [];
}

export interface SaveMediaListInput {
  status: AnilistListStatus;
  mediaId?: number;
  id?: number;
  progress?: number;
  score?: number;
  startDate?: { year: number; month: number; day: number };
  endDate?: { year: number; month: number; day: number };
  isPrivate?: boolean;
}

export async function saveAnilistEntry(input: SaveMediaListInput): Promise<string> {
  if (input.mediaId === undefined && input.id === undefined) {
    throw new Error('AniList entry id is required');
  }
  const declarations = ['$status: MediaListStatus'];
  const args = ['status: $status'];
  const variables: Record<string, unknown> = { status: input.status };
  if (input.id !== undefined) {
    declarations.push('$id: Int');
    args.unshift('id: $id');
    variables.id = input.id;
  } else {
    declarations.push('$mediaId: Int');
    args.unshift('mediaId: $mediaId');
    variables.mediaId = input.mediaId;
  }
  if (input.score !== undefined) {
    declarations.push('$score: Float');
    args.push('score: $score');
    variables.score = input.score;
  }
  if (input.progress !== undefined) {
    declarations.push('$progress: Int');
    args.push('progress: $progress');
    variables.progress = input.progress;
  }
  if (input.startDate) {
    declarations.push('$startedAt: FuzzyDateInput');
    args.push('startedAt: $startedAt');
    variables.startedAt = input.startDate;
  }
  if (input.endDate) {
    declarations.push('$completedAt: FuzzyDateInput');
    args.push('completedAt: $completedAt');
    variables.completedAt = input.endDate;
  }
  if (input.isPrivate !== undefined) {
    declarations.push('$private: Boolean');
    args.push('private: $private');
    variables.private = input.isPrivate;
  }
  const query = `mutation (${declarations.join(', ')}) {
    SaveMediaListEntry(${args.join(', ')}) { id }
  }`;
  const data = await graphql<{ SaveMediaListEntry?: { id: number } }>(query, variables);
  const id = data.SaveMediaListEntry?.id;
  if (id === undefined) throw new Error('AniList did not return an entry id');
  return String(id);
}

export async function deleteAnilistEntry(id: string | number): Promise<boolean> {
  const data = await graphql<{ DeleteMediaListEntry?: { deleted?: boolean } }>(
    `mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`,
    { id: Number(id) },
  );
  return data.DeleteMediaListEntry?.deleted === true;
}

export async function getAnilistMedia(
  id: string | number,
): Promise<AnilistMedia & { volumes?: number | null }> {
  const data = await graphql<{ Media?: AnilistMedia & { volumes?: number | null } }>(
    `query ($id: Int) {
      Media(id: $id) {
        id
        title { userPreferred romaji english native }
        coverImage { large }
        bannerImage
        type
        status
        episodes
        chapters
        volumes
        isFavourite
        mediaListEntry {
          id
          mediaId
          status
          score
          advancedScores
          progress
          progressVolumes
          repeat
          priority
          private
          hiddenFromStatusLists
          customLists
          notes
          updatedAt
          startedAt { year month day }
          completedAt { year month day }
          user { id name }
        }
      }
    }`,
    { id: Number(id) },
  );
  if (!data.Media) throw new Error('AniList media not found');
  return data.Media;
}

/** Progress auto-tracking, called when a watch session closes. */
export async function autoTrackProgress(
  mediaId: string,
  progress: number,
): Promise<void> {
  if (!anilistToken() || !mediaId) return;
  await saveAnilistEntry({
    status: 'CURRENT',
    mediaId: Number(mediaId),
    progress,
  });
}
