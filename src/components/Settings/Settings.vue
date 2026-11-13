<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { useSettingStore, DEFAULT_IP_API_URL, normalizeIpApiUrl, DEFAULT_SHORTCUTS, type ShortcutSettings, type ShortcutScope, type PinOffBehavior, type CodeTheme, type EditorStylePreset, type DesktopNoteLevel } from '@/stores/settingStore'
import { editorStylePresets } from '@/composables/editorStylePresets'
import { useAssistantsStore, defaultAssistants, type Assistant } from '@/stores/assistantsStore'
import { useVersionCheck } from '@/composables/useVersionCheck'
import { useDesktopNotes } from '@/composables/useDesktopNotes'
import { openUrl } from '@tauri-apps/plugin-opener'
import AssistantEditor from '@/components/Assistant/AssistantEditor.vue'
import PrivacyPledge from '@/components/common/PrivacyPledge.vue'
import PrivacyDialog from '@/components/common/PrivacyDialog.vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'
import { LIGHT_NOTE_COLORS, DARK_NOTE_COLORS } from '@/utils/noteColors'

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
// IP 助手：查询地址在通用设置里可改（空值/非法值回落到 DEFAULT_IP_API_URL），项目地址是自建部署镜像
const ipProjectUrl = 'https://hub.docker.com/r/aprilming/ipip'

// ---- 关于页：隐私承诺（内容组件化，欢迎页 / 弹窗共用同一份文案） ----
const privacyDialogVisible = ref(false)

const settingStore = useSettingStore()

/** 实际生效的 IP 查询地址：通用设置里填了合法地址就用它，否则用默认 */
const ipApiUrlEffective = computed(() => normalizeIpApiUrl(settingStore.settings.ipApiUrl))
const { currentTheme, isDark } = useTheme()
const assistantsStore = useAssistantsStore()
const { t, locale } = useI18n()

// 默认笔记背景色（和编辑器右下角的笔记底色共用同一套色板）
const noteBgColors = computed(() => (isDark() ? DARK_NOTE_COLORS : LIGHT_NOTE_COLORS))
/** 贴边小白条的预设颜色（白 / 浅灰 / 蓝 / 深灰），其余走自定义取色器 */
const edgeStripPresets = ['#ffffff', '#c8ccd4', '#3b82f6', '#1f2329']
const defaultNoteBgName = computed(() => {
  const color = settingStore.settings.defaultNoteBackgroundColor
  if (!color) return t('colorPicker.default')
  const preset = noteBgColors.value.find(c => c.value.toLowerCase() === color.toLowerCase())
  return preset ? t(preset.nameKey) : color.toUpperCase()
})

function setDefaultNoteBg(color: string | undefined) {
  settingStore.updateSettings('defaultNoteBackgroundColor', color ?? '')
}

function onDefaultNoteBgInput(e: Event) {
  const value = (e.target as HTMLInputElement).value
  if (value) setDefaultNoteBg(value)
}

// 分类导航
type CategoryKey = 'general' | 'fileTree' | 'ai' | 'sidebar' | 'shortcuts' | 'about'
const activeCategory = ref<CategoryKey>('general')

const categories = computed(() => [
  { key: 'general' as const, icon: 'i-mdi-tune', label: t('settings.general') },
  { key: 'fileTree' as const, icon: 'i-mdi-file-tree-outline', label: t('settings.fileTree') },
  { key: 'ai' as const, icon: 'i-mdi-robot', label: t('settings.ai') },
  { key: 'sidebar' as const, icon: 'i-mdi-dock-right', label: t('settings.sidebar') },
  { key: 'shortcuts' as const, icon: 'i-mdi-keyboard', label: t('settings.shortcuts') },
  { key: 'about' as const, icon: 'i-mdi-information-outline', label: t('settings.about') },
])

/** 当前分类名（顶部标题居中显示） */
const currentCategoryLabel = computed(
  () => categories.value.find(cat => cat.key === activeCategory.value)?.label ?? t('settings.title'),
)

/** 边缘面板贴边方向选项 */
const edgePositionOptions = computed(() => [
  { value: 'right' as const, label: t('settings.edgePosRight') },
  { value: 'left' as const, label: t('settings.edgePosLeft') },
  { value: 'top' as const, label: t('settings.edgePosTop') },
  { value: 'bottom' as const, label: t('settings.edgePosBottom') },
])

/** 当前贴边方向的名字，显示在位置选择器标题后面 */
// ---------------- 钉在桌面的笔记卡片 ----------------
const desktopNotes = useDesktopNotes()

function setDesktopNoteLevel(level: DesktopNoteLevel) {
  settingStore.updateSettings('desktopNoteLevel', level)
  // 已经开着的卡片也立刻换层级
  void desktopNotes.applyLevel()
}

const currentEdgePositionLabel = computed(
  () => edgePositionOptions.value.find(p => p.value === settingStore.settings.edgePosition)?.label ?? '',
)

watch(activeCategory, (category) => {
  // 只读探测：权限状态 + 各落点状态，不会自动创建链接
  if (category === 'ai') {
    void checkFullDiskAccess()
    void loadSkillSync()
  }
  if (category !== 'ai') {
    stopFdaPolling()
  }
})

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
  } else if (key === '\\') {
    keyMatch = e.code === 'Backslash'
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

/** Esc 返回主页面：录制快捷键、确认弹窗开着时，Esc 先归它们用 */
function handleExitKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (recordingKey.value) return
  if (document.querySelector('.confirm-mask')) return
  e.preventDefault()
  goBack()
}

onMounted(() => {
  window.addEventListener('keydown', blockNoteShortcuts, true)
  window.addEventListener('keydown', handleExitKeydown)
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
})

