<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { HeartOff, Trash2 } from 'lucide-vue-next';
import EmptyState from '../components/EmptyState.vue';
import MediaCard from '../components/MediaCard.vue';
import {
  extensionTypes,
  extensionTypeLabel,
  normalizeExtensionType,
} from '../lib/labels';
import { useLibraryStore } from '../stores/library';
import { useUiStore } from '../stores/ui';
import type { ExtensionType, Favorite } from '../types/models';

const props = defineProps<{ type?: string }>();
const router = useRouter();
const { t } = useI18n();
const library = useLibraryStore();
const ui = useUiStore();

const activeType = computed<ExtensionType | null>(() =>
  normalizeExtensionType(props.type),
);

const items = computed(() => library.favoritesByType(activeType.value ?? undefined));

const title = computed(() => {
  if (!activeType.value) return t('common.favorites');
  return t('home.favorite-all', {
    type: extensionTypeLabel(activeType.value).toLowerCase(),
  });
});

const tabs = computed(() => [
  { type: null as ExtensionType | null, label: t('search.all') },
  ...extensionTypes.map((type) => ({
    type: type as ExtensionType | null,
    label: extensionTypeLabel(type),
  })),
]);

function openFavorite(item: Favorite): void {
  void router.push({
    name: 'detail',
    query: { package: item.package, url: item.url, type: item.type },
  });
}

function removeFavorite(item: Favorite): void {
  library.deleteFavorite(item.id);
}

async function clearAll(): Promise<void> {
  const confirmed = await ui.confirm({
    message: t('favorites.clear-confirm'),
    destructive: true,
    confirmText: t('common.delete-all'),
  });
  if (!confirmed) return;
  library.clearFavorites();
  ui.notify(t('favorites.cleared'), 'success');
}
</script>

<template>
  <div class="page-scroll">
    <div class="page">
      <header class="page-header">
        <h1>{{ title }}</h1>
        <span v-if="items.length" class="chip">{{ items.length }}</span>
        <div class="spacer" />
        <button
          v-if="items.length"
          class="btn btn-danger btn-sm"
          @click="clearAll"
        >
          <Trash2 :size="14" />
          {{ t('common.delete-all') }}
        </button>
      </header>

      <div class="type-tabs">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.label"
          :to="tab.type ? `/favorites/${tab.type}` : '/favorites'"
          class="type-tab"
          :class="{ active: activeType === tab.type }"
        >
          {{ tab.label }}
          <span v-if="tab.type" class="tab-count">
            {{ library.favoritesByType(tab.type).length }}
          </span>
        </RouterLink>
      </div>

      <EmptyState
        v-if="items.length === 0"
        :icon="HeartOff"
        :title="t('common.no-result')"
        :description="t('favorites.empty-hint')"
      />

      <div v-else class="grid-cards">
        <MediaCard
          v-for="item in items"
          :key="item.id"
          :title="item.title"
          :cover="item.cover"
          :subtitle="extensionTypeLabel(item.type)"
          removable
          @select="openFavorite(item)"
          @remove="removeFavorite(item)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.type-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 22px;
  flex-wrap: wrap;
}

.type-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 13px;
  border: 1px solid var(--border);
  border-radius: 99px;
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 550;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.type-tab:hover {
  background: var(--surface-2);
  color: var(--text);
}

.type-tab.active {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent);
}

.tab-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  display: inline-grid;
  place-items: center;
  border-radius: 99px;
  background: var(--surface-3);
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
}

.type-tab.active .tab-count {
  background: var(--accent);
  color: var(--accent-contrast);
}
</style>
