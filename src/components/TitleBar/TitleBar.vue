<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { useNoteStore, extractTitle } from '@/stores/noteStore'
import { useSettingStore } from '@/stores/settingStore'
import { setNativeDialogOpen } from '@/stores/dialogStore'
import { usePinWindow } from '@/composables/usePinWindow'

const noteStore = useNoteStore()
const settingStore = useSettingStore()
// 置顶开关：取消置顶时按设置决定窗口显示/隐藏
const { togglePin: applyTogglePin } = usePinWindow()

// 安全获取 Tauri 窗口，非 Tauri 环境下返回 null
const isTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
const appWindow = isTauri ? getCurrentWindow() : null

// 响应式追踪置顶状态
const isPinned = computed(() => settingStore.settings.alwaysOnTop)

// 当前笔记标题：取正文首个有内容的行，去掉 Markdown 语法只显示文字
// 无实际内容时不显示（extractTitle 兜底返回 'Untitled'，这里视为空）
const noteTitle = computed(() => {
  const content = noteStore.currentNote?.content
  if (!content) return ''
  const title = extractTitle(content)
  return title === 'Untitled' ? '' : title
})

// 标题栏行为：auto-hide 默认隐藏鼠标悬停时显示，always-show 始终显示
const isVisible = ref(false)

const titleBarVisible = computed(() => isVisible.value || isPinned.value || settingStore.settings.titleBarBehavior === 'always-show')

function showTitleBar() {
  isVisible.value = true
}

function hideTitleBar() {
  if (dragState) return
  if (isPinned.value) return
  if (settingStore.settings.titleBarBehavior === 'always-show') return
  isVisible.value = false
}

async function minimizeWindow() {
  await appWindow?.minimize()
}

async function toggleFullscreen() {
  await appWindow?.toggleMaximize()
}

async function closeWindow() {
  if (settingStore.settings.closeBehavior === 'quit') {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('exit_app')
  } else {
    await appWindow?.hide()
  }
}

async function togglePin() {
  // 调用 Tauri API 设置窗口置顶；取消置顶时的显示/隐藏由设置决定
  try {
    await applyTogglePin()
  } catch (e) {
    console.error('setAlwaysOnTop failed:', e)
  }
}

async function createNoteAfterCurrent() {
  await noteStore.createNoteAfterCurrent()
}

function deleteCurrentNote() {
  window.dispatchEvent(new CustomEvent('marknote:delete-note'))
}

async function importMarkdown() {
  setNativeDialogOpen(true)
  try {
    const file = await open({
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
    })
    if (file) {
      const content = await readTextFile(file)
      const title = file.split('/').pop()?.replace(/\.(md|markdown|txt)$/, '') || 'Imported Note'
      await noteStore.createNoteWithContent(title, content)
    }
  } catch (e) {
    console.error('Import failed:', e)
  } finally {
    setNativeDialogOpen(false)
    // 无论成功、取消还是错误，都要恢复窗口焦点
    await appWindow?.show()
    await appWindow?.setFocus()
  }
}

