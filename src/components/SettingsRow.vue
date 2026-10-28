<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    subtitle?: string;
    stacked?: boolean;
  }>(),
  {
    title: '',
    subtitle: '',
    stacked: false,
  },
);
</script>

<template>
  <div class="settings-row" :class="{ stacked }">
    <div class="settings-copy">
      <div v-if="title" class="settings-title">{{ title }}</div>
      <div v-if="subtitle" class="settings-subtitle">{{ subtitle }}</div>
    </div>
    <div class="settings-control"><slot /></div>
  </div>
</template>

<style scoped>
.settings-row {
  display: flex;
  align-items: center;
  gap: 20px;
  min-height: 52px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.settings-row:last-child {
  border-bottom: none;
}

.settings-copy {
  min-width: 0;
  flex: 1;
}

.settings-title {
  font-size: 13.5px;
  font-weight: 550;
}

.settings-subtitle {
  margin-top: 2px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.settings-control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
}

.settings-row.stacked {
  align-items: flex-start;
  flex-direction: column;
}

.settings-row.stacked .settings-control {
  width: 100%;
  justify-content: flex-start;
}
</style>
