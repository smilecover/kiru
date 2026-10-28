import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { i18n, setLocale, t } from './i18n';
import { flushDb, initDb } from './lib/db';
import { applyNetworkConfig, setCookies } from './lib/http';
import { logError } from './lib/log';
import { initMediaProxy } from './lib/media';
import { errorMessage } from './lib/tauri';
import { applyTheme } from './lib/theme';
import { isTauri } from './lib/util';
import { restoreWindowState, trackWindowState } from './lib/window';
import { useExtensionsStore } from './stores/extensions';
import { useSettingsStore } from './stores/settings';
import { useUiStore } from './stores/ui';
import { getAnilistUser, saveAnilistToken } from './lib/anilist';
import './styles/base.css';

async function setupTauriEvents(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const ui = useUiStore();
    await listen<{ token?: string }>('anilist-token', async (event) => {
      const token = event.payload?.token;
      if (!token) return;
      saveAnilistToken(token);
      ui.notify(t('anilist.login-success'), 'success');
      try {
        const user = await getAnilistUser();
        ui.notify(t('anilist.logged-in-as', { name: user.name }), 'success');
      } catch (error) {
        ui.notifyError(error);
      }
    });
    await listen<{ error?: string }>('anilist-error', (event) => {
      ui.notify(event.payload?.error || t('anilist.login-failed'), 'error', 6000);
    });
    await listen<{ url?: string; cookies?: string }>('site-cookies', async (event) => {
      const { url, cookies } = event.payload ?? {};
      if (!url || !cookies) return;
      try {
        await setCookies(url, cookies);
        ui.notify(t('common.cookies-saved'), 'success');
      } catch (error) {
        ui.notifyError(error);
      }
    });
  } catch (error) {
    console.warn('[events] failed to register Tauri listeners', error);
  }
}

let stopTrackingWindow: (() => void) | null = null;

async function bootstrap(): Promise<void> {
  await initDb();

  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);

  const settings = useSettingsStore(pinia);
  setLocale(settings.language);
  applyTheme(settings.theme);

  app.use(i18n);
  app.use(router);

  app.config.errorHandler = (error, _instance, info) => {
    console.error('[vue]', error, info);
    logError(`${errorMessage(error)} (${info})`);
  };

  await Promise.all([
    initMediaProxy(),
    applyNetworkConfig(),
    restoreWindowState(),
    setupTauriEvents(),
  ]);

  await router.isReady();
  app.mount('#app');

  if (isTauri()) {
    stopTrackingWindow = await trackWindowState();
  }

  const extensions = useExtensionsStore(pinia);
  try {
    await extensions.loadExtensions();
  } catch (error) {
    console.warn('[extensions] failed to load', error);
  }

  window.addEventListener('beforeunload', () => {
    stopTrackingWindow?.();
    void flushDb();
  });
}

void bootstrap().catch((error) => {
  console.error('[kiru] bootstrap failed', error);
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML = `<div style="display:grid;place-items:center;height:100%;font-family:system-ui;color:#888;padding:40px;text-align:center">Failed to start Kiru.<br><br>${errorMessage(
      error,
    )
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</div>`;
  }
});
