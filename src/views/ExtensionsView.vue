<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import {
  AlertCircle,
  Code2,
  FolderOpen,
  Globe2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Store,
  Trash2,
  Upload,
  X,
} from 'lucide-vue-next';
import AppModal from '../components/AppModal.vue';
import EmptyState from '../components/EmptyState.vue';
import SmartImage from '../components/SmartImage.vue';
import {
  extensionTypes,
  extensionTypeLabel,
} from '../lib/labels';
import { call, errorMessage } from '../lib/tauri';
import { useExtensionsStore } from '../stores/extensions';
import { useUiStore } from '../stores/ui';
import type { ExtensionMeta, ExtensionType } from '../types/models';

const router = useRouter();
const { t } = useI18n();
const extensions = useExtensionsStore();
const ui = useUiStore();

const keyword = ref('');
const activeType = ref<ExtensionType | null>(null);
const refreshing = ref(false);
const extensionDir = ref('');

const importOpen = ref(false);
const importUrl = ref('');
const importBusy = ref<'' | 'url' | 'file'>('');
const importError = ref('');
const errorsOpen = ref(false);
const removing = ref('');

const tabs = computed(() => [
  { type: null as ExtensionType | null, label: t('search.all') },
  ...extensionTypes.map((type) => ({
    type: type as ExtensionType | null,
    label: extensionTypeLabel(type),
  })),
]);

const installed = computed(() => extensions.extensions);

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  return installed.value.filter((meta) => {
    if (activeType.value && meta.type !== activeType.value) return false;
    if (!query) return true;
    return (
      meta.name.toLowerCase().includes(query) ||
      meta.package.toLowerCase().includes(query) ||
      (meta.author ?? '').toLowerCase().includes(query)
    );
  });
});

interface ExtensionError {
  key: string;
  message: string;
  kind: 'parse' | 'runtime';
}

const errorList = computed<ExtensionError[]>(() => [
  ...Object.entries(extensions.errors).map(([key, message]) => ({
    key,
    message,
    kind: 'parse' as const,
  })),
  ...Object.entries(extensions.runtimeErrors).map(([key, message]) => ({
    key,
    message,
    kind: 'runtime' as const,
  })),
]);

const errorCount = computed(() => errorList.value.length);

function runtimeError(meta: ExtensionMeta): string {
  return extensions.runtimeErrors[meta.package] ?? '';
}

async function refresh(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await extensions.loadExtensions();
  } catch (error) {
    ui.notifyError(error);
  } finally {
    refreshing.value = false;
  }
}

async function loadExtensionDir(): Promise<void> {
  try {
    extensionDir.value = await call<string>('extensions_path');
  } catch {
    extensionDir.value = '';
  }
}

async function openFolder(): Promise<void> {
  if (!extensionDir.value) await loadExtensionDir();
  if (!extensionDir.value) {
    ui.notify(t('management.folder-unavailable'), 'error');
    return;
  }
  try {
    await openPath(extensionDir.value);
  } catch (error) {
    try {
      await navigator.clipboard.writeText(extensionDir.value);
      ui.notify(t('management.path-copied'), 'success');
    } catch {
      ui.notifyError(error);
    }
  }
}

function showImport(): void {
  importUrl.value = '';
  importError.value = '';
  importBusy.value = '';
  importOpen.value = true;
  void loadExtensionDir();
}

function closeImport(): void {
  if (importBusy.value) return;
  importOpen.value = false;
}

async function importByUrl(): Promise<void> {
  const url = importUrl.value.trim();
  if (!url || importBusy.value) return;
  importBusy.value = 'url';
  importError.value = '';
  try {
    const meta = await extensions.installByUrl(url);
    importOpen.value = false;
    ui.notify(t('management.installed-name', { name: meta.name }), 'success');
  } catch (error) {
    importError.value = errorMessage(error);
  } finally {
    importBusy.value = '';
  }
}

