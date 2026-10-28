<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  ChevronLeft,
  Copy,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  X,
} from 'lucide-vue-next';
import logo from '../assets/logo.png';
import { isTauri } from '../lib/util';
import { useUiStore } from '../stores/ui';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const ui = useUiStore();

const isDesktop = isTauri();
const maximized = ref(false);
const immersive = computed(() => Boolean(route.meta.immersive));
let unlisten: (() => void) | null = null;

async function refreshWindowState(): Promise<void> {
  if (!isDesktop) return;
  try {
    const win = getCurrentWindow();
    maximized.value = await win.isMaximized();
  } catch {
    maximized.value = false;
  }
}

async function minimize(): Promise<void> {
  if (!isDesktop) return;
  try {
    await getCurrentWindow().minimize();
  } catch {
    /* ignored */
  }
}

async function toggleMaximize(): Promise<void> {
  if (!isDesktop) return;
  try {
    await getCurrentWindow().toggleMaximize();
    maximized.value = await getCurrentWindow().isMaximized();
  } catch {
    /* ignored */
  }
}

async function close(): Promise<void> {
  if (!isDesktop) return;
  try {
    await getCurrentWindow().close();
  } catch {
    /* ignored */
  }
}

function goBack(): void {
  if (window.history.length > 1) router.back();
}

onMounted(async () => {
  await refreshWindowState();
  if (!isDesktop) return;
  try {
    unlisten = await getCurrentWindow().onResized(() => {
      void refreshWindowState();
    });
  } catch {
    unlisten = null;
  }
});

onBeforeUnmount(() => {
  unlisten?.();
  unlisten = null;
});
</script>

<template>
  <header class="titlebar">
    <div class="titlebar-left">
      <button
        v-if="route.path !== '/'"
        class="tb-button"
        :title="t('common.back')"
        @click="goBack"
      >
        <ChevronLeft :size="17" />
      </button>
      <button
        v-if="!immersive"
        class="tb-button sidebar-toggle"
        :title="ui.sidebarCollapsed ? t('common.expand-sidebar') : t('common.collapse-sidebar')"
        @click="ui.toggleSidebar()"
      >
        <PanelLeftOpen v-if="ui.sidebarCollapsed" :size="16" />
        <PanelLeftClose v-else :size="16" />
      </button>
      <div class="brand" data-tauri-drag-region>
        <img :src="logo" class="brand-logo" alt="" draggable="false" />
        <span class="brand-name">Kiru</span>
      </div>
    </div>
    <div class="drag-region" data-tauri-drag-region />
    <div v-if="isDesktop" class="window-controls">
      <button class="tb-button window-button" :title="t('common.minimize')" @click="minimize">
        <Minus :size="16" />
      </button>
      <button
        class="tb-button window-button"
        :title="maximized ? t('common.restore') : t('common.maximize')"
        @click="toggleMaximize"
      >
        <Copy v-if="maximized" :size="13" />
        <Square v-else :size="13" />
      </button>
      <button
        class="tb-button window-button close-button"
        :title="t('common.close')"
        @click="close"
      >
        <X :size="16" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  height: var(--titlebar-height);
  flex: 0 0 var(--titlebar-height);
  display: flex;
  align-items: stretch;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  user-select: none;
  position: relative;
  z-index: 60;
}

.titlebar-left {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 8px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 4px;
  height: 100%;
}

.brand-logo {
  width: 22px;
  height: 22px;
  object-fit: contain;
  pointer-events: none;
}

.brand-name {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text);
}

.drag-region {
  flex: 1;
  height: 100%;
}

.tb-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 30px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  transition: background 0.14s ease, color 0.14s ease;
}

.tb-button:hover {
  background: var(--surface-2);
  color: var(--text);
}

.sidebar-toggle {
  width: 30px;
}

.window-controls {
  display: flex;
  align-items: center;
  padding-right: 4px;
  gap: 2px;
}

.window-button {
  width: 42px;
  height: 30px;
  border-radius: 6px;
}

.close-button:hover {
  background: #d93a3a;
  color: #fff;
}
</style>