onUnmounted(() => {
  window.removeEventListener('keydown', blockNoteShortcuts, true)
  window.removeEventListener('keydown', handleExitKeydown)
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  stopFdaPolling()
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
/** 快捷键页展示的项（边缘面板快捷键挪到「侧边栏」分类里） */
const mainShortcutLabels = computed(() => {
  const all = shortcutLabels.value
  return Object.fromEntries(
    Object.entries(all).filter(([key]) => key !== 'edgePanel'),
  ) as Record<keyof ShortcutSettings, string>
})

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
  toggleSidebar: t('shortcut.toggleSidebar'),
  edgePanel: t('shortcut.edgePanel'),
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
  toggleSidebar: t('shortcut.toggleSidebarDesc'),
  edgePanel: t('shortcut.edgePanelDesc'),
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
      case 'Backslash': keyName = '\\'; break
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

// ==================== 完全磁盘访问 ====================
// 系统不给程序自己授权的口子，这里只做：检测 → 跳系统设置 → 轮询等待用户勾选
interface FdaProbe {
  path: string
  result: 'ok' | 'denied' | 'missing'
}

interface FullDiskAccessInfo {
  granted: boolean
  detectable: boolean
  probes: FdaProbe[]
  appPath: string
  exePath: string
  bundled: boolean
  parentApp: string | null
}

const fdaInfo = ref<FullDiskAccessInfo | null>(null)
const fdaPolling = ref(false)
let fdaTimer: number | undefined

async function checkFullDiskAccess() {
  if (!isTauri) return
  try {
    fdaInfo.value = await invoke<FullDiskAccessInfo>('full_disk_access_status')
  } catch (e) {
    console.error('Failed to check full disk access:', e)
    fdaInfo.value = null
  }
}

function stopFdaPolling() {
  if (fdaTimer !== undefined) {
    window.clearInterval(fdaTimer)
    fdaTimer = undefined
  }
  fdaPolling.value = false
}

function startFdaPolling() {
  stopFdaPolling()
  fdaPolling.value = true
  let ticks = 0
  fdaTimer = window.setInterval(async () => {
    ticks += 1
    await checkFullDiskAccess()
    // 勾上之后系统不用重启进程就能生效，最多等 60 秒
    if (fdaInfo.value?.granted || ticks >= 40) stopFdaPolling()
  }, 1500)
}

async function openFdaSettings() {
  try {
    await invoke('open_full_disk_access_settings')
    startFdaPolling()
  } catch (e) {
    showToast(String(e), 3000)
  }
}

async function revealAppInFinder() {
  try {
    await invoke('reveal_app_in_finder')
  } catch (e) {
    showToast(String(e), 3000)
  }
}

function fdaStateText(): string {
  if (!fdaInfo.value) return t('settings.fdaUnknown')
  if (fdaInfo.value.granted) return t('settings.fdaGranted')
  return fdaPolling.value ? t('settings.fdaWaiting') : t('settings.fdaDenied')
}

// 开发态由 WebStorm / 终端拉起，TCC 会把权限记到那个 App 名下
// 正式包里只有 fdaHint；开发态才提示「权限记在宿主程序名下」
const fdaHintText = computed(() => {
  const info = fdaInfo.value
  if (info && !info.bundled) {
    return info.parentApp
      ? t('settings.fdaHintDev', { app: info.parentApp })
      : t('settings.fdaHintDevGeneric')
  }
  return t('settings.fdaHint')
})

const fdaPathText = computed(() =>
  fdaInfo.value ? prettyPath(fdaInfo.value.bundled ? fdaInfo.value.appPath : fdaInfo.value.exePath) : '',
)

async function restartApp() {
  try {
    await invoke('restart_app')
  } catch (e) {
    showToast(String(e), 3000)
  }
}

// ==================== Skill 软链接同步 ====================
// 只读状态 + 手动点击建链，不在启动或切换分类时写入任何目录
interface SkillTargetInfo {
  key: string
  label: string
  path: string
  state: 'linked' | 'missing' | 'foreign' | 'occupied'
  detail?: string | null
}

interface SkillSyncInfo {
  skillName: string
  source: string
  sourceExists: boolean
  targets: SkillTargetInfo[]
}

const skillSync = ref<SkillSyncInfo | null>(null)
const skillBusyKey = ref('')
const skillLoadError = ref('')

function prettyPath(path: string): string {
  if (!path) return '—'
  return path.replace(/^\/Users\/[^/]+/, '~')
}

function skillStateLabel(state: string): string {
  switch (state) {
    case 'linked':
      return t('settings.skillStateLinked')
    case 'foreign':
      return t('settings.skillStateForeign')
    case 'occupied':
      return t('settings.skillStateOccupied')
    default:
      return t('settings.skillStateMissing')
  }
}

async function loadSkillSync() {
  if (!isTauri) return
  try {
    skillSync.value = await invoke<SkillSyncInfo>('skill_sync_status')
    skillLoadError.value = ''
  } catch (e) {
    console.error('Failed to read skill sync status:', e)
    skillSync.value = null
    skillLoadError.value = String(e)
  }
}

async function handleSkillLink(target: SkillTargetInfo) {
  if (skillBusyKey.value) return
  skillBusyKey.value = target.key
  try {
    skillSync.value = await invoke<SkillSyncInfo>('skill_sync_link', { key: target.key })
    showToast(t('settings.skillLinked', { name: target.label }))
  } catch (e) {
    console.error('Failed to link skill:', e)
    showToast(String(e), 3000)
    void loadSkillSync()
  } finally {
    skillBusyKey.value = ''
  }
}

async function handleSkillUnlink(target: SkillTargetInfo) {
  if (skillBusyKey.value) return
  skillBusyKey.value = target.key
  try {
    skillSync.value = await invoke<SkillSyncInfo>('skill_sync_unlink', { key: target.key })
    showToast(t('settings.skillUnlinked'))
  } catch (e) {
    console.error('Failed to unlink skill:', e)
    showToast(String(e), 3000)
  } finally {
    skillBusyKey.value = ''
  }
}
</script>

<template>
  <div class="settings-page" :class="{ 'is-dark': isDark() }" @keydown="handleKeydown" @keyup="cancelRecording" tabindex="0">
    <div class="settings-header" @mousedown="startDrag">
      <button class="back-btn" @click="goBack">
        <i class="i-mdi-arrow-left"></i>
      </button>
      <h1 class="settings-title">{{ currentCategoryLabel }}</h1>
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

          <div class="setting-item setting-item-inline">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.linkPreview') }}</span>
              <span class="setting-desc">{{ $t('settings.linkPreviewDesc') }}</span>
            </div>
            <button
              class="toggle-btn"
              :class="{ active: settingStore.settings.linkPreviewEnabled }"
              @click="settingStore.updateSettings('linkPreviewEnabled', !settingStore.settings.linkPreviewEnabled)"
            >
              <span class="toggle-slider"></span>
            </button>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.desktopNoteLevel') }}</span>
              <span class="setting-desc">{{ $t('settings.desktopNoteLevelDesc') }}</span>
            </div>
            <div class="theme-selector">
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.desktopNoteLevel === 'top' }"
                @click="setDesktopNoteLevel('top')"
              >
                <i class="i-mdi-arrow-up-bold-box"></i>
                <span>{{ $t('settings.levelTop') }}</span>
              </button>
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.desktopNoteLevel === 'normal' }"
                @click="setDesktopNoteLevel('normal')"
              >
                <i class="i-mdi-window-restore"></i>
                <span>{{ $t('settings.levelNormal') }}</span>
              </button>
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.desktopNoteLevel === 'desktop' }"
                @click="setDesktopNoteLevel('desktop')"
              >
                <i class="i-mdi-monitor"></i>
                <span>{{ $t('settings.levelDesktop') }}</span>
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
              :style="{ '--fill': `${((settingStore.settings.windowAlpha - 0.6) / 0.4) * 100}%` }"
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
              :style="{ '--fill': `${((settingStore.settings.fontSize - 10) / 22) * 100}%` }"
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
              :style="{ '--fill': `${((settingStore.settings.tabSize - 1) / 11) * 100}%` }"
            />
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.noteBorderWidth') }}</span>
              <span class="setting-desc">{{ $t('settings.noteBorderWidthDesc') }}</span>
              <span class="setting-value">{{ settingStore.settings.noteBorderWidth }}px</span>
            </div>
            <input
              type="range"
              min="0"
              max="10"
              step="1"
              :value="settingStore.settings.noteBorderWidth"
              @input="settingStore.updateSettings('noteBorderWidth', parseInt(($event.target as HTMLInputElement).value))"
              class="alpha-slider"
              :style="{ '--fill': `${(settingStore.settings.noteBorderWidth / 10) * 100}%` }"
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

          <div class="setting-item setting-item-inline">
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

          <div class="setting-item setting-item-inline">
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

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.defaultNoteBg') }}</span>
              <span class="setting-value">{{ defaultNoteBgName }}</span>
            </div>
            <span class="setting-desc">{{ $t('settings.defaultNoteBgDesc') }}</span>
            <div class="note-bg-grid">
              <button
                class="note-bg-chip note-bg-chip-none"
                :class="{ active: !settingStore.settings.defaultNoteBackgroundColor }"
                :title="$t('colorPicker.default')"
                @click="setDefaultNoteBg(undefined)"
              >
                <i class="i-mdi-close"></i>
              </button>
              <button
                v-for="color in noteBgColors"
                :key="color.value"
                class="note-bg-chip"
                :class="{ active: settingStore.settings.defaultNoteBackgroundColor.toLowerCase() === color.value.toLowerCase() }"
                :style="{ background: color.value }"
                :title="$t(color.nameKey)"
                @click="setDefaultNoteBg(color.value)"
              ></button>
              <label class="note-bg-chip note-bg-chip-custom" :title="$t('colorPicker.customColor')">
                <i class="i-mdi-palette-outline"></i>
                <input
                  type="color"
                  class="note-bg-input"
                  :value="settingStore.settings.defaultNoteBackgroundColor || '#fff9e6'"
                  @change="onDefaultNoteBgInput"
                />
              </label>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.ipApiUrl') }}</span>
              <span v-if="ipApiUrlEffective === DEFAULT_IP_API_URL" class="setting-value">{{ $t('settings.ipApiUrlDefault') }}</span>
            </div>
            <span class="setting-desc">{{ $t('settings.ipApiUrlDesc') }}</span>
            <input
              type="text"
              class="text-input"
              :value="settingStore.settings.ipApiUrl"
              :placeholder="DEFAULT_IP_API_URL"
              spellcheck="false"
              @change="settingStore.updateSettings('ipApiUrl', ($event.target as HTMLInputElement).value)"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
            <button
              class="link-btn"
              type="button"
              :disabled="ipApiUrlEffective === DEFAULT_IP_API_URL"
              @click="settingStore.updateSettings('ipApiUrl', DEFAULT_IP_API_URL)"
            >
              <i class="i-mdi-restore"></i>
              <span>{{ $t('settings.ipApiUrlReset') }}</span>
            </button>
          </div>

        </section>

        <!-- 文件树（左侧导航栏） -->
        <section v-if="activeCategory === 'fileTree'" class="settings-section">
          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.pathClickAction') }}</span>
              <span class="setting-desc">{{ $t('settings.pathClickActionDesc') }}</span>
            </div>
            <div class="theme-selector">
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.pathClickAction === 'copy' }"
                @click="settingStore.updateSettings('pathClickAction', 'copy')"
              >
                <i class="i-mdi-content-copy"></i>
                <span>{{ $t('settings.pathClickCopy') }}</span>
              </button>
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.pathClickAction === 'reveal' }"
                @click="settingStore.updateSettings('pathClickAction', 'reveal')"
              >
                <i class="i-mdi-folder-open-outline"></i>
                <span>{{ $t('settings.pathClickReveal') }}</span>
              </button>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.treeOrder') }}</span>
              <span class="setting-desc">{{ $t('settings.treeOrderDesc') }}</span>
            </div>
            <div class="theme-selector">
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.treeOrder === 'folders' }"
                @click="settingStore.updateSettings('treeOrder', 'folders')"
              >
                <i class="i-mdi-folder-outline"></i>
                <span>{{ $t('settings.treeOrderFolders') }}</span>
              </button>
              <button
                class="theme-btn"
                :class="{ active: settingStore.settings.treeOrder === 'files' }"
                @click="settingStore.updateSettings('treeOrder', 'files')"
              >
                <i class="i-mdi-file-document-outline"></i>
                <span>{{ $t('settings.treeOrderFiles') }}</span>
              </button>
            </div>
          </div>

          <div class="setting-item setting-item-inline">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.fileTreePinnedSection') }}</span>
              <span class="setting-desc">{{ $t('settings.fileTreePinnedSectionDesc') }}</span>
            </div>
            <button
              class="toggle-btn"
              :class="{ active: settingStore.settings.fileTreePinnedSection !== false }"
              @click="settingStore.updateSettings('fileTreePinnedSection', !settingStore.settings.fileTreePinnedSection)"
            >
              <span class="toggle-slider"></span>
            </button>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.fileTreeFontSize') }}</span>
              <span class="setting-value">{{ settingStore.settings.fileTreeFontSize }}px</span>
              <span class="setting-desc">{{ $t('settings.fileTreeFontSizeDesc') }}</span>
            </div>
            <input
              type="range"
              min="11"
              max="18"
              step="0.5"
              :value="settingStore.settings.fileTreeFontSize"
              @input="settingStore.updateSettings('fileTreeFontSize', parseFloat(($event.target as HTMLInputElement).value))"
              class="alpha-slider"
              :style="{ '--fill': `${((settingStore.settings.fileTreeFontSize - 11) / 7) * 100}%` }"
            />
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

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.fdaTitle') }}</span>
              <span class="setting-desc">{{ $t('settings.fdaDesc') }}</span>
            </div>
            <div class="fda-row">
              <span
                class="fda-badge"
                :class="{
                  'is-granted': fdaInfo?.granted,
                  'is-waiting': fdaPolling && !fdaInfo?.granted,
                }"
              >
                <i :class="fdaInfo?.granted ? 'i-mdi-shield-check' : 'i-mdi-shield-alert-outline'"></i>
                {{ fdaStateText() }}
              </span>
              <button class="fda-btn" @click="openFdaSettings">
                <i class="i-mdi-cog-outline"></i>
                <span>{{ $t('settings.fdaOpenSettings') }}</span>
              </button>
              <button class="fda-btn fda-btn-primary" @click="restartApp">
                <i class="i-mdi-restart"></i>
                <span>{{ $t('settings.fdaRestart') }}</span>
              </button>
              <button class="fda-btn" @click="checkFullDiskAccess" :title="$t('settings.fdaRecheck')">
                <i class="i-mdi-refresh"></i>
              </button>
              <button class="fda-btn" @click="revealAppInFinder" :title="fdaPathText">
                <i class="i-mdi-apple-finder"></i>
                <span>{{ $t('settings.fdaReveal') }}</span>
              </button>
            </div>
            <div class="fda-hint">{{ fdaHintText }}</div>
            <div v-if="fdaInfo" class="fda-path">
              {{ fdaPathText }}
              <span class="fda-probes">
                <span
                  v-for="p in fdaInfo.probes"
                  :key="p.path"
                  class="fda-probe"
                  :class="`is-${p.result}`"
                  :title="p.path"
                ></span>
              </span>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.skillSync') }}</span>
              <span class="setting-desc">{{ $t('settings.skillSyncDesc') }}</span>
            </div>

            <div v-if="skillSync" class="skill-sync-list">
              <div v-for="target in skillSync.targets" :key="target.key" class="skill-sync-row">
                <div class="skill-sync-main">
                  <div class="skill-sync-name">
                    <span>{{ target.label }}</span>
                    <span class="skill-sync-state" :class="`is-${target.state}`">
                      {{ skillStateLabel(target.state) }}
                    </span>
                  </div>
                  <div class="skill-sync-path" :title="target.path">{{ prettyPath(target.path) }}</div>
                  <div v-if="target.state === 'foreign' && target.detail" class="skill-sync-hint">
                    → {{ prettyPath(target.detail) }}
                  </div>
                </div>
                <button
                  v-if="target.state === 'linked'"
                  class="skill-sync-btn is-linked"
                  :disabled="!!skillBusyKey"
                  @click="handleSkillUnlink(target)"
                >
                  <i class="i-mdi-link-off"></i>
                  <span>{{ skillBusyKey === target.key ? '…' : $t('settings.skillUnlink') }}</span>
                </button>
                <button
                  v-else
                  class="skill-sync-btn"
                  :disabled="!!skillBusyKey || !skillSync.sourceExists"
                  @click="handleSkillLink(target)"
                >
                  <i class="i-mdi-link-variant"></i>
                  <span>{{ skillBusyKey === target.key ? '…' : $t('settings.skillLink') }}</span>
                </button>
              </div>
            </div>
            <div v-else class="skill-sync-empty">
              {{ skillLoadError || $t('settings.skillSyncLoading') }}
            </div>

            <div class="skill-sync-source" :class="{ 'is-missing': skillSync && !skillSync.sourceExists }">
              <i class="i-mdi-file-document-outline"></i>
              <span>{{ skillSync && !skillSync.sourceExists ? $t('settings.skillSourceMissing') : $t('settings.skillSource') }}</span>
              <span class="skill-sync-source-path">{{ prettyPath(skillSync?.source || '') }}</span>
            </div>
          </div>
        </section>

        <!-- 侧边栏（屏幕边缘面板） -->
        <section v-if="activeCategory === 'sidebar'" class="settings-section">
          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.edgeEnabled') }}</span>
              <span class="setting-desc">{{ $t('settings.edgeEnabledDesc') }}</span>
            </div>
            <button
              class="toggle-btn"
              :class="{ active: settingStore.settings.edgeEnabled }"
              @click="settingStore.updateSettings('edgeEnabled', !settingStore.settings.edgeEnabled)"
            >
              <span class="toggle-slider"></span>
            </button>
          </div>

          <div class="setting-item" :class="{ 'is-muted-item': !settingStore.settings.edgeEnabled }">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.edgePosition') }}</span>
              <span class="setting-value">{{ currentEdgePositionLabel }}</span>
              <span class="setting-desc">{{ $t('settings.edgePositionDesc') }}</span>
            </div>
            <div class="edge-side-picker">
              <div class="edge-side-screen"></div>
              <button
                v-for="pos in edgePositionOptions"
                :key="pos.value"
                type="button"
                class="edge-side-hit"
                :class="[`hit-${pos.value}`, { active: settingStore.settings.edgePosition === pos.value }]"
                :title="pos.label"
                @click="settingStore.updateSettings('edgePosition', pos.value)"
              >
                <span class="edge-side-bar"></span>
              </button>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.edgeWidth') }}</span>
              <span class="setting-value">{{ settingStore.settings.edgeWidth }}px</span>
              <span class="setting-desc">{{ $t('settings.edgeWidthDesc') }}</span>
            </div>
            <input
              type="range"
              min="220"
              max="640"
              step="10"
              :value="settingStore.settings.edgeWidth"
              @input="settingStore.updateSettings('edgeWidth', parseInt(($event.target as HTMLInputElement).value))"
              class="alpha-slider"
              :style="{ '--fill': `${((settingStore.settings.edgeWidth - 220) / 420) * 100}%` }"
            />
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.edgeTriggerSpan') }}</span>
              <span class="setting-value">{{ settingStore.settings.edgeTriggerSpan }}%</span>
              <span class="setting-desc">{{ $t('settings.edgeTriggerSpanDesc') }}</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              :value="settingStore.settings.edgeTriggerSpan"
              @input="settingStore.updateSettings('edgeTriggerSpan', parseInt(($event.target as HTMLInputElement).value))"
              class="alpha-slider"
              :style="{ '--fill': `${((settingStore.settings.edgeTriggerSpan - 10) / 90) * 100}%` }"
            />
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.edgeStripWidth') }}</span>
              <span class="setting-value">{{ settingStore.settings.edgeStripWidth }}px</span>
              <span class="setting-desc">{{ $t('settings.edgeStripWidthDesc') }}</span>
            </div>
            <input
              type="range"
              min="3"
              max="16"
              step="1"
              :value="settingStore.settings.edgeStripWidth"
              @input="settingStore.updateSettings('edgeStripWidth', parseInt(($event.target as HTMLInputElement).value))"
              class="alpha-slider"
              :style="{ '--fill': `${((settingStore.settings.edgeStripWidth - 3) / 13) * 100}%` }"
            />
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.edgeStripColor') }}</span>
              <span class="setting-value">{{ settingStore.settings.edgeStripColor.toUpperCase() }}</span>
              <span class="setting-desc">{{ $t('settings.edgeStripColorDesc') }}</span>
            </div>
            <div class="note-bg-grid">
              <button
                v-for="color in edgeStripPresets"
                :key="color"
                class="note-bg-chip"
                :class="{ active: settingStore.settings.edgeStripColor.toLowerCase() === color.toLowerCase() }"
                :style="{ background: color }"
                :title="color"
                @click="settingStore.updateSettings('edgeStripColor', color)"
              ></button>
              <label class="note-bg-chip note-bg-chip-custom" :title="$t('colorPicker.customColor')">
                <i class="i-mdi-palette-outline"></i>
                <input
                  type="color"
                  class="note-bg-input"
                  :value="settingStore.settings.edgeStripColor"
                  @change="settingStore.updateSettings('edgeStripColor', ($event.target as HTMLInputElement).value)"
                />
              </label>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.edgeAutoHide') }}</span>
              <span class="setting-desc">{{ $t('settings.edgeAutoHideDesc') }}</span>
            </div>
            <button
              class="toggle-btn"
              :class="{ active: settingStore.settings.edgeAutoHide }"
              @click="settingStore.updateSettings('edgeAutoHide', !settingStore.settings.edgeAutoHide)"
            >
              <span class="toggle-slider"></span>
            </button>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span class="setting-name">{{ $t('settings.edgeCopyOnSelect') }}</span>
              <span class="setting-desc">{{ $t('settings.edgeCopyOnSelectDesc') }}</span>
            </div>
            <button
              class="toggle-btn"
              :class="{ active: settingStore.settings.edgeCopyOnSelect }"
              @click="settingStore.updateSettings('edgeCopyOnSelect', !settingStore.settings.edgeCopyOnSelect)"
            >
              <span class="toggle-slider"></span>
            </button>
          </div>

          <div class="shortcut-item" :class="{ recording: recordingKey === 'edgePanel' }" @click="startRecording('edgePanel')">
            <div class="shortcut-info">
              <span class="shortcut-label">{{ shortcutLabels.edgePanel }}</span>
              <span class="shortcut-desc">{{ shortcutDescs.edgePanel }}</span>
            </div>
            <div class="shortcut-value">
              <span v-if="recordingKey === 'edgePanel'" class="recording-text">{{ $t('settings.recording') }}</span>
              <span v-else-if="!settingStore.settings.shortcuts.edgePanel" class="shortcut-key shortcut-key-empty">
                {{ $t('settings.shortcutEmpty') }}
              </span>
              <span v-else class="shortcut-key">{{ settingStore.settings.shortcuts.edgePanel }}</span>
              <button
                v-if="recordingKey !== 'edgePanel' && settingStore.settings.shortcuts.edgePanel"
                class="shortcut-action-btn"
                type="button"
                :title="$t('settings.shortcutClear')"
                @click.stop="clearShortcut('edgePanel', $event)"
              >
                <i class="i-mdi-close-circle"></i>
              </button>
              <i v-if="recordingKey !== 'edgePanel'" class="i-mdi-pencil edit-icon"></i>
            </div>
          </div>
        </section>

        <!-- 快捷键 -->
        <section v-if="activeCategory === 'shortcuts'" class="settings-section shortcuts-section">
          <div class="shortcut-list">
            <template v-for="(label, key) in mainShortcutLabels" :key="key">
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

          <!-- IP 助手：编辑器里 /ip 用到的出口 IP 查询来源 -->
          <div class="ip-card">
            <div class="ip-card-head">
              <i class="i-mdi-web"></i>
              <span>{{ $t('settings.ipAssistantTitle') }}</span>
            </div>
            <p class="ip-card-desc">{{ $t('settings.ipAssistantDesc') }}</p>
            <div class="ip-card-links">
              <a class="ip-card-link" :href="ipApiUrlEffective" target="_blank" rel="noreferrer">
                <i class="i-mdi-link-variant"></i>
                <span class="ip-card-label">{{ $t('settings.ipAssistantApi') }}</span>
                <code class="ip-card-url">{{ ipApiUrlEffective }}</code>
                <i class="i-mdi-open-in-new ip-card-open"></i>
              </a>
              <a class="ip-card-link" :href="ipProjectUrl" target="_blank" rel="noreferrer">
                <i class="i-mdi-docker"></i>
                <span class="ip-card-label">{{ $t('settings.ipAssistantProject') }}</span>
                <code class="ip-card-url">{{ ipProjectUrl }}</code>
                <i class="i-mdi-open-in-new ip-card-open"></i>
              </a>
            </div>
          </div>

          <!-- 隐私与承诺 -->
          <div class="privacy-card">
            <div class="privacy-head">
              <i class="i-mdi-shield-check-outline"></i>
              <span>{{ $t('settings.privacyTitle') }}</span>
              <button class="privacy-more" type="button" @click="privacyDialogVisible = true">
                <span>{{ $t('settings.privacyReadMore') }}</span>
                <i class="i-mdi-chevron-right"></i>
              </button>
            </div>
            <PrivacyPledge />
          </div>
        </section>
      </div>
    </div>

    <!-- 隐私说明：关于页里摊开看的完整版 -->
    <PrivacyDialog v-model="privacyDialogVisible" />

    <AssistantEditor
      v-model="assistantEditorVisible"
      :assistant="editingAssistant"
      @save="handleSaveAssistant"
    />
  </div>
