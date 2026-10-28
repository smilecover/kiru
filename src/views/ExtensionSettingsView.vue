<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  AlertCircle,
  ArrowLeft,
  Code2,
  Cookie,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Trash2,
} from 'lucide-vue-next';
import EmptyState from '../components/EmptyState.vue';
import SettingsRow from '../components/SettingsRow.vue';
import SmartImage from '../components/SmartImage.vue';
import SwitchToggle from '../components/SwitchToggle.vue';
import { extensionTypeLabel } from '../lib/labels';
import { call, errorMessage } from '../lib/tauri';
import { useExtensionsStore } from '../stores/extensions';
import { useUiStore } from '../stores/ui';
import type { ExtensionSetting } from '../types/models';

const props = defineProps<{ package: string }>();

const router = useRouter();
const { t } = useI18n();
const extensions = useExtensionsStore();
const ui = useUiStore();

const packageName = computed(() => props.package);
const meta = computed(() => extensions.getMeta(packageName.value));

const settingsLoading = ref(true);
const settingsError = ref('');
const settings = ref<ExtensionSetting[]>([]);
const values = reactive<Record<string, string>>({});
const cookieBusy = ref(false);
const removing = ref(false);

function optionEntries(setting: ExtensionSetting): [string, string][] {
  if (!setting.options) return [];
  try {
    const parsed = JSON.parse(setting.options) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed as Record<string, unknown>).map(([label, value]) => [
      label,
      String(value),
    ]);
  } catch {
    return [];
  }
}

function currentValue(setting: ExtensionSetting): string {
  return values[setting.key] ?? setting.value ?? setting.defaultValue;
}

function isOn(setting: ExtensionSetting): boolean {
  return currentValue(setting).toLowerCase() === 'true';
}

function commit(setting: ExtensionSetting, value: string): void {
  values[setting.key] = value;
  if (!extensions.setExtensionSetting(packageName.value, setting.key, value)) {
    ui.notify(t('ext-settings.missing-setting'), 'error');
  }
}

function onTextChange(setting: ExtensionSetting, event: Event): void {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  commit(setting, target.value);
}

function onToggle(setting: ExtensionSetting, value: boolean): void {
  commit(setting, value ? 'true' : 'false');
}

async function loadSettings(): Promise<void> {
  settingsLoading.value = true;
  settingsError.value = '';
  try {
    if (!extensions.loaded) await extensions.loadExtensions();
    if (!meta.value) {
      settingsError.value = t('common.extension-missing', { package: packageName.value });
      return;
    }
    await extensions.loadExtensionSettings(packageName.value);
    const list = extensions.extensionSettings(packageName.value);
    settings.value = list;
    for (const key of Object.keys(values)) delete values[key];
    for (const setting of list) {
      values[setting.key] = setting.value ?? setting.defaultValue;
    }
  } catch (error) {
    settingsError.value = errorMessage(error);
  } finally {
    settingsLoading.value = false;
  }
}

async function openSite(): Promise<void> {
  if (!meta.value?.webSite) return;
  try {
    await call('open_site_window', {
      url: meta.value.webSite,
      title: meta.value.name,
    });
    ui.notify(t('management.site-window-hint'), 'info', 4500);
  } catch (error) {
    ui.notifyError(error);
  }
}

async function cleanCookies(): Promise<void> {
  if (!meta.value?.webSite || cookieBusy.value) return;
  cookieBusy.value = true;
  try {
    await call('cookies_clear', { url: meta.value.webSite });
    ui.notify(t('cookie-clean.success'), 'success');
  } catch (error) {
    ui.notifyError(error);
  } finally {
    cookieBusy.value = false;
  }
}

function openCode(): void {
  void router.push({
    name: 'extension-code',
    params: { package: packageName.value },
  });
}

async function uninstall(): Promise<void> {
  if (removing.value || !meta.value) return;
  const confirmed = await ui.confirm({
    title: t('common.uninstall'),
    message: t('management.uninstall-confirm', { name: meta.value.name }),
    confirmText: t('common.uninstall'),
    destructive: true,
  });
  if (!confirmed) return;
  removing.value = true;
  try {
    await extensions.uninstall(packageName.value);
    ui.notify(t('management.uninstalled', { name: meta.value.name }), 'success');
    void router.replace({ name: 'extensions' });
  } catch (error) {
    ui.notifyError(error);
  } finally {
    removing.value = false;
  }
}

