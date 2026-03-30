<script setup lang="ts">
import { ref, defineExpose, nextTick } from 'vue'
import type { Editor } from '@tiptap/vue-3'

const props = defineProps<{
  command: (item: { title: string; command: string }) => void
  editor: Editor
  items: Array<{ title: string; command: string }>
  range?: { from: number; to: number }
}>()

const selectedIndex = ref(0)
const listRef = ref<HTMLElement>()

// 滚动到选中项
function scrollToSelected() {
  nextTick(() => {
    if (!listRef.value) return
    const buttons = listRef.value.querySelectorAll('.slash-item')
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
    label: '高级',
    items: [
      { title: 'quote[引用]', command: 'blockquote', icon: '"' },
      { title: 'code[代码]', command: 'code', icon: '<>' },
      { title: 'table[表格]', command: 'table', icon: '⊞' },
    ]
  }
]

// 过滤后的项目（用于显示）
const filteredItems = ref<Array<{ title: string; command: string; icon: string }>>([])

// 根据 query 更新过滤项
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

// 选择项
function selectItem(index: number) {
  const item = filteredItems.value[index]
  if (!item) return

  const editor = props.editor
  if (!editor) return

  // 如果有 range，先删除 / 及搜索文本
  if (props.range) {
    editor.chain().focus().deleteRange(props.range).run()
  }

  // 执行命令
  runCommand(item.command)
}

// 暴露方法给外部
defineExpose({
  onKeyDown: (event: KeyboardEvent) => {
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
  },
  onQueryUpdate: (query: string) => {
    updateFilteredItems(query)
  }
})

// 初始化
updateFilteredItems('')
</script>

<template>
  <div class="slash-command-popup">
    <div ref="listRef" class="slash-command-list">
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
</style>
