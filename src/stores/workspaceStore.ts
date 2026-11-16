import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

/**
 * 工作空间类型：icloud = 默认空间（内容与索引都在 iCloud 目录），custom = 用户自己选的任意文件夹
 */
export type WorkspaceKind = 'icloud' | 'custom'

export interface Workspace {
  id: string
  /** 显示名，iCloud 空间固定显示「默认空间」，自定义空间默认取文件夹名 */
  name: string
  /** 内容根目录（绝对路径） */
  path: string
  kind: WorkspaceKind
  createdAt: number
}

interface WorkspaceFile {
  version: number
  workspaces: Workspace[]
}

export const ICLOUD_WORKSPACE_ID = 'icloud'
const CURRENT_KEY = 'currentWorkspaceId'
/** iCloud 空间的显示名（自定义空间名由用户决定） */
export const DEFAULT_ICLOUD_NAME = '默认空间'

function dirNameOf(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : path
}

function newId(): string {
  return `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 工作空间列表本身存应用配置目录（不走 iCloud），只有 iCloud 空间的内容与索引在 iCloud 里同步。
 * 本 store 只依赖 invoke 与 localStorage，不 import 其它 store，避免循环依赖。
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaces = ref<Workspace[]>([])
  const currentId = ref<string>(ICLOUD_WORKSPACE_ID)
  /** 自定义空间的索引目录根，<metaRoot>/<workspaceId> 存 metadata.json / directories.json / assistants.json */
  const metaRoot = ref('')
  const ready = ref(false)
  const switching = ref(false)
  let initPromise: Promise<void> | null = null

  const current = computed<Workspace | undefined>(
    () => workspaces.value.find(w => w.id === currentId.value) ?? workspaces.value[0]
  )
  const customs = computed(() => workspaces.value.filter(w => w.kind === 'custom'))
  const hasCustoms = computed(() => customs.value.length > 0)
  const currentKind = computed<WorkspaceKind>(() => current.value?.kind ?? 'icloud')

  function metaPathOf(ws?: Workspace | null): string {
    const target = ws ?? current.value
    if (!target) return ''
    // iCloud 空间的索引就放在内容根目录，保持既有数据与同步行为
    if (target.kind === 'icloud' || !metaRoot.value) return target.path
    return `${metaRoot.value}/${target.id}`
  }

  async function initialize(force = false): Promise<void> {
    if (ready.value && !force) return
    if (initPromise && !force) return initPromise
    initPromise = (async () => {
      try {
        const icloudPath = await invoke<string>('get_icloud_path')
        metaRoot.value = await invoke<string>('workspace_meta_root')
        const raw = await invoke<string>('read_workspaces').catch(() => '')
        let stored: Workspace[] = []
        try {
          const parsed: WorkspaceFile | null = raw ? JSON.parse(raw) : null
          stored = Array.isArray(parsed?.workspaces) ? parsed!.workspaces : []
        } catch {
          stored = []
        }
        const icloudWs: Workspace = {
          id: ICLOUD_WORKSPACE_ID,
          name: DEFAULT_ICLOUD_NAME,
          path: icloudPath,
          kind: 'icloud',
          createdAt: 0,
        }
        workspaces.value = [icloudWs, ...stored.filter(w => !!w && w.kind === 'custom' && !!w.path)]
        const saved = localStorage.getItem(CURRENT_KEY)
        currentId.value = workspaces.value.some(w => w.id === saved) ? (saved as string) : ICLOUD_WORKSPACE_ID
        ready.value = true
      } finally {
        initPromise = null
      }
    })()
    return initPromise
  }

  /** 取某个空间的目录：content = 笔记/文件夹/图片，meta = metadata.json 等索引文件 */
  async function basePathOf(kind: 'content' | 'meta', ws?: Workspace | null): Promise<string> {
    if (!ready.value) await initialize()
    const target = ws ?? current.value
    if (!target) throw new Error('工作空间还没准备好')
    return kind === 'meta' ? metaPathOf(target) : target.path
  }

  const contentBasePath = () => basePathOf('content')
  const metaBasePath = () => basePathOf('meta')

  async function persist(): Promise<void> {
    const data: WorkspaceFile = { version: 1, workspaces: customs.value }
    await invoke('write_workspaces', { content: JSON.stringify(data, null, 2) })
  }

  function setCurrent(id: string): void {
    if (!workspaces.value.some(w => w.id === id)) return
    currentId.value = id
    localStorage.setItem(CURRENT_KEY, id)
  }

  /**
   * 把用户选的文件夹加成新的工作空间（校验存在/可写），返回新空间
   */
  async function addFromPath(folderPath: string): Promise<Workspace> {
    if (!ready.value) await initialize()
    const canonical = await invoke<string>('validate_workspace_dir', { path: folderPath })
    const existed = workspaces.value.find(w => w.path === canonical)
    if (existed) throw new Error('这个文件夹已经是工作空间了')
    const ws: Workspace = {
      id: newId(),
      name: dirNameOf(canonical),
      path: canonical,
      kind: 'custom',
      createdAt: Date.now(),
    }
    workspaces.value = [...workspaces.value, ws]
    await persist()
    return ws
  }

  /** 只改显示名，不动磁盘文件夹名 */
  async function rename(id: string, name: string): Promise<void> {
    const ws = workspaces.value.find(w => w.id === id)
    if (!ws || ws.kind === 'icloud') return
    const trimmed = name.trim()
    if (!trimmed) return
    ws.name = trimmed
    await persist()
  }

  /** 只从列表移除，磁盘文件一律不动 */
  async function remove(id: string): Promise<void> {
    const ws = workspaces.value.find(w => w.id === id)
    if (!ws || ws.kind === 'icloud') return
    workspaces.value = workspaces.value.filter(w => w.id !== id)
    await persist()
    // 顺手把这个空间的索引目录删掉，否则 workspace-meta/<id> 会永远留在磁盘上
    try {
      await invoke('remove_workspace_meta', { workspaceId: id })
    } catch (e) {
      console.error('Failed to remove workspace meta dir:', e)
    }
    if (currentId.value === id) setCurrent(ICLOUD_WORKSPACE_ID)
  }

  async function ensureMetaDir(ws?: Workspace | null): Promise<string> {
    const dir = metaPathOf(ws)
    if (dir) await invoke('ensure_dir', { path: dir })
    return dir
  }

  function byId(id: string): Workspace | undefined {
    return workspaces.value.find(w => w.id === id)
  }

  return {
    workspaces,
    currentId,
    metaRoot,
    ready,
    switching,
    current,
    currentKind,
    customs,
    hasCustoms,
    initialize,
    basePathOf,
    contentBasePath,
    metaBasePath,
    metaPathOf,
    ensureMetaDir,
    setCurrent,
    addFromPath,
    rename,
    remove,
    persist,
    byId,
  }
})
