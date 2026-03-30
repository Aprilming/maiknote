<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart'
import { useSettingStore, type ShortcutSettings } from '@/stores/settingStore'
import { useAssistantsStore, defaultAssistants, type Assistant } from '@/stores/assistantsStore'
import { useVersionCheck } from '@/composables/useVersionCheck'
import AssistantEditor from '@/components/Assistant/AssistantEditor.vue'

// Toast 通知
function showToast(message: string, duration = 2000) {
  const toast = document.createElement('div')
  toast.textContent = message
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.8);
    color: #fff;
    padding: 10px 20px;
    border-radius: 4px;
    z-index: 10000;
    font-size: 14px;
  `
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), duration)
}

const { currentVersion, latestVersion, isLoading: checkLoading, updateAvailable, checkError, checkForUpdates, openReleasePage, tagsUrl } = useVersionCheck()

const settingStore = useSettingStore()
const assistantsStore = useAssistantsStore()

// 初始化助手数据
onMounted(async () => {
  await assistantsStore.loadAssistants()
  try {
    const enabled = await isEnabled()
    settingStore.updateSettings('autoLaunch', enabled)
  } catch (e) {
    console.error('Failed to check autostart status:', e)
  }
})

// 阻止设置页面中的笔记操作快捷键
function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1].toLowerCase()
  const modifiers = parts.slice(0, -1)

  const ctrlMatch = modifiers.some(m => m.toLowerCase() === 'ctrl') ? e.ctrlKey : !e.ctrlKey
  const altMatch = modifiers.some(m => m.toLowerCase() === 'alt') ? e.altKey : !e.altKey
  const shiftMatch = modifiers.some(m => m.toLowerCase() === 'shift') ? e.shiftKey : !e.shiftKey
  const cmdMatch = modifiers.some(m => m.toLowerCase() === 'cmd') ? e.metaKey : !e.metaKey

  let keyMatch = false
  if (key === 'arrowleft') {
    keyMatch = e.key === 'ArrowLeft'
  } else if (key === 'arrowright') {
    keyMatch = e.key === 'ArrowRight'
  } else if (key === 'backspace') {
    keyMatch = e.key === 'Backspace'
  } else if (key === 'n' || key === 'f' || key === 'p') {
    keyMatch = e.key.toLowerCase() === key
  } else if (key === '[') {
    keyMatch = e.key === '['
  } else if (key === ']') {
    keyMatch = e.key === ']'
  }

  return ctrlMatch && altMatch && shiftMatch && cmdMatch && keyMatch
}

function blockNoteShortcuts(e: KeyboardEvent) {
  const shortcuts = settingStore.settings.shortcuts
  const blockedShortcuts = [shortcuts.prevNote, shortcuts.nextNote, shortcuts.newNote, shortcuts.deleteNote, shortcuts.lock]

  for (const shortcut of blockedShortcuts) {
    if (matchesShortcut(e, shortcut)) {
      e.stopPropagation()
      break
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', blockNoteShortcuts, true)
})

onUnmounted(() => {
  window.removeEventListener('keydown', blockNoteShortcuts, true)
})

// 切换自启动
async function toggleAutoLaunch() {
  try {
    if (settingStore.settings.autoLaunch) {
      await disable()
      settingStore.updateSettings('autoLaunch', false)
    } else {
      await enable()
      settingStore.updateSettings('autoLaunch', true)
    }
  } catch (e) {
    console.error('Failed to toggle autostart:', e)
  }
}

// 当前正在录制的快捷键
const recordingKey = ref<keyof ShortcutSettings | null>(null)

// 透明度滑块
async function onAlphaChange(e: Event) {
  const target = e.target as HTMLInputElement
  const alpha = parseFloat(target.value)
  settingStore.updateSettings('windowAlpha', alpha)
  await invoke('set_window_alpha', { alpha })
}

// 快捷键显示名称映射
const shortcutLabels: Record<keyof ShortcutSettings, string> = {
  showMain: '显示主页面',
  prevNote: '上一页',
  nextNote: '下一页',
  newNote: '新增页面',
  deleteNote: '删除页面',
  pin: '置顶窗口',
  lock: '锁定/解锁笔记',
}

// 快捷键说明
const shortcutDescs: Record<keyof ShortcutSettings, string> = {
  showMain: '全局快捷键，应用隐藏时也可触发',
  prevNote: '应用内快捷键，切换到上一条笔记',
  nextNote: '应用内快捷键，切换到下一条笔记',
  newNote: '应用内快捷键，新建一条笔记',
  deleteNote: '应用内快捷键，删除当前笔记',
  pin: '应用内快捷键，切换窗口置顶状态',
  lock: '应用内快捷键，锁定/解锁当前笔记',
}

// 开始录制快捷键
function startRecording(key: keyof ShortcutSettings) {
  recordingKey.value = key
}

// 停止录制快捷键
function stopRecording() {
  recordingKey.value = null
}

// 处理键盘事件
function handleKeydown(e: KeyboardEvent) {
  if (!recordingKey.value) return

  // 阻止默认行为
  e.preventDefault()
  e.stopPropagation()

  // 排除功能键单独按下（使用 e.code 判断）
  if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) {
    return
  }

  // 构建快捷键字符串
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Option')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Cmd')

  // 禁止单个键（没有任何修饰键）
  if (parts.length === 0) {
    return
  }

  // 最多4个组合键
  if (parts.length > 4) {
    return
  }

  // 使用 e.code 获取物理键名
  let keyName: string
  if (e.code.startsWith('Key')) {
    // KeyA -> A
    keyName = e.code.slice(3)
  } else if (e.code.startsWith('Digit')) {
    // Digit1 -> 1
    keyName = e.code.slice(5)
  } else if (e.code.startsWith('Bracket')) {
    // BracketLeft -> [, BracketRight -> ]
    keyName = e.code === 'BracketLeft' ? '[' : ']'
  } else {
    // 处理特殊键
    switch (e.code) {
      case 'Space': keyName = 'Space'; break
      case 'Enter': keyName = 'Enter'; break
      case 'Tab': keyName = 'Tab'; break
      case 'Escape': keyName = 'Esc'; break
      case 'Backspace': keyName = 'Backspace'; break
      default: keyName = e.code
    }
  }

  parts.push(keyName)

  const shortcut = parts.join('+')

  // 更新设置
  settingStore.updateSettings('shortcuts', {
    ...settingStore.settings.shortcuts,
    [recordingKey.value]: shortcut,
  })

  // 停止录制
  stopRecording()
}

// 取消录制
function cancelRecording(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    stopRecording()
  }
}

// 返回按钮
const emit = defineEmits<{
  (e: 'back'): void
}>()

function goBack() {
  emit('back')
}

// ==================== AI 助手相关 ====================

// AssistantEditor 弹窗状态
const assistantEditorVisible = ref(false)
const editingAssistant = ref<Assistant | undefined>(undefined)

// 用户助手列表（排除模板助手）
const userAssistants = computed(() => {
  return assistantsStore.assistants.filter(a => !a.id.startsWith('template-'))
})

// 点击模板助手
async function handleTemplateClick(template: Assistant) {
  // 检查是否已存在相同 prompt 的用户助手
  if (assistantsStore.hasUserPrompt(template.prompt)) {
    showToast('该助手已添加')
    return
  }
  // 添加到用户助手列表
  await assistantsStore.addAssistant(template.name, template.prompt)
  showToast('添加成功')
}

// 点击添加助手
function handleAddAssistant() {
  editingAssistant.value = undefined
  assistantEditorVisible.value = true
}

// 点击编辑助手
function handleEditAssistant(assistant: Assistant) {
  editingAssistant.value = assistant
  assistantEditorVisible.value = true
}

// 点击删除助手
async function handleDeleteAssistant(assistant: Assistant) {
  await assistantsStore.deleteAssistant(assistant.id)
}

// 保存助手
async function handleSaveAssistant(data: { name: string; prompt: string }) {
  if (editingAssistant.value) {
    // 编辑模式
    await assistantsStore.updateAssistant(editingAssistant.value.id, data)
  } else {
    // 新建模式
    await assistantsStore.addAssistant(data.name, data.prompt)
  }
}

// 提示词预览（截取前50字符）
function getPromptPreview(prompt: string): string {
  const chars = [...prompt]
  return chars.length > 50 ? chars.slice(0, 50).join('') + '...' : prompt
}
</script>

<template>
  <div class="settings-page" @keydown="handleKeydown" @keyup="cancelRecording" tabindex="0">
    <div class="settings-header">
      <button class="back-btn" @click="goBack">
        <i class="i-mdi-arrow-left"></i>
      </button>
      <h1 class="settings-title">设置</h1>
    </div>

    <div class="settings-content">
      <section class="settings-section">
        <h2 class="section-title">通用设置</h2>

        <div class="setting-item">
          <div class="setting-label">
            <span class="setting-name">主题</span>
          </div>
          <div class="theme-selector">
            <button
              class="theme-btn"
              :class="{ active: settingStore.settings.theme === 'light' }"
              @click="settingStore.updateSettings('theme', 'light')"
            >
              <i class="i-mdi-weather-sunny"></i>
              <span>浅色</span>
            </button>
            <button
              class="theme-btn"
              :class="{ active: settingStore.settings.theme === 'dark' }"
              @click="settingStore.updateSettings('theme', 'dark')"
            >
              <i class="i-mdi-weather-night"></i>
              <span>深色</span>
            </button>
            <button
              class="theme-btn"
              :class="{ active: settingStore.settings.theme === 'auto' }"
              @click="settingStore.updateSettings('theme', 'auto')"
            >
              <i class="i-mdi-theme-light-dark"></i>
              <span>自动</span>
            </button>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span class="setting-name">透明度</span>
            <span class="setting-value">{{ Math.round(settingStore.settings.windowAlpha * 100) }}%</span>
          </div>
          <input
            type="range"
            min="0.6"
            max="1"
            step="0.01"
            :value="settingStore.settings.windowAlpha"
            @input="onAlphaChange"
            class="alpha-slider"
          />
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span class="setting-name">开机自启动</span>
          </div>
          <button
            class="toggle-btn"
            :class="{ active: settingStore.settings.autoLaunch }"
            @click="toggleAutoLaunch"
          >
            <span class="toggle-slider"></span>
          </button>
        </div>
      </section>

      <section class="settings-section">
        <h2 class="section-title">AI 设置</h2>

        <div class="setting-item">
          <div class="setting-label">
            <span class="setting-name">API URL</span>
          </div>
          <input
            type="text"
            :value="settingStore.settings.aiUrl"
            @change="settingStore.updateSettings('aiUrl', ($event.target as HTMLInputElement).value)"
            class="text-input"
            placeholder="https://api.deepseek.com/chat/completions"
          />
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span class="setting-name">API Key</span>
          </div>
          <input
            type="password"
            :value="settingStore.settings.aiKey"
            @change="settingStore.updateSettings('aiKey', ($event.target as HTMLInputElement).value)"
            class="text-input"
            placeholder="sk-..."
          />
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span class="setting-name">模型</span>
          </div>
          <input
            type="text"
            :value="settingStore.settings.aiModel"
            @change="settingStore.updateSettings('aiModel', ($event.target as HTMLInputElement).value)"
            class="text-input"
            placeholder="deepseek-chat"
          />
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span class="setting-name">模板助手</span>
          </div>
          <div class="template-assistants">
            <button
              v-for="template in defaultAssistants"
              :key="template.id"
              class="template-assistant-btn"
              @click="handleTemplateClick(template)"
            >
              <span class="template-name">{{ template.name }}</span>
            </button>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span class="setting-name">我的助手</span>
          </div>
          <div class="user-assistants">
            <div
              v-for="assistant in userAssistants"
              :key="assistant.id"
              class="assistant-card"
            >
              <div class="assistant-info">
                <div class="assistant-name">
                  <i class="i-mdi-face-agent"></i>
                  <span>{{ assistant.name }}</span>
                </div>
                <div class="assistant-preview">{{ getPromptPreview(assistant.prompt) }}</div>
              </div>
              <div class="assistant-actions">
                <button class="action-btn edit-btn" @click="handleEditAssistant(assistant)">
                  <i class="i-mdi-pencil"></i>
                </button>
                <button class="action-btn delete-btn" @click="handleDeleteAssistant(assistant)">
                  <i class="i-mdi-delete"></i>
                </button>
              </div>
            </div>
            <button class="add-assistant-btn" @click="handleAddAssistant">
              <i class="i-mdi-plus"></i>
              <span>添加助手</span>
            </button>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <h2 class="section-title">快捷键设置</h2>

        <div class="shortcut-list">
          <div
            v-for="(label, key) in shortcutLabels"
            :key="key"
            class="shortcut-item"
            :class="{ recording: recordingKey === key }"
            @click="startRecording(key as keyof ShortcutSettings)"
          >
            <div class="shortcut-info">
              <span class="shortcut-label">{{ label }}</span>
              <span class="shortcut-desc">{{ shortcutDescs[key as keyof ShortcutSettings] }}</span>
            </div>
            <div class="shortcut-value">
              <span v-if="recordingKey === key" class="recording-text">点击按键...</span>
              <span v-else class="shortcut-key">
                {{ settingStore.settings.shortcuts[key as keyof ShortcutSettings] }}
              </span>
              <i v-if="recordingKey !== key" class="i-mdi-pencil edit-icon"></i>
            </div>
          </div>
        </div>

        <p v-if="recordingKey" class="recording-hint">
          按下快捷键组合，按 Escape 取消
        </p>
      </section>

      <section class="settings-section">
        <h2 class="section-title">关于</h2>
        <div class="setting-item version-item">
          <div class="version-info">
            <span class="version-label">当前版本</span>
            <span class="version-number">v{{ currentVersion }}</span>
          </div>
          <button
            class="check-update-btn"
            :disabled="checkLoading"
            @click="checkForUpdates"
          >
            <i v-if="checkLoading" class="i-mdi-loading spin"></i>
            <span v-else>检查更新</span>
          </button>
        </div>

        <div v-if="updateAvailable" class="setting-item update-available">
          <div class="update-info">
            <i class="i-mdi-update"></i>
            <span>发现新版本 v{{ latestVersion }}</span>
          </div>
          <button class="download-btn" @click="openReleasePage">
            <span>前往下载</span>
            <i class="i-mdi-open-in-new"></i>
          </button>
        </div>

        <div v-else-if="checkError" class="setting-item update-error">
          <div class="update-info">
            <i class="i-mdi-alert-circle-outline"></i>
            <span>{{ checkError }}</span>
          </div>
        </div>

        <div v-else-if="latestVersion && !checkLoading" class="setting-item update-latest">
          <div class="update-info">
            <i class="i-mdi-check-circle-outline"></i>
            <span>已是最新版本 (v{{ latestVersion }})</span>
          </div>
        </div>

        <div class="setting-item links-item">
          <a :href="tagsUrl" target="_blank" class="link-item">
            <i class="i-mdi-tag-outline"></i>
            <span>版本标签</span>
            <i class="i-mdi-open-in-new link-icon"></i>
          </a>
        </div>
      </section>
    </div>

    <AssistantEditor
      v-model="assistantEditorVisible"
      :assistant="editingAssistant"
      @save="handleSaveAssistant"
    />
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--color-surface);
  outline: none;
  overflow: hidden;
}

.settings-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  transition: background-color 0.15s;
}

.back-btn:hover {
  background: var(--color-border);
}

.back-btn i {
  font-size: 20px;
}

.settings-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
}

.settings-content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  background: var(--color-surface);
}

.settings-section {
  margin-bottom: 32px;
}

.setting-item {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
}

.setting-item:last-child {
  margin-bottom: 0;
}

.setting-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.setting-name {
  font-size: 15px;
  font-weight: 500;
  color: var(--color-text);
}

.setting-value {
  font-size: 13px;
  color: var(--color-text-secondary);
  font-family: monospace;
}

.alpha-slider {
  width: 100%;
  height: 4px;
  appearance: none;
  background: var(--color-border);
  border-radius: 2px;
  outline: none;
}

.alpha-slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  background: var(--color-primary);
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.15s;
}

.alpha-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.toggle-btn {
  position: relative;
  width: 48px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 14px;
  background: var(--color-border);
  cursor: pointer;
  transition: background-color 0.2s;
}

.toggle-btn.active {
  background: var(--color-primary);
}

/* Theme selector */
.theme-selector {
  display: flex;
  gap: 8px;
}

.theme-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  font-size: 13px;
}

.theme-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.theme-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.theme-btn i {
  font-size: 16px;
}

.toggle-slider {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
}

.toggle-btn.active .toggle-slider {
  transform: translateX(20px);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 16px;
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;
}

.shortcut-item:hover {
  border-color: var(--color-primary);
}

.shortcut-item.recording {
  border-color: var(--color-primary);
  background: rgba(59, 130, 246, 0.05);
}

.shortcut-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.shortcut-label {
  font-size: 15px;
  font-weight: 500;
  color: var(--color-text);
}

.shortcut-desc {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.shortcut-value {
  display: flex;
  align-items: center;
  gap: 8px;
}

.shortcut-key {
  padding: 6px 12px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-family: monospace;
  color: var(--color-text);
}

.recording-text {
  font-size: 13px;
  color: var(--color-primary);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.edit-icon {
  font-size: 16px;
  color: var(--color-text-secondary);
  opacity: 0;
  transition: opacity 0.15s;
}

.shortcut-item:hover .edit-icon {
  opacity: 1;
}

.recording-hint {
  margin-top: 12px;
  font-size: 13px;
  color: var(--color-text-secondary);
  text-align: center;
}

.text-input {
  width: 100%;
  padding: 10px 12px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  color: var(--color-text);
  outline: none;
  transition: border-color 0.15s;
}

.text-input:focus {
  border-color: var(--color-primary);
}

.text-input::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.textarea-input {
  resize: vertical;
  min-height: 60px;
  height: auto;
  font-family: inherit;
  line-height: 1.5;
  overflow: auto;
  field-sizing: content;
}

/* 版本信息样式 */
.version-item {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.version-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.version-label {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.version-number {
  font-size: 16px;
  font-weight: 600;
  font-family: monospace;
  color: var(--color-text);
}

.check-update-btn {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.15s;
}

.check-update-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.check-update-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.links-item {
  padding: 0;
  background: transparent;
  border: none;
}

.link-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 14px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 14px;
  color: var(--color-text);
  text-decoration: none;
  transition: all 0.15s;
}

.link-item:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.link-item i:first-child {
  font-size: 18px;
  color: var(--color-text-secondary);
}

.link-item i.link-icon {
  margin-left: auto;
  font-size: 14px;
  opacity: 0.5;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.update-available {
  flex-direction: column;
  gap: 12px;
  border-color: var(--color-primary);
  background: rgba(59, 130, 246, 0.05);
}

.update-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--color-primary);
}

.update-info i {
  font-size: 18px;
}

.download-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  color: white;
  cursor: pointer;
  transition: opacity 0.15s;
}

.download-btn:hover {
  opacity: 0.9;
}

.download-btn i {
  font-size: 16px;
}

.update-error {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.05);
}

.update-error .update-info {
  color: #f59e0b;
}

.update-latest {
  border-color: #22c55e;
  background: rgba(34, 197, 94, 0.05);
}

.update-latest .update-info {
  color: #22c55e;
}

/* AI 助手设置区域 */
.template-assistants {
  display: flex;
  gap: 12px;
}

.template-assistant-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;
}

.template-assistant-btn:hover {
  border-color: var(--color-primary);
  background: rgba(59, 130, 246, 0.05);
}

.template-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
}

.user-assistants {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.assistant-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: all 0.15s;
}

.assistant-card:hover {
  border-color: var(--color-primary);
}

.assistant-info {
  flex: 1;
  min-width: 0;
}

.assistant-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 4px;
}

.assistant-name i {
  font-size: 16px;
  color: var(--color-primary);
}

.assistant-preview {
  font-size: 12px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-actions {
  display: flex;
  gap: 4px;
  margin-left: 12px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.action-btn i {
  font-size: 16px;
}

.edit-btn {
  color: var(--color-text-secondary);
}

.edit-btn:hover {
  background: var(--color-border);
  color: var(--color-primary);
}

.delete-btn {
  color: var(--color-text-secondary);
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.add-assistant-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  background: transparent;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}

.add-assistant-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.add-assistant-btn i {
  font-size: 16px;
}
</style>
