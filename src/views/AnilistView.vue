<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Star,
  Tv,
} from 'lucide-vue-next';
import SmartImage from '../components/SmartImage.vue';
import {
  anilistLoggedIn,
  getAnilistCollection,
  getAnilistUser,
  saveAnilistToken,
  type AnilistUserData,
} from '../lib/anilist';
import { call, errorMessage } from '../lib/tauri';
import { isTauri, pickTitle } from '../lib/util';
import { useUiStore } from '../stores/ui';
import type {
  AnilistCollectionEntry,
  AnilistType,
} from '../types/models';

const router = useRouter();
const { t } = useI18n();
const ui = useUiStore();

const user = ref<AnilistUserData | null>(null);
const anime = ref<AnilistCollectionEntry[]>([]);
const manga = ref<AnilistCollectionEntry[]>([]);
const loading = ref(false);
const error = ref('');
const loginPending = ref(false);
const loginError = ref('');
const loggingOut = ref(false);

let unlistenToken: (() => void) | null = null;
let unlistenError: (() => void) | null = null;
let loginTimer: ReturnType<typeof setTimeout> | null = null;

const loggedIn = computed(() => Boolean(user.value));

const sections = computed(() => [
  {
    key: 'anime',
    type: 'anime' as AnilistType,
    label: t('anilist.watching'),
    icon: Tv,
    entries: anime.value,
    empty: t('anilist.no-current-anime'),
  },
  {
    key: 'manga',
    type: 'manga' as AnilistType,
    label: t('anilist.reading'),
    icon: BookOpen,
    entries: manga.value,
    empty: t('anilist.no-current-manga'),
  },
]);

function titleOf(entry: AnilistCollectionEntry): string {
  return pickTitle(entry.media.title) || `#${entry.media.id}`;
}

function totalOf(entry: AnilistCollectionEntry): number {
  return entry.media.episodes ?? entry.media.chapters ?? 0;
}

function progressPercent(entry: AnilistCollectionEntry): number {
  const total = totalOf(entry);
  if (!total) return 0;
  return Math.min(100, Math.round((entry.progress / total) * 100));
}

function searchTitle(entry: AnilistCollectionEntry): void {
  const title = titleOf(entry).trim();
  if (!title) return;
  void router.push({ name: 'search', query: { q: title } });
}

function openProfile(): void {
  if (!user.value) return;
  void openUrl(`https://anilist.co/user/${encodeURIComponent(user.value.name)}`).catch(
    (caught) => ui.notifyError(caught),
  );
}