</template>

<style scoped>
/* ============================================
   设置页皮肤
   设计口径：毛玻璃面板 + 发丝分隔线 + 单一强调色，
   控件统一成"下沉槽位 / 选中胶囊"两种语言，
   不再用大片灰底托白色卡片。
   ============================================ */

.settings-page {
  /* ---- 页面级令牌（浅色） ---- */
  --st-text: #1d1d1f;
  --st-text-dim: rgba(60, 60, 67, 0.62);
  --st-text-soft: rgba(60, 60, 67, 0.42);
  --st-accent: #007aff;
  --st-accent-2: #0a84ff;
  --st-accent-soft: rgba(0, 122, 255, 0.12);
  --st-accent-line: rgba(0, 122, 255, 0.28);
  --st-panel: #ffffff;
  --st-chip: #ffffff;
  --st-panel-border: rgba(0, 0, 0, 0.055);
  --st-row-line: rgba(0, 0, 0, 0.07);
  --st-sunken: rgba(120, 120, 128, 0.12);
  --st-track: rgba(120, 120, 128, 0.2);
  --st-danger: #ff3b30;
  --st-danger-soft: rgba(255, 59, 48, 0.12);
  --st-danger-line: rgba(255, 59, 48, 0.32);
  --st-hover: rgba(120, 120, 128, 0.16);
  --st-success: #34c759;
  --st-warning: #ff9500;
  --st-inner-light: none;
  --st-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  --st-page-bg: #f2f2f7;
  --st-nav-bg: rgba(120, 120, 128, 0.1);
  --st-nav-active: #ffffff;

  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
  outline: none;
  color: var(--st-text);
  background: var(--st-page-bg);
}

