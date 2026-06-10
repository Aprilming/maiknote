<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { emojiCategories, filterEmojis, type EmojiItem } from './emojiData'

const props = defineProps<{
  command: (item: { title: string; command: string }) => void
  editor: Editor
  items: Array<{ title: string; command: string }>
  range?: { from: number; to: number }
}>()

type Mode = 'commands' | 'emoji'
const mode = ref<Mode>('commands')

const selectedIndex = ref(0)
const listRef = ref<HTMLElement>()
const emojiSearchRef = ref<HTMLInputElement>()
const emojiQuery = ref('')

// 滚动到选中项
function scrollToSelected() {
  nextTick(() => {
    if (!listRef.value) return
    const buttons = listRef.value.querySelectorAll('.slash-item, .emoji-item')
    const selectedBtn = buttons[selectedIndex.value] as HTMLElement
    if (!selectedBtn) return

    const listHeight = listRef.value.clientHeight
    const itemTop = selectedBtn.offsetTop
    const itemBottom = itemTop + selectedBtn.offsetHeight

    if (itemTop < listRef.value.scrollTop) {
      listRef.value.scrollTop = itemTop
    } else if (itemBottom > listRef.value.scrollTop + listHeight) {
      listRef.value.scrollTop = itemBottom - listHeight
    }
  })
}

// 分组的命令列表
const COMMAND_GROUPS = [
  {
    label: '基础块',
    items: [
      { title: 'H1[标题1]', command: 'heading1', icon: 'H1' },
      { title: 'H2[标题2]', command: 'heading2', icon: 'H2' },
      { title: 'H3[标题3]', command: 'heading3', icon: 'H3' },
    ]
  },
  {
    label: '列表',
    items: [
      { title: 'disorder[无序]', command: 'bulletList', icon: '•' },
      { title: 'ordered[有序]', command: 'orderedList', icon: '1.' },
      { title: 'todo[任务]', command: 'todo', icon: '☑' },
    ]
  },
  {
    label: '插入',
    items: [
      { title: 'emoji[表情]', command: 'emoji', icon: '😊' },
      { title: 'quote[引用]', command: 'blockquote', icon: '"' },
      { title: 'code[代码]', command: 'code', icon: '<>' },
      { title: 'table[表格]', command: 'table', icon: '⊞' },
    ]
  }
]

// 过滤后的命令项
const filteredItems = ref<Array<{ title: string; command: string; icon: string }>>([])

function updateFilteredItems(query: string) {
  if (!query) {
    filteredItems.value = COMMAND_GROUPS.flatMap(g => g.items)
  } else {
    filteredItems.value = COMMAND_GROUPS
      .flatMap(g => g.items)
      .filter(item => item.title.toLowerCase().includes(query.toLowerCase()))
  }
  selectedIndex.value = 0
}

// emoji 搜索结果
const filteredEmojis = computed(() => filterEmojis(emojiQuery.value))

const emojiColumns = 8

// 分页显示（每页 40 个）
const emojiPageSize = 40
const emojiPage = ref(0)

const pagedEmojis = computed(() => {
  const all = filteredEmojis.value
  const totalPages = Math.ceil(all.length / emojiPageSize)
  if (emojiPage.value >= totalPages) emojiPage.value = Math.max(0, totalPages - 1)
  return all.slice(emojiPage.value * emojiPageSize, (emojiPage.value + 1) * emojiPageSize)
})

const hasMoreEmojis = computed(() => {
  return filteredEmojis.value.length > (emojiPage.value + 1) * emojiPageSize
})

// 执行命令
function runCommand(command: string) {
  const editor = props.editor
  if (!editor) return

  switch (command) {
    case 'todo':
      editor.chain().focus().toggleTaskList().run()
      break
    case 'code':
      editor.chain().focus().toggleCodeBlock().run()
      break
    case 'heading1':
      editor.chain().focus().toggleHeading({ level: 1 }).run()
      break
    case 'heading2':
      editor.chain().focus().toggleHeading({ level: 2 }).run()
      break
    case 'heading3':
      editor.chain().focus().toggleHeading({ level: 3 }).run()
      break
    case 'bulletList':
      editor.chain().focus().toggleBulletList().run()
      break
    case 'orderedList':
      editor.chain().focus().toggleOrderedList().run()
      break
    case 'blockquote':
      editor.chain().focus().toggleBlockquote().run()
      break
    case 'table':
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      break
  }
}

