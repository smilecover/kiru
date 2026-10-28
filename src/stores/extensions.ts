import { computed, reactive, ref } from 'vue';
import { defineStore } from 'pinia';
import { db, persist } from '../lib/db';
import { parseExtensionMeta } from '../lib/extension-parser';
import { ExtensionRuntime } from '../lib/extension-runtime';
import { rawRequest } from '../lib/http';
import { errorMessage } from '../lib/tauri';
import { call } from '../lib/tauri';
import { toExtensionPackage } from '../lib/util';
import type {
  ExtensionMeta,
  ExtensionSetting,
  RepoExtension,
} from '../types/models';
import { useSettingsStore } from './settings';

interface ExtensionFile {
  filename: string;
  content: string;
}

const extensionSources = new Map<string, string>();
const runtimes = new Map<string, ExtensionRuntime>();
const runtimePromises = new Map<string, Promise<ExtensionRuntime>>();
let activeLoad: Promise<void> | null = null;

export function getExtensionRuntime(packageName: string): ExtensionRuntime | undefined {
  return runtimes.get(packageName);
}

function normalizedVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}

export const useExtensionsStore = defineStore('extensions', () => {
  const metas = ref<ExtensionMeta[]>([]);
  const rawFiles = ref<ExtensionFile[]>([]);
  const errors = reactive<Record<string, string>>({});
  const runtimeErrors = reactive<Record<string, string>>({});
  const loading = ref(false);
  const loaded = ref(false);
  const loadError = ref('');
  const repoItems = ref<RepoExtension[]>([]);
  const repoLoading = ref(false);
  const repoError = ref('');

  const extensions = computed(() =>
    [...metas.value].sort((left, right) => left.name.localeCompare(right.name)),
  );
  const settings = useSettingsStore();

  const visibleExtensions = computed(() =>
    extensions.value.filter((item) => settings.enableNSFW || !item.nsfw),
  );

  function getMeta(packageName: string): ExtensionMeta | undefined {
    return metas.value.find((item) => item.package === packageName);
  }

  function hasRuntime(packageName: string): boolean {
    return runtimes.has(packageName);
  }

  function disposeRuntime(packageName: string): void {
    const runtime = runtimes.get(packageName);
    if (runtime) {
      runtime.dispose();
      runtimes.delete(packageName);
    }
    if (runtimePromises.has(packageName)) runtimePromises.delete(packageName);
    delete runtimeErrors[packageName];
  }

  function disposeAll(): void {
    for (const packageName of Array.from(runtimes.keys())) {
      disposeRuntime(packageName);
    }
  }

  async function loadExtensions(): Promise<void> {
    if (activeLoad) return activeLoad;
    activeLoad = performLoad().finally(() => {
      activeLoad = null;
    });
    return activeLoad;
  }

  async function performLoad(): Promise<void> {
    loading.value = true;
    loadError.value = '';
    try {
      const files = await call<ExtensionFile[]>('extensions_list');
      rawFiles.value = files;
      const parsed: ExtensionMeta[] = [];
      const nextSources = new Map<string, string>();
      const seenPackages = new Set<string>();
      for (const key of Object.keys(errors)) delete errors[key];
      for (const file of files) {
        const filenamePackage = toExtensionPackage(file.filename);
        try {
          const meta = parseExtensionMeta(file.content);
          if (meta.package !== filenamePackage) {
            throw new Error(
              `Inconsistency between file name and package name (${filenamePackage} != ${meta.package})`,
            );
          }
          if (seenPackages.has(meta.package)) {
            throw new Error(`Duplicate extension package: ${meta.package}`);
          }
          seenPackages.add(meta.package);
          parsed.push(meta);
          nextSources.set(meta.package, file.content);
        } catch (error) {
          errors[file.filename] = errorMessage(error);
          nextSources.set(filenamePackage, file.content);
        }
      }
      for (const [packageName, oldSource] of Array.from(extensionSources.entries())) {
        const nextSource = nextSources.get(packageName);
        const meta = parsed.find((item) => item.package === packageName);
        if (!meta || nextSource === undefined || nextSource !== oldSource) {
          disposeRuntime(packageName);
        }
      }
      for (const packageName of Array.from(runtimes.keys())) {
        if (!seenPackages.has(packageName)) disposeRuntime(packageName);
      }
      extensionSources.clear();
      for (const [packageName, source] of nextSources) {
        extensionSources.set(packageName, source);
      }
      metas.value = parsed;
      loaded.value = true;
    } catch (error) {
      loadError.value = errorMessage(error);
      throw error;
    } finally {
      loading.value = false;
    }
  }

  async function ensureRuntime(packageName: string): Promise<ExtensionRuntime> {
    const existing = runtimes.get(packageName);
    if (existing) return existing;
    const pending = runtimePromises.get(packageName);
    if (pending) return pending;
    const meta = getMeta(packageName);
    const source = extensionSources.get(packageName);
    if (!meta) throw new Error(`Extension ${packageName} not found`);
    if (source === undefined) throw new Error(`Extension source ${packageName} not found`);
    const runtime = new ExtensionRuntime(meta, source);
    runtimes.set(packageName, runtime);
    let tracked: Promise<ExtensionRuntime>;
    tracked = runtime
      .ensureReady()
      .then(() => {
        delete runtimeErrors[packageName];
        return runtime;
      })
      .catch((error) => {
        if (runtimes.get(packageName) === runtime) {
          runtime.dispose();
          runtimes.delete(packageName);
          runtimeErrors[packageName] = errorMessage(error);
        }
        throw error;
      })
      .finally(() => {
        if (runtimePromises.get(packageName) === tracked) {
          runtimePromises.delete(packageName);
        }
      });
    runtimePromises.set(packageName, tracked);
    return tracked;
  }

  async function reloadExtensions(): Promise<void> {
    const pending = activeLoad;
    if (pending) {
      try {
        await pending;
      } catch {
        // The pending load surfaces its own error; reload from disk below.
      }
    }
    await loadExtensions();
  }

  async function readSource(packageName: string): Promise<string> {
    const cached = extensionSources.get(packageName);
    if (cached !== undefined) return cached;
    return call<string>('extension_read', { filename: `${packageName}.js` });
  }

  async function installByScript(source: string): Promise<ExtensionMeta> {
    const meta = parseExtensionMeta(source);
    await call('extension_write', {
      filename: `${meta.package}.js`,
      content: source,
    });
    disposeRuntime(meta.package);
    await reloadExtensions();
    return meta;
  }

  async function installByUrl(url: string): Promise<ExtensionMeta> {
    const result = await rawRequest(url, {
      timeoutMs: 60_000,
      throwOnError: true,
    });
    if (!result.body.trim()) {
      throw new Error('Does not seem to be an extension');
    }
    return installByScript(result.body);
  }

  async function installFromRepo(item: RepoExtension): Promise<ExtensionMeta> {
    const repoUrl = settings.repoUrl.replace(/\/+$/, '');
    const filename = item.url || `${item.package}.js`;
    return installByUrl(`${repoUrl}/repo/${filename}`);
  }

  async function installFromFile(path: string): Promise<ExtensionMeta> {
    const source = await call<string>('read_text_file', { path });
    return installByScript(source);
  }

  async function uninstall(packageName: string): Promise<void> {
    await call('extension_delete', { filename: `${packageName}.js` });
    disposeRuntime(packageName);
    await reloadExtensions();
  }

  async function saveSource(packageName: string, source: string): Promise<void> {
    await call('extension_write', {
      filename: `${packageName}.js`,
      content: source,
    });
    disposeRuntime(packageName);
    await reloadExtensions();
  }

  async function loadRepo(force = false): Promise<void> {
    if (repoLoading.value || (repoItems.value.length > 0 && !force)) return;
    const repoUrl = settings.repoUrl.replace(/\/+$/, '');
    if (!repoUrl) {
      repoError.value = 'Extension repository URL is empty';
      return;
    }
    repoLoading.value = true;
    repoError.value = '';
    try {
      const result = await rawRequest(`${repoUrl}/index.json`, {
        timeoutMs: 60_000,
        throwOnError: true,
      });
      const parsed = JSON.parse(result.body) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Invalid repository index');
      repoItems.value = (parsed as RepoExtension[]).filter(
        (item) => settings.enableNSFW || String(item.nsfw) !== 'true',
      );
    } catch (error) {
      repoError.value = errorMessage(error);
    } finally {
      repoLoading.value = false;
    }
  }

  function hasUpdate(item: RepoExtension): boolean {
    const meta = getMeta(item.package);
    return Boolean(meta && normalizedVersion(meta.version) !== normalizedVersion(item.version));
  }

  function extensionSettings(packageName: string): ExtensionSetting[] {
    return db.extensionSettings
      .filter((setting) => setting.package === packageName)
      .sort((left, right) => left.id - right.id);
  }

  async function loadExtensionSettings(packageName: string): Promise<ExtensionSetting[]> {
    await ensureRuntime(packageName);
    return extensionSettings(packageName);
  }

  function setExtensionSetting(packageName: string, key: string, value: string): boolean {
    const setting = db.extensionSettings.find(
      (item) => item.package === packageName && item.key === key,
    );
    if (!setting) return false;
    setting.value = value;
    persist();
    return true;
  }

  function extensionsByType(type?: ExtensionMeta['type']): ExtensionMeta[] {
    return type ? extensions.value.filter((item) => item.type === type) : extensions.value;
  }

  return {
    metas,
    extensions,
    visibleExtensions,
    rawFiles,
    errors,
    runtimeErrors,
    loading,
    loaded,
    loadError,
    repoItems,
    repoLoading,
    repoError,
    loadExtensions,
    ensureRuntime,
    readSource,
    hasRuntime,
    disposeRuntime,
    disposeAll,
    installByScript,
    installByUrl,
    installFromRepo,
    installFromFile,
    uninstall,
    saveSource,
    loadRepo,
    hasUpdate,
    getMeta,
    extensionSettings,
    loadExtensionSettings,
    setExtensionSetting,
    extensionsByType,
  };
});
