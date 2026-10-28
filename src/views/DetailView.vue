<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  AlertTriangle,
  ArrowDownUp,
  Bookmark,
  Globe,
  Heart,
  Images,
  LayoutGrid,
  List,
  Play,
  Settings2,
  Users,
} from 'lucide-vue-next';
import AnilistBindDialog from '../components/AnilistBindDialog.vue';
import AnilistTrackDialog from '../components/AnilistTrackDialog.vue';
import AppModal from '../components/AppModal.vue';
import EmptyState from '../components/EmptyState.vue';
import SmartImage from '../components/SmartImage.vue';
import TmdbBindDialog from '../components/TmdbBindDialog.vue';
import type { AnilistMediaSearchResult } from '../lib/anilist';
import {
  anilistTypeForExtension,
  extensionTypeLabel,
  normalizeExtensionType,
} from '../lib/labels';
import { SettingKey } from '../lib/defaults';
import { renderMarkdown } from '../lib/markdown';
import { tmdbImage } from '../lib/media';
import { resolveTorrentStream } from '../lib/playback';
import { call, errorMessage } from '../lib/tauri';
import { tmdbConfigured, tmdbDetail, tmdbDetailBySearch } from '../lib/tmdb';
import { historyProgress, resolveUrl } from '../lib/util';
import { useExtensionsStore } from '../stores/extensions';
import { useLibraryStore } from '../stores/library';
import { useSettingsStore } from '../stores/settings';
import { useUiStore } from '../stores/ui';
import type {
  AnilistType,
  BangumiSubtitle,
  ExtensionBangumiWatch,
  ExtensionDetail,
  ExtensionEpisode,
  ExtensionType,
  TmdbDetail,
} from '../types/models';

interface WatchTarget {
  groupIndex: number;
  episodeIndex: number;
  episode: ExtensionEpisode;
}

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const extensions = useExtensionsStore();
const library = useLibraryStore();
const settings = useSettingsStore();
const ui = useUiStore();

const packageName = String(route.query.package ?? '');
const detailUrl = String(route.query.url ?? '');
const invalidParams = computed(() => !packageName || !detailUrl);

const meta = computed(() => extensions.getMeta(packageName));
const type = computed<ExtensionType>(
  () => normalizeExtensionType(route.query.type) ?? meta.value?.type ?? 'bangumi',
);
const anilistType = computed<AnilistType | null>(() =>
  anilistTypeForExtension(type.value),
);
const bindType = computed<AnilistType>(() => anilistType.value ?? 'anime');

const record = computed(() =>
  packageName && detailUrl
    ? library.getDetailRecord(packageName, detailUrl)
    : undefined,
);

const initialHistory = library.findHistory(packageName, detailUrl);
const detail = ref<ExtensionDetail | null>(
  packageName && detailUrl
    ? library.getCachedDetail(packageName, detailUrl)
    : null,
);
const tmdb = ref<TmdbDetail | null>(null);
const loading = ref(!detail.value);
const refreshing = ref(false);
const error = ref('');
const extensionMissing = ref(false);
const tmdbError = ref('');
const selectedGroupIndex = ref(
  initialHistory && initialHistory.episodeGroupId >= 0
    ? initialHistory.episodeGroupId
    : 0,
);
const episodeView = ref<'grid' | 'list'>(settings.listMode);
const reverseEpisodes = ref(false);
let autoBindStarted = false;
let externalBusy = false;

const tmdbDialogOpen = ref(false);
const anilistBindOpen = ref(false);
const anilistTrackOpen = ref(false);
const anilistLoginOpen = ref(false);

const history = computed(() =>
  packageName && detailUrl ? library.findHistory(packageName, detailUrl) : undefined,
);
const favorite = computed(
  () => Boolean(packageName && detailUrl && library.isFavorite(packageName, detailUrl)),
);
const aniListID = computed(() => String(record.value?.aniListID ?? ''));
const loggedIn = computed(() => Boolean(settings.anilistToken));
const tmdbAvailable = computed(() => tmdbConfigured());

