<script setup lang="ts">
import { Inbox } from 'lucide-vue-next';

withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    compact?: boolean;
  }>(),
  {
    title: '',
    description: '',
    compact: false,
  },
);
</script>

<template>
  <div class="empty-state" :class="{ compact }">
    <div class="empty-icon">
      <slot name="icon"><Inbox :size="26" /></slot>
    </div>
    <h3 v-if="title">{{ title }}</h3>
    <p v-if="description" class="empty-description">{{ description }}</p>
    <slot />
  </div>
</template>

<style scoped>
.empty-state.compact {
  padding: 34px 16px;
}

.empty-description {
  max-width: 420px;
  font-size: 12.5px;
  line-height: 1.6;
}

.empty-icon :deep(svg) {
  color: var(--muted);
}
</style>