async function exportMarkdown() {
  const note = noteStore.currentNote
  if (!note) return
  setNativeDialogOpen(true)
  try {
    const file = await save({
      defaultPath: `${note.title}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (file) {
      await writeTextFile(file, note.content)
    }
  } catch (e) {
    console.error('Export failed:', e)
  } finally {
    setNativeDialogOpen(false)
    // 无论成功、取消还是错误，都要恢复窗口焦点
    await appWindow?.show()
    await appWindow?.setFocus()
  }
}

const emit = defineEmits<{
  (e: 'openSettings'): void
  (e: 'openSearch'): void
}>()

function openSettings() {
  emit('openSettings')
}

let dragState = false
let dragWinX = 0
let dragWinY = 0
let dragStartX = 0
let dragStartY = 0
let lastScreenX = 0
let lastScreenY = 0
let rafId = 0

async function startDrag(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, input, .window-controls, .right-actions')) {
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

onMounted(() => {
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
})

onUnmounted(() => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})

</script>

<template>
  <!-- 悬停触发区域 -->
  <div
    class="title-bar-trigger"
    @mouseenter="showTitleBar"
    @mouseleave="hideTitleBar"
  >
    <div
      class="title-bar"
      :class="{ visible: titleBarVisible }"
      @mousedown="startDrag"
    >
    <!-- Window Controls -->
    <div class="window-controls">
      <button class="window-btn close" @click="closeWindow" :title="$t('titlebar.close')">
        <span class="dot"></span>
      </button>
      <button class="window-btn minimize" @click="minimizeWindow" :title="$t('titlebar.minimize')">
        <span class="dot"></span>
      </button>
      <button class="window-btn fullscreen" @click="toggleFullscreen" :title="$t('titlebar.fullscreen')">
        <span class="dot"></span>
      </button>
    </div>

    <!-- 当前笔记标题 -->
    <div v-if="noteTitle" class="note-title" :title="noteTitle">{{ noteTitle }}</div>
    <div class="title-bar-spacer"></div>

    <!-- Right Actions -->
    <div class="right-actions">
      <button
        class="action-btn"
        @click.stop="emit('openSearch')"
        :title="$t('titlebar.search')"
      >
        <i class="i-mdi-magnify"></i>
      </button>
      <button
        class="action-btn"
        @click.stop="createNoteAfterCurrent"
        :title="$t('titlebar.newNote')"
      >
        <i class="i-mdi-plus"></i>
      </button>
      <button
        class="action-btn"
        :class="{ active: isPinned }"
        @click.stop="togglePin"
        :title="isPinned ? $t('titlebar.unpin') : $t('titlebar.pin')"
      >
        <i :class="isPinned ? 'i-mdi-pin' : 'i-mdi-pin-outline'"></i>
      </button>
      <button
        class="action-btn"
        @click.stop="deleteCurrentNote"
        :title="$t('titlebar.deleteNote')"
      >
        <i class="i-mdi-delete"></i>
      </button>
      <button
        class="action-btn"
        @click.stop="importMarkdown"
        :title="$t('titlebar.import')"
      >
        <i class="i-mdi-import"></i>
      </button>
      <button
        class="action-btn"
        @click.stop="exportMarkdown"
        :title="$t('titlebar.export')"
      >
        <i class="i-mdi-export"></i>
      </button>
      <button class="action-btn" @click="openSettings" :title="$t('titlebar.settings')">
        <i class="i-mdi-cog"></i>
      </button>
    </div>
  </div>
  </div>
</template>

<style scoped>
/* 悬停触发区域 - 整个上侧 */
.title-bar-trigger {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 20px;
  z-index: 100;
}

.title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 20px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  user-select: none;
  cursor: pointer;
  gap: 20px;
  /* 默认隐藏 */
  opacity: 0;
  transform: translateY(-100%);
  transition: opacity var(--duration-normal) var(--ease-out), transform var(--duration-normal) var(--ease-out);
  pointer-events: none;
}

.title-bar.visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

/* Window Controls - macOS style */
.window-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.window-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  cursor: pointer;
  position: relative;
  transition: opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}

.window-btn:hover {
  opacity: 0.8;
  transform: scale(1.15);
}

.window-btn:active {
  transform: scale(0.9);
}

.window-btn .dot {
  display: none;
}

.window-btn.close {
  background-color: #ff5f57;
}

.window-btn.minimize {
  background-color: #febc2e;
}

.window-btn.fullscreen {
  background-color: #28c840;
}

/* 弹性占位，撑开标题与右侧操作区 */
.title-bar-spacer {
  flex: 1;
}

/* 当前笔记标题 - 靠左，超宽省略 */
.note-title {
  max-width: 40%;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Search Container */
.search-container {
  flex: 1;
  display: flex;
  align-items: center;
  max-width: 400px;
  position: relative;
}

.search-icon {
  position: absolute;
  left: 14px;
  color: var(--color-text-secondary);
  pointer-events: none;
  font-size: 18px;
  opacity: 0.6;
}

.search-input {
  width: 100%;
  height: 36px;
  padding: 0 14px 0 44px;
  font-size: 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-background);
  color: var(--color-text);
  outline: none;
  transition: all var(--duration-fast) var(--ease-out);
}

.search-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
}

.search-input::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.6;
}

/* Right Actions */
.right-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  pointer-events: auto !important;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 36px;
  height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  font-size: 14px;
  font-weight: 500;
  pointer-events: auto !important;
}

.action-btn:hover {
  background: var(--color-border);
}

.action-btn:active {
  transform: scale(0.93);
}

.action-btn.active {
  background: var(--color-primary);
  color: white;
}

.action-btn.active:hover {
  background: var(--color-primary-hover);
}

.action-btn i {
  font-size: 18px;
}
</style>