const displayTitle = computed(
  () => tmdb.value?.title || detail.value?.title || '',
);
const posterIsTmdb = computed(() => Boolean(tmdb.value?.cover));
const posterSrc = computed(() =>
  tmdb.value?.cover
    ? tmdbImage(tmdb.value.cover, 'w500')
    : detail.value?.cover ?? '',
);
const backdropSrc = computed(() =>
  tmdb.value?.backdrop ? tmdbImage(tmdb.value.backdrop, 'w1280') : '',
);
const overviewHtml = computed(() =>
  renderMarkdown(tmdb.value?.overview || detail.value?.desc),
);
const year = computed(() => (tmdb.value?.releaseDate ?? '').slice(0, 4));
const backdrops = computed(() =>
  (tmdb.value?.images ?? []).slice(0, 12).map((path) => tmdbImage(path, 'w780')),
);

const groups = computed(() => detail.value?.episodes ?? []);
const currentGroup = computed(() => groups.value[selectedGroupIndex.value] ?? null);
const currentEpisodes = computed(() => currentGroup.value?.urls ?? []);
const totalEpisodeCount = computed(() =>
  groups.value.reduce((count, group) => count + group.urls.length, 0),
);
const displayEpisodes = computed(() => {
  const entries = currentEpisodes.value.map((episode, index) => ({ episode, index }));
  return reverseEpisodes.value ? [...entries].reverse() : entries;
});

const continueTarget = computed<WatchTarget | null>(() => {
  const saved = history.value;
  if (!saved) return null;
  const group = groups.value[saved.episodeGroupId];
  const episode = group?.urls[saved.episodeId];
  if (!episode) return null;
  return {
    groupIndex: saved.episodeGroupId,
    episodeIndex: saved.episodeId,
    episode,
  };
});

function firstPlayableTarget(): WatchTarget | null {
  for (let groupIndex = 0; groupIndex < groups.value.length; groupIndex += 1) {
    const group = groups.value[groupIndex];
    if (group.urls.length === 0) continue;
    return { groupIndex, episodeIndex: 0, episode: group.urls[0] };
  }
  return null;
}

const primaryTarget = computed<WatchTarget | null>(
  () => continueTarget.value ?? firstPlayableTarget(),
);

const primaryLabel = computed(() => {
  if (continueTarget.value) {
    return t('detail.continue-watching', {
      episode: episodeDisplayName(
        continueTarget.value.episode,
        continueTarget.value.episodeIndex,
      ),
    });
  }
  return type.value === 'bangumi' ? t('video.watch-now') : t('reader.read-now');
});

const currentEpisodeProgress = computed(() => {
  const saved = history.value;
  if (!saved || saved.episodeGroupId !== selectedGroupIndex.value) return 0;
  return historyProgress(saved.progress, saved.totalProgress);
});

const tmdbFacts = computed(() => {
  const data = tmdb.value;
  if (!data) return [];
  return [
    { label: t('tmdb.status'), value: data.status },
    { label: t('tmdb.original-title'), value: data.originalTitle },
    { label: t('tmdb.release-date'), value: data.releaseDate },
    { label: t('tmdb.genres'), value: data.genres.join(', ') },
    {
      label: t('tmdb.runtime'),
      value: data.runtime > 0 ? `${data.runtime} min` : '',
    },
    { label: t('tmdb.languages'), value: data.languages.join(', ') },
  ].filter((fact) => fact.value);
});

function episodeDisplayName(episode: ExtensionEpisode, index: number): string {
  const name = episode.name?.trim();
  if (name && name !== episode.url) return name;
  return type.value === 'bangumi'
    ? t('common.episode-number', { index: index + 1 })
    : t('common.chapter-number', { index: index + 1 });
}

function isCurrentEpisode(index: number): boolean {
  const saved = history.value;
  return Boolean(
    saved &&
      saved.episodeGroupId === selectedGroupIndex.value &&
      saved.episodeId === index,
  );
}

function selectGroup(index: number): void {
  selectedGroupIndex.value = index;
}

function assignDetail(next: ExtensionDetail): void {
  detail.value = next;
  if (!next.episodes?.length) {
    selectedGroupIndex.value = 0;
  } else if (selectedGroupIndex.value >= next.episodes.length) {
    selectedGroupIndex.value = 0;
  }
}

