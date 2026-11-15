import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { DirectoryData, NoteMetadata } from '@/types/note'
import type { ScanResult, TransferDirOption, TransferTarget } from '@/types/workspace'
import { directoryRelPath, fileNameForTitle } from '@/utils/notePath'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useNoteStore, extractTitle } from '@/stores/noteStore'
import { useDirectoryStore } from '@/stores/directoryStore'

/** 要搬到别的空间去的东西：一条笔记，或者一个目录（连同里面的内容） */
export interface TransferEntry {
  kind: 'note' | 'directory'
  /** 笔记 id / 目录 id */
  id: string
  /** 显示名，弹窗里给用户看 */
  label: string
}

interface TransferRequestState {
  entries: TransferEntry[]
}

/** 模块级单例：谁都能登记搬运请求，弹窗组件读它来渲染 */
const pendingRequest = ref<TransferRequestState | null>(null)

function joinPath(base: string, rel: string): string {
  return rel ? `${base}/${rel}` : base
}

function parentRelOf(rel: string): string {
  const idx = rel.lastIndexOf('/')
  return idx === -1 ? '' : rel.slice(0, idx)
}

function baseNameOf(rel: string): string {
  const idx = rel.lastIndexOf('/')
  return idx === -1 ? rel : rel.slice(idx + 1)
}

/**
 * 确保目标空间的 DirectoryData 里存在这条相对路径对应的目录链，返回最深一层的目录 id
 */
function ensureDirChain(data: DirectoryData, relPath: string): string | undefined {
  if (!relPath) return undefined
  const segments = relPath.split('/').filter(Boolean)
  let parentId: string | null = null
  let currentRel = ''
  for (const seg of segments) {
    currentRel = currentRel ? `${currentRel}/${seg}` : seg
    const found = data.directories.find(d => d.name === seg && d.parentId === parentId)
    if (found) {
      parentId = found.id
      continue
    }
    const id = crypto.randomUUID()
    const now = Date.now()
    data.directories.push({ id, name: seg, parentId, createdAt: now, updatedAt: now })
    parentId = id
  }
  return parentId ?? undefined
}

/**
 * 跨工作空间复制 / 移动：内容文件走 Rust 的 copy_workspace_entry，
 * 目标空间的 metadata.json / directories.json 在这里重映射 uuid 后落盘。
 */