/* ---- 页面级令牌（深色） ---- */
.settings-page.is-dark {
  --st-text: #f2f2f7;
  --st-text-dim: rgba(235, 235, 245, 0.62);
  --st-text-soft: rgba(235, 235, 245, 0.4);
  --st-accent: #0a84ff;
  --st-accent-2: #409cff;
  --st-accent-soft: rgba(10, 132, 255, 0.18);
  --st-accent-line: rgba(10, 132, 255, 0.34);
  --st-panel: #2c2c2e;
  --st-chip: #3a3a3c;
  --st-panel-border: rgba(255, 255, 255, 0.07);
  --st-row-line: rgba(255, 255, 255, 0.08);
  --st-sunken: rgba(120, 120, 128, 0.24);
  --st-track: rgba(120, 120, 128, 0.36);
  --st-danger-soft: rgba(255, 69, 58, 0.18);
  --st-danger-line: rgba(255, 69, 58, 0.38);
  --st-hover: rgba(120, 120, 128, 0.3);
  --st-inner-light: none;
  --st-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  --st-page-bg: #1e1e1e;
  --st-nav-bg: rgba(120, 120, 128, 0.24);
  --st-nav-active: rgba(255, 255, 255, 0.14);
  background: var(--st-page-bg);
}

/* ============ 顶部 ============ */
.settings-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px 9px;
  flex-shrink: 0;
  background: transparent;
  border: none;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: var(--st-sunken);
  color: var(--st-text-dim);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
}

