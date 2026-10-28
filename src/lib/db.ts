import { reactive } from 'vue';
import type {
  ExtensionSetting,
  Favorite,
  History,
  MangaSetting,
  MiruDetailCache,
  TmdbRecord,
} from '../types/models';
import { defaultSettings } from './defaults';
import { call } from './tauri';

export interface DbData {
  version: number;
  seq: number;
  settings: Record<string, unknown>;
  favorites: Favorite[];
  history: History[];
  extensionSettings: ExtensionSetting[];
  mangaSettings: MangaSetting[];
  miruDetails: MiruDetailCache[];
  tmdb: TmdbRecord[];
}

function blank(): DbData {
  return {
    version: 1,
    seq: 1,
    settings: {},
    favorites: [],
    history: [],
    extensionSettings: [],
    mangaSettings: [],
    miruDetails: [],
    tmdb: [],
  };
}

export const db = reactive<DbData>(blank());

let initialized = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let saving: Promise<void> | null = null;

function normalize(data: unknown): DbData {
  const result = blank();
  if (!data || typeof data !== 'object') {
    result.settings = { ...defaultSettings };
    return result;
  }
  const candidate = data as Partial<DbData>;
  result.version = typeof candidate.version === 'number' ? candidate.version : 1;
  result.seq = typeof candidate.seq === 'number' ? candidate.seq : 1;
  result.settings = {
    ...defaultSettings,
    ...(candidate.settings && typeof candidate.settings === 'object' ? candidate.settings : {}),
  };
  for (const key of [
    'favorites',
    'history',
    'extensionSettings',
    'mangaSettings',
    'miruDetails',
    'tmdb',
  ] as const) {
    const value = candidate[key];
    if (Array.isArray(value)) {
      (result as unknown as Record<string, unknown>)[key] = value;
    }
  }
  const maxId = Math.max(
    0,
    ...result.favorites.map((v) => v.id || 0),
    ...result.history.map((v) => v.id || 0),
    ...result.extensionSettings.map((v) => v.id || 0),
    ...result.mangaSettings.map((v) => v.id || 0),
    ...result.miruDetails.map((v) => v.id || 0),
    ...result.tmdb.map((v) => v.id || 0),
  );
  result.seq = Math.max(result.seq, maxId + 1);
  return result;
}

export async function initDb(): Promise<void> {
  if (initialized) return;
  let raw: unknown = null;
  try {
    raw = await call<unknown>('db_load');
  } catch (error) {
    console.warn('[db] failed to load database', error);
  }
  const loaded = normalize(raw);
  db.version = loaded.version;
  db.seq = loaded.seq;
  db.settings = loaded.settings;
  db.favorites = loaded.favorites;
  db.history = loaded.history;
  db.extensionSettings = loaded.extensionSettings;
  db.mangaSettings = loaded.mangaSettings;
  db.miruDetails = loaded.miruDetails;
  db.tmdb = loaded.tmdb;
  initialized = true;
}

export function nextId(): number {
  const id = db.seq;
  db.seq += 1;
  return id;
}

export function snapshot(): string {
  return JSON.stringify(db);
}

async function writeNow(): Promise<void> {
  if (saving) {
    dirty = true;
    return saving;
  }
  if (!dirty) return;
  dirty = false;
  const payload = JSON.parse(snapshot()) as Record<string, unknown>;
  saving = (async () => {
    try {
      await call('db_save', { data: payload });
    } catch (error) {
      console.warn('[db] failed to save database', error);
      dirty = true;
    } finally {
      saving = null;
    }
    if (dirty) {
      scheduleSave(400);
    }
  })();
  return saving;
}

function scheduleSave(delay: number): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void writeNow();
  }, delay);
}

/** Mark the database dirty; writes are coalesced and atomic on the Rust side. */
export function persist(): void {
  dirty = true;
  scheduleSave(250);
}

export async function flushDb(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  dirty = true;
  await writeNow();
  if (saving) await saving;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (!dirty) return;
    void call('db_save', { data: JSON.parse(snapshot()) }).catch(() => undefined);
  });
}