async function refreshDetail(): Promise<void> {
  if (!packageName || !detailUrl) return;
  refreshing.value = true;
  try {
    const runtime = await extensions.ensureRuntime(packageName);
    const fresh = await runtime.detail(detailUrl);
    assignDetail(fresh);
    library.putCachedDetail(packageName, detailUrl, fresh);
    error.value = '';
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function maybeAutoBindTmdb(): Promise<void> {
  if (autoBindStarted) return;
  if (!detail.value?.title || !tmdbAvailable.value || record.value?.tmdbID) return;
  autoBindStarted = true;
  try {
    const found = await tmdbDetailBySearch(detail.value.title);
    if (!found || record.value?.tmdbID) return;
    library.putTmdbDetail(found.id, found, found.mediaType);
    if (detail.value) {
      library.putCachedDetail(packageName, detailUrl, detail.value, {
        tmdbID: found.id,
      });
    }
  } catch {
    // Automatic binding is best-effort; silence lookup failures.
  }
}

async function loadTmdb(): Promise<void> {
  const id = record.value?.tmdbID;
  if (!id) {
    tmdb.value = null;
    tmdbError.value = '';
    return;
  }
  const cached = library.getTmdbDetail(id);
  if (cached) {
    tmdb.value = cached;
    tmdbError.value = '';
    return;
  }
  const mediaType = library.getTmdbRecord(id)?.mediaType ?? 'tv';
  try {
    const data = await tmdbDetail(id, mediaType);
    tmdb.value = data;
    library.putTmdbDetail(id, data, data.mediaType);
    tmdbError.value = '';
  } catch (caught) {
    tmdbError.value = errorMessage(caught);
  }
}

async function initialize(): Promise<void> {
  loading.value = !detail.value;
  error.value = '';
  extensionMissing.value = false;
  if (invalidParams.value) {
    loading.value = false;
    return;
  }
  try {
    if (!extensions.loaded) await extensions.loadExtensions();
    if (!extensions.getMeta(packageName)) {
      extensionMissing.value = true;
      if (!detail.value) {
        error.value = t('common.extension-missing', { package: packageName });
      } else {
        void maybeAutoBindTmdb();
      }
      loading.value = false;
      return;
    }
    await refreshDetail();
    if (detail.value) void maybeAutoBindTmdb();
  } catch (caught) {
    error.value = errorMessage(caught);
    loading.value = false;
  }
}

function retry(): void {
  void initialize();
}

function externalPlayerName(player: string): string {
  switch (player) {
    case 'vlc':
      return 'VLC';
    case 'potplayer':
      return 'PotPlayer';
    case 'mpv':
      return 'mpv';
    default:
      return player;
  }
}

async function launchExternalPlayer(
  target: WatchTarget,
  player: string,
): Promise<void> {
  if (externalBusy) return;
  externalBusy = true;
  ui.notify(t('external-player-launching', { player: externalPlayerName(player) }));
  try {
    const runtime = await extensions.ensureRuntime(packageName);
    const watch = (await runtime.watch(target.episode.url)) as ExtensionBangumiWatch;
    let url = watch.url;
    let headers: Record<string, string> = { ...(watch.headers ?? {}) };
    let subtitles: BangumiSubtitle[] = [...(watch.subtitles ?? [])];

    if (watch.type === 'torrent') {
      const stream = await resolveTorrentStream(watch);
      url = stream.streamUrl;
      headers = {};
      subtitles = [
        ...subtitles,
        ...stream.subtitles.map((subtitle) => ({
          title: subtitle.title,
          url: subtitle.url,
        })),
      ];
    }

    await call('launch_external_player', {
      player,
      url,
      headers: Object.keys(headers).length ? headers : undefined,
      subtitles: subtitles.map((subtitle) => ({
        url: subtitle.url,
        title: subtitle.title,
      })),
    });
  } catch (caught) {
    ui.notifyError(caught);
  } finally {
    externalBusy = false;
  }
}

function openEpisode(groupIndex: number, episodeIndex: number): void {
  const target: WatchTarget | null = (() => {
    const episode = groups.value[groupIndex]?.urls[episodeIndex];
    return episode ? { groupIndex, episodeIndex, episode } : null;
  })();
  if (!target) return;

  if (type.value === 'bangumi') {
    const player = settings.get<string>(SettingKey.videoPlayer, 'built-in');
    if (player !== 'built-in') {
      void launchExternalPlayer(target, player);
      return;
    }
  }

  void router.push({
    name: 'watch',
    query: {
      package: packageName,
      url: detailUrl,
      type: type.value,
      group: String(groupIndex),
      episode: String(episodeIndex),
    },
  });
}

function openPrimary(): void {
  const target = primaryTarget.value;
  if (!target) return;
  openEpisode(target.groupIndex, target.episodeIndex);
}

function toggleFavorite(): void {
  if (!detail.value) return;
  const added = library.toggleFavorite({
    package: packageName,
    url: detailUrl,
    type: type.value,
    title: displayTitle.value || detail.value.title,
    cover: detail.value.cover,
  });
  ui.notify(
    added ? t('detail.favorite-added') : t('detail.favorite-removed'),
    'success',
  );
}

async function openWebview(): Promise<void> {
  if (!packageName || !detailUrl) return;
  const target = resolveUrl(detailUrl, meta.value?.webSite);
  if (!/^https?:/i.test(target)) {
    ui.notifyError(new Error(t('detail.webview-invalid')));
    return;
  }
  try {
    await call('open_site_window', {
      url: target,
      title: displayTitle.value || meta.value?.name || 'Kiru',
    });
    ui.notify(t('management.site-window-hint'), 'info', 4500);
  } catch (caught) {
    ui.notifyError(caught);
  }
}

function openTracking(): void {
  if (!anilistType.value) return;
  if (!loggedIn.value) {
    anilistLoginOpen.value = true;
    return;
  }
  if (!aniListID.value) {
    anilistBindOpen.value = true;
    return;
  }
  anilistTrackOpen.value = true;
}

async function loginAnilist(): Promise<void> {
  try {
    await call('open_anilist_login');
    anilistLoginOpen.value = false;
  } catch (caught) {
    ui.notifyError(caught);
  }
}

function onAnilistSelected(media: AnilistMediaSearchResult): void {
  if (!detail.value) return;
  library.putCachedDetail(packageName, detailUrl, detail.value, {
    aniListID: media.id,
  });
  anilistBindOpen.value = false;
  anilistTrackOpen.value = true;
}

function onAnilistSaved(): void {
  anilistTrackOpen.value = false;
  ui.notify(t('common.save-success'), 'success');
}

function onAnilistUnbind(): void {
  library.clearAnilistID(packageName, detailUrl);
  anilistTrackOpen.value = false;
  ui.notify(t('detail.binding-removed'), 'info');
}

function openTmdbDialog(): void {
  if (!tmdbAvailable.value) return;
  tmdbDialogOpen.value = true;
}

function onTmdbSelected(payload: {
  id: number;
  mediaType: string;
  detail: TmdbDetail;
}): void {
  library.putTmdbDetail(payload.id, payload.detail, payload.mediaType);
  if (detail.value) {
    library.putCachedDetail(packageName, detailUrl, detail.value, {
      tmdbID: payload.id,
    });
  }
  tmdb.value = payload.detail;
  tmdbError.value = '';
  tmdbDialogOpen.value = false;
  ui.notify(t('detail.tmdb-binding-saved'), 'success');
}

function clearTmdbBinding(): void {
  library.updateTmdbID(packageName, detailUrl, undefined);
  tmdb.value = null;
  tmdbError.value = '';
  tmdbDialogOpen.value = false;
}

watch(
  () => record.value?.tmdbID,
  () => {
    void loadTmdb();
  },
  { immediate: true },
);

watch(loggedIn, (value) => {
  if (value) anilistLoginOpen.value = false;
});

onMounted(() => {
  void initialize();
});
</script>

<template>
  <div class="page-scroll detail-scroll">
    <div v-if="invalidParams" class="page">
      <EmptyState :title="t('common.error')" :description="t('detail.missing-params')" />
    </div>

    <div v-else-if="loading && !detail" class="page">
      <div class="hero-skeleton skeleton" />
      <div class="skeleton copy-skeleton" />
      <div class="skeleton copy-skeleton short" />
    </div>

    <div v-else-if="!detail" class="page">
      <EmptyState
        :icon="AlertTriangle"
        :title="t('common.error')"
        :description="error || t('detail.get-lastest-data-error')"
      >
        <button class="btn" @click="retry">{{ t('common.retry') }}</button>
      </EmptyState>
    </div>

    <div v-else class="page detail-page">
      <div v-if="extensionMissing" class="warning-banner detail-banner">
        <AlertTriangle :size="16" />
        <span>{{ t('common.extension-missing', { package: packageName }) }}</span>
        <RouterLink to="/extensions" class="btn btn-sm">{{ t('common.extension') }}</RouterLink>
      </div>
      <div v-else-if="error" class="warning-banner detail-banner">
        <AlertTriangle :size="16" />
        <span>{{ t('detail.get-lastest-data-error') }} — {{ error.split('\n')[0] }}</span>
        <button class="btn btn-sm" :disabled="refreshing" @click="retry">
          {{ t('common.retry') }}
        </button>
        <div v-if="refreshing" class="spinner" />
      </div>

      <section class="hero" :class="{ 'no-backdrop': !backdropSrc }">
        <div v-if="backdropSrc" class="hero-backdrop">
          <SmartImage :src="backdropSrc" :proxy="false" fit="cover" alt="" eager />
        </div>
        <div class="hero-shade" />
        <div class="hero-inner">
          <div class="hero-poster">
            <SmartImage
              :src="posterSrc"
              :headers="posterIsTmdb ? undefined : detail.headers"
              :base="meta?.webSite"
              :alt="displayTitle"
              eager
            />
          </div>
          <div class="hero-info">
            <div class="hero-kicker">
              <span class="hero-chip">{{ extensionTypeLabel(type) }}</span>
              <span v-if="year" class="hero-chip ghost">{{ year }}</span>
              <span v-if="tmdb?.mediaType" class="hero-chip ghost">
                {{ tmdb.mediaType === 'movie' ? t('common.movie') : t('common.tv') }}
              </span>
              <span v-if="totalEpisodeCount" class="hero-chip ghost">
                {{ t('detail.total-episodes', { total: totalEpisodeCount }) }}
              </span>
            </div>
            <h1>{{ displayTitle || t('common.no-data') }}</h1>
            <div v-if="tmdb?.genres.length" class="hero-genres">
              {{ tmdb.genres.join(' · ') }}
            </div>
            <div class="hero-actions">
              <button
                class="btn btn-primary btn-lg"
                :disabled="!primaryTarget"
                @click="openPrimary"
              >
                <Play :size="17" fill="currentColor" />
                {{ primaryLabel }}
              </button>
              <button
                class="btn btn-lg hero-secondary"
                :class="{ active: favorite }"
                @click="toggleFavorite"
              >
                <Heart :size="16" :fill="favorite ? 'currentColor' : 'none'" />
                {{ favorite ? t('detail.favorited') : t('detail.favorite') }}
              </button>
              <button
                v-if="anilistType"
                class="btn btn-lg hero-secondary"
                :class="{ active: aniListID }"
                @click="openTracking"
              >
                <Bookmark :size="16" :fill="aniListID ? 'currentColor' : 'none'" />
                {{ t('detail.tracking') }}
              </button>
              <button
                class="btn btn-lg hero-secondary"
                :title="t('detail.open-webview')"
                @click="openWebview"
              >
                <Globe :size="16" />
                {{ t('detail.open-webview') }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section v-if="overviewHtml" class="detail-section">
        <div class="section-heading">
          <h2>{{ t('detail.overview') }}</h2>
        </div>
        <div class="markdown overview-content" v-html="overviewHtml" />
      </section>

      <section class="detail-section episodes-section">
        <div class="section-heading">
          <h2>
            {{
              type === 'bangumi'
                ? t('video.episodes')
                : type === 'manga'
                  ? t('reader.chapters')
                  : t('reader.chapters')
            }}
          </h2>
          <span v-if="currentEpisodes.length" class="chip">{{ currentEpisodes.length }}</span>
          <div class="spacer" />
          <div class="episode-controls">
            <button
              class="icon-button"
              :class="{ active: episodeView === 'grid' }"
              :title="t('common.home')"
              @click="episodeView = 'grid'"
            >
              <LayoutGrid :size="15" />
            </button>
            <button
              class="icon-button"
              :class="{ active: episodeView === 'list' }"
              :title="t('common.show-all')"
              @click="episodeView = 'list'"
            >
              <List :size="16" />
            </button>
            <button
              class="icon-button"
              :class="{ active: reverseEpisodes }"
              :title="t('common.reverse-order')"
              @click="reverseEpisodes = !reverseEpisodes"
            >
              <ArrowDownUp :size="15" />
            </button>
          </div>
        </div>

        <div v-if="groups.length > 1" class="group-tabs">
          <button
            v-for="(group, index) in groups"
            :key="`${group.title}-${index}`"
            class="group-tab"
            :class="{ active: selectedGroupIndex === index }"
            @click="selectGroup(index)"
          >
            {{ group.title || t('common.group-number', { index: index + 1 }) }}
            <span class="group-count">{{ group.urls.length }}</span>
          </button>
        </div>

        <div v-if="currentEpisodes.length" class="episodes-wrap">
          <div v-if="episodeView === 'grid'" class="episode-grid">
            <button
              v-for="entry in displayEpisodes"
              :key="`${entry.index}-${entry.episode.url}`"
              class="episode-card"
              :class="{ current: isCurrentEpisode(entry.index) }"
              :title="episodeDisplayName(entry.episode, entry.index)"
              @click="openEpisode(selectedGroupIndex, entry.index)"
            >
              <span class="episode-index">
                {{ String(entry.index + 1).padStart(2, '0') }}
              </span>
              <span class="episode-name">
                {{ episodeDisplayName(entry.episode, entry.index) }}
              </span>
              <span
                v-if="isCurrentEpisode(entry.index) && currentEpisodeProgress > 0"
                class="episode-progress"
              >
                <span :style="{ width: `${currentEpisodeProgress * 100}%` }" />
              </span>
              <Play
                v-if="isCurrentEpisode(entry.index)"
                :size="12"
                class="episode-current-icon"
                fill="currentColor"
              />
            </button>
          </div>

          <div v-else class="episode-list">
            <button
              v-for="entry in displayEpisodes"
              :key="`${entry.index}-${entry.episode.url}`"
              class="episode-row"
              :class="{ current: isCurrentEpisode(entry.index) }"
              @click="openEpisode(selectedGroupIndex, entry.index)"
            >
              <span class="episode-row-index">
                {{ String(entry.index + 1).padStart(2, '0') }}
              </span>
              <span class="episode-row-name">
                {{ episodeDisplayName(entry.episode, entry.index) }}
              </span>
              <span
                v-if="isCurrentEpisode(entry.index) && currentEpisodeProgress > 0"
                class="episode-row-progress"
              >
                {{ Math.round(currentEpisodeProgress * 100) }}%
              </span>
              <Play
                :size="14"
                class="episode-row-play"
                :fill="isCurrentEpisode(entry.index) ? 'currentColor' : 'none'"
              />
            </button>
          </div>
        </div>

        <EmptyState
          v-else
          compact
          :title="type === 'bangumi' ? t('video.no-episodes') : t('reader.no-chapters')"
        />
      </section>

      <section v-if="tmdb?.casts.length" class="detail-section">
        <div class="section-heading">
          <h2>{{ t('detail.cast') }}</h2>
          <Users :size="15" class="muted" />
        </div>
        <div class="cast-row">
          <div v-for="cast in tmdb.casts" :key="cast.id" class="cast-card">
            <div class="cast-photo">
              <SmartImage
                :src="tmdbImage(cast.profilePath, 'w185')"
                :proxy="false"
                :alt="cast.name"
              />
            </div>
            <div class="cast-name">{{ cast.name }}</div>
            <div v-if="cast.character" class="cast-character">{{ cast.character }}</div>
          </div>
        </div>
      </section>

      <section v-if="backdrops.length" class="detail-section">
        <div class="section-heading">
          <h2>{{ t('tmdb.backdrops') }}</h2>
          <Images :size="15" class="muted" />
        </div>
        <div class="backdrop-row">
          <div v-for="(image, index) in backdrops" :key="image" class="backdrop-item">
            <SmartImage :src="image" :proxy="false" fit="cover" :alt="`Backdrop ${index + 1}`" />
          </div>
        </div>
      </section>

      <section class="detail-section">
        <div class="section-heading">
          <h2>{{ t('detail.additional-info') }}</h2>
          <span v-if="tmdb?.mediaType" class="chip chip-outline">
            {{ tmdb.mediaType === 'movie' ? t('common.movie') : t('common.tv') }}
          </span>
          <div class="spacer" />
          <button v-if="tmdbAvailable" class="btn btn-sm" @click="openTmdbDialog">
            <Settings2 :size="13" />
            {{ tmdb ? t('detail.modify-tmdb-binding') : 'Bind TMDB' }}
          </button>
        </div>

        <div v-if="tmdb" class="fact-panel">
          <div v-for="fact in tmdbFacts" :key="fact.label" class="fact">
            <span class="fact-label">{{ fact.label }}</span>
            <span class="fact-value">{{ fact.value }}</span>
          </div>
        </div>

        <div v-else class="tmdb-empty">
          <p>{{ t('detail.no-tmdb-data') }}</p>
          <p v-if="!tmdbAvailable" class="muted small">
            {{ t('detail.tmdb-key-missing') }}
            <RouterLink to="/settings">{{ t('common.settings') }}</RouterLink>
          </p>
          <p v-else-if="tmdbError" class="error-text">{{ tmdbError }}</p>
          <button v-if="tmdbAvailable" class="btn btn-sm" @click="openTmdbDialog">
            {{ t('detail.bind-tmdb') }}
          </button>
        </div>

        <div class="source-panel">
          <div class="fact">
            <span class="fact-label">{{ t('extension-info.title') }}</span>
            <span class="fact-value">{{ meta?.name || packageName }}</span>
          </div>
          <div class="fact">
            <span class="fact-label">{{ t('extension-info.version') }}</span>
            <span class="fact-value">{{ meta?.version || '—' }}</span>
          </div>
        </div>
      </section>
    </div>

    <TmdbBindDialog
      :open="tmdbDialogOpen"
      :initial-query="displayTitle"
      :current-id="record?.tmdbID"
      @close="tmdbDialogOpen = false"
      @select="onTmdbSelected"
      @clear="clearTmdbBinding"
    />

    <AnilistBindDialog
      :open="anilistBindOpen"
      :type="bindType"
      :initial-query="displayTitle"
      @close="anilistBindOpen = false"
      @select="onAnilistSelected"
    />

    <AnilistTrackDialog
      :open="anilistTrackOpen"
      :media-id="aniListID"
      :type="bindType"
      @close="anilistTrackOpen = false"
      @saved="onAnilistSaved"
      @unbind="onAnilistUnbind"
    />

    <AppModal
      :open="anilistLoginOpen"
      :title="t('anilist.title')"
      width="420px"
      @close="anilistLoginOpen = false"
    >
      <div class="login-hint">
        <p>{{ t('anilist.login-hint-1') }}</p>
        <p class="muted">{{ t('anilist.login-hint-2') }}</p>
      </div>
      <template #footer>
        <button class="btn" @click="anilistLoginOpen = false">
          {{ t('common.cancel') }}
        </button>
        <button class="btn btn-primary" @click="loginAnilist">
          {{ t('common.login') }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.detail-scroll {
  padding-top: 18px;
}

.detail-page {
  max-width: 1320px;
}

.detail-banner {
  margin-bottom: 16px;
  align-items: center;
}

.hero {
  position: relative;
  min-height: 360px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: linear-gradient(135deg, #232733 0%, #171a22 48%, #34202a 100%);
  margin-bottom: 30px;
  isolation: isolate;
}

.hero-backdrop,
.hero-backdrop :deep(.smart-image) {
  position: absolute;
  inset: 0;
}

.hero-backdrop {
  z-index: -2;
  opacity: 0.62;
}

.hero-shade {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(90deg, rgba(10, 12, 18, 0.9) 0%, rgba(10, 12, 18, 0.55) 48%, rgba(10, 12, 18, 0.28) 100%),
    linear-gradient(0deg, rgba(10, 12, 18, 0.72) 0%, transparent 62%);
}

.hero-inner {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 26px;
  min-height: 360px;
  padding: 36px 38px;
}

.hero-poster {
  flex: 0 0 208px;
  width: 208px;
  aspect-ratio: 2 / 3;
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface-2);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.5);
}

.hero-info {
  min-width: 0;
  padding-bottom: 6px;
  color: #fff;
}

.hero-kicker {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.hero-chip {
  display: inline-flex;
  align-items: center;
  height: 23px;
  padding: 0 9px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.03em;
  backdrop-filter: blur(8px);
}

.hero-chip.ghost {
  background: rgba(255, 255, 255, 0.09);
  border: 1px solid rgba(255, 255, 255, 0.16);
  font-weight: 500;
}

.hero h1 {
  max-width: 880px;
  font-size: clamp(27px, 3.1vw, 42px);
  font-weight: 750;
  line-height: 1.15;
  letter-spacing: -0.025em;
  text-wrap: balance;
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.35);
}

.hero-genres {
  margin-top: 9px;
  color: rgba(255, 255, 255, 0.68);
  font-size: 12.5px;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 22px;
}

.hero-secondary {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.11);
  color: #fff;
  backdrop-filter: blur(10px);
}

.hero-secondary:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.25);
}