async function load(): Promise<void> {
  if (!anilistLoggedIn()) {
    user.value = null;
    anime.value = [];
    manga.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const profile = await getAnilistUser();
    user.value = profile;
    const [animeCollection, mangaCollection] = await Promise.all([
      getAnilistCollection('anime'),
      getAnilistCollection('manga'),
    ]);
    anime.value = animeCollection.CURRENT ?? [];
    manga.value = mangaCollection.CURRENT ?? [];
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

function clearLoginTimer(): void {
  if (loginTimer) {
    clearTimeout(loginTimer);
    loginTimer = null;
  }
}

function markLoginPending(): void {
  loginPending.value = true;
  clearLoginTimer();
  loginTimer = setTimeout(() => {
    loginTimer = null;
    loginPending.value = false;
  }, 120_000);
}

async function login(): Promise<void> {
  loginError.value = '';
  try {
    await call('open_anilist_login');
    markLoginPending();
  } catch (caught) {
    loginError.value = errorMessage(caught);
  }
}

async function logout(): Promise<void> {
  if (loggingOut.value) return;
  const confirmed = await ui.confirm({
    title: t('common.logout'),
    message: t('anilist.logout-confirm'),
    confirmText: t('common.logout'),
    destructive: true,
  });
  if (!confirmed) return;
  loggingOut.value = true;
  try {
    saveAnilistToken('');
    user.value = null;
    anime.value = [];
    manga.value = [];
    error.value = '';
    loginPending.value = false;
    loginError.value = '';
    clearLoginTimer();
    ui.notify(t('anilist.logged-out'), 'success');
  } finally {
    loggingOut.value = false;
  }
}

onMounted(async () => {
  if (isTauri()) {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      unlistenToken = await listen<{ token?: string }>('anilist-token', async (event) => {
        if (!event.payload?.token) return;
        clearLoginTimer();
        loginPending.value = false;
        loginError.value = '';
        await new Promise((resolve) => setTimeout(resolve, 150));
        void load();
      });
      unlistenError = await listen<{ error?: string }>('anilist-error', (event) => {
        clearLoginTimer();
        loginPending.value = false;
        loginError.value = event.payload?.error || t('anilist.login-failed');
      });
    } catch (caught) {
      console.warn('[anilist] failed to register listeners', caught);
    }
  }
  void load();
});

onBeforeUnmount(() => {
  clearLoginTimer();
  unlistenToken?.();
  unlistenError?.();
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
          <h1>{{ t('anilist.title') }}</h1>
          <div class="page-subtitle">{{ t('anilist.subtitle') }}</div>
        </div>
        <div class="spacer" />
        <button
          v-if="loggedIn"
          class="btn btn-icon"
          :title="t('common.retry')"
          :disabled="loading"
          @click="load"
        >
          <RefreshCw :size="16" :class="{ spin: loading }" />
        </button>
      </header>

      <div v-if="loginError" class="error-banner login-error">
        <AlertCircle :size="16" />
        <span>{{ loginError }}</span>
        <button class="btn btn-sm" @click="login">{{ t('common.retry') }}</button>
      </div>

      <div v-if="error && !loggedIn && !loading" class="error-banner login-error">
        <AlertCircle :size="16" />
        <span>{{ error }}</span>
        <button class="btn btn-sm" @click="load">{{ t('common.retry') }}</button>
      </div>

      <section v-if="!loggedIn && !loading" class="login-card">
        <div class="al-mark">AL</div>
        <h2>{{ t('anilist.login-title') }}</h2>
        <p>{{ t('anilist.login-hint-2') }}</p>
        <p class="login-description">{{ t('anilist.login-description') }}</p>
        <button class="btn btn-primary login-button" @click="login">
          <LoaderCircle v-if="loginPending" :size="15" class="spin" />
          {{ loginPending ? t('anilist.login-waiting') : t('common.login') }}
        </button>
        <p v-if="loginPending" class="login-pending">
          {{ t('anilist.login-pending-hint') }}
        </p>
        <p class="login-privacy">{{ t('anilist.login-privacy') }}</p>
      </section>

      <div v-else-if="loading && !loggedIn" class="loading-center">
        <div class="spinner lg" />
      </div>

      <template v-else-if="loggedIn">
        <section class="profile-card">
          <div class="avatar">
            <SmartImage :src="user?.avatar" :alt="user?.name" />
          </div>
          <div class="profile-copy">
            <div class="profile-name">
              {{ user?.name }}
              <button class="profile-link" :title="t('anilist.open-profile')" @click="openProfile">
                <ExternalLink :size="13" />
              </button>
            </div>
            <div class="profile-stats">
              <span>{{ t('anilist.anime-episode-watch', { episodes: user?.animeEpisodesWatched ?? 0 }) }}</span>
              <span>{{ t('anilist.manga-chapter-read', { chapters: user?.mangaChaptersRead ?? 0 }) }}</span>
            </div>
          </div>
          <div class="spacer" />
          <button class="btn btn-sm btn-ghost logout-button" :disabled="loggingOut" @click="logout">
            <LogOut :size="13" />
            {{ t('common.logout') }}
          </button>
        </section>

        <div v-if="error" class="error-banner collection-error">
          <AlertCircle :size="16" />
          <span>{{ error }}</span>
          <button class="btn btn-sm" @click="load">{{ t('common.retry') }}</button>
        </div>

        <div v-if="loading" class="loading-center collection-loading">
          <div class="spinner lg" />
        </div>

        <template v-else>
          <section
            v-for="section in sections"
            :key="section.key"
            class="current-section"
          >
            <div class="section-heading">
              <component :is="section.icon" :size="17" />
              <h2>{{ section.label }}</h2>
              <span v-if="section.entries.length" class="chip">{{ section.entries.length }}</span>
              <div class="spacer" />
              <RouterLink
                v-if="section.entries.length"
                :to="{ name: 'anilist-more', query: { type: section.type } }"
                class="more-link"
              >
                {{ t('common.show-all') }}
                <ChevronRight :size="13" />
              </RouterLink>
            </div>

            <div v-if="section.entries.length" class="current-grid">
              <button
                v-for="entry in section.entries"
                :key="entry.media.id"
                class="current-card"
                :title="t('anilist.search-title', { title: titleOf(entry) })"
                @click="searchTitle(entry)"
              >
                <div class="current-cover">
                  <SmartImage
                    :src="entry.media.coverImage?.large"
                    :alt="titleOf(entry)"
                  />
                  <span v-if="entry.score > 0" class="score-badge">
                    <Star :size="10" />
                    {{ entry.score }}
                  </span>
                </div>
                <div class="current-copy">
                  <div class="current-title">{{ titleOf(entry) }}</div>
                  <div class="current-progress">
                    <span>
                      {{ t('anilist.progress', {
                        progress: entry.progress,
                        total: totalOf(entry) || '?',
                      }) }}
                    </span>
                    <span v-if="totalOf(entry)">{{ progressPercent(entry) }}%</span>
                  </div>
                  <div class="progress-track">
                    <span :style="{ width: `${progressPercent(entry)}%` }" />
                  </div>
                </div>
              </button>
            </div>

            <div v-else class="current-empty">
              <component :is="section.icon" :size="17" />
              <span>{{ section.empty }}</span>
            </div>
          </section>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.title-wrap {
  min-width: 0;
}

.login-error {
  align-items: center;
  margin-bottom: 16px;
}

.login-error span {
  flex: 1;
  overflow-wrap: anywhere;
}

.login-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 460px;
  margin: 34px auto 0;
  padding: 36px 30px 26px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  text-align: center;
}

.al-mark {
  display: grid;
  place-items: center;
  width: 62px;
  height: 62px;
  border-radius: 17px;
  background: linear-gradient(145deg, #02a9ff, #3db4f2);
  color: #fff;
  font-size: 23px;
  font-weight: 800;
  letter-spacing: -0.04em;
  box-shadow: 0 8px 22px rgba(2, 169, 255, 0.28);
}

.login-card h2 {
  margin-top: 16px;
  font-size: 18px;
  font-weight: 700;
}

.login-card > p {
  margin-top: 7px;
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.65;
}

.login-card .login-description {
  max-width: 340px;
  color: var(--muted);
}

.login-button {
  min-width: 150px;
  height: 38px;
  margin-top: 18px;
}

.login-pending {
  color: var(--accent) !important;
  font-size: 11.5px !important;
}

.login-card .login-privacy {
  margin-top: 20px;
  color: var(--muted);
  font-size: 10.5px;
}

.profile-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 15px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.avatar {
  width: 58px;
  height: 58px;
  flex: 0 0 auto;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid var(--surface-3);
  background: var(--surface-2);
}

.profile-copy {
  min-width: 0;
}

.profile-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 700;
}

.profile-link {
  display: inline-grid;
  place-items: center;
  width: 23px;
  height: 23px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
}

.profile-link:hover {
  background: var(--surface-2);
  color: var(--accent);
}

.profile-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 4px;
  color: var(--muted);
  font-size: 11.5px;
}

.logout-button {
  color: var(--muted);
}

.logout-button:hover {
  color: var(--danger);
}

.collection-error {
  align-items: center;
  margin-top: 14px;
}

.collection-error span {
  flex: 1;
  overflow-wrap: anywhere;
}

.collection-loading {
  min-height: 180px;
}

.current-section {
  margin-top: 24px;
}

.section-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 11px;
  color: var(--text-secondary);
}

