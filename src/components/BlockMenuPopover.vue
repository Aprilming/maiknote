<!-- src/components/BlockMenuPopover.vue -->
<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="bm-popover"
      :style="{ top: `${pos.y}px`, left: `${pos.x}px` }"
      @click.stop
    >
      <!-- 转换块类型 -->
      <div class="bm-section-label">转换为</div>
      <button
        v-for="t in BLOCK_TYPES"
        :key="t.name"
        class="bm-item"
        @click="convert(t)"
      >
        <span class="bm-icon">{{ t.icon }}</span>{{ t.label }}
      </button>

<!--      <div class="bm-divider" />-->

<!--      &lt;!&ndash; 字体样式 &ndash;&gt;-->
<!--      <div class="bm-section-label">文字样式</div>-->

<!--      &lt;!&ndash; 字重 &ndash;&gt;-->
<!--      <div class="bm-row">-->
<!--        <span class="bm-row-label">字重</span>-->
<!--        <div class="bm-size-buttons">-->
<!--          <button class="bm-size-btn" @click="editor?.chain().focus().setBold().run()">粗体</button>-->
<!--          <button class="bm-size-btn" @click="editor?.chain().focus().unsetBold().run()">正常</button>-->
<!--        </div>-->
<!--      </div>-->

<!--      &lt;!&ndash; 字体颜色 &ndash;&gt;-->
<!--      <div class="bm-row">-->
<!--        <span class="bm-row-label">字色</span>-->
<!--        <div class="bm-colors">-->
<!--          <button-->
<!--            v-for="c in TEXT_COLORS"-->
<!--            :key="c.value"-->
<!--            class="bm-color-dot"-->
<!--            :style="{ background: c.value, border: c.value === 'inherit' ? '1px solid #ccc' : 'none' }"-->
<!--            :title="c.label"-->
<!--            @click="setTextColor(c.value)"-->
<!--          />-->
<!--        </div>-->
<!--      </div>-->

<!--      &lt;!&ndash; 背景色 &ndash;&gt;-->
<!--      <div class="bm-row">-->
<!--        <span class="bm-row-label">背景</span>-->
<!--        <div class="bm-colors">-->
<!--          <button-->
<!--            v-for="c in BG_COLORS"-->
<!--            :key="c.value"-->
<!--            class="bm-color-dot"-->
<!--            :style="{ background: c.value, border: c.value === 'none' ? '1px solid #ccc' : 'none' }"-->
<!--            :title="c.label"-->
<!--            @click="setBgColor(c.value)"-->
<!--          />-->
<!--        </div>-->
<!--      </div>-->

      <div class="bm-divider" />

      <!-- 块操作 -->
      <button class="bm-item" @click="duplicate">
        <span class="bm-icon">⎘</span>复制块
      </button>
      <button class="bm-item" @click="moveUp">
        <span class="bm-icon">↑</span>上移
      </button>
      <button class="bm-item" @click="moveDown">
        <span class="bm-icon">↓</span>下移
      </button>

      <div class="bm-divider" />

      <button class="bm-item danger" @click="remove">
        <span class="bm-icon">✕</span>删除块
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import type { Editor } from '@tiptap/vue-3'

const props = defineProps<{ editor: Editor | undefined }>()

const visible = ref(false)
const pos = ref({ x: 0, y: 0 })
const menuRef = ref<HTMLElement>()
const currentPos = ref(0)
const currentNodeSize = ref(0)

// ---- 数据 ----

