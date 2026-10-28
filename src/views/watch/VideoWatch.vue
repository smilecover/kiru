<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import Hls from 'hls.js';
import {
  AlertTriangle,
  Cast,
  ChevronLeft,
  FileText,
  Gauge,
  List,
  Maximize,
  Minimize,
  Music,
  Pause,
  Play,
  RefreshCw,
  Settings,
  SkipBack,
  SkipForward,
  Subtitles,
  Tv,
  Volume2,
  VolumeX,
  X,
} from 'lucide-vue-next';
import BtManagerDialog from '../../components/BtManagerDialog.vue';
import DlnaDialog from '../../components/DlnaDialog.vue';
import { SettingKey, textAligns } from '../../lib/defaults';
import {
  argbToHex,
  fetchSubtitleVtt,
  mediaUrl,
  subtitleToVtt,
} from '../../lib/media';
import {
  basename,
  isSubtitleFile,
  isVideoFile,
  removeTorrent,
  resolveTorrentStream,
  torrentFileUrl,
} from '../../lib/playback';
import { call, errorMessage } from '../../lib/tauri';
import { clamp, formatSeconds, isTauri } from '../../lib/util';
import { useExtensionsStore } from '../../stores/extensions';
import { useSettingsStore } from '../../stores/settings';
import type {
  DlnaDevice,
  ExtensionBangumiWatch,
  ExtensionEpisode,
} from '../../types/models';
import type { TorrentStream } from '../../lib/playback';

type PlayMode = 'auto' | 'loop' | 'single';
type SidebarTab = 'episodes' | 'quality' | 'torrent' | 'tracks' | 'settings';

interface SubtitleOption {
  id: string;
  title: string;
  language?: string;
  url?: string;
  source: 'extension' | 'torrent' | 'local';
  localVtt?: string;
}

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

interface QualityLevel {
  index: number;
  label: string;
}

interface AudioTrackInfo {
  index: number;
  name: string;
  language: string;
}

interface DlnaResult {
  state?: string;
  position?: string;
  duration?: string;
}

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
const video = ref<HTMLVideoElement | null>(null);
const hls = shallowRef<Hls | null>(null);
const watchData = ref<ExtensionBangumiWatch | null>(null);
const torrent = ref<TorrentStream | null>(null);
const loading = ref(true);
const loadingLabel = ref('');
const btLoading = ref(false);
const error = ref('');
const sourceReady = ref(false);
const buffering = ref(false);
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const volume = ref(1);
const muted = ref(false);
const speed = ref(1);
const showControls = ref(true);
const sidebarOpen = ref(false);
const sidebarTab = ref<SidebarTab>('episodes');
const speedMenuOpen = ref(false);
const isFullscreen = ref(false);
const btDialogOpen = ref(false);
const message = ref('');
const activeTorrentFile = ref('');

const subtitleOptions = ref<SubtitleOption[]>([]);
const selectedSubtitleId = ref('off');
const subtitleCues = ref<SubtitleCue[]>([]);
const subtitleLoading = ref(false);
const qualityLevels = ref<QualityLevel[]>([]);
const qualityIndex = ref(-1);
const audioTracks = ref<AudioTrackInfo[]>([]);
const audioTrackIndex = ref(-1);

const castOpen = ref(false);
const castDevice = ref<DlnaDevice | null>(null);

const playMode = ref<PlayMode>(readPlayMode());
const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];

let hideTimer: ReturnType<typeof setTimeout> | null = null;
let messageTimer: ReturnType<typeof setTimeout> | null = null;
let dlnaTimer: ReturnType<typeof setInterval> | null = null;
let dlnaPolling = false;
let lastProgressEmit = 0;
let seekApplied = false;
let userPaused = false;
let hasPlayed = false;
let disposed = false;

const hasTorrent = computed(() => Boolean(torrent.value));
const canCast = computed(
  () => Boolean(watchData.value && watchData.value.type !== 'torrent'),
);
const castUrl = computed(() =>
  watchData.value && watchData.value.type !== 'torrent' ? watchData.value.url : '',
);
const castTitle = computed(() =>
  [props.detailTitle, props.episodeTitle].filter(Boolean).join(' · '),
);
const controlsVisible = computed(
  () =>
    showControls.value ||
    !isPlaying.value ||
    sidebarOpen.value ||
    speedMenuOpen.value ||
    Boolean(castDevice.value),
);
const progressPercent = computed(() =>
  duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0,
);
const qualityLabel = computed(() => {
  if (!qualityLevels.value.length) return '';
  if (qualityIndex.value < 0) return t('video.auto-quality');
  return (
    qualityLevels.value.find((level) => level.index === qualityIndex.value)?.label ??
    t('video.auto-quality')
  );
});
const subtitleText = computed(() =>
  subtitleCues.value
    .filter(
      (cue) =>
        currentTime.value >= cue.start && currentTime.value <= cue.end && cue.text,
    )
    .map((cue) => cue.text)
    .join('\n'),
);
const subtitleFontSize = computed(
  () => Number(settings.get<number>(SettingKey.subtitleFontSize, 46)) || 46,
);
const subtitleFontWeight = computed(() =>
  settings.get<string>(SettingKey.subtitleFontWeight, 'bold') === 'bold'
    ? '700'
    : '400',
);
const subtitleColor = computed(() =>
  argbToHex(settings.get<unknown>(SettingKey.subtitleFontColor, 0xffffffff)),
);
const subtitleBackgroundColor = computed(() =>
  argbToHex(settings.get<unknown>(SettingKey.subtitleBackgroundColor, 0xff000000)),
);
const subtitleBackgroundOpacity = computed(() =>
  clamp(
    Number(settings.get<number>(SettingKey.subtitleBackgroundOpacity, 0.5)),
    0,
    1,
  ),
);
const subtitleAlign = computed(() => settings.subtitleTextAlign);
const subtitleLayerStyle = computed<Record<string, string>>(() => ({
  fontSize: `${subtitleFontSize.value}px`,
  fontWeight: subtitleFontWeight.value,
  color: subtitleColor.value,
  textAlign: subtitleAlign.value,
  bottom: controlsVisible.value ? '112px' : '42px',
}));
const subtitleBackground = computed(() => {
  const digits = subtitleBackgroundColor.value.replace('#', '');
  const value = Number.parseInt(digits, 16);
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  return `rgba(${red}, ${green}, ${blue}, ${subtitleBackgroundOpacity.value})`;
});
const availableTabs = computed(() => {
  const tabs: { key: SidebarTab; label: string }[] = [
    { key: 'episodes', label: t('video.sidebar.tab.episodes') },
    { key: 'quality', label: t('video.sidebar.tab.qualitys') },
  ];
  if (hasTorrent.value) {
    tabs.push({ key: 'torrent', label: t('video.sidebar.tab.torrentFiles') });
  }
  tabs.push(
    { key: 'tracks', label: t('video.sidebar.tab.tracks') },
    { key: 'settings', label: t('video.sidebar.tab.settings') },
  );
  return tabs;
});

