<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getVersion } from '@tauri-apps/api/app';
import {
  BookOpen,
  Bug,
  ChevronRight,
  Download,
  ExternalLink,
  Globe2,
  HardDrive,
  Info,
  ListVideo,
  Play,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-vue-next';
import logo from '../assets/logo.png';
import BtManagerDialog from '../components/BtManagerDialog.vue';
import SettingsRow from '../components/SettingsRow.vue';
import SwitchToggle from '../components/SwitchToggle.vue';
import { languageOptions } from '../i18n';
import {
  DEFAULT_WINDOWS_UA,
  SettingKey,
} from '../lib/defaults';
import { applyNetworkConfig } from '../lib/http';
import { call } from '../lib/tauri';
import { isTauri } from '../lib/util';
import { useSettingsStore } from '../stores/settings';
import { useUiStore } from '../stores/ui';
import type { MangaReadMode } from '../types/models';

const { t } = useI18n();
const settings = useSettingsStore();
const ui = useUiStore();

const appVersion = ref('0.1.0');
const btOpen = ref(false);
const exporting = ref(false);
const activeSection = ref('general');

const tmdbDraft = ref(String(settings.get(SettingKey.tmdbKey, '')));
const repoDraft = ref(settings.repoUrl);
const uaDraft = ref(String(settings.get(SettingKey.windowsWebviewUA, DEFAULT_WINDOWS_UA)));
const proxyDraft = ref(String(settings.get(SettingKey.proxy, '')));

const theme = computed(() => settings.theme);
const language = computed(() => settings.language);
const videoPlayer = computed(() =>
  String(settings.get(SettingKey.videoPlayer, 'built-in')),
);
const proxyType = computed(() =>
  String(settings.get(SettingKey.proxyType, 'DIRECT')),
);

const sections = computed(() => [
  { id: 'general', label: t('settings.general'), icon: SlidersHorizontal },
  { id: 'extensions', label: t('settings.extension'), icon: Sparkles },
  { id: 'video', label: t('settings.video-player'), icon: Play },
  { id: 'reader', label: t('settings.comic-reader'), icon: BookOpen },
  { id: 'tracking', label: t('settings.tracking'), icon: ListVideo },
  { id: 'network', label: t('settings.network'), icon: Globe2 },
  { id: 'logs', label: t('settings.log'), icon: Bug },
  { id: 'about', label: t('settings.about'), icon: Info },
]);

const themes = computed(() => [
  { value: 'system', label: t('settings.theme-system') },
  { value: 'light', label: t('settings.theme-light') },
  { value: 'dark', label: t('settings.theme-dark') },
]);

const readingModes = computed<{ value: MangaReadMode; label: string }[]>(() => [
  { value: 'standard', label: t('comic-settings.standard') },
  { value: 'rightToLeft', label: t('comic-settings.right-to-left') },
  { value: 'webTonn', label: t('comic-settings.web-tonn') },
]);

const players = computed(() => {
  const list = [{ value: 'built-in', label: t('settings.external-player-builtin') }];
  const userAgent = navigator.userAgent;
  const android = /Android/i.test(userAgent);
  const linux = /Linux/i.test(userAgent) && !android;
  const mac = /Macintosh|Mac OS X/i.test(userAgent);
  if (!android) {
    list.push({ value: 'vlc', label: 'VLC' });
    list.push(
      linux || mac
        ? { value: 'mpv', label: 'mpv' }
        : { value: 'potplayer', label: 'PotPlayer' },
    );
  }
  return list;
});

const videoPlayerLabel = computed(
  () => players.value.find((player) => player.value === videoPlayer.value)?.label ?? videoPlayer.value,
);

const proxyTypes = computed(() => [
  { value: 'DIRECT', label: t('settings.proxy-type-direct') },
  { value: 'SOCKS5', label: t('settings.proxy-type-socks5') },
  { value: 'SOCKS4', label: t('settings.proxy-type-socks4') },
  { value: 'PROXY', label: t('settings.proxy-type-http') },
]);

const links = computed(() => [
  { label: 'Miru project', url: 'https://github.com/miru-project/miru-app' },
  { label: 'Tauri', url: 'https://tauri.app' },
  { label: 'Vue', url: 'https://vuejs.org' },
]);

function selectValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

function toggleSetting(key: string, value: boolean): void {
  settings.set(key, value);
}

function setTheme(value: string): void {
  settings.set(SettingKey.theme, value);
}

function saveTmdbKey(): void {
  const key = tmdbDraft.value.trim();
  tmdbDraft.value = key;
  settings.set(SettingKey.tmdbKey, key);
  ui.notify(t('common.save-success'), 'success');
}

function saveRepoUrl(): void {
  const value = repoDraft.value.trim();
  settings.repoUrl = value;
  repoDraft.value = settings.repoUrl;
  ui.notify(t('common.save-success'), 'success');
}

function saveUserAgent(): void {
  const value = uaDraft.value.trim() || DEFAULT_WINDOWS_UA;
  uaDraft.value = value;
  settings.set(SettingKey.windowsWebviewUA, value);
  ui.notify(t('common.save-success'), 'success');
}

function applyProxy(): void {
  const value = proxyDraft.value.trim();
  proxyDraft.value = value;
  settings.set(SettingKey.proxy, value);
  void applyNetworkConfig();
}

function changeProxyType(event: Event): void {
  settings.set(SettingKey.proxyType, selectValue(event));
  void applyNetworkConfig();
}

function numberValue(key: string, fallback: number): number {
  const value = Number(settings.get<number>(key, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function setNumber(key: string, event: Event, fallback: number): void {
  const value = Number(inputValue(event));
  if (!Number.isFinite(value)) {
    settings.set(key, fallback);
    return;
  }
  settings.set(key, value);
}

function openExternal(url: string): void {
  void openUrl(url).catch((error) => ui.notifyError(error));
}

function openTmdbApi(): void {
  openExternal('https://www.themoviedb.org/settings/api');
}

const scroller = ref<HTMLElement | null>(null);
let scrollFrame = 0;

function updateActiveSection(): void {
  scrollFrame = 0;
  const container = scroller.value;
  if (!container) return;
  const threshold = container.getBoundingClientRect().top + 90;
  let current = sections.value[0]?.id ?? 'general';
  for (const section of sections.value) {
    const element = document.getElementById(section.id);
    if (!element) continue;
    if (element.getBoundingClientRect().top <= threshold) current = section.id;
  }
  if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
    const last = sections.value[sections.value.length - 1];
    if (last) current = last.id;
  }
  if (activeSection.value !== current) activeSection.value = current;
}

function onScroll(): void {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(updateActiveSection);
}

function scrollToSection(id: string): void {
  activeSection.value = id;
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function exportLog(): Promise<void> {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const target = await saveDialog({
      defaultPath: 'kiru.log',
      filters: [{ name: 'Log', extensions: ['log', 'txt'] }],
    });
    if (!target) return;
    await call('log_export', { target });
    ui.notify(t('settings.log-exported'), 'success');
  } catch (error) {
    ui.notifyError(error);
  } finally {
    exporting.value = false;
  }
}

onMounted(async () => {
  await nextTick();
  scroller.value?.addEventListener('scroll', onScroll, { passive: true });
  updateActiveSection();
});

onMounted(async () => {
  if (!isTauri()) return;
  try {
    appVersion.value = await getVersion();
  } catch {
    appVersion.value = '0.1.0';
  }
});

onBeforeUnmount(() => {
  scroller.value?.removeEventListener('scroll', onScroll);
  if (scrollFrame) {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }
});
</script>

<template>
  <div ref="scroller" class="page-scroll">
    <div class="page">
      <header class="page-header">
        <div>
          <h1>{{ t('common.settings') }}</h1>
          <div class="page-subtitle">{{ t('settings.subtitle') }}</div>
        </div>
        <div class="spacer" />
        <span class="chip chip-outline">Kiru {{ appVersion }}</span>
      </header>

      <div class="settings-layout">
        <aside class="settings-nav">
          <button
            v-for="section in sections"
            :key="section.id"
            class="nav-entry"
            :class="{ active: activeSection === section.id }"
            @click="scrollToSection(section.id)"
          >
            <component :is="section.icon" :size="15" />
            <span>{{ section.label }}</span>
            <ChevronRight :size="13" class="nav-chevron" />
          </button>
        </aside>

        <div class="settings-content">
          <section id="general" class="settings-section">
            <div class="section-title">
              <SlidersHorizontal :size="18" />
              <div>
                <h2>{{ t('settings.general') }}</h2>
                <p>{{ t('settings.general-subtitle') }}</p>
              </div>
            </div>
            <div class="panel">
              <SettingsRow :title="t('settings.tmdb-key')">
                <button type="button" class="inline-link" @click="openTmdbApi">
                  {{ t('settings.tmdb-key-link') }}
                  <ExternalLink :size="11" />
                </button>
                <input
                  v-model="tmdbDraft"
                  class="input row-input"
                  type="password"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="TMDB API Key"
                  @change="saveTmdbKey"
                />
              </SettingsRow>

              <SettingsRow :title="t('settings.language')" :subtitle="t('settings.language-subtitle')">
                <select
                  class="select row-select"
                  :value="language"
                  @change="settings.set(SettingKey.language, selectValue($event))"
                >
                  <option v-for="item in languageOptions" :key="item.code" :value="item.code">
                    {{ item.label }}
                  </option>
                </select>
              </SettingsRow>

              <SettingsRow :title="t('settings.theme')" :subtitle="t('settings.theme-subtitle')">
                <div class="segmented">
                  <button
                    v-for="item in themes"
                    :key="item.value"
                    class="segment"
                    :class="{ active: theme === item.value }"
                    @click="setTheme(item.value)"
                  >
                    {{ item.label }}
                  </button>
                </div>
              </SettingsRow>

              <SettingsRow :title="t('settings.nsfw')" :subtitle="t('settings.nsfw-subtitle')">
                <SwitchToggle
                  :model-value="settings.enableNSFW"
                  @update:model-value="toggleSetting(SettingKey.enableNSFW, $event)"
                />
              </SettingsRow>
            </div>
          </section>

          <section id="extensions" class="settings-section">
            <div class="section-title">
              <Sparkles :size="18" />
              <div>
                <h2>{{ t('settings.extension') }}</h2>
                <p>{{ t('settings.extension-subtitle') }}</p>
              </div>
            </div>
            <div class="panel">
              <SettingsRow stacked :title="t('settings.repo-url')" :subtitle="t('settings.repo-url-subtitle')">
                <div class="stacked-input-row">
                  <input
                    v-model="repoDraft"
                    class="input"
                    type="url"
                    spellcheck="false"
                    placeholder="https://miru-repo.0n0.dev"
                    @change="saveRepoUrl"
                  />
                  <button class="btn" @click="saveRepoUrl">{{ t('common.save') }}</button>
                  <RouterLink to="/extensions/repo" class="btn btn-ghost">
                    {{ t('common.repo') }}
                    <ChevronRight :size="13" />
                  </RouterLink>
                </div>
              </SettingsRow>
              <SettingsRow :title="t('settings.installed-extensions')" :subtitle="t('settings.installed-extensions-subtitle')">
                <RouterLink to="/extensions" class="btn btn-sm">
                  {{ t('common.extension') }}
                  <ChevronRight :size="13" />
                </RouterLink>
              </SettingsRow>
            </div>
          </section>

          <section id="video" class="settings-section">
            <div class="section-title">
              <Play :size="18" />
              <div>
                <h2>{{ t('settings.video-player') }}</h2>
                <p>{{ t('settings.video-player-subtitle') }}</p>
              </div>
            </div>
            <div class="panel">
              <SettingsRow :title="t('settings.bt-server')" :subtitle="t('settings.bt-server-subtitle')">
                <button class="btn btn-sm" @click="btOpen = true">
                  <HardDrive :size="13" />
                  {{ t('settings.bt-server-manager') }}
                </button>
              </SettingsRow>

              <SettingsRow
                :title="t('settings.external-player')"
                :subtitle="t('settings.external-player-current', { player: videoPlayerLabel })"
              >
                <select
                  class="select row-select"
                  :value="videoPlayer"
                  @change="settings.set(SettingKey.videoPlayer, selectValue($event))"
                >
                  <option v-for="player in players" :key="player.value" :value="player.value">
                    {{ player.label }}
                  </option>
                </select>
              </SettingsRow>

              <SettingsRow stacked :title="t('settings.skip-interval')" :subtitle="t('settings.skip-interval-subtitle')">
                <div class="number-grid">
                  <label class="number-field">
                    <span>I</span>
                    <input
                      class="input number-input"
                      type="number"
                      step="0.1"
                      :value="numberValue(SettingKey.keyI, 10)"
                      @change="setNumber(SettingKey.keyI, $event, 10)"
                    />
                    <em>s</em>
                  </label>
                  <label class="number-field">
                    <span>J</span>
                    <input
                      class="input number-input"
                      type="number"
                      step="0.1"
                      :value="numberValue(SettingKey.keyJ, -10)"
                      @change="setNumber(SettingKey.keyJ, $event, -10)"
                    />
                    <em>s</em>
                  </label>
                  <label class="number-field">
                    <span>←</span>
                    <input
                      class="input number-input"
                      type="number"
                      step="0.1"
                      :value="numberValue(SettingKey.arrowLeft, -2)"
                      @change="setNumber(SettingKey.arrowLeft, $event, -2)"
                    />
                    <em>s</em>
                  </label>
                  <label class="number-field">
                    <span>→</span>
                    <input
                      class="input number-input"
                      type="number"
                      step="0.1"
                      :value="numberValue(SettingKey.arrowRight, 2)"
                      @change="setNumber(SettingKey.arrowRight, $event, 2)"
                    />
                    <em>s</em>
                  </label>
                </div>
              </SettingsRow>
            </div>
          </section>

          <section id="reader" class="settings-section">
            <div class="section-title">
              <BookOpen :size="18" />
              <div>
                <h2>{{ t('settings.comic-reader') }}</h2>
                <p>{{ t('settings.comic-reader-subtitle') }}</p>
              </div>
            </div>
            <div class="panel">
              <SettingsRow :title="t('settings.default-reader-mode')">
                <select
                  class="select row-select"
                  :value="settings.readingMode"
                  @change="settings.set(SettingKey.readingMode, selectValue($event))"
                >
                  <option v-for="mode in readingModes" :key="mode.value" :value="mode.value">
                    {{ mode.label }}
                  </option>
                </select>
              </SettingsRow>
              <SettingsRow :title="t('novel-settings.font-size')" :subtitle="t('settings.novel-font-size-subtitle')">
                <div class="range-row">
                  <input
                    class="range"
                    type="range"
                    min="12"
                    max="44"
                    step="1"
                    :value="settings.novelFontSize"
                    @input="settings.set(SettingKey.novelFontSize, Number(inputValue($event)))"
                  />
                  <span class="range-value">{{ settings.novelFontSize }}px</span>
                </div>
              </SettingsRow>
            </div>
          </section>

          <section id="tracking" class="settings-section">
            <div class="section-title">
              <ListVideo :size="18" />
              <div>
                <h2>{{ t('settings.tracking') }}</h2>
                <p>{{ t('settings.tracking-subtitle') }}</p>
              </div>
            </div>
            <div class="panel">
              <SettingsRow :title="t('settings.auto-tracking')" :subtitle="t('settings.auto-tracking-subtitle')">
                <SwitchToggle
                  :model-value="settings.autoTracking"
                  @update:model-value="toggleSetting(SettingKey.autoTracking, $event)"
                />
              </SettingsRow>
              <SettingsRow :title="t('anilist.title')" :subtitle="t('settings.anilist-subtitle')">
                <span v-if="settings.anilistToken" class="chip chip-accent">
                  {{ t('settings.anilist-connected') }}
                </span>
                <RouterLink to="/settings/anilist" class="btn btn-sm">
                  {{ t('settings.open-anilist') }}
                  <ChevronRight :size="13" />
                </RouterLink>
              </SettingsRow>
            </div>
          </section>

          <section id="network" class="settings-section">
            <div class="section-title">
              <Globe2 :size="18" />
              <div>
                <h2>{{ t('settings.network') }}</h2>
                <p>{{ t('settings.network-subtitle') }}</p>
              </div>
            </div>
            <div class="panel">
              <SettingsRow stacked :title="t('settings.network-ua')" :subtitle="t('settings.network-ua-subtitle')">
                <div class="stacked-input-row">
                  <input
                    v-model="uaDraft"
                    class="input mono-input"
                    type="text"
                    spellcheck="false"
                    :placeholder="DEFAULT_WINDOWS_UA"
                    @change="saveUserAgent"
                  />
                  <button class="btn" @click="saveUserAgent">{{ t('common.save') }}</button>
                </div>
              </SettingsRow>

              <SettingsRow :title="t('settings.proxy-type')" :subtitle="t('settings.proxy-type-subtitle')">
                <select class="select row-select" :value="proxyType" @change="changeProxyType">
                  <option v-for="type in proxyTypes" :key="type.value" :value="type.value">
                    {{ type.label }}
                  </option>
                </select>
              </SettingsRow>

              <SettingsRow stacked :title="t('settings.proxy')" :subtitle="t('settings.proxy-subtitle')">
                <div class="stacked-input-row">
                  <input
                    v-model="proxyDraft"
                    class="input mono-input"
                    type="text"
                    spellcheck="false"
                    placeholder="username:password@host:port"
                    @change="applyProxy"
                  />
                  <button class="btn" @click="applyProxy">{{ t('common.save') }}</button>
                </div>
              </SettingsRow>
            </div>
          </section>

          <section id="logs" class="settings-section">
            <div class="section-title">
              <Bug :size="18" />
              <div>
                <h2>{{ t('settings.log') }}</h2>
                <p>{{ t('settings.log-subtitle') }}</p>
              </div>
            </div>
            <div class="panel">
              <SettingsRow :title="t('settings.save-log')" :subtitle="t('settings.save-log-subtitle')">
                <SwitchToggle
                  :model-value="settings.saveLog"
                  @update:model-value="toggleSetting(SettingKey.saveLog, $event)"
                />
              </SettingsRow>
              <SettingsRow :title="t('settings.export-log')" :subtitle="t('settings.export-log-subtitle')">
                <button class="btn btn-sm" :disabled="exporting" @click="exportLog">
                  <Download :size="13" />
                  {{ t('common.export') }}
                </button>
              </SettingsRow>
              <SettingsRow :title="t('settings.extension-log')" :subtitle="t('settings.extension-log-subtitle')">
                <RouterLink to="/debug" class="btn btn-sm">
                  <Bug :size="13" />
                  {{ t('settings.open-debug') }}
                </RouterLink>
              </SettingsRow>
            </div>
          </section>

          <section id="about" class="settings-section">
            <div class="section-title">
              <Info :size="18" />
              <div>
                <h2>{{ t('settings.about') }}</h2>
                <p>{{ t('settings.about-subtitle') }}</p>
              </div>
            </div>
            <div class="panel about-panel">
              <div class="about-hero">
                <img :src="logo" class="about-logo" alt="" />
                <div class="about-copy">
                  <h3>Kiru</h3>
                  <p>{{ t('settings.about-description') }}</p>
                  <div class="about-chips">
                    <span class="chip">v{{ appVersion }}</span>
                    <span class="chip chip-outline">AGPL-3.0</span>
                    <span class="chip chip-outline">Tauri + Vue</span>
                  </div>
                </div>
              </div>
              <div class="about-links">
                <button
                  v-for="link in links"
                  :key="link.url"
                  class="about-link"
                  @click="openExternal(link.url)"
                >
                  {{ link.label }}
                  <ExternalLink :size="11" />
                </button>
              </div>
              <p class="about-credit">{{ t('settings.about-credit') }}</p>
            </div>
          </section>
        </div>
      </div>
    </div>

    <BtManagerDialog
      :open="btOpen"
      @close="btOpen = false"
      @ready="ui.notify(t('settings.bt-ready'), 'success')"
    />
  </div>
</template>

<style scoped>
.page-header > div:first-child {
  min-width: 0;
}

.settings-layout {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  align-items: start;
  gap: 26px;
  max-width: 1120px;
}

.settings-nav {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 4px;
}

.nav-entry {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12.5px;
  text-align: left;
  transition: background 0.14s ease, color 0.14s ease;
}

.nav-entry span {
  flex: 1;
}

.nav-entry:hover {
  background: var(--surface-2);
  color: var(--text);
}

.nav-entry.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.nav-chevron {
  opacity: 0.45;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 26px;
  min-width: 0;
}

.settings-section {
  scroll-margin-top: 18px;
}

.section-title {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 10px;
  color: var(--text-secondary);
}

.section-title > svg {
  margin-top: 2px;
}

.section-title h2 {
  color: var(--text);
  font-size: 15px;
  font-weight: 650;
  line-height: 1.35;
}

.section-title p {
  margin-top: 1px;
  color: var(--muted);
  font-size: 11.5px;
}

.row-input {
  width: min(300px, 40vw);
  height: 34px;
}

.row-select {
  width: 190px;
  height: 34px;
}

.stacked-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.stacked-input-row .input {
  flex: 1;
  min-width: 0;
  height: 34px;
}

.mono-input {
  font-family: var(--font-mono);
  font-size: 11px;
}

.inline-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.inline-link:hover {
  color: var(--accent);
}

.segmented {
  display: flex;
  padding: 3px;
  gap: 2px;
  border-radius: 9px;
  background: var(--surface-2);
}

.segment {
  height: 27px;
  padding: 0 11px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 550;
  transition: background 0.14s ease, color 0.14s ease, box-shadow 0.14s ease;
}

.segment:hover {
  color: var(--text);
}

.segment.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.number-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 140px));
  gap: 8px;
  width: 100%;
}

