<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ExternalLink } from 'lucide-vue-next';
import { openUrl } from '@tauri-apps/plugin-opener';
import AppModal from './AppModal.vue';
import SmartImage from './SmartImage.vue';
import {
  getAnilistMedia,
  saveAnilistEntry,
  type SaveMediaListInput,
} from '../lib/anilist';
import {
  anilistStatuses,
  anilistStatusLabel,
  anilistTypeLabel,
} from '../lib/labels';
import { errorMessage } from '../lib/tauri';
import { pickTitle } from '../lib/util';
import type {
  AnilistListStatus,
  AnilistMedia,
  AnilistType,
} from '../types/models';

const props = defineProps<{
  open: boolean;
  mediaId: string;
  type: AnilistType;
}>();

const emit = defineEmits<{
  close: [];
  saved: [media: AnilistMedia];
  unbind: [];
}>();

const { t } = useI18n();
const media = ref<AnilistMedia | null>(null);
const entryId = ref<number | null>(null);
const status = ref<AnilistListStatus>('CURRENT');
const progress = ref(0);
const score = ref(0);
const startDate = ref('');
const endDate = ref('');
const isPrivate = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref('');

const maxProgress = computed(() => {
  const value = props.type === 'anime' ? media.value?.episodes : media.value?.chapters;
  return value && value > 0 ? value : 0;
});

const progressLabel = computed(() =>
  props.type === 'anime' ? t('anilist.episodes') : t('anilist.chapters'),
);

function pad(value: number | null | undefined): string {
  return String(value ?? 1).padStart(2, '0');
}

function fuzzyToInput(value?: { year?: number | null; month?: number | null; day?: number | null } | null): string {
  if (!value?.year) return '';
  return `${value.year}-${pad(value.month)}-${pad(value.day)}`;
}

function inputToFuzzy(value: string): { year: number; month: number; day: number } | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  return { year, month, day };
}

async function load(): Promise<void> {
  if (!props.mediaId) return;
  loading.value = true;
  error.value = '';
  media.value = null;
  try {
    const data = await getAnilistMedia(props.mediaId);
    media.value = data;
    const entry = data.mediaListEntry;
    entryId.value = entry?.id ?? null;
    status.value = (entry?.status as AnilistListStatus) ?? 'CURRENT';
    progress.value = entry?.progress ?? 0;
    score.value = entry?.score ?? 0;
    startDate.value = fuzzyToInput(entry?.startedAt);
    endDate.value = fuzzyToInput(entry?.completedAt);
    isPrivate.value = Boolean(entry?.private);
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  if (!media.value || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    const payload: SaveMediaListInput = {
      status: status.value,
      mediaId: media.value.id,
      progress: Math.max(0, Math.round(Number(progress.value) || 0)),
      score: Math.max(0, Number(score.value) || 0),
      isPrivate: isPrivate.value,
    };
    if (entryId.value) payload.id = entryId.value;
    const started = inputToFuzzy(startDate.value);
    const completed = inputToFuzzy(endDate.value);
    if (started) payload.startDate = started;
    if (completed) payload.endDate = completed;
    await saveAnilistEntry(payload);
    emit('saved', media.value);
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    saving.value = false;
  }
}

function openOnAnilist(): void {
  if (!media.value) return;
  const kind = props.type === 'anime' ? 'anime' : 'manga';
  void openUrl(`https://anilist.co/${kind}/${media.value.id}`).catch(() => undefined);
}

watch(
  () => [props.open, props.mediaId] as const,
  ([open]) => {
    if (!open) return;
    entryId.value = null;
    status.value = 'CURRENT';
    progress.value = 0;
    score.value = 0;
    startDate.value = '';
    endDate.value = '';
    isPrivate.value = false;
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <AppModal :open="open" :title="t('anilist.title')" width="560px" @close="emit('close')">
    <div class="track-dialog">
      <div v-if="loading" class="loading-center">
        <div class="spinner" />
      </div>
      <template v-else-if="media">
        <div class="track-header">
          <div class="poster">
            <SmartImage
              :src="media.coverImage?.large"
              :proxy="false"
              :alt="pickTitle(media.title)"
            />
          </div>
          <div class="track-heading">
            <h3>{{ pickTitle(media.title) }}</h3>
            <div class="row">
              <span class="chip chip-accent">{{ anilistTypeLabel(type) }}</span>
              <span v-if="media.status" class="muted small">{{ media.status }}</span>
            </div>
            <button class="btn btn-ghost btn-sm anilist-link" @click="openOnAnilist">
              <ExternalLink :size="13" />
              AniList
            </button>
          </div>
        </div>

        <p v-if="error" class="error-banner">{{ error }}</p>

        <div class="field-grid">
          <label class="field">
            <span>{{ t('anilist.status') }}</span>
            <select v-model="status" class="select">
              <option v-for="item in anilistStatuses" :key="item" :value="item">
                {{ anilistStatusLabel(item, type) }}
              </option>
            </select>
          </label>

          <label class="field">
            <span>{{ progressLabel }}</span>
            <input
              v-model.number="progress"
              class="input"
              type="number"
              min="0"
              :max="maxProgress || undefined"
              step="1"
            />
          </label>

          <label class="field">
            <span>{{ t('anilist.score') }}</span>
            <input
              v-model.number="score"
              class="input"
              type="number"
              min="0"
              max="100"
              step="0.1"
            />
          </label>

          <label class="field checkbox-field">
            <span>{{ t('anilist.private') }}</span>
            <input v-model="isPrivate" type="checkbox" />
          </label>

          <label class="field">
            <span>{{ t('anilist.start-date') }}</span>
            <input v-model="startDate" class="input" type="date" />
          </label>

          <label class="field">
            <span>{{ t('anilist.end-date') }}</span>
            <input v-model="endDate" class="input" type="date" />
          </label>
        </div>
      </template>
      <div v-else class="track-error">
        <p class="error-banner">{{ error || t('common.error') }}</p>
        <button class="btn" @click="load">{{ t('common.retry') }}</button>
      </div>
    </div>
    <template #footer>
      <button class="btn btn-danger" type="button" :disabled="saving" @click="emit('unbind')">
        {{ t('anilist.unbind') }}
      </button>
      <div class="spacer" />
      <button class="btn" type="button" @click="emit('close')">
        {{ t('common.cancel') }}
      </button>
      <button
        class="btn btn-primary"
        type="button"
        :disabled="saving || loading || !media"
        @click="save"
      >
        {{ saving ? '…' : t('common.save') }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.track-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 180px;
}

.track-header {
  display: flex;
  gap: 14px;
}

.poster {
  flex: 0 0 78px;
  width: 78px;
  height: 112px;
  border-radius: 9px;
  overflow: hidden;
  background: var(--surface-2);
  box-shadow: var(--shadow-sm);
}

.track-heading {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  min-width: 0;
  padding-top: 3px;
}

.track-heading h3 {
  font-size: 16px;
  font-weight: 650;
  line-height: 1.35;
}

.anilist-link {
  height: 24px;
  padding: 0 6px;
  color: var(--muted);
  font-size: 11.5px;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 550;
}

.field .input,
.field .select {
  height: 34px;
}

.checkbox-field {
  align-items: flex-start;
  justify-content: flex-end;
}

.checkbox-field input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}

.track-error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

@media (max-width: 520px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
