import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { errorMessage } from '../lib/tauri';

export type ToastType = 'info' | 'success' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  actionLabel?: string;
  onAction?: () => void;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  id: number;
  resolve: (value: boolean) => void;
}

let toastSeq = 1;

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<ToastItem[]>([]);
  const confirmState = ref<ConfirmState | null>(null);
  const sidebarCollapsed = ref(localStorage.getItem('kiru.sidebar') === 'collapsed');
  const globalLoading = ref(false);

  function dismissToast(id: number): void {
    const index = toasts.value.findIndex((toast) => toast.id === id);
    if (index >= 0) toasts.value.splice(index, 1);
  }

  function notify(
    message: string,
    type: ToastType = 'info',
    duration = 3200,
    actionLabel?: string,
    onAction?: () => void,
  ): number {
    const id = toastSeq++;
    toasts.value.push({ id, message, type, actionLabel, onAction });
    if (duration > 0) {
      setTimeout(() => dismissToast(id), duration);
    }
    return id;
  }

  function notifyError(error: unknown, duration = 5000): number {
    return notify(errorMessage(error), 'error', duration);
  }

  function confirm(options: ConfirmOptions): Promise<boolean> {
    if (confirmState.value) {
      confirmState.value.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      confirmState.value = {
        id: toastSeq++,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        destructive: options.destructive,
        title: options.title,
        message: options.message,
        resolve,
      };
    });
  }

  function resolveConfirm(value: boolean): void {
    const state = confirmState.value;
    if (!state) return;
    confirmState.value = null;
    state.resolve(value);
  }

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value;
    localStorage.setItem('kiru.sidebar', sidebarCollapsed.value ? 'collapsed' : 'expanded');
  }

  const hasToasts = computed(() => toasts.value.length > 0);

  return {
    toasts,
    hasToasts,
    confirmState,
    sidebarCollapsed,
    globalLoading,
    notify,
    notifyError,
    dismissToast,
    confirm,
    resolveConfirm,
    toggleSidebar,
  };
});