// 选择命令项
function selectItem(index: number) {
  const item = filteredItems.value[index]
  if (!item) return

  if (item.command === 'emoji') {
    // 切换到 emoji 模式，暂不删除 range
    mode.value = 'emoji'
    emojiQuery.value = ''
    emojiPage.value = 0
    selectedIndex.value = 0
    nextTick(() => emojiSearchRef.value?.focus())
    return
  }

  const editor = props.editor
  if (!editor) return

  // 删除 / 及搜索文本
  if (props.range) {
    editor.chain().focus().deleteRange(props.range).run()
  }
  runCommand(item.command)
}

// 选择 emoji
function selectEmoji(emoji: EmojiItem) {
  const editor = props.editor
  if (!editor) return

  // 删除 / 及搜索文本，然后插入 emoji
  if (props.range) {
    editor.chain().focus().deleteRange(props.range).insertContent(emoji.emoji).run()
  } else {
    editor.chain().focus().insertContent(emoji.emoji).run()
  }
}

// emoji 行数计算（用于键盘导航）
const emojiRows = computed(() => {
  return Math.ceil(pagedEmojis.value.length / emojiColumns)
})

function emojiIndexToRowCol(index: number): { row: number; col: number } {
  return {
    row: Math.floor(index / emojiColumns),
    col: index % emojiColumns,
  }
}

function emojiRowColToIndex(row: number, col: number): number {
  return row * emojiColumns + col
}

// 暴露方法给外部
defineExpose({
  onKeyDown: (event: KeyboardEvent) => {
    if (mode.value === 'emoji') {
      return handleEmojiKeyDown(event)
    }
    return handleCommandsKeyDown(event)
  },
  onQueryUpdate: (query: string) => {
    if (mode.value === 'commands') {
      updateFilteredItems(query)
    }
  }
})

function handleCommandsKeyDown(event: KeyboardEvent): boolean {
  if (filteredItems.value.length === 0) return false

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + filteredItems.value.length) % filteredItems.value.length
    scrollToSelected()
    return true
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % filteredItems.value.length
    scrollToSelected()
    return true
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    selectItem(selectedIndex.value)
    return true
  }
  return false
}

function handleEmojiKeyDown(event: KeyboardEvent): boolean {
  const total = pagedEmojis.value.length
  if (total === 0) return false

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    const { row, col } = emojiIndexToRowCol(selectedIndex.value)
    if (row > 0) {
      selectedIndex.value = emojiRowColToIndex(row - 1, col)
      if (selectedIndex.value >= total) {
        selectedIndex.value = col // 上一行可能更短，回退到第一行的同列
      }
    }
    scrollToSelected()
    return true
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    const { row, col } = emojiIndexToRowCol(selectedIndex.value)
    const newIndex = emojiRowColToIndex(row + 1, col)
    if (newIndex < total) {
      selectedIndex.value = newIndex
    } else {
      // 没有更多行，翻到下一页
      if (hasMoreEmojis.value) {
        emojiPage.value++
        selectedIndex.value = col
        if (selectedIndex.value >= pagedEmojis.value.length) {
          selectedIndex.value = pagedEmojis.value.length - 1
        }
      }
    }
    scrollToSelected()
    return true
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    if (selectedIndex.value > 0) {
      selectedIndex.value--
    }
    scrollToSelected()
    return true
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    if (selectedIndex.value < total - 1) {
      selectedIndex.value++
    } else if (hasMoreEmojis.value) {
      // 到末尾翻下一页
      emojiPage.value++
      selectedIndex.value = 0
    }
    scrollToSelected()
    return true
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const emoji = pagedEmojis.value[selectedIndex.value]
    if (emoji) {
      selectEmoji(emoji)
    }
    return true
  }
  if (event.key === 'Backspace') {
    if (emojiQuery.value === '') {
      // 搜索为空时，Backspace 返回命令列表
      event.preventDefault()
      mode.value = 'commands'
      updateFilteredItems('')
      return true
    }
    return false
  }
  return false
}

// 搜索输入框键盘事件处理（独立于编辑器键盘事件）
function onEmojiSearchKeydown(event: KeyboardEvent) {
  // 让字符输入正常传递
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return // 字符输入交给 input 处理
  }
  // 导航和功能键由 handleEmojiKeyDown 处理
  handleEmojiKeyDown(event)
}

