<script setup lang="ts">
import { ref, watch, computed } from 'vue'
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

// 是否为编辑模式
const isEditMode = computed(() => !!props.assistant)

// 弹窗标题
const dialogTitle = computed(() => isEditMode.value ? t('assistant.editTitle') : t('assistant.newTitle'))

// 合并监听 modelValue 和 assistant 变化
watch(
  [() => props.modelValue, () => props.assistant],
  ([isVisible, assistant]) => {
    if (!isVisible) {
      name.value = ''
      prompt.value = ''
      searchEnabled.value = false
    } else if (assistant) {
      name.value = assistant.name
      prompt.value = assistant.prompt
      searchEnabled.value = assistant.searchEnabled ?? false
    }
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
        <div class="dialog-container">
          <div class="dialog-header">
            <h2 class="dialog-title">{{ dialogTitle }}</h2>
            <button class="close-btn" @click="closeDialog">
              <i class="i-mdi-close"></i>
            </button>
          </div>

          <div class="dialog-content">
            <div class="form-item">
              <label class="form-label">{{ $t('assistant.name') }}</label>
              <input
                v-model="name"
                type="text"
                class="form-input"
                :placeholder="$t('assistant.namePlaceholder')"
              />
            </div>

            <div class="form-item">
              <label class="form-label">{{ $t('assistant.prompt') }}</label>
              <textarea
                v-model="prompt"
                class="form-textarea"
                :placeholder="$t('assistant.promptPlaceholder')"
                rows="6"
              ></textarea>
            </div>

            <div class="form-item">
              <label class="form-label">{{ $t('assistant.webSearch') }}</label>
              <div class="toggle-with-hint">
                <button
                  class="toggle-btn"
                  :class="{ active: searchEnabled }"
                  @click="searchEnabled = !searchEnabled"
                >
                  <span class="toggle-slider"></span>
                </button>
                <span class="toggle-hint">{{ $t('assistant.webSearchHint') }}</span>
              </div>
            </div>
          </div>

          <div class="dialog-footer">
            <button class="btn btn-cancel" @click="closeDialog">{{ $t('assistant.cancel') }}</button>
            <button class="btn btn-save" @click="handleSave" :disabled="!name.trim()">{{ $t('assistant.save') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}

.dialog-container {
  width: 480px;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.close-btn:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.close-btn i {
  font-size: 18px;
}

.dialog-content {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.form-item {
  margin-bottom: 16px;
}

.form-item:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 8px;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  color: var(--color-text);
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: var(--color-primary);
}

.form-input::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.form-textarea {
  width: 100%;
  padding: 10px 12px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  color: var(--color-text);
  outline: none;
  resize: vertical;
  min-height: 120px;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.form-textarea:focus {
  border-color: var(--color-primary);
}

.form-textarea::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-cancel {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.btn-cancel:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.btn-save {
  background: var(--color-primary);
  color: white;
}

.btn-save:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 过渡动画 */
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-enter-active .dialog-container,
.dialog-leave-active .dialog-container {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-from .dialog-container,
.dialog-leave-to .dialog-container {
  transform: scale(0.95);
  opacity: 0;
}

.toggle-with-hint {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toggle-hint {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.toggle-btn {
  position: relative;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
  border: none;
  border-radius: 12px;
  background: var(--color-border);
  cursor: pointer;
  transition: background 0.2s;
  padding: 0;
}

.toggle-btn.active {
  background: var(--color-primary);
}

.toggle-slider {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.toggle-btn.active .toggle-slider {
  transform: translateX(20px);
}
</style>
