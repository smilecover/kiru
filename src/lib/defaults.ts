export const SettingKey = {
  theme: 'Theme',
  miruRepoUrl: 'MiruRepoUrl',
  tmdbKey: 'TMDBKey',
  autoCheckUpdate: 'AutoCheckUpdate',
  language: 'Language',
  novelFontSize: 'NovelFontSize',
  enableNSFW: 'EnableNSFW',
  videoPlayer: 'VideoPlayer',
  databaseVersion: 'DatabaseVersion',
  listMode: 'ListMode',
  keyI: 'KeyI',
  keyJ: 'KeyJ',
  arrowLeft: 'Arrowleft',
  arrowRight: 'Arrowright',
  readingMode: 'ReadingMode',
  aniListToken: 'AniListToken',
  aniListUserId: 'AniListUserId',
  autoTracking: 'AutoTracking',
  windowSize: 'WindowsSize',
  windowPosition: 'WindowsPosition',
  androidWebviewUA: 'AndroidWebviewUA',
  windowsWebviewUA: 'WindowsWebviewUA',
  proxy: 'Proxy',
  proxyType: 'ProxyType',
  saveLog: 'SaveLog',
  subtitleFontSize: 'SubtitleFontSize',
  subtitleFontWeight: 'SubtitleFontWeight',
  subtitleFontColor: 'SubtitleFontColor',
  subtitleBackgroundColor: 'SubtitleBackgroundColor',
  subtitleBackgroundOpacity: 'SubtitleBackgroundOpacity',
  subtitleTextAlign: 'SubtitleTextAlign',
  subtitleLastLanguageSelected: 'SubtitleLastLanguageSelected',
  subtitleLastTitleSelected: 'SubtitleLastTitleSelected',
} as const;

export type SettingKeyName = (typeof SettingKey)[keyof typeof SettingKey];

export const DEFAULT_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Android) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36';

export const DEFAULT_WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

export const defaultSettings: Record<string, unknown> = {
  [SettingKey.theme]: 'system',
  [SettingKey.miruRepoUrl]: 'https://miru-repo.0n0.dev',
  [SettingKey.tmdbKey]: '',
  [SettingKey.autoCheckUpdate]: true,
  [SettingKey.language]: 'en',
  [SettingKey.novelFontSize]: 18,
  [SettingKey.enableNSFW]: false,
  [SettingKey.videoPlayer]: 'built-in',
  [SettingKey.databaseVersion]: 2,
  [SettingKey.listMode]: 'grid',
  [SettingKey.keyI]: 10,
  [SettingKey.keyJ]: -10,
  [SettingKey.arrowLeft]: -2,
  [SettingKey.arrowRight]: 2,
  [SettingKey.readingMode]: 'standard',
  [SettingKey.aniListToken]: '',
  [SettingKey.aniListUserId]: '',
  [SettingKey.autoTracking]: true,
  [SettingKey.windowSize]: '1280,720',
  [SettingKey.androidWebviewUA]: DEFAULT_ANDROID_UA,
  [SettingKey.windowsWebviewUA]: DEFAULT_WINDOWS_UA,
  [SettingKey.proxy]: '',
  [SettingKey.proxyType]: 'DIRECT',
  [SettingKey.saveLog]: true,
  [SettingKey.subtitleFontSize]: 46,
  [SettingKey.subtitleFontColor]: 0xffffffff,
  [SettingKey.subtitleFontWeight]: 'bold',
  [SettingKey.subtitleBackgroundColor]: 0xff000000,
  [SettingKey.subtitleBackgroundOpacity]: 0.5,
  [SettingKey.subtitleTextAlign]: 2,
};

/** Flutter's TextAlign index to CSS text-align. */
export const textAligns = ['left', 'right', 'center', 'justify', 'start', 'end'] as const;
