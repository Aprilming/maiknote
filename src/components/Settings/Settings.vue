<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { useSettingStore, DEFAULT_SHORTCUTS, type ShortcutSettings, type ShortcutScope, type PinOffBehavior, type CodeTheme, type EditorStylePreset } from '@/stores/settingStore'
import { editorStylePresets } from '@/composables/editorStylePresets'
import { useAssistantsStore, defaultAssistants, type Assistant } from '@/stores/assistantsStore'
import { useVersionCheck } from '@/composables/useVersionCheck'
import { openUrl } from '@tauri-apps/plugin-opener'
import AssistantEditor from '@/components/Assistant/AssistantEditor.vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'

// 安全获取 Tauri 窗口
const isTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
const appWindow = isTauri ? getCurrentWindow() : null

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

  const dx = Math.round(lastScreenX - dragStartX)
  const dy = Math.round(lastScreenY - dragStartY)
  appWindow.setPosition(new PhysicalPosition(dragWinX + dx, dragWinY + dy))
  rafId = requestAnimationFrame(updateWindowPosition)
}

function onDragMove(e: MouseEvent) {
  if (!dragState) return

  const dpr = window.devicePixelRatio || 1
  lastScreenX = e.screenX * dpr
  lastScreenY = e.screenY * dpr
}

