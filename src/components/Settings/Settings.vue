<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { useSettingStore, type ShortcutSettings, type CodeTheme } from '@/stores/settingStore'
import { useAssistantsStore, defaultAssistants, type Assistant } from '@/stores/assistantsStore'
import { useVersionCheck } from '@/composables/useVersionCheck'
import { openUrl } from '@tauri-apps/plugin-opener'
import AssistantEditor from '@/components/Assistant/AssistantEditor.vue'
import { useI18n } from 'vue-i18n'

// 安全获取 Tauri 窗口
const isTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
const appWindow = isTauri ? getCurrentWindow() : null

// 拖拽功能 - requestAnimationFrame 同步到刷新率，统一使用物理像素
let dragState = false
let dragWinX = 0
let dragWinY = 0
let dragStartX = 0
let dragStartY = 0
let lastScreenX = 0
let lastScreenY = 0
let rafId = 0

async function startDrag(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, input, .back-btn, .settings-nav')) {
    return
  }
  if (e.buttons !== 1 || !appWindow) return

  const dpr = window.devicePixelRatio || 1
  const pos = await appWindow.outerPosition()
  dragWinX = pos.x
  dragWinY = pos.y
  dragStartX = e.screenX * dpr
  dragStartY = e.screenY * dpr
  lastScreenX = dragStartX
  lastScreenY = dragStartY
  dragState = true
  rafId = requestAnimationFrame(updateWindowPosition)
}

function updateWindowPosition() {
  if (!dragState || !appWindow) return
  const dx = lastScreenX - dragStartX
  const dy = lastScreenY - dragStartY
  appWindow.setPosition(new PhysicalPosition(dragWinX + dx, dragWinY + dy))
  rafId = requestAnimationFrame(updateWindowPosition)
}

function onDragMove(e: MouseEvent) {
  const dpr = window.devicePixelRatio || 1
  lastScreenX = e.screenX * dpr
  lastScreenY = e.screenY * dpr
}

function onDragEnd() {
  dragState = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
}

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

const { currentVersion, latestVersion, downloadState, downloadProgress, updateAvailable, checkError, checkForUpdates, downloadAndInstall } = useVersionCheck()
const checkLoading = computed(() => downloadState.value === 'checking')
const tagsUrl = 'https://github.com/Aprilming/maiknote/tags'

const settingStore = useSettingStore()
const assistantsStore = useAssistantsStore()
const { t, locale } = useI18n()

// 分类导航
type CategoryKey = 'general' | 'ai' | 'shortcuts' | 'about'
const activeCategory = ref<CategoryKey>('general')

const categories = computed(() => [
  { key: 'general' as const, icon: 'i-mdi-tune', label: t('settings.general') },
  { key: 'ai' as const, icon: 'i-mdi-robot', label: t('settings.ai') },
  { key: 'shortcuts' as const, icon: 'i-mdi-keyboard', label: t('settings.shortcuts') },
  { key: 'about' as const, icon: 'i-mdi-information-outline', label: t('settings.about') },
])

// 同步语言设置到 i18n locale
watch(() => settingStore.settings.language, (newLang) => {
  locale.value = newLang
}, { immediate: true })

