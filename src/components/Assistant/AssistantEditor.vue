<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Assistant } from '@/stores/assistantsStore'

const { t } = useI18n()

const props = defineProps<{
  modelValue: boolean
  assistant?: Assistant
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'save', data: { name: string; prompt: string; searchEnabled: boolean }): void
}>()

// 表单数据
const name = ref('')
const prompt = ref('')
const searchEnabled = ref(false)

const nameInput = ref<HTMLInputElement | null>(null)

// 是否为编辑模式
const isEditMode = computed(() => !!props.assistant)

// 弹窗标题
const dialogTitle = computed(() => (isEditMode.value ? t('assistant.editTitle') : t('assistant.newTitle')))

// 保存按钮是否可用
const canSave = computed(() => !!name.value.trim())

// 提示词字数
const promptLength = computed(() => prompt.value.trim().length)

// 合并监听 modelValue 和 assistant 变化
watch(
  [() => props.modelValue, () => props.assistant],
  ([isVisible, assistant]) => {
    if (!isVisible) {
      name.value = ''
      prompt.value = ''
      searchEnabled.value = false
      return
    }
    name.value = assistant?.name ?? ''
    prompt.value = assistant?.prompt ?? ''
    searchEnabled.value = assistant?.searchEnabled ?? false
    nextTick(() => nameInput.value?.focus())
  },
  { immediate: true }
)

// 关闭弹窗
function closeDialog() {
  emit('update:modelValue', false)
}

// 保存
function handleSave() {
  if (!name.value.trim()) {
    return
  }
  emit('save', {
    name: name.value.trim(),
    prompt: prompt.value.trim(),
    searchEnabled: searchEnabled.value,
  })
  closeDialog()
}

// 点击遮罩层关闭
function handleOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    closeDialog()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="modelValue" class="dialog-overlay" @click="handleOverlayClick">
        <div
          class="dialog-card"
          role="dialog"
          aria-modal="true"
          @keydown.esc="closeDialog"
        >
          <header class="dialog-head">
            <div class="head-emblem">
              <i class="i-mdi-face-agent"></i>
            </div>
            <div class="head-text">
              <h2 class="head-title">{{ dialogTitle }}</h2>
              <p class="head-sub">{{ $t('assistant.subtitle') }}</p>
            </div>
            <button class="head-close" type="button" @click="closeDialog">
              <i class="i-mdi-close"></i>
            </button>
          </header>

          <div class="dialog-body">
            <section class="field">
              <div class="field-head">
                <label class="field-label" for="assistant-name">{{ $t('assistant.name') }}</label>
              </div>
              <input
                id="assistant-name"
                ref="nameInput"
                v-model="name"
                type="text"
                class="field-input"
                :placeholder="$t('assistant.namePlaceholder')"
                @keydown.enter.prevent="handleSave"
              />
            </section>

            <section class="field">
              <div class="field-head">
                <label class="field-label" for="assistant-prompt">{{ $t('assistant.prompt') }}</label>
                <span class="field-meta">{{ $t('assistant.charCount', { n: promptLength }) }}</span>
              </div>
              <textarea
                id="assistant-prompt"
                v-model="prompt"
                class="field-textarea"
                :placeholder="$t('assistant.promptPlaceholder')"
                rows="7"
                spellcheck="false"
              ></textarea>
            </section>

            <button
              type="button"
              class="switch-row"
              :class="{ 'is-on': searchEnabled }"
              role="switch"
              :aria-checked="searchEnabled"
              @click="searchEnabled = !searchEnabled"
            >
              <span class="switch-icon">
                <i class="i-mdi-web"></i>
              </span>
              <span class="switch-text">
                <span class="switch-title">{{ $t('assistant.webSearch') }}</span>
                <span class="switch-desc">{{ $t('assistant.webSearchHint') }}</span>
              </span>
              <span class="switch" :class="{ 'is-on': searchEnabled }">
                <span class="switch-knob"></span>
              </span>
            </button>
          </div>

          <footer class="dialog-foot">
            <button type="button" class="btn-ghost" @click="closeDialog">{{ $t('assistant.cancel') }}</button>
            <button type="button" class="btn-primary" :disabled="!canSave" @click="handleSave">
              {{ $t('assistant.save') }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ============================================
   助手编辑弹窗
   口径与设置页一致：毛玻璃面板 + 发丝线 + 单一强调色，
   控件统一成"下沉槽位 / 选中胶囊"。
   ============================================ */

.dialog-overlay {
  /* ---- 弹窗级令牌（浅色） ---- */
  --dlg-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(249, 249, 251, 0.96));
  --dlg-text: #1d1d1f;
  --dlg-text-dim: rgba(60, 60, 67, 0.62);
  --dlg-text-soft: rgba(60, 60, 67, 0.42);
  --dlg-accent: #007aff;
  --dlg-accent-2: #0a84ff;
  --dlg-accent-soft: rgba(0, 122, 255, 0.12);
  --dlg-accent-line: rgba(0, 122, 255, 0.32);
  --dlg-line: rgba(0, 0, 0, 0.07);
  --dlg-sunken: rgba(120, 120, 128, 0.1);
  --dlg-hover: rgba(120, 120, 128, 0.16);
  --dlg-track: rgba(120, 120, 128, 0.26);
  --dlg-scrim: rgba(0, 0, 0, 0.24);

  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--dlg-scrim);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  backdrop-filter: blur(18px) saturate(140%);
}

