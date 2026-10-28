import { db } from './db';
import { SettingKey } from './defaults';
import { rawRequest } from './http';
import { tmdbLanguage } from '../i18n';
import type { TmdbCast, TmdbDetail } from '../types/models';

const API_BASE = 'https://api.themoviedb.org/3';

export interface TmdbSearchItem {
  id: number;
  media_type: 'movie' | 'tv';
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
}

export function tmdbConfigured(): boolean {
  return Boolean(String(db.settings[SettingKey.tmdbKey] ?? '').trim());
}

function apiKey(): string {
  return String(db.settings[SettingKey.tmdbKey] ?? '').trim();
}

async function tmdbGet<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error('TMDB API key is not configured');
  const result = await rawRequest(`${API_BASE}${path}`, {
    query: { api_key: key, language: tmdbLanguage(), ...query },
    timeoutMs: 30_000,
  });
  return JSON.parse(result.body) as T;
}

export async function tmdbSearchMulti(
  keyword: string,
  page = 1,
): Promise<TmdbSearchItem[]> {
  interface SearchResponse {
    page: number;
    results: (TmdbSearchItem & { media_type?: string })[];
  }
  const data = await tmdbGet<SearchResponse>('/search/multi', {
    query: keyword,
    page: String(page),
    include_adult: 'false',
  });
  return (data.results ?? []).filter(
    (item): item is TmdbSearchItem =>
      item.media_type === 'movie' || item.media_type === 'tv',
  );
}

export async function tmdbDetail(id: number, mediaType: string): Promise<TmdbDetail> {
  interface ApiDetail {
    id: number;
    title?: string;
    name?: string;
    original_title?: string;
    original_name?: string;
    poster_path?: string;
    profile_path?: string;
    backdrop_path?: string;
    genres?: { name: string }[];
    spoken_languages?: { name: string }[];
    images?: { backdrops?: { file_path?: string }[] };
    overview?: string;
    status?: string;
    credits?: {
      cast?: {
        id: number;
        name: string;
        profile_path?: string;
        character?: string;
      }[];
    };
    release_date?: string;
    first_air_date?: string;
    runtime?: number;
    episode_run_time?: number[];
  }
  const kind = mediaType === 'movie' ? 'movie' : 'tv';
  const data = await tmdbGet<ApiDetail>(`/${kind}/${id}`, {
    append_to_response: 'credits,images',
  });
  const casts: TmdbCast[] = (data.credits?.cast ?? []).map((cast) => ({
    id: cast.id,
    name: cast.name,
    profilePath: cast.profile_path,
    character: cast.character ?? '',
  }));
  return {
    id: data.id,
    mediaType: kind,
    title: data.title ?? data.name ?? '',
    cover: data.poster_path ?? data.profile_path ?? '',
    backdrop: data.backdrop_path,
    genres: (data.genres ?? []).map((genre) => genre.name),
    languages: (data.spoken_languages ?? []).map((language) => language.name),
    images: (data.images?.backdrops ?? [])
      .map((image) => image.file_path ?? '')
      .filter(Boolean),
    overview: data.overview,
    status: data.status ?? '',
    casts,
    releaseDate: data.release_date ?? data.first_air_date ?? '',
    runtime: data.runtime ?? data.episode_run_time?.[0] ?? 0,
    originalTitle: data.original_title ?? data.original_name ?? '',
  };
}

export async function tmdbDetailBySearch(
  keyword: string,
  page = 1,
): Promise<TmdbDetail | null> {
  if (!keyword.trim()) return null;
  const results = await tmdbSearchMulti(keyword, page);
  if (results.length === 0) return null;
  const first = results[0];
  return tmdbDetail(first.id, first.media_type);
}

export function tmdbTitle(item: TmdbSearchItem): string {
  return item.title ?? item.name ?? '';
}

export function tmdbYear(item: TmdbSearchItem): string {
  return (item.release_date ?? item.first_air_date ?? '').slice(0, 4);
}
