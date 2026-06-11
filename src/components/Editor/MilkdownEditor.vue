<script setup lang="ts">
import { ref, computed, watch, watchEffect, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import TiptapEditor from './TiptapEditor.vue'
import DirectoryTree from '@/components/Search/DirectoryTree.vue'
import { useNoteStore } from '@/stores/noteStore'
import { useDirectoryStore } from '@/stores/directoryStore'
import { useSettingStore } from '@/stores/settingStore'
import { useAutoSave } from '@/composables/useAutoSave'
import { useFileSystem } from '@/composables/useFileSystem'
import { useSourceMode } from '@/composables/useSourceMode'
import { useTheme } from '@/composables/useTheme'
import NoteColorPicker from '@/components/NoteColorPicker.vue'

const noteStore = useNoteStore()
const directoryStore = useDirectoryStore()
const settingStore = useSettingStore()

// 当前目录名称（始终显示）
const currentDirName = computed(() => {
  const id = noteStore.filterDirectoryId
  if (id === null) return t('dirTree.rootDir')
  return directoryStore.getDirectory(id)?.name ?? t('dirTree.rootDir')
})
const { writeNote } = useFileSystem()
const { isSourceMode, toggleSourceMode } = useSourceMode()

const { isDark } = useTheme()
const { t } = useI18n()

const LIGHT_COLORS = [
  { nameKey: 'color.warmYellow', value: '#fff9e6' },
  { nameKey: 'color.softPink', value: '#fce4ec' },
  { nameKey: 'color.lightPurple', value: '#f3e5f5' },
  { nameKey: 'color.skyBlue', value: '#e3f2fd' },
  { nameKey: 'color.mint', value: '#e0f2f1' },
  { nameKey: 'color.lightOrange', value: '#fff3e0' },
  { nameKey: 'color.grayBlue', value: '#e8eaf6' },
  { nameKey: 'color.lightGray', value: '#f5f5f5' },
  { nameKey: 'color.lightGreen', value: '#e8f5e9' },
  { nameKey: 'color.beige', value: '#faf8f5' },
]

const DARK_COLORS = [
  { nameKey: 'color.darkBlue', value: '#1e293b' },
  { nameKey: 'color.darkPurple', value: '#2a1a3e' },
  { nameKey: 'color.darkGreen', value: '#1a2e24' },
  { nameKey: 'color.darkRed', value: '#3d1a1a' },
  { nameKey: 'color.darkGray', value: '#1f2937' },
  { nameKey: 'color.darkCyan', value: '#1a2e2e' },
  { nameKey: 'color.darkOrange', value: '#3d2a1a' },
  { nameKey: 'color.inkBlue', value: '#0f172a' },
  { nameKey: 'color.darkPink', value: '#2e1a2a' },
  { nameKey: 'color.darkBrown', value: '#2e241a' },
]

const NOTE_COLORS = computed(() => isDark() ? DARK_COLORS : LIGHT_COLORS)

const colorPickerVisible = ref(false)

function toggleColorPicker() {
  colorPickerVisible.value = !colorPickerVisible.value
}

function handleColorSelect(color: string | undefined) {
  if (currentNote.value) {
    noteStore.updateNote(currentNote.value.id, { backgroundColor: color })
  }
}

const localContent = ref('')
const sourceTextareaRef = ref<HTMLTextAreaElement | null>(null)

// 当前笔记是否锁定
const isLocked = computed(() => currentNote.value?.isLocked ?? false)

// 切换锁定状态
function toggleLock() {
  if (currentNote.value) {
    noteStore.toggleLock(currentNote.value.id)
  }
}

// 计算当前笔记字数
const wordCount = computed(() => {
  const text = localContent.value || ''
  const count = text.trim().length
  return count
})

// get current note
const currentNote = computed(() => noteStore.currentNote)

// update local content when current note changes
watch(
  () => currentNote.value?.id,
  async (newId, oldId) => {
    // 如果是从源码模式切换笔记，需要先同步保存当前笔记的编辑内容
    if (isSourceMode.value && oldId && newId !== oldId) {
      // 确保 textarea 的内容完全同步到 localContent
      if (sourceTextareaRef.value) {
        // 手动同步 textarea 的值到 localContent
        localContent.value = sourceTextareaRef.value.value
      }
      // 直接调用 writeNote 同步保存，不依赖防抖机制
      await writeNote(oldId, localContent.value)
      noteStore.updateNote(oldId, { content: localContent.value })
    }
    localContent.value = currentNote.value?.content || ''
    // 切换笔记时保持源码模式状态，不强制重置
    // isSourceMode.value = false
  },
  { immediate: true }
)

// 监听源码模式切换，确保 textarea 内容同步
watch(isSourceMode, (newVal, oldVal) => {
  if (newVal) {
    // 源码模式激活时，等待 DOM 更新后聚焦
    setTimeout(() => {
      sourceTextareaRef.value?.focus()
    }, 50)
  } else if (oldVal && !newVal) {
    // 从源码模式切换到普通模式时，确保内容已同步
    // 这里不需要额外处理，因为 handleSourceInput 已经实时同步了内容
  }
})


// auto-save
const { isSaving } = useAutoSave(
  () => currentNote.value?.id || null,
  () => localContent.value,
  async (id, content) => {
    await writeNote(id, content)
  },
  settingStore.settings.autoSaveInterval
)

// 追踪手势状态
let gestureFired = false
let lastDeltaX = 0

function handleWheel(e: WheelEvent) {
  // 只处理水平滑动
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) <= 5) {
    return
  }

  e.preventDefault()
  e.stopPropagation()

  // 方向翻转，视为新手势
  if (lastDeltaX !== 0 && Math.sign(e.deltaX) !== Math.sign(lastDeltaX)) {
    gestureFired = false
  }

  lastDeltaX = e.deltaX

  // 每次手势只触发一次
  if (!gestureFired) {
    gestureFired = true

    if (e.deltaX > 0) {
      noteStore.navigateNextOrCreate()
    } else {
      noteStore.navigatePrevOrCreate()
    }
  }

  // 用 cancelable 的 setTimeout 检测手势结束（无后续事件则视为结束）
  clearTimeout(wheelEndTimer)
  wheelEndTimer = setTimeout(() => {
    gestureFired = false
    lastDeltaX = 0
  }, 30) // 80ms 无新事件，视为手势结束
}

