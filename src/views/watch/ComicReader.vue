<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
} from 'vue';
import { useI18n } from 'vue-i18n';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  List,
  RefreshCw,
  Rows3,
  Settings2,
} from 'lucide-vue-next';
import SmartImage from '../../components/SmartImage.vue';
import { mediaUrl } from '../../lib/media';
import { errorMessage } from '../../lib/tauri';
import { clamp } from '../../lib/util';
import { useExtensionsStore } from '../../stores/extensions';
import { useLibraryStore } from '../../stores/library';
import { useSettingsStore } from '../../stores/settings';
import type {
  ExtensionEpisode,
  ExtensionMangaWatch,
  MangaReadMode,
} from '../../types/models';

const props = withDefaults(
  defineProps<{
    packageName: string;
    detailUrl: string;
    detailTitle: string;
    episodeTitle: string;
    episodeUrl: string;
    initialProgress?: number;
    episodes?: ExtensionEpisode[];
    currentIndex?: number;
    hasPrevious?: boolean;
    hasNext?: boolean;
  }>(),
  {
    initialProgress: 0,
    episodes: () => [],
    currentIndex: 0,
    hasPrevious: false,
    hasNext: false,
  },
);

const emit = defineEmits<{
  exit: [];
  previous: [];
  next: [];
  'select-episode': [index: number];
  progress: [payload: { progress: number; total: number }];
}>();

const { t } = useI18n();
const extensions = useExtensionsStore();
const library = useLibraryStore();
const settings = useSettingsStore();

const root = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const watchData = ref<ExtensionMangaWatch | null>(null);
const loading = ref(true);
const error = ref('');
const pageIndex = ref(0);
const readMode = ref<MangaReadMode>(settings.readingMode);
const showControls = ref(true);
const episodePanel = ref(false);
const message = ref('');
const failedPages = ref<Record<number, string>>({});

const pageRefs: (HTMLElement | null)[] = [];
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let messageTimer: ReturnType<typeof setTimeout> | null = null;
let restoreTarget = -1;
let restored = false;
let disposed = false;

const urls = computed(() => watchData.value?.urls ?? []);
const totalPages = computed(() => urls.value.length);
const progressPercent = computed(() =>
  totalPages.value > 0 ? ((pageIndex.value + 1) / totalPages.value) * 100 : 0,
);
const controlsVisible = computed(
  () => showControls.value || loading.value || Boolean(error.value),
);
const readModes: { value: MangaReadMode; label: string }[] = [
  { value: 'standard', label: 'comic-settings.standard' },
  { value: 'rightToLeft', label: 'comic-settings.right-to-left' },
  { value: 'webTonn', label: 'comic-settings.web-tonn' },
];

function showMessage(text: string): void {
  message.value = text;
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    message.value = '';
    messageTimer = null;
  }, 2600);
}

function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleHide(): void {
  clearHideTimer();
  if (loading.value || error.value) return;
  hideTimer = setTimeout(() => {
    showControls.value = false;
  }, 3000);
}

function wakeControls(): void {
  showControls.value = true;
  scheduleHide();
}

function toggleControls(): void {
  showControls.value = !showControls.value;
  episodePanel.value = false;
  if (showControls.value) scheduleHide();
  else clearHideTimer();
}

function onPointerMove(event: MouseEvent): void {
  if (!controlsVisible.value) return;
  const bounds = root.value?.getBoundingClientRect();
  if (!bounds) return;
  const top = event.clientY - bounds.top;
  const bottom = bounds.bottom - event.clientY;
  if (top < 90 || bottom < 100) {
    wakeControls();
  } else if (showControls.value) {
    scheduleHide();
  }
}

function emitProgress(): void {
  if (!watchData.value || !totalPages.value) return;
  emit('progress', {
    progress: Math.max(0, pageIndex.value),
    total: totalPages.value,
  });
}

function preloadAround(index: number): void {
  const data = watchData.value;
  if (!data) return;
  for (const candidate of [index - 1, index, index + 1]) {
    const url = data.urls[candidate];
    if (!url) continue;
    const image = new Image();
    image.src = mediaUrl(url, data.headers);
  }
}

function goToPage(index: number): void {
  const max = Math.max(0, totalPages.value - 1);
  const next = clamp(index, 0, max);
  if (next === pageIndex.value) return;
  pageIndex.value = next;
  preloadAround(next);
  emitProgress();
}

