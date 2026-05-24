import { invoke } from '@tauri-apps/api/core'
import type { NoteMetadata, DirectoryData } from '@/types/note'


// 直接使用 invoke，在非 Tauri 环境下调用时会自然抛出异常（由各函数的 try/catch 捕获）
async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args)
}

/**
 * File system operations using Tauri commands
 */
export function useFileSystem() {
  /**
   * Get the iCloud path for storing notes
   */
  async function getICloudPath(): Promise<string> {
    try {
      return await safeInvoke<string>('get_icloud_path')
    } catch (e) {
      console.error('Failed to get iCloud path:', e)
      throw new Error('Failed to access iCloud directory')
    }
  }

  /**
   * Read metadata.json file
   */
  async function readMetadata(): Promise<NoteMetadata> {
    try {
      const path = await getICloudPath()
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
      const path = await getICloudPath()
      const content = JSON.stringify(metadata, null, 2)
      await safeInvoke('write_metadata', { basePath: path, content })
    } catch (e) {
      console.error('Failed to write metadata:', e)
    }
  }

  /**
   * Read a single note file (optionally from a directory folder)
   */
  async function readNote(id: string, dir?: string): Promise<string> {
    try {
      const path = await getICloudPath()
      const args: Record<string, unknown> = { basePath: path, id }
      if (dir) args.dir = dir
      return await safeInvoke<string>('read_note', args)
    } catch (e) {
      console.error(`Failed to read note ${id}:`, e)
      return ''
    }
  }

  /**
   * Write a single note file (optionally to a directory folder)
   */
  async function writeNote(id: string, content: string, dir?: string): Promise<void> {
    try {
      const path = await getICloudPath()
      const args: Record<string, unknown> = { basePath: path, id, content }
      if (dir) args.dir = dir
      await safeInvoke('write_note', args)
    } catch (e) {
      console.error(`Failed to write note ${id}:`, e)
    }
  }

  /**
   * Delete a note file (optionally from a directory folder)
   */
  async function deleteNote(id: string, dir?: string): Promise<void> {
    try {
      const path = await getICloudPath()
      const args: Record<string, unknown> = { basePath: path, id }
      if (dir) args.dir = dir
      await safeInvoke('delete_note', args)
    } catch (e) {
      console.error(`Failed to delete note ${id}:`, e)
    }
  }

  /**
   * Create a directory folder on the filesystem
   */
  async function createDirectoryFolder(dirId: string): Promise<void> {
    try {
      const path = await getICloudPath()
      await safeInvoke('create_directory_folder', { basePath: path, dirId })
    } catch (e) {
      console.error(`Failed to create directory folder ${dirId}:`, e)
    }
  }

  /**
   * Rename a directory folder on the filesystem
   */
  async function renameDirectoryFolder(oldDirId: string, newDirId: string): Promise<void> {
    try {
      const path = await getICloudPath()
      await safeInvoke('rename_directory_folder', { basePath: path, oldDirId, newDirId })
    } catch (e) {
      console.error(`Failed to rename directory folder:`, e)
    }
  }

  /**
   * Delete a directory folder on the filesystem (moves .md files to root)
   */
  async function deleteDirectoryFolder(dirId: string): Promise<void> {
    try {
      const path = await getICloudPath()
      await safeInvoke('delete_directory_folder', { basePath: path, dirId })
    } catch (e) {
      console.error(`Failed to delete directory folder ${dirId}:`, e)
    }
  }

  /**
   * Move a note file between directories on the filesystem
   */
  async function moveNoteFile(id: string, fromDir: string | null, toDir: string | null): Promise<void> {
    try {
      const path = await getICloudPath()
      const args: Record<string, unknown> = { basePath: path, id }
      if (fromDir !== null) args.fromDir = fromDir
      if (toDir !== null) args.toDir = toDir
      await safeInvoke('move_note_file', args)
    } catch (e) {
      console.error(`Failed to move note file ${id}:`, e)
    }
  }

  /**
   * Set note file to read-only (locked)
   */
  async function setNoteReadonly(id: string): Promise<void> {
    try {
      const path = await getICloudPath()
      await safeInvoke('set_note_readonly', { basePath: path, id })
    } catch (e) {
      console.error(`Failed to set note ${id} readonly:`, e)
    }
  }

  /**
   * Set note file to read-write (unlocked)
   */
  async function setNoteReadwrite(id: string): Promise<void> {
    try {
      const path = await getICloudPath()
      await safeInvoke('set_note_readwrite', { basePath: path, id })
    } catch (e) {
      console.error(`Failed to set note ${id} readwrite:`, e)
    }
  }

  /**
   * Ensure images folder exists and return the path
   */
  async function ensureImagesFolder(): Promise<string> {
    try {
      const path = await getICloudPath()
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
      const path = await getICloudPath()
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
      const path = await getICloudPath()
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
      const path = await getICloudPath()
      const content = JSON.stringify(data, null, 2)
      await safeInvoke('write_directories', { basePath: path, content })
    } catch (e) {
      console.error('Failed to write directories:', e)
    }
  }

  return {
    getICloudPath,
    readMetadata,
    writeMetadata,
    readNote,
    writeNote,
    deleteNote,
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
  }
}
