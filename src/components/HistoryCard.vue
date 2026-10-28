<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Play, X } from 'lucide-vue-next';
import SmartImage from './SmartImage.vue';
import { useExtensionsStore } from '../stores/extensions';
import type { History } from '../types/models';
import { historyProgress } from '../lib/util';

const props = defineProps<{
  history: History;
}>();

const emit = defineEmits<{
  select: [history: History];
  remove: [history: History];
}>();

const { t } = useI18n();
const extensions = useExtensionsStore();
const progress = computed(() =>
  historyProgress(props.history.progress, props.history.totalProgress),
);
const watchedLabel = computed(() =>
  t('home.watched', { ep: props.history.episodeTitle || '—' }),
);

const updateText = ref('');

async function loadUpdate(): Promise<void> {
  if (!extensions.loaded) {
    try {
      await extensions.loadExtensions();
    } catch {
      return;
    }
  }
  if (!extensions.getMeta(props.history.package)) return;
  try {
    const runtime = await extensions.ensureRuntime(props.history.package);
    const text = await runtime.checkUpdate(props.history.url);
    if (typeof text === 'string') updateText.value = text.trim();
  } catch {
    // Extensions without checkUpdate simply show no update label.
  }
}

onMounted(() => {
  void loadUpdate();
});
</script>

<template>
  <article
    class="history-card"
    role="button"
    tabindex="0"
    @click="emit('select', history)"
    @keydown.enter="emit('select', history)"
    @keydown.space.prevent="emit('select', history)"
  >
    <SmartImage
      :src="history.cover"
      class="cover"
      fit="cover"
      :alt="history.title"
    />
    <div class="shade" />
    <button
      class="remove"
      :title="t('common.delete')"
      @click.stop="emit('remove', history)"
    >
      <X :size="14" />
    </button>
    <div class="play-badge"><Play :size="15" fill="currentColor" /></div>
    <div class="meta">
      <div class="title">{{ history.title }}</div>
      <div class="meta-line">
        <div class="episode">{{ watchedLabel }}</div>
        <div v-if="updateText" class="update" :title="updateText">{{ updateText }}</div>
      </div>
      <div v-if="progress > 0" class="progress">
        <span :style="{ width: `${progress * 100}%` }" />
      </div>
    </div>
  </article>
</template>

<style scoped>
.history-card {
  position: relative;
  flex: 0 0 var(--history-card-width, 330px);
  width: var(--history-card-width, 330px);
  height: var(--history-card-height, 186px);
  border-radius: 13px;
  overflow: hidden;
  background: var(--surface-2);
  cursor: pointer;
  outline: none;
  border: 1px solid var(--border);
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.history-card:hover,
.history-card:focus-visible {
  transform: translateY(-3px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
}

.cover {
  width: 100%;
  height: 100%;
  display: block;
}

.shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.04) 30%,
    rgba(0, 0, 0, 0.18) 55%,
    rgba(0, 0, 0, 0.88) 100%
  );
  pointer-events: none;
}

.meta {
  position: absolute;
  inset: auto 0 0;
  padding: 14px 15px 13px;
  color: #fff;
}

.title {
  font-size: 14.5px;
  font-weight: 650;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}

.meta-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 3px;
}

.episode {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  opacity: 0.82;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update {
  flex: 0 1 auto;
  max-width: 45%;
  font-size: 12px;
  opacity: 0.82;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress {
  position: absolute;
  left: 15px;
  right: 15px;
  bottom: 6px;
  height: 3px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.22);
  overflow: hidden;
}

.progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
}

.play-badge {
  position: absolute;
  right: 12px;
  bottom: 24px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  backdrop-filter: blur(8px);
  opacity: 0;
  transform: scale(0.9);
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.history-card:hover .play-badge {
  opacity: 1;
  transform: scale(1);
}

.remove {
  position: absolute;
  top: 9px;
  right: 9px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.48);
  color: #fff;
  opacity: 0;
  backdrop-filter: blur(8px);
  transition: opacity 0.16s ease, background 0.16s ease;
}

.history-card:hover .remove {
  opacity: 1;
}

.remove:hover {
  background: #d94a4a;
}
</style>
