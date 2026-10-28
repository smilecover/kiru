import cryptoJsSource from '../extensions/vendor/CryptoJS.min.js?raw';
import jsEncryptSource from '../extensions/vendor/jsencrypt.min.js?raw';
import md5Source from '../extensions/vendor/md5.min.js?raw';
import { db, nextId, persist } from './db';
import { domGetAttributeText, domQuerySelector, domQuerySelectorAll, domQueryXPath, domRemoveSelector } from './extension-dom';
import { extensionClassName, transformExtensionSource } from './extension-parser';
import { getCookies, rawRequest, userAgent } from './http';
import { addExtensionLog, addNetworkLog } from './log';
import { bytesToBase64 } from './http';
import { errorMessage } from './tauri';
import type {
  BangumiSubtitle,
  ExtensionBangumiWatch,
  ExtensionDetail,
  ExtensionEpisodeGroup,
  ExtensionFilter,
  ExtensionFikushonWatch,
  ExtensionListItem,
  ExtensionMangaWatch,
  ExtensionMeta,
  ExtensionSetting,
  ExtensionSettingType,
} from '../types/models';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface HostMessage {
  __kiru?: string;
  id?: number;
  method?: string;
  args?: unknown[];
  ok?: boolean;
  result?: unknown;
  error?: string;
  stack?: string;
}

interface ExtensionSettingInput {
  key?: string;
  title?: string;
  value?: unknown;
  defaultValue?: unknown;
  type?: string;
  description?: string;
  options?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stringHeaders(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(asRecord(value))) {
    if (headerValue === undefined || headerValue === null) continue;
    headers[key] = String(headerValue);
  }
  return headers;
}

function settingType(value: unknown): ExtensionSettingType {
  return value === 'radio' || value === 'toggle' ? value : 'input';
}

