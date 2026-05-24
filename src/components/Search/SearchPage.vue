<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useNoteStore } from '@/stores/noteStore'
import { useDirectoryStore } from '@/stores/directoryStore'
import DirectoryTree from './DirectoryTree.vue'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const noteStore = useNoteStore()
const directoryStore = useDirectoryStore()
const searchInput = ref<HTMLInputElement | null>(null)
const localQuery = ref('')

// 拖拽状态
const isDragging = ref(false)
const draggedNoteId = ref<string | null>(null)
const dragOverNoteIndex = ref<number | null>(null)
const dragOverDirId = ref<string | null | undefined>(undefined)
const dragStartPos = ref({ x: 0, y: 0 })

// 是否通过关键词搜索
const isSearching = computed(() => localQuery.value.trim().length > 0)

// 筛选后的搜索结果
const searchResults = computed(() => {
  let results = noteStore.notes
  if (!isSearching.value) {
    results = noteStore.getNotesByDirectory(directoryStore.currentDirectoryId)
  }
  if (localQuery.value) {
    const q = localQuery.value.toLowerCase()
    results = results.filter(n =>
      n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
    )
  }
  return results.slice(0, 50)
})

// 当前目录名称
const currentDirName = computed(() => {
  if (directoryStore.currentDirectoryId === null) return '主目录'
  return directoryStore.getDirectory(directoryStore.currentDirectoryId)?.name ?? '主目录'
})

// ---- Pointer event handlers (document-level) ----

function onNotePointerDown(e: PointerEvent, noteId: string) {
  draggedNoteId.value = noteId
  dragStartPos.value = { x: e.clientX, y: e.clientY }
  isDragging.value = false
  dragOverNoteIndex.value = null
  dragOverDirId.value = undefined
}

function onDocPointerMove(e: PointerEvent) {
  if (!draggedNoteId.value) return

  // 检测是否超过拖拽阈值 (8px)
  if (!isDragging.value) {
    const dx = Math.abs(e.clientX - dragStartPos.value.x)
    const dy = Math.abs(e.clientY - dragStartPos.value.y)
    if (dx <= 8 && dy <= 8) return
    isDragging.value = true
  }

  e.preventDefault()

  // 检测鼠标下方元素
  const els = document.elementsFromPoint(e.clientX, e.clientY)

  // 检测目录
  let foundDir = false
  for (const el of els) {
    const dirEl = (el as HTMLElement).closest('[data-dir-id]') as HTMLElement | null
    if (dirEl) {
      const raw = dirEl.getAttribute('data-dir-id')
      dragOverDirId.value = raw === 'root' ? null : raw
      dragOverNoteIndex.value = null
      foundDir = true
      break
    }
  }
  if (!foundDir) dragOverDirId.value = undefined

  // 检测笔记排序目标（仅当不在目录上时）
  if (!foundDir) {
    for (const el of els) {
      const noteEl = (el as HTMLElement).closest('[data-note-index]') as HTMLElement | null
      if (noteEl) {
        const idx = parseInt(noteEl.getAttribute('data-note-index')!, 10)
        if (!isNaN(idx) && draggedNoteId.value) {
          const curIdx = searchResults.value.findIndex(n => n.id === draggedNoteId.value)
          dragOverNoteIndex.value = idx !== curIdx ? idx : null
        }
        break
      }
    }
  }

  // 没找到任何目标则清除
  if (!foundDir && !els.some(el => !!(el as HTMLElement).closest('[data-note-index]'))) {
    dragOverNoteIndex.value = null
  }
}

function onDocPointerUp() {
  if (!draggedNoteId.value) return

  if (isDragging.value) {
    // 拖入目录
    if (dragOverDirId.value !== undefined) {
      const nid = draggedNoteId.value
      const did = dragOverDirId.value
      resetDrag()
      noteStore.moveNoteToDirectory(nid, did)
      return
    }

    // 列表内排序
    if (dragOverNoteIndex.value !== null) {
      const src = noteStore.notes.findIndex(n => n.id === draggedNoteId.value)
      const tgt = searchResults.value[dragOverNoteIndex.value]
      if (tgt && src !== -1) {
        const dst = noteStore.notes.findIndex(n => n.id === tgt.id)
        if (dst !== -1 && src !== dst) {
          const ids = noteStore.notes.map(n => n.id)
          const [moved] = ids.splice(src, 1)
          ids.splice(dst, 0, moved)
          noteStore.reorderNotes(ids)
        }
      }
    }
  } else {
    // 点击选择：同步目录过滤，使主编辑器只显示该目录下的笔记
    const clickedNote = noteStore.notes.find(n => n.id === draggedNoteId.value)
    noteStore.setFilterDirectory(clickedNote?.directoryId ?? null)
    localQuery.value = ''
    noteStore.selectNote(draggedNoteId.value)
    emit('close')
  }

  resetDrag()
}

function resetDrag() {
  isDragging.value = false
  draggedNoteId.value = null
  dragOverNoteIndex.value = null
  dragOverDirId.value = undefined
}

