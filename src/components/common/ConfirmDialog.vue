<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveConfirm, useConfirmState } from '@/composables/useConfirm'

const { t } = useI18n()
const state = useConfirmState()
const confirmBtn = ref<HTMLButtonElement | null>(null)

watch(
  () => state.open,
  async (open) => {
    if (!open) return
    await nextTick()
    confirmBtn.value?.focus()
  }
)

function onMaskKeydown(e: KeyboardEvent) {
  // 弹窗期间吞掉按键，避免触发应用快捷键
  e.stopPropagation()
  if (e.key === 'Escape') {
    e.preventDefault()
    resolveConfirm(false)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    resolveConfirm(true)
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div
        v-if="state.open"
        class="confirm-mask"
        @mousedown.self="resolveConfirm(false)"
        @keydown="onMaskKeydown"
      >
        <div class="confirm-box" role="dialog">
          <div v-if="state.title" class="confirm-title">{{ state.title }}</div>
          <div class="confirm-message">{{ state.message }}</div>
          <div class="confirm-actions">
            <button class="confirm-btn" @mousedown.stop @click="resolveConfirm(false)">
              {{ state.cancelText || t('common.cancel') }}
            </button>
            <button
              ref="confirmBtn"
              class="confirm-btn primary"
              :class="{ danger: state.danger }"
              @mousedown.stop
              @click="resolveConfirm(true)"
            >
              {{ state.confirmText || t('common.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.26);
  backdrop-filter: blur(2px);
}

.confirm-box {
  width: 300px;
  max-width: 100%;
  padding: 16px 18px 14px;
  border-radius: 14px;
  background: var(--color-popup-bg, var(--color-surface));
  border: 1px solid var(--color-border);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.26);
  user-select: none;
}

.confirm-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 8px;
}

.confirm-message {
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--color-text-secondary, var(--color-text));
  white-space: pre-wrap;
  word-break: break-word;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.confirm-btn {
  min-width: 64px;
  height: 28px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}

.confirm-btn:hover {
  background: var(--color-hover, rgba(127, 127, 127, 0.12));
}

.confirm-btn.primary {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: #fff;
}

.confirm-btn.primary.danger {
  border-color: #e5484d;
  background: #e5484d;
}

.confirm-btn.primary:hover {
  opacity: 0.9;
}

.confirm-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 0.14s ease;
}

.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}
</style>
