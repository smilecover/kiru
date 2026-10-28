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
  Minus,
  Plus,
  RefreshCw,
  Settings2,
} from 'lucide-vue-next';
import { errorMessage } from '../../lib/tauri';
import { useExtensionsStore } from '../../stores/extensions';
import { useSettingsStore } from '../../stores/settings';
import { SettingKey } from '../../lib/defaults';
import type {
  ExtensionEpisode,
  ExtensionFikushonWatch,
} from '../../types/models';

const props = withDefaults(
  defineProps<{
    packageName: string;
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
const settings = useSettingsStore();

const root = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const heading = ref<HTMLElement | null>(null);
const subtitleElement = ref<HTMLElement | null>(null);
const watchData = ref<ExtensionFikushonWatch | null>(null);
const loading = ref(true);
const error = ref('');
const showControls = ref(true);
const settingsOpen = ref(false);
const episodePanel = ref(false);
const message = ref('');
const currentProgress = ref(0);

const paragraphRefs: (HTMLElement | null)[] = [];
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let messageTimer: ReturnType<typeof setTimeout> | null = null;
let scrollFrame = 0;
let lastEmitted = -1;
let restoreIndex = 0;
let restoreHeader = false;
let disposed = false;

const content = computed(() => watchData.value?.content ?? []);
const fontSize = computed(
  () => Number(settings.get<number>(SettingKey.novelFontSize, 18)) || 18,
);
const totalParagraphs = computed(() => content.value.length);
const readingPercent = computed(() => {
  if (!totalParagraphs.value) return 0;
  const paragraph = Math.max(0, Math.min(totalParagraphs.value, currentProgress.value - 2));
  return Math.round((paragraph / totalParagraphs.value) * 100);
});

function showMessage(text: string): void {
  message.value = text;
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    message.value = '';
    messageTimer = null;
  }, 2400);
}

function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleHide(): void {
  clearHideTimer();
  if (loading.value || error.value || settingsOpen.value || episodePanel.value) return;
  hideTimer = setTimeout(() => {
    showControls.value = false;
  }, 3000);
}

function wakeControls(): void {
  showControls.value = true;
  scheduleHide();
}

function onPointerMove(event: MouseEvent): void {
  if (!controlsVisible.value) return;
  const bounds = root.value?.getBoundingClientRect();
  if (!bounds) return;
  const top = event.clientY - bounds.top;
  const bottom = bounds.bottom - event.clientY;
  if (top < 90 || bottom < 100) wakeControls();
  else if (showControls.value) scheduleHide();
}

const controlsVisible = computed(
  () =>
    showControls.value ||
    loading.value ||
    Boolean(error.value) ||
    settingsOpen.value ||
    episodePanel.value,
);

function emitProgress(progress: number): void {
  if (!watchData.value) return;
  lastEmitted = progress;
  emit('progress', {
    progress: Math.max(0, progress),
    total: content.value.length,
  });
}

function updateProgress(): void {
  const container = scroller.value;
  if (!container || !watchData.value) return;
  const line = container.scrollTop + 56;
  let progress = 0;
  const headingBottom = heading.value
    ? heading.value.offsetTop + heading.value.offsetHeight
    : 0;
  const subtitleBottom = subtitleElement.value
    ? subtitleElement.value.offsetTop + subtitleElement.value.offsetHeight
    : headingBottom;

  if (heading.value && headingBottom > line) {
    progress = 0;
  } else if (subtitleElement.value && subtitleBottom > line) {
    progress = 1;
  } else {
    let index = 0;
    for (let cursor = 0; cursor < paragraphRefs.length; cursor += 1) {
      const element = paragraphRefs[cursor];
      if (!element) continue;
      if (element.offsetTop + element.offsetHeight <= line) index = cursor + 1;
      else break;
    }
    index = Math.min(index, content.value.length - 1);
    progress = index + 2;
  }
  currentProgress.value = progress;
  if (progress !== lastEmitted) emitProgress(progress);
}

function onScroll(): void {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    updateProgress();
  });
}

function setParagraphRef(element: unknown, index: number): void {
  paragraphRefs[index] = element instanceof HTMLElement ? element : null;
}

function scrollToRestore(): void {
  const container = scroller.value;
  if (!container) return;
  if (restoreHeader) {
    container.scrollTop = 0;
    updateProgress();
    return;
  }
  const target = paragraphRefs[restoreIndex];
  if (target) {
    container.scrollTop = Math.max(0, target.offsetTop - 18);
    updateProgress();
  }
}

function adjustFont(delta: number): void {
  const next = Math.max(12, Math.min(44, fontSize.value + delta));
  if (next === fontSize.value) return;
  const anchorIndex = Math.max(0, currentProgress.value - 2);
  const anchor = paragraphRefs[anchorIndex] ?? null;
  const previousTop = anchor ? anchor.offsetTop - (scroller.value?.scrollTop ?? 0) : 0;
  settings.set(SettingKey.novelFontSize, next);
  void nextTick(() => {
    if (anchor && scroller.value) {
      scroller.value.scrollTop = Math.max(0, anchor.offsetTop - previousTop);
    }
  });
}