.hero-secondary.active {
  background: rgba(255, 125, 147, 0.26);
  border-color: rgba(255, 125, 147, 0.55);
  color: #fff;
}

.detail-section {
  margin-bottom: 32px;
}

.section-heading h2 {
  font-size: 17px;
}

.overview-content {
  max-width: 980px;
}

.episodes-section {
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.episodes-section .section-heading {
  margin-bottom: 14px;
}

.episode-controls {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border-radius: 8px;
  background: var(--surface-2);
}

.icon-button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  transition: background 0.14s ease, color 0.14s ease;
}

.icon-button:hover {
  color: var(--text);
}

.icon-button.active {
  background: var(--surface);
  color: var(--accent);
  box-shadow: var(--shadow-sm);
}

.group-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}

.group-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 99px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 550;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}

.group-tab:hover {
  background: var(--surface-2);
  color: var(--text);
}

.group-tab.active {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--accent);
}

.group-count {
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  display: inline-grid;
  place-items: center;
  border-radius: 99px;
  background: var(--surface-3);
  color: var(--muted);
  font-size: 9.5px;
  font-weight: 700;
}

.group-tab.active .group-count {
  background: var(--accent);
  color: var(--accent-contrast);
}

.episode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
  gap: 8px;
}

.episode-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-height: 66px;
  padding: 10px 11px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  color: var(--text);
  text-align: left;
  overflow: hidden;
  transition: background 0.14s ease, border-color 0.14s ease, transform 0.1s ease;
}

