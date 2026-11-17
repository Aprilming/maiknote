import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Directory, DirectoryData } from '@/types/note'
import { useFileSystem } from '@/composables/useFileSystem'
import { directoryRelPath } from '@/utils/notePath'
import { useWorkspaceStore } from '@/stores/workspaceStore'

export const useDirectoryStore = defineStore('directory', () => {
  const fs = useFileSystem()

  // State
  const directories = ref<Directory[]>([])
  const rootDirColor = ref<string | undefined>(undefined)
  const currentDirectoryId = ref<string | null>(null) // null = root
  const isLoading = ref(false)
  /** 最近一次磁盘 / 目录索引写入失败的原因（null = 正常）；上层可读来提示用户 */
  const saveError = ref<string | null>(null)

  /** 落盘失败的统一出口：打印上下文 + 记进 saveError，由调用方决定回滚还是交给下次加载自愈 */
  function recordSaveError(context: string, e: unknown): void {
    console.error(context, e)
    saveError.value = e instanceof Error ? e.message : String(e)
  }

  /** localStorage 按工作空间隔离，切空间不会互相污染「上次选中的目录」 */
  function workspaceScopedKey(key: string): string {
    return `${key}:${useWorkspaceStore().currentId || 'icloud'}`
  }

  // 监听 currentDirectoryId 变化，保存到 localStorage
  watch(currentDirectoryId, (newId) => {
    if (newId !== undefined) {
      localStorage.setItem(workspaceScopedKey('lastSelectedDirectoryId'), newId ?? '')
    }
  })

  /** 从 localStorage 恢复上次选择的目录 */
  function restoreLastDirectory(): string | null {
    const saved =
      localStorage.getItem(workspaceScopedKey('lastSelectedDirectoryId')) ??
      localStorage.getItem('lastSelectedDirectoryId')
    if (saved && saved !== '') {
      // 确保该目录仍然存在
      const dir = directories.value.find(d => d.id === saved)
      if (dir) {
        currentDirectoryId.value = saved
        return saved
      }
    }
    currentDirectoryId.value = null
    return null
  }

  // Getters
  const rootDirectories = computed(() =>
    directories.value.filter(d => d.parentId === null)
  )

  function getChildren(parentId: string): Directory[] {
    return directories.value.filter(d => d.parentId === parentId)
  }

  function getDirectory(id: string): Directory | undefined {
    return directories.value.find(d => d.id === id)
  }

  function getFlattenedDirectoryIds(): (string | null)[] {
    const ids: (string | null)[] = [null]

    function appendChildren(parentId: string | null) {
      for (const dir of directories.value.filter(d => d.parentId === parentId)) {
        ids.push(dir.id)
        appendChildren(dir.id)
      }
    }

    appendChildren(null)
    return ids
  }

  function getAdjacentDirectoryId(direction: 'prev' | 'next'): string | null {
    const ids = getFlattenedDirectoryIds()
    const currentIndex = ids.findIndex(id => id === currentDirectoryId.value)
    const index = currentIndex === -1 ? 0 : currentIndex
    const nextIndex = direction === 'prev'
      ? Math.max(0, index - 1)
      : Math.min(ids.length - 1, index + 1)

    return ids[nextIndex] ?? null
  }

  // Actions
  async function loadDirectories(): Promise<void> {
    if (isLoading.value) return
    isLoading.value = true

    try {
      const data = await fs.readDirectories()
      directories.value = data.directories
      rootDirColor.value = data.rootDirColor
      // 这次读成功 = 索引恢复可信，之前因「拒绝写回」留下的错误提示随之解除
      if (!fs.getDirectoriesIndexError()) saveError.value = null
    } catch (e) {
      console.error('Failed to load directories:', e)
    } finally {
      isLoading.value = false
    }
  }

  /** 切换工作空间后重新加载目录树（先清空旧空间的状态） */
  async function reload(): Promise<void> {
    directories.value = []
    rootDirColor.value = undefined
    currentDirectoryId.value = null
    await loadDirectories()
    restoreLastDirectory()
  }

  async function saveDirectories(): Promise<void> {
    // 索引没读成功时，内存里这棵树是 readDirectories 给的占位空树：写回去等于抹掉整棵目录索引。
    // 不抛错（调用点散落在拖拽 / 改名 / 删除等手势里，抛出去就是 unhandled rejection），
    // 改成拒绝写入 + 把原因记进 saveError；readDirectories 下一次成功加载会自动解除标志。
    const indexLoadError = fs.getDirectoriesIndexError()
    if (indexLoadError) {
      recordSaveError(
        'Refusing to overwrite directories.json: index failed to load',
        new Error(indexLoadError)
      )
      return
    }
    const data: DirectoryData = {
      version: 1,
      directories: directories.value,
      rootDirColor: rootDirColor.value,
    }
    await fs.writeDirectories(data)
  }

  async function createDirectory(name: string, parentId: string | null = null): Promise<Directory> {
    const now = Date.now()
    const newDir: Directory = {
      id: crypto.randomUUID(),
      name,
      parentId,
      createdAt: now,
      updatedAt: now,
    }
    directories.value.push(newDir)
    // 在 iCloud 中创建实际文件夹（按目录真实名字）
    const relPath = directoryRelPath(directories.value, newDir.id)
    try {
      if (relPath) await fs.createDirectoryFolder(relPath)
      await saveDirectories()
      saveError.value = null
    } catch (e) {
      // 文件夹或索引没写成功：把目录从内存回滚，树里不留一个磁盘上不存在的目录
      recordSaveError(`Failed to create directory "${name}" on disk, rolled back:`, e)
      const failedIndex = directories.value.findIndex(d => d.id === newDir.id)
      if (failedIndex !== -1) directories.value.splice(failedIndex, 1)
    }
    return newDir
  }

  async function renameDirectory(id: string, newName: string): Promise<void> {
    const dir = directories.value.find(d => d.id === id)
    if (dir) {
      const oldRel = directoryRelPath(directories.value, id)
      const oldName = dir.name
      const oldUpdatedAt = dir.updatedAt
      dir.name = newName
      dir.updatedAt = Date.now()
      const newRel = directoryRelPath(directories.value, id)
      try {
        await saveDirectories()
        if (oldRel && newRel && oldRel !== newRel) {
          await fs.renameDirectoryFolder(oldRel, newRel)
        }
        saveError.value = null
      } catch (e) {
        // 改名没走完：内存退回旧名字并再存一次索引，别让「显示新名、索引旧名、磁盘旧文件夹」三方错位
        recordSaveError(`Failed to rename directory "${oldName}" -> "${newName}":`, e)
        dir.name = oldName
        dir.updatedAt = oldUpdatedAt
        try {
          await saveDirectories()
        } catch (e2) {
          recordSaveError('Failed to restore directories after rename failure:', e2)
        }
      }
    }
  }

  /** 设置文件树里该目录的显示颜色（undefined = 恢复默认） */
  async function setDirectoryColor(id: string, color: string | undefined): Promise<void> {
    const dir = directories.value.find(d => d.id === id)
    if (!dir) return
    const oldColor = dir.color
    const oldUpdatedAt = dir.updatedAt
    dir.color = color
    dir.updatedAt = Date.now()
    try {
      await saveDirectories()
      saveError.value = null
    } catch (e) {
      // 颜色没进索引：回滚内存，避免下次加载时颜色自己变回去
      recordSaveError(`Failed to save color for directory "${dir.name}":`, e)
      dir.color = oldColor
      dir.updatedAt = oldUpdatedAt
    }
  }

  /** 设置主目录（根节点）在文件树里的显示颜色（undefined = 恢复默认） */
  async function setRootDirColor(color: string | undefined): Promise<void> {
    const oldColor = rootDirColor.value
    rootDirColor.value = color
    try {
      await saveDirectories()
      saveError.value = null
    } catch (e) {
      recordSaveError('Failed to save root directory color:', e)
      rootDirColor.value = oldColor
    }
  }

  function isDescendantOf(id: string, possibleAncestorId: string): boolean {
    let dir = directories.value.find(d => d.id === id)
    while (dir?.parentId) {
      if (dir.parentId === possibleAncestorId) return true
      dir = directories.value.find(d => d.id === dir?.parentId)
    }
    return false
  }

  async function moveDirectory(
    id: string,
    newParentId: string | null,
    position: 'inside' | 'before' | 'after' = 'inside',
    referenceId?: string
  ): Promise<void> {
    const dir = directories.value.find(d => d.id === id)
    if (!dir) return
    if (newParentId === id || (newParentId && isDescendantOf(newParentId, id))) return

    if (position !== 'inside' && referenceId) {
      const reference = directories.value.find(d => d.id === referenceId)
      if (!reference || reference.id === id || isDescendantOf(reference.id, id)) return
      newParentId = reference.parentId
    }

    const oldRel = directoryRelPath(directories.value, id)
    // 树的新位置要能整体回滚：留一份搬动前的父级 / 时间戳 / 整棵树
    const prevParentId = dir.parentId
    const prevUpdatedAt = dir.updatedAt
    const prevDirectories = directories.value
    const nextDirectories = directories.value.filter(d => d.id !== id)
    dir.parentId = newParentId
    dir.updatedAt = Date.now()

    if (position !== 'inside' && referenceId) {
      const referenceIndex = nextDirectories.findIndex(d => d.id === referenceId)
      if (referenceIndex !== -1) {
        nextDirectories.splice(position === 'before' ? referenceIndex : referenceIndex + 1, 0, dir)
        directories.value = nextDirectories
        try {
          await saveDirectories()
        } catch (e) {
          // 新位置没写进索引：整棵树回滚到搬动前（界面动了、索引没动 = 下次加载会跳回去）
          recordSaveError(`Failed to save directory move for "${dir.name}", rolled back:`, e)
          dir.parentId = prevParentId
          dir.updatedAt = prevUpdatedAt
          directories.value = prevDirectories
          return
        }
        await moveFolderOnDisk(oldRel, id)
        return
      }
    }

    nextDirectories.push(dir)
    directories.value = nextDirectories
    try {
      await saveDirectories()
    } catch (e) {
      recordSaveError(`Failed to save directory move for "${dir.name}", rolled back:`, e)
      dir.parentId = prevParentId
      dir.updatedAt = prevUpdatedAt
      directories.value = prevDirectories
      return
    }
    await moveFolderOnDisk(oldRel, id)
  }

  /** 目录在树里换了位置 / 名字后，同步搬动磁盘文件夹 */
  async function moveFolderOnDisk(oldRel: string | undefined, id: string): Promise<void> {
    const newRel = directoryRelPath(directories.value, id)
    if (oldRel && newRel && oldRel !== newRel) {
      try {
        await fs.renameDirectoryFolder(oldRel, newRel)
        saveError.value = null
      } catch (e) {
        // 索引里已经是新位置，只是磁盘文件夹还没搬：不回滚树（否则目录会在界面上跳回去），
        // 交给 noteStore.loadNotes 的布局迁移按新位置重建 / 补齐磁盘目录
        recordSaveError(`Failed to move directory folder on disk "${oldRel}" -> "${newRel}":`, e)
      }
    }
  }

  async function deleteDirectory(id: string): Promise<void> {
    const dir = directories.value.find(d => d.id === id)
    if (!dir) return
    const parentId = dir.parentId

    // 删除 iCloud 中的实际文件夹（子项会上抬一级到父目录）
    const rel = directoryRelPath(directories.value, id)
    const parentRel = directoryRelPath(directories.value, parentId)
    if (rel) {
      try {
        await fs.deleteDirectoryFolder(rel, parentRel ?? null)
        saveError.value = null
      } catch (e) {
        // 磁盘文件夹没删掉：树里也不动，界面与磁盘保持一致（否则文件全成孤儿）
        recordSaveError(`Failed to delete directory folder "${rel}":`, e)
        return
      }
    }

    // 删除目录自身
    const index = directories.value.findIndex(d => d.id === id)
    if (index !== -1) {
      directories.value.splice(index, 1)
    }

    // 子目录提升一级
    for (const child of directories.value) {
      if (child.parentId === id) {
        child.parentId = parentId
        child.updatedAt = Date.now()
      }
    }

    if (currentDirectoryId.value === id) {
      currentDirectoryId.value = null
    }

    try {
      await saveDirectories()
    } catch (e) {
      recordSaveError('Failed to save directories after delete:', e)
    }
  }

  function selectDirectory(id: string | null) {
    currentDirectoryId.value = id
  }

  return {
    directories,
    currentDirectoryId,
    isLoading,
    rootDirectories,
    getChildren,
    getDirectory,
    getFlattenedDirectoryIds,
    getAdjacentDirectoryId,
    isDescendantOf,
    loadDirectories,
    reload,
    saveError,
    saveDirectories,
    restoreLastDirectory,
    createDirectory,
    renameDirectory,
    setDirectoryColor,
    rootDirColor,
    setRootDirColor,
    moveDirectory,
    deleteDirectory,
    selectDirectory,
  }
})