.back-btn:hover {
  background: var(--st-accent-soft);
  color: var(--st-accent);
}

.back-btn:active {
  transform: scale(0.92);
}

.back-btn i {
  font-size: 17px;
}

.settings-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--st-text);
}

/* ============ 主体：左导航 + 右内容 ============ */
.settings-body {
  display: flex;
  flex-direction: column; /* 分类标签横排在上，内容在下方 */
  gap: 10px;
  flex: 1;
  min-height: 0;
  padding: 0 12px 12px;
  overflow: hidden;
}

.settings-nav {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  width: 100%;
  padding: 5px;
  flex-shrink: 0;
  border-radius: 14px;
  background: var(--st-panel);
  border: 1px solid var(--st-panel-border);
  box-shadow: var(--st-shadow), var(--st-inner-light);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  backdrop-filter: blur(18px) saturate(160%);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.settings-nav::-webkit-scrollbar {
  display: none;
}

.settings-nav .nav-item {
  flex: 0 0 auto;
  padding: 6px 12px;
}

/* 横排后选中指示条改成底部短线 */
.settings-nav .nav-item.active::before {
  left: 50%;
  top: auto;
  bottom: 2px;
  width: 16px;
  height: 2px;
  transform: translateX(-50%);
  background: linear-gradient(90deg, var(--st-accent), var(--st-accent-2));
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--st-text-dim);
  font-size: 12.5px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}

.nav-item:hover {
  background: var(--st-sunken);
  color: var(--st-text);
}

.nav-item:active {
  transform: scale(0.98);
}

.nav-item.active {
  background: var(--st-accent-soft);
  color: var(--st-accent);
  box-shadow: inset 0 0 0 1px var(--st-accent-line);
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 2px;
  height: 13px;
  border-radius: 2px;
  transform: translateY(-50%);
  background: linear-gradient(180deg, var(--st-accent), var(--st-accent-2));
}

.nav-item i {
  font-size: 15px;
  flex-shrink: 0;
  opacity: 0.9;
}

.nav-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ============ 右侧内容 ============ */
.settings-content {
  flex: 1;
  min-width: 0;
  padding: 0 2px 20px 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: transparent;
}

.settings-content::-webkit-scrollbar {
  width: 8px;
}

.settings-content::-webkit-scrollbar-thumb {
  background-color: var(--st-row-line);
  background-clip: content-box;
  border: 2px solid transparent;
  border-radius: 999px;
}

.settings-content::-webkit-scrollbar-thumb:hover {
  background-color: var(--st-track);
}

/* 一张面板装一组设置，行之间只用发丝线分隔 */
.settings-section {
  border-radius: 14px;
  background: var(--st-panel);
  border: 1px solid var(--st-panel-border);
  box-shadow: var(--st-shadow), var(--st-inner-light);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  backdrop-filter: blur(20px) saturate(160%);
  overflow: hidden;
}

.settings-section.shortcuts-section {
  background: none;
  border: none;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  overflow: visible;
}

.setting-item {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 12px 14px;
  background: transparent;
  border-radius: 0;
  margin-bottom: 0;
  transition: background var(--duration-fast) var(--ease-out);
}

.setting-item + .setting-item {
  border-top: 1px solid var(--st-row-line);
}

/* 单控件行：标题在左、开关在右 */
.setting-item-inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

/* 右侧有开关时，标题块要撑满剩余宽度，否则说明文字被挤成两行 */
.setting-item-inline > .setting-label {
  flex: 1 1 auto;
  min-width: 0;
}

.setting-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.setting-name {
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--st-text);
}

.setting-value {
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--st-sunken);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--st-text-dim);
}

.setting-desc {
  font-size: 11px;
  line-height: 1.5;
  color: var(--st-text-soft);
}

.setting-label > .setting-desc {
  max-width: 58%;
  text-align: right;
}

/* 带开关的行：说明文字保持单行，放不下就省略，不折行 */
.setting-item-inline > .setting-label > .setting-desc {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ============ 滑杆 ============ */
.alpha-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 5px;
  border-radius: 999px;
  outline: none;
  cursor: pointer;
  background: linear-gradient(
    90deg,
    var(--st-accent) 0 var(--fill, 0%),
    var(--st-track) var(--fill, 0%) 100%
  );
}

