<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-vue-next';
import ComicReader from './ComicReader.vue';
import NovelReader from './NovelReader.vue';
import VideoWatch from './VideoWatch.vue';
import { autoTrackProgress } from '../../lib/anilist';
import { normalizeExtensionType } from '../../lib/labels';
import { errorMessage } from '../../lib/tauri';
import { clamp } from '../../lib/util';
import { useExtensionsStore } from '../../stores/extensions';
import { useLibraryStore } from '../../stores/library';
import { useSettingsStore } from '../../stores/settings';
import type {
  ExtensionDetail,
  ExtensionEpisode,
  ExtensionEpisodeGroup,
  ExtensionType,
} from '../../types/models';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const extensions = useExtensionsStore();
const library = useLibraryStore();
const settings = useSettingsStore();

const packageName = String(route.query.package ?? '').trim();
const detailUrl = String(route.query.url ?? '').trim();
const queryType = normalizeExtensionType(route.query.type);

const detail = ref<ExtensionDetail | null>(null);
const type = ref<ExtensionType>(queryType ?? 'bangumi');
const groupIndex = ref(0);
const episodeIndex = ref(0);
const initialProgress = ref(0);
const loading = ref(true);
const error = ref('');
const extensionMissing = ref(false);
let initialized = false;
let trackingStarted = false;

const invalidParams = computed(() => !packageName || !detailUrl);
const meta = computed(() => extensions.getMeta(packageName));
const groups = computed<ExtensionEpisodeGroup[]>(() => detail.value?.episodes ?? []);
const currentGroup = computed<ExtensionEpisodeGroup | null>(
  () => groups.value[groupIndex.value] ?? null,
);
const episodes = computed<ExtensionEpisode[]>(() => currentGroup.value?.urls ?? []);
const currentEpisode = computed<ExtensionEpisode | null>(
  () => episodes.value[episodeIndex.value] ?? null,
);
const episodeUrl = computed(() => currentEpisode.value?.url ?? '');
const displayTitle = computed(
  () => detail.value?.title || meta.value?.name || packageName,
);
const episodeTitle = computed(() =>
  episodeLabel(currentEpisode.value, episodeIndex.value),
);
const hasPrevious = computed(() => episodeIndex.value > 0);
const hasNext = computed(() => episodeIndex.value < episodes.value.length - 1);
const readerReady = computed(
  () => Boolean(detail.value && currentEpisode.value?.url),
);
const noEpisodesLabel = computed(() =>
  type.value === 'bangumi' ? t('video.no-episodes') : t('reader.no-chapters'),
);

function episodeLabel(episode: ExtensionEpisode | null, index: number): string {
  const name = episode?.name?.trim();
  if (name) return name;
  return type.value === 'bangumi'
    ? t('common.episode-number', { index: index + 1 })
    : t('common.chapter-number', { index: index + 1 });
}

