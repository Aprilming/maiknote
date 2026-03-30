<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useNoteStore } from '@/stores/noteStore'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const noteStore = useNoteStore()
const searchInput = ref<HTMLInputElement | null>(null)
const localQuery = ref('')

// 拖拽状态
const draggedIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
const isDragging = ref(false)
const pendingSelectNote = ref<string | null>(null)
const dragStartY = ref(0)
const draggedNoteId = ref<string | null>(null)

// 筛选后的搜索结果
const searchResults = computed(() => {
  let results = noteStore.notes

  // 按关键词搜索
  if (localQuery.value) {
    const query = localQuery.value.toLowerCase()
    results = results.filter(n =>
      n.title.toLowerCase().includes(query) ||
      n.content.toLowerCase().includes(query)
    )
  }

  return results.slice(0, 20) // 限制显示数量
})

// 拖拽开始
function handleMouseDown(e: MouseEvent, noteId: string, index: number) {
  e.preventDefault()
  console.log('[DEBUG drag] handleMouseDown, noteId:', noteId, 'index:', index)
  dragStartY.value = e.clientY
  draggedIndex.value = index
  draggedNoteId.value = noteId
  isDragging.value = false // 还没开始拖拽，需要移动一定距离才触发
}

// 拖拽移动
function handleMouseMove(e: MouseEvent) {
  if (draggedIndex.value === null || !draggedNoteId.value) return

  const deltaY = Math.abs(e.clientY - dragStartY.value)

  // 如果移动距离超过 5px，才算开始拖拽
  if (deltaY > 5 && !isDragging.value) {
    console.log('[DEBUG drag] drag started')
    isDragging.value = true
  }

  if (isDragging.value) {
    e.preventDefault()

    // 计算当前鼠标在哪个列表项上
    const resultsEl = document.querySelector('.search-results')
    if (!resultsEl) return

    const items = resultsEl.querySelectorAll('.result-item')
    let targetIndex = -1

    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect()
      const midY = rect.top + rect.height / 2

      if (e.clientY < midY) {
        targetIndex = i
        break
      }
      targetIndex = i
    }

    if (targetIndex !== -1 && targetIndex !== dragOverIndex.value) {
      console.log('[DEBUG drag] dragOverIndex:', targetIndex)
      dragOverIndex.value = targetIndex
    }
  }
}

// 拖拽结束
function handleMouseUp() {
  console.log('[DEBUG drag] handleMouseUp, isDragging:', isDragging.value, 'draggedNoteId:', draggedNoteId.value)

  if (isDragging.value && draggedIndex.value !== null && dragOverIndex.value !== null) {
    console.log('[DEBUG drag] drop at targetIndex:', dragOverIndex.value)

    // 执行重排序
    const draggedNote = searchResults.value[draggedIndex.value]
    const targetNote = searchResults.value[dragOverIndex.value]

    if (draggedNote && targetNote) {
      const noteIds = [...noteStore.notes.map(n => n.id)]
      const draggedOriginalIndex = noteStore.notes.findIndex(n => n.id === draggedNote.id)
      const targetOriginalIndex = noteStore.notes.findIndex(n => n.id === targetNote.id)

      console.log('[DEBUG drag] original indices - dragged:', draggedOriginalIndex, 'target:', targetOriginalIndex)

      const [removedId] = noteIds.splice(draggedOriginalIndex, 1)
      noteIds.splice(targetOriginalIndex, 0, removedId)

      console.log('[DEBUG drag] final noteIds:', noteIds)
      noteStore.reorderNotes(noteIds)
    }
  } else if (draggedNoteId.value && !isDragging.value) {
    // 非拖拽点击，选择笔记
    console.log('[DEBUG drag] click select note:', draggedNoteId.value)
    selectNote(draggedNoteId.value)
  }

  // 重置状态
  draggedIndex.value = null
  dragOverIndex.value = null
  draggedNoteId.value = null
  isDragging.value = false
  pendingSelectNote.value = null
}

// 格式化日期
function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const oneDay = 24 * 60 * 60 * 1000

  if (diff < oneDay) {
    return '今天'
  } else if (diff < 2 * oneDay) {
    return '昨天'
  } else if (diff < 7 * oneDay) {
    return `${Math.floor(diff / oneDay)}天前`
  } else {
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${month}月${day}日`
  }
}

// 获取内容预览
function getPreview(content: string): string {
  const plainText = content.replace(/[#*`_~\[\]]/g, '').trim()
  return plainText.substring(0, 80) + (plainText.length > 80 ? '...' : '')
}

// 关键词高亮
function highlightKeyword(text: string, keyword: string): string {
  if (!keyword) return text
  const regex = new RegExp(`(${keyword})`, 'gi')
  return text.replace(regex, '<mark>$1</mark>')
}

// 选择笔记
function selectNote(noteId: string) {
  // 如果正在拖拽，延迟选择
  if (isDragging.value) {
    pendingSelectNote.value = noteId
    return
  }

  localQuery.value = ''
  noteStore.selectNote(noteId)
  emit('close')
}

// 关闭页面
function handleCancel() {
  localQuery.value = '' // 清空搜索关键词
  emit('close')
}

// 处理键盘事件
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    handleCancel()
  }
}

onMounted(() => {
  searchInput.value?.focus()
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="search-page">
    <!-- 搜索栏 -->
    <div class="search-header">
      <div class="search-input-wrapper">
        <i class="i-mdi-magnify search-icon"></i>
        <input
          ref="searchInput"
          v-model="localQuery"
          type="text"
          placeholder="搜索笔记..."
          class="search-input"
        />
        <button v-if="localQuery" class="clear-btn" @click="localQuery = ''">
          <i class="i-mdi-close"></i>
        </button>
      </div>
      <button class="cancel-btn" @click="handleCancel">取消</button>
    </div>


    <!-- 搜索结果 -->
    <div
      class="search-results"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
    >
      <div v-if="searchResults.length === 0" class="no-results">
        <template v-if="localQuery">未找到匹配的笔记</template>
        <template v-else>输入关键词开始搜索</template>
      </div>

      <div
        v-for="(note, index) in searchResults"
        :key="note.id"
        class="result-item"
        :class="{ 'is-dragging': isDragging && draggedIndex === index, 'is-drag-over': isDragging && dragOverIndex === index }"
        @mousedown="handleMouseDown($event, note.id, index)"
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
  padding: 16px;
  gap: 12px;
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

.filter-tabs {
  display: flex;
  padding: 0 16px 12px;
  gap: 8px;
  border-bottom: 1px solid var(--color-border);
}

.tab {
  padding: 6px 14px;
  font-size: 13px;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.15s;
}

.tab.active {
  color: white;
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.tab:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
}

.result-item {
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
  -webkit-user-select: none;
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
