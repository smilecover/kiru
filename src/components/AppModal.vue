<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { X } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    open?: boolean;
    title?: string;
    width?: string;
    closeOnOverlay?: boolean;
    showClose?: boolean;
    padded?: boolean;
  }>(),
  {
    open: false,
    title: '',
    width: '540px',
    closeOnOverlay: true,
    showClose: true,
    padded: true,
  },
);

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

function requestClose(): void {
  emit('close');
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) {
    event.stopPropagation();
    requestClose();
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onKeydown);
    } else {
      window.removeEventListener('keydown', onKeydown);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="modal-overlay"
        @mousedown.self="closeOnOverlay && requestClose()"
      >
        <div class="modal-panel" :style="{ width }" role="dialog" aria-modal="true">
          <header v-if="title || $slots.header || showClose" class="modal-header">
            <slot name="header">
              <h3 class="modal-title">{{ title }}</h3>
            </slot>
            <button
              v-if="showClose"
              class="modal-close"
              type="button"
              :aria-label="t('common.close')"
              @click="requestClose"
            >
              <X :size="17" />
            </button>
          </header>
          <div class="modal-body" :class="{ padded }">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: rgba(10, 12, 18, 0.52);
  backdrop-filter: blur(4px);
}

.modal-panel {
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px 12px;
  flex: 0 0 auto;
}

.modal-title {
  flex: 1;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.modal-close {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
}

.modal-close:hover {
  background: var(--surface-2);
  color: var(--text);
}

.modal-body {
  overflow: auto;
  min-height: 0;
}

.modal-body.padded {
  padding: 4px 18px 18px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  background: var(--bg-elevated);
  flex: 0 0 auto;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}

.modal-enter-active .modal-panel,
.modal-leave-active .modal-panel {
  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-panel,
.modal-leave-to .modal-panel {
  opacity: 0;
  transform: scale(0.97) translateY(8px);
}
</style>