// 初始化
updateFilteredItems('')
</script>

<template>
  <div class="slash-command-popup">
    <!-- 命令列表模式 -->
    <div v-if="mode === 'commands'" ref="listRef" class="slash-command-list">
      <template v-if="filteredItems.length === 0">
        <div class="slash-empty">无匹配命令</div>
      </template>
      <template v-else>
        <button
          v-for="(item, index) in filteredItems"
          :key="item.command + index"
          class="slash-item"
          :class="{ 'is-selected': index === selectedIndex }"
          @click="selectItem(index)"
          @mouseenter="selectedIndex = index"
        >
          <span class="slash-icon">{{ item.icon }}</span>
          <span class="slash-title">{{ item.title }}</span>
        </button>
      </template>
    </div>

    <!-- Emoji 选择模式 -->
    <div v-else class="emoji-picker">
      <div class="emoji-header">
        <input
          ref="emojiSearchRef"
          v-model="emojiQuery"
          class="emoji-search"
          placeholder="搜索 emoji..."
          @keydown="onEmojiSearchKeydown"
        />
        <button class="emoji-back-btn" title="返回命令列表" @click="mode = 'commands'; updateFilteredItems('')">
          <i class="i-mdi-arrow-left"></i>
        </button>
      </div>
      <div ref="listRef" class="emoji-grid-wrap">
        <template v-if="filteredEmojis.length === 0">
          <div class="slash-empty">无匹配 emoji</div>
        </template>
        <template v-else>
          <!-- 搜索结果分类显示（仅无搜索词时显示分类） -->
          <template v-if="!emojiQuery">
            <div
              v-for="cat in emojiCategories"
              :key="cat.label"
              class="emoji-category"
            >
              <div class="emoji-category-label">{{ cat.label }}</div>
              <div class="emoji-grid">
                <button
                  v-for="(emoji, i) in cat.items"
                  :key="emoji.emoji"
                  class="emoji-item"
                  :class="{ 'is-selected': false }"
                  :title="emoji.name"
                  @click="selectEmoji(emoji)"
                >
                  {{ emoji.emoji }}
                </button>
              </div>
            </div>
          </template>
          <!-- 搜索模式 -->
          <template v-else>
            <div class="emoji-grid">
              <button
                v-for="(emoji, i) in pagedEmojis"
                :key="emoji.emoji"
                class="emoji-item"
                :class="{ 'is-selected': i === selectedIndex }"
                :title="emoji.name"
                @click="selectEmoji(emoji)"
                @mouseenter="selectedIndex = i"
              >
                {{ emoji.emoji }}
              </button>
            </div>
            <div v-if="hasMoreEmojis" class="emoji-more">
              继续输入搜索...
            </div>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.slash-command-popup {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.slash-command-list {
  padding: 6px;
  min-width: 180px;
  max-height: 320px;
  overflow-y: auto;
}

.slash-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text);
  text-align: left;
  transition: background 0.1s;
}

.slash-item:hover,
.slash-item.is-selected {
  background: var(--color-surface);
}

.slash-icon {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface);
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.slash-title {
  flex: 1;
}

.slash-empty {
  padding: 16px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 13px;
}

/* Emoji picker */
.emoji-picker {
  width: 340px;
}

.emoji-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--color-border);
}

.emoji-search {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
  outline: none;
}

.emoji-search:focus {
  border-color: var(--color-primary);
}

.emoji-search::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.emoji-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  transition: background 0.1s;
  flex-shrink: 0;
}

.emoji-back-btn:hover {
  background: var(--color-surface);
}

.emoji-back-btn i {
  font-size: 18px;
}

.emoji-grid-wrap {
  max-height: 300px;
  overflow-y: auto;
  padding: 6px;
}

.emoji-category {
  margin-bottom: 4px;
}

.emoji-category-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  padding: 6px 4px 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
}

.emoji-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  transition: all 0.1s;
}

.emoji-item:hover {
  background: var(--color-surface);
  transform: scale(1.15);
}

.emoji-item.is-selected {
  background: var(--color-surface);
  border-color: var(--color-primary);
}

.emoji-more {
  padding: 10px;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-secondary);
  opacity: 0.6;
}

</style>
