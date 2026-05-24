<script setup lang="ts">
import { ref, computed, provide, reactive } from 'vue'
import { useDirectoryStore } from '@/stores/directoryStore'
import { useNoteStore } from '@/stores/noteStore'
import type { Directory } from '@/types/note'
import DirectoryTreeNode from './DirectoryTreeNode.vue'

const props = defineProps<{
  highlightDirId?: string | null
  onSelect?: (id: string | null) => void
}>()

const directoryStore = useDirectoryStore()
const noteStore = useNoteStore()

// 新建目录状态
const creatingIn = ref<string | null | undefined>(undefined)
const newDirName = ref('')

// 重命名状态
const renamingId = ref<string | null>(null)
const renameValue = ref('')

// 展开/折叠状态
const expandedDirs = ref<Set<string>>(new Set())

// 选中的目录
const selectedDirId = computed(() => directoryStore.currentDirectoryId)

function getNoteCount(directoryId: string): number {
  return noteStore.getNotesByDirectory(directoryId).length
}

const rootNoteCount = computed(() => noteStore.getNotesByDirectory(null).length)

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
    ? `删除目录"${dir.name}"？目录下 ${count} 篇笔记将移回根目录。`
    : `删除目录"${dir.name}"？`
  if (confirm(msg)) {
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

const highlightDirId = computed(() => props.highlightDirId)

// 通过 provide 向递归子组件共享状态和方法
// 使用 reactive 包裹以使 ref 自动解包，子组件中的 v-model 和条件判断才能正常工作
provide('directoryTreeState', reactive({
  selectedDirId,
  creatingIn,
  renamingId,
  expandedDirs,
  newDirName,
  renameValue,
  highlightDirId,
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
}))
</script>

<template>
  <div class="directory-tree">
    <div class="tree-header">
      <span class="tree-title">目录</span>
      <i class="i-mdi-folder-plus-outline add-dir-btn" title="新建目录" @click="startCreate(null)"></i>
    </div>

    <div class="tree-content">
      <!-- 根目录 -->
      <div
        class="dir-item"
        :class="{ selected: selectedDirId === null, 'drag-over': highlightDirId === null }"
        data-dir-id="root"
        @click="selectDir(null)"
      >
        <span class="dir-toggle placeholder"></span>
        <i class="i-mdi-folder-outline dir-icon"></i>
        <span class="dir-name root-label">主目录</span>
        <span class="dir-count">{{ rootNoteCount || '' }}</span>
      </div>

      <!-- 根目录下的新建输入框 -->
      <div v-if="creatingIn === null" class="dir-create-input-wrapper" style="padding-left: 12px">
        <input
          class="dir-create-input"
          v-model="newDirName"
          placeholder="新建目录..."
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

    <!-- 空状态 -->
    <div v-if="directoryStore.rootDirectories.length === 0 && creatingIn === undefined" class="tree-empty">
      点击 + 创建目录
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
  transition: opacity 0.15s;
}

.add-dir-btn:hover {
  opacity: 1;
}

.tree-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
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
  border-radius: 6px;
  margin: 1px 6px;
  transition: background 0.1s;
  position: relative;
  min-height: 28px;
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

.dir-item.drag-over {
  background: var(--color-primary);
  opacity: 0.7;
  outline: 2px dashed rgba(255, 255, 255, 0.6);
  outline-offset: -2px;
}

.dir-item.drag-over .dir-name,
.dir-item.drag-over .dir-icon,
.dir-item.drag-over .dir-count {
  color: white;
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
  transition: transform 0.15s;
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
