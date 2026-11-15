<template>
  <div ref="rootRef" class="note-picker" @mousedown.prevent>
    <div class="note-picker-search">
      <span class="i-mdi-magnify note-picker-search-icon" />
      <input
        ref="inputRef"
        v-model="query"
        class="note-picker-input"
        type="text"
        :placeholder="placeholder"
        spellcheck="false"
        @keydown="handleKeydown"
      />
    </div>

    <div ref="listRef" class="note-picker-list">
      <button
        v-for="(item, index) in options"
        :key="item.id"
        type="button"
        class="note-picker-item"
        :class="{ 'is-active': index === selectedIndex, 'is-new': item.isNew }"
        @mouseenter="selectedIndex = index"
        @click="pick(item)"
      >
        <i v-if="item.isNew" class="note-picker-icon i-mdi-plus-circle-outline"></i>
        <i v-else class="note-picker-icon i-mdi-note-text-outline"></i>
        <span class="note-picker-title">{{ item.title }}</span>
      </button>

      <div v-if="!options.length" class="note-picker-empty">{{ emptyText }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

export interface NotePickerItem {
  id: string
  title: string
  isNew?: boolean
}

const props = withDefaults(
  defineProps<{
    notes: NotePickerItem[]
    placeholder?: string
    emptyText?: string
    createLabel?: string
    initialQuery?: string
  }>(),
  {
    placeholder: '搜索笔记标题…',
    emptyText: '没有匹配的笔记',
    createLabel: '新建',
    initialQuery: '',
  },
)

const emit = defineEmits<{
  (e: 'select', title: string, isNew: boolean): void
  (e: 'cancel'): void
  // 列表高度变化时通知外层重新定位弹窗（否则弹窗会顶出窗口下沿被裁掉）
  (e: 'resize'): void
}>()

const query = ref(props.initialQuery)
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const rootRef = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null
let resizeRaf = 0

const matches = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = q
    ? props.notes.filter((note) => (note.title || '').toLowerCase().includes(q))
    : props.notes
  return list.slice(0, 60)
})

// 输入了但没有任何同名笔记时，给一条「新建」入口
const canCreate = computed(() => {
  const q = query.value.trim()
  if (!q) return false
  return !matches.value.some((note) => (note.title || '').toLowerCase() === q.toLowerCase())
})

const options = computed<NotePickerItem[]>(() => {
  const list: NotePickerItem[] = matches.value.map((note) => ({ id: note.id, title: note.title }))
  if (canCreate.value) {
    list.push({
      id: '__create__',
      title: `${props.createLabel}「${query.value.trim()}」`,
      isNew: true,
    })
  }
  return list
})

watch(options, () => {
  selectedIndex.value = 0
})

watch(selectedIndex, () => {
  nextTick(() => {
    const active = listRef.value?.querySelector('.note-picker-item.is-active')
    active?.scrollIntoView({ block: 'nearest' })
  })
})

onMounted(() => {
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })

  if (rootRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (resizeRaf) return
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0
        emit('resize')
      })
    })
    resizeObserver.observe(rootRef.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (resizeRaf) cancelAnimationFrame(resizeRaf)
})

function pick(item: NotePickerItem) {
  const isNew = item.id === '__create__'
  emit('select', isNew ? query.value.trim() : item.title, isNew)
}

function onKeyDown(event: KeyboardEvent): boolean {
  const total = options.value.length

  if (event.key === 'ArrowDown') {
    if (!total) return true
    selectedIndex.value = (selectedIndex.value + 1) % total
    return true
  }

  if (event.key === 'ArrowUp') {
    if (!total) return true
    selectedIndex.value = (selectedIndex.value - 1 + total) % total
    return true
  }

  if (event.key === 'Enter') {
    const item = options.value[selectedIndex.value]
    if (item) pick(item)
    return true
  }

  if (event.key === 'Escape') {
    emit('cancel')
    return true
  }

  return false
}

// 焦点在弹窗输入框里时编辑器收不到按键，方向键/回车要在这里就地处理
function handleKeydown(event: KeyboardEvent) {
  if (onKeyDown(event)) {
    event.preventDefault()
    event.stopPropagation()
  }
}

/** 让命令里的上下键先进到选择器，而不是编辑器的 Backspace/方向键逻辑 */
function onBackspace(): boolean {
  emit('cancel')
  return true
}

defineExpose({ onKeyDown, onBackspace })
</script>

<style scoped>
.note-picker {
  width: 288px;
  max-height: 320px;
  display: flex;
  flex-direction: column;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  font-size: 13px;
}

.note-picker-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.note-picker-search-icon {
  font-size: 14px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.note-picker-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-text);
  font-size: 13px;
}

.note-picker-input::placeholder {
  color: var(--color-text-secondary);
}

.note-picker-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
}

.note-picker-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  font-size: 13px;
}

.note-picker-item.is-active {
  background: var(--color-surface);
}

.note-picker-item.is-new .note-picker-icon,
.note-picker-item.is-new .note-picker-title {
  color: var(--color-primary);
}

.note-picker-icon {
  font-size: 15px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.note-picker-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-picker-empty {
  padding: 14px 8px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 12px;
}
</style>
