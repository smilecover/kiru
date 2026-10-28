<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { LibraryBig, Search, Store, Trash2 } from 'lucide-vue-next';
import EmptyState from '../components/EmptyState.vue';
import HistoryCard from '../components/HistoryCard.vue';
import HorizontalRow from '../components/HorizontalRow.vue';
import MediaCard from '../components/MediaCard.vue';
import { extensionTypes, extensionTypeLabel } from '../lib/labels';
import { useLibraryStore } from '../stores/library';
import { useUiStore } from '../stores/ui';
import type { ExtensionType, Favorite, History } from '../types/models';

const router = useRouter();
const { t } = useI18n();
const library = useLibraryStore();
const ui = useUiStore();

const history = computed(() => library.history);

const favoriteRows = computed(() =>
  extensionTypes.map((type) => ({
    type,
    label: extensionTypeLabel(type),
    items: library.favoritesByType(type).slice(0, 20),
  })),
);

const hasFavorites = computed(() =>
  favoriteRows.value.some((row) => row.items.length > 0),
);

const completelyEmpty = computed(
  () => history.value.length === 0 && !hasFavorites.value,
);

function openDetail(
  packageName: string,
  url: string,
  type?: ExtensionType,
): void {
  void router.push({
    name: 'detail',
    query: {
      package: packageName,
      url,
      ...(type ? { type } : {}),
    },
  });
}

function openHistory(item: History): void {
  openDetail(item.package, item.url, item.type);
}

function openFavorite(item: Favorite): void {
  openDetail(item.package, item.url, item.type);
}

function removeHistory(item: History): void {
  library.deleteHistory(item.package, item.url);
}

async function clearHistory(): Promise<void> {
  const confirmed = await ui.confirm({
    message: t('home.clear-history-confirm'),
    destructive: true,
    confirmText: t('common.delete-all'),
  });
  if (!confirmed) return;
  library.clearHistory();
  ui.notify(t('home.history-cleared'), 'success');
}

function removeFavorite(item: Favorite): void {
  library.deleteFavorite(item.id);
}
</script>

<template>
  <div class="page-scroll">
    <div class="page">
      <header class="page-header home-header">
        <div>
          <h1>{{ t('common.home') }}</h1>
          <div class="page-subtitle">{{ t('home.subtitle') }}</div>
        </div>
        <div class="spacer" />
        <RouterLink to="/search" class="btn">
          <Search :size="15" />
          {{ t('common.search') }}
        </RouterLink>
      </header>

      <EmptyState
        v-if="completelyEmpty"
        :icon="LibraryBig"
        :title="t('home.no-record')"
        :description="t('home.empty-hint')"
      >
        <div class="row">
          <RouterLink to="/extensions/repo" class="btn btn-primary">
            <Store :size="15" />
            {{ t('common.extension-repo') }}
          </RouterLink>
          <RouterLink to="/search" class="btn">
            <Search :size="15" />
            {{ t('common.search') }}
          </RouterLink>
        </div>
      </EmptyState>

      <template v-else>
        <HorizontalRow
          v-if="history.length"
          :title="t('home.continue-watching')"
          :count="history.length"
          :item-width="330"
        >
          <template #actions>
            <button class="btn btn-ghost btn-sm" @click="clearHistory">
              <Trash2 :size="13" />
              {{ t('common.delete-all') }}
            </button>
          </template>
          <HistoryCard
            v-for="item in history"
            :key="item.id"
            :history="item"
            @select="openHistory"
            @remove="removeHistory"
          />
        </HorizontalRow>

        <HorizontalRow
          v-for="row in favoriteRows.filter((entry) => entry.items.length)"
          :key="row.type"
          :title="row.label"
          :count="library.favoritesByType(row.type).length"
          :more-to="`/favorites/${row.type}`"
          :more-text="t('common.show-all')"
        >
          <MediaCard
            v-for="item in row.items"
            :key="item.id"
            :title="item.title"
            :cover="item.cover"
            :subtitle="extensionTypeLabel(item.type)"
            removable
            @select="openFavorite(item)"
            @remove="removeFavorite(item)"
          />
        </HorizontalRow>
      </template>
    </div>
  </div>
</template>

<style scoped>
.home-header {
  margin-bottom: 28px;
}

.home-header h1 {
  font-size: 27px;
}

@media (max-width: 900px) {
  .home-header .page-subtitle {
    display: none;
  }
}
</style>
