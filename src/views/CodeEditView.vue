<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
} from 'vue';
import { onBeforeRouteLeave, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  LoaderCircle,
  RefreshCw,
  Save,
} from 'lucide-vue-next';
import EmptyState from '../components/EmptyState.vue';
import {
  parseExtensionMeta,
  transformExtensionSource,
} from '../lib/extension-parser';
import { errorMessage } from '../lib/tauri';
import { useExtensionsStore } from '../stores/extensions';
import { useUiStore } from '../stores/ui';

const props = defineProps<{ package: string }>();

const router = useRouter();
const { t } = useI18n();
const extensions = useExtensionsStore();
const ui = useUiStore();

const source = ref('');
const savedSource = ref('');
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const saveError = ref('');
const metaName = ref(props.package);
const editor = ref<HTMLTextAreaElement | null>(null);
const gutter = ref<HTMLElement | null>(null);

const dirty = computed(() => source.value !== savedSource.value);
const lineCount = computed(() => source.value.split('\n').length);
const characterCount = computed(() => source.value.length);
const gutterWidth = computed(
  () => `calc(${String(lineCount.value).length}ch + 22px)`,
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  saveError.value = '';
  try {
    if (!extensions.loaded) await extensions.loadExtensions();
    const meta = extensions.getMeta(props.package);
    if (!meta) {
      throw new Error(t('common.extension-missing', { package: props.package }));
    }
    metaName.value = meta.name;
    const text = await extensions.readSource(props.package);
    source.value = text;
    savedSource.value = text;
    await nextTick();
    syncScroll();
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  if (saving.value || loading.value) return;
  if (!dirty.value) return;
  saving.value = true;
  saveError.value = '';
  try {
    const parsed = parseExtensionMeta(source.value);
    if (parsed.package !== props.package) {
      throw new Error(
        t('code-editor.package-changed', {
          expected: props.package,
          actual: parsed.package,
        }),
      );
    }
    transformExtensionSource(source.value, props.package);
    await extensions.saveSource(props.package, source.value);
    savedSource.value = source.value;
    ui.notify(t('code-editor.saved'), 'success');
  } catch (caught) {
    saveError.value = errorMessage(caught);
  } finally {
    saving.value = false;
  }
}

async function reset(): Promise<void> {
  if (saving.value || !dirty.value) return;
  const confirmed = await ui.confirm({
    title: t('code-editor.reset'),
    message: t('code-editor.reset-confirm'),
    confirmText: t('code-editor.reset'),
    destructive: true,
  });
  if (!confirmed) return;
  source.value = savedSource.value;
  saveError.value = '';
  await nextTick();
  syncScroll();
}

function syncScroll(): void {
  if (editor.value && gutter.value) {
    gutter.value.scrollTop = editor.value.scrollTop;
  }
}

async function onTab(event: KeyboardEvent): Promise<void> {
  const target = event.target as HTMLTextAreaElement;
  if (event.key !== 'Tab' || event.shiftKey) return;
  event.preventDefault();
  const start = target.selectionStart;
  const end = target.selectionEnd;
  const value = target.value;
  source.value = `${value.slice(0, start)}  ${value.slice(end)}`;
  await nextTick();
  target.selectionStart = start + 2;
  target.selectionEnd = start + 2;
}

function onEditorKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void save();
    return;
  }
  void onTab(event);
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}

onBeforeRouteLeave(async () => {
  if (!dirty.value) return true;
  return await ui.confirm({
    title: t('code-editor.unsaved-title'),
    message: t('code-editor.unsaved'),
    confirmText: t('code-editor.discard'),
    destructive: true,
  });
});

onMounted(() => {
  void load();
  window.addEventListener('beforeunload', onBeforeUnload);
});

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload);
});
</script>

