import { computed } from 'vue';
import { defineStore } from 'pinia';
import { db, nextId, persist } from '../lib/db';
import type {
  ExtensionDetail,
  ExtensionType,
  Favorite,
  History,
  MangaReadMode,
  MiruDetailCache,
  TmdbDetail,
  TmdbRecord,
} from '../types/models';

export interface FavoriteInput {
  package: string;
  url: string;
  type: ExtensionType;
  title: string;
  cover?: string;
}

export type HistoryInput = Omit<History, 'id' | 'date'>;

function now(): string {
  return new Date().toISOString();
}

function byDateDesc<T extends { date: string; id: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
}

export const useLibraryStore = defineStore('library', () => {
  const favorites = computed(() => byDateDesc(db.favorites));
  const history = computed(() => byDateDesc(db.history));

  function favoritesByType(type?: ExtensionType): Favorite[] {
    return type ? favorites.value.filter((item) => item.type === type) : favorites.value;
  }

  function historyByType(type?: ExtensionType): History[] {
    return type ? history.value.filter((item) => item.type === type) : history.value;
  }

  function isFavorite(packageName: string, url: string): boolean {
    return db.favorites.some((item) => item.package === packageName && item.url === url);
  }

  function findFavorite(packageName: string, url: string): Favorite | undefined {
    return db.favorites.find((item) => item.package === packageName && item.url === url);
  }

  function addFavorite(input: FavoriteInput): Favorite {
    const existing = findFavorite(input.package, input.url);
    if (existing) return existing;
    const favorite: Favorite = {
      id: nextId(),
      package: input.package,
      url: input.url,
      type: input.type,
      title: input.title,
      cover: input.cover,
      date: now(),
    };
    db.favorites.push(favorite);
    persist();
    return favorite;
  }

  function removeFavorite(packageName: string, url: string): void {
    const index = db.favorites.findIndex(
      (item) => item.package === packageName && item.url === url,
    );
    if (index >= 0) {
      db.favorites.splice(index, 1);
      persist();
    }
  }

  function toggleFavorite(input: FavoriteInput): boolean {
    if (isFavorite(input.package, input.url)) {
      removeFavorite(input.package, input.url);
      return false;
    }
    addFavorite(input);
    return true;
  }

  function deleteFavorite(id: number): void {
    const index = db.favorites.findIndex((item) => item.id === id);
    if (index >= 0) {
      db.favorites.splice(index, 1);
      persist();
    }
  }

  function clearFavorites(): void {
    db.favorites.splice(0, db.favorites.length);
    persist();
  }

  function findHistory(packageName: string, url: string): History | undefined {
    return db.history.find((item) => item.package === packageName && item.url === url);
  }

  function putHistory(input: HistoryInput): History {
    const existing = findHistory(input.package, input.url);
    if (existing) {
      Object.assign(existing, input, { date: now() });
      persist();
      return existing;
    }
    const entry: History = { ...input, id: nextId(), date: now() };
    db.history.push(entry);
    persist();
    return entry;
  }

  function deleteHistory(packageName: string, url: string): void {
    const index = db.history.findIndex(
      (item) => item.package === packageName && item.url === url,
    );
    if (index >= 0) {
      db.history.splice(index, 1);
      persist();
    }
  }

  function deleteHistoryById(id: number): void {
    const index = db.history.findIndex((item) => item.id === id);
    if (index >= 0) {
      db.history.splice(index, 1);
      persist();
    }
  }

  function clearHistory(): void {
    db.history.splice(0, db.history.length);
    persist();
  }

  function getCachedDetail(packageName: string, url: string): ExtensionDetail | null {
    const record = db.miruDetails.find(
      (item) => item.package === packageName && item.url === url,
    );
    if (!record) return null;
    try {
      return JSON.parse(record.data) as ExtensionDetail;
    } catch {
      return null;
    }
  }

  function getDetailRecord(packageName: string, url: string): MiruDetailCache | undefined {
    return db.miruDetails.find((item) => item.package === packageName && item.url === url);
  }

  function putCachedDetail(
    packageName: string,
    url: string,
    detail: ExtensionDetail,
    extra: { tmdbID?: number; aniListID?: string | number } = {},
  ): MiruDetailCache {
    const existing = getDetailRecord(packageName, url);
    if (existing) {
      existing.data = JSON.stringify(detail);
      existing.tmdbID = extra.tmdbID ?? existing.tmdbID;
      existing.aniListID =
        extra.aniListID === undefined ? existing.aniListID : String(extra.aniListID);
      existing.updateTime = now();
      persist();
      return existing;
    }
    const record: MiruDetailCache = {
      id: nextId(),
      package: packageName,
      url,
      data: JSON.stringify(detail),
      tmdbID: extra.tmdbID,
      aniListID: extra.aniListID === undefined ? undefined : String(extra.aniListID),
      updateTime: now(),
    };
    db.miruDetails.push(record);
    persist();
    return record;
  }

  function updateAnilistID(packageName: string, url: string, aniListID: string | number): void {
    const record = getDetailRecord(packageName, url);
    if (record) {
      record.aniListID = String(aniListID);
      persist();
    }
  }

  function clearAnilistID(packageName: string, url: string): void {
    const record = getDetailRecord(packageName, url);
    if (record) {
      record.aniListID = undefined;
      persist();
    }
  }

  function updateTmdbID(packageName: string, url: string, tmdbID?: number): void {
    const record = getDetailRecord(packageName, url);
    if (record) {
      record.tmdbID = tmdbID;
      persist();
    }
  }

  function getTmdbRecord(tmdbID: number): TmdbRecord | undefined {
    return db.tmdb.find((item) => item.tmdbID === tmdbID);
  }

  function getTmdbDetail(tmdbID: number): TmdbDetail | null {
    const record = getTmdbRecord(tmdbID);
    if (!record) return null;
    try {
      return JSON.parse(record.data) as TmdbDetail;
    } catch {
      return null;
    }
  }

  function putTmdbDetail(tmdbID: number, detail: TmdbDetail, mediaType: string): TmdbRecord {
    const existing = getTmdbRecord(tmdbID);
    if (existing) {
      existing.data = JSON.stringify(detail);
      existing.mediaType = mediaType;
      persist();
      return existing;
    }
    const record: TmdbRecord = {
      id: nextId(),
      tmdbID,
      data: JSON.stringify(detail),
      mediaType,
    };
    db.tmdb.push(record);
    persist();
    return record;
  }

  function getMangaReadMode(url: string, defaultMode: MangaReadMode): MangaReadMode {
    return db.mangaSettings.find((item) => item.url === url)?.readMode ?? defaultMode;
  }

  function setMangaReadMode(url: string, readMode: MangaReadMode): void {
    const existing = db.mangaSettings.find((item) => item.url === url);
    if (existing) {
      existing.readMode = readMode;
    } else {
      db.mangaSettings.push({ id: nextId(), url, readMode });
    }
    persist();
  }

  return {
    favorites,
    history,
    favoritesByType,
    historyByType,
    isFavorite,
    findFavorite,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    deleteFavorite,
    clearFavorites,
    findHistory,
    putHistory,
    deleteHistory,
    deleteHistoryById,
    clearHistory,
    getCachedDetail,
    getDetailRecord,
    putCachedDetail,
    updateAnilistID,
    clearAnilistID,
    updateTmdbID,
    getTmdbRecord,
    getTmdbDetail,
    putTmdbDetail,
    getMangaReadMode,
    setMangaReadMode,
  };
});