function indexFromQuery(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveTarget(nextDetail: ExtensionDetail): void {
  const list = nextDetail.episodes ?? [];
  if (!list.length) {
    throw new Error(noEpisodesLabel.value);
  }
  let nextGroup = indexFromQuery(route.query.group, 0);
  if (!list[nextGroup]) nextGroup = 0;
  if (!list[nextGroup].urls.length) {
    const fallback = list.findIndex((group) => group.urls.length > 0);
    nextGroup = fallback >= 0 ? fallback : 0;
  }
  const targetGroup = list[nextGroup];
  if (!targetGroup || !targetGroup.urls.length) {
    throw new Error(noEpisodesLabel.value);
  }
  let nextEpisode = indexFromQuery(route.query.episode, 0);
  nextEpisode = clamp(nextEpisode, 0, targetGroup.urls.length - 1);
  groupIndex.value = nextGroup;
  episodeIndex.value = nextEpisode;
}

function restoreHistory(): void {
  const saved = library.findHistory(packageName, detailUrl);
  if (
    saved &&
    saved.episodeGroupId === groupIndex.value &&
    saved.episodeId === episodeIndex.value
  ) {
    const progress = Number(saved.progress);
    initialProgress.value = Number.isFinite(progress) ? Math.max(0, progress) : 0;
  } else {
    initialProgress.value = 0;
  }
}

async function initialize(): Promise<void> {
  initialized = true;
  loading.value = true;
  error.value = '';
  extensionMissing.value = false;
  if (invalidParams.value) {
    loading.value = false;
    return;
  }

  try {
    if (!extensions.loaded) await extensions.loadExtensions();
    const extension = extensions.getMeta(packageName);
    if (!extension) {
      extensionMissing.value = true;
      throw new Error(t('common.extension-missing', { package: packageName }));
    }
    type.value = queryType ?? extension.type;

    let nextDetail = library.getCachedDetail(packageName, detailUrl);
    if (!nextDetail?.episodes?.length) {
      const runtime = await extensions.ensureRuntime(packageName);
      nextDetail = await runtime.detail(detailUrl);
      library.putCachedDetail(packageName, detailUrl, nextDetail);
    }
    detail.value = nextDetail;
    resolveTarget(nextDetail);
    if (type.value === 'fikushon' && !episodes.value.length) {
      throw new Error(t('reader.no-chapters'));
    }
    restoreHistory();
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

function retry(): void {
  void initialize();
}

function onProgress(payload: { progress: number; total: number }): void {
  if (!detail.value || !currentEpisode.value) return;
  const total = Math.round(Number(payload.total) || 0);
  const progress = Math.round(Number(payload.progress) || 0);
  if (total <= 0) return;
  library.putHistory({
    package: packageName,
    url: detailUrl,
    type: type.value,
    cover: detail.value.cover,
    episodeGroupId: groupIndex.value,
    episodeId: episodeIndex.value,
    title: displayTitle.value,
    episodeTitle: episodeTitle.value,
    progress: String(Math.max(0, progress)),
    totalProgress: String(total),
  });
}

function openEpisode(index: number): void {
  if (!detail.value || !episodes.value.length) return;
  const target = clamp(Math.round(index), 0, episodes.value.length - 1);
  if (target === episodeIndex.value) return;
  void router.replace({
    name: 'watch',
    query: {
      package: packageName,
      url: detailUrl,
      type: type.value,
      group: String(groupIndex.value),
      episode: String(target),
    },
  });
}

function goPrevious(): void {
  if (hasPrevious.value) openEpisode(episodeIndex.value - 1);
}

function goNext(): void {
  if (hasNext.value) openEpisode(episodeIndex.value + 1);
}

function detailRoute() {
  return {
    name: 'detail' as const,
    query: {
      package: packageName,
      url: detailUrl,
      type: type.value,
    },
  };
}

function goBack(): void {
  void maybeAutoTrack();
  if (!detailUrl) {
    void router.replace({ name: 'home' });
    return;
  }
  const state = window.history.state as { back?: unknown } | null;
  if (state && typeof state.back === 'string' && state.back) {
    router.back();
  } else {
    void router.replace(detailRoute());
  }
}

async function maybeAutoTrack(): Promise<void> {
  if (trackingStarted) return;
  if (type.value !== 'bangumi' && type.value !== 'manga') return;
  if (!settings.autoTracking || !settings.anilistToken) return;
  const record = library.getDetailRecord(packageName, detailUrl);
  const aniListID = String(record?.aniListID ?? '');
  if (!aniListID) return;
  trackingStarted = true;
  try {
    await autoTrackProgress(aniListID, episodeIndex.value + 1);
  } catch {
    // Progress tracking must never interfere with closing the player.
  }
}

onMounted(() => {
  if (initialized) return;
  void initialize();
});

onBeforeUnmount(() => {
  void maybeAutoTrack();
});
</script>

<template>
  <div class="watch-view">
    <div v-if="invalidParams" class="watch-state">
      <div class="state-card">
        <AlertTriangle :size="30" class="state-icon" />
        <h2>{{ t('common.error') }}</h2>
        <p>{{ t('detail.missing-params') }}</p>
        <div class="state-actions">
          <button class="btn btn-primary" @click="router.replace({ name: 'home' })">
            <ArrowLeft :size="14" />
            {{ t('common.home') }}
          </button>
        </div>
      </div>
    </div>

    <div v-else-if="loading" class="watch-state">
      <div class="spinner lg" />
    </div>

    <div v-else-if="error || !readerReady" class="watch-state">
      <div class="state-card">
        <AlertTriangle :size="30" class="state-icon" />
        <h2>{{ extensionMissing ? t('common.extension-missing', { package: packageName }) : t('common.error') }}</h2>
        <p class="state-error">{{ error || noEpisodesLabel }}</p>
        <div class="state-actions">
          <button class="btn" @click="goBack">
            <ArrowLeft :size="14" />
            {{ t('common.close') }}
          </button>
          <button
            v-if="extensionMissing"
            class="btn"
            @click="router.push({ name: 'extensions' })"
          >
            {{ t('common.extension') }}
          </button>
          <button class="btn btn-primary" @click="retry">
            <RefreshCw :size="14" />
            {{ t('common.retry') }}
          </button>
        </div>
      </div>
    </div>

    <VideoWatch
      v-else-if="type === 'bangumi'"
      :package-name="packageName"
      :detail-title="displayTitle"
      :episode-title="episodeTitle"
      :episode-url="episodeUrl"
      :initial-progress="initialProgress"
      :episodes="episodes"
      :current-index="episodeIndex"
      :has-previous="hasPrevious"
      :has-next="hasNext"
      @exit="goBack"
      @previous="goPrevious"
      @next="goNext"
      @select-episode="openEpisode"
      @progress="onProgress"
    />

    <ComicReader
      v-else-if="type === 'manga'"
      :package-name="packageName"
      :detail-url="detailUrl"
      :detail-title="displayTitle"
      :episode-title="episodeTitle"
      :episode-url="episodeUrl"
      :initial-progress="initialProgress"
      :episodes="episodes"
      :current-index="episodeIndex"
      :has-previous="hasPrevious"
      :has-next="hasNext"
      @exit="goBack"
      @previous="goPrevious"
      @next="goNext"
      @select-episode="openEpisode"
      @progress="onProgress"
    />

    <NovelReader
      v-else
      :package-name="packageName"
      :detail-title="displayTitle"
      :episode-title="episodeTitle"
      :episode-url="episodeUrl"
      :initial-progress="initialProgress"
      :episodes="episodes"
      :current-index="episodeIndex"
      :has-previous="hasPrevious"
      :has-next="hasNext"
      @exit="goBack"
      @previous="goPrevious"
      @next="goNext"
      @select-episode="openEpisode"
      @progress="onProgress"
    />
  </div>
</template>

<style scoped>
.watch-view {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
}

.watch-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 32px;
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(100%, 620px);
  padding: 36px 30px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-md);
  text-align: center;
}

.state-icon {
  margin-bottom: 14px;
  color: var(--warning);
}

.state-card h2 {
  font-size: 18px;
  font-weight: 650;
}

.state-error {
  max-width: 100%;
  max-height: 200px;
  margin-top: 9px;
  overflow: auto;
  color: var(--muted);
  font-size: 12.5px;
  white-space: pre-wrap;
  word-break: break-word;
}

.state-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
}

</style>