.section-heading h2 {
  color: var(--text);
  font-size: 15px;
  font-weight: 650;
}

.more-link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 550;
}

.more-link:hover {
  color: var(--accent);
}

.current-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(154px, 1fr));
  gap: 12px;
}

.current-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface);
  text-align: left;
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.current-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow);
}

.current-cover {
  position: relative;
  aspect-ratio: 2 / 3;
  background: var(--surface-2);
}

.score-badge {
  position: absolute;
  top: 7px;
  right: 7px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 7px;
  border-radius: 99px;
  background: rgba(10, 12, 16, 0.72);
  color: #ffd166;
  font-size: 10px;
  font-weight: 700;
  backdrop-filter: blur(6px);
}

.current-copy {
  padding: 9px 10px 10px;
}

.current-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 32px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
}

.current-progress {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-top: 5px;
  color: var(--muted);
  font-size: 10px;
}

.progress-track {
  height: 3px;
  margin-top: 5px;
  border-radius: 99px;
  overflow: hidden;
  background: var(--surface-3);
}

.progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #3db4f2;
}

.current-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 70px;
  padding: 0 16px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--muted);
  font-size: 12.5px;
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .profile-card {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .profile-card .spacer {
    display: none;
  }

  .logout-button {
    margin-left: 72px;
  }

  .current-grid {
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  }
}
</style>
