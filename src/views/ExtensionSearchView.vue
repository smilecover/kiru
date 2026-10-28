<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Filter, LoaderCircle, Search, X } from 'lucide-vue-next';
import AppModal from '../components/AppModal.vue';
import EmptyState from '../components/EmptyState.vue';
import MediaCard from '../components/MediaCard.vue';
import type { ExtensionRuntime } from '../lib/extension-runtime';
import {
  extensionTypeLabel,
  normalizeExtensionType,
} from '../lib/labels';
import { errorMessage } from '../lib/tauri';
import { clone } from '../lib/util';
import { useExtensionsStore } from '../stores/extensions';
import { useUiStore } from '../stores/ui';
import type {
  ExtensionFilter,
  ExtensionListItem,
  ExtensionType,
} from '../types/models';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const extensions = useExtensionsStore();
const ui = useUiStore();

const packageName = String(route.query.package ?? '');
const meta = computed(() => extensions.getMeta(packageName));
const type = computed<ExtensionType | null>(() =>
  normalizeExtensionType(route.query.type) ?? meta.value?.type ?? null,
);

const keyword = ref(String(route.query.keyWord ?? ''));
const items = ref<ExtensionListItem[]>([]);
const page = ref(1);
const loading = ref(false);
const initializing = ref(true);
const error = ref('');
const noMore = ref(false);
let runtime: ExtensionRuntime | null = null;

const appliedFilters = ref<Record<string, ExtensionFilter> | null>(null);
const appliedSelected = ref<Record<string, string[]>>({});
const filterOpen = ref(false);
const draftFilters = ref<Record<string, ExtensionFilter>>({});
const draftSelected = ref<Record<string, string[]>>({});
const filterBusy = ref(false);
let filterSequence = 0;

const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
let mounted = true;

const hasFilters = computed(
  () => appliedFilters.value !== null && Object.keys(appliedFilters.value).length > 0,
);

function initializeSelected(
  filters: Record<string, ExtensionFilter>,
): Record<string, string[]> {
  const selected: Record<string, string[]> = {};
  for (const [key, filter] of Object.entries(filters)) {
    selected[key] = filter.default ? [filter.default] : [];
  }
  return selected;
}

async function loadPage(reset = false): Promise<void> {
  if (!runtime || loading.value) return;
  if (reset) {
    page.value = 1;
    items.value = [];
    noMore.value = false;
  }
  if (noMore.value) return;
  loading.value = true;
  error.value = '';
  const requestedPage = page.value;
  try {
    const query = keyword.value.trim();
    const filters = appliedFilters.value
      ? clone(appliedSelected.value)
      : null;
    const result =
      query || filters
        ? await runtime.search(query, requestedPage, filters)
        : await runtime.latest(requestedPage);
    if (!mounted) return;
    if (requestedPage === 1) items.value = result;
    else items.value = [...items.value, ...result];
    noMore.value = result.length === 0;
    page.value = requestedPage + 1;
  } catch (caught) {
    if (!mounted) return;
    error.value = errorMessage(caught);
  } finally {
    if (mounted) {
      loading.value = false;
      maybeFill();
    }
  }
}

/** IntersectionObserver only fires on crossings; keep short pages filling. */
function maybeFill(): void {
  requestAnimationFrame(() => {
    if (!mounted || loading.value || noMore.value || initializing.value || error.value) return;
    const element = sentinel.value;
    if (element && element.getBoundingClientRect().top < window.innerHeight + 400) {
      void loadPage();
    }
  });
}

async function initialize(): Promise<void> {
  initializing.value = true;
  error.value = '';
  try {
    if (!extensions.loaded) await extensions.loadExtensions();
    if (!extensions.getMeta(packageName)) {
      error.value = t('common.extension-missing', { package: packageName });
      return;
    }
    runtime = await extensions.ensureRuntime(packageName);
    // Filters are optional. Miru's base class throws "not implement
    // createFilter"; treat that (and any filter failure) as no filters so
    // browsing still works. A null map also makes loadPage use latest().
    let filters: Record<string, ExtensionFilter> | null = null;
    try {
      filters = await runtime.createFilter();
      if (filters && Object.keys(filters).length === 0) filters = null;
    } catch {
      filters = null;
    }
    appliedFilters.value = filters;
    appliedSelected.value = filters ? initializeSelected(filters) : {};
    await loadPage(true);
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    initializing.value = false;
    maybeFill();
  }
}