.episode-card:hover {
  border-color: var(--border-strong);
  background: var(--surface-2);
  transform: translateY(-1px);
}

.episode-card.current {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.episode-index {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
}

.episode-name {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 550;
}

.episode-current-icon {
  position: absolute;
  top: 9px;
  right: 9px;
  color: var(--accent);
}

.episode-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2.5px;
  background: rgba(0, 0, 0, 0.15);
}

.episode-progress span {
  display: block;
  height: 100%;
  background: var(--accent);
}

.episode-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.episode-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 42px;
  padding: 0 11px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  text-align: left;
  transition: background 0.14s ease;
}

.episode-row:hover {
  background: var(--surface-2);
}

.episode-row.current {
  background: var(--accent-soft);
  color: var(--accent);
}

.episode-row-index {
  flex: 0 0 34px;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 650;
}

.episode-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}

.episode-row-progress {
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
}

.episode-row-play {
  color: var(--muted);
}

.episode-row.current .episode-row-play,
.episode-row.current .episode-row-progress {
  color: var(--accent);
}

.cast-row,
.backdrop-row {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 2px 2px 8px;
}

.cast-card {
  flex: 0 0 104px;
  width: 104px;
}

.cast-photo {
  width: 104px;
  height: 142px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface-2);
}

.cast-name {
  margin-top: 7px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
}