function readPlayMode(): PlayMode {
  try {
    const stored = localStorage.getItem('kiru.video.play-mode');
    if (stored === 'loop' || stored === 'single' || stored === 'auto') return stored;
  } catch {
    // localStorage may be unavailable.
  }
  return 'auto';
}

function showMessage(text: string, ms = 3000): void {
  message.value = text;
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    message.value = '';
    messageTimer = null;
  }, ms);
}

function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleHide(): void {
  clearHideTimer();
  if (!isPlaying.value || sidebarOpen.value || speedMenuOpen.value) return;
  hideTimer = setTimeout(() => {
    if (!sidebarOpen.value && !speedMenuOpen.value) showControls.value = false;
  }, 3000);
}

function wakeControls(): void {
  showControls.value = true;
  scheduleHide();
}

function onStageClick(): void {
  if (loading.value || error.value) return;
  showControls.value = !showControls.value;
  if (showControls.value) scheduleHide();
  else clearHideTimer();
}

function emitProgress(): void {
  if (!hasPlayed && !sourceReady.value && !castDevice.value) return;
  const total = Number.isFinite(duration.value) ? Math.max(0, duration.value) : 0;
  emit('progress', {
    progress: Math.max(0, Math.floor(currentTime.value)),
    total: Math.floor(total),
  });
}

function parseVttTime(value: string): number {
  const trimmed = value.trim();
  const parts = trimmed.split(':');
  if (parts.length < 2) return 0;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 3) {
    hours = Number(parts[0]) || 0;
    minutes = Number(parts[1]) || 0;
    seconds = Number.parseFloat(parts[2]) || 0;
  } else {
    minutes = Number(parts[0]) || 0;
    seconds = Number.parseFloat(parts[1]) || 0;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function parseVtt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split('\n').map((line) => line.trimEnd());
    const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeLineIndex < 0) continue;
    const [startRaw, endRaw] = lines[timeLineIndex].split('-->');
    if (!startRaw || !endRaw) continue;
    const start = parseVttTime(startRaw);
    const endToken = endRaw.trim().split(/\s+/)[0] ?? '';
    const end = parseVttTime(endToken);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const content = lines
      .slice(timeLineIndex + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (content) cues.push({ start, end, text: decodeEntities(content) });
  }
  return cues.sort((left, right) => left.start - right.start);
}

function parseDlnaTime(value: string): number {
  const parts = value.split(':');
  if (parts.length !== 3) return -1;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (![hours, minutes, seconds].every(Number.isFinite)) return -1;
  return hours * 3600 + minutes * 60 + seconds;
}

function stopHls(): void {
  if (hls.value) {
    hls.value.destroy();
    hls.value = null;
  }
  qualityLevels.value = [];
  audioTracks.value = [];
  audioTrackIndex.value = -1;
}

function clearVideoSource(): void {
  stopHls();
  const element = video.value;
  if (element) {
    element.pause();
    element.removeAttribute('src');
    element.load();
  }
}

function setSource(url: string, isHls: boolean): void {
  const element = video.value;
  if (!element || !url) {
    error.value = t('video.streamlink-error');
    return;
  }
  stopHls();
  sourceReady.value = false;
  buffering.value = true;
  seekApplied = false;
  hasPlayed = false;
  userPaused = false;
  currentTime.value = 0;
  duration.value = 0;
  if (isHls && Hls.isSupported()) {
    const instance = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 60,
      maxBufferLength: 45,
    });
    instance.on(Hls.Events.MANIFEST_PARSED, () => {
      if (disposed) return;
      refreshLevels(instance);
      refreshAudioTracks(instance);
      loading.value = false;
      buffering.value = false;
      void element.play().catch(() => undefined);
    });
    instance.on(Hls.Events.LEVEL_SWITCHED, () => {
      if (disposed) return;
      if (!instance.autoLevelEnabled) qualityIndex.value = instance.currentLevel;
    });
    instance.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
      refreshAudioTracks(instance);
    });
    instance.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => {
      audioTrackIndex.value = instance.audioTrack;
    });
    instance.on(Hls.Events.ERROR, (...args: unknown[]) => {
      const data = args[1] as
        | { fatal?: boolean; type?: string; details?: string }
        | undefined;
      if (!data?.fatal || disposed) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        showMessage(data.details || 'Network error');
        instance.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        instance.recoverMediaError();
        return;
      }
      error.value = data.details || t('video.streamlink-error');
      loading.value = false;
      buffering.value = false;
    });
    hls.value = instance;
    instance.loadSource(url);
    instance.attachMedia(element);
  } else if (isHls && element.canPlayType('application/vnd.apple.mpegurl')) {
    element.src = url;
    element.load();
  } else {
    element.src = url;
    element.load();
  }
}

function refreshLevels(instance: Hls): void {
  qualityLevels.value = instance.levels.map((level, index) => ({
    index,
    label: level.height
      ? `${level.height}p`
      : level.bitrate
        ? `${Math.round(level.bitrate / 1000)} kbps`
        : `#${index + 1}`,
  }));
  qualityIndex.value = instance.autoLevelEnabled ? -1 : instance.currentLevel;
}

function refreshAudioTracks(instance: Hls): void {
  const tracks = instance.audioTracks ?? [];
  audioTracks.value = tracks.map((track, index) => ({
    index,
    name: track.name || track.lang || `Audio ${index + 1}`,
    language: track.lang || '',
  }));
  audioTrackIndex.value = instance.audioTrack;
  const preferred = watchData.value?.audioTrack;
  if (!preferred) return;
  const needle = preferred.toLowerCase();
  const matched = tracks.findIndex((track) =>
    [track.name, track.lang, (track as { url?: string }).url].some((value) =>
      String(value ?? '').toLowerCase().includes(needle),
    ),
  );
  if (matched >= 0 && instance.audioTrack !== matched) {
    instance.audioTrack = matched;
    audioTrackIndex.value = matched;
  }
}

function selectQuality(index: number): void {
  const instance = hls.value;
  if (!instance) return;
  instance.currentLevel = index;
  qualityIndex.value = index;
}

function selectAudioTrack(index: number): void {
  const instance = hls.value;
  if (!instance) return;
  instance.audioTrack = index;
  audioTrackIndex.value = index;
}

