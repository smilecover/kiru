<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Download, LoaderCircle, Play, Square, Trash2 } from 'lucide-vue-next';
import AppModal from './AppModal.vue';
import { call, errorMessage } from '../lib/tauri';
import { formatBytes, isTauri, sleep } from '../lib/util';
import { useUiStore } from '../stores/ui';
import type { BtStatus } from '../types/models';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; ready: [] }>();

const { t } = useI18n();
const ui = useUiStore();
const status = ref<BtStatus | null>(null);
const remoteVersion = ref('');
const loading = ref(false);
const busy = ref('');
const error = ref('');
const received = ref(0);
const total = ref(0);
let unlisten: (() => void) | null = null;

const percent = () => (total.value > 0 ? Math.min(1, received.value / total.value) : 0);

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    status.value = await call<BtStatus>('bt_status');
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
  try {
    remoteVersion.value = await call<string>('bt_remote_version');
  } catch {
    remoteVersion.value = '';
  }
}

async function start(): Promise<void> {
  if (busy.value) return;
  busy.value = 'start';
  error.value = '';
  try {
    await call('bt_start');
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(400);
      const current = await call<BtStatus>('bt_status');
      if (current.running) break;
    }
    await refresh();
    if (status.value?.running) emit('ready');
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    busy.value = '';
  }
}

async function stop(): Promise<void> {
  if (busy.value) return;
  busy.value = 'stop';
  error.value = '';
  try {
    await call('bt_stop');
    await refresh();
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    busy.value = '';
  }
}

async function install(): Promise<void> {
  if (busy.value) return;
  busy.value = 'install';
  error.value = '';
  received.value = 0;
  total.value = 0;
  try {
    await call<string>('bt_install');
    await refresh();
    if (!status.value?.running && status.value?.installed) {
      busy.value = '';
      await start();
    }
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    busy.value = '';
  }
}

async function uninstall(): Promise<void> {
  if (busy.value) return;
  const confirmed = await ui.confirm({
    message: t('bt-server.remove-confirm'),
    destructive: true,
    confirmText: t('common.uninstall'),
  });
  if (!confirmed) return;
  busy.value = 'uninstall';
  error.value = '';
  try {
    await call('bt_uninstall');
    await refresh();
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    busy.value = '';
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      received.value = 0;
      total.value = 0;
      void refresh();
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (!isTauri()) return;
  void import('@tauri-apps/api/event')
    .then(({ listen }) =>
      listen<{ received?: number; total?: number }>('bt-download-progress', (event) => {
        received.value = Number(event.payload?.received ?? 0);
        total.value = Number(event.payload?.total ?? 0);
      }),
    )
    .then((stopListening) => {
      unlisten = stopListening;
    })
    .catch(() => undefined);
});

onBeforeUnmount(() => {
  unlisten?.();
  unlisten = null;
});
</script>

<template>
  <AppModal
    :open="open"
    :title="t('settings.bt-server')"
    width="540px"
    @close="emit('close')"
  >
    <div class="bt-dialog">
      <div class="bt-status">
        <div class="bt-status-dot" :class="{ running: status?.running }" />
        <div class="bt-status-copy">
          <div class="bt-title">
            <template v-if="status?.running">{{ t('bt-server.running') }}</template>
            <template v-else-if="status?.installed">{{ t('bt-server.stopped') }}</template>
            <template v-else>{{ t('bt-server.not-installed') }}</template>
          </div>
          <div class="muted small">
            <span v-if="status?.version">{{ t('bt-server.version', { version: status.version }) }}</span>
            <span v-if="remoteVersion" class="remote-version">
              {{ t('bt-server.remote-version', { version: remoteVersion }) }}
            </span>
          </div>
        </div>
        <LoaderCircle v-if="loading" :size="16" class="spin muted" />
      </div>

      <div v-if="busy === 'install'" class="download-progress">
        <div class="download-track">
          <span :style="{ width: `${percent() * 100}%` }" />
        </div>
        <div class="download-meta">
          <span>{{ t('bt-server.upgrade') }}…</span>
          <span v-if="total">{{ formatBytes(received) }} / {{ formatBytes(total) }}</span>
          <span v-else-if="received">{{ formatBytes(received) }}</span>
        </div>
      </div>

      <p v-if="error" class="error-banner">{{ error }}</p>

      <p class="bt-hint muted small">
        {{ t('settings.bt-server-subtitle') }}
      </p>

      <div class="bt-actions">
        <button
          v-if="status?.installed"
          class="btn btn-primary"
          :disabled="Boolean(busy) || status?.running"
          @click="start"
        >
          <Play :size="14" />
          {{ t('bt-server.start') }}
        </button>
        <button
          v-if="status?.running"
          class="btn"
          :disabled="Boolean(busy)"
          @click="stop"
        >
          <Square :size="13" />
          {{ t('bt-server.stop') }}
        </button>
        <button
          v-if="!status?.installed"
          class="btn btn-primary"
          :disabled="Boolean(busy)"
          @click="install"
        >
          <Download :size="14" />
          {{ t('common.install') }}
        </button>
        <button
          v-else
          class="btn"
          :disabled="Boolean(busy)"
          @click="install"
        >
          <Download :size="14" />
          {{ t('bt-server.upgrade') }}
          <span v-if="remoteVersion && remoteVersion !== status?.version" class="upgrade-dot" />
        </button>
        <button
          v-if="status?.installed"
          class="btn btn-danger"
          :disabled="Boolean(busy)"
          @click="uninstall"
        >
          <Trash2 :size="14" />
          {{ t('common.uninstall') }}
        </button>
        <div class="spacer" />
        <button class="btn" @click="emit('close')">{{ t('common.close') }}</button>
      </div>
    </div>
  </AppModal>
</template>

<style scoped>
.bt-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.bt-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
}

.bt-status-dot {
  width: 9px;
  height: 9px;
  flex: 0 0 9px;
  border-radius: 50%;
  background: var(--muted);
}

.bt-status-dot.running {
  background: var(--success);
  box-shadow: 0 0 0 4px rgba(47, 158, 110, 0.14);
}

.bt-status-copy {
  flex: 1;
  min-width: 0;
}

.bt-title {
  font-size: 13px;
  font-weight: 600;
}

.remote-version {
  margin-left: 10px;
}

.download-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.download-track {
  height: 5px;
  border-radius: 99px;
  overflow: hidden;
  background: var(--surface-3);
}

.download-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.25s ease;
}

.download-meta {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: 11px;
}

.bt-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}

.upgrade-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