onMounted(() => {
  void loadSettings();
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
          <h1>{{ t('extension-info.title') }}</h1>
          <div class="page-subtitle">{{ packageName }}</div>
        </div>
        <div class="spacer" />
        <button
          class="btn btn-icon"
          :title="t('ext-settings.reload')"
          :disabled="settingsLoading"
          @click="loadSettings"
        >
          <RefreshCw :size="16" :class="{ spin: settingsLoading }" />
        </button>
      </header>

      <EmptyState
        v-if="!meta"
        :icon="AlertCircle"
        :title="t('common.extension-missing', { package: packageName })"
        :description="settingsError"
      >
        <RouterLink to="/extensions" class="btn">{{ t('common.extension') }}</RouterLink>
      </EmptyState>

      <div v-else class="settings-layout">
        <aside class="info-column">
          <section class="info-card">
            <div class="info-hero">
              <div class="info-icon">
                <SmartImage :src="meta.icon" :alt="meta.name" fit="contain" />
              </div>
              <h2>{{ meta.name }}</h2>
              <span class="package-name">{{ meta.package }}</span>
              <div class="info-chips">
                <span class="chip chip-accent">{{ extensionTypeLabel(meta.type) }}</span>
                <span v-if="meta.nsfw" class="nsfw-chip">18+</span>
                <span class="chip chip-outline">v{{ meta.version }}</span>
              </div>
            </div>

            <div class="info-list">
              <div v-if="meta.author" class="info-row">
                <span>{{ t('extension-info.author') }}</span>
                <strong>{{ meta.author }}</strong>
              </div>
              <div class="info-row">
                <span>{{ t('extension-info.version') }}</span>
                <strong>{{ meta.version }}</strong>
              </div>
              <div v-if="meta.lang" class="info-row">
                <span>{{ t('extension-info.language') }}</span>
                <strong>{{ meta.lang }}</strong>
              </div>
              <div v-if="meta.license" class="info-row">
                <span>{{ t('extension-info.license') }}</span>
                <strong>{{ meta.license }}</strong>
              </div>
            </div>

            <div v-if="meta.webSite" class="site-box">
              <span class="site-label">{{ t('extension-info.original-site') }}</span>
              <button class="site-link" :title="meta.webSite" @click="openSite">
                <span>{{ meta.webSite }}</span>
                <ExternalLink :size="13" />
              </button>
            </div>

            <div class="info-actions">
              <button class="btn" :disabled="removing" @click="uninstall">
                <LoaderCircle v-if="removing" :size="14" class="spin" />
                <Trash2 v-else :size="14" />
                {{ t('common.uninstall') }}
              </button>
              <button class="btn btn-primary" @click="openCode">
                <Code2 :size="14" />
                {{ t('extension.edit-code') }}
              </button>
            </div>
          </section>

          <section v-if="meta.description" class="description-card">
            <h3>{{ t('extension-info.description') }}</h3>
            <p>{{ meta.description }}</p>
          </section>
        </aside>

        <main class="settings-column">
          <div class="settings-heading">
            <h2>{{ t('common.settings') }}</h2>
            <span v-if="settings.length" class="chip">{{ settings.length }}</span>
          </div>

          <div v-if="settingsLoading" class="panel loading-panel">
            <div class="spinner" />
            <span>{{ t('ext-settings.loading') }}</span>
          </div>

          <div v-else-if="settingsError" class="error-banner settings-error">
            <AlertCircle :size="17" />
            <div class="settings-error-copy">
              <strong>{{ t('ext-settings.load-failed') }}</strong>
              <span>{{ settingsError }}</span>
            </div>
            <button class="btn btn-sm" @click="loadSettings">
              {{ t('common.retry') }}
            </button>
          </div>

          <div class="panel cookie-panel">
            <SettingsRow
              :title="t('cookie-clean.title')"
              :subtitle="t('cookie-clean.subtitle')"
            >
              <button
                class="btn btn-sm"
                :disabled="cookieBusy || !meta.webSite"
                @click="cleanCookies"
              >
                <LoaderCircle v-if="cookieBusy" :size="13" class="spin" />
                <Cookie v-else :size="13" />
                {{ t('cookie-clean.clean') }}
              </button>
            </SettingsRow>
          </div>

          <div v-if="!settingsLoading && settings.length" class="panel extension-settings">
            <SettingsRow
              v-for="setting in settings"
              :key="setting.id"
              :title="setting.title || setting.key"
              :subtitle="setting.description"
              :stacked="setting.type === 'radio' && optionEntries(setting).length > 5"
            >
              <template v-if="setting.type === 'toggle'">
                <SwitchToggle
                  :model-value="isOn(setting)"
                  @update:model-value="onToggle(setting, $event)"
                />
              </template>

              <select
                v-else-if="setting.type === 'radio'"
                class="select radio-select"
                :value="currentValue(setting)"
                @change="onTextChange(setting, $event)"
              >
                <option
                  v-for="[label, value] in optionEntries(setting)"
                  :key="value"
                  :value="value"
                >
                  {{ label }}
                </option>
              </select>

              <input
                v-else
                class="input setting-input"
                :value="currentValue(setting)"
                spellcheck="false"
                @change="onTextChange(setting, $event)"
              />
            </SettingsRow>
          </div>

          <EmptyState
            v-else-if="!settingsLoading && !settingsError"
            compact
            :title="t('ext-settings.empty')"
            :description="t('ext-settings.empty-hint')"
          />
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
.title-wrap {
  min-width: 0;
}

.title-wrap .page-subtitle {
  font-family: var(--font-mono);
  font-size: 11px;
}

.settings-layout {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  align-items: start;
  gap: 18px;
}

.info-column {
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: sticky;
  top: 0;
}

.info-card,
.description-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.info-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 18px 18px;
  border-bottom: 1px solid var(--border);
  text-align: center;
}

.info-icon {
  width: 76px;
  height: 76px;
  margin-bottom: 12px;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--surface-2);
}

