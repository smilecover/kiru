<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppModal from './AppModal.vue';
import { useUiStore } from '../stores/ui';

const ui = useUiStore();
const { t } = useI18n();
const state = computed(() => ui.confirmState);
</script>

<template>
  <AppModal
    :open="Boolean(state)"
    :title="state?.title || t('common.confirm')"
    :show-close="false"
    width="420px"
    @close="ui.resolveConfirm(false)"
  >
    <p class="confirm-message">{{ state?.message }}</p>
    <template #footer>
      <button class="btn" type="button" @click="ui.resolveConfirm(false)">
        {{ state?.cancelText || t('common.cancel') }}
      </button>
      <button
        class="btn"
        :class="state?.destructive ? 'btn-danger-filled' : 'btn-primary'"
        type="button"
        @click="ui.resolveConfirm(true)"
      >
        {{ state?.confirmText || t('common.confirm') }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.confirm-message {
  color: var(--text-secondary);
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
