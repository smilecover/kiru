import { createI18n } from 'vue-i18n';
import type { WritableComputedRef } from 'vue';
import be from '../locales/be.json';
import en from '../locales/en.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';
import hi from '../locales/hi.json';
import hu from '../locales/hu.json';
import id from '../locales/id.json';
import ja from '../locales/ja.json';
import pl from '../locales/pl.json';
import ru from '../locales/ru.json';
import ryu from '../locales/ryu.json';
import uk from '../locales/uk.json';
import zh from '../locales/zh.json';
import zhHant from '../locales/zhHant.json';

export const messages = { be, en, es, fr, hi, hu, id, ja, pl, ru, ryu, uk, zh, zhHant };
export type LocaleCode = keyof typeof messages;

export const languageOptions: { code: LocaleCode; label: string }[] = [
  { code: 'be', label: 'Беларуская' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'hu', label: 'Magyar' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'id', label: 'Indonesia' },
  { code: 'ja', label: '日本語' },
  { code: 'pl', label: 'Polski' },
  { code: 'ru', label: 'Русский' },
  { code: 'ryu', label: 'うちなーぐち' },
  { code: 'uk', label: 'Українська' },
  { code: 'zh', label: '中文' },
  { code: 'zhHant', label: '繁體中文' },
];

export function normalizeLocale(value: unknown): LocaleCode {
  const raw = String(value ?? '').replace('_', '-');
  if (raw in messages) return raw as LocaleCode;
  const lower = raw.toLowerCase();
  if (lower.startsWith('zh')) {
    const traditional = /hant|tw|hk|mo/i.test(raw);
    return traditional ? 'zhHant' : 'zh';
  }
  const base = lower.split('-')[0];
  if (base in messages) return base as LocaleCode;
  return 'en';
}

export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages,
  missingWarn: false,
  fallbackWarn: false,
});

export function setLocale(value: unknown): void {
  const code = normalizeLocale(value);
  (i18n.global.locale as WritableComputedRef<string>).value = code;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = code;
  }
}

export function currentLocale(): LocaleCode {
  return normalizeLocale((i18n.global.locale as WritableComputedRef<string>).value);
}

/** Region used by TMDB metadata queries. */
export function tmdbLanguage(): string {
  switch (currentLocale()) {
    case 'zh':
      return 'zh-CN';
    case 'zhHant':
      return 'zh-TW';
    case 'ja':
      return 'ja-JP';
    case 'ru':
      return 'ru-RU';
    case 'uk':
      return 'uk-UA';
    case 'be':
      return 'be-BY';
    case 'es':
      return 'es-ES';
    case 'fr':
      return 'fr-FR';
    case 'hu':
      return 'hu-HU';
    case 'hi':
      return 'hi-IN';
    case 'id':
      return 'id-ID';
    case 'pl':
      return 'pl-PL';
    default:
      return 'en-US';
  }
}

/** BCP-47 tag passed to Intl APIs. */
export function intlLocale(): string {
  const code = currentLocale();
  return code === 'zhHant' ? 'zh-TW' : code === 'ryu' ? 'ja-JP' : code;
}

export function t(key: string, named?: Record<string, unknown>): string {
  return named ? i18n.global.t(key, named) : i18n.global.t(key);
}
