<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import TiptapEditor from './TiptapEditor.vue'
import { useNoteStore } from '@/stores/noteStore'
import { useSettingStore } from '@/stores/settingStore'
import { useAutoSave } from '@/composables/useAutoSave'
import { useFileSystem } from '@/composables/useFileSystem'
import { useSourceMode } from '@/composables/useSourceMode'

const noteStore = useNoteStore()
const settingStore = useSettingStore()
const { writeNote } = useFileSystem()
const { isSourceMode, toggleSourceMode } = useSourceMode()

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
  () => {
    localContent.value = currentNote.value?.content || ''
    // 切换笔记时重置源码模式
    isSourceMode.value = false
  },
  { immediate: true }
)

// 监听源码模式切换，确保 textarea 内容同步
watch(isSourceMode, (newVal) => {
  if (newVal) {
    // 源码模式激活时，等待 DOM 更新后聚焦
    setTimeout(() => {
      sourceTextareaRef.value?.focus()
    }, 50)
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
})

onUnmounted(() => {
  const editor = document.querySelector('.editor-container')
  if (editor) {
    editor.removeEventListener('wheel', handleWheel as EventListener)
  }
  clearTimeout(wheelEndTimer)
})

function handleEditorUpdate(md: string) {
  localContent.value = md
  if (currentNote.value) {
    noteStore.updateNote(currentNote.value.id, { content: md })
  }
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
        v-model="localContent"
        class="source-textarea"
        :readonly="isLocked"
        placeholder="在此输入 Markdown 源码..."
      ></textarea>

      <!-- 正常 Markdown 编辑模式 -->
      <TiptapEditor
        v-else
        :initial-content="localContent"
        :font-size="settingStore.settings.fontSize"
        :font-family="settingStore.settings.fontFamily"
        :is-locked="isLocked"
        @update="handleEditorUpdate"
      />

      <!-- source mode toggle button -->
      <button
        class="source-mode-button"
        :class="{ 'is-active': isSourceMode }"
        @click.stop="toggleSourceMode"
        :title="isSourceMode ? '切换到 Markdown' : '切换到源码'"
      >
        <i v-if="isSourceMode" class="i-mdi-markdown"></i>
        <i v-else class="i-mdi-code-tags"></i>
      </button>

      <!-- navigation hints -->
      <div v-if="noteStore.currentIndex > 0" class="nav-hint left-hint" @click.stop="noteStore.selectPrev()">
        <i class="i-mdi-chevron-left"></i>
      </div>
      <div v-if="noteStore.currentIndex < noteStore.notes.length - 1" class="nav-hint right-hint" @click.stop="noteStore.selectNext()">
        <i class="i-mdi-chevron-right"></i>
      </div>

      <!-- note indicator -->
      <div class="note-indicator" @click.stop>
        {{ noteStore.currentIndex + 1 }} / {{ noteStore.notes.length }}
      </div>

      <!-- lock button -->
      <button
        class="lock-button"
        :class="{ 'is-locked': isLocked }"
        @click.stop="toggleLock"
        :title="isLocked ? '解锁笔记' : '锁定笔记'"
      >
        <i v-if="isLocked" class="i-mdi-lock"></i>
        <i v-else class="i-mdi-lock-open-variant"></i>
      </button>

      <!-- word count -->
      <div class="word-count" @click.stop>
        {{ wordCount }} 字
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
}

.source-textarea {
  position: relative;
  z-index: 10;
  flex: 1;
  width: 100%;
  height: 100%;
  padding: 40px 48px 40px 72px;
  overflow: auto;
  background: var(--color-background);
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

.word-count {
  position: absolute;
  bottom: 10px;
  left: 10px;
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
  bottom: 10px;
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

.hint-fade-enter-active,
.hint-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.hint-fade-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}

.hint-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}
</style>
