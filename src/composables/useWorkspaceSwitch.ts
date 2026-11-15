import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { useI18n } from 'vue-i18n'
import type { Directory, DirectoryData, NoteMetadata } from '@/types/note'
import type { ScanResult } from '@/types/workspace'
import { DEFAULT_ICLOUD_NAME, useWorkspaceStore, type Workspace } from '@/stores/workspaceStore'
import { useNoteStore, extractTitle } from '@/stores/noteStore'
import { useDirectoryStore } from '@/stores/directoryStore'
import { useSettingStore } from '@/stores/settingStore'
import { setNativeDialogOpen } from '@/stores/dialogStore'
import { suppressMainAutoHide } from '@/composables/useEdgePanel'

const METADATA_VERSION = 2

/**
 * 新增 / 删除 / 重命名 / 切换工作空间。
 * 切换 = 把防抖里的改动落盘 → 换当前空间 → 重新加载目录树与笔记索引。
 */
export function useWorkspaceSwitch() {
  const ws = useWorkspaceStore()
  const noteStore = useNoteStore()
  const directoryStore = useDirectoryStore()
  const settingStore = useSettingStore()
  const { t } = useI18n()

  /** 切换空间后重新灌数据：目录树、笔记、当前筛选 */
  async function reloadWorkspaceData(): Promise<void> {
    await directoryStore.reload()
    await noteStore.reload()
    if (settingStore.settings.rememberLastDirectory) {
      noteStore.setFilterDirectory(directoryStore.currentDirectoryId ?? null)
    } else {
      noteStore.setFilterDirectory(null)
    }
  }

  async function switchWorkspace(id: string): Promise<void> {
    if (id === ws.currentId) return
    if (!ws.byId(id)) return
    ws.switching = true
    // 重建索引期间会有一瞬间的窗口失焦，抑制自动隐藏，避免切换后窗口自己藏起来
    suppressMainAutoHide(2000)
    try {
      // 先把当前空间的待写内容落盘，否则会被写到新空间的目录里
      await noteStore.flushPendingSave()
      ws.setCurrent(id)
      await reloadWorkspaceData()
    } finally {
      ws.switching = false
      suppressMainAutoHide(800)
    }
  }

  /** 递归扫描自定义空间里已有的 .md，建成目录树 + 笔记索引（不动原文件） */
  async function buildIndex(target: Workspace): Promise<void> {
    const metaBase = ws.metaPathOf(target)
    await invoke('ensure_dir', { path: metaBase })
    const scan = await invoke<ScanResult>('scan_workspace_dir', { path: target.path })
    const now = Date.now()

    // 目录按层级升序处理，父目录先建好 id 才好挂子目录
    const directories: Directory[] = []
    const idByRel = new Map<string, string>()
    const sortedDirs = [...scan.dirs].sort((a, b) => {
      const depthDiff = a.split('/').length - b.split('/').length
      return depthDiff !== 0 ? depthDiff : a.localeCompare(b)
    })
    for (const rel of sortedDirs) {
      const segments = rel.split('/')
      const name = segments[segments.length - 1]
      const parentRel = segments.slice(0, -1).join('/')
      const id = crypto.randomUUID()
      idByRel.set(rel, id)
      directories.push({
        id,
        name,
        parentId: idByRel.get(parentRel) ?? null,
        createdAt: now,
        updatedAt: now,
      })
    }

    const notes: NoteMetadata['notes'] = scan.files.map((file) => {
      const segments = file.rel_path.split('/')
      const fileName = segments[segments.length - 1]
      const dirRel = segments.slice(0, -1).join('/')
      const title = extractTitle(file.head) || fileName.replace(/\.md$/i, '')
      return {
        id: crypto.randomUUID(),
        title,
        createdAt: file.modified || now,
        updatedAt: file.modified || now,
        isPinned: false,
        isLocked: false,
        directoryId: idByRel.get(dirRel),
        fileName,
      }
    })

    const dirData: DirectoryData = { version: 1, directories }
    const metadata: NoteMetadata = { version: METADATA_VERSION, notes }
    await invoke('write_directories', { basePath: metaBase, content: JSON.stringify(dirData, null, 2) })
    await invoke('write_metadata', { basePath: metaBase, content: JSON.stringify(metadata, null, 2) })
  }

  /** 弹出系统文件夹选择器，返回用户选的绝对路径（取消返回 null） */
  async function pickWorkspaceFolder(): Promise<string | null> {
    // 原生面板弹出会让主窗口失焦；不打这个标记，窗口会在面板刚出现时自动隐藏，
    // 面板随之被撤掉，表现为「闪一下，选不了文件夹」。
    setNativeDialogOpen(true)
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: t('workspace.pickFolder', '选择工作空间文件夹'),
      })
      return typeof picked === 'string' ? picked : null
    } finally {
      setNativeDialogOpen(false)
      // 面板关掉后把窗口和焦点收回来，否则窗口停在隐藏态
      const appWindow = getCurrentWindow()
      await appWindow.show()
      await appWindow.setFocus()
    }
  }

  /**
   * 新增工作空间：选文件夹 → 校验 → 建索引 → 直接切过去
   */
  async function addWorkspace(folderPath?: string): Promise<Workspace | null> {
    const path = folderPath ?? (await pickWorkspaceFolder())
    if (!path) return null
    const created = await ws.addFromPath(path)
    try {
      await buildIndex(created)
    } catch (e) {
      console.error('扫描工作空间失败:', e)
    }
    await switchWorkspace(created.id)
    return created
  }

  async function renameWorkspace(id: string, name: string): Promise<void> {
    await ws.rename(id, name)
  }

  /**
   * 删除工作空间：只从列表移除，磁盘上的文件一律不动；删的是当前空间就回到 iCloud
   */
  async function removeWorkspace(id: string): Promise<void> {
    const wasCurrent = ws.currentId === id
    if (wasCurrent) await noteStore.flushPendingSave()
    // ws.remove 会把当前空间切回 iCloud
    await ws.remove(id)
    if (wasCurrent) await reloadWorkspaceData()
  }

  /** 界面显示用名字：iCloud 空间固定「默认空间」（跟随语言） */
  function displayNameOf(target?: Workspace | null): string {
    if (!target) return DEFAULT_ICLOUD_NAME
    return target.kind === 'icloud' ? t('workspace.defaultName') || DEFAULT_ICLOUD_NAME : target.name
  }

  return {
    switchWorkspace,
    addWorkspace,
    renameWorkspace,
    removeWorkspace,
    pickWorkspaceFolder,
    buildIndex,
    reloadWorkspaceData,
    displayNameOf,
  }
}
