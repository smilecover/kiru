<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { X } from 'lucide-vue-next';
import SmartImage from './SmartImage.vue';

const props = withDefaults(
  defineProps<{
    title: string;
    cover?: string | null;
    headers?: Record<string, string>;
    base?: string;
    subtitle?: string;
    badge?: string;
    progress?: number;
    removable?: boolean;
    shape?: 'portrait' | 'landscape' | 'square';
    eager?: boolean;
  }>(),
  {
    cover: '',
    headers: undefined,
    base: undefined,
    subtitle: '',
    badge: '',
    progress: undefined,
    removable: false,
    shape: 'portrait',
    eager: false,
  },
);

const emit = defineEmits<{
  select: [];
  remove: [];
  menu: [event: MouseEvent];
}>();

const { t } = useI18n();

const progressWidth = computed(() => {
  if (props.progress === undefined || props.progress === null) return '';
  return `${Math.max(0, Math.min(1, props.progress)) * 100}%`;
});

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    emit('select');
  }
}
</script>

<template>
  <article
    class="media-card"
    :class="[`shape-${shape}`, { removable }]"
    tabindex="0"
    role="button"
    @click="emit('select')"
    @keydown="onKeydown"
    @contextmenu.prevent="emit('menu', $event)"
  >
    <div class="media-cover">
      <SmartImage
        :src="cover"
        :headers="headers"
        :base="base"
        :alt="title"
        :eager="eager"
      />
      <div class="cover-shade" />
      <span v-if="badge" class="media-badge">{{ badge }}</span>
      <button
        v-if="removable"
        class="media-remove"
        type="button"
        :title="t('common.remove')"
        @click.stop="emit('remove')"
      >
        <X :size="13" />
      </button>
      <slot name="overlay" />
      <div v-if="progressWidth" class="media-progress">
        <span :style="{ width: progressWidth }" />
      </div>
    </div>
    <div class="media-meta">
      <div class="media-title" :title="title">{{ title }}</div>
      <div v-if="subtitle" class="media-subtitle" :title="subtitle">{{ subtitle }}</div>
      <slot name="meta" />
    </div>
  </article>
</template>

<style scoped>
.media-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  cursor: pointer;
  outline: none;
  border-radius: var(--radius);
}

.media-cover {
  position: relative;
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface-2);
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.2s ease;
}

.shape-portrait .media-cover {
  aspect-ratio: 2 / 3;
}

.shape-landscape .media-cover {
  aspect-ratio: 16 / 9;
}

.shape-square .media-cover {
  aspect-ratio: 1;
}

.media-card:hover .media-cover,
.media-card:focus-visible .media-cover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
}

.media-card:focus-visible .media-cover {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.cover-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.02) 55%, rgba(0, 0, 0, 0.3));
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
}

.media-card:hover .cover-shade {
  opacity: 1;
}

.media-badge {
  position: absolute;
  left: 8px;
  top: 8px;
  padding: 2px 7px;
  border-radius: 99px;
  background: rgba(12, 14, 20, 0.72);
  color: #fff;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.02em;
  backdrop-filter: blur(6px);
  max-width: calc(100% - 44px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.media-remove {
  position: absolute;
  right: 7px;
  top: 7px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: rgba(12, 14, 20, 0.72);
  color: #fff;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
  backdrop-filter: blur(6px);
}

.media-card:hover .media-remove,
.media-remove:focus-visible {
  opacity: 1;
}

.media-remove:hover {
  background: var(--danger);
}

.media-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: rgba(0, 0, 0, 0.35);
}

.media-progress span {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 0 2px 2px 0;
}

.media-meta {
  min-width: 0;
  padding: 0 2px;
}

.media-title {
  font-size: 13px;
  font-weight: 550;
  line-height: 1.4;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.media-subtitle {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
