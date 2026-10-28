export type ExtensionType = 'bangumi' | 'manga' | 'fikushon';
export type ExtensionWatchBangumiType = 'hls' | 'mp4' | 'torrent';
export type ExtensionSettingType = 'input' | 'radio' | 'toggle';
export type MangaReadMode = 'standard' | 'rightToLeft' | 'webTonn';

export interface ExtensionMeta {
  package: string;
  name: string;
  version: string;
  author: string;
  lang: string;
  license: string;
  type: ExtensionType;
  webSite: string;
  nsfw: boolean;
  icon?: string;
  url?: string;
  description?: string;
}

export interface RepoExtension {
  package: string;
  name: string;
  version: string;
  author?: string;
  lang?: string;
  license?: string;
  type: ExtensionType;
  webSite?: string;
  nsfw?: string | boolean;
  icon?: string;
  url?: string;
  description?: string;
}

export interface ExtensionFilter {
  title: string;
  min: number;
  max: number;
  default: string;
  options: Record<string, string>;
}

export interface ExtensionListItem {
  title: string;
  url: string;
  cover?: string;
  update?: string;
  headers?: Record<string, string>;
}

export interface ExtensionEpisode {
  name: string;
  url: string;
}

export interface ExtensionEpisodeGroup {
  title: string;
  urls: ExtensionEpisode[];
}

export interface ExtensionDetail {
  title: string;
  cover?: string;
  desc?: string;
  episodes?: ExtensionEpisodeGroup[];
  headers?: Record<string, string>;
}

export interface BangumiSubtitle {
  title: string;
  url: string;
  language?: string;
}

export interface ExtensionBangumiWatch {
  type: ExtensionWatchBangumiType;
  url: string;
  subtitles?: BangumiSubtitle[];
  headers?: Record<string, string>;
  audioTrack?: string;
}

export interface ExtensionMangaWatch {
  urls: string[];
  headers?: Record<string, string>;
}

export interface ExtensionFikushonWatch {
  content: string[];
  title: string;
  subtitle?: string;
}

export interface Favorite {
  id: number;
  package: string;
  url: string;
  type: ExtensionType;
  title: string;
  cover?: string;
  date: string;
}

export interface History {
  id: number;
  package: string;
  url: string;
  cover?: string;
  type: ExtensionType;
  episodeGroupId: number;
  episodeId: number;
  title: string;
  episodeTitle: string;
  progress: string;
  totalProgress: string;
  date: string;
}

export interface ExtensionSetting {
  id: number;
  package: string;
  title: string;
  key: string;
  value?: string;
  defaultValue: string;
  type: ExtensionSettingType;
  description?: string;
  options?: string;
}

export interface MangaSetting {
  id: number;
  url: string;
  readMode: MangaReadMode;
}

export interface MiruDetailCache {
  id: number;
  package: string;
  url: string;
  data: string;
  tmdbID?: number;
  updateTime: string;
  aniListID?: string;
}

export interface TmdbRecord {
  id: number;
  tmdbID: number;
  data: string;
  mediaType: string;
}

export interface TmdbCast {
  id: number;
  name: string;
  profilePath?: string;
  character: string;
}

export interface TmdbDetail {
  id: number;
  mediaType: string;
  title: string;
  cover: string;
  backdrop?: string;
  genres: string[];
  languages: string[];
  images: string[];
  overview?: string;
  status: string;
  casts: TmdbCast[];
  releaseDate: string;
  runtime: number;
  originalTitle: string;
}

export type AnilistType = 'anime' | 'manga';
export type AnilistListStatus =
  | 'CURRENT'
  | 'COMPLETED'
  | 'PLANNING'
  | 'PAUSED'
  | 'DROPPED'
  | 'REPEATING';

export interface AnilistMedia {
  id: number;
  type?: string;
  status?: string;
  chapters?: number | null;
  episodes?: number | null;
  meanScore?: number;
  isFavourite?: boolean;
  coverImage?: { large?: string };
  title?: {
    romaji?: string;
    english?: string;
    native?: string;
    userPreferred?: string;
  };
  bannerImage?: string;
  seasonYear?: number;
  isAdult?: boolean;
  description?: string;
  mediaListEntry?: AnilistEntry | null;
}

export interface AnilistEntry {
  id: number;
  mediaId: number;
  status: string;
  score: number;
  advancedScores?: Record<string, number>;
  progress: number;
  progressVolumes?: number;
  repeat?: number;
  priority?: number;
  private?: boolean;
  hiddenFromStatusLists?: boolean;
  customLists?: Record<string, boolean>;
  notes?: string;
  updatedAt?: number;
  startedAt?: { year?: number | null; month?: number | null; day?: number | null };
  completedAt?: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  };
  user?: { id: number; name: string };
}

export interface AnilistCollectionEntry {
  status: string;
  progress: number;
  score: number;
  media: AnilistMedia;
}

export type AnilistCollection = Record<string, AnilistCollectionEntry[]>;

export interface BtStatus {
  running: boolean;
  version: string;
  installed: boolean;
}

export interface DlnaDevice {
  id: string;
  name: string;
  model: string;
  location: string;
  controlUrl: string;
  serviceType: string;
}

export interface LogEntry {
  id: number;
  time: number;
  level: 'info' | 'error';
  package: string;
  name: string;
  message: string;
}

export interface NetworkLog {
  id: number;
  time: number;
  package: string;
  name: string;
  url: string;
  method: string;
  requestHeaders?: Record<string, unknown>;
  requestBody?: unknown;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  statusCode?: number;
}
