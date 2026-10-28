import { computed } from 'vue';
import { defineStore } from 'pinia';
import { db, persist } from '../lib/db';
import { SettingKey, textAligns } from '../lib/defaults';
import { setLocale } from '../i18n';
import type { MangaReadMode } from '../types/models';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ListMode = 'grid' | 'list';

export const useSettingsStore = defineStore('settings', () => {
  const settings = computed(() => db.settings);
  const theme = computed<ThemeMode>(() => {
    const value = db.settings[SettingKey.theme];
    return value === 'light' || value === 'dark' ? value : 'system';
  });
  const language = computed(() => String(db.settings[SettingKey.language] ?? 'en'));
  const listMode = computed<ListMode>(() =>
    db.settings[SettingKey.listMode] === 'list' ? 'list' : 'grid',
  );
  const enableNSFW = computed(() => db.settings[SettingKey.enableNSFW] === true);
  const repoUrl = computed({
    get: () => String(db.settings[SettingKey.miruRepoUrl] ?? ''),
    set: (value: string) => setSetting(SettingKey.miruRepoUrl, value.trim().replace(/\/+$/, '')),
  });
  const anilistToken = computed(() => String(db.settings[SettingKey.aniListToken] ?? ''));
  const anilistUserId = computed(() => String(db.settings[SettingKey.aniListUserId] ?? ''));
  const autoTracking = computed(() => db.settings[SettingKey.autoTracking] !== false);
  const novelFontSize = computed(() => Number(db.settings[SettingKey.novelFontSize] ?? 18) || 18);
  const readingMode = computed<MangaReadMode>(() => {
    const value = db.settings[SettingKey.readingMode];
    return value === 'rightToLeft' || value === 'webTonn' ? value : 'standard';
  });
  const subtitleTextAlign = computed(() => {
    const index = Number(db.settings[SettingKey.subtitleTextAlign] ?? 2);
    return textAligns[index] ?? 'center';
  });
  const saveLog = computed(() => db.settings[SettingKey.saveLog] !== false);

  function get<T>(key: string, fallback: T): T {
    const value = db.settings[key];
    return (value === undefined || value === null ? fallback : value) as T;
  }

  function setSetting(key: string, value: unknown): void {
    db.settings[key] = value;
    if (key === SettingKey.language) {
      setLocale(value);
    }
    persist();
  }

  function setMany(values: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(values)) {
      db.settings[key] = value;
      if (key === SettingKey.language) setLocale(value);
    }
    persist();
  }

  function toggle(key: string, fallback = false): void {
    setSetting(key, !(db.settings[key] ?? fallback));
  }

  return {
    settings,
    theme,
    language,
    listMode,
    enableNSFW,
    repoUrl,
    anilistToken,
    anilistUserId,
    autoTracking,
    novelFontSize,
    readingMode,
    subtitleTextAlign,
    saveLog,
    get,
    set: setSetting,
    setMany,
    toggle,
  };
});