function onDragEnd() {
  dragState = false
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
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
const { currentTheme } = useTheme()
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
  // 快捷键允许为空（未设置），空值不匹配任何按键
  if (!shortcut) return false

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
  } else if (key === '[') {
    keyMatch = e.code === 'BracketLeft'
  } else if (key === ']') {
    keyMatch = e.code === 'BracketRight'
  } else if (key === '/') {
    keyMatch = e.code === 'Slash'
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
  const blockedShortcuts = [
    shortcuts.prevNote,
    shortcuts.nextNote,
    shortcuts.prevDirectory,
    shortcuts.nextDirectory,
    shortcuts.newNote,
    shortcuts.newNoteBefore,
    shortcuts.deleteNote,
    shortcuts.lock,
    shortcuts.toggleSource,
  ]

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
  prevDirectory: t('shortcut.prevDirectory'),
  nextDirectory: t('shortcut.nextDirectory'),
  newNote: t('shortcut.newNote'),
  newNoteBefore: t('shortcut.newNoteBefore'),
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
  prevDirectory: t('shortcut.prevDirectoryDesc'),
  nextDirectory: t('shortcut.nextDirectoryDesc'),
  newNote: t('shortcut.newNoteDesc'),
  newNoteBefore: t('shortcut.newNoteBeforeDesc'),
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

// 清空某个快捷键（允许快捷键为空，即禁用该项）
function clearShortcut(key: keyof ShortcutSettings, e?: Event) {
  e?.stopPropagation()
  settingStore.updateSettings('shortcuts', {
    ...settingStore.settings.shortcuts,
    [key]: '',
  })
  if (recordingKey.value === key) {
    stopRecording()
  }
}

// 单项恢复默认快捷键
function resetShortcut(key: keyof ShortcutSettings, e?: Event) {
  e?.stopPropagation()
  settingStore.updateSettings('shortcuts', {
    ...settingStore.settings.shortcuts,
    [key]: DEFAULT_SHORTCUTS[key],
  })
  if (recordingKey.value === key) {
    stopRecording()
  }
}

// 全部恢复默认快捷键
function resetAllShortcuts() {
  stopRecording()
  settingStore.updateSettings('shortcuts', { ...DEFAULT_SHORTCUTS })
  showToast(t('toast.shortcutsReset'))
}

// 置顶快捷键作用范围：全局 / 应用内
function setPinScope(scope: ShortcutScope) {
  settingStore.updateSettings('pinShortcutScope', scope)
}

function setPinOffBehavior(behavior: PinOffBehavior) {
  settingStore.updateSettings('pinOffBehavior', behavior)
}

function handleKeydown(e: KeyboardEvent) {
  if (!recordingKey.value) return

  e.preventDefault()
  e.stopPropagation()

  // 录制中按 Backspace / Delete（不带修饰键）：清空该快捷键
  if (
    (e.code === 'Backspace' || e.code === 'Delete') &&
    !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
  ) {
    clearShortcut(recordingKey.value)
    return
  }

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

// 编辑器样式预设选项
const editorStylePresetOptions = computed(() => {
  const keys = Object.keys(editorStylePresets) as EditorStylePreset[]
  return keys.map((key) => ({
    value: key,
    ...editorStylePresets[key],
  }))
})

// 自定义颜色辅助函数
const CUSTOM_COLOR_KEYS = [
  { key: 'codeBg', label: 'settings.customCodeBg' },
  { key: 'codeBorder', label: 'settings.customCodeBorder' },
  { key: 'codeText', label: 'settings.customCodeText' },
  { key: 'inlineCodeBg', label: 'settings.customInlineCodeBg' },
  { key: 'inlineCodeText', label: 'settings.customInlineCodeText' },
  { key: 'blockquoteBg', label: 'settings.customBlockquoteBg' },
  { key: 'blockquoteBorder', label: 'settings.customBlockquoteBorder' },
  { key: 'blockquoteText', label: 'settings.customBlockquoteText' },
] as const

type CustomColorKey = (typeof CUSTOM_COLOR_KEYS)[number]['key']

function updateCustomColor(mode: 'light' | 'dark', key: CustomColorKey, value: string) {
  const current = settingStore.settings.customEditorStyle
  const updated = {
    light: { ...current.light },
    dark: { ...current.dark },
  }
  updated[mode][key] = value
  settingStore.updateSettings('customEditorStyle', updated)
}

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
    <div class="settings-header" @mousedown="startDrag">
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
              <span class="setting-name">{{ $t('settings.tabSize') }}</span>
              <span class="setting-value">{{ $t('settings.tabSizeValue', { count: settingStore.settings.tabSize }) }}</span>
            </div>
            <input
              type="range"
              min="1"
              max="12"
              step="1"
              :value="settingStore.settings.tabSize"
              @input="settingStore.updateSettings('tabSize', parseInt(($event.target as HTMLInputElement).value))"
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
              <span class="setting-name">{{ $t('settings.editorStylePreset') }}</span>
              <span class="setting-desc">{{ $t('settings.editorStylePresetDesc') }}</span>
            </div>
            <div class="preset-selector">
              <button
                v-for="preset in editorStylePresetOptions"
                :key="preset.value"
                class="preset-btn"
                :class="{ active: settingStore.settings.editorStylePreset === preset.value }"
                @click="settingStore.updateSettings('editorStylePreset', preset.value)"
              >
                <div class="preset-preview">
                  <span class="preset-dot" :style="{ background: currentTheme === 'dark' ? preset.dark.codeBg : preset.light.codeBg, borderColor: currentTheme === 'dark' ? preset.dark.codeBorder : preset.light.codeBorder }"></span>
                  <span class="preset-dot" :style="{ background: currentTheme === 'dark' ? preset.dark.blockquoteBg : preset.light.blockquoteBg, borderColor: currentTheme === 'dark' ? preset.dark.blockquoteBorder : preset.light.blockquoteBorder }"></span>
                </div>
                <span class="preset-label">{{ $t('settings.preset_' + preset.value) }}</span>
              </button>
              <button
                class="preset-btn"
                :class="{ active: settingStore.settings.editorStylePreset === 'custom' }"
                @click="settingStore.updateSettings('editorStylePreset', 'custom')"
              >
                <div class="preset-preview">
                  <span class="preset-dot custom-dot"></span>
                  <span class="preset-dot custom-dot"></span>
                </div>
                <span class="preset-label">{{ $t('settings.preset_custom') }}</span>
              </button>
            </div>
          </div>

          <!-- 自定义颜色面板 -->
          <div v-if="settingStore.settings.editorStylePreset === 'custom'" class="custom-colors-section">
            <div class="custom-colors-title">{{ $t('settings.customColors') }}</div>

            <div class="custom-colors-grid">
              <div class="custom-colors-header">
                <span></span>
                <span class="custom-mode-label">{{ $t('settings.customLight') }}</span>
                <span class="custom-mode-label">{{ $t('settings.customDark') }}</span>
              </div>

              <div class="custom-group-title">{{ $t('settings.customGroupCodeBlock') }}</div>
              <div v-for="item in CUSTOM_COLOR_KEYS.filter(k => k.key.startsWith('code'))" :key="item.key" class="custom-color-row">
                <span class="custom-color-label">{{ $t(item.label) }}</span>
                <input type="color" :value="settingStore.settings.customEditorStyle.light[item.key]"
                  @input="updateCustomColor('light', item.key, ($event.target as HTMLInputElement).value)" class="color-input" />
                <input type="color" :value="settingStore.settings.customEditorStyle.dark[item.key]"
                  @input="updateCustomColor('dark', item.key, ($event.target as HTMLInputElement).value)" class="color-input" />
              </div>

              <div class="custom-group-title">{{ $t('settings.customGroupInlineCode') }}</div>
              <div v-for="item in CUSTOM_COLOR_KEYS.filter(k => k.key.startsWith('inlineCode'))" :key="item.key" class="custom-color-row">
                <span class="custom-color-label">{{ $t(item.label) }}</span>
                <input type="color" :value="settingStore.settings.customEditorStyle.light[item.key]"
                  @input="updateCustomColor('light', item.key, ($event.target as HTMLInputElement).value)" class="color-input" />
                <input type="color" :value="settingStore.settings.customEditorStyle.dark[item.key]"
                  @input="updateCustomColor('dark', item.key, ($event.target as HTMLInputElement).value)" class="color-input" />
              </div>

              <div class="custom-group-title">{{ $t('settings.customGroupBlockquote') }}</div>
              <div v-for="item in CUSTOM_COLOR_KEYS.filter(k => k.key.startsWith('blockquote'))" :key="item.key" class="custom-color-row">
                <span class="custom-color-label">{{ $t(item.label) }}</span>
                <input type="color" :value="settingStore.settings.customEditorStyle.light[item.key]"
                  @input="updateCustomColor('light', item.key, ($event.target as HTMLInputElement).value)" class="color-input" />
                <input type="color" :value="settingStore.settings.customEditorStyle.dark[item.key]"
                  @input="updateCustomColor('dark', item.key, ($event.target as HTMLInputElement).value)" class="color-input" />
              </div>
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

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.titleBarBehavior') }}</span>
            </div>
            <div class="theme-selector">
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.titleBarBehavior === 'auto-hide' }"
                @click="settingStore.updateSettings('titleBarBehavior', 'auto-hide')"
              >
                <i class="i-mdi-eye-off-outline"></i>
                <span>{{ $t('settings.titleBarAutoHide') }}</span>
              </button>
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.titleBarBehavior === 'always-show' }"
                @click="settingStore.updateSettings('titleBarBehavior', 'always-show')"
              >
                <i class="i-mdi-eye-outline"></i>
                <span>{{ $t('settings.titleBarAlwaysShow') }}</span>
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
            <template v-for="(label, key) in shortcutLabels" :key="key">
              <div
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
                  <span v-else-if="!settingStore.settings.shortcuts[key as keyof ShortcutSettings]" class="shortcut-key shortcut-key-empty">
                    {{ $t('settings.shortcutEmpty') }}
                  </span>
                  <span v-else class="shortcut-key">
                    {{ settingStore.settings.shortcuts[key as keyof ShortcutSettings] }}
                  </span>
                  <button
                    v-if="recordingKey !== key && settingStore.settings.shortcuts[key as keyof ShortcutSettings] !== DEFAULT_SHORTCUTS[key as keyof ShortcutSettings]"
                    class="shortcut-action-btn"
                    type="button"
                    :title="$t('settings.shortcutReset')"
                    @click.stop="resetShortcut(key as keyof ShortcutSettings, $event)"
                  >
                    <i class="i-mdi-restore"></i>
                  </button>
                  <button
                    v-if="recordingKey !== key && settingStore.settings.shortcuts[key as keyof ShortcutSettings]"
                    class="shortcut-action-btn"
                    type="button"
                    :title="$t('settings.shortcutClear')"
                    @click.stop="clearShortcut(key as keyof ShortcutSettings, $event)"
                  >
                    <i class="i-mdi-close-circle"></i>
                  </button>
                  <i v-if="recordingKey !== key" class="i-mdi-pencil edit-icon"></i>
                </div>
              </div>

              <!-- 置顶快捷键下方：选择作用范围 -->
              <div v-if="key === 'pin'" class="shortcut-item shortcut-scope-item">
                <div class="shortcut-info">
                  <span class="shortcut-label">{{ $t('settings.pinScope') }}</span>
                  <span class="shortcut-desc">{{ $t('settings.pinScopeDesc') }}</span>
                </div>
                <div class="scope-switch">
                  <button
                    class="scope-option"
                    :class="{ active: settingStore.settings.pinShortcutScope === 'global' }"
                    type="button"
                    @click="setPinScope('global')"
                  >
                    {{ $t('settings.pinScopeGlobal') }}
                  </button>
                  <button
                    class="scope-option"
                    :class="{ active: settingStore.settings.pinShortcutScope === 'app' }"
                    type="button"
                    @click="setPinScope('app')"
                  >
                    {{ $t('settings.pinScopeApp') }}
                  </button>
                </div>
              </div>

              <!-- 取消置顶时的行为 -->
              <div v-if="key === 'pin'" class="shortcut-item shortcut-scope-item">
                <div class="shortcut-info">
                  <span class="shortcut-label">{{ $t('settings.pinOffBehavior') }}</span>
                  <span class="shortcut-desc">{{ $t('settings.pinOffBehaviorDesc') }}</span>
                </div>
                <div class="scope-switch">
                  <button
                    class="scope-option"
                    :class="{ active: settingStore.settings.pinOffBehavior === 'show' }"
                    type="button"
                    @click="setPinOffBehavior('show')"
                  >
                    {{ $t('settings.pinOffKeepShow') }}
                  </button>
                  <button
                    class="scope-option"
                    :class="{ active: settingStore.settings.pinOffBehavior === 'hide' }"
                    type="button"
                    @click="setPinOffBehavior('hide')"
                  >
                    {{ $t('settings.pinOffHide') }}
                  </button>
                </div>
              </div>
            </template>
          </div>

          <div class="shortcut-footer">
            <button class="reset-all-shortcuts-btn" type="button" @click="resetAllShortcuts">
              <i class="i-mdi-restore"></i>
              <span>{{ $t('settings.shortcutResetAll') }}</span>
            </button>
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
  transition: all var(--duration-fast) var(--ease-out);
}

