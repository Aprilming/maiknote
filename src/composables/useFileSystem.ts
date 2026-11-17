import { invoke } from '@tauri-apps/api/core'
import type { NoteMetadata, DirectoryData, NoteFileEntry } from '@/types/note'
import { useWorkspaceStore } from '@/stores/workspaceStore'


// 直接使用 invoke，在非 Tauri 环境下调用时会自然抛出异常（由各函数的 try/catch 捕获）
/**
 * directories.json 上一次读取是否成功。
 * 读失败时 readDirectories 仍返回空树占位值（initialize / loadNotes 必须能继续启动），
 * 但「这次拿到的是占位值、不是真实索引」这个事实必须能被上层看到 ——
 * directoryStore.saveDirectories 靠它拒绝把空树写回磁盘（否则整棵目录索引被抹掉）。
 */
const directoriesIndexState: { failed: boolean; reason: string | null } = { failed: false, reason: null }

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
    let content: string
    try {
      const path = await getMetaPath()
      content = await safeInvoke<string>('read_metadata', { basePath: path })
    } catch (e) {
      // 读不到（文件还没建、或不在 Tauri 里）：当作全新安装
      console.error('Failed to read metadata, creating new:', e)
      return {
        version: 1,
        notes: [],
      }
    }

    // 空文件同样是"还没有索引"，不是损坏
    if (!content || !content.trim()) {
      return {
        version: 1,
        notes: [],
      }
    }

    try {
      return JSON.parse(content) as NoteMetadata
    } catch (e) {
      // 解析失败 = 索引已经损坏。这里绝不能静默返回空索引：下一次保存会把
      // 真实索引覆盖成空表，笔记文件从此变成无主孤儿。往上抛，让初始化停在
      // 错误态（Rust 侧覆盖前还会备份成 metadata.bak.json）。
      console.error('metadata.json is corrupted, refusing to fall back to empty index:', e)
      throw new Error('metadata.json 内容损坏，已停止加载以免覆盖笔记索引')
    }
  }

  /**
   * 保住原始错误（Error 原样返回，栈不丢）；Tauri invoke 常抛字符串，
   * 包成带上下文的 Error 再往上抛，调用方才看得清是哪一步失败的。
   */
  function withContext(context: string, e: unknown): Error {
    return e instanceof Error ? e : new Error(`${context}: ${String(e)}`)
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
      // 索引写不进去 = 整本笔记的目录没落盘，绝不能只打一行日志就当作成功：
      // 往上抛，让调用方（noteStore 的失败重试链）能看见并重新排队
      console.error('Failed to write metadata:', e)
      throw e instanceof Error ? e : new Error(`Failed to write metadata: ${String(e)}`)
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
      // 正文没写进去就是这条笔记的内容丢了，必须让上层感知（H4）：
      // 保留原始错误往上抛，由 noteStore 打印 + 重新排进保存队列
      console.error(`Failed to write note ${fileName}:`, e)
      throw e instanceof Error ? e : new Error(`Failed to write note ${fileName}: ${String(e)}`)
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
      // 文件夹没建出来 = 内存里已经有这个目录、磁盘上没有（H4/M10）：
      // 打完上下文往上抛，由 directoryStore 决定回滚还是交给下次布局迁移重建
      console.error(`Failed to create directory folder ${dir}:`, e)
      throw withContext(`Failed to create directory folder ${dir}`, e)
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
      // 改名没生效 = 树里已是新名字、磁盘还是老文件夹：必须让调用方看见
      console.error(`Failed to rename directory folder ${oldDir} -> ${newDir}:`, e)
      throw withContext(`Failed to rename directory folder ${oldDir} -> ${newDir}`, e)
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
      // 目录没删掉：文件还在磁盘上，树里就不能当作已删
      console.error(`Failed to delete directory folder ${dir}:`, e)
      throw withContext(`Failed to delete directory folder ${dir}`, e)
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
    const from = fromDir ?? '(root)'
    const to = toDir ?? '(root)'
    try {
      const path = await getContentPath()
      const args: Record<string, unknown> = { basePath: path, fileName }
      if (fromDir !== null) args.fromDir = fromDir
      if (toDir !== null) args.toDir = toDir
      if (newFileName) args.newFileName = newFileName
      await safeInvoke('move_note_file', args)
    } catch (e) {
      // 搬运失败 = 内存里目录/文件名已改、磁盘还停在原处（假成功）：
      // 日志带 from/to 方便定位，抛给调用方回滚内存状态
      console.error(`Failed to move note file ${fileName} from "${from}" to "${to}":`, e)
      throw withContext(`Failed to move note file ${fileName} from "${from}" to "${to}"`, e)
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
      // 只读没设上：锁状态不能停在「已锁」，抛给调用方回滚
      console.error(`Failed to set note ${fileName} readonly:`, e)
      throw withContext(`Failed to set note ${fileName} readonly`, e)
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
      // 解锁没设上：抛给调用方回滚锁状态
      console.error(`Failed to set note ${fileName} readwrite:`, e)
      throw withContext(`Failed to set note ${fileName} readwrite`, e)
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
   * 目录索引加载失败的原因（null = 内存里的树可信）。
   * 为什么不把 readDirectories 改成 rethrow：initialize / loadNotes / 工作空间迁移都指望
   * 「索引读不出来也能继续启动」（首次启动、备份恢复路径），抛出去应用直接起不来；
   * 而 Rust 侧 read_directories 在文件不存在时本来就返回 {"version":1,"directories":[]}，
   * 所以走到 catch 只可能是 IPC / 权限 / 解析异常。改为把失败事实暴露出去，由写入口把关。
   */
  function getDirectoriesIndexError(): string | null {
    return directoriesIndexState.failed ? (directoriesIndexState.reason ?? 'unknown error') : null
  }

  /**
   * Read directories.json file
   */
  async function readDirectories(): Promise<DirectoryData> {
    try {
      const path = await getMetaPath()
      const content = await safeInvoke<string>('read_directories', { basePath: path })
      const data = JSON.parse(content) as DirectoryData
      // 读成功 = 磁盘上的索引可信，解除失败标志：下一次保存可以正常写回
      directoriesIndexState.failed = false
      directoriesIndexState.reason = null
      return data
    } catch (e) {
      // 不 rethrow（见 getDirectoriesIndexError 的注释）：返回的是空树占位值，不是真实索引。
      // 记下失败事实，让 directoryStore.saveDirectories 拒绝把它写回磁盘。
      console.error('Failed to read directories, index unusable until next successful load:', e)
      directoriesIndexState.failed = true
      directoriesIndexState.reason = e instanceof Error ? e.message : String(e)
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
      // 目录索引写不进去 = 整棵树没落盘，往上抛，由 directoryStore 回滚或报错
      console.error('Failed to write directories:', e)
      throw withContext('Failed to write directories', e)
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
    getDirectoriesIndexError,
    writeDirectories,
    createDirectoryFolder,
    renameDirectoryFolder,
    deleteDirectoryFolder,
    moveNoteFile,
    migrateNoteLayout,
  }
}
