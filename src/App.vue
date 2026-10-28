<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import AppSidebar from './components/AppSidebar.vue';
import AppTitlebar from './components/AppTitlebar.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import ToastHost from './components/ToastHost.vue';
import { applyTheme } from './lib/theme';
import { useSettingsStore } from './stores/settings';
import { useUiStore } from './stores/ui';

const route = useRoute();
const settings = useSettingsStore();
const ui = useUiStore();

const immersive = computed(() => Boolean(route.meta.immersive));
const media = window.matchMedia('(prefers-color-scheme: dark)');

function refreshTheme(): void {
  applyTheme(settings.theme);
}

watch(() => settings.theme, refreshTheme);

onMounted(() => {
  refreshTheme();
  media.addEventListener('change', refreshTheme);
});

onBeforeUnmount(() => {
  media.removeEventListener('change', refreshTheme);
});
</script>

<template>
  <div class="app-shell">
    <AppTitlebar />
    <div class="app-body">
      <AppSidebar v-if="!immersive" />
      <main class="app-content">
        <RouterView v-slot="{ Component }">
          <component :is="Component" :key="route.fullPath" />
        </RouterView>
      </main>
    </div>
    <ToastHost />
    <ConfirmDialog />
    <Transition name="fade">
      <div v-if="ui.globalLoading" class="global-loading">
        <div class="spinner lg" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.global-loading {
  position: fixed;
  inset: var(--titlebar-height) 0 0;
  z-index: 900;
  display: grid;
  place-items: center;
  background: rgba(10, 12, 18, 0.18);
  backdrop-filter: blur(1.5px);
}
</style>
