<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { LoaderCircle, Search, Store, X } from 'lucide-vue-next';
import EmptyState from '../components/EmptyState.vue';
import HorizontalRow from '../components/HorizontalRow.vue';
import MediaCard from '../components/MediaCard.vue';
import { extensionTypes, extensionTypeLabel } from '../lib/labels';
import { errorMessage } from '../lib/tauri';
import { useExtensionsStore } from '../stores/extensions';
import type {
  ExtensionListItem,
  ExtensionMeta,
  ExtensionType,
} from '../types/models';

interface AggregatedRow {
  package: string;
  name: string;
  type: ExtensionType;
  loading: boolean;
  items: ExtensionListItem[];
  error: string;
}

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const extensions = useExtensionsStore();

const initialQuery = String(route.query.q ?? '').trim();
const keyword = ref(initialQuery);
const submitted = ref(initialQuery);
const activeType = ref<ExtensionType | null>(null);
const rows = reactive<AggregatedRow[]>([]);
const generation = ref(0);
const waitingForExtensions = ref(false);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let mounted = true;

const visibleExtensions = computed(() =>
  extensions.visibleExtensions.filter(
    (item) => !activeType.value || item.type === activeType.value,
  ),
);

const finishedCount = computed(
  () => rows.filter((row) => !row.loading).length,
);
const progressValue = computed(() =>
  rows.length ? finishedCount.value / rows.length : 0,
);

const tabs = computed(() => [
  { value: null as ExtensionType | null, label: t('search.all') },
  ...extensionTypes.map((type) => ({
    value: type as ExtensionType | null,
    label: extensionTypeLabel(type),
  })),
]);

function promoteWithResults(row: AggregatedRow): void {
  const index = rows.findIndex((item) => item.package === row.package);
  if (index < 0) return;
  rows.splice(index, 1);
  let insertAt = 0;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].items.length > 0) insertAt = i + 1;
  }
  rows.splice(insertAt, 0, row);
}

async function runSearch(): Promise<void> {
  const runId = ++generation.value;
  rows.splice(0, rows.length);
  if (visibleExtensions.value.length === 0) {
    waitingForExtensions.value = extensions.loading;
    return;
  }
  waitingForExtensions.value = false;
  const query = submitted.value.trim();
  for (const meta of visibleExtensions.value) {
    rows.push({
      package: meta.package,
      name: meta.name,
      type: meta.type,
      loading: true,
      items: [],
      error: '',
    });
  }
  await Promise.all(
    visibleExtensions.value.map(async (meta: ExtensionMeta) => {
      const row = rows.find((item) => item.package === meta.package);
      if (!row) return;
      try {
        const runtime = await extensions.ensureRuntime(meta.package);
        const items = query
          ? await runtime.search(query, 1)
          : await runtime.latest(1);
        if (!mounted || runId !== generation.value) return;
        row.items = items;
        row.loading = false;
        if (items.length > 0) promoteWithResults(row);
      } catch (error) {
        if (!mounted || runId !== generation.value) return;
        row.error = errorMessage(error);
        row.loading = false;
      }
    }),
  );
  if (mounted && runId === generation.value) {
    for (const row of rows) row.loading = false;
  }
}

function scheduleSearch(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (!keyword.value.trim()) {
    submitted.value = '';
    void runSearch();
    return;
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    submitted.value = keyword.value.trim();
    void runSearch();
  }, 450);
}

function submitSearch(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  submitted.value = keyword.value.trim();
  void runSearch();
}

function clearSearch(): void {
  keyword.value = '';
  submitted.value = '';
  void runSearch();
}

function setType(type: ExtensionType | null): void {
  if (activeType.value === type) return;
  activeType.value = type;
  void runSearch();
}

watch(
  () => extensions.loaded,
  (loaded) => {
    if (!loaded) return;
    waitingForExtensions.value = false;
    if (rows.length === 0) void runSearch();
  },
);

watch(
  () => extensions.visibleExtensions.length,
  () => {
    if (extensions.loaded) void runSearch();
  },
);