.alpha-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 0.5px rgba(16, 24, 40, 0.2), 0 1px 4px rgba(16, 24, 40, 0.3);
  transition: transform var(--duration-fast) var(--ease-out);
}

.alpha-slider:hover::-webkit-slider-thumb {
  transform: scale(1.12);
}

.alpha-slider:active::-webkit-slider-thumb {
  transform: scale(0.96);
}

/* ============ 开关 ============ */
.toggle-btn {
  position: relative;
  flex: 0 0 auto;
  width: 42px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 12px;
  background: var(--st-track);
  cursor: pointer;
  transition: background var(--duration-normal) var(--ease-out),
              box-shadow var(--duration-normal) var(--ease-out);
}

.toggle-btn.active {
  background: linear-gradient(135deg, var(--st-accent), var(--st-accent-2));
  box-shadow: 0 2px 8px -3px var(--st-accent-line);
}

.toggle-slider {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.3), 0 0 0 0.5px rgba(16, 24, 40, 0.06);
  transition: transform var(--duration-normal) var(--ease-out);
}

.toggle-btn.active .toggle-slider {
  transform: translateX(18px);
}

.toggle-btn:active .toggle-slider {
  transform: scale(0.92);
}

.toggle-btn.active:active .toggle-slider {
  transform: translateX(18px) scale(0.92);
}

/* ============ 分段选择器 ============ */
.theme-selector {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: var(--st-sunken);
  box-shadow: inset 0 1px 2px rgba(16, 24, 40, 0.05);
}

.theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--st-text-dim);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.theme-btn:hover {
  color: var(--st-text);
}

.theme-btn:active {
  transform: scale(0.97);
}

.theme-btn.active {
  background: var(--st-chip);
  color: var(--st-text);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.1), 0 0 0 0.5px rgba(16, 24, 40, 0.05);
}

.theme-btn.active i {
  color: var(--st-accent);
}

.theme-btn i {
  font-size: 14px;
}

/* ============ 代码主题 ============ */
.code-theme-selector {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}

.code-theme-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 9px 4px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--st-sunken);
  color: var(--st-text-dim);
  font-size: 10.5px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}

.code-theme-btn:hover {
  background: var(--st-chip);
  color: var(--st-text);
}

.code-theme-btn:active {
  transform: scale(0.97);
}

.code-theme-btn.active {
  background: var(--st-accent-soft);
  border-color: var(--st-accent-line);
  color: var(--st-accent);
}

.code-theme-btn i {
  font-size: 17px;
}

/* ============ 编辑器样式预设 ============ */
.preset-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preset-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 60px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--st-sunken);
  color: var(--st-text-dim);
  font-size: 10.5px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}

.preset-btn:hover {
  background: var(--st-chip);
  color: var(--st-text);
}

.preset-btn:active {
  transform: scale(0.97);
}

.preset-btn.active {
  background: var(--st-accent-soft);
  border-color: var(--st-accent-line);
  color: var(--st-accent);
}

.preset-preview {
  display: flex;
  gap: 4px;
}

.preset-dot {
  width: 16px;
  height: 16px;
  border-radius: 5px;
  border: 1.5px solid;
}

.preset-label {
  font-size: 10.5px;
  white-space: nowrap;
}

.custom-dot {
  background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red) !important;
  border: 1.5px solid rgba(128, 128, 128, 0.4) !important;
}

/* ============ 自定义配色面板 ============ */
.custom-colors-section {
  margin: 10px;
  padding: 11px 12px 12px;
  border-radius: 12px;
  background: var(--st-sunken);
  border: 1px solid var(--st-row-line);
}

.custom-colors-title {
  margin-bottom: 9px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--st-text-dim);
}

.custom-colors-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.custom-colors-header {
  display: grid;
  grid-template-columns: 1fr 52px 52px;
  gap: 8px;
  align-items: center;
  margin-bottom: 2px;
}

.custom-mode-label {
  font-size: 10px;
  color: var(--st-text-soft);
  text-align: center;
}

.custom-group-title {
  margin-top: 6px;
  padding: 7px 0 3px;
  border-top: 1px solid var(--st-row-line);
  font-size: 11px;
  font-weight: 500;
  color: var(--st-text);
}

.custom-color-row {
  display: grid;
  grid-template-columns: 1fr 52px 52px;
  gap: 8px;
  align-items: center;
  padding: 2px 0;
}

.custom-color-label {
  font-size: 10.5px;
  color: var(--st-text-dim);
}

.color-input {
  justify-self: center;
  width: 30px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--st-row-line);
  border-radius: 6px;
  background: none;
  cursor: pointer;
}

.color-input::-webkit-color-swatch-wrapper {
  padding: 0;
}

.color-input::-webkit-color-swatch {
  border: none;
  border-radius: 5px;
}

/* ============ 笔记底色 ============ */
.note-bg-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

/* ---------- 侧边栏贴边位置：屏幕示意框，四条边就是四个可点方位 ---------- */
.edge-side-picker {
  position: relative;
  width: 178px;
  height: 112px;
  margin-top: 4px;
  border-radius: 12px;
  background: var(--st-sunken);
  border: 1px solid var(--st-row-line);
}

.edge-side-screen {
  position: absolute;
  inset: 17px;
  border-radius: 7px;
  border: 1px dashed var(--st-row-line);
  background: var(--st-panel);
  pointer-events: none;
}

.edge-side-hit {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.edge-side-bar {
  display: block;
  border-radius: 999px;
  background: var(--st-row-line);
  transition: background var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.edge-side-hit:hover .edge-side-bar {
  background: var(--st-text-dim);
}

.edge-side-hit.active .edge-side-bar {
  background: var(--st-accent);
  box-shadow: 0 0 0 1px var(--st-accent), 0 0 10px -2px var(--st-accent);
}

.edge-side-hit.hit-top,
.edge-side-hit.hit-bottom {
  left: 16px;
  right: 16px;
  height: 16px;
}

.edge-side-hit.hit-top {
  top: 2px;
}

.edge-side-hit.hit-bottom {
  bottom: 2px;
}

.edge-side-hit.hit-top .edge-side-bar,
.edge-side-hit.hit-bottom .edge-side-bar {
  width: 100%;
  height: 4px;
}

.edge-side-hit.hit-left,
.edge-side-hit.hit-right {
  top: 16px;
  bottom: 16px;
  width: 16px;
}

.edge-side-hit.hit-left {
  left: 2px;
}

.edge-side-hit.hit-right {
  right: 2px;
}

.edge-side-hit.hit-left .edge-side-bar,
.edge-side-hit.hit-right .edge-side-bar {
  width: 4px;
  height: 100%;
}

/* 侧边栏总开关关掉时，下面这些外观项淡出显示 */
.is-muted-item {
  opacity: 0.55;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.note-bg-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--st-row-line);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.note-bg-chip:hover {
  transform: translateY(-1px) scale(1.05);
}

.note-bg-chip.active {
  box-shadow: 0 0 0 2px var(--st-panel), 0 0 0 3.5px var(--st-accent);
}

.note-bg-chip i {
  font-size: 13px;
}

.note-bg-chip-none {
  background: var(--st-sunken);
  color: var(--st-text-dim);
}

.note-bg-chip-custom {
  position: relative;
  border: none;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  background: conic-gradient(from 210deg, #ff8a8a, #ffd48a, #a8e6a1, #8ac6ff, #b79bff, #ff8ad0, #ff8a8a);
}

.note-bg-input {
  position: absolute;
  inset: 0;
  padding: 0;
  border: none;
  opacity: 0;
  cursor: pointer;
}

/* ============ 文本输入 ============ */
.text-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--st-row-line);
  border-radius: 9px;
  background: var(--st-sunken);
  font-size: 12.5px;
  color: var(--st-text);
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.text-input:focus {
  background: transparent;
  border-color: var(--st-accent-line);
  box-shadow: 0 0 0 3px var(--st-accent-soft);
}

.text-input::placeholder {
  color: var(--st-text-soft);
}

.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  margin-top: 2px;
  padding: 0;
  border: none;
  background: none;
  font-size: 11px;
  color: var(--st-accent);
  cursor: pointer;
  opacity: 0.85;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.link-btn:hover {
  opacity: 1;
  text-decoration: underline;
}

.link-btn:disabled {
  opacity: 0.38;
  cursor: default;
  text-decoration: none;
}

/* ============ AI 助手 ============ */
.template-assistants {
  display: flex;
  gap: 8px;
}

.template-assistant-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 11px 8px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: var(--st-sunken);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}

.template-assistant-btn:hover {
  background: var(--st-accent-soft);
  border-color: var(--st-accent-line);
}

.template-assistant-btn:active {
  transform: scale(0.98);
}

.template-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--st-text);
}