function onFontSlider(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) settings.set(SettingKey.novelFontSize, value);
}

function toggleSettings(): void {
  settingsOpen.value = !settingsOpen.value;
  episodePanel.value = false;
  if (settingsOpen.value) showControls.value = true;
  scheduleHide();
}

function toggleEpisodes(): void {
  episodePanel.value = !episodePanel.value;
  settingsOpen.value = false;
  if (episodePanel.value) showControls.value = true;
  scheduleHide();
}

async function loadWatch(): Promise<void> {
  disposed = false;
  loading.value = true;
  error.value = '';
  watchData.value = null;
  paragraphRefs.length = 0;
  try {
    const runtime = await extensions.ensureRuntime(props.packageName);
    const data = (await runtime.watch(props.episodeUrl)) as ExtensionFikushonWatch;
    if (disposed) return;
    if (!data || !Array.isArray(data.content) || !data.content.length) {
      throw new Error(t('reader.no-chapters'));
    }
    watchData.value = data;
    const initial = Math.max(0, Math.floor(Number(props.initialProgress) || 0));
    restoreHeader = initial < 2;
    restoreIndex = Math.max(0, initial - 2);
    if (initial > 0) showMessage(t('video.resume-last-playback'));
    await nextTick();
    window.setTimeout(() => {
      scrollToRestore();
      updateProgress();
    }, 30);
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

function scrollScreen(delta: number): void {
  const container = scroller.value;
  if (!container) return;
  container.scrollBy({ top: delta, behavior: 'smooth' });
  wakeControls();
}

function onKeydown(event: KeyboardEvent): void {
  if (isEditableTarget(event.target)) return;
  if (event.key === 'Escape') {
    if (settingsOpen.value) {
      settingsOpen.value = false;
      event.preventDefault();
      return;
    }
    if (episodePanel.value) {
      episodePanel.value = false;
      event.preventDefault();
      return;
    }
    if (showControls.value && !loading.value && !error.value) {
      showControls.value = false;
      event.preventDefault();
      return;
    }
    emit('exit');
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (loading.value || error.value) return;
  const page = Math.max(320, (scroller.value?.clientHeight ?? 700) * 0.82);
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      scrollScreen(page);
      break;
    case 'ArrowUp':
      event.preventDefault();
      scrollScreen(-page);
      break;
    case 'PageDown':
      event.preventDefault();
      scrollScreen(page);
      break;
    case 'PageUp':
      event.preventDefault();
      scrollScreen(-page);
      break;
    case ' ':
      event.preventDefault();
      scrollScreen(event.shiftKey ? -page : page);
      break;
    case 'Home':
      event.preventDefault();
      scroller.value?.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'End':
      event.preventDefault();
      if (scroller.value) {
        scroller.value.scrollTo({
          top: scroller.value.scrollHeight,
          behavior: 'smooth',
        });
      }
      break;
    case 'ArrowLeft':
      if (props.hasPrevious) {
        event.preventDefault();
        emit('previous');
      }
      break;
    case 'ArrowRight':
      if (props.hasNext) {
        event.preventDefault();
        emit('next');
      }
      break;
    default:
      break;
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  scheduleHide();
  void loadWatch();
});

onBeforeUnmount(() => {
  disposed = true;
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  if (lastEmitted >= 0) {
    emit('progress', {
      progress: Math.max(0, currentProgress.value),
      total: content.value.length,
    });
  }
  window.removeEventListener('keydown', onKeydown);
  if (hideTimer) clearTimeout(hideTimer);
  if (messageTimer) clearTimeout(messageTimer);
});
</script>

<template>
  <div
    ref="root"
    class="novel-reader"
    @mousemove="onPointerMove"
    @mouseleave="showControls = false"
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

    <div v-else ref="scroller" class="novel-scroll" @scroll.passive="onScroll">
      <article class="novel-content">
        <header ref="heading" class="novel-heading">
          <h1>{{ detailTitle }}</h1>
          <div v-if="episodeTitle" class="episode-title">{{ episodeTitle }}</div>
        </header>
        <div
          v-if="watchData?.subtitle"
          ref="subtitleElement"
          class="novel-subtitle"
        >
          {{ watchData.subtitle }}
        </div>
        <div v-else ref="subtitleElement" class="subtitle-placeholder" aria-hidden="true" />
        <p
          v-for="(paragraph, index) in content"
          :key="index"
          :ref="(element) => setParagraphRef(element, index)"
          class="novel-paragraph"
          :style="{ fontSize: `${fontSize}px` }"
        >
          {{ paragraph }}
        </p>
        <div class="novel-end">
          <span v-if="hasNext" class="end-hint">{{ t('common.next') }} →</span>
          <span v-else class="end-hint">{{ t('video.play-complete') }}</span>
        </div>
      </article>
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
        <div class="font-controls">
          <button class="icon-button" :title="t('novel-settings.font-size')" @click="adjustFont(-1)">
            <Minus :size="15" />
          </button>
          <span class="font-value">{{ fontSize }}</span>
          <button class="icon-button" :title="t('novel-settings.font-size')" @click="adjustFont(1)">
            <Plus :size="15" />
          </button>
        </div>
        <button
          class="icon-button"
          :class="{ active: settingsOpen }"
          :title="t('novel-settings.font-size')"
          @click="toggleSettings"
        >
          <Settings2 :size="17" />
        </button>
        <button
          class="icon-button"
          :class="{ active: episodePanel }"
          :title="t('reader.chapters')"
          @click="toggleEpisodes"
        >
          <List :size="18" />
        </button>

        <Transition name="fade">
          <div v-if="settingsOpen" class="reader-popover font-popover">
            <div class="popover-label">{{ t('novel-settings.font-size') }}</div>
            <div class="font-slider-row">
              <span>A</span>
              <input
                class="font-slider"
                type="range"
                min="12"
                max="44"
                step="1"
                :value="fontSize"
                @input="onFontSlider"
              />
              <span class="large-a">A</span>
            </div>
            <div class="popover-value">{{ fontSize }}px</div>
          </div>
        </Transition>

        <Transition name="fade">
          <div v-if="episodePanel" class="reader-popover episode-panel">
            <div class="popover-label">{{ t('reader.chapters') }}</div>
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
        <div class="reading-progress">
          <span>{{ readingPercent }}%</span>
          <div class="progress-track"><span :style="{ width: `${readingPercent}%` }" /></div>
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
  </div>
</template>

<style scoped>
.novel-reader {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  user-select: text;
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
  max-width: 620px;
  max-height: 30vh;
  overflow: auto;
  color: var(--muted);
  font-size: 12px;
  white-space: pre-wrap;
}

.error-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.novel-scroll {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}

.novel-content {
  width: min(100%, 800px);
  margin: 0 auto;
  padding: 48px 28px 160px;
}

.novel-heading {
  padding-bottom: 16px;
}

.novel-heading h1 {
  font-size: 27px;
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: -0.02em;
}

.episode-title {
  margin-top: 7px;
  color: var(--text-secondary);
  font-size: 16px;
  font-weight: 500;
}

.novel-subtitle {
  margin-bottom: 22px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 15px;
  line-height: 1.8;
}

.subtitle-placeholder {
  height: 1px;
  margin-bottom: 20px;
}

.novel-paragraph {
  margin: 0 0 20px;
  font-family: "Microsoft YaHei", var(--font-sans);
  font-weight: 400;
  line-height: 2;
  text-align: justify;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.novel-end {
  padding-top: 34px;
  color: var(--muted);
  font-size: 11.5px;
  text-align: center;
}

.end-hint {
  padding: 5px 13px;
  border-radius: 99px;
  background: var(--surface-2);
}

.reader-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 62px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(12px);
}

.reader-title {
  min-width: 0;
  padding-left: 3px;
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
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}

.spacer {
  flex: 1;
}

.icon-button {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
}

.icon-button:hover {
  background: var(--surface-2);
  color: var(--text);
}

.icon-button.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.font-controls {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 2px;
  border-radius: 7px;
  background: var(--surface-2);
}

.font-value {
  min-width: 22px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: center;
}

.reader-popover {
  position: absolute;
  top: 54px;
  right: 14px;
  z-index: 24;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.font-popover {
  width: 250px;
  padding: 12px 14px;
}

.popover-label {
  margin-bottom: 9px;
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.font-slider-row {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--muted);
  font-size: 11px;
}

.large-a {
  font-size: 17px;
}

.font-slider {
  flex: 1;
  accent-color: var(--accent);
}

.popover-value {
  margin-top: 6px;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: right;
}

.episode-panel {
  width: 280px;
}

.episode-panel .popover-label {
  padding: 11px 12px 4px;
  margin-bottom: 0;
}

.panel-list {
  max-height: min(55vh, 480px);
  overflow-y: auto;
  padding: 4px 7px 7px;
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
  color: var(--text-secondary);
  font-size: 11.5px;
  text-align: left;
}

.panel-row:hover {
  background: var(--surface-2);
}

.panel-row.current {
  background: var(--accent-soft);
  color: var(--accent);
}

.panel-index {
  flex: 0 0 23px;
  color: var(--muted);
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
  color: var(--muted);
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
  gap: 14px;
  height: 58px;
  padding: 0 18px;
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
  backdrop-filter: blur(12px);
}

.reader-bottom .btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.reading-progress {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.progress-track {
  flex: 1;
  height: 3px;
  overflow: hidden;
  border-radius: 99px;
  background: var(--surface-3);
}

.progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.2s ease;
}

.reader-message {
  position: absolute;
  left: 50%;
  bottom: 76px;
  z-index: 25;
  padding: 7px 13px;
  border-radius: 7px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  color: var(--text-secondary);
  font-size: 11.5px;
  transform: translateX(-50%);
}

.control-enter-active,
.control-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.control-enter-from,
.control-leave-to {
  opacity: 0;
}

.reader-top.control-enter-from,
.reader-top.control-leave-to {
  transform: translateY(-8px);
}

.reader-bottom.control-enter-from,
.reader-bottom.control-leave-to {
  transform: translateY(8px);
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