function nextPage(): void {
  if (readMode.value === 'webTonn') {
    scroller.value?.scrollBy({ top: 280, behavior: 'smooth' });
    wakeControls();
    return;
  }
  goToPage(pageIndex.value + 1);
}

function previousPage(): void {
  if (readMode.value === 'webTonn') {
    scroller.value?.scrollBy({ top: -280, behavior: 'smooth' });
    wakeControls();
    return;
  }
  goToPage(pageIndex.value - 1);
}

function onPagedWheel(event: WheelEvent): void {
  const delta =
    Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (delta > 8) nextPage();
  else if (delta < -8) previousPage();
}

function onRootWheel(event: WheelEvent): void {
  if (readMode.value === 'webTonn' || loading.value || error.value) return;
  if (episodePanel.value) return;
  event.preventDefault();
  onPagedWheel(event);
}

function onLeftZone(): void {
  if (readMode.value === 'rightToLeft') nextPage();
  else previousPage();
}

function onRightZone(): void {
  if (readMode.value === 'rightToLeft') previousPage();
  else nextPage();
}

function scrollToPage(index: number): void {
  if (readMode.value !== 'webTonn') return;
  const container = scroller.value;
  if (!container) return;
  const target = pageRefs[index];
  if (!target) return;
  container.scrollTop = target.offsetTop;
}

function setPageRef(element: unknown, index: number): void {
  pageRefs[index] = element instanceof HTMLElement ? element : null;
  if (
    readMode.value === 'webTonn' &&
    restoreTarget === index &&
    !restored &&
    element
  ) {
    restored = true;
    requestAnimationFrame(() => scrollToPage(index));
    window.setTimeout(() => scrollToPage(index), 180);
  }
}

function onWebtoonScroll(): void {
  if (readMode.value !== 'webTonn' || !scroller.value) return;
  const container = scroller.value;
  const line = container.scrollTop + Math.min(160, container.clientHeight * 0.25);
  let index = 0;
  for (let cursor = 0; cursor < pageRefs.length; cursor += 1) {
    const element = pageRefs[cursor];
    if (!element) continue;
    if (element.offsetTop <= line) index = cursor;
    else break;
  }
  if (index !== pageIndex.value) {
    pageIndex.value = index;
    emitProgress();
    preloadAround(index);
  }
}

function setReadMode(mode: MangaReadMode): void {
  if (readMode.value === mode) return;
  readMode.value = mode;
  library.setMangaReadMode(props.detailUrl, mode);
  restoreTarget = pageIndex.value;
  restored = false;
  void nextTick(() => {
    if (mode === 'webTonn') {
      requestAnimationFrame(() => scrollToPage(pageIndex.value));
      window.setTimeout(() => scrollToPage(pageIndex.value), 220);
    }
  });
}

function onImageError(index: number): void {
  failedPages.value = { ...failedPages.value, [index]: 'Failed to load page' };
}

async function loadWatch(): Promise<void> {
  disposed = false;
  loading.value = true;
  error.value = '';
  watchData.value = null;
  pageRefs.length = 0;
  failedPages.value = {};
  try {
    const runtime = await extensions.ensureRuntime(props.packageName);
    const data = (await runtime.watch(props.episodeUrl)) as ExtensionMangaWatch;
    if (disposed) return;
    if (!data || !Array.isArray(data.urls) || !data.urls.length) {
      throw new Error(t('reader.no-chapters'));
    }
    watchData.value = data;
    const initial = clamp(
      Math.floor(Number(props.initialProgress) || 0),
      0,
      data.urls.length - 1,
    );
    pageIndex.value = initial;
    restoreTarget = initial;
    restored = false;
    if (initial > 0) showMessage(t('video.resume-last-playback'));
    await nextTick();
    preloadAround(initial);
    emitProgress();
  } catch (caught) {
    if (disposed) return;
    error.value = errorMessage(caught);
  } finally {
    if (!disposed) loading.value = false;
  }
}

function retry(): void {
  void loadWatch();
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element &&
      (element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'SELECT' ||
        element.isContentEditable),
  );
}

