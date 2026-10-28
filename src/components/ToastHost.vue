<script setup lang="ts">
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useUiStore } from '../stores/ui';

const ui = useUiStore();
const { t } = useI18n();
</script>

<template>
  <Teleport to="body">
    <div class="toast-stack">
      <TransitionGroup name="toast">
        <div
          v-for="toast in ui.toasts"
          :key="toast.id"
          class="toast"
          :class="toast.type"
        >
          <component
            :is="toast.type === 'error' ? AlertCircle : toast.type === 'success' ? CheckCircle2 : Info"
            :size="17"
            class="toast-icon"
          />
          <div class="toast-message">{{ toast.message }}</div>
          <button
            v-if="toast.actionLabel"
            class="toast-action"
            type="button"
            @click="toast.onAction?.(); ui.dismissToast(toast.id)"
          >
            {{ toast.actionLabel }}
          </button>
          <button
            class="toast-close"
            type="button"
            :aria-label="t('common.dismiss')"
            @click="ui.dismissToast(toast.id)"
          >
            <X :size="13" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(380px, calc(100vw - 40px));
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
  pointer-events: auto;
}

.toast-icon {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--muted);
}

.toast.error .toast-icon {
  color: var(--danger);
}

.toast.success .toast-icon {
  color: var(--success);
}

.toast-message {
  flex: 1;
  word-break: break-word;
  white-space: pre-wrap;
}

.toast-action {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 12.5px;
  font-weight: 650;
  padding: 0 2px;
}

.toast-close {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-top: -1px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
}

.toast-close:hover {
  background: var(--surface-2);
  color: var(--text);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
</style>