async function importByFile(): Promise<void> {
  if (importBusy.value) return;
  importError.value = '';
  try {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'JavaScript', extensions: ['js'] }],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;
    importBusy.value = 'file';
    const meta = await extensions.installFromFile(path);
    importOpen.value = false;
    ui.notify(t('management.installed-name', { name: meta.name }), 'success');
  } catch (error) {
    importError.value = errorMessage(error);
  } finally {
    importBusy.value = '';
  }
}

function openSettings(meta: ExtensionMeta): void {
  void router.push({
    name: 'extension-settings',
    params: { package: meta.package },
  });
}

function openCode(meta: ExtensionMeta): void {
  void router.push({
    name: 'extension-code',
    params: { package: meta.package },
  });
}

async function openSite(meta: ExtensionMeta): Promise<void> {
  if (!meta.webSite) return;
  try {
    await call('open_site_window', {
      url: meta.webSite,
      title: meta.name,
    });
    ui.notify(t('management.site-window-hint'), 'info', 4500);
  } catch (error) {
    ui.notifyError(error);
  }
}

async function removeExtension(meta: ExtensionMeta): Promise<void> {
  if (removing.value) return;
  const confirmed = await ui.confirm({
    title: t('common.uninstall'),
    message: t('management.uninstall-confirm', { name: meta.name }),
    confirmText: t('common.uninstall'),
    destructive: true,
  });
  if (!confirmed) return;
  removing.value = meta.package;
  try {
    await extensions.uninstall(meta.package);
    ui.notify(t('management.uninstalled', { name: meta.name }), 'success');
  } catch (error) {
    ui.notifyError(error);
  } finally {
    removing.value = '';
  }
}

onMounted(() => {
  void loadExtensionDir();
  if (!extensions.loaded) {
    void refresh();
  }
});
</script>