function cloneable(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

function findSetting(packageName: string, key: string): ExtensionSetting | undefined {
  return db.extensionSettings.find(
    (setting) => setting.package === packageName && setting.key === key,
  );
}

/**
 * Runs a real Miru extension in a sandboxed iframe. All network, cookies,
 * settings and logging stay in the host; the iframe only executes extension
 * logic against injected helper classes.
 */
export class ExtensionRuntime {
  readonly meta: ExtensionMeta;
  private iframe: HTMLIFrameElement | null = null;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private ready = false;
  private disposed = false;
  private pending = new Map<number, PendingCall>();
  private sequence = 1;
  private lastRequestUrl = '';
  private source: string;

  constructor(meta: ExtensionMeta, source: string) {
    this.meta = meta;
    this.source = source;
    this.onMessage = this.onMessage.bind(this);
  }

  get packageName(): string {
    return this.meta.package;
  }

  async ensureReady(): Promise<void> {
    if (this.disposed) throw new Error('Extension runtime has been disposed');
    if (!this.readyPromise) this.start();
    return this.readyPromise as Promise<void>;
  }

  private start(): void {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const timeout = setTimeout(() => {
      this.fail(new Error(`Extension ${this.meta.package} load timeout`));
    }, 120_000);
    const resolve = this.resolveReady;
    const reject = this.rejectReady;
    this.resolveReady = () => {
      clearTimeout(timeout);
      resolve?.();
    };
    this.rejectReady = (error) => {
      clearTimeout(timeout);
      reject?.(error);
    };

    try {
      const className = extensionClassName(this.meta.package);
      const transformed = transformExtensionSource(this.source, this.meta.package);
      const bundle = [
        cryptoJsSource,
        jsEncryptSource,
        md5Source,
        this.shim(className),
        transformed,
        this.bootstrap(className),
      ].join('\n;\n');
      const encoded = bytesToBase64(new TextEncoder().encode(bundle));
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      iframe.style.cssText =
        'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;left:-10px;top:-10px';
      iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
try {
  const binary = atob("${encoded}");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  (0, eval)(new TextDecoder().decode(bytes));
} catch (error) {
  parent.postMessage({ __kiru: "init-error", error: String((error && error.stack) || error) }, "*");
}
</script></body></html>`;
      this.iframe = iframe;
      window.addEventListener('message', this.onMessage);
      document.body.appendChild(iframe);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(errorMessage(error)));
    }
  }

  private markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.resolveReady?.();
    this.resolveReady = null;
    this.rejectReady = null;
  }

  private fail(error: Error): void {
    if (this.disposed) return;
    addExtensionLog(this.meta.package, this.meta.name, 'error', error.message);
    this.rejectReady?.(error);
    this.rejectReady = null;
    this.resolveReady = null;
  }

  private onMessage(event: MessageEvent): void {
    if (!this.iframe || event.source !== this.iframe.contentWindow) return;
    const data = event.data as HostMessage | undefined;
    if (!data || typeof data !== 'object') return;
    if (data.__kiru === 'ready') {
      this.markReady();
      return;
    }
    if (data.__kiru === 'init-error') {
      this.fail(new Error(String(data.error || 'Extension initialization failed')));
      return;
    }
    if (data.__kiru === 'rpc') {
      const { id, method } = data;
      if (typeof id !== 'number' || typeof method !== 'string') return;
      void this.handleRpc(method, Array.isArray(data.args) ? data.args : [])
        .then((result) => this.reply(id, true, result))
        .catch((error) => this.reply(id, false, errorMessage(error)));
      return;
    }
    if (data.__kiru === 'result') {
      const id = data.id;
      if (typeof id !== 'number') return;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (data.ok) {
        pending.resolve(data.result);
      } else {
        const suffix = data.stack ? `\n${data.stack}` : '';
        pending.reject(new Error(`${data.error || 'Extension error'}${suffix}`));
      }
    }
  }

  private reply(id: number, ok: boolean, value: unknown): void {
    if (!this.iframe?.contentWindow || this.disposed) return;
    this.iframe.contentWindow.postMessage(
      { __kiru: 'reply', id, ok, result: ok ? cloneable(value) : undefined, error: ok ? undefined : String(value) },
      '*',
    );
  }

  private async handleRpc(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case 'log': {
        const message = args.map((value) => String(value)).join(' ');
        addExtensionLog(
          this.meta.package,
          this.meta.name,
          args[1] === 'error' ? 'error' : 'info',
          message,
        );
        return null;
      }
      case 'request':
        return this.handleRequest(args);
      case 'fetch':
        return this.handleFetch(args);
      case 'getSetting':
        return this.getSetting(String(args[0] ?? ''));
      case 'registerSetting':
        return this.registerSetting(asRecord(args[0]) as ExtensionSettingInput);
      case 'cleanSettings':
        return this.cleanSettings(Array.isArray(args[0]) ? args[0].map(String) : []);
      case 'querySelector':
        return domQuerySelector(String(args[0] ?? ''), String(args[1] ?? ''), args[2] as string);
      case 'querySelectorAll':
        return this.querySelectorAllArgs(args);
      case 'queryXPath':
        return domQueryXPath(String(args[0] ?? ''), String(args[1] ?? ''), args[2] as string);
      case 'removeSelector':
        return domRemoveSelector(String(args[0] ?? ''), String(args[1] ?? ''));
      case 'getAttributeText':
        return domGetAttributeText(
          String(args[0] ?? ''),
          String(args[1] ?? ''),
          String(args[2] ?? ''),
        );
      default:
        throw new Error(`Unknown extension host method: ${method}`);
    }
  }

  private querySelectorAllArgs(args: unknown[]): string[] {
    const first = args[0];
    if (first && typeof first === 'object') {
      const record = first as Record<string, unknown>;
      return domQuerySelectorAll(String(record.content ?? ''), String(record.selector ?? ''));
    }
    return domQuerySelectorAll(String(args[0] ?? ''), String(args[1] ?? ''));
  }

  private async handleRequest(args: unknown[]): Promise<string> {
    const url = String(args[0] ?? '');
    const options = asRecord(args[1]);
    const headers = stringHeaders(options.headers);
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'user-agent')) {
      headers['User-Agent'] = userAgent();
    }
    const method = String(options.method ?? 'get').toUpperCase();
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(asRecord(options.queryParameters))) {
      if (value !== undefined && value !== null) query[key] = String(value);
    }
    this.lastRequestUrl = url;
    const log = addNetworkLog({
      packageName: this.meta.package,
      name: this.meta.name,
      url,
      method,
      requestHeaders: headers,
      requestBody: options.data,
    });
    try {
      const result = await rawRequest(url, {
        method,
        headers,
        query,
        data: options.data,
        timeoutMs: 60_000,
      });
      log.url = result.url || url;
      log.responseBody = result.body.slice(0, 20_000);
      log.responseHeaders = result.headers;
      log.statusCode = result.status;
      return result.body;
    } catch (error) {
      log.responseBody = errorMessage(error);
      throw error;
    }
  }

  private async handleFetch(args: unknown[]): Promise<Record<string, unknown>> {
    const url = String(args[0] ?? '');
    const init = asRecord(args[1]);
    const headers = stringHeaders(init.headers);
    const method = String(init.method ?? 'GET').toUpperCase();
    const log = addNetworkLog({
      packageName: this.meta.package,
      name: this.meta.name,
      url,
      method,
      requestHeaders: headers,
      requestBody: init.body,
    });
    try {
      const result = await rawRequest(url, {
        method,
        headers,
        data: init.body,
        timeoutMs: 60_000,
        throwOnError: false,
      });
      log.responseBody = result.body.slice(0, 20_000);
      log.responseHeaders = result.headers;
      log.statusCode = result.status;
      return {
        status: result.status,
        statusText: '',
        url: result.url,
        headers: result.headers,
        body: result.body,
      };
    } catch (error) {
      log.responseBody = errorMessage(error);
      throw error;
    }
  }

  private getSetting(key: string): string {
    const setting = findSetting(this.meta.package, key);
    return setting?.value ?? setting?.defaultValue ?? '';
  }

  private registerSetting(input: ExtensionSettingInput): number {
    const key = String(input.key ?? '');
    if (!key) throw new Error('Extension setting key is required');
    const type = settingType(input.type);
    if (type === 'radio' && input.options === undefined) {
      throw new Error(`options is null for radio setting ${key}`);
    }
    const title = String(input.title ?? key);
    const defaultValue = String(input.defaultValue ?? '');
    const description =
      input.description === undefined ? undefined : String(input.description);
    const options =
      input.options === undefined ? undefined : JSON.stringify(input.options);
    const existing = findSetting(this.meta.package, key);
    if (!existing) {
      const setting: ExtensionSetting = {
        id: nextId(),
        package: this.meta.package,
        title,
        key,
        value:
          input.value === undefined || input.value === null
            ? undefined
            : String(input.value),
        defaultValue,
        type,
        description,
        options,
      };
      db.extensionSettings.push(setting);
      persist();
      return setting.id;
    }
    existing.title = title;
    existing.defaultValue = defaultValue;
    existing.description = description;
    existing.options = options;
    if (existing.type !== type) {
      existing.type = type;
      existing.value = defaultValue;
    }
    persist();
    return existing.id;
  }

  private cleanSettings(keys: string[]): number {
    let removed = 0;
    for (let index = db.extensionSettings.length - 1; index >= 0; index -= 1) {
      const setting = db.extensionSettings[index];
      if (setting.package === this.meta.package && !keys.includes(setting.key)) {
        db.extensionSettings.splice(index, 1);
        removed += 1;
      }
    }
    if (removed > 0) persist();
    return removed;
  }

  private async defaultHeaders(): Promise<Record<string, string>> {
    let cookie = '';
    try {
      cookie = await getCookies(this.meta.webSite);
    } catch {
      cookie = '';
    }
    return {
      Referer: this.lastRequestUrl,
      'User-Agent': userAgent(),
      Cookie: cookie,
    };
  }

  private async enrichList(value: unknown): Promise<ExtensionListItem[]> {
    if (!Array.isArray(value)) return [];
    const headers = await this.defaultHeaders();
    return value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        title: String(item.title ?? ''),
        url: String(item.url ?? ''),
        cover: item.cover === undefined || item.cover === null ? undefined : String(item.cover),
        update: item.update === undefined || item.update === null ? undefined : String(item.update),
        headers:
          item.headers && typeof item.headers === 'object'
            ? stringHeaders(item.headers)
            : headers,
      }));
  }

  async call<T>(method: string, args: unknown[] = [], timeoutMs = 120_000): Promise<T> {
    await this.ensureReady();
    if (this.disposed || !this.iframe?.contentWindow) {
      throw new Error('Extension runtime is not available');
    }
    const id = this.sequence++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Extension ${this.meta.name} timed out in ${method}()`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.iframe?.contentWindow?.postMessage(
        { __kiru: 'call', id, method, args },
        '*',
      );
    }).catch((error) => {
      addExtensionLog(this.meta.package, this.meta.name, 'error', errorMessage(error));
      throw error;
    });
  }

  async latest(page: number): Promise<ExtensionListItem[]> {
    return this.enrichList(await this.call<unknown>('latest', [page]));
  }

  async search(
    keyword: string,
    page: number,
    filter?: Record<string, string[]> | null,
  ): Promise<ExtensionListItem[]> {
    return this.enrichList(await this.call<unknown>('search', [keyword, page, filter ?? null]));
  }

  async createFilter(
    filter?: Record<string, string[]> | null,
  ): Promise<Record<string, ExtensionFilter>> {
    const value = await this.call<unknown>('createFilter', filter ? [filter] : []);
    if (!value || typeof value !== 'object') return {};
    return value as Record<string, ExtensionFilter>;
  }

  async detail(url: string): Promise<ExtensionDetail> {
    const value = await this.call<unknown>('detail', [url]);
    if (!value || typeof value !== 'object') {
      throw new Error(`Extension ${this.meta.name} returned an invalid detail`);
    }
    const record = value as Record<string, unknown>;
    const detail: ExtensionDetail = {
      title: String(record.title ?? ''),
      cover: record.cover === undefined || record.cover === null ? undefined : String(record.cover),
      desc: record.desc === undefined || record.desc === null ? undefined : String(record.desc),
      episodes: Array.isArray(record.episodes)
        ? (record.episodes as ExtensionEpisodeGroup[])
        : undefined,
      headers:
        record.headers && typeof record.headers === 'object'
          ? stringHeaders(record.headers)
          : await this.defaultHeaders(),
    };
    return detail;
  }

  async watch(url: string): Promise<unknown> {
    const value = await this.call<unknown>('watch', [url]);
    if (!value || typeof value !== 'object') {
      throw new Error(`Extension ${this.meta.name} returned an invalid watch result`);
    }
    if (this.meta.type === 'bangumi') {
      const record = value as Record<string, unknown>;
      const watch: ExtensionBangumiWatch = {
        type:
          record.type === 'hls' || record.type === 'torrent' || record.type === 'mp4'
            ? record.type
            : 'mp4',
        url: String(record.url ?? ''),
        subtitles: Array.isArray(record.subtitles)
          ? (record.subtitles as BangumiSubtitle[])
          : [],
        audioTrack:
          record.audioTrack === undefined || record.audioTrack === null
            ? undefined
            : String(record.audioTrack),
        headers:
          record.headers && typeof record.headers === 'object'
            ? stringHeaders(record.headers)
            : await this.defaultHeaders(),
      };
      return watch;
    }
    if (this.meta.type === 'manga') {
      const record = value as Record<string, unknown>;
      const watch: ExtensionMangaWatch = {
        urls: Array.isArray(record.urls) ? record.urls.map(String) : [],
        headers:
          record.headers && typeof record.headers === 'object'
            ? stringHeaders(record.headers)
            : await this.defaultHeaders(),
      };
      return watch;
    }
    const record = value as Record<string, unknown>;
    const watch: ExtensionFikushonWatch = {
      content: Array.isArray(record.content) ? record.content.map(String) : [],
      title: String(record.title ?? ''),
      subtitle:
        record.subtitle === undefined || record.subtitle === null
          ? undefined
          : String(record.subtitle),
    };
    return watch;
  }

  async checkUpdate(url: string): Promise<string> {
    const value = await this.call<unknown>('checkUpdate', [url]);
    return value === undefined || value === null ? '' : String(value);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    window.removeEventListener('message', this.onMessage);
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Extension runtime disposed'));
    }
    this.pending.clear();
    this.rejectReady?.(new Error('Extension runtime disposed'));
    this.resolveReady = null;
    this.rejectReady = null;
  }

  private shim(className: string): string {
    const packageName = JSON.stringify(this.meta.package);
    const name = JSON.stringify(this.meta.name);
    const webSite = JSON.stringify(this.meta.webSite);
    return `
(() => {
  const pending = new Map();
  let sequence = 1;
  function rpc(method, args) {
    return new Promise((resolve, reject) => {
      const id = sequence++;
      pending.set(id, { resolve, reject });
      parent.postMessage({ __kiru: "rpc", id, method, args }, "*");
    });
  }
  window.addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const data = event.data;
    if (!data || data.__kiru !== "reply") return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.ok) entry.resolve(data.result);
    else entry.reject(new Error(data.error || "Extension host error"));
  });
  window.global = window;
  function safeString(value) {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack || value.message;
    try { return JSON.stringify(value, null, 0); } catch (error) { return String(value); }
  }
  const nativeLog = console.log.bind(console);
  console.log = function (...args) { rpc("log", [args.map(safeString).join(" ")]).catch(() => {}); };
  const nativeError = console.error.bind(console);
  console.error = function (...args) { rpc("log", [args.map(safeString).join(" "), "error"]).catch(() => {}); };
  window.addEventListener("error", (event) => {
    rpc("log", [String(event.message || "Uncaught error"), "error"]).catch(() => {});
  });
  window.addEventListener("unhandledrejection", (event) => {
    rpc("log", ["Unhandled rejection: " + safeString(event.reason), "error"]).catch(() => {});
  });

  class Element {
    constructor(content, selector) {
      this.content = content;
      this.selector = selector || "";
    }
    async querySelector(selector) {
      return new Element(await this.excute(), selector);
    }
    async excute(fun) {
      return await rpc("querySelector", [this.content, this.selector, fun]);
    }
    async removeSelector(selector) {
      this.content = await rpc("removeSelector", [await this.outerHTML, selector]);
      return this;
    }
    async getAttributeText(attr) {
      return await rpc("getAttributeText", [await this.outerHTML, this.selector, attr]);
    }
    get text() { return this.excute("text"); }
    get outerHTML() { return this.excute("outerHTML"); }
    get innerHTML() { return this.excute("innerHTML"); }
  }

  class XPathNode {
    constructor(content, selector) {
      this.content = content;
      this.selector = selector;
    }
    async excute(fun) {
      return await rpc("queryXPath", [this.content, this.selector, fun]);
    }
    get attr() { return this.excute("attr"); }
    get attrs() { return this.excute("attrs"); }
    get text() { return this.excute("text"); }
    get allHTML() { return this.excute("allHTML"); }
    get outerHTML() { return this.excute("outerHTML"); }
  }

  class Extension {
    package = ${packageName};
    name = ${name};
    settingKeys = [];
    async request(url, options) {
      options = options || {};
      options.headers = options.headers || {};
      const miruUrl = options.headers["Miru-Url"] || ${webSite};
      options.method = options.method || "get";
      const result = await rpc("request", [String(miruUrl) + String(url), options]);
      try { return JSON.parse(result); } catch (error) { return result; }
    }
    querySelector(content, selector) { return new Element(content, selector); }
    queryXPath(content, selector) { return new XPathNode(content, selector); }
    async querySelectorAll(content, selector) {
      const items = await rpc("querySelectorAll", [{ content, selector }]);
      return (items || []).map((item) => new Element(item, selector));
    }
    async getAttributeText(content, selector, attr) {
      return await rpc("getAttributeText", [content, selector, attr]);
    }
    latest(page) { throw new Error("not implement latest"); }
    search(keyword, page, filter) { throw new Error("not implement search"); }
    createFilter(filter) { return {}; }
    detail(url) { throw new Error("not implement detail"); }
    watch(url) { throw new Error("not implement watch"); }
    checkUpdate(url) { throw new Error("not implement checkUpdate"); }
    async getSetting(key) { return await rpc("getSetting", [String(key)]); }
    async registerSetting(settings) {
      this.settingKeys.push(settings.key);
      return await rpc("registerSetting", [settings]);
    }
    async load() {}
  }

  window.fetch = async function (input, init) {
    init = init || {};
    const url = typeof input === "string" ? input : input.url;
    const headers = {};
    const sourceHeaders = init.headers || {};
    if (typeof sourceHeaders.forEach === "function" && !Array.isArray(sourceHeaders)) {
      sourceHeaders.forEach((value, key) => { headers[key] = String(value); });
    } else if (Array.isArray(sourceHeaders)) {
      for (const pair of sourceHeaders) headers[pair[0]] = String(pair[1]);
    } else {
      for (const key of Object.keys(sourceHeaders)) {
        if (sourceHeaders[key] !== undefined) headers[key] = String(sourceHeaders[key]);
      }
    }
    const result = await rpc("fetch", [String(url), {
      method: init.method || "GET",
      headers,
      body: typeof init.body === "string" ? init.body : undefined
    }]);
    const responseHeaders = new Headers();
    for (const key of Object.keys(result.headers || {})) {
      responseHeaders.set(key, String(result.headers[key]));
    }
    return new Response(result.status === 204 ? null : result.body, {
      status: result.status,
      headers: responseHeaders
    });
  };

  window.Element = Element;
  window.XPathNode = XPathNode;
  window.Extension = Extension;
  window.__kiruRpc = rpc;
  window.__kiruClassName = ${JSON.stringify(className)};
})();
`;
  }

  private bootstrap(className: string): string {
    return `
(async () => {
  try {
    const instance = new ${className}();
    let loaded = false;
    try {
      await instance.load();
      loaded = true;
    } catch (error) {
      try {
        await window.__kiruRpc("log", ["load() failed: " + String((error && error.stack) || error), "error"]);
      } catch (ignored) {}
    }
    if (loaded) {
      try {
        await window.__kiruRpc("cleanSettings", [instance.settingKeys || []]);
      } catch (ignored) {}
    }
    window.addEventListener("message", async (event) => {
      if (event.source !== parent) return;
      const data = event.data;
      if (!data || data.__kiru !== "call") return;
      const { id, method, args } = data;
      try {
        if (typeof instance[method] !== "function") {
          throw new Error("Unsupported extension method: " + method);
        }
        const result = await instance[method].apply(instance, args || []);
        let safe = null;
        if (result !== undefined) {
          try { safe = JSON.parse(JSON.stringify(result)); } catch (error) { safe = String(result); }
        }
        parent.postMessage({ __kiru: "result", id, ok: true, result: safe }, "*");
      } catch (error) {
        parent.postMessage({
          __kiru: "result", id, ok: false,
          error: String((error && error.message) || error),
          stack: String((error && error.stack) || "")
        }, "*");
      }
    });
    parent.postMessage({ __kiru: "ready" }, "*");
  } catch (error) {
    parent.postMessage({ __kiru: "init-error", error: String((error && error.stack) || error) }, "*");
  }
})();
`;
  }
}