const BLOCK_TYPES = [
  { name: 'paragraph', icon: '¶', label: '文本',
    run: (e: Editor) => e.chain().focus().setParagraph().run() },
  { name: 'h1', icon: 'H1', label: '标题 1',
    run: (e: Editor) => e.chain().focus().setHeading({ level: 1 }).run() },
  { name: 'h2', icon: 'H2', label: '标题 2',
    run: (e: Editor) => e.chain().focus().setHeading({ level: 2 }).run() },
  { name: 'h3', icon: 'H3', label: '标题 3',
    run: (e: Editor) => e.chain().focus().setHeading({ level: 3 }).run() },
  { name: 'bulletList', icon: '•', label: '无序列表',
    run: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { name: 'orderedList', icon: '1.', label: '有序列表',
    run: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
  { name: 'taskList', icon: '☑', label: '待办',
    run: (e: Editor) => e.chain().focus().toggleTaskList().run() },
  { name: 'blockquote', icon: '"', label: '引用',
    run: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { name: 'codeBlock', icon: '<>', label: '代码块',
    run: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
]

const TEXT_COLORS = [
  { label: '默认', value: 'inherit' },
  { label: '红', value: '#e03e3e' },
  { label: '橙', value: '#d9730d' },
  { label: '黄', value: '#dfab01' },
  { label: '绿', value: '#0f7b6c' },
  { label: '蓝', value: '#0b6e99' },
  { label: '紫', value: '#6940a5' },
  { label: '灰', value: '#787774' },
]

const BG_COLORS = [
  { label: '无', value: 'none' },
  { label: '红', value: '#fddede' },
  { label: '橙', value: '#fdecc8' },
  { label: '黄', value: '#fef3b7' },
  { label: '绿', value: '#dbeddb' },
  { label: '蓝', value: '#d3e5ef' },
  { label: '紫', value: '#e8deee' },
  { label: '灰', value: '#e3e2e0' },
]

// ---- 操作 ----

function focusBlock() {
  props.editor?.chain().focus().setNodeSelection(currentPos.value).run()
}

function convert(type: typeof BLOCK_TYPES[0]) {
  focusBlock()
  type.run(props.editor!)
  close()
}

function setTextColor(color: string) {
  focusBlock()
  if (color === 'inherit') {
    props.editor?.chain().focus().unsetColor().run()
  } else {
    props.editor?.chain().focus().setColor(color).run()
  }
  close()
}

function setBgColor(color: string) {
  focusBlock()
  if (color === 'none') {
    props.editor?.chain().focus().unsetHighlight().run()
  } else {
    props.editor?.chain().focus().setHighlight({ color }).run()
  }
  close()
}

function duplicate() {
  if (!props.editor) return
  const pos = currentPos.value
  const node = props.editor.state.doc.nodeAt(pos)
  if (!node) return
  props.editor
    .chain()
    .focus()
    .insertContentAt(pos + node.nodeSize, node.toJSON())
    .run()
  close()
}

function remove() {
  if (!props.editor) return
  const pos = currentPos.value
  const size = currentNodeSize.value
  props.editor
    .chain()
    .focus()
    .deleteRange({ from: pos, to: pos + size })
    .run()
  close()
}

function moveUp() {
  if (!props.editor) return
  const { state } = props.editor
  const pos = currentPos.value
  const $pos = state.doc.resolve(pos)
  if ($pos.index($pos.depth) === 0) return
  const node = state.doc.nodeAt(pos)
  const nodeBefore = $pos.nodeBefore
  if (!node || !nodeBefore) return
  const from = pos - nodeBefore.nodeSize
  props.editor
    .chain()
    .focus()
    .deleteRange({ from: pos, to: pos + node.nodeSize })
    .insertContentAt(from, node.toJSON())
    .run()
  close()
}

function moveDown() {
  if (!props.editor) return
  const { state } = props.editor
  const pos = currentPos.value
  const node = state.doc.nodeAt(pos)
  if (!node) return
  const nextPos = pos + node.nodeSize
  const nextNode = state.doc.nodeAt(nextPos)
  if (!nextNode) return
  props.editor
    .chain()
    .focus()
    .deleteRange({ from: pos, to: pos + node.nodeSize })
    .insertContentAt(pos + nextNode.nodeSize, node.toJSON())
    .run()
  close()
}

function open(detail: { pos: number; nodeSize: number; rect: DOMRect }) {
  currentPos.value = detail.pos
  currentNodeSize.value = detail.nodeSize

  // 初始位置：按钮右侧，顶部对齐
  let x = detail.rect.right + 8
  let y = detail.rect.top - 8

  // 检查右侧是否超出屏幕
  if (x + 200 > window.innerWidth) {
    x = detail.rect.left - 208
  }
  if (x < 0) x = 8

  pos.value = { x, y }
  visible.value = true

  // 菜单渲染后，检查是否超出底部，并调整
  nextTick(() => {
    if (!menuRef.value) return
    const menuHeight = menuRef.value.offsetHeight
    const menuBottom = y + menuHeight

    if (menuBottom > window.innerHeight) {
      // 如果超出底部，尝试上移
      y = window.innerHeight - menuHeight - 8
    }
    if (y < 0) y = 8

    pos.value = { x, y }
  })
}

function close() {
  visible.value = false
}

function handleOpen(e: Event) {
  open((e as CustomEvent).detail)
}

onMounted(() => {
  document.addEventListener('block-menu-open', handleOpen)
  document.addEventListener('click', close)
})

onUnmounted(() => {
  document.removeEventListener('block-menu-open', handleOpen)
  document.removeEventListener('click', close)
})
</script>

<style scoped>
.bm-popover {
  position: fixed;
  z-index: 9999;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  padding: 6px;
  min-width: 200px;
  max-height: 80vh;
  overflow-y: auto;
}

.bm-section-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary);
  padding: 4px 10px 2px;
}

.bm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text);
  text-align: left;
  transition: background 0.1s;
}
.bm-item:hover { background: var(--color-surface); }
.bm-item.danger { color: var(--color-danger); }
.bm-item.danger:hover { background: rgba(224, 62, 62, 0.08); }

.bm-icon {
  width: 22px;
  height: 22px;
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

.bm-divider {
  height: 1px;
  background: var(--color-border);
  margin: 4px 0;
}

/* 字号 / 字重行 */
.bm-row {
  display: flex;
  align-items: center;
  padding: 4px 10px;
  gap: 8px;
}
.bm-row-label {
  font-size: 12px;
  color: var(--color-text-secondary);
  width: 28px;
  flex-shrink: 0;
}
.bm-size-buttons {
  display: flex;
  gap: 4px;
}
.bm-size-btn {
  padding: 3px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text);
  transition: all 0.1s;
}
.bm-size-btn:hover, .bm-size-btn.active {
  background: var(--color-primary);
  color: #fff;
  border-color: transparent;
}

/* 颜色点 */
.bm-colors {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.bm-color-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.1s;
}
.bm-color-dot:hover { transform: scale(1.2); }
</style>