let wheelEndTimer: ReturnType<typeof setTimeout>

onMounted(() => {
  const editor = document.querySelector('.editor-container')
  if (editor) {
    editor.addEventListener('wheel', handleWheel as EventListener, { passive: false })
  }

  // 直接监听背景色变化并设置DOM样式
  watchEffect(() => {
    const color = currentNote.value?.backgroundColor
    const wrapper = document.querySelector('.editor-wrapper') as HTMLElement | null
    if (wrapper) {
      if (color) {
        wrapper.style.setProperty('--note-bg', color)
      } else {
        wrapper.style.removeProperty('--note-bg')
      }
    }
    const textarea = document.querySelector('.source-textarea') as HTMLElement | null
    if (textarea) {
      if (color) {
        textarea.style.setProperty('background', color, 'important')
      } else {
        textarea.style.removeProperty('background')
      }
    }
  })
})

onUnmounted(() => {
  // 在组件卸载前同步源码模式下的内容
  if (isSourceMode.value && sourceTextareaRef.value && currentNote.value) {
    // 确保 textarea 的内容同步到 localContent 和 store
    localContent.value = sourceTextareaRef.value.value
    noteStore.updateNote(currentNote.value.id, { content: sourceTextareaRef.value.value })
  }

  const editor = document.querySelector('.editor-container')
  if (editor) {
    editor.removeEventListener('wheel', handleWheel as EventListener)
  }
  clearTimeout(wheelEndTimer)
})

const editorRef = ref<InstanceType<typeof TiptapEditor> | null>(null)
const searchVisible = ref(false)
const searchQuery = ref('')
const searchMatchCount = ref(0)
const searchCurrentIndex = ref(0)

function openSearch() {
  searchVisible.value = true
  searchQuery.value = ''
  searchMatchCount.value = 0
  searchCurrentIndex.value = 0
  nextTick(() => {
    document.querySelector<HTMLInputElement>('.search-input')?.focus()
  })
}

function closeSearch() {
  searchVisible.value = false
  searchQuery.value = ''
  searchMatchCount.value = 0
  searchCurrentIndex.value = 0
  editorRef.value?.clearSearch()
}

function handleSearchInput(e: Event) {
  const query = (e.target as HTMLInputElement).value
  searchQuery.value = query
  editorRef.value?.setSearchQuery(query)
  const state = editorRef.value?.getSearchState()
  if (state) {
    searchMatchCount.value = state.matches
    searchCurrentIndex.value = state.matches > 0 ? state.currentIndex + 1 : 0
  }
}