function onKeydown(event: KeyboardEvent): void {
  if (isEditableTarget(event.target)) return;
  if (event.key === 'Escape') {
    if (episodePanel.value) {
      episodePanel.value = false;
      event.preventDefault();
      return;
    }
    if (showControls.value && loading.value === false && !error.value) {
      showControls.value = false;
      event.preventDefault();
      return;
    }
    emit('exit');
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (loading.value || error.value) return;

  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault();
      if (readMode.value === 'rightToLeft') nextPage();
      else previousPage();
      break;
    case 'ArrowRight':
      event.preventDefault();
      if (readMode.value === 'rightToLeft') previousPage();
      else nextPage();
      break;
    case 'ArrowUp':
      event.preventDefault();
      if (readMode.value === 'webTonn') {
        scroller.value?.scrollBy({ top: -280, behavior: 'smooth' });
      } else {
        previousPage();
      }
      break;
    case 'ArrowDown':
      event.preventDefault();
      if (readMode.value === 'webTonn') {
        scroller.value?.scrollBy({ top: 280, behavior: 'smooth' });
      } else {
        nextPage();
      }
      break;
    case ' ':
      event.preventDefault();
      if (event.shiftKey) previousPage();
      else nextPage();
      break;
    case 'PageDown':
      event.preventDefault();
      nextPage();
      break;
    case 'PageUp':
      event.preventDefault();
      previousPage();
      break;
    case 'Home':
      event.preventDefault();
      goToPage(0);
      break;
    case 'End':
      event.preventDefault();
      goToPage(totalPages.value - 1);
      break;
    default:
      break;
  }
}

function onSeekInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) goToPage(value);
}

onMounted(() => {
  readMode.value = library.getMangaReadMode(props.detailUrl, settings.readingMode);
  window.addEventListener('keydown', onKeydown);
  scheduleHide();
  void loadWatch();
});

onBeforeUnmount(() => {
  disposed = true;
  emitProgress();
  window.removeEventListener('keydown', onKeydown);
  if (hideTimer) clearTimeout(hideTimer);
  if (messageTimer) clearTimeout(messageTimer);
});
</script>

