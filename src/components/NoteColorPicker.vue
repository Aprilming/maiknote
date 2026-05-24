<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

export interface ColorOption {
  name: string
  value: string
}

defineProps<{
  modelValue: string | undefined
  colors: ColorOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | undefined]
  'close': []
}>()

function selectColor(color: string | undefined) {
  emit('update:modelValue', color)
  emit('close')
}

function onCustomColorChange(e: Event) {
  const value = (e.target as HTMLInputElement).value
  if (value) {
    emit('update:modelValue', value)
    emit('close')
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="color-picker-popup" @click.stop>
    <div class="color-picker-header">背景</div>
    <div class="color-grid">
      <button
        class="color-option"
        :class="{ active: !modelValue }"
        title="默认"
        @click="selectColor(undefined)"
      >
        <span class="color-swatch color-swatch-none">
          <i class="i-mdi-close"></i>
        </span>
        <span class="color-label">默认</span>
      </button>
      <button
        v-for="color in colors"
        :key="color.value"
        class="color-option"
        :class="{ active: modelValue === color.value }"
        :title="color.name"
        @click="selectColor(color.value)"
      >
        <span class="color-swatch" :style="{ background: color.value }"></span>
        <span class="color-label">{{ color.name }}</span>
      </button>
      <div
        class="color-option color-option-custom"
        title="自定义颜色"
      >
        <span class="color-swatch color-swatch-custom">
          <i class="i-mdi-palette-outline"></i>
        </span>
        <span class="color-label">自定义</span>
        <input
          type="color"
          class="custom-color-input"
          @change="onCustomColorChange"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.color-picker-popup {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 12px;
  min-width: 200px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.color-picker-header {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.color-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.color-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.color-option:hover {
  border-color: var(--color-primary);
  background: rgba(59, 130, 246, 0.05);
}

.color-option.active {
  border-color: var(--color-primary);
  background: rgba(59, 130, 246, 0.1);
}

.color-swatch {
  display: block;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--color-border);
  flex-shrink: 0;
}

.color-swatch-none {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-background);
  color: var(--color-text-secondary);
  font-size: 14px;
}

.color-swatch-none i {
  font-size: 14px;
}

.color-swatch-custom {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ff0000, #ff8800, #ffff00, #00ff00, #0088ff, #8800ff);
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.color-swatch-custom i {
  font-size: 14px;
}

.color-option-custom {
  position: relative;
}

.custom-color-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.color-label {
  font-size: 11px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}
</style>