function handleSearchPrev() {
  if (searchMatchCount.value === 0) return
  editorRef.value?.searchPrev()
  const state = editorRef.value?.getSearchState()
  if (state) {
    searchCurrentIndex.value = state.currentIndex + 1
  }
}

function handleSearchNext() {
  if (searchMatchCount.value === 0) return
  editorRef.value?.searchNext()
  const state = editorRef.value?.getSearchState()
  if (state) {
    searchCurrentIndex.value = state.currentIndex + 1
  }
}

function handleSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    closeSearch()
  } else if (e.key === 'Enter') {
    if (e.shiftKey) {
      handleSearchPrev()
    } else {
      handleSearchNext()
    }
    e.preventDefault()
  }
}

function handleEditorUpdate(md: string) {
  localContent.value = md
  if (currentNote.value) {
    noteStore.updateNote(currentNote.value.id, { content: md })
  }
}

// 处理源码模式下的输入事件，确保内容实时同步
function handleSourceInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  localContent.value = target.value
  if (currentNote.value) {
    noteStore.updateNote(currentNote.value.id, { content: target.value })
  }
}

// 目录选择器弹出状态
const dirPickerVisible = ref(false)

function toggleDirPicker() {
  dirPickerVisible.value = !dirPickerVisible.value
}

function handleDirSelect(id: string | null) {
  noteStore.setFilterDirectory(id)
  dirPickerVisible.value = false
}


// 自定义切换源码模式函数，确保内容同步
function handleToggleSourceMode() {
  // 如果当前是源码模式，切换到普通模式前确保内容同步
  if (isSourceMode.value && sourceTextareaRef.value) {
    // 手动同步 textarea 的内容到 localContent
    localContent.value = sourceTextareaRef.value.value
    if (currentNote.value) {
      noteStore.updateNote(currentNote.value.id, { content: sourceTextareaRef.value.value })
    }
  }
  // 切换模式
  toggleSourceMode()
}
</script>