.back-btn:hover {
  background: var(--color-border);
}

.back-btn:active {
  transform: scale(0.93);
}

.back-btn i {
  font-size: 20px;
}

.settings-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: -0.02em;
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
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  text-align: left;
}

.nav-item:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.nav-item:active {
  transform: scale(0.97);
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
  background: var(--color-background);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
  transition: box-shadow var(--duration-fast) var(--ease-out);
}

.setting-item:last-child {
  margin-bottom: 0;
}

.setting-item:hover {
  box-shadow: var(--shadow-xs);
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
  letter-spacing: -0.01em;
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
  transition: transform var(--duration-fast) var(--ease-out);
}

.alpha-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.alpha-slider::-webkit-slider-thumb:active {
  transform: scale(0.9);
}

.toggle-btn {
  position: relative;
  width: 44px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 13px;
  background: var(--color-border);
  cursor: pointer;
  transition: background-color var(--duration-normal) var(--ease-out);
}

.toggle-btn:active .toggle-slider {
  transform: scale(0.9);
}

.toggle-btn.active:active .toggle-slider {
  transform: translateX(18px) scale(0.9);
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
  transition: all var(--duration-fast) var(--ease-out);
  font-size: 13px;
}

.theme-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.theme-btn:active {
  transform: scale(0.97);
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
  transition: all var(--duration-fast) var(--ease-out);
  font-size: 12px;
}