:global(html[data-theme='dark'] .dialog-overlay) {
  --dlg-bg: linear-gradient(180deg, rgba(46, 46, 48, 0.97), rgba(36, 36, 38, 0.96));
  --dlg-text: #f2f2f7;
  --dlg-text-dim: rgba(235, 235, 245, 0.62);
  --dlg-text-soft: rgba(235, 235, 245, 0.42);
  --dlg-accent: #0a84ff;
  --dlg-accent-2: #409cff;
  --dlg-accent-soft: rgba(10, 132, 255, 0.2);
  --dlg-accent-line: rgba(10, 132, 255, 0.4);
  --dlg-line: rgba(255, 255, 255, 0.08);
  --dlg-sunken: rgba(120, 120, 128, 0.22);
  --dlg-hover: rgba(120, 120, 128, 0.3);
  --dlg-track: rgba(120, 120, 128, 0.4);
  --dlg-scrim: rgba(0, 0, 0, 0.5);
}

.dialog-card {
  display: flex;
  flex-direction: column;
  width: 508px;
  max-width: calc(100vw - 48px);
  max-height: min(86vh, 760px);
  border-radius: 20px;
  overflow: hidden;
  color: var(--dlg-text);
  background: var(--dlg-bg);
  border: 1px solid var(--dlg-line);
  box-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.06),
    0 28px 64px -16px rgba(0, 0, 0, 0.32),
    0 8px 20px -10px rgba(0, 0, 0, 0.18);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  backdrop-filter: blur(30px) saturate(180%);
}

/* ============ 头部 ============ */
.dialog-head {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 16px 18px 14px;
  flex-shrink: 0;
}

.head-emblem {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 11px;
  color: #fff;
  background: linear-gradient(158deg, #4fb0ff 0%, var(--dlg-accent) 78%);
  box-shadow:
    0 6px 12px -6px rgba(0, 122, 255, 0.65),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
}

.head-emblem i {
  font-size: 19px;
}

.head-text {
  flex: 1;
  min-width: 0;
}

.head-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--dlg-text);
}

.head-sub {
  margin: 2px 0 0;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--dlg-text-soft);
}

.head-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 27px;
  height: 27px;
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dlg-text-dim);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.head-close:hover {
  background: var(--dlg-hover);
  color: var(--dlg-text);
}

.head-close:active {
  transform: scale(0.9);
}

.head-close i {
  font-size: 16px;
}