<template>
  <div class="page-scroll">
    <div class="page">
      <header class="page-header">
        <div class="title-wrap">
          <h1>{{ t('common.extension') }}</h1>
          <div class="page-subtitle">
            {{ t('management.installed-count', { count: installed.length }) }}
          </div>
        </div>
        <div class="spacer" />
        <button
          v-if="errorCount"
          class="btn error-button"
          :title="t('management.show-errors')"
          @click="errorsOpen = true"
        >
          <AlertCircle :size="15" />
          <span>{{ errorCount }}</span>
        </button>
        <button
          class="btn btn-icon"
          :title="t('management.refresh')"
          :disabled="refreshing"
          @click="refresh"
        >
          <RefreshCw :size="16" :class="{ spin: refreshing }" />
        </button>
        <RouterLink to="/extensions/repo" class="btn">
          <Store :size="15" />
          {{ t('common.repo') }}
        </RouterLink>
        <button class="btn btn-primary" @click="showImport">
          <Plus :size="16" />
          {{ t('extension.import.title') }}
        </button>
      </header>

      <div class="extension-toolbar">
        <div class="type-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.label"
            class="type-tab"
            :class="{ active: activeType === tab.type }"
            @click="activeType = tab.type"
          >
            {{ tab.label }}
          </button>
        </div>
        <div class="spacer" />
        <div class="search-box">
          <Search :size="15" />
          <input
            v-model="keyword"
            class="input"
            type="search"
            :placeholder="t('management.search')"
          />
          <button
            v-if="keyword"
            class="clear-search"
            :title="t('common.clear')"
            @click="keyword = ''"
          >
            <X :size="13" />
          </button>
        </div>
      </div>

      <div v-if="extensions.loadError" class="error-banner load-error">
        <AlertCircle :size="17" />
        <span>{{ extensions.loadError }}</span>
        <button class="btn btn-sm" @click="refresh">{{ t('common.retry') }}</button>
      </div>

      <div v-if="!extensions.loaded && extensions.loading" class="loading-center">
        <div class="spinner lg" />
      </div>

      <EmptyState
        v-else-if="installed.length === 0"
        :title="t('common.no-extension')"
        :description="t('management.empty-hint')"
      >
        <div class="row">
          <button class="btn btn-primary" @click="showImport">
            <Plus :size="15" />
            {{ t('extension.import.title') }}
          </button>
          <RouterLink to="/extensions/repo" class="btn">
            <Store :size="15" />
            {{ t('common.extension-repo') }}
          </RouterLink>
        </div>
      </EmptyState>

      <EmptyState
        v-else-if="filtered.length === 0"
        :title="t('common.no-result')"
        :description="t('management.no-match-hint')"
      >
        <button class="btn" @click="keyword = ''; activeType = null">
          {{ t('common.clear') }}
        </button>
      </EmptyState>

      <div v-else class="extension-list">
        <article
          v-for="meta in filtered"
          :key="meta.package"
          class="extension-row"
          @click="openSettings(meta)"
        >
          <div class="extension-icon">
            <SmartImage :src="meta.icon" :alt="meta.name" fit="contain" />
          </div>
          <div class="extension-copy">
            <div class="name-line">
              <span class="extension-name">{{ meta.name }}</span>
              <span v-if="meta.nsfw" class="nsfw-badge">18+</span>
              <span v-if="runtimeError(meta)" class="error-badge" :title="runtimeError(meta)">
                <AlertCircle :size="13" />
              </span>
            </div>
            <p class="extension-description">
              {{ meta.description || meta.package }}
            </p>
            <div class="extension-meta">
              <span class="chip chip-outline">{{ extensionTypeLabel(meta.type) }}</span>
              <span v-if="meta.author">{{ meta.author }}</span>
              <span>{{ meta.version }}</span>
              <span v-if="meta.lang">{{ meta.lang }}</span>
            </div>
          </div>
          <div class="extension-actions" @click.stop>
            <button
              class="btn btn-icon"
              :title="t('extension.edit-code')"
              @click="openCode(meta)"
            >
              <Code2 :size="15" />
            </button>
            <button
              v-if="meta.webSite"
              class="btn btn-icon"
              :title="t('management.open-site')"
              @click="openSite(meta)"
            >
              <Globe2 :size="15" />
            </button>
            <button
              class="btn btn-icon"
              :title="t('common.settings')"
              @click="openSettings(meta)"
            >
              <Settings2 :size="15" />
            </button>
            <button
              class="btn btn-icon btn-danger"
              :title="t('common.uninstall')"
              :disabled="removing === meta.package"
              @click="removeExtension(meta)"
            >
              <LoaderCircle v-if="removing === meta.package" :size="15" class="spin" />
              <Trash2 v-else :size="15" />
            </button>
          </div>
        </article>
      </div>
    </div>

    <AppModal
      :open="importOpen"
      :title="t('extension.import.title')"
      width="560px"
      :close-on-overlay="!importBusy"
      @close="closeImport"
    >
      <div class="import-body">
        <label class="field-label" for="extension-url">
          {{ t('extension.import.url-label') }}
        </label>
        <div class="url-row">
          <input
            id="extension-url"
            v-model="importUrl"
            class="input"
            type="url"
            placeholder="https://example.com/extension.js"
            @keydown.enter="importByUrl"
          />
          <button
            class="btn btn-primary"
            :disabled="!importUrl.trim() || Boolean(importBusy)"
            @click="importByUrl"
          >
            <LoaderCircle v-if="importBusy === 'url'" :size="15" class="spin" />
            {{ t('extension.import.import-by-url') }}
          </button>
        </div>

        <p class="import-tips">{{ t('extension.import.tips') }}</p>

        <div class="import-actions">
          <button class="btn" :disabled="Boolean(importBusy)" @click="importByFile">
            <LoaderCircle v-if="importBusy === 'file'" :size="15" class="spin" />
            <Upload v-else :size="15" />
            {{ t('extension.import.import-by-local') }}
          </button>
          <button class="btn btn-ghost" :disabled="Boolean(importBusy)" @click="openFolder">
            <FolderOpen :size="15" />
            {{ t('extension.import.extension-dir') }}
          </button>
        </div>

        <div v-if="extensionDir" class="folder-path" :title="extensionDir">
          {{ extensionDir }}
        </div>

        <p v-if="importError" class="error-banner import-error">{{ importError }}</p>
      </div>
      <template #footer>
        <div class="spacer" />
        <button class="btn" :disabled="Boolean(importBusy)" @click="closeImport">
          {{ t('common.close') }}
        </button>
      </template>
    </AppModal>

    <AppModal
      :open="errorsOpen"
      :title="t('extension.error-dialog')"
      width="720px"
      @close="errorsOpen = false"
    >
      <div class="errors-body">
        <div
          v-for="item in errorList"
          :key="`${item.kind}:${item.key}`"
          class="error-item"
        >
          <div class="error-item-head">
            <span class="chip" :class="item.kind === 'runtime' ? 'chip-danger' : ''">
              {{ item.kind === 'runtime' ? t('management.runtime-error') : t('management.parse-error') }}
            </span>
            <span class="error-key">{{ item.key }}</span>
          </div>
          <pre class="error-message">{{ item.message }}</pre>
        </div>
        <p v-if="errorList.length === 0" class="muted">{{ t('common.no-data') }}</p>
      </div>
      <template #footer>
        <button class="btn" @click="refresh">{{ t('management.refresh') }}</button>
        <button class="btn btn-primary" @click="errorsOpen = false">
          {{ t('common.confirm') }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.title-wrap {
  min-width: 0;
}

.title-wrap h1 {
  line-height: 1.2;
}

.title-wrap .page-subtitle {
  margin-top: 3px;
}

.error-button {
  color: var(--danger);
}

.extension-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.type-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.type-tab {
  height: 31px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 99px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 550;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.type-tab:hover {
  background: var(--surface-2);
  color: var(--text);
}

.type-tab.active {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--accent);
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: min(320px, 38vw);
}

.search-box > svg {
  position: absolute;
  left: 11px;
  color: var(--muted);
  pointer-events: none;
}

.search-box .input {
  height: 34px;
  padding-left: 32px;
  padding-right: 30px;
  border-radius: 99px;
}

.search-box input::-webkit-search-cancel-button {
  display: none;
}

.clear-search {
  position: absolute;
  right: 7px;
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  border: none;
  border-radius: 50%;
  background: var(--surface-3);
  color: var(--muted);
}

.load-error {
  align-items: center;
  margin-bottom: 16px;
}

.load-error span {
  flex: 1;
}

.extension-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.extension-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 15px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.extension-row:hover {
  border-color: var(--border-strong);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-sm);
}

