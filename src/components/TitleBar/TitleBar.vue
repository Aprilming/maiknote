<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { useNoteStore } from '@/stores/noteStore'
import { useSettingStore } from '@/stores/settingStore'
import { setNativeDialogOpen } from '@/stores/dialogStore'

const noteStore = useNoteStore()
const settingStore = useSettingStore()

// 安全获取 Tauri 窗口，非 Tauri 环境下返回 null
const isTauri = typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
const appWindow = isTauri ? getCurrentWindow() : null

// 响应式追踪置顶状态
const isPinned = computed(() => settingStore.settings.alwaysOnTop)

// 标题栏默认隐藏，鼠标悬停时显示
const isVisible = ref(false)

function showTitleBar() {
  isVisible.value = true
}

function hideTitleBar() {
  if (dragState) return
  isVisible.value = false
}

async function minimizeWindow() {
  await appWindow?.minimize()
}

async function toggleFullscreen() {
  await appWindow?.toggleMaximize()
}

async function closeWindow() {
  await appWindow?.hide()
}

async function togglePin() {
  const newValue = !settingStore.settings.alwaysOnTop
  // 调用 Tauri API 设置窗口置顶
  try {
    await appWindow?.setAlwaysOnTop(newValue)
    settingStore.updateSettings('alwaysOnTop', newValue)
  } catch (e) {
    console.error('setAlwaysOnTop failed:', e)
  }
}

async function createNoteAfterCurrent() {
  await noteStore.createNoteAfterCurrent()
}

async function deleteCurrentNote() {
  if (noteStore.currentNoteId) {
    await noteStore.deleteNote(noteStore.currentNoteId)
  }
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

// 纯手动拖拽：requestAnimationFrame 同步到刷新率，统一使用物理像素
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
  const pos = await appWindow.outerPosition()  // 物理像素
  dragWinX = pos.x
  dragWinY = pos.y
  dragStartX = e.screenX * dpr  // 逻辑→物理
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
      :class="{ visible: isVisible }"
      data-tauri-drag-region
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
  gap: 20px;
  /* 默认隐藏 */
  opacity: 0;
  transform: translateY(-100%);
  transition: opacity 0.2s ease, transform 0.2s ease;
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
  transition: opacity 0.15s;
}

.window-btn:hover {
  opacity: 0.8;
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
  transition: all 0.15s;
}

.search-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
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
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  font-size: 14px;
  font-weight: 500;
  pointer-events: auto !important;
}

.action-btn:hover {
  background: var(--color-border);
}

.action-btn.active {
  background: var(--color-primary);
  color: white;
}

.action-btn i {
  font-size: 18px;
}
</style>
