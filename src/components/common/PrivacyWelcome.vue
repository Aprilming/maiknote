<script setup lang="ts">
/**
 * 首次启动的隐私欢迎页：第一次打开应用时把承诺摊在面前，点「我知道了」才进主界面。
 * 只出现一次（settingStore.settings.privacyAcknowledged）；设置 → 关于 里可随时重新查看。
 */
import { nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PrivacyPledge from '@/components/common/PrivacyPledge.vue'

const emit = defineEmits<{ (e: 'acknowledge'): void }>()

const { t } = useI18n()
const okBtn = ref<HTMLButtonElement | null>(null)

onMounted(async () => {
  await nextTick()
  okBtn.value?.focus()
})

function confirm() {
  emit('acknowledge')
}

function onKeydown(e: KeyboardEvent) {
  // 占位遮罩期间不让快捷键穿透
  e.stopPropagation()
  if (e.key === 'Enter' || e.key === 'Escape') {
    e.preventDefault()
    confirm()
  }
}
</script>

<template>
  <div class="welcome-mask" @keydown="onKeydown">
    <div class="welcome-box" role="dialog" aria-modal="true">
      <div class="welcome-head">
        <div class="welcome-badge">
          <i class="i-mdi-shield-check-outline"></i>
        </div>
        <div class="welcome-titles">
          <h1>{{ t('welcome.title') }}</h1>
          <p>{{ t('welcome.hint') }}</p>
        </div>
      </div>

      <div class="welcome-body">
        <PrivacyPledge loose />
      </div>

      <div class="welcome-foot">
        <p class="welcome-tip">{{ t('welcome.tip') }}</p>
        <button ref="okBtn" class="welcome-ok" type="button" @click="confirm">
          {{ t('welcome.ok') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome-mask {
  position: fixed;
  inset: 0;
  z-index: 640;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
  background: rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(6px);
  animation: welcome-in 0.2s ease;
}

.welcome-box {
  display: flex;
  flex-direction: column;
  width: 540px;
  max-width: 100%;
  max-height: 86vh;
  padding: 20px 22px 16px;
  border-radius: 16px;
  background: var(--color-popup-bg, var(--color-surface));
  border: 1px solid var(--color-border);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.welcome-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-shrink: 0;
}

.welcome-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: rgba(0, 122, 255, 0.12);
  color: var(--color-primary, #007aff);
  flex-shrink: 0;
}

.welcome-badge i {
  font-size: 19px;
}

.welcome-titles h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}

.welcome-titles p {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--color-text-secondary, var(--color-text));
}

.welcome-body {
  margin-top: 14px;
  padding-top: 13px;
  border-top: 1px solid var(--color-border);
  overflow-y: auto;
}

.welcome-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.welcome-tip {
  flex: 1;
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--color-text-secondary, var(--color-text));
}

.welcome-ok {
  flex-shrink: 0;
  padding: 7px 18px;
  border: none;
  border-radius: 9px;
  background: var(--color-primary, #007aff);
  color: #fff;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: filter 0.15s ease;
}

.welcome-ok:hover {
  filter: brightness(1.06);
}

@keyframes welcome-in {
  from {
    opacity: 0;
    transform: scale(0.99);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