function submitSearch(): void {
  void loadPage(true);
}

function clearSearch(): void {
  keyword.value = '';
  void loadPage(true);
}

function openFilters(): void {
  if (!appliedFilters.value) return;
  draftFilters.value = clone(appliedFilters.value);
  draftSelected.value = clone(appliedSelected.value);
  filterOpen.value = true;
}

function closeFilters(): void {
  filterOpen.value = false;
  filterSequence += 1;
  filterBusy.value = false;
}

async function toggleOption(filterKey: string, optionKey: string): Promise<void> {
  if (!runtime) return;
  const filter = draftFilters.value[filterKey];
  if (!filter) return;
  const selected = draftSelected.value[filterKey] ?? [];
  const next = [...selected];
  if (next.includes(optionKey)) {
    if (next.length > filter.min) next.splice(next.indexOf(optionKey), 1);
  } else {
    const max = Math.max(1, filter.max);
    if (next.length >= max) next.shift();
    next.push(optionKey);
  }
  const nextSelected = { ...draftSelected.value, [filterKey]: next };
  const sequence = ++filterSequence;
  filterBusy.value = true;
  try {
    const updated = await runtime.createFilter(clone(nextSelected));
    if (sequence !== filterSequence || !filterOpen.value) return;
    for (const key of Object.keys(nextSelected)) {
      if (!(key in updated)) delete nextSelected[key];
    }
    draftFilters.value = updated;
    draftSelected.value = nextSelected;
  } catch (caught) {
    if (sequence === filterSequence) ui.notifyError(caught);
  } finally {
    if (sequence === filterSequence) filterBusy.value = false;
  }
}

function applyFilters(): void {
  appliedFilters.value = clone(draftFilters.value);
  appliedSelected.value = clone(draftSelected.value);
  filterOpen.value = false;
  void loadPage(true);
}

function isSelected(filterKey: string, optionKey: string): boolean {
  return (draftSelected.value[filterKey] ?? []).includes(optionKey);
}

function openItem(item: ExtensionListItem): void {
  void router.push({
    name: 'detail',
    query: {
      package: packageName,
      url: item.url,
      ...(type.value ? { type: type.value } : {}),
    },
  });
}

function retry(): void {
  if (!runtime) {
    void initialize();
    return;
  }
  void loadPage(true);
}

watch(
  () => route.query.keyWord,
  (value) => {
    const next = String(value ?? '');
    if (next === keyword.value) return;
    keyword.value = next;
    if (runtime) void loadPage(true);
  },
);

