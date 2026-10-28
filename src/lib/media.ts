import { call } from './tauri';
import { rawRequest } from './http';

let proxyBase = '';

export async function initMediaProxy(): Promise<void> {
  try {
    proxyBase = await call<string>('proxy_base');
  } catch (error) {
    console.warn('[media] proxy unavailable', error);
    proxyBase = '';
  }
}

export function getProxyBase(): string {
  return proxyBase;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlEncode(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

/**
 * Wraps a remote media URL through Kiru's localhost proxy so custom headers,
 * cookies and CORS are preserved for <video>, <img>, HLS and subtitles.
 */
export function mediaUrl(url: string, headers?: Record<string, string>): string {
  if (!url) return '';
  if (
    url.startsWith('blob:') ||
    url.startsWith('data:') ||
    url.startsWith('file:') ||
    url.startsWith('/') ||
    url.includes('/media?u=')
  ) {
    return url;
  }
  if (!/^https?:\/\//i.test(url)) return url;
  if (!proxyBase) return url;
  const target = base64UrlEncode(url);
  const headerJson = headers && Object.keys(headers).length ? base64UrlEncode(JSON.stringify(headers)) : '';
  return `${proxyBase}/media?u=${target}${headerJson ? `&h=${headerJson}` : ''}`;
}

/** TMDB images do not need the proxy. */
export function tmdbImage(path?: string | null, size = 'original'): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `https://image.tmdb.org/t/p/${size}${path.startsWith('/') ? path : `/${path}`}`;
}

export function argbToHex(value: unknown, fallback = 'FFFFFFFF'): string {
  const numeric =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.trunc(value) >>> 0
      : Number.parseInt(String(value ?? ''), 10) >>> 0;
  const safe = Number.isFinite(numeric) ? numeric : Number.parseInt(fallback, 16) >>> 0;
  return `#${safe.toString(16).padStart(8, '0').slice(2)}`;
}

export function argbToCss(value: unknown, fallback = 'FFFFFF'): string {
  return argbToHex(value, fallback);
}

function normalizeSubtitleTime(value: string): string {
  const match = value.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!match) return '00:00:00.000';
  const [, h, m, s, ms] = match;
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}.${ms.padEnd(3, '0')}`;
}

export function srtToVtt(text: string): string {
  let content = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (content.trimStart().startsWith('WEBVTT')) return content;
  content = content.replace(
    /(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})/g,
    (_match, time: string, ms: string) => `${time}.${ms.padEnd(3, '0')}`,
  );
  return `WEBVTT\n\n${content.trim()}\n`;
}

export function assToVtt(text: string): string {
  const events: { start: string; end: string; text: string }[] = [];
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line.toLowerCase().startsWith('dialogue:')) continue;
    const body = line.slice(line.indexOf(':') + 1).trim();
    const parts = body.split(',');
    if (parts.length < 10) continue;
    const start = normalizeSubtitleTime(parts[1]);
    const end = normalizeSubtitleTime(parts[2]);
    let cue = parts.slice(9).join(',');
    cue = cue
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/gi, '\n')
      .replace(/\\n/gi, '\n')
      .replace(/\\h/gi, ' ')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    events.push({ start, end, text: cue.trim() });
  }
  return `WEBVTT\n\n${events
    .map((event) => `${event.start} --> ${event.end}\n${event.text}`)
    .join('\n\n')}\n`;
}

export function subtitleToVtt(text: string, title = '', url = ''): string {
  const hint = `${title} ${url}`.toLowerCase();
  if (text.includes('[Script Info]') || hint.endsWith('.ass') || hint.endsWith('.ssa')) {
    return assToVtt(text);
  }
  if (text.trimStart().startsWith('WEBVTT')) return text;
  return srtToVtt(text);
}

export async function fetchSubtitleVtt(
  url: string,
  headers?: Record<string, string>,
  title = '',
): Promise<string> {
  const result = await rawRequest(url, {
    headers,
    timeoutMs: 30000,
    throwOnError: false,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Subtitle download failed: HTTP ${result.status}`);
  }
  return subtitleToVtt(result.body, title, url);
}

export interface LoadedSubtitle {
  title: string;
  language?: string;
  url: string;
  blobUrl: string;
  vtt: string;
}

const subtitleBlobUrls: string[] = [];

export function disposeSubtitles(): void {
  for (const url of subtitleBlobUrls) {
    URL.revokeObjectURL(url);
  }
  subtitleBlobUrls.length = 0;
}

export function makeSubtitleBlob(vtt: string): string {
  const blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt;charset=utf-8' }));
  subtitleBlobUrls.push(blobUrl);
  return blobUrl;
}

export async function loadSubtitle(
  url: string,
  headers: Record<string, string> | undefined,
  title: string,
  language?: string,
): Promise<LoadedSubtitle> {
  const vtt = await fetchSubtitleVtt(url, headers, title);
  return {
    title,
    language,
    url,
    vtt,
    blobUrl: makeSubtitleBlob(vtt),
  };
}
