<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  AlertCircle,
  ArrowLeft,
  Copy,
  Globe2,
  LoaderCircle,
  Play,
  ScrollText,
  Search,
  Terminal,
  Trash2,
} from 'lucide-vue-next';
import AppModal from '../components/AppModal.vue';
import EmptyState from '../components/EmptyState.vue';
import {
  clearExtensionLogs,
  clearNetworkLogs,
  extensionLogs,
  networkLogs,
} from '../lib/log';
import { errorMessage } from '../lib/tauri';
import { useExtensionsStore } from '../stores/extensions';
import { useUiStore } from '../stores/ui';
import type { LogEntry, NetworkLog } from '../types/models';

type DebugTab = 'logs' | 'network' | 'debug';
type DebugMethod =
  | 'latest'
  | 'search'
  | 'createFilter'
  | 'detail'
  | 'watch'
  | 'checkUpdate';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const extensions = useExtensionsStore();
const ui = useUiStore();

const activeTab = ref<DebugTab>('logs');
const logPackage = ref('');
const logLevel = ref<'all' | 'info' | 'error'>('all');
const logQuery = ref('');
const autoScroll = ref(true);
const logsEl = ref<HTMLElement | null>(null);

const networkPackage = ref('');
const networkQuery = ref('');
const selectedLog = ref<NetworkLog | null>(null);

const debugPackage = ref(String(route.query.package ?? ''));
const debugMethod = ref<DebugMethod>('latest');
const debugPage = ref('1');
const debugKeyword = ref('');
const debugUrl = ref('');
const debugFilter = ref('');
const running = ref(false);
const debugError = ref('');
const debugResult = ref('');

const tabs = computed(() => [
  { id: 'logs' as DebugTab, label: t('debug.logs'), icon: ScrollText, count: extensionLogs.length },
  { id: 'network' as DebugTab, label: t('debug.network'), icon: Globe2, count: networkLogs.length },
  { id: 'debug' as DebugTab, label: t('debug.debugger'), icon: Terminal, count: 0 },
]);