<template>
  <div
    ref="root"
    class="comic-reader"
    @mousemove="onPointerMove"
    @mouseleave="showControls = false"
    @wheel="onRootWheel"
  >
    <div v-if="loading" class="reader-overlay">
      <div class="spinner lg" />
    </div>

    <div v-else-if="error" class="reader-overlay">
      <AlertTriangle :size="32" class="error-icon" />
      <div class="error-title">{{ t('reader.no-chapters') }}</div>
      <div class="error-text">{{ error }}</div>
      <div class="error-actions">
        <button class="btn btn-primary" @click="retry">
          <RefreshCw :size="14" />
          {{ t('common.retry') }}
        </button>
        <button class="btn" @click="emit('exit')">{{ t('common.close') }}</button>
      </div>
    </div>

    <template v-else>
      <div
        v-if="readMode === 'webTonn'"
        ref="scroller"
        class="webtoon-scroller"
        @scroll.passive="onWebtoonScroll"
        @click="toggleControls"
      >
        <div class="webtoon-content">
          <div
            v-for="(url, index) in urls"
            :key="`${index}-${url}`"
            :ref="(element) => setPageRef(element, index)"
            class="webtoon-page"
          >
            <img
              :src="mediaUrl(url, watchData?.headers)"
              :alt="`Page ${index + 1}`"
              loading="lazy"
              decoding="async"
              draggable="false"
              @error="onImageError(index)"
            />
            <div v-if="failedPages[index]" class="page-failed">
              <AlertTriangle :size="18" />
              <span>{{ failedPages[index] }}</span>
            </div>
            <div class="webtoon-number">{{ index + 1 }}</div>
          </div>
        </div>
      </div>

      <div v-else class="paged-stage">
        <transition name="page" mode="out-in">
          <div class="paged-image" :key="pageIndex">
            <SmartImage
              :src="urls[pageIndex]"
              :headers="watchData?.headers"
              fit="contain"
              eager
              :alt="`Page ${pageIndex + 1}`"
            />
          </div>
        </transition>
      </div>

      <div v-if="readMode !== 'webTonn'" class="click-zones">
        <button class="click-zone" :aria-label="t('common.previous-page')" @click="onLeftZone" />
        <button class="click-zone center" :aria-label="t('common.toggle-controls')" @click="toggleControls" />
        <button class="click-zone" :aria-label="t('common.next-page')" @click="onRightZone" />
      </div>

      <div class="page-counter">
        <template v-if="readMode === 'webTonn'">
          {{ pageIndex + 1 }} / {{ totalPages }}
        </template>
        <template v-else>
          {{ pageIndex + 1 }} / {{ totalPages }}
        </template>
      </div>

      <Transition name="control">
        <header v-if="controlsVisible" class="reader-top" @click.stop>
          <button class="icon-button" :title="t('common.close')" @click="emit('exit')">
            <ChevronLeft :size="20" />
          </button>
          <div class="reader-title">
            <div class="title-line">{{ detailTitle }}</div>
            <div class="episode-line">{{ episodeTitle }}</div>
          </div>
          <div class="spacer" />
          <div class="mode-switch">
            <button
              v-for="mode in readModes"
              :key="mode.value"
              class="mode-button"
              :class="{ active: readMode === mode.value }"
              :title="t(mode.label)"
              @click="setReadMode(mode.value)"
            >
              <Rows3 v-if="mode.value === 'webTonn'" :size="14" />
              <span v-else>{{ t(mode.label) }}</span>
            </button>
          </div>
          <button
            class="icon-button"
            :title="t('video.sidebar.tab.episodes')"
            @click="episodePanel = !episodePanel"
          >
            <List :size="18" />
          </button>
          <button class="icon-button" :title="t('comic-settings.read-mode')" @click="setReadMode(readMode === 'standard' ? 'rightToLeft' : readMode === 'rightToLeft' ? 'webTonn' : 'standard')">
            <Settings2 :size="17" />
          </button>

          <Transition name="fade">
            <div v-if="episodePanel" class="episode-panel">
              <div class="panel-title">{{ t('video.sidebar.tab.episodes') }}</div>
              <div class="panel-list">
                <button
                  v-for="(episode, index) in episodes"
                  :key="`${index}-${episode.url}`"
                  class="panel-row"
                  :class="{ current: index === currentIndex }"
                  @click="episodePanel = false; emit('select-episode', index)"
                >
                  <span class="panel-index">{{ String(index + 1).padStart(2, '0') }}</span>
                  <span class="panel-name">{{ episode.name || t('common.chapter-number', { index: index + 1 }) }}</span>
                </button>
                <div v-if="!episodes.length" class="panel-empty">{{ t('reader.no-chapters') }}</div>
              </div>
            </div>
          </Transition>
        </header>
      </Transition>

      <Transition name="control">
        <footer v-if="controlsVisible" class="reader-bottom" @click.stop>
          <button class="btn btn-sm" :disabled="!hasPrevious" @click="emit('previous')">
            <ChevronLeft :size="13" />
            {{ t('common.previous') }}
          </button>
          <div class="reader-progress">
            <input
              class="page-slider"
              type="range"
              min="0"
              :max="Math.max(0, totalPages - 1)"
              step="1"
              :value="pageIndex"
              :style="{ '--progress': `${progressPercent}%` }"
              @input="onSeekInput"
            />
            <span class="progress-labels">{{ pageIndex + 1 }} / {{ totalPages }}</span>
          </div>
          <button class="btn btn-sm" :disabled="!hasNext" @click="emit('next')">
            {{ t('common.next') }}
            <ChevronRight :size="13" />
          </button>
        </footer>
      </Transition>

      <Transition name="fade">
        <div v-if="message" class="reader-message">{{ message }}</div>
      </Transition>
    </template>
  </div>
</template>

<style scoped>
.comic-reader {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: #fff;
  background: #08090d;
  user-select: none;
}

.reader-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
}

.error-icon {
  color: var(--warning);
}

.error-title {
  font-size: 15px;
  font-weight: 600;
}

.error-text {
  max-width: 600px;
  max-height: 30vh;
  overflow: auto;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  white-space: pre-wrap;
}

.error-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.webtoon-scroller {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}

.webtoon-content {
  width: min(100%, 820px);
  margin: 0 auto;
  padding: 0 0 44px;
}

.webtoon-page {
  position: relative;
  width: 100%;
  min-height: 80px;
  background: #0d0f14;
}

.webtoon-page img {
  display: block;
  width: 100%;
  height: auto;
  pointer-events: none;
}