.code-theme-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.code-theme-btn:active {
  transform: scale(0.97);
}

.code-theme-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.code-theme-btn i {
  font-size: 18px;
}

/* Editor style preset selector */
.preset-selector {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.preset-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  font-size: 11px;
  min-width: 68px;
}

.preset-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.preset-btn:active {
  transform: scale(0.97);
}

.preset-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.preset-preview {
  display: flex;
  gap: 4px;
}

.preset-dot {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1.5px solid;
}

.preset-label {
  font-size: 11px;
  white-space: nowrap;
}

.custom-dot {
  background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red) !important;
  border: 1.5px solid rgba(128, 128, 128, 0.4) !important;
}

/* Custom colors panel */
.custom-colors-section {
  background: var(--color-background);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-bottom: 16px;
}

.custom-colors-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 12px;
}

.custom-colors-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.custom-colors-header {
  display: grid;
  grid-template-columns: 1fr 60px 60px;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
}

.custom-mode-label {
  font-size: 11px;
  color: var(--color-text-secondary);
  text-align: center;
}

.custom-group-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text);
  padding: 8px 0 4px 0;
  border-top: 1px solid var(--color-border);
  margin-top: 4px;
}

.custom-color-row {
  display: grid;
  grid-template-columns: 1fr 60px 60px;
  gap: 8px;
  align-items: center;
  padding: 3px 0;
}