// 初始化助手数据
onMounted(async () => {
  await assistantsStore.loadAssistants()
  if (assistantsStore.aiConfigExists) {
    settingStore.settings.aiUrl = assistantsStore.aiUrl
    settingStore.settings.aiKey = assistantsStore.aiKey
    settingStore.settings.aiModel = assistantsStore.aiModel
    settingStore.settings.baiduSearchKey = assistantsStore.baiduSearchKey
    settingStore.saveSettings()
  }
  try {
    const enabled = await invoke('is_autostart_enabled')
    settingStore.updateSettings('autoLaunch', !!enabled)
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
  const altMatch = modifiers.some(m => /^alt|option$/.test(m.toLowerCase())) ? e.altKey : !e.altKey
  const shiftMatch = modifiers.some(m => m.toLowerCase() === 'shift') ? e.shiftKey : !e.shiftKey
  const cmdMatch = modifiers.some(m => m.toLowerCase() === 'cmd') ? e.metaKey : !e.metaKey

  let keyMatch = false
  if (/^[a-z]$/.test(key)) {
    keyMatch = e.code === `Key${key.toUpperCase()}`
  } else if (/^\d$/.test(key)) {
    keyMatch = e.key === key
  } else if (key === 'backspace') {
    keyMatch = e.key === 'Backspace'
  } else if (key === '[' || key === ']' || key === '/') {
    keyMatch = e.key === key
  } else if (key === 'space') {
    keyMatch = e.key === ' '
  } else if (key === 'enter') {
    keyMatch = e.key === 'Enter'
  } else if (key === 'tab') {
    keyMatch = e.key === 'Tab'
  } else if (key === 'esc') {
    keyMatch = e.key === 'Escape'
  }

  return ctrlMatch && altMatch && shiftMatch && cmdMatch && keyMatch
}

function blockNoteShortcuts(e: KeyboardEvent) {
  const shortcuts = settingStore.settings.shortcuts
  const blockedShortcuts = [shortcuts.prevNote, shortcuts.nextNote, shortcuts.newNote, shortcuts.deleteNote, shortcuts.lock, shortcuts.toggleSource]

  for (const shortcut of blockedShortcuts) {
    if (matchesShortcut(e, shortcut)) {
      e.stopPropagation()
      break
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', blockNoteShortcuts, true)
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
})

onUnmounted(() => {
  window.removeEventListener('keydown', blockNoteShortcuts, true)
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})

// 切换自启动
async function toggleAutoLaunch() {
  try {
    if (settingStore.settings.autoLaunch) {
      await invoke('disable_autostart')
      settingStore.updateSettings('autoLaunch', false)
    } else {
      await invoke('enable_autostart')
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
const shortcutLabels = computed((): Record<keyof ShortcutSettings, string> => ({
  showMain: t('shortcut.showMain'),
  prevNote: t('shortcut.prevNote'),
  nextNote: t('shortcut.nextNote'),
  newNote: t('shortcut.newNote'),
  deleteNote: t('shortcut.deleteNote'),
  pin: t('shortcut.pin'),
  lock: t('shortcut.lock'),
  toggleSource: t('shortcut.toggleSource'),
  centerWindow: t('shortcut.centerWindow'),
}))

const shortcutDescs = computed((): Record<keyof ShortcutSettings, string> => ({
  showMain: t('shortcut.showMainDesc'),
  prevNote: t('shortcut.prevNoteDesc'),
  nextNote: t('shortcut.nextNoteDesc'),
  newNote: t('shortcut.newNoteDesc'),
  deleteNote: t('shortcut.deleteNoteDesc'),
  pin: t('shortcut.pinDesc'),
  lock: t('shortcut.lockDesc'),
  toggleSource: t('shortcut.toggleSourceDesc'),
  centerWindow: t('shortcut.centerWindowDesc'),
}))

function startRecording(key: keyof ShortcutSettings) {
  recordingKey.value = key
}

function stopRecording() {
  recordingKey.value = null
}

function handleKeydown(e: KeyboardEvent) {
  if (!recordingKey.value) return

  e.preventDefault()
  e.stopPropagation()

  if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) {
    return
  }

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Option')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Cmd')

  if (parts.length === 0) return
  if (parts.length > 4) return

  let keyName: string
  if (e.code.startsWith('Key')) {
    keyName = e.code.slice(3)
  } else if (e.code.startsWith('Digit')) {
    keyName = e.code.slice(5)
  } else if (e.code.startsWith('Bracket')) {
    keyName = e.code === 'BracketLeft' ? '[' : ']'
  } else {
    switch (e.code) {
      case 'Space': keyName = 'Space'; break
      case 'Enter': keyName = 'Enter'; break
      case 'Tab': keyName = 'Tab'; break
      case 'Escape': keyName = 'Esc'; break
      case 'Backspace': keyName = 'Backspace'; break
      case 'Slash': keyName = '/'; break
      default: keyName = e.code
    }
  }

  parts.push(keyName)
  const shortcut = parts.join('+')

  settingStore.updateSettings('shortcuts', {
    ...settingStore.settings.shortcuts,
    [recordingKey.value]: shortcut,
  })

  stopRecording()
}

function cancelRecording(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    stopRecording()
  }
}

// 代码高亮主题选项
const codeThemeOptions: { value: CodeTheme; label: string; icon: string }[] = [
  { value: 'github', label: 'GitHub', icon: 'i-mdi-github' },
  { value: 'github-dark', label: 'GitHub Dark', icon: 'i-mdi-github' },
  { value: 'xcode', label: 'Xcode', icon: 'i-mdi-apple' },
  { value: 'idea', label: 'IDEA', icon: 'i-mdi-lightbulb-outline' },
  { value: 'vs2015', label: 'VS Code', icon: 'i-mdi-visual-studio' },
  { value: 'atom-one-dark', label: 'Atom One Dark', icon: 'i-mdi-atom' },
  { value: 'monokai', label: 'Monokai', icon: 'i-mdi-palette' },
  { value: 'tokyo-night-dark', label: 'Tokyo Night', icon: 'i-mdi-weather-night' },
  { value: 'dracula', label: 'Dracula', icon: 'i-mdi-bat' },
  { value: 'nord', label: 'Nord', icon: 'i-mdi-snowflake' },
]

const emit = defineEmits<{
  (e: 'back'): void
}>()

function goBack() {
  emit('back')
}

// ==================== AI 助手相关 ====================

const assistantEditorVisible = ref(false)
const editingAssistant = ref<Assistant | undefined>(undefined)

const userAssistants = computed(() => {
  return assistantsStore.assistants.filter(a => !a.id.startsWith('template-'))
})

async function handleTemplateClick(template: Assistant) {
  if (assistantsStore.hasUserPrompt(template.prompt)) {
    showToast(t('toast.assistantAlreadyAdded'))
    return
  }
  await assistantsStore.addAssistant(template.name, template.prompt, template.searchEnabled)
  showToast(t('toast.assistantAdded'))
}

function handleAddAssistant() {
  editingAssistant.value = undefined
  assistantEditorVisible.value = true
}

function handleEditAssistant(assistant: Assistant) {
  editingAssistant.value = assistant
  assistantEditorVisible.value = true
}

async function handleDeleteAssistant(assistant: Assistant) {
  await assistantsStore.deleteAssistant(assistant.id)
}

async function handleSaveAssistant(data: { name: string; prompt: string; searchEnabled: boolean }) {
  if (editingAssistant.value) {
    await assistantsStore.updateAssistant(editingAssistant.value.id, data)
  } else {
    await assistantsStore.addAssistant(data.name, data.prompt, data.searchEnabled)
  }
}

async function handleToggleSearch(assistant: Assistant) {
  await assistantsStore.updateAssistant(assistant.id, {
    searchEnabled: !assistant.searchEnabled,
  })
}

function openBaiduKeyPage() {
  openUrl('https://www.mcpworld.com/zh/detail/cKWidcA4kbFuEMzK9HrbP6')
}

function getPromptPreview(prompt: string): string {
  const chars = [...prompt]
  return chars.length > 50 ? chars.slice(0, 50).join('') + '...' : prompt
}
</script>

<template>
  <div class="settings-page" @keydown="handleKeydown" @keyup="cancelRecording" tabindex="0">
    <div class="settings-header" data-tauri-drag-region @mousedown="startDrag">
      <button class="back-btn" @click="goBack">
        <i class="i-mdi-arrow-left"></i>
      </button>
      <h1 class="settings-title">{{ $t('settings.title') }}</h1>
    </div>

    <div class="settings-body">
      <!-- 左侧分类导航 -->
      <nav class="settings-nav">
        <button
          v-for="cat in categories"
          :key="cat.key"
          class="nav-item"
          :class="{ active: activeCategory === cat.key }"
          @click="activeCategory = cat.key"
        >
          <i :class="cat.icon"></i>
          <span>{{ cat.label }}</span>
        </button>
      </nav>

      <!-- 右侧设置内容 -->
      <div class="settings-content">
        <!-- 通用 -->
        <section v-if="activeCategory === 'general'" class="settings-section">
          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.theme') }}</span>
            </div>
            <div class="theme-selector">
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.theme === 'light' }"
                @click="settingStore.updateSettings('theme', 'light')"
              >
                <i class="i-mdi-weather-sunny"></i>
                <span>{{ $t('settings.themeLight') }}</span>
              </button>
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.theme === 'dark' }"
                @click="settingStore.updateSettings('theme', 'dark')"
              >
                <i class="i-mdi-weather-night"></i>
                <span>{{ $t('settings.themeDark') }}</span>
              </button>
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.theme === 'auto' }"
                @click="settingStore.updateSettings('theme', 'auto')"
              >
                <i class="i-mdi-theme-light-dark"></i>
                <span>{{ $t('settings.themeAuto') }}</span>
              </button>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.language') }}</span>
            </div>
            <div class="theme-selector">
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.language === 'zh-CN' }"
                @click="settingStore.updateSettings('language', 'zh-CN')"
              >
                <span>中文</span>
              </button>
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.language === 'en-US' }"
                @click="settingStore.updateSettings('language', 'en-US')"
              >
                <span>English</span>
              </button>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.transparency') }}</span>
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
              <span class="setting-name">{{ $t('settings.fontSize') }}</span>
              <span class="setting-value">{{ settingStore.settings.fontSize }}px</span>
            </div>
            <input
              type="range"
              min="10"
              max="32"
              step="1"
              :value="settingStore.settings.fontSize"
              @input="settingStore.updateSettings('fontSize', parseInt(($event.target as HTMLInputElement).value))"
              class="alpha-slider"
            />
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.codeTheme') }}</span>
            </div>
            <div class="code-theme-selector">
              <button
                v-for="theme in codeThemeOptions"
                :key="theme.value"
                class="code-theme-btn"
                :class="{ active: settingStore.settings.codeTheme === theme.value }"
                @click="settingStore.updateSettings('codeTheme', theme.value)"
              >
                <i :class="theme.icon"></i>
                <span>{{ theme.label }}</span>
              </button>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.autoLaunch') }}</span>
            </div>
            <button
              class="toggle-btn"
              :class="{ active: settingStore.settings.autoLaunch }"
              @click="toggleAutoLaunch"
            >
              <span class="toggle-slider"></span>
            </button>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.rememberLastDir') }}</span>
              <span class="setting-desc">{{ $t('settings.rememberLastDirDesc') }}</span>
            </div>
            <button
                class="toggle-btn"
                :class="{ active: settingStore.settings.rememberLastDirectory }"
                @click="settingStore.updateSettings('rememberLastDirectory', !settingStore.settings.rememberLastDirectory)"
            >
              <span class="toggle-slider"></span>
            </button>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.closeBehavior') }}</span>
            </div>
            <div class="theme-selector">
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.closeBehavior === 'hide' }"
                @click="settingStore.updateSettings('closeBehavior', 'hide')"
              >
                <i class="i-mdi-eye-off-outline"></i>
                <span>{{ $t('settings.closeBehaviorHide') }}</span>
              </button>
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.closeBehavior === 'quit' }"
                @click="settingStore.updateSettings('closeBehavior', 'quit')"
              >
                <i class="i-mdi-exit-to-app"></i>
                <span>{{ $t('settings.closeBehaviorQuit') }}</span>
              </button>
            </div>
          </div>

        </section>

        <!-- AI -->
        <section v-if="activeCategory === 'ai'" class="settings-section">
          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.aiUrl') }}</span>
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
              <span class="setting-name">{{ $t('settings.aiKey') }}</span>
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
              <span class="setting-name">{{ $t('settings.aiModel') }}</span>
            </div>
            <input
              type="text"
              :value="settingStore.settings.aiModel"
              @change="settingStore.updateSettings('aiModel', ($event.target as HTMLInputElement).value)"
              class="text-input"
              placeholder="deepseek-v4-flash"
            />
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.aiBaiduKey') }}</span>
              <span class="setting-desc">{{ $t('settings.aiBaiduKeyDesc') }}</span>
            </div>
            <input
              type="password"
              :value="settingStore.settings.baiduSearchKey"
              @change="settingStore.updateSettings('baiduSearchKey', ($event.target as HTMLInputElement).value)"
              class="text-input"
              :placeholder="$t('settings.aiBaiduKeyPlaceholder')"
            />
            <button class="link-btn" @click="openBaiduKeyPage">
              <i class="i-mdi-open-in-new"></i>
              {{ $t('settings.aiGetBaiduKey') }}
            </button>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.aiTemplateAssistants') }}</span>
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
              <span class="setting-name">{{ $t('settings.aiMyAssistants') }}</span>
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
                  <button
                    class="action-btn search-btn"
                    :class="{ active: assistant.searchEnabled }"
                    @click="handleToggleSearch(assistant)"
                    :title="assistant.searchEnabled ? t('assistant.searchOn') : t('assistant.searchOff')"
                  >
                    <i class="i-mdi-web"></i>
                  </button>
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
                <span>{{ $t('settings.addAssistant') }}</span>
              </button>
            </div>
          </div>
        </section>

        <!-- 快捷键 -->
        <section v-if="activeCategory === 'shortcuts'" class="settings-section">
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
                <span v-if="recordingKey === key" class="recording-text">{{ $t('settings.recording') }}</span>
                <span v-else class="shortcut-key">
                  {{ settingStore.settings.shortcuts[key as keyof ShortcutSettings] }}
                </span>
                <i v-if="recordingKey !== key" class="i-mdi-pencil edit-icon"></i>
              </div>
            </div>
          </div>

          <p v-if="recordingKey" class="recording-hint">
            {{ $t('settings.recordingHint') }}
          </p>
        </section>

        <!-- 关于 -->
        <section v-if="activeCategory === 'about'" class="settings-section">
          <div class="setting-item version-item">
            <div class="version-info">
              <span class="version-label">{{ $t('settings.currentVersion') }}</span>
              <span class="version-number">v{{ currentVersion }}</span>
            </div>
            <button
              class="check-update-btn"
              :disabled="checkLoading"
              @click="checkForUpdates"
            >
              <i v-if="checkLoading" class="i-mdi-loading spin"></i>
              <span v-else>{{ $t('settings.checkUpdate') }}</span>
            </button>
          </div>

          <div v-if="updateAvailable" class="setting-item update-available">
            <div class="update-info">
              <i v-if="downloadState === 'downloading'" class="i-mdi-loading spin"></i>
              <i v-else class="i-mdi-update"></i>
              <span v-if="downloadState === 'downloading'">{{ $t('settings.downloading', { progress: downloadProgress }) }}</span>
              <span v-else>{{ $t('settings.updateAvailable', { version: latestVersion }) }}</span>
            </div>
            <button class="download-btn" :disabled="downloadState === 'downloading'" @click="downloadAndInstall">
              <i v-if="downloadState === 'downloading'" class="i-mdi-loading spin"></i>
              <i v-else class="i-mdi-download"></i>
              <span v-if="downloadState === 'downloading'">{{ downloadProgress }}%</span>
              <span v-else>{{ $t('settings.installUpdate') }}</span>
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
              <span>{{ $t('settings.upToDate', { version: latestVersion }) }}</span>
            </div>
          </div>

          <div class="setting-item links-item">
            <a :href="tagsUrl" target="_blank" class="link-item">
              <i class="i-mdi-tag-outline"></i>
              <span>{{ $t('settings.versionTags') }}</span>
              <i class="i-mdi-open-in-new link-icon"></i>
            </a>
          </div>
        </section>
      </div>
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

