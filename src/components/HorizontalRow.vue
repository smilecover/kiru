<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import type { RouteLocationRaw } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    title: string;
    itemWidth?: number;
    moreTo?: RouteLocationRaw;
    moreText?: string;
    count?: number;
  }>(),
  {
    itemWidth: 152,
    moreTo: undefined,
    moreText: '',
    count: undefined,
  },
);

const { t } = useI18n();
const scrollEl = ref<HTMLElement | null>(null);
const trackEl = ref<HTMLElement | null>(null);
const canLeft = ref(false);
const canRight = ref(false);
let observer: ResizeObserver | null = null;

function updateArrows(): void {
  const el = scrollEl.value;
  if (!el) return;
  const max = el.scrollWidth - el.clientWidth;
  canLeft.value = el.scrollLeft > 2;
  canRight.value = max > 2 && el.scrollLeft < max - 2;
}

function scroll(direction: -1 | 1): void {
  const el = scrollEl.value;
  if (!el) return;
  const amount = Math.max(props.itemWidth * 2.2, el.clientWidth * 0.7);
  el.scrollBy({ left: amount * direction, behavior: 'smooth' });
}

onMounted(async () => {
  await nextTick();
  updateArrows();
  if (typeof ResizeObserver !== 'undefined' && trackEl.value) {
    observer = new ResizeObserver(() => updateArrows());
    observer.observe(trackEl.value);
  }
  window.addEventListener('resize', updateArrows);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  window.removeEventListener('resize', updateArrows);
});
</script>

<template>
  <section class="h-section">
    <div class="section-heading">
      <h2>{{ title }}</h2>
      <span v-if="count !== undefined" class="chip">{{ count }}</span>
      <div class="spacer" />
      <slot name="actions" />
      <div v-if="canLeft || canRight" class="row-arrows">
        <button
          class="row-arrow"
          type="button"
          :disabled="!canLeft"
          :aria-label="t('common.scroll-left')"
          @click="scroll(-1)"
        >
          <ChevronLeft :size="17" />
        </button>
        <button
          class="row-arrow"
          type="button"
          :disabled="!canRight"
          :aria-label="t('common.scroll-right')"
          @click="scroll(1)"
        >
          <ChevronRight :size="17" />
        </button>
      </div>
      <RouterLink v-if="moreTo" :to="moreTo" class="more-link">
        {{ moreText || t('common.show-all') }}
        <ChevronRight :size="14" />
      </RouterLink>
    </div>
    <div
      ref="scrollEl"
      class="h-scroll"
      :style="{ '--item-width': `${itemWidth}px` }"
      @scroll.passive="updateArrows"
    >
      <div ref="trackEl" class="h-track">
        <slot />
      </div>
    </div>
  </section>
</template>

<style scoped>
.h-section {
  margin-bottom: 26px;
}

.row-arrows {
  display: flex;
  gap: 4px;
  margin-right: 4px;
}

.row-arrow {
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text-secondary);
  transition: background 0.15s ease, opacity 0.15s ease;
}

.row-arrow:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text);
}

.row-arrow:disabled {
  opacity: 0.3;
  cursor: default;
}

.more-link {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 550;
  padding: 4px 2px 4px 8px;
  transition: color 0.15s ease;
}

.more-link:hover {
  color: var(--accent);
}

.h-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  padding: 2px 2px 6px;
  margin: -2px -2px 0;
}

.h-scroll::-webkit-scrollbar {
  height: 7px;
}

.h-track {
  display: flex;
  gap: 14px;
  width: max-content;
  min-width: 100%;
}

.h-track :deep(> *) {
  flex: 0 0 var(--item-width);
  width: var(--item-width);
}
</style>