function buildSubtitleOptions(): void {
  const list: SubtitleOption[] = [];
  const data = watchData.value;
  data?.subtitles?.forEach((subtitle, index) => {
    if (!subtitle.url) return;
    list.push({
      id: `ext-${index}`,
      title: subtitle.title || `Subtitle ${index + 1}`,
      language: subtitle.language,
      url: subtitle.url,
      source: 'extension',
    });
  });
  torrent.value?.subtitles.forEach((subtitle, index) => {
    list.push({
      id: `torrent-${index}`,
      title: subtitle.title || basename(subtitle.file),
      url: subtitle.url,
      source: 'torrent',
    });
  });
  subtitleOptions.value = list;
  subtitleCues.value = [];
  selectedSubtitleId.value = 'off';

  const lastTitle = settings.get<string>(SettingKey.subtitleLastTitleSelected, '');
  const lastLanguage = settings.get<string>(
    SettingKey.subtitleLastLanguageSelected,
    '',
  );
  const preferred = list.find(
    (option) =>
      (lastTitle && option.title === lastTitle) ||
      (lastLanguage && option.language === lastLanguage),
  );
  if (preferred) void selectSubtitle(preferred, false);
}

async function selectSubtitle(option: SubtitleOption, notify = true): Promise<void> {
  if (subtitleLoading.value) return;
  if (option.id === 'off') {
    selectedSubtitleId.value = 'off';
    subtitleCues.value = [];
    return;
  }
  subtitleLoading.value = true;
  try {
    let vtt = option.localVtt;
    if (!vtt) {
      if (!option.url) throw new Error('Subtitle URL is missing');
      const headers =
        option.source === 'extension' ? watchData.value?.headers : undefined;
      vtt = await fetchSubtitleVtt(option.url, headers, option.title);
    }
    subtitleCues.value = parseVtt(vtt);
    selectedSubtitleId.value = option.id;
    settings.setMany({
      [SettingKey.subtitleLastLanguageSelected]: option.language ?? '',
      [SettingKey.subtitleLastTitleSelected]: option.title,
    });
    if (!subtitleCues.value.length) {
      showMessage('The subtitle file contains no cues');
    }
  } catch (caught) {
    if (notify) showMessage(errorMessage(caught));
    selectedSubtitleId.value = 'off';
    subtitleCues.value = [];
  } finally {
    subtitleLoading.value = false;
  }
}

function turnOffSubtitle(): void {
  selectedSubtitleId.value = 'off';
  subtitleCues.value = [];
}

async function addLocalSubtitle(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      filters: [
        { name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] },
      ],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;
    const text = await call<string>('read_text_file', { path });
    const name = basename(path);
    const vtt = subtitleToVtt(text, name, path);
    const option: SubtitleOption = {
      id: `local-${Date.now()}`,
      title: name,
      source: 'local',
      localVtt: vtt,
    };
    subtitleOptions.value.push(option);
    subtitleCues.value = parseVtt(vtt);
    selectedSubtitleId.value = option.id;
    sidebarTab.value = 'tracks';
    sidebarOpen.value = true;
    showMessage(t('video.subtitle-change', { title: name }));
  } catch (caught) {
    showMessage(errorMessage(caught));
  }
}

async function loadWatch(): Promise<void> {
  disposed = false;
  loading.value = true;
  error.value = '';
  sourceReady.value = false;
  buffering.value = false;
  loadingLabel.value = t('video.getting-streamlink');
  btLoading.value = false;
  subtitleOptions.value = [];
  subtitleCues.value = [];
  selectedSubtitleId.value = 'off';
  clearVideoSource();
  if (torrent.value) {
    const old = torrent.value;
    torrent.value = null;
    void removeTorrent(old.infoHash);
  }
  try {
    const runtime = await extensions.ensureRuntime(props.packageName);
    const data = (await runtime.watch(props.episodeUrl)) as ExtensionBangumiWatch;
    if (disposed) return;
    if (!data || !data.url) throw new Error(t('video.streamlink-error'));
    watchData.value = data;

    if (data.type === 'torrent') {
      loadingLabel.value = t('video.torrent-downloading');
      btLoading.value = true;
      try {
        const stream = await resolveTorrentStream(data, (phase) => {
          if (phase === 'starting') loadingLabel.value = t('video.bt-starting');
          else if (phase === 'adding') loadingLabel.value = t('video.torrent-downloading');
          else loadingLabel.value = t('video.bt-reading-files');
        });
        if (disposed) {
          btLoading.value = false;
          void removeTorrent(stream.infoHash);
          return;
        }
        torrent.value = stream;
        activeTorrentFile.value = stream.mediaFile;
        buildSubtitleOptions();
        setSource(stream.streamUrl, false);
        btLoading.value = false;
      } catch (caught) {
        btLoading.value = false;
        error.value = errorMessage(caught);
        loading.value = false;
        btDialogOpen.value = true;
        emitProgress();
        return;
      }
    } else {
      buildSubtitleOptions();
      const isHls =
        data.type === 'hls' || /\.m3u8(?:$|[?#])/i.test(data.url);
      setSource(mediaUrl(data.url, data.headers), isHls);
    }
    loadingLabel.value = '';
  } catch (caught) {
    if (disposed) return;
    error.value = errorMessage(caught);
    loading.value = false;
  }
}

function retry(): void {
  void loadWatch();
}

function onBtReady(): void {
  btDialogOpen.value = false;
  retry();
}

async function switchTorrentFile(file: string): Promise<void> {
  if (!torrent.value || file === activeTorrentFile.value) return;
  try {
    const url = await torrentFileUrl(torrent.value.infoHash, file);
    activeTorrentFile.value = file;
    seekApplied = true;
    setSource(url, false);
    sidebarOpen.value = false;
    showMessage(basename(file));
  } catch (caught) {
    showMessage(errorMessage(caught));
  }
}

function onLoadedMetadata(): void {
  const element = video.value;
  if (!element) return;
  duration.value = Number.isFinite(element.duration)
    ? element.duration
    : 0;
  sourceReady.value = true;
  loading.value = false;
  buffering.value = false;
  if (!seekApplied) {
    seekApplied = true;
    const target = Number(props.initialProgress) || 0;
    if (target > 0 && duration.value > 5 && target < duration.value - 3) {
      element.currentTime = target;
      showMessage(t('video.resume-last-playback'));
    }
  }
  if (!userPaused) {
    void element.play().catch(() => undefined);
  }
  emitProgress();
}

function onDurationChange(): void {
  const element = video.value;
  if (!element) return;
  if (Number.isFinite(element.duration)) duration.value = element.duration;
}

function onTimeUpdate(): void {
  const element = video.value;
  if (!element) return;
  currentTime.value = element.currentTime;
  if (Number.isFinite(element.duration) && element.duration > 0) {
    duration.value = element.duration;
  }
  hasPlayed = true;
  const now = Date.now();
  if (now - lastProgressEmit > 5000) {
    lastProgressEmit = now;
    emitProgress();
  }
}

function onPlay(): void {
  isPlaying.value = true;
  userPaused = false;
  scheduleHide();
}

function onPause(): void {
  isPlaying.value = false;
  showControls.value = true;
  clearHideTimer();
  emitProgress();
}

function onEnded(): void {
  isPlaying.value = false;
  sourceReady.value = false;
  emitProgress();
  if (playMode.value === 'loop') {
    seekTo(0);
    void video.value?.play().catch(() => undefined);
    return;
  }
  if (playMode.value === 'single') {
    showMessage(t('video.play-complete'));
    return;
  }
  if (props.hasNext) {
    emit('next');
  } else {
    showMessage(t('video.play-complete'));
  }
}

function onVideoError(): void {
  if (hls.value) return;
  const element = video.value;
  if (!element || !element.src) return;
  error.value = t('video.streamlink-error');
  loading.value = false;
  buffering.value = false;
}

function onVolumeChange(): void {
  const element = video.value;
  if (!element) return;
  volume.value = element.volume;
  muted.value = element.muted;
}

function togglePlay(): void {
  if (castDevice.value) {
    const device = castDevice.value;
    const next = !isPlaying.value;
    isPlaying.value = next;
    void call('dlna_action', {
      controlUrl: device.controlUrl,
      serviceType: device.serviceType,
      action: next ? 'play' : 'pause',
      title: castTitle.value,
    }).catch((caught) => showMessage(errorMessage(caught)));
    return;
  }
  const element = video.value;
  if (!element) return;
  if (element.paused) {
    userPaused = false;
    void element.play().catch((caught) => showMessage(errorMessage(caught)));
  } else {
    userPaused = true;
    element.pause();
  }
}

function seekTo(seconds: number): void {
  const max = duration.value > 0 ? duration.value : seconds;
  const target = clamp(seconds, 0, Math.max(0, max));
  currentTime.value = target;
  if (castDevice.value) {
    const device = castDevice.value;
    void call('dlna_action', {
      controlUrl: device.controlUrl,
      serviceType: device.serviceType,
      action: 'seek',
      value: String(Math.floor(target)),
      title: castTitle.value,
    }).catch((caught) => showMessage(errorMessage(caught)));
    emitProgress();
    return;
  }
  if (video.value) video.value.currentTime = target;
  emitProgress();
}

function onSeekInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) seekTo(value);
}

