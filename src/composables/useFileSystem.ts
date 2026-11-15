import { invoke } from '@tauri-apps/api/core'
import type { NoteMetadata, DirectoryData, NoteFileEntry } from '@/types/note'
import { useWorkspaceStore } from '@/stores/workspaceStore'


// 直接使用 invoke，在非 Tauri 环境下调用时会自然抛出异常（由各函数的 try/catch 捕获）
async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args)
}

/**
 * File system operations using Tauri commands.
 * 所有路径都按「当前工作空间」解析：content = 笔记/文件夹/图片根目录，meta = metadata.json 等索引文件所在目录。
 */
export function useFileSystem() {
  /** 当前工作空间的内容根目录（笔记 .md、目录文件夹、images 都在这里） */
  async function getContentPath(): Promise<string> {
    try {
      return await useWorkspaceStore().basePathOf('content')
    } catch (e) {
      console.error('Failed to resolve workspace content path:', e)
      throw new Error('Failed to access workspace directory')
    }
  }

  /** 当前工作空间的索引目录（metadata.json / directories.json / assistants.json） */
  async function getMetaPath(): Promise<string> {
    try {
      return await useWorkspaceStore().basePathOf('meta')
    } catch (e) {
      console.error('Failed to resolve workspace meta path:', e)
      throw new Error('Failed to access workspace directory')
    }
  }

  /**
   * 兼容旧调用：返回当前工作空间的内容根目录
   */
  async function getICloudPath(): Promise<string> {
    return await getContentPath()
  }

  /**
   * Read metadata.json file
   */
  async function readMetadata(): Promise<NoteMetadata> {
    try {
      const path = await getMetaPath()
      const content = await safeInvoke<string>('read_metadata', { basePath: path })
      return JSON.parse(content)
    } catch (e) {
      // If file doesn't exist or not in Tauri, return empty metadata
      console.error('Failed to read metadata, creating new:', e)
      return {
        version: 1,
        notes: [],
      }
    }
  }

  /**
   * Write metadata.json file
   */
  async function writeMetadata(metadata: NoteMetadata): Promise<void> {
    try {
      const path = await getMetaPath()
      const content = JSON.stringify(metadata, null, 2)
      await safeInvoke('write_metadata', { basePath: path, content })
    } catch (e) {
      console.error('Failed to write metadata:', e)
    }
  }

  /**
   * Read a single note file (optionally from a directory folder)
   */
  async function readNote(fileName: string, dir?: string): Promise<string> {
    try {
      const path = await getContentPath()
      const args: Record<string, unknown> = { basePath: path, fileName }
      if (dir) args.dir = dir
      return await safeInvoke<string>('read_note', args)
    } catch (e) {
      console.error(`Failed to read note ${fileName}:`, e)
      return ''
    }
  }

  /**
   * Write a single note file (optionally to a directory folder)
   */
  async function writeNote(fileName: string, content: string, dir?: string): Promise<void> {
    try {
      const path = await getContentPath()
      const args: Record<string, unknown> = { basePath: path, fileName, content }
      if (dir) args.dir = dir
      await safeInvoke('write_note', args)
    } catch (e) {
      console.error(`Failed to write note ${fileName}:`, e)
    }
  }

  /**
   * 把笔记文件移入系统废纸篓（可从 macOS 废纸篓还原）
   * 失败会真实抛出，由调用方提示用户，不再静默吞掉
   * @returns 废纸篓中的新路径（回退为直接删除时为空串）
   */
  async function deleteNote(fileName: string, dir?: string): Promise<string> {
    const path = await getContentPath()
    const args: Record<string, unknown> = { basePath: path, fileName }
    if (dir) args.dir = dir
    return await safeInvoke<string>('delete_note', args)
  }

  /**
   * 把任意文件移入系统废纸篓（清理磁盘残留文件用）
   */
  async function trashFile(filePath: string): Promise<string> {
    return await safeInvoke<string>('trash_file', { path: filePath })
  }

  /**
   * 列出磁盘上实际存在的笔记文件（用于发现 metadata 之外的残留）
   */
  async function listNoteFiles(): Promise<NoteFileEntry[]> {
    const base = await getContentPath()
    return await safeInvoke<NoteFileEntry[]>('list_note_files', { basePath: base })
  }

  /**
   * Create a directory folder on the filesystem
   */
  async function createDirectoryFolder(dir: string): Promise<void> {
    try {
      const path = await getContentPath()
      await safeInvoke('create_directory_folder', { basePath: path, dir })
    } catch (e) {
      console.error(`Failed to create directory folder ${dir}:`, e)
    }
  }

  /**
   * Rename a directory folder on the filesystem
   */
  async function renameDirectoryFolder(oldDir: string, newDir: string): Promise<void> {
    try {
      const path = await getContentPath()
      await safeInvoke('rename_directory_folder', { basePath: path, oldDir, newDir })
    } catch (e) {
      console.error(`Failed to rename directory folder:`, e)
    }
  }

  /**
   * Delete a directory folder on the filesystem (moves .md files to root)
   */
  async function deleteDirectoryFolder(dir: string, parentDir?: string | null): Promise<void> {
    try {
      const path = await getContentPath()
      const args: Record<string, unknown> = { basePath: path, dir }
      if (parentDir) args.parentDir = parentDir
      await safeInvoke('delete_directory_folder', args)
    } catch (e) {
      console.error(`Failed to delete directory folder ${dir}:`, e)
    }
  }

  /**
   * Move a note file between directories on the filesystem
   */
  async function moveNoteFile(
    fileName: string,
    fromDir: string | null,
    toDir: string | null,
    newFileName?: string
  ): Promise<void> {
    try {
      const path = await getContentPath()
      const args: Record<string, unknown> = { basePath: path, fileName }
      if (fromDir !== null) args.fromDir = fromDir
      if (toDir !== null) args.toDir = toDir
      if (newFileName) args.newFileName = newFileName
      await safeInvoke('move_note_file', args)
    } catch (e) {
      console.error(`Failed to move note file ${fileName}:`, e)
    }
  }

  /**
   * Set note file to read-only (locked)
   */
  async function setNoteReadonly(fileName: string, dir?: string): Promise<void> {
    try {
      const path = await getContentPath()
      const args: Record<string, unknown> = { basePath: path, fileName }
      if (dir) args.dir = dir
      await safeInvoke('set_note_readonly', args)
    } catch (e) {
      console.error(`Failed to set note ${fileName} readonly:`, e)
    }
  }

  /**
   * Set note file to read-write (unlocked)
   */
  async function setNoteReadwrite(fileName: string, dir?: string): Promise<void> {
    try {
      const path = await getContentPath()
      const args: Record<string, unknown> = { basePath: path, fileName }
      if (dir) args.dir = dir
      await safeInvoke('set_note_readwrite', args)
    } catch (e) {
      console.error(`Failed to set note ${fileName} readwrite:`, e)
    }
  }

  /**
   * 把老布局（note_<id>.md）迁移成真实名字布局（<标题>.md，目录按名字嵌套）
   * @returns 迁移的文件数量
   */
  async function migrateNoteLayout(
    moves: { id: string; fromDir: string | null; toDir: string | null; toFileName: string }[]
  ): Promise<number> {
    if (moves.length === 0) return 0
    const path = await getContentPath()
    return await safeInvoke<number>('migrate_note_layout', { basePath: path, moves })
  }

  /**
   * Ensure images folder exists and return the path
   */
  async function ensureImagesFolder(): Promise<string> {
    try {
      const path = await getContentPath()
      return await safeInvoke<string>('ensure_images_folder', { basePath: path })
    } catch (e) {
      console.error('Failed to ensure images folder:', e)
      throw new Error('Failed to access images directory')
    }
  }

  /**
   * Save image to the images folder
   * @param imageData Base64 encoded image data (with or without data URL prefix)
   * @param filename Filename to save as
   * @returns Asset protocol URL for the saved image
   */
  async function saveImage(imageData: string, filename: string): Promise<string> {
    try {
      const path = await getContentPath()
      await safeInvoke<string>('save_image', { basePath: path, imageData, filename })
      // Return asset:// URL for Tauri to serve the file
      // Ensure proper URL encoding and single slash after localhost
      const encodedPath = encodeURIComponent(`${path}/images/${filename}`)
      return `asset://localhost/${encodedPath}`
    } catch (e) {
      console.error('Failed to save image:', e)
      throw new Error('Failed to save image')
    }
  }

  /**
   * Read directories.json file
   */
  async function readDirectories(): Promise<DirectoryData> {
    try {
      const path = await getMetaPath()
      const content = await safeInvoke<string>('read_directories', { basePath: path })
      return JSON.parse(content)
    } catch (e) {
      console.error('Failed to read directories, creating new:', e)
      return {
        version: 1,
        directories: [],
      }
    }
  }

  /**
   * Write directories.json file
   */
  async function writeDirectories(data: DirectoryData): Promise<void> {
    try {
      const path = await getMetaPath()
      const content = JSON.stringify(data, null, 2)
      await safeInvoke('write_directories', { basePath: path, content })
    } catch (e) {
      console.error('Failed to write directories:', e)
    }
  }

  return {
    getContentPath,
    getMetaPath,
    getICloudPath,
    readMetadata,
    writeMetadata,
    readNote,
    writeNote,
    deleteNote,
    trashFile,
    listNoteFiles,
    setNoteReadonly,
    setNoteReadwrite,
    ensureImagesFolder,
    saveImage,
    readDirectories,
    writeDirectories,
    createDirectoryFolder,
    renameDirectoryFolder,
    deleteDirectoryFolder,
    moveNoteFile,
    migrateNoteLayout,
  }
}