function moreLink(row: AggregatedRow) {
  return {
    name: 'extension-search',
    query: {
      package: row.package,
      keyWord: submitted.value,
      type: row.type,
    },
  };
}

function openItem(item: ExtensionListItem, row: AggregatedRow): void {
  void router.push({
    name: 'detail',
    query: { package: row.package, url: item.url, type: row.type },
  });
}

onMounted(() => {
  mounted = true;
  void runSearch();
});

onBeforeUnmount(() => {
  mounted = false;
  generation.value += 1;
  if (debounceTimer) clearTimeout(debounceTimer);
});
</script>

<template>
  <div class="page-scroll">
    <div class="page">
      <header class="page-header">
        <h1>{{ t('common.search') }}</h1>
        <div class="spacer" />
        <div class="search-box">
          <Search :size="16" />
          <input
            v-model="keyword"
            class="input"
            type="search"
            :placeholder="t('search.hint-text')"
            @input="scheduleSearch"
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
        <RouterLink to="/extensions/repo" class="btn btn-icon" :title="t('common.extension-repo')">
          <Store :size="16" />
        </RouterLink>
      </header>

      <div class="search-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.label"
          class="search-tab"
          :class="{ active: activeType === tab.value }"
          @click="setType(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="search-progress">
        <span :style="{ width: `${progressValue * 100}%`, opacity: rows.length ? 1 : 0 }" />
      </div>

      <EmptyState
        v-if="visibleExtensions.length === 0 && !waitingForExtensions"
        :icon="Store"
        :title="t('common.no-extension')"
        :description="t('search.empty-hint')"
      >
        <RouterLink to="/extensions/repo" class="btn btn-primary">
          <Store :size="15" />
          {{ t('common.extension-repo') }}
        </RouterLink>
      </EmptyState>

      <div v-else-if="waitingForExtensions" class="search-waiting">
        <div class="spinner" />
        <span>{{ t('common.search') }}…</span>
      </div>

      <template v-else>
        <HorizontalRow
          v-for="row in rows"
          :key="row.package"
          :title="row.name"
          :count="row.items.length"
          :more-to="moreLink(row)"
          :more-text="t('common.show-all')"
          :item-width="row.items.length && !row.loading && !row.error ? 152 : 340"
        >
          <template v-if="row.loading">
            <div class="row-status">
              <LoaderCircle :size="17" class="spin" />
              <span>{{ t('common.search') }}…</span>
            </div>
          </template>
          <template v-else-if="row.error">
            <div class="row-status error">{{ row.error.split('\n')[0] }}</div>
          </template>
          <template v-else-if="row.items.length === 0">
            <div class="row-status">{{ t('common.no-result') }}</div>
          </template>
          <template v-else>
            <MediaCard
              v-for="item in row.items"
              :key="item.url"
              :title="item.title"
              :cover="item.cover"
              :headers="item.headers"
              :badge="item.update"
              @select="openItem(item, row)"
            />
          </template>
        </HorizontalRow>

        <EmptyState
          v-if="!rows.length"
          :icon="Search"
          :title="t('common.no-result')"
          :description="t('search.hint-text')"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: min(420px, 44vw);
}

.search-box > svg {
  position: absolute;
  left: 12px;
  color: var(--muted);
  pointer-events: none;
}

.search-box .input {
  height: 38px;
  padding-left: 36px;
  padding-right: 34px;
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

.clear-search:hover {
  color: var(--text);
}

.search-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.search-tab {
  height: 31px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 99px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 550;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.search-tab:hover {
  background: var(--surface-2);
  color: var(--text);
}

.search-tab.active {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent);
}

.search-progress {
  height: 2px;
  margin: 6px 2px 24px;
  border-radius: 99px;
  overflow: hidden;
  background: var(--surface-2);
}

.search-progress span {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: inherit;
  transition: width 0.35s ease, opacity 0.2s ease;
}

.search-waiting {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 160px;
  color: var(--muted);
  font-size: 13px;
}

.row-status {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 90px;
  padding-left: 4px;
  color: var(--muted);
  font-size: 12.5px;
}

.row-status.error {
  color: var(--danger);
  max-width: 520px;
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
