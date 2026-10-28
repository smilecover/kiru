<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Search } from 'lucide-vue-next';
import AppModal from './AppModal.vue';
import SmartImage from './SmartImage.vue';
import {
  searchAnilistMedia,
  type AnilistMediaSearchResult,
} from '../lib/anilist';
import { anilistTypeLabel } from '../lib/labels';
import { errorMessage } from '../lib/tauri';
import { pickTitle, stripHtml } from '../lib/util';
import type { AnilistType } from '../types/models';

const props = withDefaults(
  defineProps<{
    open: boolean;
    type: AnilistType;
    initialQuery?: string;
  }>(),
  { initialQuery: '' },
);

const emit = defineEmits<{
  close: [];
  select: [media: AnilistMediaSearchResult];
}>();

const { t } = useI18n();
const query = ref('');
const results = ref<AnilistMediaSearchResult[]>([]);
const page = ref(1);
const loading = ref(false);
const moreLoading = ref(false);
const error = ref('');
let sequence = 0;

function description(media: AnilistMediaSearchResult): string {
  return stripHtml(media.description ?? '').replace(/\s+/g, ' ').trim();
}

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
    const items = await searchAnilistMedia(query.value.trim(), props.type, page.value);
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
    :title="t('detail.tracking')"
    width="700px"
    @close="emit('close')"
  >
    <div class="anilist-bind">
      <div class="bind-heading">
        <span class="chip chip-accent">{{ anilistTypeLabel(type) }}</span>
        <span class="muted small">{{ t('anilist.bind-hint') }}</span>
      </div>
      <form class="search-row" @submit.prevent="runSearch(true)">
        <div class="input-group">
          <Search :size="16" />
          <input
            v-model="query"
            class="input"
            :placeholder="t('anilist.search-placeholder')"
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
          :key="item.id"
          type="button"
          class="result-row"
          @click="emit('select', item)"
        >
          <div class="poster">
            <SmartImage
              :src="item.coverImage?.large"
              :proxy="false"
              :alt="pickTitle(item.title)"
            />
          </div>
          <div class="result-copy">
            <div class="result-title">
              {{ pickTitle(item.title) }}
              <span v-if="item.seasonYear" class="muted small">{{ item.seasonYear }}</span>
              <span v-if="item.isAdult" class="chip">18+</span>
            </div>
            <div v-if="item.status" class="result-status">{{ item.status }}</div>
            <p v-if="description(item)" class="result-overview">
              {{ description(item) }}
            </p>
          </div>
        </button>
        <button
          v-if="results.length"
          class="btn btn-ghost load-more"
          type="button"
          :disabled="moreLoading"
          @click="runSearch(false)"
        >
          {{ moreLoading ? '…' : 'Load more' }}
        </button>
      </div>

      <p v-else-if="!loading && query.trim()" class="muted center-text">
        {{ t('common.no-result') }}
      </p>
    </div>
    <template #footer>
      <div class="spacer" />
      <button class="btn" type="button" @click="emit('close')">
        {{ t('common.cancel') }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.anilist-bind {
  display: flex;
  flex-direction: column;
  gap: 13px;
  min-height: 180px;
}

.bind-heading {
  display: flex;
  align-items: center;
  gap: 8px;
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
  gap: 5px;
  max-height: 54vh;
  overflow-y: auto;
  padding-right: 2px;
}

.result-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.result-row:hover {
  background: var(--surface-2);
  border-color: var(--border);
}

.poster {
  flex: 0 0 46px;
  width: 46px;
  height: 66px;
  border-radius: 6px;
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

.result-status {
  margin-top: 1px;
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.03em;
}

.result-overview {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 4px;
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
