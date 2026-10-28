<script setup lang="ts">
withDefaults(
  defineProps<{
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const model = defineModel<boolean>({ default: false });

function toggle(): void {
  if (model.value === undefined) return;
  model.value = !model.value;
}
</script>

<template>
  <button
    type="button"
    class="switch"
    :class="{ on: model, disabled }"
    role="switch"
    :aria-checked="Boolean(model)"
    :disabled="disabled"
    @click="toggle"
  >
    <span class="switch-thumb" />
  </button>
</template>

<style scoped>
.switch {
  position: relative;
  width: 38px;
  height: 21px;
  flex: 0 0 auto;
  border: none;
  border-radius: 99px;
  background: var(--surface-3);
  padding: 0;
  transition: background 0.18s ease;
}

.switch.on {
  background: var(--accent);
}

.switch.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.switch-thumb {
  position: absolute;
  top: 2.5px;
  left: 2.5px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}

.switch.on .switch-thumb {
  transform: translateX(17px);
}
</style>