.user-assistants {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.assistant-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 11px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: var(--st-sunken);
  transition: background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}

.assistant-card:hover {
  background: var(--st-chip);
  border-color: var(--st-panel-border);
}

.assistant-info {
  flex: 1;
  min-width: 0;
}

.assistant-name {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
  font-size: 12px;
  font-weight: 500;
  color: var(--st-text);
}

.assistant-name i {
  font-size: 14px;
  color: var(--st-accent);
}

.assistant-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--st-text-soft);
}

.assistant-actions {
  display: flex;
  gap: 2px;
  margin-left: 8px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--st-text-dim);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
}

.action-btn i {
  font-size: 14px;
}

.action-btn:active {
  transform: scale(0.9);
}

.edit-btn:hover,
.search-btn:hover {
  background: var(--st-accent-soft);
  color: var(--st-accent);
}

.search-btn.active {
  color: var(--st-accent);
}

.delete-btn:hover {
  background: color-mix(in srgb, var(--st-danger) 12%, transparent);
  color: var(--st-danger);
}

.add-assistant-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 10px;
  border: 1px dashed var(--st-panel-border);
  border-radius: 11px;
  background: transparent;
  color: var(--st-text-dim);
  font-size: 12px;
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.add-assistant-btn:hover {
  border-color: var(--st-accent-line);
  background: var(--st-accent-soft);
  color: var(--st-accent);
}

.add-assistant-btn:active {
  transform: scale(0.99);
}

.add-assistant-btn i {
  font-size: 15px;
}

/* ============ 完全磁盘访问 ============ */
.fda-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.fda-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 8px;
  border: 1px solid var(--st-row-line);
  background: var(--st-sunken);
  font-size: 11px;
  font-weight: 500;
  color: var(--st-text-soft);
}

.fda-badge.is-granted {
  color: var(--st-success);
  border-color: rgba(52, 199, 89, 0.35);
  background: rgba(52, 199, 89, 0.12);
}

.fda-badge.is-waiting {
  color: var(--st-warning);
  border-color: rgba(255, 149, 0, 0.35);
  background: rgba(255, 149, 0, 0.12);
}

.fda-badge i {
  font-size: 13px;
}

.fda-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border-radius: 8px;
  border: 1px solid var(--st-row-line);
  background: transparent;
  font-size: 11px;
  color: var(--st-text);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}

.fda-btn:hover {
  background: var(--st-accent-soft);
  border-color: var(--st-accent-line);
  color: var(--st-accent);
}

.fda-btn i {
  font-size: 12px;
}

.fda-btn-primary {
  color: var(--st-accent);
  border-color: var(--st-accent-line);
  background: var(--st-accent-soft);
}

.fda-btn-primary:hover {
  background: var(--st-accent);
  color: #fff;
  border-color: var(--st-accent);
}

.fda-probes {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
  vertical-align: middle;
}

.fda-probe {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--st-row-line);
}

.fda-probe.is-ok {
  background: var(--st-success);
}

.fda-probe.is-denied {
  background: var(--st-danger);
}

.fda-hint {
  margin-top: 6px;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--st-text-soft);
}

.fda-path {
  margin-top: 3px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10px;
  line-height: 1.4;
  color: var(--st-text-soft);
  word-break: break-all;
}

/* ============ Skill 同步 ============ */
.skill-sync-list {
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: var(--st-sunken);
  border: 1px solid var(--st-row-line);
  overflow: hidden;
}

.skill-sync-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border-bottom: 1px solid var(--st-row-line);
}

.skill-sync-row:last-child {
  border-bottom: none;
}

.skill-sync-main {
  flex: 1;
  min-width: 0;
}

.skill-sync-name {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--st-text);
}

.skill-sync-state {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid var(--st-row-line);
  color: var(--st-text-soft);
}

.skill-sync-state.is-linked {
  color: var(--st-accent);
  border-color: var(--st-accent-line);
  background: var(--st-accent-soft);
}

.skill-sync-state.is-foreign,
.skill-sync-state.is-occupied {
  color: var(--st-text);
  border-color: var(--st-row-line);
  background: var(--st-hover);
}

.skill-sync-path,
.skill-sync-hint {
  margin-top: 2px;
  font-size: 10.5px;
  line-height: 1.35;
  color: var(--st-text-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-sync-hint {
  color: var(--st-text);
  opacity: 0.7;
}

.skill-sync-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid var(--st-row-line);
  background: transparent;
  color: var(--st-text);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}

.skill-sync-btn:hover:not(:disabled) {
  background: var(--st-accent-soft);
  border-color: var(--st-accent-line);
  color: var(--st-accent);
}

.skill-sync-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.skill-sync-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.skill-sync-btn.is-linked:hover:not(:disabled) {
  background: var(--st-danger-soft, rgba(255, 90, 90, 0.12));
  border-color: var(--st-danger-line, rgba(255, 90, 90, 0.4));
  color: var(--st-danger, #e05555);
}

.skill-sync-btn i {
  font-size: 12px;
}

.skill-sync-empty {
  padding: 10px 11px;
  font-size: 11px;
  color: var(--st-text-soft);
}

.skill-sync-source {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  font-size: 10.5px;
  color: var(--st-text-soft);
  min-width: 0;
}

.skill-sync-source.is-missing {
  color: var(--st-danger);
}

.skill-sync-source-path {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ============ 快捷键 ============ */
.shortcut-list {
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: var(--st-panel);
  border: 1px solid var(--st-panel-border);
  box-shadow: var(--st-shadow), var(--st-inner-light);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  backdrop-filter: blur(20px) saturate(160%);
  overflow: hidden;
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 14px;
  background: transparent;
  border-radius: 0;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.shortcut-item + .shortcut-item {
  border-top: 1px solid var(--st-row-line);
}

.shortcut-item:hover {
  background: var(--st-sunken);
}

.shortcut-item.recording {
  background: var(--st-accent-soft);
  box-shadow: inset 0 0 0 1px var(--st-accent-line);
}

.shortcut-scope-item {
  padding: 9px 14px;
  background: color-mix(in srgb, var(--st-sunken) 60%, transparent);
  cursor: default;
}

.shortcut-scope-item:hover {
  background: color-mix(in srgb, var(--st-sunken) 60%, transparent);
}

.shortcut-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.shortcut-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--st-text);
}

.shortcut-desc {
  font-size: 11px;
  color: var(--st-text-soft);
}

.shortcut-value {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.shortcut-key {
  padding: 3px 8px;
  border: 1px solid var(--st-row-line);
  border-radius: 7px;
  background: var(--st-sunken);
  box-shadow: inset 0 -1px 0 rgba(16, 24, 40, 0.06);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--st-text);
}

.shortcut-key-empty {
  border-style: dashed;
  background: transparent;
  box-shadow: none;
  font-family: inherit;
  font-style: italic;
  color: var(--st-text-soft);
}

.shortcut-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--st-text-soft);
  font-size: 14px;
  opacity: 0;
  cursor: pointer;
  transition: opacity var(--duration-fast), color var(--duration-fast), background var(--duration-fast);
}