.webtoon-number {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.5);
  font-size: 9.5px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.webtoon-page:hover .webtoon-number {
  opacity: 1;
}

.page-failed {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 180px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
}

.paged-stage {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 10px 0;
}

.paged-image {
  width: 100%;
  height: 100%;
  max-width: 100%;
}

.paged-image :deep(.smart-image) {
  background: transparent;
}

.click-zones {
  position: absolute;
  inset: 80px 0 92px;
  z-index: 3;
  display: flex;
}

.click-zone {
  flex: 1;
  padding: 0;
  border: none;
  background: transparent;
  cursor: default;
}

.click-zone.center {
  flex: 2;
}

.page-counter {
  position: absolute;
  left: 18px;
  bottom: 16px;
  z-index: 6;
  padding: 3px 9px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: rgba(255, 255, 255, 0.76);
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.reader-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 64px;
  padding: 10px 16px 16px;
  background: linear-gradient(to bottom, rgba(5, 6, 10, 0.9), transparent);
}

.reader-top .icon-button,
.reader-bottom .btn {
  color: rgba(255, 255, 255, 0.82);
}

.reader-title {
  min-width: 0;
}

.title-line {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13.5px;
  font-weight: 650;
  white-space: nowrap;
}

.episode-line {
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  white-space: nowrap;
}

.spacer {
  flex: 1;
}

.icon-button {
  display: inline-grid;
  place-items: center;
  width: 33px;
  height: 33px;
  flex: 0 0 33px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
}

.icon-button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.mode-switch {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.07);
}

.mode-button {
  display: inline-flex;
  align-items: center;
  height: 27px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: rgba(255, 255, 255, 0.48);
  font-size: 10.5px;
  white-space: nowrap;
}

.mode-button.active {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.episode-panel {
  position: absolute;
  top: 58px;
  right: 14px;
  width: 280px;
  max-height: min(60vh, 520px);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: rgba(18, 20, 27, 0.98);
  box-shadow: 0 18px 45px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}

.panel-title {
  padding: 10px 12px 5px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.panel-list {
  overflow-y: auto;
  padding: 0 7px 7px;
}

.panel-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.68);
  font-size: 11.5px;
  text-align: left;
}

.panel-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.panel-row.current {
  background: rgba(255, 125, 147, 0.14);
  color: #fff;
}

.panel-index {
  flex: 0 0 23px;
  color: rgba(255, 255, 255, 0.32);
  font-family: var(--font-mono);
  font-size: 9.5px;
}

.panel-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-empty {
  padding: 20px 10px;
  color: rgba(255, 255, 255, 0.35);
  font-size: 11.5px;
  text-align: center;
}

.reader-bottom {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 28px 18px 14px;
  background: linear-gradient(to top, rgba(5, 6, 10, 0.92), transparent);
}

.reader-bottom .btn {
  border-color: rgba(255, 255, 255, 0.13);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

.reader-bottom .btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
}

.reader-bottom .btn:disabled {
  opacity: 0.32;
  cursor: default;
}

.reader-progress {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-slider {
  flex: 1;
  height: 4px;
  appearance: none;
  border-radius: 99px;
  background: linear-gradient(
    to right,
    var(--accent) var(--progress, 0%),
    rgba(255, 255, 255, 0.22) var(--progress, 0%)
  );
  cursor: pointer;
}

.page-slider::-webkit-slider-thumb {
  width: 11px;
  height: 11px;
  appearance: none;
  border-radius: 50%;
  background: #fff;
}

.progress-labels {
  min-width: 62px;
  color: rgba(255, 255, 255, 0.52);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: right;
}

.reader-message {
  position: absolute;
  left: 50%;
  bottom: 92px;
  z-index: 25;
  padding: 7px 13px;
  border-radius: 7px;
  background: rgba(8, 10, 14, 0.88);
  color: rgba(255, 255, 255, 0.82);
  font-size: 11.5px;
  transform: translateX(-50%);
}

.control-enter-active,
.control-leave-active {
  transition: opacity 0.18s ease;
}

.control-enter-from,
.control-leave-to {
  opacity: 0;
}

.page-enter-active,
.page-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.page-enter-from {
  opacity: 0;
  transform: scale(0.995);
}

.page-leave-to {
  opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
