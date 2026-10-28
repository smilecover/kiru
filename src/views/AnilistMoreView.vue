<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  AlertCircle,
  ArrowLeft,
  RefreshCw,
  Search,
  Star,
} from 'lucide-vue-next';
import EmptyState from '../components/EmptyState.vue';
import SmartImage from '../components/SmartImage.vue';
import { getAnilistCollection, anilistLoggedIn } from '../lib/anilist';
import {
  anilistStatuses,
  anilistStatusLabel,
  anilistTypeLabel,
  normalizeAnilistType,
} from '../lib/labels';
import { errorMessage } from '../lib/tauri';
import { pickTitle } from '../lib/util';
import { useUiStore } from '../stores/ui';
import type {
  AnilistCollection,
  AnilistCollectionEntry,
  AnilistListStatus,
} from '../types/models';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const ui = useUiStore();

const type = computed(() => normalizeAnilistType(route.query.type));
const collection = ref<AnilistCollection>({});
const activeStatus = ref<AnilistListStatus>('CURRENT');
const loading = ref(false);
const error = ref('');
const notLoggedIn = computed(() => !anilistLoggedIn());

const tabs = computed(() =>
  anilistStatuses.map((status) => ({
    status,
    label: anilistStatusLabel(status, type.value),
    count: collection.value[status]?.length ?? 0,
  })),
);

const entries = computed<AnilistCollectionEntry[]>(
  () => collection.value[activeStatus.value] ?? [],
);

const statusLabel = computed(() =>
  anilistStatusLabel(activeStatus.value, type.value),
);

function titleOf(entry: AnilistCollectionEntry): string {
  return pickTitle(entry.media.title) || `#${entry.media.id}`;
}

function totalOf(entry: AnilistCollectionEntry): number {
  return entry.media.episodes ?? entry.media.chapters ?? 0;
}

function progressPercent(entry: AnilistCollectionEntry): number {
  const total = totalOf(entry);
  if (!total) return 0;
  return Math.min(100, Math.round((entry.progress / total) * 100));
}

function searchTitle(entry: AnilistCollectionEntry): void {
  const title = titleOf(entry).trim();
  if (!title) return;
  void router.push({ name: 'search', query: { q: title } });
}

