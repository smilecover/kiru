<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Cast, RefreshCw, Square, Tv } from 'lucide-vue-next';
import AppModal from './AppModal.vue';
import { call, errorMessage } from '../lib/tauri';
import type { DlnaDevice } from '../types/models';

const props = withDefaults(
  defineProps<{
    open: boolean;
    url?: string;
    title?: string;
    activeDevice?: DlnaDevice | null;
  }>(),
  { url: '', title: '', activeDevice: null },
);

const emit = defineEmits<{
  close: [];
  cast: [device: DlnaDevice];
  stop: [];
}>();

const { t } = useI18n();
const devices = ref<DlnaDevice[]>([]);
const loading = ref(false);
const busyId = ref('');
const error = ref('');

async function discover(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    devices.value = await call<DlnaDevice[]>('dlna_discover');
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

async function castTo(device: DlnaDevice): Promise<void> {
  if (!props.url || busyId.value) return;
  busyId.value = device.controlUrl;
  error.value = '';
  try {
    await call('dlna_action', {
      controlUrl: device.controlUrl,
      serviceType: device.serviceType,
      action: 'setUri',
      value: props.url,
      title: props.title || 'Kiru',
    });
    await call('dlna_action', {
      controlUrl: device.controlUrl,
      serviceType: device.serviceType,
      action: 'play',
      title: props.title || 'Kiru',
    });
    emit('cast', device);
    emit('close');
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    busyId.value = '';
  }
}

async function stopCasting(): Promise<void> {
  const device = props.activeDevice;
  if (!device || busyId.value) return;
  busyId.value = device.controlUrl;
  error.value = '';
  try {
    await call('dlna_action', {
      controlUrl: device.controlUrl,
      serviceType: device.serviceType,
      action: 'stop',
      title: props.title || 'Kiru',
    });
    emit('stop');
    emit('close');
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    busyId.value = '';
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    error.value = '';
    void discover();
  },
  { immediate: true },
);
</script>

<template>
  <AppModal :open="open" :title="t('video.cast')" width="500px" @close="emit('close')">
    <div class="cast-dialog">
      <div v-if="activeDevice" class="casting-panel">
        <div class="casting-icon"><Tv :size="20" /></div>
        <div class="casting-copy">
          <div class="casting-title">
            {{ t('video.cast-device', { device: activeDevice.name }) }}
          </div>
          <div class="muted small">{{ activeDevice.model || activeDevice.location }}</div>
        </div>
        <button class="btn btn-sm btn-danger" :disabled="Boolean(busyId)" @click="stopCasting">
          <Square :size="12" />
          {{ t('bt-server.stop') }}
        </button>
      </div>

      <div v-if="!url" class="warning-banner">
        {{ t('video.cast-unavailable') }}
      </div>

      <div class="cast-header">
        <span class="muted small">{{ t('video.cast') }}</span>
        <div class="spacer" />
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="discover">
          <RefreshCw :size="13" :class="{ spin: loading }" />
          {{ t('common.retry') }}
        </button>
      </div>

      <p v-if="error" class="error-banner">{{ error }}</p>

      <div v-if="loading && !devices.length" class="loading-center">
        <div class="spinner" />
      </div>

      <div v-else-if="devices.length" class="device-list">
        <button
          v-for="device in devices"
          :key="device.controlUrl"
          type="button"
          class="device-row"
          :class="{ active: activeDevice?.controlUrl === device.controlUrl }"
          :disabled="!url || Boolean(busyId)"
          @click="castTo(device)"
        >
          <span class="device-icon"><Cast :size="16" /></span>
          <span class="device-copy">
            <span class="device-name">{{ device.name }}</span>
            <span class="device-model">{{ device.model }}</span>
          </span>
          <span v-if="busyId === device.controlUrl" class="spinner" />
          <span v-else-if="activeDevice?.controlUrl === device.controlUrl" class="chip chip-accent">
            {{ t('video.cast') }}
          </span>
        </button>
      </div>

      <div v-else class="empty-devices">
        <Cast :size="26" />
        <span class="muted small">{{ t('video.cast-no-devices') }}</span>
      </div>
    </div>
    <template #footer>
      <div class="spacer" />
      <button class="btn" @click="emit('close')">{{ t('common.close') }}</button>
    </template>
  </AppModal>
</template>

<style scoped>
.cast-dialog {
  display: flex;
  flex-direction: column;
  gap: 13px;
  min-height: 150px;
}

.casting-panel {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border-radius: 10px;
  background: var(--accent-soft);
}

.casting-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--surface);
  color: var(--accent);
}

.casting-copy {
  flex: 1;
  min-width: 0;
}

.casting-title {
  font-size: 12.5px;
  font-weight: 600;
}

.cast-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.device-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.device-row {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.device-row:hover:not(:disabled) {
  background: var(--surface-2);
  border-color: var(--border);
}

.device-row.active {
  background: var(--accent-soft);
}

.device-row:disabled {
  opacity: 0.55;
  cursor: default;
}

.device-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--surface-2);
  color: var(--text-secondary);
}

.device-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.device-name {
  font-size: 12.5px;
  font-weight: 600;
}

.device-model {
  color: var(--muted);
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-devices {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 36px 10px;
  color: var(--muted);
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