.number-field {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.number-field > span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 650;
}

.number-field em {
  color: var(--muted);
  font-size: 10.5px;
  font-style: normal;
}

.number-input {
  width: 100%;
  height: 30px;
  padding: 0 2px;
  border: none;
  background: transparent;
  font-size: 12px;
}

.number-input:focus {
  box-shadow: none;
}

.range-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.range {
  width: 190px;
  accent-color: var(--accent);
}

.range-value {
  min-width: 36px;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-align: right;
}

.about-panel {
  padding: 18px;
}

.about-hero {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.about-logo {
  width: 54px;
  height: 54px;
  flex: 0 0 auto;
  object-fit: contain;
}

.about-copy {
  min-width: 0;
}

.about-copy h3 {
  font-size: 18px;
  font-weight: 700;
}

.about-copy p {
  max-width: 640px;
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.65;
}

.about-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.about-links {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.about-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 11.5px;
  font-weight: 550;
}

.about-credit {
  margin-top: 10px;
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.6;
}

@media (max-width: 920px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }

  .settings-nav {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px;
  }

  .nav-entry {
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .nav-chevron {
    display: none;
  }

  .number-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .row-input,
  .row-select {
    width: 100%;
  }

  .stacked-input-row {
    flex-wrap: wrap;
  }

  .range {
    width: 130px;
  }
}
</style>