function setVolumeValue(value: number): void {
  const element = video.value;
  if (!element) return;
  element.volume = clamp(value, 0, 1);
  if (element.volume > 0) element.muted = false;
}

function onVolumeInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) setVolumeValue(value);
}

function toggleMute(): void {
  const element = video.value;
  if (!element) return;
  element.muted = !element.muted;
}

function setSpeed(value: number): void {
  speed.value = value;
  if (video.value) video.value.playbackRate = value;
  speedMenuOpen.value = false;
}

function setPlayMode(mode: PlayMode): void {
  playMode.value = mode;
  try {
    localStorage.setItem('kiru.video.play-mode', mode);
  } catch {
    // Ignore unavailable storage.
  }
}

function toggleSidebar(tab?: SidebarTab): void {
  if (sidebarOpen.value && (!tab || sidebarTab.value === tab)) {
    sidebarOpen.value = false;
    return;
  }
  if (tab) sidebarTab.value = tab;
  sidebarOpen.value = true;
  speedMenuOpen.value = false;
  showControls.value = true;
}

function selectEpisode(index: number): void {
  if (index === props.currentIndex) return;
  sidebarOpen.value = false;
  emit('select-episode', index);
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await root.value?.requestFullscreen();
    }
  } catch (caught) {
    showMessage(errorMessage(caught));
  }
}

function onFullscreenChange(): void {
  isFullscreen.value = Boolean(document.fullscreenElement);
}

function handleCast(device: DlnaDevice): void {
  castDevice.value = device;
  video.value?.pause();
  isPlaying.value = false;
  startDlnaPolling();
  showMessage(t('video.cast-device', { device: device.name }));
}

function stopCast(): void {
  stopDlnaPolling();
  castDevice.value = null;
  const resumeAt = currentTime.value;
  const element = video.value;
  if (element) {
    element.currentTime = resumeAt;
    if (!userPaused) void element.play().catch(() => undefined);
  }
}

async function pollDlna(): Promise<void> {
  const device = castDevice.value;
  if (!device || dlnaPolling) return;
  dlnaPolling = true;
  try {
    const [info, position] = await Promise.all([
      call<DlnaResult>('dlna_action', {
        controlUrl: device.controlUrl,
        serviceType: device.serviceType,
        action: 'info',
        title: castTitle.value,
      }),
      call<DlnaResult>('dlna_action', {
        controlUrl: device.controlUrl,
        serviceType: device.serviceType,
        action: 'position',
        title: castTitle.value,
      }),
    ]);
    if (castDevice.value !== device || disposed) return;
    const state = String(info.state ?? '');
    if (state) isPlaying.value = state === 'PLAYING';
    const positionSeconds = parseDlnaTime(String(position.position ?? ''));
    const durationSeconds = parseDlnaTime(String(position.duration ?? ''));
    if (positionSeconds >= 0) currentTime.value = positionSeconds;
    if (durationSeconds > 0) duration.value = durationSeconds;
    hasPlayed = true;
    emitProgress();
  } catch {
    // Devices frequently fail a poll; keep trying.
  } finally {
    dlnaPolling = false;
  }
}

function startDlnaPolling(): void {
  stopDlnaPolling();
  void pollDlna();
  dlnaTimer = setInterval(() => {
    void pollDlna();
  }, 1500);
}

function stopDlnaPolling(): void {
  if (dlnaTimer) {
    clearInterval(dlnaTimer);
    dlnaTimer = null;
  }
  dlnaPolling = false;
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
  if (btDialogOpen.value || castOpen.value) return;
  if (isEditableTarget(event.target)) return;
  if (event.key === 'Escape') {
    if (sidebarOpen.value) {
      sidebarOpen.value = false;
      event.preventDefault();
      return;
    }
    if (speedMenuOpen.value) {
      speedMenuOpen.value = false;
      event.preventDefault();
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      event.preventDefault();
      return;
    }
    emit('exit');
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (error.value) return;

  const element = video.value;
  const current = castDevice.value ? currentTime.value : (element?.currentTime ?? 0);
  switch (event.key) {
    case ' ':
    case 'k':
    case 'K':
      event.preventDefault();
      togglePlay();
      break;
    case 'ArrowLeft': {
      event.preventDefault();
      const delta = Number(settings.get<number>(SettingKey.arrowLeft, -2)) || -2;
      seekTo(current + delta);
      break;
    }
    case 'ArrowRight': {
      event.preventDefault();
      const delta = Number(settings.get<number>(SettingKey.arrowRight, 2)) || 2;
      seekTo(current + delta);
      break;
    }
    case 'ArrowUp': {
      event.preventDefault();
      setVolumeValue((element?.volume ?? volume.value) + 0.05);
      break;
    }
    case 'ArrowDown': {
      event.preventDefault();
      setVolumeValue((element?.volume ?? volume.value) - 0.05);
      break;
    }
    case 'j':
    case 'J': {
      event.preventDefault();
      const delta = Number(settings.get<number>(SettingKey.keyJ, -10)) || -10;
      seekTo(current + delta);
      break;
    }
    case 'i':
    case 'I': {
      event.preventDefault();
      const delta = Number(settings.get<number>(SettingKey.keyI, 10)) || 10;
      seekTo(current + delta);
      break;
    }
    case 'f':
    case 'F':
      event.preventDefault();
      void toggleFullscreen();
      break;
    case 'm':
    case 'M':
      event.preventDefault();
      toggleMute();
      break;
    default:
      break;
  }
}

function onBeforeUnload(): void {
  emitProgress();
}

function updateSubtitleFontSize(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) {
    settings.set(SettingKey.subtitleFontSize, value);
  }
}

