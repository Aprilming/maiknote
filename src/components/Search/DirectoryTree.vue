<script setup lang="ts">
import { ref, computed, provide, reactive, onMounted, onUnmounted } from 'vue'
import { useDirectoryStore } from '@/stores/directoryStore'
import { useNoteStore } from '@/stores/noteStore'
import { useI18n } from 'vue-i18n'
import { confirmAction } from '@/composables/useConfirm'
import type { Directory } from '@/types/note'
import DirectoryTreeNode from './DirectoryTreeNode.vue'

const props = withDefaults(defineProps<{
  highlightDirId?: string | null
  isTrashSelected?: boolean
  showTrash?: boolean
  onSelect?: (id: string | null) => void
}>(), {
  showTrash: true,
})

const emit = defineEmits<{
  (e: 'selectTrash'): void
}>()

const directoryStore = useDirectoryStore()
const noteStore = useNoteStore()
const { t } = useI18n()

// 新建目录状态
const creatingIn = ref<string | null | undefined>(undefined)
const newDirName = ref('')

// 重命名状态
const renamingId = ref<string | null>(null)
const renameValue = ref('')

// 展开/折叠状态
const expandedDirs = ref<Set<string>>(new Set())

type DirectoryDropPosition = 'inside' | 'before' | 'after'

// 目录拖拽状态
const draggedDirId = ref<string | null>(null)
const isDirDragging = ref(false)
const dragStartPos = ref({ x: 0, y: 0 })
const dragOverDirId = ref<string | null | undefined>(undefined)
const dragDropPosition = ref<DirectoryDropPosition>('inside')

// 选中的目录
const selectedDirId = computed(() => directoryStore.currentDirectoryId)

function getNoteCount(directoryId: string): number {
  return noteStore.getNotesByDirectory(directoryId).length
}

const rootNoteCount = computed(() => noteStore.getNotesByDirectory(null).length)
const trashNoteCount = computed(() => noteStore.trashedNotes.length)
const shouldShowTrash = computed(() => props.showTrash !== false)

