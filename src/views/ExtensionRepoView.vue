<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  AlertCircle,
  ArrowLeft,
  Download,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings2,
  Store,
  Trash2,
  X,
} from 'lucide-vue-next';
import EmptyState from '../components/EmptyState.vue';
import SmartImage from '../components/SmartImage.vue';
import {
  extensionTypes,
  extensionTypeLabel,
  normalizeExtensionType,
} from '../lib/labels';
import { resolveUrl } from '../lib/util';
import { useExtensionsStore } from '../stores/extensions';
import { useSettingsStore } from '../stores/settings';
import { useUiStore } from '../stores/ui';
import type { ExtensionType, RepoExtension } from '../types/models';

const router = useRouter();
const { t } = useI18n();
const extensions = useExtensionsStore();
const settings = useSettingsStore();
const ui = useUiStore();

const keyword = ref('');
const activeType = ref<ExtensionType | null>(null);
const busyPackage = ref('');
const busyAction = ref<'' | 'install' | 'uninstall'>('');

const tabs = computed(() => [
  { type: null as ExtensionType | null, label: t('search.all') },
  ...extensionTypes.map((type) => ({
    type: type as ExtensionType | null,
    label: extensionTypeLabel(type),
  })),
]);

const repoBase = computed(() =>
  settings.repoUrl ? `${settings.repoUrl.replace(/\/+$/, '')}/` : '',
);

const items = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  return extensions.repoItems.filter((item) => {
    const type = normalizeExtensionType(item.type);
    if (activeType.value && type !== activeType.value) return false;
    if (!query) return true;
    return (
      item.name.toLowerCase().includes(query) ||
      item.package.toLowerCase().includes(query) ||
      (item.author ?? '').toLowerCase().includes(query)
    );
  });
});

const initialLoading = computed(
  () => extensions.repoLoading && extensions.repoItems.length === 0,
);

function iconUrl(item: RepoExtension): string {
  return item.icon ? resolveUrl(item.icon, repoBase.value) : '';
}

function isInstalled(item: RepoExtension): boolean {
  return Boolean(extensions.getMeta(item.package));
}

function installedVersion(item: RepoExtension): string {
  return extensions.getMeta(item.package)?.version ?? '';
}

function canUpdate(item: RepoExtension): boolean {
  return extensions.hasUpdate(item);
}

function isNsfw(item: RepoExtension): boolean {
  return item.nsfw === true || String(item.nsfw) === 'true';
}

async function refresh(): Promise<void> {
  await extensions.loadRepo(true);
}

function install(item: RepoExtension): void {
  void runInstall(item);
}

async function runInstall(item: RepoExtension): Promise<void> {
  if (busyPackage.value) return;
  const update = canUpdate(item);
  busyPackage.value = item.package;
  busyAction.value = 'install';
  try {
    await extensions.installFromRepo(item);
    ui.notify(
      update
        ? t('repo.updated-name', { name: item.name })
        : t('repo.installed-name', { name: item.name }),
      'success',
    );
  } catch (error) {
    ui.notifyError(error);
  } finally {
    busyPackage.value = '';
    busyAction.value = '';
  }
}

async function uninstall(item: RepoExtension): Promise<void> {
  if (busyPackage.value) return;
  const confirmed = await ui.confirm({
    title: t('common.uninstall'),
    message: t('repo.uninstall-confirm', { name: item.name }),
    confirmText: t('common.uninstall'),
    destructive: true,
  });
  if (!confirmed) return;
  busyPackage.value = item.package;
  busyAction.value = 'uninstall';
  try {
    await extensions.uninstall(item.package);
    ui.notify(t('management.uninstalled', { name: item.name }), 'success');
  } catch (error) {
    ui.notifyError(error);
  } finally {
    busyPackage.value = '';
    busyAction.value = '';
  }
}