function updateSubtitleBackgroundOpacity(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) {
    settings.set(SettingKey.subtitleBackgroundOpacity, value);
  }
}

function argbFromHex(value: string): number {
  return (0xff000000 | Number.parseInt(value.replace('#', ''), 16)) >>> 0;
}

function updateSubtitleFontColor(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  settings.set(SettingKey.subtitleFontColor, argbFromHex(value));
}

function updateSubtitleBackgroundColor(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  settings.set(SettingKey.subtitleBackgroundColor, argbFromHex(value));
}

function updateSubtitleWeight(event: Event): void {
  settings.set(
    SettingKey.subtitleFontWeight,
    (event.target as HTMLSelectElement).value,
  );
}

function updateSubtitleAlign(event: Event): void {
  const align = (event.target as HTMLSelectElement).value;
  const index = textAligns.indexOf(align as (typeof textAligns)[number]);
  settings.set(SettingKey.subtitleTextAlign, index >= 0 ? index : 2);
}

watch(isPlaying, scheduleHide);
watch([sidebarOpen, speedMenuOpen], () => {
  if (sidebarOpen.value || speedMenuOpen.value) clearHideTimer();
  else scheduleHide();
});

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('beforeunload', onBeforeUnload);
  void loadWatch();
});

onBeforeUnmount(() => {
  disposed = true;
  if (sourceReady.value || hasPlayed) emitProgress();
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('beforeunload', onBeforeUnload);
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  }
  video.value?.pause();
  stopHls();
  stopDlnaPolling();
  if (torrent.value) {
    void removeTorrent(torrent.value.infoHash);
    torrent.value = null;
  }
  if (hideTimer) clearTimeout(hideTimer);
  if (messageTimer) clearTimeout(messageTimer);
});
</script>