const packageOptions = computed(() => {
  const map = new Map<string, string>();
  for (const meta of extensions.extensions) map.set(meta.package, meta.name);
  for (const log of extensionLogs) {
    if (!map.has(log.package)) map.set(log.package, log.name);
  }
  for (const log of networkLogs) {
    if (!map.has(log.package)) map.set(log.package, log.name);
  }
  return [...map.entries()]
    .map(([packageName, name]) => ({ packageName, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

const filteredLogs = computed<LogEntry[]>(() => {
  const query = logQuery.value.trim().toLowerCase();
  return extensionLogs.filter((log) => {
    if (logPackage.value && log.package !== logPackage.value) return false;
    if (logLevel.value !== 'all' && log.level !== logLevel.value) return false;
    if (!query) return true;
    return (
      log.message.toLowerCase().includes(query) ||
      log.name.toLowerCase().includes(query) ||
      log.package.toLowerCase().includes(query)
    );
  });
});

const filteredNetwork = computed<NetworkLog[]>(() => {
  const query = networkQuery.value.trim().toLowerCase();
  return networkLogs.filter((log) => {
    if (networkPackage.value && log.package !== networkPackage.value) return false;
    if (!query) return true;
    return (
      log.url.toLowerCase().includes(query) ||
      log.method.toLowerCase().includes(query) ||
      log.name.toLowerCase().includes(query) ||
      log.package.toLowerCase().includes(query)
    );
  });
});

const debugMethods = computed<{ value: DebugMethod; label: string }[]>(() => [
  { value: 'latest', label: t('debug.method-latest') },
  { value: 'search', label: t('debug.method-search') },
  { value: 'createFilter', label: t('debug.method-create-filter') },
  { value: 'detail', label: t('debug.method-detail') },
  { value: 'watch', label: t('debug.method-watch') },
  { value: 'checkUpdate', label: t('debug.method-check-update') },
]);

const needsPage = computed(
  () => debugMethod.value === 'latest' || debugMethod.value === 'search',
);
const needsKeyword = computed(() => debugMethod.value === 'search');
const needsUrl = computed(
  () =>
    debugMethod.value === 'detail' ||
    debugMethod.value === 'watch' ||
    debugMethod.value === 'checkUpdate',
);
const needsFilter = computed(
  () => debugMethod.value === 'search' || debugMethod.value === 'createFilter',
);

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function fullTime(timestamp: number): string {
  return `${new Date(timestamp).toLocaleString()}.${String(timestamp % 1000).padStart(3, '0')}`;
}

function statusTone(status?: number): string {
  if (!status) return 'status-none';
  if (status >= 200 && status < 300) return 'status-ok';
  if (status >= 400) return 'status-error';
  return 'status-other';
}

function pretty(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return '—';
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function scrollLogsToBottom(): void {
  if (!logsEl.value) return;
  logsEl.value.scrollTop = logsEl.value.scrollHeight;
}

function clearLogs(): void {
  clearExtensionLogs();
}

function clearNetwork(): void {
  selectedLog.value = null;
  clearNetworkLogs();
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ui.notify(t('common.copied'), 'success');
  } catch {
    ui.notify(text, 'info', 7000);
  }
}

function parseFilter(): Record<string, string[]> | null {
  const raw = debugFilter.value.trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(t('debug.filter-invalid', { error: errorMessage(error) }));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(t('debug.filter-invalid', { error: 'expected a JSON object' }));
  }
  return parsed as Record<string, string[]>;
}

async function runDebug(): Promise<void> {
  if (running.value) return;
  if (!debugPackage.value) {
    ui.notify(t('debug.choose-extension'), 'info');
    return;
  }
  running.value = true;
  debugError.value = '';
  debugResult.value = '';
  try {
    const runtime = await extensions.ensureRuntime(debugPackage.value);
    const page = Math.max(1, Number(debugPage.value) || 1);
    let value: unknown;
    switch (debugMethod.value) {
      case 'latest':
        value = await runtime.latest(page);
        break;
      case 'search':
        value = await runtime.search(debugKeyword.value.trim(), page, parseFilter());
        break;
      case 'createFilter':
        value = await runtime.createFilter(parseFilter() ?? undefined);
        break;
      case 'detail':
        value = await runtime.detail(debugUrl.value.trim());
        break;
      case 'watch':
        value = await runtime.watch(debugUrl.value.trim());
        break;
      case 'checkUpdate':
        value = await runtime.checkUpdate(debugUrl.value.trim());
        break;
    }
    debugResult.value =
      typeof value === 'string'
        ? value || t('debug.empty-value')
        : pretty(value);
  } catch (caught) {
    debugError.value = errorMessage(caught);
  } finally {
    running.value = false;
  }
}

watch(
  () => filteredLogs.value.length,
  async () => {
    if (activeTab.value !== 'logs' || !autoScroll.value) return;
    await nextTick();
    scrollLogsToBottom();
  },
);

watch(activeTab, async (tab) => {
  if (tab !== 'logs' || !autoScroll.value) return;
  await nextTick();
  scrollLogsToBottom();
});

onMounted(async () => {
  if (!extensions.loaded) {
    try {
      await extensions.loadExtensions();
    } catch {
      // Installation errors are surfaced on the extensions page.
    }
  }
  if (!debugPackage.value && extensions.extensions.length) {
    debugPackage.value = extensions.extensions[0].package;
  }
  await nextTick();
  scrollLogsToBottom();
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
          <h1>{{ t('debug.title') }}</h1>
          <div class="page-subtitle">{{ t('debug.subtitle') }}</div>
        </div>
      </header>

      <div class="debug-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="debug-tab"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" :size="15" />
          {{ tab.label }}
          <span v-if="tab.count" class="tab-count">{{ tab.count }}</span>
        </button>
      </div>

      <template v-if="activeTab === 'logs'">
        <div class="filter-bar">
          <select v-model="logPackage" class="select filter-select">
            <option value="">{{ t('debug.all-extensions') }}</option>
            <option
              v-for="item in packageOptions"
              :key="item.packageName"
              :value="item.packageName"
            >
              {{ item.name }}
            </option>
          </select>
          <select v-model="logLevel" class="select filter-select level-select">
            <option value="all">{{ t('debug.all-levels') }}</option>
            <option value="info">{{ t('debug.level-info') }}</option>
            <option value="error">{{ t('debug.level-error') }}</option>
          </select>
          <div class="filter-search">
            <Search :size="14" />
            <input
              v-model="logQuery"
              class="input"
              type="search"
              :placeholder="t('debug.search-logs')"
            />
          </div>
          <div class="spacer" />
          <label class="check-inline">
            <input v-model="autoScroll" type="checkbox" />
            {{ t('debug.auto-scroll') }}
          </label>
          <button class="btn btn-sm" :disabled="!extensionLogs.length" @click="clearLogs">
            <Trash2 :size="13" />
            {{ t('debug.clear') }}
          </button>
        </div>

        <div class="panel log-panel">
          <div ref="logsEl" class="log-list">
            <div v-if="filteredLogs.length === 0" class="pane-empty">
              <ScrollText :size="22" />
              <span>{{ t('debug.empty-logs') }}</span>
              <span class="pane-empty-hint">{{ t('debug.empty-logs-hint') }}</span>
            </div>
            <template v-else>
              <div
                v-for="log in filteredLogs"
                :key="log.id"
                class="log-row"
                :class="`level-${log.level}`"
              >
                <span class="log-time" :title="fullTime(log.time)">{{ formatClock(log.time) }}</span>
                <span class="log-source" :title="log.package">{{ log.name }}</span>
                <span class="log-message">{{ log.message }}</span>
              </div>
            </template>
          </div>
          <div class="pane-footer">
            {{ t('debug.showing-count', { count: filteredLogs.length, total: extensionLogs.length }) }}
          </div>
        </div>
      </template>

      <template v-else-if="activeTab === 'network'">
        <div class="filter-bar">
          <select v-model="networkPackage" class="select filter-select">
            <option value="">{{ t('debug.all-extensions') }}</option>
            <option
              v-for="item in packageOptions"
              :key="item.packageName"
              :value="item.packageName"
            >
              {{ item.name }}
            </option>
          </select>
          <div class="filter-search">
            <Search :size="14" />
            <input
              v-model="networkQuery"
              class="input"
              type="search"
              :placeholder="t('debug.search-network')"
            />
          </div>
          <div class="spacer" />
          <button class="btn btn-sm" :disabled="!networkLogs.length" @click="clearNetwork">
            <Trash2 :size="13" />
            {{ t('debug.clear') }}
          </button>
        </div>

        <div class="panel network-panel">
          <div v-if="filteredNetwork.length === 0" class="pane-empty network-empty">
            <Globe2 :size="22" />
            <span>{{ t('debug.empty-network') }}</span>
            <span class="pane-empty-hint">{{ t('debug.empty-network-hint') }}</span>
          </div>
          <div v-else class="network-list">
            <button
              v-for="log in filteredNetwork"
              :key="log.id"
              class="network-row"
              @click="selectedLog = log"
            >
              <span class="method">{{ log.method || 'GET' }}</span>
              <span class="status" :class="statusTone(log.statusCode)">
                {{ log.statusCode ?? '—' }}
              </span>
              <span class="network-url" :title="log.url">{{ log.url }}</span>
              <span class="network-source" :title="log.package">{{ log.name }}</span>
              <span class="network-time" :title="fullTime(log.time)">{{ formatClock(log.time) }}</span>
            </button>
          </div>
          <div class="pane-footer">
            {{ t('debug.showing-count', { count: filteredNetwork.length, total: networkLogs.length }) }}
          </div>
        </div>
      </template>

      <template v-else>
        <EmptyState
          v-if="extensions.extensions.length === 0"
          :title="t('common.no-extension')"
          :description="t('debug.no-extension-hint')"
        >
          <RouterLink to="/extensions/repo" class="btn btn-primary">
            {{ t('common.extension-repo') }}
          </RouterLink>
        </EmptyState>

        <div v-else class="debug-workspace">
          <form class="panel debug-form" @submit.prevent="runDebug">
            <div class="pane-heading">
              <Terminal :size="16" />
              <h2>{{ t('debug.debugger') }}</h2>
            </div>

            <label class="field">
              <span>{{ t('debug.extension-label') }}</span>
              <select v-model="debugPackage" class="select">
                <option
                  v-for="meta in extensions.extensions"
                  :key="meta.package"
                  :value="meta.package"
                >
                  {{ meta.name }} ({{ meta.package }})
                </option>
              </select>
            </label>

            <label class="field">
              <span>{{ t('debug.method-label') }}</span>
              <select v-model="debugMethod" class="select">
                <option v-for="method in debugMethods" :key="method.value" :value="method.value">
                  {{ method.label }}
                </option>
              </select>
            </label>

            <label v-if="needsKeyword" class="field">
              <span>{{ t('debug.keyword') }}</span>
              <input v-model="debugKeyword" class="input" :placeholder="t('debug.keyword')" />
            </label>

            <label v-if="needsPage" class="field field-short">
              <span>{{ t('debug.page') }}</span>
              <input v-model="debugPage" class="input" type="number" min="1" step="1" />
            </label>

            <label v-if="needsUrl" class="field">
              <span>{{ t('debug.url-param') }}</span>
              <input
                v-model="debugUrl"
                class="input mono-input"
                spellcheck="false"
                placeholder="https://…"
              />
            </label>

            <label v-if="needsFilter" class="field">
              <span>{{ t('debug.filter-json') }}</span>
              <input
                v-model="debugFilter"
                class="input mono-input"
                spellcheck="false"
                :placeholder="t('debug.filter-placeholder')"
              />
              <small>{{ t('debug.filter-hint') }}</small>
            </label>

            <div class="form-actions">
              <button class="btn btn-primary" type="submit" :disabled="running">
                <LoaderCircle v-if="running" :size="14" class="spin" />
                <Play v-else :size="14" />
                {{ running ? t('debug.running') : t('debug.run') }}
              </button>
            </div>
          </form>

          <section class="panel debug-output">
            <div class="pane-heading">
              <span>{{ t('debug.result') }}</span>
              <div class="spacer" />
              <button
                v-if="debugResult"
                class="btn btn-icon btn-sm"
                :title="t('common.copied')"
                @click="copyText(debugResult)"
              >
                <Copy :size="13" />
              </button>
            </div>
            <div v-if="debugError" class="error-banner output-error">
              <AlertCircle :size="16" />
              <span>{{ debugError }}</span>
            </div>
            <pre v-else-if="debugResult" class="result-block">{{ debugResult }}</pre>
            <div v-else class="pane-empty output-empty">
              <Play :size="22" />
              <span>{{ t('debug.empty-result') }}</span>
              <span class="pane-empty-hint">{{ t('debug.empty-result-hint') }}</span>
            </div>
          </section>
        </div>
      </template>
    </div>

    <AppModal
      :open="selectedLog !== null"
      :title="t('debug.network-detail')"
      width="760px"
      @close="selectedLog = null"
    >
      <div v-if="selectedLog" class="network-detail">
        <div class="detail-head">
          <span class="method">{{ selectedLog.method }}</span>
          <span class="status" :class="statusTone(selectedLog.statusCode)">
            {{ selectedLog.statusCode ?? '—' }}
          </span>
          <span class="detail-extension">{{ selectedLog.name }}</span>
          <span class="muted small" :title="fullTime(selectedLog.time)">
            {{ formatClock(selectedLog.time) }}
          </span>
        </div>
        <div class="detail-url-row">
          <code class="detail-url">{{ selectedLog.url }}</code>
          <button class="btn btn-icon btn-sm" :title="t('debug.copy-url')" @click="copyText(selectedLog.url)">
            <Copy :size="13" />
          </button>
        </div>

        <h4>{{ t('debug.request-headers') }}</h4>
        <pre class="detail-block">{{ pretty(selectedLog.requestHeaders) }}</pre>
        <h4>{{ t('debug.request-body') }}</h4>
        <pre class="detail-block">{{ pretty(selectedLog.requestBody) }}</pre>
        <h4>{{ t('debug.response-headers') }}</h4>
        <pre class="detail-block">{{ pretty(selectedLog.responseHeaders) }}</pre>
        <h4>{{ t('debug.response-body') }}</h4>
        <pre class="detail-block response-body">{{ pretty(selectedLog.responseBody) }}</pre>
      </div>
      <template #footer>
        <div class="spacer" />
        <button class="btn" @click="selectedLog = null">
          {{ t('common.close') }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.title-wrap {
  min-width: 0;
}

.debug-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
}

.debug-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 33px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 550;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.debug-tab:hover {
  background: var(--surface-2);
  color: var(--text);
}

.debug-tab.active {
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

.debug-tab.active .tab-count {
  background: var(--accent);
  color: var(--accent-contrast);
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.filter-select {
  width: 170px;
  height: 32px;
}

.level-select {
  width: 125px;
}

.filter-search {
  position: relative;
  display: flex;
  align-items: center;
  width: min(280px, 40vw);
}

.filter-search > svg {
  position: absolute;
  left: 10px;
  color: var(--muted);
  pointer-events: none;
}

.filter-search .input {
  height: 32px;
  padding-left: 30px;
  border-radius: 99px;
}

.check-inline {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  font-size: 11.5px;
  white-space: nowrap;
  cursor: pointer;
}

.check-inline input {
  accent-color: var(--accent);
}

.log-panel,
.network-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.log-list {
  height: min(520px, 58vh);
  overflow: auto;
  padding: 4px 0;
  background: var(--surface);
  font-family: var(--font-mono);
  font-size: 11px;
}

.log-row {
  display: grid;
  grid-template-columns: 58px 124px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 4px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  line-height: 1.55;
}

.log-row:hover {
  background: var(--surface-2);
}

.log-time {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.log-source {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}

.log-message {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  color: var(--text-secondary);
}

.log-row.level-error .log-time {
  color: var(--danger);
}

.log-row.level-error .log-message {
  color: var(--danger);
}

.pane-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 220px;
  color: var(--muted);
  font-size: 12.5px;
}

.log-list .pane-empty {
  height: 100%;
  font-family: var(--font-sans);
}

.pane-empty-hint {
  max-width: 420px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.55;
  text-align: center;
  opacity: 0.8;
}

.pane-footer {
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--muted);
  font-size: 10.5px;
}

.network-list {
  max-height: min(540px, 60vh);
  overflow: auto;
}

.network-row {
  display: grid;
  grid-template-columns: 56px 38px minmax(0, 1fr) 120px 58px;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 36px;
  padding: 5px 13px;
  border: none;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  background: transparent;
  text-align: left;
}

.network-row:hover {
  background: var(--surface-2);
}

.method {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
}

.status {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  text-align: center;
}

.status-ok {
  color: var(--success);
}

.status-error {
  color: var(--danger);
}

.status-other {
  color: var(--warning);
}

.status-none {
  color: var(--muted);
}

.network-url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.network-source {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 10.5px;
}

.network-time {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: right;
}

.network-empty {
  min-height: 240px;
}

.debug-workspace {
  display: grid;
  grid-template-columns: minmax(290px, 360px) minmax(0, 1fr);
  align-items: start;
  gap: 14px;
}

.debug-form {
  display: flex;
  flex-direction: column;
  gap: 13px;
  padding: 15px;
}

.pane-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 650;
}

.pane-heading h2 {
  color: var(--text);
  font-size: 13px;
  font-weight: 650;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field > span {
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.field .input,
.field .select {
  height: 34px;
}

.field-short {
  max-width: 130px;
}

.field small {
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.5;
}

.mono-input {
  font-family: var(--font-mono);
  font-size: 11px;
}

.form-actions {
  display: flex;
  margin-top: 2px;
}

.debug-output {
  display: flex;
  flex-direction: column;
  min-height: 280px;
  padding: 14px;
}

.debug-output .pane-heading {
  margin-bottom: 10px;
}

.output-error {
  align-items: flex-start;
}

.output-error span {
  flex: 1;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 11px;
}

.result-block {
  max-height: min(520px, 58vh);
  margin: 0;
  padding: 12px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.output-empty {
  flex: 1;
  min-height: 220px;
}

.network-detail {
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: 66vh;
  overflow: auto;
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-extension {
  color: var(--muted);
  font-size: 11.5px;
}

.detail-url-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.detail-url {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
}

.network-detail h4 {
  margin-top: 8px;
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.detail-block {
  max-height: 200px;
  margin: 0;
  padding: 9px 10px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-block.response-body {
  max-height: 280px;
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 980px) {
  .debug-workspace {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .filter-search {
    width: 100%;
  }

  .log-row {
    grid-template-columns: 52px minmax(80px, 100px) minmax(0, 1fr);
    gap: 7px;
  }

  .network-row {
    grid-template-columns: 48px 34px minmax(0, 1fr) 50px;
  }

  .network-source {
    display: none;
  }
}
</style>