function openSettings(item: RepoExtension): void {
  void router.push({
    name: 'extension-settings',
    params: { package: item.package },
  });
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="page-scroll">
    <div class="page">
      <header class="page-header">
        <button class="btn btn-icon" :title="t('common.previous')" @click="router.back()">
          <ArrowLeft :size="16" />
        </button>
        <div class="title-wrap">
          <h1>{{ t('common.extension-repo') }}</h1>
          <div class="page-subtitle repo-url" :title="settings.repoUrl">
            <Store :size="12" />
            <span>{{ settings.repoUrl || t('common.unset') }}</span>
          </div>
        </div>
        <div class="spacer" />
        <button
          class="btn btn-icon"
          :title="t('repo.refresh')"
          :disabled="extensions.repoLoading"
          @click="refresh"
        >
          <RefreshCw :size="16" :class="{ spin: extensions.repoLoading }" />
        </button>
        <RouterLink to="/settings" class="btn btn-icon" :title="t('common.settings')">
          <Settings2 :size="16" />
        </RouterLink>
      </header>

      <div class="repo-toolbar">
        <div class="type-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.label"
            class="type-tab"
            :class="{ active: activeType === tab.type }"
            @click="activeType = tab.type"
          >
            {{ tab.label }}
            <span v-if="tab.type" class="tab-count">
              {{
                extensions.repoItems.filter(
                  (item) => normalizeExtensionType(item.type) === tab.type,
                ).length
              }}
            </span>
          </button>
        </div>
        <div class="spacer" />
        <div class="search-box">
          <Search :size="15" />
          <input
            v-model="keyword"
            class="input"
            type="search"
            :placeholder="t('repo.search')"
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

      <div
        v-if="extensions.repoError && extensions.repoItems.length"
        class="error-banner inline-error"
      >
        <AlertCircle :size="16" />
        <span>{{ extensions.repoError }}</span>
        <button class="btn btn-sm" @click="refresh">{{ t('common.retry') }}</button>
      </div>

      <div v-if="initialLoading" class="loading-center">
        <div class="spinner lg" />
      </div>

      <EmptyState
        v-else-if="extensions.repoError && extensions.repoItems.length === 0"
        :icon="AlertCircle"
        :title="t('extension-repo.error')"
        :description="extensions.repoError || t('extension-repo.error-tips')"
      >
        <div class="row">
          <RouterLink to="/settings" class="btn">
            <Settings2 :size="15" />
            {{ t('common.settings') }}
          </RouterLink>
          <button class="btn btn-primary" @click="refresh">
            <RefreshCw :size="15" />
            {{ t('common.retry') }}
          </button>
        </div>
      </EmptyState>

      <EmptyState
        v-else-if="extensions.repoItems.length === 0"
        :icon="Store"
        :title="t('extension-repo.empty')"
        :description="t('repo.empty-hint')"
      >
        <button class="btn" @click="refresh">
          <RefreshCw :size="15" />
          {{ t('repo.refresh') }}
        </button>
      </EmptyState>

      <EmptyState
        v-else-if="items.length === 0"
        :title="t('common.no-result')"
        :description="t('repo.no-match-hint')"
      >
        <button class="btn" @click="keyword = ''; activeType = null">
          {{ t('common.clear') }}
        </button>
      </EmptyState>

      <div v-else class="repo-grid">
        <article v-for="item in items" :key="item.package" class="repo-card">
          <div class="repo-card-top">
            <div class="repo-icon">
              <SmartImage
                :src="iconUrl(item)"
                :alt="item.name"
                fit="contain"
                :base="repoBase"
              />
            </div>
            <div class="repo-heading">
              <div class="repo-name-line">
                <h3 :title="item.name">{{ item.name }}</h3>
                <span v-if="isNsfw(item)" class="nsfw-badge">18+</span>
              </div>
              <span class="repo-package" :title="item.package">{{ item.package }}</span>
            </div>
            <button
              v-if="isInstalled(item)"
              class="btn btn-icon installed-settings"
              :title="t('common.settings')"
              @click="openSettings(item)"
            >
              <Settings2 :size="14" />
            </button>
          </div>

          <p v-if="item.description" class="repo-description">{{ item.description }}</p>

          <div class="repo-meta">
            <span class="chip chip-outline">
              {{ extensionTypeLabel(normalizeExtensionType(item.type) ?? 'bangumi') }}
            </span>
            <span v-if="item.author">{{ item.author }}</span>
            <span v-if="item.lang">{{ item.lang }}</span>
            <span class="repo-version">{{ item.version }}</span>
          </div>

          <div class="repo-footer">
            <span v-if="isInstalled(item)" class="installed-label">
              {{ t('repo.installed') }}
              <template v-if="canUpdate(item)">
                · {{ installedVersion(item) }}
              </template>
            </span>
            <span v-else class="muted small">{{ t('repo.not-installed') }}</span>
            <div class="spacer" />
            <template v-if="busyPackage === item.package">
              <span class="row muted small busy-label">
                <LoaderCircle :size="14" class="spin" />
                {{ busyAction === 'uninstall' ? t('common.uninstall') : t('repo.installing') }}
              </span>
            </template>
            <template v-else-if="isInstalled(item)">
              <button
                v-if="canUpdate(item)"
                class="btn btn-sm btn-primary"
                :disabled="Boolean(busyPackage)"
                @click="install(item)"
              >
                <Download :size="13" />
                {{ t('extension-repo.upgrade') }}
              </button>
              <button
                class="btn btn-sm btn-ghost btn-danger"
                :disabled="Boolean(busyPackage)"
                @click="uninstall(item)"
              >
                <Trash2 :size="13" />
                {{ t('common.uninstall') }}
              </button>
            </template>
            <button
              v-else
              class="btn btn-sm btn-primary"
              :disabled="Boolean(busyPackage)"
              @click="install(item)"
            >
              <Download :size="13" />
              {{ t('common.install') }}
            </button>
          </div>
        </article>
      </div>

      <div class="repo-footnote">
        <span>{{ t('repo.footnote', { count: extensions.repoItems.length }) }}</span>
        <RouterLink to="/extensions" class="more-link">
          {{ t('common.extension') }}
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.title-wrap {
  min-width: 0;
}

.repo-url {
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: 48vw;
}

.repo-url span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-toolbar {
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

.tab-count {
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  display: inline-grid;
  place-items: center;
  border-radius: 99px;
  background: var(--surface-3);
  color: var(--muted);
  font-size: 9.5px;
  font-weight: 700;
}

.type-tab.active .tab-count {
  background: var(--accent);
  color: var(--accent-contrast);
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

.inline-error {
  align-items: center;
  margin-bottom: 16px;
}

.inline-error span {
  flex: 1;
}

.repo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 12px;
}

.repo-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.repo-card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.repo-card-top {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.repo-icon {
  flex: 0 0 45px;
  width: 45px;
  height: 45px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--surface-2);
}

.repo-heading {
  min-width: 0;
  flex: 1;
  padding-top: 1px;
}

.repo-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.repo-name-line h3 {
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

.repo-package {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.installed-settings {
  width: 28px;
  height: 28px;
  border-color: transparent;
  background: transparent;
  color: var(--muted);
}

.repo-description {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  min-height: 36px;
}

.repo-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  color: var(--muted);
  font-size: 11px;
}

.repo-version {
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.repo-footer {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  padding-top: 9px;
  border-top: 1px solid var(--border);
}

.installed-label {
  color: var(--success);
  font-size: 11.5px;
  font-weight: 600;
}

.busy-label {
  height: 28px;
}

.repo-footnote {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20px;
  color: var(--muted);
  font-size: 11px;
}

.more-link {
  color: var(--muted);
  font-weight: 550;
}

.more-link:hover {
  color: var(--accent);
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 780px) {
  .search-box {
    width: 100%;
  }

  .repo-grid {
    grid-template-columns: 1fr;
  }
}
</style>
