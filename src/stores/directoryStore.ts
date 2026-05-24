import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Directory, DirectoryData } from '@/types/note'
import { useFileSystem } from '@/composables/useFileSystem'

export const useDirectoryStore = defineStore('directory', () => {
  const fs = useFileSystem()

  // State
  const directories = ref<Directory[]>([])
  const currentDirectoryId = ref<string | null>(null) // null = root
  const isLoading = ref(false)

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

  // Actions
  async function loadDirectories(): Promise<void> {
    if (isLoading.value) return
    isLoading.value = true

    try {
      const data = await fs.readDirectories()
      directories.value = data.directories
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
    // 在 iCloud 中创建实际文件夹（以 ID 命名）
    await fs.createDirectoryFolder(newDir.id)
    await saveDirectories()
    return newDir
  }

  async function renameDirectory(id: string, newName: string): Promise<void> {
    const dir = directories.value.find(d => d.id === id)
    if (dir) {
      dir.name = newName
      dir.updatedAt = Date.now()
      await saveDirectories()
    }
  }

  async function moveDirectory(id: string, newParentId: string | null): Promise<void> {
    const dir = directories.value.find(d => d.id === id)
    if (dir) {
      dir.parentId = newParentId
      dir.updatedAt = Date.now()
      await saveDirectories()
    }
  }

  async function deleteDirectory(id: string): Promise<void> {
    const dir = directories.value.find(d => d.id === id)
    if (!dir) return
    const parentId = dir.parentId

    // 删除 iCloud 中的实际文件夹（.md 文件会被移回根目录）
    await fs.deleteDirectoryFolder(id)

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
    loadDirectories,
    saveDirectories,
    createDirectory,
    renameDirectory,
    moveDirectory,
    deleteDirectory,
    selectDirectory,
  }
})