.cast-character {
  margin-top: 1px;
  color: var(--muted);
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.backdrop-item {
  flex: 0 0 260px;
  width: 260px;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface-2);
}

.fact-panel,
.source-panel {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--border);
}

.source-panel {
  margin-top: 12px;
}

.fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  background: var(--surface);
}

.fact-label {
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.fact-value {
  font-size: 13px;
  word-break: break-word;
}

.tmdb-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  padding: 18px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 12.5px;
}

.error-text {
  color: var(--danger);
}

.login-hint {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--text-secondary);
  padding: 4px 0 6px;
}

.hero-skeleton {
  height: 360px;
  border-radius: var(--radius-lg);
  margin-bottom: 26px;
}

.copy-skeleton {
  width: 70%;
  height: 92px;
  margin-bottom: 14px;
}

.copy-skeleton.short {
  width: 48%;
}

@media (max-width: 860px) {
  .hero-inner {
    padding: 26px 24px;
    gap: 18px;
  }

  .hero-poster {
    flex-basis: 148px;
    width: 148px;
  }

  .hero-actions {
    margin-top: 16px;
  }

  .hero-secondary {
    height: 36px;
    font-size: 12px;
  }
}

@media (max-width: 640px) {
  .hero-inner {
    align-items: flex-start;
    flex-direction: column;
  }

  .hero-poster {
    width: 122px;
    flex-basis: 122px;
  }

  .episodes-section {
    padding: 15px;
  }
}
</style>