.extension-icon {
  flex: 0 0 46px;
  width: 46px;
  height: 46px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--surface-2);
}

.extension-copy {
  min-width: 0;
  flex: 1;
}

.name-line {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.extension-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 650;
}

.nsfw-badge {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 99px;
  background: rgba(217, 74, 74, 0.12);
  color: var(--danger);
  font-size: 9.5px;
  font-weight: 750;
}

.error-badge {
  display: inline-flex;
  color: var(--warning);
}

.extension-description {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 12px;
}

.extension-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
  color: var(--muted);
  font-size: 11px;
}

.extension-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
}

.extension-actions .btn {
  border-color: transparent;
  background: transparent;
  color: var(--muted);
}

.extension-actions .btn:hover {
  background: var(--surface-2);
  color: var(--text);
}

.extension-actions .btn-danger:hover {
  background: rgba(217, 74, 74, 0.1);
  color: var(--danger);
}

.import-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field-label {
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 650;
}

.url-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.url-row .input {
  flex: 1;
}

.import-tips {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.import-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.folder-path {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-error {
  margin-top: 4px;
  white-space: pre-wrap;
}

.errors-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 60vh;
  overflow-y: auto;
}

.error-item {
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.error-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.error-key {
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 600;
}

.chip-danger {
  background: rgba(217, 74, 74, 0.12);
  color: var(--danger);
}

.error-message {
  margin: 0;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .extension-actions .btn:first-child {
    display: none;
  }

  .extension-description {
    max-width: 52vw;
  }

  .search-box {
    width: 100%;
  }
}
</style>
