import { t } from '../i18n';
import type {
  AnilistListStatus,
  AnilistType,
  ExtensionType,
  MangaReadMode,
} from '../types/models';

export const extensionTypes: ExtensionType[] = ['bangumi', 'manga', 'fikushon'];
export const anilistStatuses: AnilistListStatus[] = [
  'CURRENT',
  'COMPLETED',
  'PLANNING',
  'PAUSED',
  'DROPPED',
  'REPEATING',
];

export function extensionTypeLabel(type?: ExtensionType | string | null): string {
  switch (type) {
    case 'bangumi':
      return t('extension-type.video');
    case 'manga':
      return t('extension-type.comic');
    case 'fikushon':
      return t('extension-type.novel');
    default:
      return '';
  }
}

/** Accepts Miru's legacy enum indexes (0/1/2) as well as names. */
export function normalizeExtensionType(value: unknown): ExtensionType | null {
  if (value === 'bangumi' || value === '0') return 'bangumi';
  if (value === 'manga' || value === '1') return 'manga';
  if (value === 'fikushon' || value === '2') return 'fikushon';
  return null;
}

export function mangaReadModeLabel(mode: MangaReadMode): string {
  switch (mode) {
    case 'rightToLeft':
      return t('comic-settings.right-to-left');
    case 'webTonn':
      return t('comic-settings.web-tonn');
    default:
      return t('comic-settings.standard');
  }
}

export function anilistTypeForExtension(type?: ExtensionType | null): AnilistType | null {
  if (type === 'bangumi') return 'anime';
  if (type === 'manga') return 'manga';
  return null;
}

export function normalizeAnilistType(value: unknown): AnilistType {
  return value === 'manga' || value === '1' ? 'manga' : 'anime';
}

export function anilistStatusLabel(
  status: AnilistListStatus | string,
  type: AnilistType,
): string {
  switch (String(status).toUpperCase()) {
    case 'COMPLETED':
      return t('anilist.completed');
    case 'PLANNING':
      return t('anilist.planning');
    case 'PAUSED':
      return t('anilist.hold-on');
    case 'DROPPED':
      return t('anilist.dropped');
    case 'REPEATING':
      return type === 'anime' ? t('anilist.re-watching') : t('anilist.re-reading');
    default:
      return type === 'anime' ? t('anilist.watching') : t('anilist.reading');
  }
}

export function anilistTypeLabel(type: AnilistType): string {
  return type === 'anime' ? t('common.anime') : t('common.manga');
}