<template>
  <div class="editor-page">
    <header class="editor-header">
      <button class="btn btn-icon" :title="t('common.previous')" @click="router.back()">
        <ArrowLeft :size="16" />
      </button>
      <div class="editor-heading">
        <div class="editor-title">
          {{ metaName }}
          <span v-if="dirty" class="dirty-dot" :title="t('code-editor.unsaved-title')" />
        </div>
        <span class="editor-package">{{ props.package }}.js</span>
      </div>
      <div class="spacer" />
      <span v-if="!loading && !error" class="editor-status">
        <Check v-if="!dirty" :size="13" />
        {{ dirty ? t('code-editor.unsaved-short') : t('code-editor.saved-short') }}
      </span>
      <button
        class="btn btn-icon"
        :title="t('code-editor.reload')"
        :disabled="loading || saving"
        @click="load"
      >
        <RefreshCw :size="16" :class="{ spin: loading }" />
      </button>
      <button
        class="btn"
        :disabled="!dirty || saving || loading"
        @click="reset"
      >
        {{ t('code-editor.reset') }}
      </button>
      <button
        class="btn btn-primary"
        :disabled="!dirty || saving || loading || Boolean(error)"
        @click="save"
      >
        <LoaderCircle v-if="saving" :size="15" class="spin" />
        <Save v-else :size="15" />
        {{ t('common.save') }}
      </button>
    </header>

    <div v-if="saveError" class="error-banner editor-error">
      <AlertCircle :size="16" />
      <span>{{ saveError }}</span>
    </div>

    <div v-if="loading" class="editor-state">
      <div class="spinner lg" />
    </div>

    <EmptyState
      v-else-if="error"
      :icon="AlertCircle"
      :title="t('common.error')"
      :description="error"
    >
      <div class="row">
        <RouterLink to="/extensions" class="btn">{{ t('common.extension') }}</RouterLink>
        <button class="btn btn-primary" @click="load">{{ t('common.retry') }}</button>
      </div>
    </EmptyState>

    <div v-else class="editor-shell">
      <div
        ref="gutter"
        class="line-numbers"
        :style="{ width: gutterWidth }"
        aria-hidden="true"
      >
        <span v-for="line in lineCount" :key="line">{{ line }}</span>
      </div>
      <textarea
        ref="editor"
        v-model="source"
        class="code-area"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        wrap="off"
        @scroll.passive="syncScroll"
        @keydown="onEditorKeydown"
      />
    </div>

    <footer v-if="!loading && !error" class="editor-footer">
      <span>{{ t('code-editor.line-count', { count: lineCount }) }}</span>
      <span>·</span>
      <span>{{ t('code-editor.char-count', { count: characterCount }) }}</span>
      <div class="spacer" />
      <span class="muted">{{ t('code-editor.shortcut') }}</span>
    </footer>
  </div>
</template>

<style scoped>
.editor-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}

.editor-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}

.editor-heading {
  min-width: 0;
}

.editor-title {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 650;
}

.dirty-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--warning);
}

.editor-package {
  display: block;
  margin-top: 1px;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.editor-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-right: 3px;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}

.editor-error {
  align-items: center;
  margin: 10px 18px 0;
  flex: 0 0 auto;
  white-space: pre-wrap;
}

.editor-error span {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 11px;
}

.editor-state {
  display: grid;
  place-items: center;
  flex: 1;
}

.editor-shell {
  display: flex;
  flex: 1;
  min-height: 0;
  margin: 14px 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.line-numbers {
  flex: 0 0 auto;
  height: 100%;
  overflow: hidden;
  padding: 12px 8px 12px 0;
  border-right: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 21px;
  text-align: right;
  user-select: none;
}

.line-numbers span {
  display: block;
  height: 21px;
}

.code-area {
  flex: 1;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 12px 15px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 21px;
  tab-size: 2;
  white-space: pre;
  overflow: auto;
}

.editor-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 0 20px 12px;
  color: var(--muted);
  font-size: 10.5px;
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .editor-status {
    display: none;
  }

  .editor-shell {
    margin: 10px;
  }
}
</style>