function toggleExpand(id: string) {
  const next = new Set(expandedDirs.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  expandedDirs.value = next
}

function isExpanded(id: string): boolean {
  return expandedDirs.value.has(id)
}

function selectDir(id: string | null) {
  directoryStore.selectDirectory(id)
  props.onSelect?.(id)
}

function selectTrash() {
  emit('selectTrash')
}

function startCreate(parentId: string | null) {
  creatingIn.value = parentId
  newDirName.value = ''
  if (parentId) {
    const next = new Set(expandedDirs.value)
    next.add(parentId)
    expandedDirs.value = next
  }
}

async function confirmCreate() {
  const name = newDirName.value.trim()
  if (name && creatingIn.value !== undefined) {
    await directoryStore.createDirectory(name, creatingIn.value)
    if (creatingIn.value) {
      const next = new Set(expandedDirs.value)
      next.add(creatingIn.value)
      expandedDirs.value = next
    }
  }
  creatingIn.value = undefined
  newDirName.value = ''
}

function cancelCreate() {
  creatingIn.value = undefined
  newDirName.value = ''
}

function startRename(dir: Directory) {
  renamingId.value = dir.id
  renameValue.value = dir.name
}

async function confirmRename() {
  const name = renameValue.value.trim()
  if (name && renamingId.value) {
    await directoryStore.renameDirectory(renamingId.value, name)
  }
  renamingId.value = null
  renameValue.value = ''
}

function cancelRename() {
  renamingId.value = null
  renameValue.value = ''
}

async function handleDelete(id: string, e: MouseEvent) {
  e.stopPropagation()
  const dir = directoryStore.getDirectory(id)
  if (!dir) return
  const count = getNoteCount(id)
  const msg = count > 0
    ? t('dirTree.deleteConfirmWithNotes', { name: dir.name, count })
    : t('dirTree.deleteConfirm', { name: dir.name })
  const confirmed = await confirmAction({ message: msg, confirmText: t('common.delete') })
  if (confirmed) {
    const notesInDir = noteStore.getNotesByDirectory(id)
    for (const note of notesInDir) {
      await noteStore.moveNoteToDirectory(note.id, null)
    }
    await directoryStore.deleteDirectory(id)
  }
}

// 选中输入框文本
function selectInputContent(el: HTMLInputElement | null) {
  el?.select()
}

const effectiveHighlightDirId = computed(() => isDirDragging.value ? dragOverDirId.value : props.highlightDirId)

function onDirPointerDown(e: PointerEvent, id: string) {
  if (renamingId.value === id) return
  draggedDirId.value = id
  dragStartPos.value = { x: e.clientX, y: e.clientY }
  isDirDragging.value = false
  dragOverDirId.value = undefined
  dragDropPosition.value = 'inside'
}

function onDocPointerMove(e: PointerEvent) {
  if (!draggedDirId.value) return

  if (!isDirDragging.value) {
    const dx = Math.abs(e.clientX - dragStartPos.value.x)
    const dy = Math.abs(e.clientY - dragStartPos.value.y)
    if (dx <= 8 && dy <= 8) return
    isDirDragging.value = true
  }

  e.preventDefault()

  const dirEl = document.elementsFromPoint(e.clientX, e.clientY)
    .map(el => (el as HTMLElement).closest('[data-dir-id]') as HTMLElement | null)
    .find((el): el is HTMLElement => !!el)

  if (!dirEl) {
    dragOverDirId.value = undefined
    return
  }

  const raw = dirEl.getAttribute('data-dir-id')
  const targetId = raw === 'root' ? null : raw
  if (targetId === draggedDirId.value) {
    dragOverDirId.value = undefined
    return
  }

  if (targetId && directoryStore.isDescendantOf(targetId, draggedDirId.value)) {
    dragOverDirId.value = undefined
    return
  }

  dragOverDirId.value = targetId

  if (targetId === null) {
    dragDropPosition.value = 'inside'
    return
  }

  const rect = dirEl.getBoundingClientRect()
  const y = e.clientY - rect.top
  const edgeSize = Math.max(6, rect.height * 0.25)
  if (y < edgeSize) {
    dragDropPosition.value = 'before'
  } else if (y > rect.height - edgeSize) {
    dragDropPosition.value = 'after'
  } else {
    dragDropPosition.value = 'inside'
  }
}

async function onDocPointerUp() {
  if (!draggedDirId.value) return

  const sourceId = draggedDirId.value
  const targetId = dragOverDirId.value
  const position = dragDropPosition.value
  const wasDragging = isDirDragging.value
  resetDirectoryDrag()

  if (!wasDragging || targetId === undefined) return

  if (targetId === null) {
    await directoryStore.moveDirectory(sourceId, null)
    return
  }

  if (position === 'inside') {
    await directoryStore.moveDirectory(sourceId, targetId)
    const next = new Set(expandedDirs.value)
    next.add(targetId)
    expandedDirs.value = next
    return
  }

  const target = directoryStore.getDirectory(targetId)
  if (target) {
    await directoryStore.moveDirectory(sourceId, target.parentId, position, targetId)
  }
}

function resetDirectoryDrag() {
  draggedDirId.value = null
  isDirDragging.value = false
  dragOverDirId.value = undefined
  dragDropPosition.value = 'inside'
}

function getDirDropClass(id: string): Record<string, boolean> {
  const isTarget = isDirDragging.value && dragOverDirId.value === id
  return {
    'is-dir-dragging': draggedDirId.value === id,
    'drop-into': isTarget && dragDropPosition.value === 'inside',
    'drag-over-before': isTarget && dragDropPosition.value === 'before',
    'drag-over-after': isTarget && dragDropPosition.value === 'after',
  }
}

onMounted(() => {
  document.addEventListener('pointermove', onDocPointerMove)
  document.addEventListener('pointerup', onDocPointerUp)
})

onUnmounted(() => {
  document.removeEventListener('pointermove', onDocPointerMove)
  document.removeEventListener('pointerup', onDocPointerUp)
  resetDirectoryDrag()
})

// 通过 provide 向递归子组件共享状态和方法
// 使用 reactive 包裹以使 ref 自动解包，子组件中的 v-model 和条件判断才能正常工作
provide('directoryTreeState', reactive({
  selectedDirId,
  creatingIn,
  renamingId,
  expandedDirs,
  newDirName,
  renameValue,
  highlightDirId: effectiveHighlightDirId,
  draggedDirId,
  isDirDragging,
  dragOverDirId,
  dragDropPosition,
  selectDir,
  toggleExpand,
  isExpanded,
  getNoteCount,
  startCreate,
  confirmCreate,
  cancelCreate,
  startRename,
  confirmRename,
  cancelRename,
  handleDelete,
  selectInputContent,
  onDirPointerDown,
  getDirDropClass,
}))
</script>

<template>
  <div class="directory-tree">
    <div class="tree-header">
      <span class="tree-title">{{ $t('dirTree.title') }}</span>
      <i class="i-mdi-folder-plus-outline add-dir-btn" :title="$t('dirTree.newDir')" @click="startCreate(null)"></i>
    </div>

    <div class="tree-content">
      <!-- 根目录 -->
      <div
        class="dir-item"
        :class="{ selected: selectedDirId === null, 'drop-into': effectiveHighlightDirId === null }"
        data-dir-id="root"
        @click="selectDir(null)"
      >
        <span class="dir-toggle placeholder"></span>
        <i class="i-mdi-folder-outline dir-icon"></i>
        <span class="dir-name root-label">{{ $t('dirTree.rootDir') }}</span>
        <span class="dir-count">{{ rootNoteCount || '' }}</span>
      </div>

      <!-- 根目录下的新建输入框 -->
      <div v-if="creatingIn === null" class="dir-create-input-wrapper" style="padding-left: 12px">
        <input
          class="dir-create-input"
          v-model="newDirName"
          :placeholder="$t('dirTree.newDirPlaceholder')"
          @keydown.enter="confirmCreate"
          @keydown.escape="cancelCreate"
          @blur="confirmCreate"
        />
      </div>

      <!-- 递归渲染目录树 -->
      <div class="dir-list">
        <DirectoryTreeNode
          v-for="dir in directoryStore.rootDirectories"
          :key="dir.id"
          :directory="dir"
          :depth="0"
        />
      </div>
    </div>

    <div v-if="directoryStore.rootDirectories.length === 0 && creatingIn === undefined" class="tree-empty">
      {{ $t('dirTree.empty') }}
    </div>

    <div v-if="shouldShowTrash" class="tree-footer">
      <div
        class="dir-item trash-item"
        :class="{ selected: isTrashSelected }"
        @click="selectTrash"
      >
        <span class="dir-toggle placeholder"></span>
        <i class="i-mdi-delete-outline dir-icon"></i>
        <span class="dir-name root-label">{{ $t('trash.title') }}</span>
        <span class="dir-count">{{ trashNoteCount || '' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.directory-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  user-select: none;
}

.tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.add-dir-btn {
  font-size: 16px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.add-dir-btn:hover {
  opacity: 1;
}

.tree-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.tree-footer {
  flex-shrink: 0;
  padding: 8px 0 12px;
  border-top: 1px solid var(--color-border);
}

.trash-item {
  color: var(--color-danger, #ef4444);
}

.trash-item .dir-icon,
.trash-item .dir-name {
  color: inherit;
}

.tree-empty {
  padding: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-secondary);
}
</style>

<!-- 共享样式，同时对 DirectoryTreeNode 生效 -->
<style>
.dir-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  margin: 1px 6px;
  transition: background var(--duration-fast) var(--ease-out);
  position: relative;
  min-height: 28px;
}

.dir-item:active {
  transform: scale(0.985);
}

.dir-item:hover {
  background: var(--color-surface);
}

.dir-item.selected {
  background: var(--color-primary);
  color: white;
}

.dir-item.selected .dir-name {
  color: white;
}

.dir-item.selected .dir-count {
  color: rgba(255, 255, 255, 0.7);
}

.dir-item.selected .dir-actions i {
  color: rgba(255, 255, 255, 0.7);
}

.dir-item.selected .dir-actions i:hover {
  color: white;
}

.dir-item.drop-into {
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  color: var(--color-primary);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 42%, transparent);
}

.dir-item.drop-into::before {
  content: '';
  position: absolute;
  inset: 3px 6px;
  border: 1px dashed color-mix(in srgb, var(--color-primary) 58%, transparent);
  border-radius: 6px;
  pointer-events: none;
}

.dir-item.is-dir-dragging {
  opacity: 0.45;
}

.dir-item.drag-over-before::before,
.dir-item.drag-over-after::after {
  content: '';
  position: absolute;
  left: 22px;
  right: 14px;
  height: 3px;
  background: var(--color-primary);
  border-radius: 999px;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 16%, transparent);
  pointer-events: none;
}