<template>
  <div class="editor-container">
    <!-- navigation hint toast - 显示在工具栏上方 -->
    <Transition name="hint-fade">
      <div v-if="noteStore.navigationHint.visible" class="navigation-hint">
        <i class="i-mdi-information"></i>
        <span>{{ noteStore.navigationHint.message }}</span>
      </div>
    </Transition>

    <div class="editor-wrapper">
      <!-- 源码模式编辑 -->
      <textarea
        v-if="isSourceMode"
        ref="sourceTextareaRef"
        :value="localContent"
        @input="handleSourceInput"
        class="source-textarea"
        :style="currentNote?.backgroundColor ? { background: currentNote.backgroundColor + ' !important' } : {}"
        :readonly="isLocked"
        :placeholder="$t('editor.sourcePlaceholder')"
      ></textarea>

      <!-- 正常 Markdown 编辑模式 -->
      <TiptapEditor
        v-else
        ref="editorRef"
        :key="currentNote?.id"
        :initial-content="localContent"
        :font-size="settingStore.settings.fontSize"
        :font-family="settingStore.settings.fontFamily"
        :is-locked="isLocked"
        :note-bg-color="currentNote?.backgroundColor"
        @update="handleEditorUpdate"
      />

      <!-- source mode toggle button -->
      <button
        class="source-mode-button"
        :class="{ 'is-active': isSourceMode }"
        @click.stop="handleToggleSourceMode"
        :title="isSourceMode ? $t('editor.switchMarkdown') : $t('editor.switchSource')"
      >
        <i v-if="isSourceMode" class="i-mdi-markdown"></i>
        <i v-else class="i-mdi-code-tags"></i>
      </button>

      <!-- navigation hints -->
      <div v-if="noteStore.activeIndex > 0" class="nav-hint left-hint" @click.stop="noteStore.selectPrev()">
        <i class="i-mdi-chevron-left"></i>
      </div>
      <div v-if="noteStore.activeIndex < noteStore.activeNoteList.length - 1" class="nav-hint right-hint" @click.stop="noteStore.selectNext()">
        <i class="i-mdi-chevron-right"></i>
      </div>

      <!-- note indicator -->
      <div class="note-indicator" @click.stop>
        {{ $t('editor.noteIndicator', { index: noteStore.activeIndex + 1, total: noteStore.activeNoteList.length }) }}
      </div>

      <!-- 目录指示器 -->
      <div class="dir-indicator" @click.stop="toggleDirPicker">
        <i class="i-mdi-folder-outline"></i>
        <span>{{ currentDirName }}</span>
        <i class="i-mdi-chevron-down" :class="{ rotated: dirPickerVisible }"></i>
      </div>

      <!-- 目录选择器弹出 -->
      <div v-if="dirPickerVisible" class="dir-picker-overlay" @click="dirPickerVisible = false">
        <div class="dir-picker-popup" @click.stop>
          <DirectoryTree :on-select="handleDirSelect" />
        </div>
      </div>

      <!-- lock button -->
      <button
        class="lock-button"
        :class="{ 'is-locked': isLocked }"
        @click.stop="toggleLock"
        :title="isLocked ? $t('editor.unlockNote') : $t('editor.lockNote')"
      >
        <i v-if="isLocked" class="i-mdi-lock"></i>
        <i v-else class="i-mdi-lock-open-variant"></i>
      </button>

      <!-- bottom bar: word count, color, search -->
      <div class="bottom-bar">
        <div v-show="!searchVisible" class="word-count" @click.stop>
          {{ $t('editor.wordCount', { count: wordCount }) }}
        </div>
        <button
          class="color-btn"
          :class="{ 'has-color': currentNote?.backgroundColor }"
          @click.stop="toggleColorPicker"
          :title="$t('editor.noteBgColor')"
        >
          <i class="i-mdi-palette-outline"></i>
        </button>
        <button
          v-if="!isSourceMode && !searchVisible"
          class="search-toggle-btn"
          @click.stop="openSearch"
          :title="$t('editor.searchInNote')"
        >
          <i class="i-mdi-magnify"></i>
        </button>
      </div>

      <!-- color picker popup -->
      <div v-if="colorPickerVisible" class="color-picker-overlay" @click="colorPickerVisible = false">
        <NoteColorPicker
          class="color-picker-wrapper"
          :model-value="currentNote?.backgroundColor"
          :colors="NOTE_COLORS"
          @update:model-value="handleColorSelect"
          @close="colorPickerVisible = false"
        />
      </div>

      <!-- search bar -->
      <div v-if="!isSourceMode && searchVisible" class="search-bar" @click.stop>
        <input
          type="text"
          class="search-input"
          :placeholder="$t('editor.searchPlaceholder')"
          :value="searchQuery"
          @input="handleSearchInput"
          @keydown="handleSearchKeydown"
        />
        <span v-if="searchQuery" class="search-count">
          {{ searchMatchCount > 0 ? `${searchCurrentIndex}/${searchMatchCount}` : '0/0' }}
        </span>
        <button
          class="search-nav-btn"
          @click="handleSearchPrev"
          :disabled="searchMatchCount === 0"
          :title="$t('editor.searchPrev')"
        >
          <i class="i-mdi-chevron-up"></i>
        </button>
        <button
          class="search-nav-btn"
          @click="handleSearchNext"
          :disabled="searchMatchCount === 0"
          :title="$t('editor.searchNext')"
        >
          <i class="i-mdi-chevron-down"></i>
        </button>
        <button class="search-close-btn" @click="closeSearch" :title="$t('editor.searchClose')">
          <i class="i-mdi-close"></i>
        </button>
      </div>

      <!-- save indicator -->
      <div v-if="isSaving" class="save-indicator" @click.stop>
        <i class="i-mdi-loading spinning"></i>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  min-height: 0;
}

.editor-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 8px;
  background: transparent;
}

.source-textarea {
  position: relative;
  z-index: 10;
  flex: 1;
  width: 100%;
  height: 100%;
  padding: 40px 48px;
  overflow: auto;
  background: var(--note-bg, transparent) !important;
  color: var(--color-text);
  border: none;
  outline: none;
  resize: none;
  font-family: v-bind('settingStore.settings.fontFamily');
  font-size: v-bind('settingStore.settings.fontSize + "px"');
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
  box-sizing: border-box;
  border-radius: 8px;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
}

.source-textarea::placeholder {
  color: var(--color-text-secondary);
}

.source-textarea:read-only {
  cursor: not-allowed;
  background: var(--color-surface);
}

.nav-hint {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 11;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: var(--color-surface);
  color: var(--color-text-secondary);
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  user-select: none;
  -webkit-user-select: none;
}