.custom-color-label {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.color-input {
  width: 32px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  background: none;
  justify-self: center;
}

.color-input::-webkit-color-swatch-wrapper {
  padding: 0;
}

.color-input::-webkit-color-swatch {
  border: none;
  border-radius: 3px;
}

.toggle-slider {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: white;
  transition: transform var(--duration-normal) var(--ease-out);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.toggle-btn.active .toggle-slider {
  transform: translateX(18px);
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
  background: var(--color-background);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}

.shortcut-item:hover {
  box-shadow: var(--shadow-xs);
}

.shortcut-item.recording {
  background: color-mix(in srgb, var(--color-primary) 6%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 30%, transparent);
}

/* 置顶快捷键的作用范围选择行 */
.shortcut-scope-item {
  padding: 12px 16px;
  background: transparent;
  border: 1px dashed var(--color-border);
  cursor: default;
}

.shortcut-scope-item:hover {
  box-shadow: none;
}

.scope-switch {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
}

.scope-option {
  padding: 6px 12px;
  border: none;
  border-radius: calc(var(--radius-sm) - 2px);
  background: transparent;
  font-size: 13px;
  color: var(--color-text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.scope-option:hover {
  color: var(--color-text);
}

.scope-option.active {
  background: var(--color-background);
  color: var(--color-text);
  box-shadow: var(--shadow-xs);
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

.shortcut-key-empty {
  font-family: inherit;
  font-style: italic;
  color: var(--color-text-secondary);
  border-style: dashed;
}

.shortcut-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  font-size: 16px;
  color: var(--color-text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}

.shortcut-item:hover .shortcut-action-btn {
  opacity: 1;
}

.shortcut-action-btn:hover {
  color: var(--color-text);
}

.shortcut-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.reset-all-shortcuts-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  font-size: 13px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: color var(--duration-fast), border-color var(--duration-fast), background var(--duration-fast);
}

.reset-all-shortcuts-btn:hover {
  color: var(--color-text);
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 6%, transparent);
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
  transition: border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}

.text-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 15%, transparent);
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
  transition: all var(--duration-fast) var(--ease-out);
}

.check-update-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.check-update-btn:active:not(:disabled) {
  transform: scale(0.97);
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
  background: var(--color-background);
  border-radius: var(--radius-md);
  font-size: 14px;
  color: var(--color-text);
  text-decoration: none;
  transition: all var(--duration-fast) var(--ease-out);
}

.link-item:hover {
  color: var(--color-primary);
  box-shadow: var(--shadow-xs);
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
  transition: opacity var(--duration-fast) var(--ease-out);
}

.link-btn:hover {
  opacity: 1;
  text-decoration: underline;
}

.link-btn:active {
  opacity: 0.6;
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
  transition: all var(--duration-fast) var(--ease-out);
}

.download-btn:hover:not(:disabled) {
  opacity: 0.9;
  transform: scale(1.02);
}

.download-btn:active:not(:disabled) {
  transform: scale(0.97);
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
  transition: all var(--duration-fast) var(--ease-out);
}

.template-assistant-btn:hover {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 6%, transparent);
}

.template-assistant-btn:active {
  transform: scale(0.97);
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
  border-radius: var(--radius-md);
  transition: all var(--duration-fast) var(--ease-out);
}

.assistant-card:hover {
  box-shadow: var(--shadow-xs);
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
  transition: all var(--duration-fast) var(--ease-out);
}

.action-btn i {
  font-size: 16px;
}

.action-btn:active {
  transform: scale(0.9);
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
  background: color-mix(in srgb, #ef4444 10%, transparent);
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
  transition: all var(--duration-fast) var(--ease-out);
}

.add-assistant-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 4%, transparent);
}

.add-assistant-btn:active {
  transform: scale(0.98);
}

.add-assistant-btn i {
  font-size: 16px;
}
</style>