<template>
  <div
    ref="root"
    class="video-watch"
    @mousemove="wakeControls"
    @mouseleave="isPlaying && !sidebarOpen && (showControls = false)"
  >
    <video
      ref="video"
      class="video-el"
      :class="{ 'cast-hidden': Boolean(castDevice) }"
      playsinline
      preload="auto"
      @loadedmetadata="onLoadedMetadata"
      @durationchange="onDurationChange"
      @timeupdate="onTimeUpdate"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
      @volumechange="onVolumeChange"
      @waiting="buffering = true"
      @playing="buffering = false"
      @canplay="buffering = false"
      @error="onVideoError"
      @click="onStageClick"
      @dblclick.stop="toggleFullscreen"
    />

    <div v-if="castDevice" class="cast-stage">
      <div class="cast-badge"><Tv :size="34" /></div>
      <div class="cast-name">{{ t('video.cast-device', { device: castDevice.name }) }}</div>
      <div class="cast-model">{{ castDevice.model || castDevice.location }}</div>
      <button class="btn btn-sm" @click="castOpen = true">
        <Cast :size="13" />
        {{ t('video.cast') }}
      </button>
    </div>

    <div
      v-if="subtitleText && !castDevice && selectedSubtitleId !== 'off'"
      class="subtitle-layer"
      :style="subtitleLayerStyle"
    >
      <span class="subtitle-text" :style="{ background: subtitleBackground }">
        {{ subtitleText }}
      </span>
    </div>

    <div class="vignette" :class="{ visible: controlsVisible }" />

    <div v-if="loading && !error" class="player-overlay loading-overlay">
      <div class="spinner lg" />
      <div class="loading-copy">
        {{ loadingLabel || t('video.getting-streamlink') }}
      </div>
      <button
        v-if="btLoading"
        class="btn btn-sm"
        @click.stop="btDialogOpen = true"
      >
        {{ t('settings.bt-server') }}
      </button>
    </div>

    <div v-else-if="error" class="player-overlay error-overlay">
      <AlertTriangle :size="34" class="error-icon" />
      <div class="error-title">{{ t('video.streamlink-error') }}</div>
      <div class="error-text">{{ error }}</div>
      <div class="error-actions">
        <button class="btn btn-primary" @click="retry">
          <RefreshCw :size="14" />
          {{ t('common.retry') }}
        </button>
        <button class="btn" @click="emit('exit')">{{ t('common.close') }}</button>
      </div>
    </div>

    <div v-if="buffering && !loading && !error && !castDevice" class="buffer-indicator">
      <div class="spinner" />
    </div>

    <Transition name="control">
      <header v-if="controlsVisible" class="top-bar" @click.stop>
        <button class="icon-button" :title="t('video.tooltip.close')" @click="emit('exit')">
          <ChevronLeft :size="20" />
        </button>
        <div class="title-copy">
          <div class="title-line">{{ detailTitle }}</div>
          <div class="episode-line">{{ episodeTitle }}</div>
        </div>
        <div class="spacer" />
        <button
          class="icon-button"
          :class="{ active: castDevice }"
          :title="t('video.cast')"
          :disabled="!canCast"
          @click="castOpen = true"
        >
          <Cast :size="18" />
        </button>
        <button
          class="icon-button"
          :title="t('video.tooltip.play-list')"
          @click="toggleSidebar('episodes')"
        >
          <List :size="19" />
        </button>
      </header>
    </Transition>

    <Transition name="control">
      <div v-if="controlsVisible && !loading && !error" class="center-controls" @click.stop>
        <button
          class="round-button"
          :disabled="!hasPrevious"
          :title="t('video.tooltip.previous')"
          @click="emit('previous')"
        >
          <SkipBack :size="21" fill="currentColor" />
        </button>
        <button class="round-button primary" @click="togglePlay">
          <Pause v-if="isPlaying" :size="27" fill="currentColor" />
          <Play v-else :size="27" fill="currentColor" />
        </button>
        <button
          class="round-button"
          :disabled="!hasNext"
          :title="t('video.tooltip.next')"
          @click="emit('next')"
        >
          <SkipForward :size="21" fill="currentColor" />
        </button>
      </div>
    </Transition>

    <Transition name="control">
      <footer v-if="controlsVisible" class="bottom-bar" @click.stop>
        <div class="seek-row">
          <span class="time">{{ formatSeconds(currentTime) }}</span>
          <input
            class="seek"
            type="range"
            min="0"
            :max="duration > 0 ? duration : 0"
            step="0.1"
            :value="currentTime"
            :style="{ '--progress': `${progressPercent}%` }"
            :disabled="duration <= 0"
            @input="onSeekInput"
          />
          <span class="time">{{ formatSeconds(duration) }}</span>
        </div>
        <div class="control-row">
          <button class="icon-button" :title="t('video.tooltip.play-or-pause')" @click="togglePlay">
            <Pause v-if="isPlaying" :size="18" fill="currentColor" />
            <Play v-else :size="18" fill="currentColor" />
          </button>
          <button
            class="icon-button"
            :disabled="!hasPrevious"
            :title="t('video.tooltip.previous')"
            @click="emit('previous')"
          >
            <SkipBack :size="17" />
          </button>
          <button
            class="icon-button"
            :disabled="!hasNext"
            :title="t('video.tooltip.next')"
            @click="emit('next')"
          >
            <SkipForward :size="17" />
          </button>

          <div class="volume-group">
            <button class="icon-button" :title="t('video.tooltip.volume')" @click="toggleMute">
              <VolumeX v-if="muted || volume === 0" :size="17" />
              <Volume2 v-else :size="17" />
            </button>
            <input
              class="volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              :value="muted ? 0 : volume"
              @input="onVolumeInput"
            />
          </div>

          <span class="episode-chip">
            {{ episodeTitle }}
          </span>

          <div class="spacer" />

          <div class="menu-anchor">
            <button class="text-button" @click="speedMenuOpen = !speedMenuOpen; showControls = true">
              <Gauge :size="16" />
              {{ speed === 1 ? '1.0x' : `${speed}x` }}
            </button>
            <Transition name="control">
              <div v-if="speedMenuOpen" class="popover speed-popover">
                <div class="popover-title">{{ t('video.tooltip.speed') }}</div>
                <button
                  v-for="value in speeds"
                  :key="value"
                  class="popover-row"
                  :class="{ selected: speed === value }"
                  @click="setSpeed(value)"
                >
                  {{ value }}x
                </button>
              </div>
            </Transition>
          </div>

          <div class="menu-anchor">
            <button
              class="text-button"
              :class="{ active: qualityIndex !== -1 && qualityLevels.length }"
              :title="t('video.tooltip.quality')"
              @click="toggleSidebar('quality')"
            >
              <Settings :size="15" />
              {{ qualityLabel || t('video.tooltip.quality') }}
            </button>
          </div>

          <button
            class="icon-button"
            :class="{ active: selectedSubtitleId !== 'off' }"
            :title="t('video.tooltip.subtitle')"
            @click="toggleSidebar('tracks')"
          >
            <Subtitles :size="18" />
          </button>
          <button
            class="icon-button"
            :class="{ active: activeTorrentFile && hasTorrent }"
            :title="t('video.tooltip.torrent-file-list')"
            @click="toggleSidebar('torrent')"
          >
            <FileText :size="17" />
          </button>
          <button class="icon-button" :title="t('video.tooltip.play-list')" @click="toggleSidebar('episodes')">
            <List :size="18" />
          </button>
          <button
            class="icon-button"
            :title="t('video.tooltip.full-screen')"
            @click="toggleFullscreen"
          >
            <Minimize v-if="isFullscreen" :size="18" />
            <Maximize v-else :size="18" />
          </button>
        </div>
      </footer>
    </Transition>

    <Transition name="fade">
      <div v-if="sidebarOpen" class="sidebar-scrim" @click="sidebarOpen = false" />
    </Transition>

    <Transition name="sidebar">
      <aside v-if="sidebarOpen" class="sidebar" @click.stop>
        <header class="sidebar-head">
          <div class="sidebar-tabs">
            <button
              v-for="tab in availableTabs"
              :key="tab.key"
              class="sidebar-tab"
              :class="{ active: sidebarTab === tab.key }"
              @click="sidebarTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>
          <button class="icon-button" @click="sidebarOpen = false">
            <X :size="17" />
          </button>
        </header>

        <div class="sidebar-body">
          <template v-if="sidebarTab === 'episodes'">
            <div v-if="episodes.length" class="episode-list">
              <button
                v-for="(episode, index) in episodes"
                :key="`${index}-${episode.url}`"
                class="episode-row"
                :class="{ current: index === currentIndex }"
                @click="selectEpisode(index)"
              >
                <span class="episode-number">{{ String(index + 1).padStart(2, '0') }}</span>
                <span class="episode-name">{{ episode.name || t('common.episode-number', { index: index + 1 }) }}</span>
                <Play v-if="index === currentIndex" :size="12" fill="currentColor" />
              </button>
            </div>
            <div v-else class="sidebar-empty">{{ t('video.no-episodes') }}</div>
          </template>

          <template v-else-if="sidebarTab === 'quality'">
            <button
              class="option-row"
              :class="{ selected: qualityIndex === -1 }"
              @click="selectQuality(-1)"
            >
              <span>{{ t('video.auto-quality') }}</span>
              <span v-if="qualityIndex === -1" class="option-dot" />
            </button>
            <button
              v-for="level in qualityLevels"
              :key="level.index"
              class="option-row"
              :class="{ selected: qualityIndex === level.index }"
              @click="selectQuality(level.index)"
            >
              <span>{{ level.label }}</span>
              <span v-if="qualityIndex === level.index" class="option-dot" />
            </button>
            <div v-if="!qualityLevels.length" class="sidebar-empty">
              {{ t('video.no-qualities') }}
            </div>
          </template>

          <template v-else-if="sidebarTab === 'torrent'">
            <div v-if="torrent" class="file-list">
              <button
                v-for="file in torrent.files.filter((item) => isVideoFile(item) || !isSubtitleFile(item))"
                :key="file"
                class="option-row file-row"
                :class="{ selected: file === activeTorrentFile }"
                @click="switchTorrentFile(file)"
              >
                <span class="file-name">{{ basename(file) }}</span>
                <Play v-if="file === activeTorrentFile" :size="12" fill="currentColor" />
              </button>
            </div>
            <div v-else class="sidebar-empty">{{ t('video.torrent-downloading') }}</div>
          </template>

          <template v-else-if="sidebarTab === 'tracks'">
            <div class="section-label">{{ t('video.subtitle') }}</div>
            <button
              class="option-row"
              :class="{ selected: selectedSubtitleId === 'off' }"
              @click="turnOffSubtitle"
            >
              <span>{{ t('video.subtitle-none') }}</span>
              <span v-if="selectedSubtitleId === 'off'" class="option-dot" />
            </button>
            <button
              v-for="option in subtitleOptions"
              :key="option.id"
              class="option-row subtitle-row"
              :class="{ selected: selectedSubtitleId === option.id }"
              :disabled="subtitleLoading"
              @click="selectSubtitle(option)"
            >
              <span class="subtitle-title">{{ option.title }}</span>
              <span v-if="option.language" class="subtitle-language">{{ option.language }}</span>
              <span v-if="selectedSubtitleId === option.id" class="option-dot" />
            </button>
            <button class="btn btn-sm add-subtitle" @click="addLocalSubtitle">
              <FileText :size="13" />
              {{ t('video.subtitle-file') }}
            </button>

            <template v-if="audioTracks.length">
              <div class="section-label">{{ t('video.audio') }}</div>
              <button
                v-for="track in audioTracks"
                :key="track.index"
                class="option-row"
                :class="{ selected: audioTrackIndex === track.index }"
                @click="selectAudioTrack(track.index)"
              >
                <span class="audio-name">
                  <Music :size="13" />
                  {{ track.name }}
                  <span v-if="track.language" class="subtitle-language">{{ track.language }}</span>
                </span>
                <span v-if="audioTrackIndex === track.index" class="option-dot" />
              </button>
            </template>
          </template>

          <template v-else>
            <div class="section-label">{{ t('video.sidebar.play-mode.title') }}</div>
            <div class="segmented">
              <button
                class="segment"
                :class="{ active: playMode === 'auto' }"
                @click="setPlayMode('auto')"
              >
                {{ t('video.sidebar.play-mode.auto-next') }}
              </button>
              <button
                class="segment"
                :class="{ active: playMode === 'loop' }"
                @click="setPlayMode('loop')"
              >
                {{ t('video.sidebar.play-mode.loop') }}
              </button>
              <button
                class="segment"
                :class="{ active: playMode === 'single' }"
                @click="setPlayMode('single')"
              >
                {{ t('video.sidebar.play-mode.single') }}
              </button>
            </div>

            <div class="section-label subtitle-section">
              {{ t('video.sidebar.subtitle.title') }}
            </div>
            <label class="setting-row">
              <span>{{ t('video.sidebar.subtitle.font-size') }}</span>
              <span class="setting-value">{{ subtitleFontSize }}px</span>
            </label>
            <input
              class="wide-slider"
              type="range"
              min="12"
              max="80"
              step="1"
              :value="subtitleFontSize"
              @input="updateSubtitleFontSize"
            />
            <label class="setting-row">
              <span>{{ t('video.sidebar.subtitle.font-color') }}</span>
              <input type="color" class="color-input" :value="subtitleColor" @input="updateSubtitleFontColor" />
            </label>
            <label class="setting-row">
              <span>{{ t('video.sidebar.subtitle.background-color') }}</span>
              <input
                type="color"
                class="color-input"
                :value="subtitleBackgroundColor"
                @input="updateSubtitleBackgroundColor"
              />
            </label>
            <label class="setting-row">
              <span>{{ t('video.sidebar.subtitle.background-opacity') }}</span>
              <span class="setting-value">{{ Math.round(subtitleBackgroundOpacity * 100) }}%</span>
            </label>
            <input
              class="wide-slider"
              type="range"
              min="0"
              max="1"
              step="0.05"
              :value="subtitleBackgroundOpacity"
              @input="updateSubtitleBackgroundOpacity"
            />
            <label class="setting-row">
              <span>{{ t('video.sidebar.subtitle.text-align') }}</span>
              <select
                class="select compact"
                :value="subtitleAlign"
                @change="updateSubtitleAlign"
              >
                <option v-for="align in textAligns" :key="align" :value="align">
                  {{ align }}
                </option>
              </select>
            </label>
            <label class="setting-row">
              <span>{{ t('video.sidebar.subtitle.font-weight') }}</span>
              <select
                class="select compact"
                :value="subtitleFontWeight === '700' ? 'bold' : 'normal'"
                @change="updateSubtitleWeight"
              >
                <option value="normal">{{ t('video.sidebar.subtitle.font-weight-normal') }}</option>
                <option value="bold">{{ t('video.sidebar.subtitle.font-weight-bold') }}</option>
              </select>
            </label>
          </template>
        </div>
      </aside>
    </Transition>

    <Transition name="fade">
      <div v-if="message" class="player-message">{{ message }}</div>
    </Transition>

    <BtManagerDialog :open="btDialogOpen" @close="btDialogOpen = false" @ready="onBtReady" />
    <DlnaDialog
      :open="castOpen"
      :url="castUrl"
      :title="castTitle"
      :active-device="castDevice"
      @close="castOpen = false"
      @cast="handleCast"
      @stop="stopCast"
    />
  </div>