// ---- 格式化/工具函数 ----
function formatDate(ts: number): string {
  const d = new Date(ts)
  const diff = Date.now() - ts
  const day = 86400000
  if (diff < day) return '今天'
  if (diff < 2 * day) return '昨天'
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function getPreview(s: string): string {
  return s.replace(/[#*`_~\[\]]/g, '').trim().substring(0, 80)
}

function highlightKeyword(text: string, kw: string): string {
  if (!kw) return text
  return text.replace(
    new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
    '<mark>$1</mark>'
  )
}

function handleCancel() {
  localQuery.value = ''
  emit('close')
}

onMounted(() => {
  searchInput.value?.focus()
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('pointermove', onDocPointerMove)
  document.addEventListener('pointerup', onDocPointerUp)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('pointermove', onDocPointerMove)
  document.removeEventListener('pointerup', onDocPointerUp)
  resetDrag()
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') handleCancel()
}
</script>

<template>
  <div class="search-page">
    <!-- 顶部搜索栏 -->
    <div class="search-header">
      <div class="search-input-wrapper">
        <i class="i-mdi-magnify search-icon"></i>
        <input
          ref="searchInput"
          v-model="localQuery"
          type="text"
          :placeholder="`在「${currentDirName}」中搜索...`"
          class="search-input"
        />
        <button v-if="localQuery" class="clear-btn" @click="localQuery = ''">
          <i class="i-mdi-close"></i>
        </button>
      </div>
      <button class="cancel-btn" @click="handleCancel">取消</button>
    </div>

    <!-- 底部左右分栏 -->
    <div class="search-body">
      <!-- 左侧目录树 -->
      <div class="search-sidebar">
        <DirectoryTree :highlight-dir-id="isDragging ? dragOverDirId : undefined" />
      </div>

      <!-- 右侧笔记列表 -->
      <div class="search-main">
        <div class="dir-title">
          <i class="i-mdi-folder-outline"></i>
          <span>{{ currentDirName }}</span>
          <span class="dir-title-count">{{ searchResults.length }} 篇笔记</span>
        </div>

        <div class="search-results">
          <div v-if="searchResults.length === 0" class="no-results">
            <template v-if="localQuery">未找到匹配的笔记</template>
            <template v-else-if="directoryStore.currentDirectoryId === null">还没有笔记，开始写第一篇吧</template>
            <template v-else>这个目录还没有笔记，拖拽笔记到这里</template>
          </div>

          <div
            v-for="(note, index) in searchResults"
            :key="note.id"
            :data-note-id="note.id"
            :data-note-index="index"
            class="result-item"
            :class="{
              'is-dragging': draggedNoteId === note.id,
              'is-drag-over': isDragging && dragOverNoteIndex === index && dragOverDirId === undefined
            }"
            @pointerdown="onNotePointerDown($event, note.id)"
          >
            <div class="result-header">
              <div class="result-title" v-html="highlightKeyword(note.title, localQuery)"></div>
              <i v-if="note.isLocked" class="i-mdi-lock result-locked-icon"></i>
              <div class="result-date">{{ formatDate(note.updatedAt) }}</div>
            </div>
            <div class="result-preview" v-html="highlightKeyword(getPreview(note.content), localQuery)"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
}

.search-header {
  display: flex;
  align-items: center;
  padding: 16px 16px 12px;
  gap: 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
}

.search-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.search-sidebar {
  width: 40%;
  min-width: 180px;
  max-width: 320px;
  overflow: hidden;
  border-right: 1px solid var(--color-border);
}

.search-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.search-input-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  position: relative;
}

.search-icon {
  position: absolute;
  left: 12px;
  color: var(--color-text-secondary);
  font-size: 18px;
}

.search-input {
  width: 100%;
  height: 40px;
  padding: 0 36px;
  font-size: 15px;
  border: 1px solid var(--color-border);
  border-radius: 20px;
  background: var(--color-surface);
  color: var(--color-text);
  outline: none;
}

.search-input:focus {
  border-color: var(--color-primary);
}

.clear-btn {
  position: absolute;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: var(--color-border);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.cancel-btn {
  padding: 8px 4px;
  font-size: 15px;
  color: var(--color-primary);
  background: none;
  border: none;
  cursor: pointer;
}

.dir-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 16px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
}

.dir-title i {
  font-size: 16px;
  color: var(--color-text-secondary);
}

.dir-title-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--color-text-secondary);
  margin-left: 4px;
}

.search-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.no-results {
  padding: 40px 20px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.result-item {
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}

.result-item.is-dragging {
  opacity: 0.5;
  background: var(--color-surface);
}

.result-item.is-drag-over {
  border-top: 2px solid var(--color-primary);
}

.result-item:hover {
  background: var(--color-surface);
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.result-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--color-text);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-locked-icon {
  font-size: 14px;
  color: var(--color-primary);
  margin-left: 6px;
  flex-shrink: 0;
}

.result-date {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-left: 8px;
  flex-shrink: 0;
}

.result-preview {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.result-item :deep(mark) {
  background: rgba(255, 221, 0, 0.4);
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
}
</style>
