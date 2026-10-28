<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Search } from 'lucide-vue-next';
import AppModal from './AppModal.vue';
import SmartImage from './SmartImage.vue';
import { tmdbImage } from '../lib/media';
import { errorMessage } from '../lib/tauri';
import { tmdbDetail, tmdbSearchMulti, tmdbTitle, tmdbYear } from '../lib/tmdb';
import type { TmdbSearchItem } from '../lib/tmdb';
import type { TmdbDetail } from '../types/models';

const props = withDefaults(
  defineProps<{
    open: boolean;
    initialQuery?: string;
    currentId?: number;
  }>(),
  {
    initialQuery: '',
    currentId: undefined,
  },
);

const emit = defineEmits<{
  close: [];
  select: [payload: { id: number; mediaType: string; detail: TmdbDetail }];
  clear: [];
}>();

const { t } = useI18n();
const query = ref('');
const results = ref<TmdbSearchItem[]>([]);
const page = ref(1);
const loading = ref(false);
const moreLoading = ref(false);
const busyId = ref<number | null>(null);
const error = ref('');
let sequence = 0;

async function runSearch(reset: boolean): Promise<void> {
  if (!query.value.trim()) return;
  if (reset) {
    page.value = 1;
    results.value = [];
  }
  const runId = ++sequence;
  if (page.value === 1) loading.value = true;
  else moreLoading.value = true;
  error.value = '';
  try {
    const items = await tmdbSearchMulti(query.value.trim(), page.value);
    if (runId !== sequence) return;
    results.value = page.value === 1 ? items : [...results.value, ...items];
    if (items.length > 0) page.value += 1;
  } catch (caught) {
    if (runId === sequence) error.value = errorMessage(caught);
  } finally {
    if (runId === sequence) {
      loading.value = false;
      moreLoading.value = false;
    }
  }
}

async function choose(item: TmdbSearchItem): Promise<void> {
  if (busyId.value !== null) return;
  busyId.value = item.id;
  error.value = '';
  try {
    const detail = await tmdbDetail(item.id, item.media_type);
    emit('select', { id: item.id, mediaType: item.media_type, detail });
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    busyId.value = null;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    sequence += 1;
    query.value = props.initialQuery ?? '';
    results.value = [];
    page.value = 1;
    error.value = '';
    loading.value = false;
    moreLoading.value = false;
    if (query.value.trim()) void runSearch(true);
  },
  { immediate: true },
);
</script>

<template>
  <AppModal
    :open="open"
    :title="currentId ? t('detail.modify-tmdb-binding') : t('detail.bind-tmdb')"
    width="720px"
    @close="emit('close')"
  >
    <div class="tmdb-bind">
      <form class="search-row" @submit.prevent="runSearch(true)">
        <div class="input-group">
          <Search :size="16" />
          <input
            v-model="query"
            class="input"
            :placeholder="t('detail.no-tmdb-data')"
            autofocus
          />
        </div>
        <button class="btn btn-primary" type="submit" :disabled="loading || !query.trim()">
          {{ t('common.search') }}
        </button>
      </form>

      <p v-if="error" class="error-banner">{{ error }}</p>

      <div v-if="loading" class="loading-center">
        <div class="spinner" />
      </div>

      <div v-else-if="results.length" class="result-list">
        <button
          v-for="item in results"
          :key="`${item.media_type}-${item.id}`"
          type="button"
          class="result-row"
          :disabled="busyId !== null"
          @click="choose(item)"
        >
          <div class="poster">
            <SmartImage
              :src="tmdbImage(item.poster_path, 'w185')"
              :proxy="false"
              :alt="tmdbTitle(item)"
            />
          </div>
          <div class="result-copy">
            <div class="result-title">
              {{ tmdbTitle(item) }}
              <span class="chip chip-outline">
                {{ item.media_type === 'movie' ? t('common.movie') : t('common.tv') }}
              </span>
              <span v-if="tmdbYear(item)" class="muted small">{{ tmdbYear(item) }}</span>
            </div>
            <p v-if="item.overview" class="result-overview">{{ item.overview }}</p>
          </div>
          <div v-if="busyId === item.id" class="spinner" />
        </button>
        <button
          v-if="results.length > 0"
          class="btn btn-ghost load-more"
          type="button"
          :disabled="moreLoading"
          @click="runSearch(false)"
        >
          {{ moreLoading ? '…' : t('common.load-more') }}
        </button>
      </div>

      <p v-else-if="!loading && query.trim()" class="muted center-text">
        {{ t('common.no-result') }}
      </p>
    </div>
    <template #footer>
      <button
        v-if="currentId"
        class="btn btn-danger"
        type="button"
        @click="emit('clear')"
      >
        {{ t('detail.unbind-tmdb') }}
      </button>
      <div class="spacer" />
      <button class="btn" type="button" @click="emit('close')">
        {{ t('common.cancel') }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.tmdb-bind {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 180px;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 9px;
}

.search-row .input-group {
  flex: 1;
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 54vh;
  overflow-y: auto;
  padding-right: 2px;
}

.result-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.result-row:hover:not(:disabled) {
  background: var(--surface-2);
  border-color: var(--border);
}

.result-row:disabled {
  cursor: default;
}

.poster {
  flex: 0 0 48px;
  width: 48px;
  height: 72px;
  border-radius: 7px;
  overflow: hidden;
  background: var(--surface-2);
}

.result-copy {
  min-width: 0;
  flex: 1;
}

.result-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
}

.result-overview {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 3px;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.5;
}

.load-more {
  align-self: center;
  margin-top: 6px;
}

.center-text {
  padding: 26px 0;
  text-align: center;
}
</style>
