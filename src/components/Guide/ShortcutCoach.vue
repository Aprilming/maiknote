<script setup lang="ts">
/**
 * 首次引导的最后一环：把「⌥⌘A 唤出 / 收起」从说明变成肌肉记忆。
 *
 * 不做模态——卡片挂在底部，用户必须真的按一次（窗口收起）再按一次（窗口回来），
 * 才写 shortcutTutorialSeen 并退场。App.vue 通过 marknote:main-toggled 事件和
 * 窗口焦点变化推进 phase。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

/** start = 还没按过；hidden = 已经按着收起过一次，等用户再按回来 */
const props = defineProps<{ phase: 'start' | 'hidden' }>()

const emit = defineEmits<{ (e: 'skip'): void }>()

const { t } = useI18n()

// 按了没反应通常是快捷键被别的应用抢了，给一条出路，但先让用户认真试十秒
const showTrouble = ref(false)
let troubleTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  troubleTimer = setTimeout(() => {
    showTrouble.value = true
  }, 12000)
})

onBeforeUnmount(() => {
  if (troubleTimer) clearTimeout(troubleTimer)
  troubleTimer = null
})
</script>

<template>
  <div class="coach" role="dialog" aria-live="polite">
    <div class="coach-head">
      <div class="coach-badge">
        <i class="i-mdi-keyboard-outline"></i>
      </div>
      <div class="coach-titles">
        <p class="coach-title">{{ t('coach.title') }}</p>
        <p class="coach-sub">{{ t('coach.sub') }}</p>
      </div>
      <div class="coach-keys" aria-hidden="true">
        <kbd>⌥</kbd><kbd>⌘</kbd><kbd>A</kbd>
      </div>
    </div>

    <ol class="coach-steps">
      <li :class="{ 'is-done': props.phase !== 'start', 'is-active': props.phase === 'start' }">
        <i :class="props.phase === 'start' ? 'i-mdi-circle-outline' : 'i-mdi-check-circle'"></i>
        <span>{{ t('coach.step1') }}</span>
      </li>
      <li :class="{ 'is-active': props.phase === 'hidden' }">
        <i class="i-mdi-circle-outline"></i>
        <span>{{ t('coach.step2') }}</span>
      </li>
    </ol>

    <p v-if="showTrouble" class="coach-trouble">
      {{ t('coach.trouble') }}
      <button type="button" class="coach-skip" @click="emit('skip')">{{ t('coach.skip') }}</button>
    </p>
  </div>
</template>

<style scoped>
.coach {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  z-index: 640;
  width: 400px;
  max-width: calc(100vw - 32px);
  padding: 13px 15px 12px;
  border-radius: 14px;
  background: var(--color-popup-bg, var(--color-surface));
  border: 1px solid var(--color-border);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.24);
  animation: coach-in 0.22s ease;
}

.coach-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.coach-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: rgba(0, 122, 255, 0.12);
  color: var(--color-primary, #007aff);
  flex-shrink: 0;
}

.coach-badge i {
  font-size: 17px;
}

.coach-titles {
  flex: 1;
  min-width: 0;
}

.coach-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.coach-sub {
  margin: 3px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--color-text-secondary, var(--color-text));
}

.coach-keys {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.coach-keys kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 5px;
  border: 1px solid var(--color-border);
  background: rgba(127, 127, 127, 0.1);
  color: var(--color-text);
  font-family: var(--font-mono, 'SF Mono', ui-monospace, Menlo, monospace);
  font-size: 11.5px;
}

.coach-steps {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.coach-steps li {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--color-text-secondary, var(--color-text));
  transition: color 0.15s ease;
}

.coach-steps li i {
  font-size: 14px;
  flex-shrink: 0;
}

.coach-steps li.is-active {
  color: var(--color-text);
  font-weight: 500;
}

.coach-steps li.is-active i {
  color: var(--color-primary, #007aff);
}

.coach-steps li.is-done i {
  color: var(--color-primary, #007aff);
}

.coach-trouble {
  margin: 10px 0 0;
  padding-top: 9px;
  border-top: 1px solid var(--color-border);
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-secondary, var(--color-text));
}

.coach-skip {
  margin-left: 4px;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-primary, #007aff);
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
}

@keyframes coach-in {
  from {
    opacity: 0;
    transform: translate(-50%, 8px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
</style>
