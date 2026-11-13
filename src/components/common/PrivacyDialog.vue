<script setup lang="ts">
/**
 * 隐私说明弹窗：把「隐私与承诺」从关于页里摊开来看的完整版。
 * 内容复用 PrivacyPledge，避免文案两处维护。
 */
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PrivacyPledge from '@/components/common/PrivacyPledge.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const { t } = useI18n()
const okBtn = ref<HTMLButtonElement | null>(null)

function close() {
  emit('update:modelValue', false)
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    await nextTick()
    okBtn.value?.focus()
  },
)

function onMaskKeydown(e: KeyboardEvent) {
  // 弹窗期间吞掉按键，别让应用快捷键抢走 Esc / 回车
  e.stopPropagation()
  if (e.key === 'Escape' || e.key === 'Enter') {
    e.preventDefault()
    close()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="privacy-fade">
      <div v-if="modelValue" class="privacy-mask" @mousedown.self="close" @keydown="onMaskKeydown">
        <div class="privacy-box" role="dialog" aria-modal="true">
          <header class="privacy-box-head">
            <i class="i-mdi-shield-check-outline"></i>
            <h2>{{ t('settings.privacyDialogTitle') }}</h2>
            <button class="privacy-close" type="button" :title="t('settings.privacyClose')" @mousedown.stop @click="close">
              <i class="i-mdi-close"></i>
            </button>
          </header>

          <div class="privacy-box-body">
            <PrivacyPledge loose />
          </div>

          <footer class="privacy-box-foot">
            <button ref="okBtn" class="privacy-ok" type="button" @mousedown.stop @click="close">
              {{ t('settings.privacyClose') }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.privacy-mask {
  position: fixed;
  inset: 0;
  z-index: 620;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.26);
  backdrop-filter: blur(2px);
}

.privacy-box {
  display: flex;
  flex-direction: column;
  width: 480px;
  max-width: 100%;
  max-height: 78vh;
  border-radius: 14px;
  background: var(--color-popup-bg, var(--color-surface));
  border: 1px solid var(--color-border);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.26);
  overflow: hidden;
}

.privacy-box-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--color-border);
}

.privacy-box-head > i {
  font-size: 16px;
  color: var(--color-primary, #007aff);
}

.privacy-box-head h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.privacy-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: auto;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary, var(--color-text));
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.privacy-close:hover {
  background: var(--color-popup-hover, rgba(0, 0, 0, 0.06));
  color: var(--color-text);
}

.privacy-close i {
  font-size: 14px;
}

.privacy-box-body {
  padding: 14px 16px 4px;
  overflow-y: auto;
}

.privacy-box-foot {
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px 14px;
}

.privacy-ok {
  padding: 6px 16px;
  border: none;
  border-radius: 8px;
  background: var(--color-primary, #007aff);
  color: #fff;
  font-size: 12.5px;
  cursor: pointer;
  transition: filter 0.15s ease;
}

.privacy-ok:hover {
  filter: brightness(1.06);
}

.privacy-fade-enter-active,
.privacy-fade-leave-active {
  transition: opacity 0.16s ease;
}

.privacy-fade-enter-from,
.privacy-fade-leave-to {
  opacity: 0;
}
</style>