/* ============ 主体 ============ */
.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding: 2px 18px 18px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.field-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 0 2px;
}

.field-label {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--dlg-text-dim);
}

.field-meta {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--dlg-text-soft);
}

.field-input,
.field-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 11px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--dlg-sunken);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: var(--dlg-text);
  outline: none;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.field-textarea {
  min-height: 158px;
  max-height: 44vh;
  resize: vertical;
}

.field-input::placeholder,
.field-textarea::placeholder {
  color: var(--dlg-text-soft);
}

.field-input:hover,
.field-textarea:hover {
  border-color: var(--dlg-line);
}

.field-input:focus,
.field-textarea:focus {
  background: transparent;
  border-color: var(--dlg-accent-line);
  box-shadow: 0 0 0 3px var(--dlg-accent-soft);
}

/* ============ 联网搜索开关行 ============ */
.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 11px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: var(--dlg-sunken);
  cursor: pointer;
  text-align: left;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.switch-row:hover {
  border-color: var(--dlg-line);
}

.switch-row.is-on {
  background: var(--dlg-accent-soft);
  border-color: var(--dlg-accent-line);
}

.switch-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 25px;
  flex-shrink: 0;
  border-radius: 8px;
  background: var(--dlg-hover);
  color: var(--dlg-text-dim);
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.switch-row.is-on .switch-icon {
  background: var(--dlg-accent);
  color: #fff;
}

.switch-icon i {
  font-size: 14px;
}

.switch-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.switch-title {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--dlg-text);
}

.switch-desc {
  font-size: 11px;
  line-height: 1.45;
  color: var(--dlg-text-soft);
}

.switch {
  position: relative;
  width: 38px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--dlg-track);
  transition: background var(--duration-normal) var(--ease-out);
}

.switch.is-on {
  background: linear-gradient(180deg, var(--dlg-accent-2), var(--dlg-accent));
}

.switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform var(--duration-normal) var(--ease-out);
}

.switch.is-on .switch-knob {
  transform: translateX(16px);
}

.switch-row:active .switch-knob {
  transform: scale(0.92);
}

.switch-row.is-on:active .switch-knob {
  transform: translateX(16px) scale(0.92);
}

/* ============ 底部 ============ */
.dialog-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 13px 18px;
  flex-shrink: 0;
  border-top: 1px solid var(--dlg-line);
  background: color-mix(in srgb, var(--dlg-sunken) 40%, transparent);
}

.btn-ghost,
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 74px;
  padding: 7px 15px;
  border: none;
  border-radius: 9px;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out),
    opacity var(--duration-fast) var(--ease-out);
}

.btn-ghost {
  background: var(--dlg-sunken);
  color: var(--dlg-text-dim);
}

.btn-ghost:hover {
  background: var(--dlg-hover);
  color: var(--dlg-text);
}

.btn-primary {
  color: #fff;
  background: linear-gradient(180deg, var(--dlg-accent-2), var(--dlg-accent));
  box-shadow:
    0 6px 12px -6px rgba(0, 122, 255, 0.7),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

.btn-primary:hover:not(:disabled) {
  box-shadow:
    0 8px 16px -6px rgba(0, 122, 255, 0.75),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.btn-ghost:active,
.btn-primary:active:not(:disabled) {
  transform: scale(0.97);
}

.btn-primary:disabled {
  cursor: default;
  opacity: 0.42;
  box-shadow: none;
}

/* ============ 过渡 ============ */
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 180ms var(--ease-out);
}

.dialog-enter-active .dialog-card,
.dialog-leave-active .dialog-card {
  transition:
    transform 220ms var(--ease-out),
    opacity 180ms var(--ease-out);
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-from .dialog-card,
.dialog-leave-to .dialog-card {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .dialog-enter-active,
  .dialog-leave-active,
  .dialog-enter-active .dialog-card,
  .dialog-leave-active .dialog-card,
  .switch,
  .switch-knob {
    transition: none;
  }
}
</style>