.left-hint {
  left: 10px;
}

.right-hint {
  right: 10px;
}

.editor-wrapper:hover .nav-hint {
  opacity: 0.6;
}

.nav-hint i {
  font-size: 20px;
}

.note-indicator {
  position: absolute;
  bottom: 10px;
  right: 10px;
  z-index: 11;
  padding: 6px 14px;
  background-color: var(--color-surface);
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-sm);
  pointer-events: none;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.dir-indicator {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 11;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background-color: var(--color-surface);
  border-radius: 20px;
  font-size: 12px;
  color: var(--color-primary);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
  transition: background 0.15s;
}

.dir-indicator:hover {
  background-color: var(--color-border);
}

.dir-indicator i.i-mdi-chevron-down {
  font-size: 14px;
  transition: transform 0.2s;
}

.dir-indicator i.i-mdi-chevron-down.rotated {
  transform: rotate(180deg);
}

.dir-indicator i {
  font-size: 14px;
}

.dir-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  justify-content: center;
}

.dir-picker-popup {
  position: absolute;
  bottom: 48px;
  width: 280px;
  height: 50vh;
  max-height: 50vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
}

.lock-button {
  position: absolute;
  bottom: 5px;
  right: 90px;
  z-index: 11;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 20px;
  background-color: var(--color-surface);
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: all 0.15s;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.lock-button:hover {
  color: var(--color-text);
  transform: scale(1.05);
}

.lock-button.is-locked {
  color: var(--color-primary);
}

.lock-button i {
  font-size: 16px;
}

.source-mode-button {
  position: absolute;
  bottom: 5px;
  right: 130px;
  z-index: 11;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 20px;
  background-color: var(--color-surface);
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: all 0.15s;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.source-mode-button:hover {
  color: var(--color-text);
  transform: scale(1.05);
}

.source-mode-button.is-active {
  color: var(--color-primary);
}

.source-mode-button i {
  font-size: 16px;
}

.bottom-bar {
  position: absolute;
  bottom: 10px;
  left: 10px;
  z-index: 11;
  display: flex;
  align-items: center;
  gap: 8px;
}

.word-count {
  padding: 6px 14px;
  background-color: var(--color-surface);
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-sm);
  pointer-events: none;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.search-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 20px;
  background-color: var(--color-surface);
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: all 0.15s;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.search-toggle-btn:hover {
  color: var(--color-text);
  transform: scale(1.05);
}

.search-toggle-btn i {
  font-size: 16px;
}

.color-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 20px;
  background-color: var(--color-surface);
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
  -webkit-user-select: none;
}

.color-btn:hover {
  color: var(--color-text);
  transform: scale(1.05);
}

.color-btn.has-color {
  color: var(--color-primary);
}

.color-btn i {
  font-size: 16px;
}

.color-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.color-picker-wrapper {
  position: absolute;
  bottom: 50px;
  left: 118px;
}

.search-bar {
  position: absolute;
  bottom: 10px;
  left: 10px;
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background-color: var(--color-surface);
  border-radius: 20px;
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.search-input {
  width: 140px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 12px;
  outline: none;
}

.search-input::placeholder {
  color: var(--color-text-secondary);
}

.search-count {
  font-size: 11px;
  color: var(--color-text-secondary);
  min-width: 30px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.search-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.search-nav-btn:hover:not(:disabled) {
  background: var(--color-border);
  color: var(--color-text);
}

.search-nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.search-nav-btn i {
  font-size: 14px;
}

.search-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.search-close-btn:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.search-close-btn i {
  font-size: 14px;
}

.save-indicator {
  position: absolute;
  bottom: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background-color: var(--color-surface);
  border-radius: 50%;
  color: var(--color-primary);
  box-shadow: var(--shadow-sm);
  pointer-events: none;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.spinning {
  animation: spin 1s linear infinite;
  font-size: 16px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.navigation-hint {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background-color: var(--color-surface);
  border-radius: var(--radius-md);
  color: var(--color-text);
  box-shadow: var(--shadow-md);
  font-size: 14px;
  pointer-events: none;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  z-index: 10;
}

.navigation-hint i {
  font-size: 18px;
  color: var(--color-primary);
}

.navigation-hint {
  user-select: none;
  -webkit-user-select: none;
}

.hint-fade-enter-active,
.hint-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.hint-fade-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}

.hint-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}
</style>
