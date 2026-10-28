import { db } from './db';
import { SettingKey } from './defaults';
import { call } from './tauri';
import { DEFAULT_WINDOWS_UA } from './defaults';

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  data?: unknown;
  timeoutMs?: number;
  responseType?: 'text' | 'base64';
  throwOnError?: boolean;
}

export interface HttpResult {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
  base64?: string | null;
}

export function userAgent(): string {
  const value = db.settings[SettingKey.windowsWebviewUA];
  return typeof value === 'string' && value ? value : DEFAULT_WINDOWS_UA;
}

function bodyFromData(data: unknown, headers: Record<string, string>): {
  body?: string;
  bodyBase64?: string;
} {
  if (data === undefined || data === null) return {};
  if (typeof data === 'string') return { body: data };
  if (data instanceof URLSearchParams) return { body: data.toString() };
  if (data instanceof ArrayBuffer) {
    return { bodyBase64: bytesToBase64(new Uint8Array(data)) };
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as Uint8Array;
    return { bodyBase64: bytesToBase64(view) };
  }
  const contentTypeKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === 'content-type',
  );
  const contentType = contentTypeKey ? headers[contentTypeKey].toLowerCase() : '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      params.append(key, String(value));
    }
    return { body: params.toString() };
  }
  return { body: JSON.stringify(data) };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function rawRequest(url: string, options: HttpOptions = {}): Promise<HttpResult> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (!Object.keys(headers).some((key) => key.toLowerCase() === 'user-agent')) {
    headers['User-Agent'] = userAgent();
  }
  const { body, bodyBase64 } = bodyFromData(options.data, headers);
  const result = await call<HttpResult>('http_request', {
    options: {
      url,
      method: options.method ?? 'GET',
      headers,
      query: options.query,
      body,
      bodyBase64,
      timeoutMs: options.timeoutMs,
      responseType: options.responseType ?? 'text',
    },
  });
  if (options.throwOnError !== false && (result.status < 200 || result.status >= 300)) {
    const snippet = (result.body || '').slice(0, 300);
    throw new Error(`HTTP ${result.status}${snippet ? `: ${snippet}` : ''}`);
  }
  return result;
}

/** Text request, matching Miru's Dio-based extension request helper. */
export async function requestText(url: string, options: HttpOptions = {}): Promise<string> {
  const result = await rawRequest(url, options);
  return result.body;
}

/** Parse JSON when possible, otherwise return text (extension request semantics). */
export async function requestAuto(url: string, options: HttpOptions = {}): Promise<unknown> {
  const body = await requestText(url, options);
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export async function applyNetworkConfig(): Promise<void> {
  try {
    await call('net_config', {
      proxyType: String(db.settings[SettingKey.proxyType] ?? 'DIRECT'),
      proxy: String(db.settings[SettingKey.proxy] ?? ''),
    });
  } catch (error) {
    console.warn('[http] failed to apply network config', error);
  }
}

export async function getCookies(url: string): Promise<string> {
  return call<string>('cookies_get', { url });
}

export async function setCookies(url: string, cookies: string): Promise<void> {
  await call('cookies_set', { url, cookies });
}

export async function clearCookies(url: string): Promise<void> {
  await call('cookies_clear', { url });
}