.info-hero h2 {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.35;
}

.package-name {
  margin-top: 2px;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
  word-break: break-all;
}

.info-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 10px;
}

.nsfw-chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 7px;
  border-radius: 99px;
  background: rgba(217, 74, 74, 0.12);
  color: var(--danger);
  font-size: 9.5px;
  font-weight: 750;
}

.info-list {
  padding: 8px 15px;
}

.info-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  font-size: 12px;
}

.info-row span {
  color: var(--muted);
}

.info-row strong {
  font-weight: 550;
  text-align: right;
  word-break: break-word;
}

.site-box {
  padding: 10px 15px 14px;
  border-top: 1px solid var(--border);
}

.site-label {
  display: block;
  margin-bottom: 5px;
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.site-link {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 11.5px;
  text-align: left;
}

.site-link span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-actions {
  display: flex;
  gap: 8px;
  padding: 14px 15px;
  border-top: 1px solid var(--border);
}

.info-actions .btn {
  flex: 1;
}

.description-card {
  padding: 15px;
}

.description-card h3 {
  margin-bottom: 7px;
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.description-card p {
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.settings-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.settings-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
}

.settings-heading h2 {
  font-size: 16px;
  font-weight: 650;
}

.loading-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 44px;
  color: var(--muted);
  font-size: 12.5px;
}

.settings-error {
  align-items: center;
}

.settings-error-copy {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 2px;
}

.settings-error-copy strong {
  font-size: 12.5px;
}

.settings-error-copy span {
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.cookie-panel {
  flex: 0 0 auto;
}

.extension-settings {
  min-height: 80px;
}

.radio-select {
  width: 230px;
  max-width: 38vw;
  height: 34px;
}

.setting-input {
  width: 320px;
  max-width: 42vw;
  height: 34px;
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }

  .info-column {
    position: static;
  }

  .radio-select,
  .setting-input {
    max-width: none;
    width: min(320px, 58vw);
  }
}
</style>