</template>

<style scoped>
.video-watch {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: #fff;
  background: #000;
  user-select: none;
}

.video-el {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
  outline: none;
}

.video-el.cast-hidden {
  opacity: 0;
}

.cast-stage {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  background: radial-gradient(circle at 50% 42%, #1c2230, #050608 68%);
}

.cast-badge {
  display: grid;
  place-items: center;
  width: 86px;
  height: 86px;
  margin-bottom: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.cast-name {
  font-size: 18px;
  font-weight: 650;
}

.cast-model {
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  margin-bottom: 10px;
}

.subtitle-layer {
  position: absolute;
  left: 6%;
  right: 6%;
  z-index: 4;
  pointer-events: none;
  transition: bottom 0.2s ease;
  line-height: 1.45;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.7);
  white-space: pre-line;
}

.subtitle-text {
  display: inline-block;
  max-width: 100%;
  padding: 2px 12px 3px;
  border-radius: 4px;
  white-space: pre-line;
}

.vignette {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease;
  background:
    linear-gradient(to bottom, rgba(0, 0, 0, 0.72), transparent 22%),
    linear-gradient(to top, rgba(0, 0, 0, 0.84), transparent 30%);
}

.vignette.visible {
  opacity: 1;
}

.player-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
  background: rgba(3, 4, 7, 0.82);
}

.loading-copy {
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
}

.error-icon {
  color: var(--warning);
}

.error-title {
  font-size: 16px;
  font-weight: 650;
}

.error-text {
  max-width: 620px;
  max-height: 30vh;
  overflow: auto;
  color: rgba(255, 255, 255, 0.62);
  font-size: 12px;
  white-space: pre-wrap;
}

.error-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.buffer-indicator {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.top-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 66px;
  padding: 10px 18px 18px;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.7), transparent);
}

.top-bar .icon-button,
.bottom-bar .icon-button {
  color: rgba(255, 255, 255, 0.86);
}

.top-bar .icon-button:hover,
.bottom-bar .icon-button:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.title-copy {
  min-width: 0;
  padding-left: 4px;
}

.title-line {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
}

