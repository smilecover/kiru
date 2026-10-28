<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ImageOff } from 'lucide-vue-next';
import { mediaUrl } from '../lib/media';
import { fileUrl, resolveUrl } from '../lib/util';

const props = withDefaults(
  defineProps<{
    src?: string | null;
    alt?: string;
    headers?: Record<string, string>;
    base?: string;
    proxy?: boolean;
    eager?: boolean;
    fit?: 'cover' | 'contain';
  }>(),
  {
    src: '',
    alt: '',
    headers: undefined,
    base: undefined,
    proxy: true,
    eager: false,
    fit: 'cover',
  },
);

const loaded = ref(false);
const failed = ref(false);

const resolved = computed(() => {
  let value = String(props.src ?? '').trim();
  if (!value) return '';
  if (value.startsWith('//')) value = `https:${value}`;
  if (/^[A-Za-z]:[\\/]/.test(value)) value = fileUrl(value);
  return resolveUrl(value, props.base);
});

const source = computed(() => {
  if (!resolved.value) return '';
  if (!props.proxy) return resolved.value;
  return mediaUrl(resolved.value, props.headers);
});

const hasImage = computed(() => Boolean(resolved.value));

watch(
  source,
  () => {
    loaded.value = false;
    failed.value = false;
  },
  { immediate: true },
);

function onLoad(): void {
  loaded.value = true;
  failed.value = false;
}

function onError(): void {
  failed.value = true;
  loaded.value = false;
}
</script>

<template>
  <div class="smart-image" :class="[`fit-${fit}`, { ready: loaded && !failed }]">
    <img
      v-if="hasImage && !failed"
      :src="source"
      :alt="alt"
      :loading="eager ? 'eager' : 'lazy'"
      decoding="async"
      draggable="false"
      @load="onLoad"
      @error="onError"
    />
    <div v-if="!loaded && !failed && hasImage" class="image-placeholder skeleton" />
    <div v-if="failed || !hasImage" class="image-fallback">
      <ImageOff :size="22" />
    </div>
  </div>
</template>

<style scoped>
.smart-image {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--surface-2);
}

.smart-image img {
  width: 100%;
  height: 100%;
  display: block;
  opacity: 0;
  transition: opacity 0.22s ease;
}

.smart-image.fit-cover img {
  object-fit: cover;
}

.smart-image.fit-contain img {
  object-fit: contain;
}

.smart-image.ready img {
  opacity: 1;
}

.image-placeholder {
  position: absolute;
  inset: 0;
}

.image-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--muted);
  background: var(--surface-2);
}
</style>