/* 主体布局：左侧导航 + 右侧内容 */
.settings-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 左侧分类导航 */
.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 160px;
  padding: 16px 12px;
  border-right: 1px solid var(--color-border);
  background: var(--color-background);
  flex-shrink: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}

.nav-item:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.nav-item.active {
  background: var(--color-primary);
  color: white;
}

.nav-item i {
  font-size: 18px;
  flex-shrink: 0;
}

/* 右侧内容区 */
.settings-content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  background: var(--color-surface);
}

.settings-section {
  /* 去掉 margin-bottom，section 本身不再需要间距 */
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

.setting-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
  opacity: 0.7;
  line-height: 1.4;
}

.alpha-slider {
  width: 100%;
  height: 4px;
  appearance: none;
  background: #666;
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

/* Code theme selector */
.code-theme-selector {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.code-theme-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px 8px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  font-size: 12px;
}

.code-theme-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.code-theme-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.code-theme-btn i {
  font-size: 18px;
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

.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 0;
  border: none;
  background: none;
  font-size: 12px;
  color: var(--color-primary);
  cursor: pointer;
  opacity: 0.8;
  transition: opacity 0.15s;
}

.link-btn:hover {
  opacity: 1;
  text-decoration: underline;
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

.search-btn {
  color: var(--color-text-secondary);
}

.search-btn:hover {
  background: var(--color-border);
  color: var(--color-primary);
}

.search-btn.active {
  color: var(--color-primary);
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
