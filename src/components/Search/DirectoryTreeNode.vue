<script setup lang="ts">
import { inject, computed } from 'vue'
import { useDirectoryStore } from '@/stores/directoryStore'
import { useI18n } from 'vue-i18n'
import type { Directory } from '@/types/note'

interface TreeState {
  selectedDirId: string | null
  creatingIn: string | null | undefined
  renamingId: string | null
  expandedDirs: Set<string>
  newDirName: string
  renameValue: string
  highlightDirId?: string | null
  selectDir: (id: string | null) => void
  toggleExpand: (id: string) => void
  isExpanded: (id: string) => boolean
  getNoteCount: (id: string) => number
  startCreate: (parentId: string | null) => void
  confirmCreate: () => void
  cancelCreate: () => void
  startRename: (dir: Directory) => void
  confirmRename: () => void
  cancelRename: () => void
  handleDelete: (id: string, e: MouseEvent) => void
  selectInputContent: (el: HTMLInputElement | null) => void
}

const props = defineProps<{
  directory: Directory
  depth: number
}>()

const treeState = inject<TreeState>('directoryTreeState')!
const directoryStore = useDirectoryStore()
useI18n()

const children = computed(() => directoryStore.getChildren(props.directory.id))
</script>

<template>
  <div class="dir-wrapper">
    <div
      class="dir-item"
      :class="{
        selected: treeState.selectedDirId === directory.id,
        'drag-over': treeState.highlightDirId === directory.id
      }"
      :data-dir-id="directory.id"
      :style="{ paddingLeft: 12 + depth * 16 + 'px' }"
      @click="treeState.selectDir(directory.id)"
      @dblclick="treeState.startRename(directory)"
    >
      <span
        v-if="children.length > 0"
        class="dir-toggle"
        @click.stop="treeState.toggleExpand(directory.id)"
      >
        <i class="i-mdi-chevron-right" :class="{ expanded: treeState.isExpanded(directory.id) }"></i>
      </span>
      <span v-else class="dir-toggle placeholder"></span>

      <i class="i-mdi-folder-outline dir-icon"></i>

      <template v-if="treeState.renamingId === directory.id">
        <input
          class="dir-rename-input"
          v-model="treeState.renameValue"
          @blur="treeState.confirmRename"
          @keydown.enter="treeState.confirmRename"
          @keydown.escape="treeState.cancelRename"
          @click.stop
          :ref="(el: any) => treeState.selectInputContent(el as HTMLInputElement)"
          autofocus
        />
      </template>
      <template v-else>
        <span class="dir-name">{{ directory.name }}</span>
      </template>

      <span class="dir-count">{{ treeState.getNoteCount(directory.id) || '' }}</span>

      <span class="dir-actions">
        <i class="i-mdi-plus" :title="$t('dirTree.newSubdir')" @click.stop="treeState.startCreate(directory.id)"></i>
        <i class="i-mdi-pencil" :title="$t('dirTree.rename')" @click.stop="treeState.startRename(directory)"></i>
        <i class="i-mdi-delete" :title="$t('common.delete')" @click.stop="(e: MouseEvent) => treeState.handleDelete(directory.id, e)"></i>
      </span>
    </div>

    <!-- 在当前目录下创建子目录的输入框 -->
    <div v-if="treeState.creatingIn === directory.id" class="dir-create-input-wrapper" :style="{ paddingLeft: 12 + (depth + 1) * 16 + 'px' }">
      <input
        class="dir-create-input"
        v-model="treeState.newDirName"
        :placeholder="$t('dirTree.subdirPlaceholder')"
        @keydown.enter="treeState.confirmCreate"
        @keydown.escape="treeState.cancelCreate"
        @blur="treeState.confirmCreate"
        autofocus
      />
    </div>

    <!-- 递归渲染子目录 -->
    <div v-if="treeState.isExpanded(directory.id) && children.length > 0" class="dir-children">
      <DirectoryTreeNode
        v-for="child in children"
        :key="child.id"
        :directory="child"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>