async function load(): Promise<void> {
  if (notLoggedIn.value) return;
  loading.value = true;
  error.value = '';
  try {
    collection.value = await getAnilistCollection(type.value);
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
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
          <h1>{{ t('anilist.more-title', { type: anilistTypeLabel(type) }) }}</h1>
          <div class="page-subtitle">{{ t('anilist.more-subtitle') }}</div>
        </div>
        <div class="spacer" />
        <div class="type-switch">
          <RouterLink
            :to="{ name: 'anilist-more', query: { type: 'anime' } }"
            class="type-option"
            :class="{ active: type === 'anime' }"
          >
            {{ t('common.anime') }}
          </RouterLink>
          <RouterLink
            :to="{ name: 'anilist-more', query: { type: 'manga' } }"
            class="type-option"
            :class="{ active: type === 'manga' }"
          >
            {{ t('common.manga') }}
          </RouterLink>
        </div>
        <button
          class="btn btn-icon"
          :title="t('common.retry')"
          :disabled="loading || notLoggedIn"
          @click="load"
        >
          <RefreshCw :size="16" :class="{ spin: loading }" />
        </button>
      </header>

      <EmptyState
        v-if="notLoggedIn"
        :title="t('anilist.login-title')"
        :description="t('anilist.login-hint-2')"
      >
        <RouterLink to="/settings/anilist" class="btn btn-primary">
          {{ t('common.login') }}
        </RouterLink>
      </EmptyState>

      <template v-else>
        <div class="status-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.status"
            class="status-tab"
            :class="{ active: activeStatus === tab.status }"
            @click="activeStatus = tab.status"
          >
            {{ tab.label }}
            <span class="tab-count">{{ tab.count }}</span>
          </button>
        </div>

        <div v-if="error" class="error-banner list-error">
          <AlertCircle :size="16" />
          <span>{{ error }}</span>
          <button class="btn btn-sm" @click="load">{{ t('common.retry') }}</button>
        </div>

        <div v-if="loading" class="loading-center list-loading">
          <div class="spinner lg" />
        </div>

        <EmptyState
          v-else-if="entries.length === 0"
          :title="t('anilist.empty-status', { status: statusLabel })"
          :description="t('anilist.empty-status-hint')"
        >
          <RouterLink to="/settings/anilist" class="btn btn-sm">
            {{ t('anilist.title') }}
          </RouterLink>
        </EmptyState>

        <div v-else class="anilist-grid">
          <button
            v-for="entry in entries"
            :key="entry.media.id"
            class="list-card"
            :title="t('anilist.search-title', { title: titleOf(entry) })"
            @click="searchTitle(entry)"
          >
            <div class="list-cover">
              <SmartImage :src="entry.media.coverImage?.large" :alt="titleOf(entry)" />
              <span v-if="entry.score > 0" class="score-badge">
                <Star :size="10" />
                {{ entry.score }}
              </span>
              <span class="search-hint">
                <Search :size="12" />
                {{ t('common.search') }}
              </span>
            </div>
            <div class="list-copy">
              <div class="list-title">{{ titleOf(entry) }}</div>
              <div class="list-progress">
                <span>
                  {{ t('anilist.progress', {
                    progress: entry.progress,
                    total: totalOf(entry) || '?',
                  }) }}
                </span>
                <span v-if="totalOf(entry)" class="muted">{{ progressPercent(entry) }}%</span>
              </div>
              <div class="progress-track">
                <span :style="{ width: `${progressPercent(entry)}%` }" />
              </div>
            </div>
          </button>
        </div>

        <div v-if="!loading && entries.length" class="list-footnote">
          {{ t('anilist.list-count', { count: entries.length, status: statusLabel }) }}
          <button class="inline-link" @click="ui.notify(t('anilist.search-hint'), 'info', 4200)">
            {{ t('anilist.search-hint-title') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.title-wrap {
  min-width: 0;
}

.type-switch {
  display: flex;
  padding: 3px;
  gap: 2px;
  border-radius: 9px;
  background: var(--surface-2);
}

.type-option {
  height: 28px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  border-radius: 7px;
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 550;
}

.type-option:hover {
  color: var(--text);
}

.type-option.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.status-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 18px;
  overflow-x: auto;
  scrollbar-width: none;
}

.status-tabs::-webkit-scrollbar {
  display: none;
}

.status-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  height: 31px;
  padding: 0 13px;
  border: 1px solid var(--border);
  border-radius: 99px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 550;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.status-tab:hover {
  background: var(--surface-2);
  color: var(--text);
}

.status-tab.active {
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

.status-tab.active .tab-count {
  background: var(--accent);
  color: var(--accent-contrast);
}

.list-error {
  align-items: center;
  margin-bottom: 16px;
}

.list-error span {
  flex: 1;
  overflow-wrap: anywhere;
}

.list-loading {
  min-height: 220px;
}

.anilist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(154px, 1fr));
  gap: 12px;
}

.list-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface);
  text-align: left;
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.list-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow);
}

.list-cover {
  position: relative;
  aspect-ratio: 2 / 3;
  background: var(--surface-2);
}

.score-badge {
  position: absolute;
  top: 7px;
  right: 7px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 7px;
  border-radius: 99px;
  background: rgba(10, 12, 16, 0.72);
  color: #ffd166;
  font-size: 10px;
  font-weight: 700;
  backdrop-filter: blur(6px);
}

.search-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  background: rgba(8, 10, 14, 0.5);
  color: #fff;
  font-size: 11.5px;
  font-weight: 600;
  opacity: 0;
  transition: opacity 0.16s ease;
  backdrop-filter: blur(1px);
}

.list-card:hover .search-hint {
  opacity: 1;
}

.list-copy {
  padding: 9px 10px 10px;
}

.list-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 32px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
}

.list-progress {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-top: 5px;
  color: var(--muted);
  font-size: 10px;
}

.progress-track {
  height: 3px;
  margin-top: 5px;
  border-radius: 99px;
  overflow: hidden;
  background: var(--surface-3);
}

.progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #3db4f2;
}

.list-footnote {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 20px;
  color: var(--muted);
  font-size: 11px;
}

.inline-link {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.inline-link:hover {
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

@media (max-width: 640px) {
  .type-switch {
    order: 5;
    margin-left: 0;
  }

  .anilist-grid {
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  }
}
</style>