onMounted(() => {
  mounted = true;
  void initialize();
  if (typeof IntersectionObserver !== 'undefined' && sentinel.value) {
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (!loading.value && !noMore.value && !initializing.value && !error.value) {
          void loadPage();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(sentinel.value);
  }
});

onBeforeUnmount(() => {
  mounted = false;
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <div class="page-scroll">
    <div class="page">
      <header class="page-header">
        <div class="title-wrap">
          <h1>{{ meta?.name || packageName || t('common.extension') }}</h1>
          <div v-if="type" class="page-subtitle">
            <span class="chip chip-outline">{{ extensionTypeLabel(type) }}</span>
            <span class="package-name">{{ packageName }}</span>
          </div>
        </div>
        <div class="spacer" />
        <div class="search-box">
          <Search :size="16" />
          <input
            v-model="keyword"
            class="input"
            type="search"
            :placeholder="t('search.hint-text')"
            @keydown.enter="submitSearch"
          />
          <button
            v-if="keyword"
            class="clear-search"
            :title="t('common.clear')"
            @click="clearSearch"
          >
            <X :size="14" />
          </button>
        </div>
        <button
          v-if="hasFilters"
          class="btn btn-icon"
          :title="t('search.filter')"
          @click="openFilters"
        >
          <Filter :size="16" />
        </button>
      </header>

      <div v-if="error && items.length" class="inline-error">
        <span>{{ error }}</span>
        <button class="btn btn-sm" @click="retry">{{ t('common.retry') }}</button>
      </div>

      <div v-if="initializing" class="center-state">
        <div class="spinner lg" />
      </div>

      <EmptyState
        v-else-if="error && !items.length"
        :title="t('common.error')"
        :description="error"
      >
        <button class="btn" @click="retry">{{ t('common.retry') }}</button>
      </EmptyState>

      <template v-else-if="items.length">
        <div class="grid-cards">
          <MediaCard
            v-for="item in items"
            :key="item.url"
            :title="item.title"
            :cover="item.cover"
            :headers="item.headers"
            :badge="item.update"
            @select="openItem(item)"
          />
        </div>
      </template>

      <EmptyState
        v-else
        :title="t('common.no-result')"
        :description="keyword ? t('search.hint-text') : undefined"
      />

      <div ref="sentinel" class="load-sentinel">
        <div v-if="loading" class="row muted small">
          <LoaderCircle :size="16" class="spin" />
          {{ t('common.search') }}…
        </div>
        <span v-else-if="noMore && items.length" class="muted small">
          {{ t('common.no-more-data') }}
        </span>
      </div>
    </div>

    <AppModal
      :open="filterOpen"
      :title="t('search.filter')"
      width="660px"
      @close="closeFilters"
    >
      <div class="filter-content">
        <div v-if="filterBusy" class="filter-busy">
          <div class="spinner" />
        </div>
        <section
          v-for="(filter, key) in draftFilters"
          :key="key"
          class="filter-group"
        >
          <div class="filter-title">
            {{ filter.title }}
            <span v-if="filter.max > 1" class="filter-range">
              {{ filter.min }}–{{ filter.max }}
            </span>
          </div>
          <div class="filter-options">
            <button
              v-for="(label, value) in filter.options"
              :key="value"
              type="button"
              class="filter-option"
              :class="{ selected: isSelected(String(key), String(value)) }"
              @click="toggleOption(String(key), String(value))"
            >
              {{ label }}
            </button>
          </div>
        </section>
        <p v-if="!Object.keys(draftFilters).length" class="muted">
          {{ t('common.no-data') }}
        </p>
      </div>
      <template #footer>
        <div class="row filter-actions">
          <div class="spacer" />
          <button class="btn" @click="closeFilters">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" @click="applyFilters">
            {{ t('common.confirm') }}
          </button>
        </div>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.title-wrap {
  min-width: 0;
}

.title-wrap h1 {
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-subtitle {
  display: flex;
  align-items: center;
  gap: 8px;
}

.package-name {
  font-size: 11px;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: min(360px, 38vw);
}

.search-box > svg {
  position: absolute;
  left: 12px;
  color: var(--muted);
  pointer-events: none;
}

.search-box .input {
  height: 36px;
  padding-left: 35px;
  padding-right: 32px;
  border-radius: 99px;
}

.search-box input::-webkit-search-cancel-button {
  display: none;
}

.clear-search {
  position: absolute;
  right: 8px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: var(--surface-3);
  color: var(--muted);
}

.center-state {
  display: grid;
  place-items: center;
  height: 280px;
}

.load-sentinel {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  padding-top: 12px;
  color: var(--muted);
}

.inline-error {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: rgba(217, 74, 74, 0.09);
  color: var(--danger);
  font-size: 12px;
}

.inline-error span {
  flex: 1;
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.filter-content {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 22px;
  max-height: 58vh;
  overflow-y: auto;
  padding: 4px 2px 12px;
}

.filter-busy {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--surface) 55%, transparent);
  backdrop-filter: blur(1px);
}

.filter-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 650;
}

.filter-range {
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 500;
}

.filter-options {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.filter-option {
  height: 29px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 99px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}

.filter-option:hover {
  background: var(--surface-2);
  color: var(--text);
}

.filter-option.selected {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.filter-actions {
  width: 100%;
}
</style>