.shortcut-item:hover .shortcut-action-btn {
  opacity: 1;
}

.shortcut-action-btn:hover {
  background: var(--st-sunken);
  color: var(--st-text);
}

.edit-icon {
  font-size: 13px;
  color: var(--st-text-soft);
  opacity: 0;
  transition: opacity var(--duration-fast);
}

.shortcut-item:hover .edit-icon {
  opacity: 1;
}

.scope-switch {
  display: inline-flex;
  flex-shrink: 0;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--st-sunken);
}

.scope-option {
  padding: 4px 9px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--st-text-dim);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.scope-option:hover {
  color: var(--st-text);
}

.scope-option.active {
  background: var(--st-chip);
  color: var(--st-text);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.1);
}

.shortcut-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.reset-all-shortcuts-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px;
  border: 1px solid var(--st-panel-border);
  border-radius: 9px;
  background: var(--st-panel);
  font-size: 11.5px;
  color: var(--st-text-dim);
  cursor: pointer;
  transition: color var(--duration-fast), border-color var(--duration-fast), background var(--duration-fast);
}

.reset-all-shortcuts-btn:hover {
  color: var(--st-accent);
  border-color: var(--st-accent-line);
  background: var(--st-accent-soft);
}

.recording-text {
  font-size: 11.5px;
  color: var(--st-accent);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.recording-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--st-text-soft);
  text-align: center;
}

/* ============ 版本 / 更新 ============ */
.version-item {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.version-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.version-label {
  font-size: 11px;
  color: var(--st-text-soft);
}

.version-number {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--st-text);
}

.check-update-btn {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 13px;
  border: 1px solid var(--st-panel-border);
  border-radius: 9px;
  background: var(--st-sunken);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--st-text);
  cursor: pointer;
  transition: border-color var(--duration-fast), color var(--duration-fast),
              background var(--duration-fast), transform var(--duration-fast);
}

.check-update-btn:hover:not(:disabled) {
  border-color: var(--st-accent-line);
  background: var(--st-accent-soft);
  color: var(--st-accent);
}

.check-update-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.check-update-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.update-available {
  gap: 10px;
  background: color-mix(in srgb, var(--st-accent) 8%, transparent);
  box-shadow: inset 2px 0 0 var(--st-accent);
}

.update-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--st-accent);
}

.update-info i {
  font-size: 15px;
}

.download-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 8px 13px;
  border: none;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--st-accent), var(--st-accent-2));
  font-size: 12px;
  font-weight: 500;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 4px 12px -6px var(--st-accent);
  transition: opacity var(--duration-fast), transform var(--duration-fast);
}

.download-btn:hover:not(:disabled) {
  opacity: 0.92;
  transform: translateY(-1px);
}

.download-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.download-btn i {
  font-size: 14px;
}

.update-error {
  background: color-mix(in srgb, var(--st-warning) 8%, transparent);
  box-shadow: inset 2px 0 0 var(--st-warning);
}

.update-error .update-info {
  color: var(--st-warning);
}

.update-latest {
  background: color-mix(in srgb, var(--st-success) 8%, transparent);
  box-shadow: inset 2px 0 0 var(--st-success);
}

.update-latest .update-info {
  color: var(--st-success);
}

.links-item {
  padding: 8px;
}

.link-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  border-radius: 10px;
  background: transparent;
  font-size: 12.5px;
  color: var(--st-text);
  text-decoration: none;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.link-item:hover {
  background: var(--st-sunken);
  color: var(--st-accent);
}

.link-item i:first-child {
  font-size: 16px;
  color: var(--st-text-dim);
}

.link-item:hover i:first-child {
  color: var(--st-accent);
}

.link-item i.link-icon {
  margin-left: auto;
  font-size: 13px;
  opacity: 0.5;
}

/* ---- 关于页：IP 助手 ---- */
.ip-card {
  margin-top: 10px;
  padding: 14px 14px 10px;
  border-radius: 12px;
  background: var(--st-panel);
  border: 1px solid var(--st-panel-border);
  box-shadow: var(--st-shadow);
}

.ip-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--st-text);
}

.ip-card-head > i {
  font-size: 15px;
  color: var(--st-accent);
}

.ip-card-desc {
  margin: 7px 0 6px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--st-text-dim);
}

.ip-card-links {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0 -6px;
}

.ip-card-link {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 7px 6px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--st-text);
  text-decoration: none;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.ip-card-link:hover {
  background: var(--st-sunken);
  color: var(--st-accent);
}

.ip-card-link > i:first-child {
  flex-shrink: 0;
  font-size: 15px;
  color: var(--st-text-dim);
}

.ip-card-link:hover > i:first-child {
  color: var(--st-accent);
}

.ip-card-label {
  flex-shrink: 0;
}

.ip-card-url {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 11.5px;
  color: var(--st-text-soft);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ip-card-open {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 13px;
  opacity: 0.5;
}

/* ---- 关于页：隐私与承诺 ---- */
.privacy-card {
  margin-top: 10px;
  padding: 14px 14px 13px;
  border-radius: 12px;
  background: var(--st-panel);
  border: 1px solid var(--st-panel-border);
  box-shadow: var(--st-shadow);
}

.privacy-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 9px;
  font-size: 13px;
  font-weight: 600;
  color: var(--st-text);
}

.privacy-head > i {
  font-size: 15px;
  color: var(--st-accent);
}

/* 「完整说明 ›」：进弹窗看大字号版本 */
.privacy-more {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  margin-left: auto;
  padding: 2px 7px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--st-text-soft);
  font-size: 11.5px;
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.privacy-more:hover {
  background: var(--st-sunken);
  color: var(--st-accent);
}

.privacy-more i {
  font-size: 13px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ============================================
   系统设置风格（macOS 设置面板口径）
   背景纯灰、白色圆角卡片、行内左标签右控件、
   顶部图标+文字的横排标签
   ============================================ */
.settings-header {
  position: relative;
  justify-content: center;
  padding: 10px 14px 6px;
}

.settings-header .back-btn {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
}

.settings-header .back-btn:hover {
  background: var(--st-sunken);
  color: var(--st-text);
}

.settings-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--st-text);
}

.settings-body {
  gap: 12px;
  padding: 0 12px 14px;
}

.settings-nav {
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  background: var(--st-nav-bg);
  border: none;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

.settings-nav .nav-item {
  flex: 1 1 0;
  flex-direction: column;
  gap: 3px;
  padding: 6px 4px;
  border-radius: 8px;
  background: transparent;
  box-shadow: none;
}

.settings-nav .nav-item i {
  width: auto;
  height: auto;
  font-size: 18px;
  margin: 0;
}

.settings-nav .nav-item span {
  font-size: 11px;
  line-height: 1.1;
  font-weight: 500;
}

.settings-nav .nav-item:hover {
  background: rgba(120, 120, 128, 0.12);
}

.settings-nav .nav-item.active {
  background: var(--st-nav-active);
  color: var(--st-accent);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 0.5px rgba(0, 0, 0, 0.04);
}

.settings-nav .nav-item.active::before {
  display: none;
}

.settings-section {
  border-radius: 10px;
  background: var(--st-panel);
  border: 1px solid var(--st-panel-border);
  box-shadow: var(--st-shadow);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

.setting-item {
  padding: 10px 14px;
  gap: 8px;
}

.setting-name {
  font-size: 12.5px;
  font-weight: 400;
}

.setting-item-inline {
  min-height: 41px;
}

/* 标签页容器里的说明文字收敛一点，贴近系统设置的密度 */
.setting-desc {
  font-size: 11px;
  line-height: 1.45;
}
</style>
