import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Directory, DirectoryData } from '@/types/note'
import { useFileSystem } from '@/composables/useFileSystem'
import { directoryRelPath } from '@/utils/notePath'

export const useDirectoryStore = defineStore('directory', () => {
  const fs = useFileSystem()

  // State
  const directories = ref<Directory[]>([])
  const rootDirColor = ref<string | undefined>(undefined)
  const currentDirectoryId = ref<string | null>(null) // null = root
  const isLoading = ref(false)

  // 监听 currentDirectoryId 变化，保存到 localStorage
  watch(currentDirectoryId, (newId) => {
    if (newId !== undefined) {
      localStorage.setItem('lastSelectedDirectoryId', newId ?? '')
    }
  })

  /** 从 localStorage 恢复上次选择的目录 */
  function restoreLastDirectory(): string | null {
    const saved = localStorage.getItem('lastSelectedDirectoryId')
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
    } catch (e) {
      console.error('Failed to load directories:', e)
    } finally {
      isLoading.value = false
    }
  }

  async function saveDirectories(): Promise<void> {
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
    if (relPath) await fs.createDirectoryFolder(relPath)
    await saveDirectories()
    return newDir
  }

  async function renameDirectory(id: string, newName: string): Promise<void> {
    const dir = directories.value.find(d => d.id === id)
    if (dir) {
      const oldRel = directoryRelPath(directories.value, id)
      dir.name = newName
      dir.updatedAt = Date.now()
      const newRel = directoryRelPath(directories.value, id)
      await saveDirectories()
      if (oldRel && newRel && oldRel !== newRel) {
        await fs.renameDirectoryFolder(oldRel, newRel)
      }
    }
  }

  /** 设置文件树里该目录的显示颜色（undefined = 恢复默认） */
  async function setDirectoryColor(id: string, color: string | undefined): Promise<void> {
    const dir = directories.value.find(d => d.id === id)
    if (!dir) return
    dir.color = color
    dir.updatedAt = Date.now()
    await saveDirectories()
  }

  /** 设置主目录（根节点）在文件树里的显示颜色（undefined = 恢复默认） */
  async function setRootDirColor(color: string | undefined): Promise<void> {
    rootDirColor.value = color
    await saveDirectories()
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
    const nextDirectories = directories.value.filter(d => d.id !== id)
    dir.parentId = newParentId
    dir.updatedAt = Date.now()

    if (position !== 'inside' && referenceId) {
      const referenceIndex = nextDirectories.findIndex(d => d.id === referenceId)
      if (referenceIndex !== -1) {
        nextDirectories.splice(position === 'before' ? referenceIndex : referenceIndex + 1, 0, dir)
        directories.value = nextDirectories
        await saveDirectories()
        await moveFolderOnDisk(oldRel, id)
        return
      }
    }

    nextDirectories.push(dir)
    directories.value = nextDirectories
    await saveDirectories()
    await moveFolderOnDisk(oldRel, id)
  }

  /** 目录在树里换了位置 / 名字后，同步搬动磁盘文件夹 */
  async function moveFolderOnDisk(oldRel: string | undefined, id: string): Promise<void> {
    const newRel = directoryRelPath(directories.value, id)
    if (oldRel && newRel && oldRel !== newRel) {
      await fs.renameDirectoryFolder(oldRel, newRel)
    }
  }

  async function deleteDirectory(id: string): Promise<void> {
    const dir = directories.value.find(d => d.id === id)
    if (!dir) return
    const parentId = dir.parentId

    // 删除 iCloud 中的实际文件夹（子项会上抬一级到父目录）
    const rel = directoryRelPath(directories.value, id)
    const parentRel = directoryRelPath(directories.value, parentId)
    if (rel) await fs.deleteDirectoryFolder(rel, parentRel ?? null)

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

    await saveDirectories()
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