export function useWorkspaceTransfer() {
  const ws = useWorkspaceStore()
  const noteStore = useNoteStore()
  const directoryStore = useDirectoryStore()

  /** 目标空间里可选的目录（含根目录），用于弹窗里的下拉树 */
  async function listDirOptions(workspaceId: string): Promise<TransferDirOption[]> {
    const target = ws.byId(workspaceId)
    if (!target) return []
    const base = await ws.basePathOf('meta', target)
    let data: DirectoryData = { version: 1, directories: [] }
    try {
      const raw = await invoke<string>('read_directories', { basePath: base })
      data = JSON.parse(raw)
    } catch {
      data = { version: 1, directories: [] }
    }
    const options: TransferDirOption[] = [{ id: null, rel: '', name: '', depth: 0 }]
    for (const dir of data.directories) {
      const rel = directoryRelPath(data.directories, dir.id)
      if (!rel) continue
      options.push({ id: dir.id, rel, name: dir.name, depth: rel.split('/').length })
    }
    return options.sort((a, b) => a.rel.localeCompare(b.rel))
  }

  async function readMetaOf(workspaceId: string): Promise<NoteMetadata> {
    const target = ws.byId(workspaceId)
    const base = await ws.basePathOf('meta', target)
    try {
      const raw = await invoke<string>('read_metadata', { basePath: base })
      return JSON.parse(raw)
    } catch {
      return { version: 2, notes: [] }
    }
  }

  async function readDirDataOf(workspaceId: string): Promise<DirectoryData> {
    const target = ws.byId(workspaceId)
    const base = await ws.basePathOf('meta', target)
    try {
      const raw = await invoke<string>('read_directories', { basePath: base })
      return JSON.parse(raw)
    } catch {
      return { version: 1, directories: [] }
    }
  }

  async function writeMetaOf(workspaceId: string, data: NoteMetadata): Promise<void> {
    const base = await ws.basePathOf('meta', ws.byId(workspaceId))
    await invoke('ensure_dir', { path: base })
    await invoke('write_metadata', { basePath: base, content: JSON.stringify(data, null, 2) })
  }

  async function writeDirDataOf(workspaceId: string, data: DirectoryData): Promise<void> {
    const base = await ws.basePathOf('meta', ws.byId(workspaceId))
    await invoke('ensure_dir', { path: base })
    await invoke('write_directories', { basePath: base, content: JSON.stringify(data, null, 2) })
  }

  /** 把一条笔记搬到目标空间 */
  async function transferNote(noteId: string, target: TransferTarget, move: boolean): Promise<void> {
    const note = noteStore.notes.find(n => n.id === noteId)
    if (!note) throw new Error('笔记不存在')
    const targetWs = ws.byId(target.workspaceId)
    if (!targetWs) throw new Error('目标工作空间不存在')

    const srcBase = await ws.contentBasePath()
    const dstBase = await ws.basePathOf('content', targetWs)
    const srcDirRel = directoryRelPath(directoryStore.directories, note.directoryId) ?? ''
    const fileName = note.fileName ?? fileNameForTitle(note.title)
    const srcRel = srcDirRel ? `${srcDirRel}/${fileName}` : fileName

    const newRel = await invoke<string>('copy_workspace_entry', {
      srcBase,
      srcRel,
      dstBase,
      dstRel: target.dirRel || '',
      moveIt: move,
    })

    // 目标空间重建索引：目录链补全 + 笔记条目
    const dirData = await readDirDataOf(target.workspaceId)
    const dirId = ensureDirChain(dirData, parentRelOf(newRel))
    const meta = await readMetaOf(target.workspaceId)
    const now = Date.now()
    meta.version = meta.version ?? 2
    meta.notes.push({
      id: crypto.randomUUID(),
      title: extractTitle(note.content || note.title) || note.title,
      createdAt: note.createdAt ?? now,
      updatedAt: now,
      tags: note.tags,
      isPinned: false,
      isLocked: false,
      directoryId: dirId,
      backgroundColor: note.backgroundColor,
      color: note.color,
      fileName: baseNameOf(newRel),
    })
    await writeDirDataOf(target.workspaceId, dirData)
    await writeMetaOf(target.workspaceId, meta)

    if (move) {
      const index = noteStore.notes.findIndex(n => n.id === noteId)
      if (index !== -1) noteStore.notes.splice(index, 1)
      const next = noteStore.notes.find(n => !n.trashedAt)
      if (noteStore.currentNoteId === noteId) {
        if (next) noteStore.selectNote(next.id)
        else noteStore.createNoteAtHead()
      }
      await noteStore.saveMetadataToCloud()
    }
  }

  /** 收集一个目录（含所有子目录）里的笔记 id */
  function collectSubtree(dirId: string): { dirIds: Set<string>; noteIds: Set<string> } {
    const dirIds = new Set<string>([dirId])
    const allDirs = directoryStore.directories
    let grew = true
    while (grew) {
      grew = false
      for (const dir of allDirs) {
        if (dir.parentId && dirIds.has(dir.parentId) && !dirIds.has(dir.id)) {
          dirIds.add(dir.id)
          grew = true
        }
      }
    }
    const noteIds = new Set<string>(
      noteStore.notes.filter(n => n.directoryId && dirIds.has(n.directoryId)).map(n => n.id)
    )
    return { dirIds, noteIds }
  }

  /** 把一个目录连同子目录、笔记整体搬到目标空间 */
  async function transferDirectory(dirId: string, target: TransferTarget, move: boolean): Promise<void> {
    const rootRel = directoryRelPath(directoryStore.directories, dirId)
    if (!rootRel) throw new Error('目录不存在')
    const targetWs = ws.byId(target.workspaceId)
    if (!targetWs) throw new Error('目标工作空间不存在')

    const srcBase = await ws.contentBasePath()
    const dstBase = await ws.basePathOf('content', targetWs)

    const newRootRel = await invoke<string>('copy_workspace_entry', {
      srcBase,
      srcRel: rootRel,
      dstBase,
      dstRel: target.dirRel || '',
      moveIt: move,
    })

    // 磁盘上复制完的目录重新扫一遍，按真实结构重建目标空间的索引
    const scan = await invoke<ScanResult>('scan_workspace_dir', { path: joinPath(dstBase, newRootRel) })
    const dirData = await readDirDataOf(target.workspaceId)
    const meta = await readMetaOf(target.workspaceId)
    const now = Date.now()
    meta.version = meta.version ?? 2

    // 目标目录本身 + 复制进来的子目录
    ensureDirChain(dirData, newRootRel)
    for (const rel of scan.dirs) {
      ensureDirChain(dirData, `${newRootRel}/${rel}`)
    }
    for (const file of scan.files) {
      const fileRel = `${newRootRel}/${file.rel_path}`
      const dirIdOfFile = ensureDirChain(dirData, parentRelOf(fileRel))
      const title = extractTitle(file.head) || baseNameOf(file.rel_path).replace(/\.md$/i, '')
      meta.notes.push({
        id: crypto.randomUUID(),
        title,
        createdAt: file.modified || now,
        updatedAt: file.modified || now,
        isPinned: false,
        isLocked: false,
        directoryId: dirIdOfFile,
        fileName: baseNameOf(file.rel_path),
      })
    }
    await writeDirDataOf(target.workspaceId, dirData)
    await writeMetaOf(target.workspaceId, meta)

    if (move) {
      const { dirIds, noteIds } = collectSubtree(dirId)
      directoryStore.directories = directoryStore.directories.filter(d => !dirIds.has(d.id))
      noteStore.notes = noteStore.notes.filter(n => !noteIds.has(n.id))
      if (noteStore.currentNoteId && noteIds.has(noteStore.currentNoteId)) {
        const next = noteStore.notes.find(n => !n.trashedAt)
        if (next) noteStore.selectNote(next.id)
        else noteStore.createNoteAtHead()
      }
      if (directoryStore.currentDirectoryId && dirIds.has(directoryStore.currentDirectoryId)) {
        directoryStore.selectDirectory(null)
      }
      await directoryStore.saveDirectories()
      await noteStore.saveMetadataToCloud()
    }
  }

  /** 弹窗用的统一入口：把登记的条目搬到目标空间 */
  async function commitTransfer(
    targetWorkspaceId: string,
    dirRel: string,
    mode: 'copy' | 'move'
  ): Promise<number> {
    if (targetWorkspaceId === ws.currentId) throw new Error('请选择另一个工作空间')
    const request = pendingRequest.value
    if (!request || request.entries.length === 0) return 0

    // 先把防抖里的改动落盘，否则搬过去的是旧文件
    await noteStore.flushPendingSave()

    let done = 0
    for (const entry of request.entries) {
      const target: TransferTarget = { workspaceId: targetWorkspaceId, dirRel: dirRel || '' }
      if (entry.kind === 'note') {
        await transferNote(entry.id, target, mode === 'move')
      } else {
        await transferDirectory(entry.id, target, mode === 'move')
      }
      done++
    }
    pendingRequest.value = null
    return done
  }

  /** 打开搬运弹窗 */
  function requestTransfer(entries: TransferEntry[]): void {
    pendingRequest.value = entries.length ? { entries } : null
  }

  function closeTransfer(): void {
    pendingRequest.value = null
  }

  /** 侧栏 / 文件树快捷入口：把一条笔记送进搬运弹窗 */
  function requestNoteTransfer(noteId: string, label: string): void {
    requestTransfer([{ kind: 'note', id: noteId, label }])
  }

  /** 侧栏 / 文件树快捷入口：把一个目录送进搬运弹窗 */
  function requestDirectoryTransfer(dirId: string, label: string): void {
    requestTransfer([{ kind: 'directory', id: dirId, label }])
  }

  return {
    pendingRequest,
    listDirOptions,
    commitTransfer,
    requestTransfer,
    requestNoteTransfer,
    requestDirectoryTransfer,
    closeTransfer,
    transferNote,
    transferDirectory,
  }
}