.episode-line {
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.58);
  font-size: 11.5px;
  white-space: nowrap;
}

.spacer {
  flex: 1;
}

.icon-button {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  transition: background 0.14s ease, color 0.14s ease;
}

.icon-button:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text);
}

.icon-button.active {
  color: var(--accent);
}

.icon-button:disabled {
  opacity: 0.35;
  cursor: default;
}

.center-controls {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 22px;
  transform: translate(-50%, -50%);
}

.round-button {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 50%;
  background: rgba(14, 17, 23, 0.6);
  color: #fff;
  backdrop-filter: blur(6px);
  transition: transform 0.15s ease, background 0.15s ease;
}

.round-button:hover:not(:disabled) {
  background: rgba(38, 43, 54, 0.8);
  transform: scale(1.05);
}

.round-button.primary {
  width: 66px;
  height: 66px;
  border-color: transparent;
  background: var(--accent);
  color: #fff;
}

.round-button.primary:hover {
  background: var(--accent-hover);
}

.round-button:disabled {
  opacity: 0.3;
  cursor: default;
}

.bottom-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 12;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 26px 18px 12px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.84), transparent);
}

.seek-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.time {
  min-width: 42px;
  color: rgba(255, 255, 255, 0.72);
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

input[type='range'] {
  accent-color: var(--accent);
}

.seek {
  flex: 1;
  height: 4px;
  margin: 0;
  cursor: pointer;
  appearance: none;
  border-radius: 99px;
  background: linear-gradient(
    to right,
    var(--accent) var(--progress, 0%),
    rgba(255, 255, 255, 0.24) var(--progress, 0%)
  );
}

.seek::-webkit-slider-thumb {
  width: 12px;
  height: 12px;
  appearance: none;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.4);
}

.seek:disabled {
  opacity: 0.4;
  cursor: default;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 36px;
}

.volume-group {
  display: flex;
  align-items: center;
  gap: 0;
}

.volume {
  width: 74px;
  height: 4px;
  margin: 0 6px 0 0;
  cursor: pointer;
  appearance: none;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.24);
}

.volume::-webkit-slider-thumb {
  width: 10px;
  height: 10px;
  appearance: none;
  border-radius: 50%;
  background: #fff;
}

.episode-chip {
  max-width: 190px;
  margin-left: 10px;
  overflow: hidden;
  padding: 3px 9px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.65);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font-size: 11px;
}

.text-button:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.text-button.active {
  color: var(--accent);
}

.menu-anchor {
  position: relative;
}

.popover {
  position: absolute;
  bottom: calc(100% + 9px);
  right: 0;
  z-index: 30;
  min-width: 145px;
  padding: 7px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: rgba(20, 23, 30, 0.97);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
}

.popover-title {
  padding: 2px 8px 6px;
  color: rgba(255, 255, 255, 0.42);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.popover-row {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  text-align: left;
}

.popover-row:hover {
  background: rgba(255, 255, 255, 0.08);
}

.popover-row.selected {
  color: var(--accent);
}

.speed-popover {
  max-height: 290px;
  overflow-y: auto;
}

.sidebar-scrim {
  position: absolute;
  inset: 0;
  z-index: 14;
  background: rgba(0, 0, 0, 0.4);
}

.sidebar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 15;
  display: flex;
  flex-direction: column;
  width: min(360px, 86vw);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(16, 18, 24, 0.97);
  box-shadow: -20px 0 50px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(14px);
}

.sidebar-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.sidebar-tabs {
  display: flex;
  flex: 1;
  gap: 1px;
  overflow-x: auto;
}

.sidebar-tab {
  flex: 0 0 auto;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.48);
  font-size: 11px;
  white-space: nowrap;
}

.sidebar-tab:hover {
  color: rgba(255, 255, 255, 0.8);
}

.sidebar-tab.active {
  background: rgba(255, 255, 255, 0.09);
  color: #fff;
}

.sidebar .icon-button {
  color: rgba(255, 255, 255, 0.6);
}

.sidebar .icon-button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.sidebar-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
}

.episode-list,
.file-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.episode-row,
.option-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 9px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  text-align: left;
}

.episode-row:hover,
.option-row:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}

.episode-row.current,
.option-row.selected {
  background: rgba(255, 125, 147, 0.13);
  color: #fff;
}

.episode-number {
  flex: 0 0 24px;
  color: rgba(255, 255, 255, 0.35);
  font-family: var(--font-mono);
  font-size: 10px;
}

.episode-name,
.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-row {
  justify-content: space-between;
}

.option-row:disabled {
  opacity: 0.55;
}

.option-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: var(--accent);
}

.subtitle-row {
  align-items: center;
}

.subtitle-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subtitle-language {
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.42);
  font-size: 9.5px;
  text-transform: uppercase;
}

.audio-name {
  display: flex;
  align-items: center;
  gap: 6px;
}

.section-label {
  margin: 12px 7px 6px;
  color: rgba(255, 255, 255, 0.36);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.section-label:first-child {
  margin-top: 3px;
}

.subtitle-section {
  margin-top: 20px;
}

.sidebar-empty {
  padding: 32px 12px;
  color: rgba(255, 255, 255, 0.34);
  font-size: 12px;
  text-align: center;
}

.add-subtitle {
  width: 100%;
  margin-top: 8px;
}

.segmented {
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
}

.segment {
  flex: 1;
  height: 29px;
  padding: 0 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
}

.segment.active {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 11px;
  color: rgba(255, 255, 255, 0.68);
  font-size: 11.5px;
}

.setting-value {
  color: rgba(255, 255, 255, 0.4);
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.wide-slider {
  width: 100%;
  height: 4px;
  margin: 9px 0 2px;
  cursor: pointer;
  appearance: none;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.2);
}

.wide-slider::-webkit-slider-thumb {
  width: 12px;
  height: 12px;
  appearance: none;
  border-radius: 50%;
  background: var(--accent);
}

.color-input {
  width: 34px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
}

.select.compact {
  height: 27px;
  padding: 0 7px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.75);
  font-size: 11px;
}

.select.compact option {
  color: #fff;
  background: #1a1d24;
}

.player-message {
  position: absolute;
  left: 50%;
  bottom: 125px;
  z-index: 25;
  max-width: 70vw;
  padding: 8px 15px;
  border-radius: 8px;
  background: rgba(10, 12, 17, 0.88);
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
  text-align: center;
  transform: translateX(-50%);
  backdrop-filter: blur(8px);
}

.control-enter-active,
.control-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.control-enter-from,
.control-leave-to {
  opacity: 0;
}

.center-controls.control-enter-from,
.center-controls.control-leave-to {
  transform: translate(-50%, -50%) scale(0.96);
}

.sidebar-enter-active,
.sidebar-leave-active {
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}

.sidebar-enter-from,
.sidebar-leave-to {
  transform: translateX(100%);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.16s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