.dir-item.drag-over-before::after,
.dir-item.drag-over-after::before {
  content: '';
  position: absolute;
  left: 12px;
  width: 8px;
  height: 8px;
  border: 2px solid var(--color-primary);
  border-radius: 50%;
  background: var(--color-background);
  pointer-events: none;
  z-index: 1;
}

.dir-item.drag-over-before::before {
  top: -2px;
}

.dir-item.drag-over-before::after {
  top: -5px;
}

.dir-item.drag-over-after::after {
  bottom: -2px;
}

.dir-item.drag-over-after::before {
  bottom: -5px;
}

.dir-item.drop-into .dir-name,
.dir-item.drop-into .dir-icon,
.dir-item.drop-into .dir-count {
  color: var(--color-primary);
}

.dir-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.dir-toggle i {
  font-size: 14px;
  transition: transform var(--duration-fast) var(--ease-out);
  color: var(--color-text-secondary);
}

.dir-toggle i.expanded {
  transform: rotate(90deg);
}

.dir-toggle.placeholder {
  visibility: hidden;
}

.dir-icon {
  font-size: 16px;
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.dir-item.selected .dir-icon {
  color: rgba(255, 255, 255, 0.8);
}

.dir-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
}

.dir-name.root-label {
  font-weight: 500;
}

.dir-count {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-left: 4px;
  min-width: 16px;
  text-align: right;
}

.dir-actions {
  display: none;
  align-items: center;
  gap: 2px;
  margin-left: 4px;
}

.dir-item:hover .dir-actions {
  display: flex;
}

.dir-actions i {
  font-size: 14px;
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.dir-actions i:hover {
  opacity: 1;
  background: rgba(128, 128, 128, 0.15);
}

.dir-rename-input {
  flex: 1;
  font-size: 13px;
  padding: 2px 4px;
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-text);
  outline: none;
  min-width: 0;
  height: 22px;
}

.dir-create-input-wrapper {
  display: flex;
  align-items: center;
  padding: 3px 12px 3px 12px;
}

.dir-create-input {
  flex: 1;
  font-size: 13px;
  padding: 3px 6px;
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-text);
  outline: none;
  min-width: 0;
  height: 24px;
}

.dir-children {
  /* children rendered within */
}
</style>
