import { computed, ref } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Workspace } from '@/stores/workspaceStore'
import type { WebdavForceMode, WebdavProgress, WebdavSyncReport } from '@/types/webdav'
import { useWebdavStore } from '@/stores/webdavStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useDirectoryStore } from '@/stores/directoryStore'
import { useNoteStore, onNoteSaved } from '@/stores/noteStore'
import { directoryRelPath, fileNameForTitle } from '@/utils/notePath'

/** 保存笔记后等这么久再推：连续敲字时别每一笔都发一次请求 */
const AUTO_SYNC_DELAY = 30_000

/** 模块级单例状态：设置页、启动流程共用同一份，避免两处各开一个定时器 */
const running = ref(false)
const syncingSpaceId = ref('')
const summaries = ref<Record<string, string>>({})
/** 每个空间当前的进度：后端每处理几个文件推一条，界面拿它显示百分比 */
const progress = ref<Record<string, WebdavProgress>>({})
/** 已经发出「停止」但后端还没收尾 */
const stopping = ref(false)
/** 同步自己写盘会触发保存事件，别让它再排下一轮同步（不然 30 秒一轮停不下来） */
let suppressAuto = false
let progressOff: UnlistenFn | null = null
let progressStarting = false
let started = false
let timer: ReturnType<typeof setTimeout> | null = null
let unsubscribe: (() => void) | null = null

/** 当前笔记的磁盘相对路径：同步时它只上传不下载，免得远端版本盖掉正在编辑的内容 */
function currentNoteRelPath(): string[] {
  const noteStore = useNoteStore()
  const directoryStore = useDirectoryStore()
  const note = noteStore.currentNote
  if (!note) return []
  const name = note.fileName || fileNameForTitle(note.title)
  const dir = note.directoryId
    ? directoryRelPath(directoryStore.directories, note.directoryId)
    : ''
  return [dir ? dir + '/' + name : name]
}

function summarize(report: WebdavSyncReport): string {
  if (report.cancelled) return '已停止'
  const parts: string[] = []
  if (report.uploaded) parts.push('↑' + report.uploaded)
  if (report.downloaded) parts.push('↓' + report.downloaded)
  if (report.deleted) parts.push('−' + report.deleted)
  return parts.length ? parts.join('  ') : '—'
}

/**
 * 下下来之后把索引拉齐：metadata.json 变了就重读索引并收编新文件，
 * 否则新笔记只躺在磁盘上，列表里看不见。
 */
async function reconcile(ws: Workspace, report: WebdavSyncReport | null): Promise<void> {
  if (!report) return
  suppressAuto = true
  try {
    await reconcileInner(ws, report)
  } finally {
    // 收编完再多挡一会儿：写盘 → 保存事件是异步冒出来的
    setTimeout(() => {
      suppressAuto = false
    }, 1500)
  }
}

async function reconcileInner(ws: Workspace, report: WebdavSyncReport): Promise<void> {
  const wsStore = useWorkspaceStore()
  if (wsStore.currentId !== ws.id) return
  const noteStore = useNoteStore()
  const directoryStore = useDirectoryStore()

  if (report.metaChanged) {
    const keepId = noteStore.currentNoteId
    await noteStore.flushPendingSave()
    await directoryStore.loadDirectories()
    await noteStore.reload()
    if (keepId) noteStore.selectNote(keepId)
  }
  if (report.downloadedFiles.length) {
    const added = await noteStore.adoptSyncedFiles(report.downloadedFiles)
    if (added > 0) console.info('[webdav] 收编了 ' + added + ' 条新增笔记')
  }
}

async function syncSpace(
  ws: Workspace,
  options: { skipDownload?: string[]; silent?: boolean } = {}
): Promise<WebdavSyncReport | null> {
  const store = useWebdavStore()
  await store.initialize()
  if (!store.hasServer) return null
  if (running.value) return null

  running.value = true
  syncingSpaceId.value = ws.id
  try {
    const report = await store.syncWorkspace(ws, { skipDownload: options.skipDownload })
    summaries.value = { ...summaries.value, [ws.id]: summarize(report) }
    await reconcile(ws, report)
    if (!options.silent) {
      console.info('[webdav] ' + ws.name + ' 同步完成', report)
    }
    return report
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    summaries.value = { ...summaries.value, [ws.id]: message }
    console.error('[webdav] ' + ws.name + ' 同步失败:', e)
    return null
  } finally {
    running.value = false
    syncingSpaceId.value = ''
    stopping.value = false
    clearProgress(ws.id)
  }
}

/** 强制动作：本地盖云端 / 云端盖本地 / 清空云端 */
async function forceSpace(ws: Workspace, mode: WebdavForceMode): Promise<WebdavSyncReport | null> {
  const store = useWebdavStore()
  await store.initialize()
  if (!store.hasServer) return null
  if (running.value) return null
  running.value = true
  syncingSpaceId.value = ws.id
  try {
    if (mode !== 'push') await useNoteStore().flushPendingSave()
    const report = await store.forceSync(ws, mode)
    summaries.value = { ...summaries.value, [ws.id]: summarize(report) }
    // 盖完本地或清空云端都要重读索引，否则列表还停在旧状态
    await reconcile(ws, report)
    return report
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    summaries.value = { ...summaries.value, [ws.id]: message }
    console.error('[webdav] ' + ws.name + ' 强制' + mode + '失败:', e)
    return null
  } finally {
    running.value = false
    syncingSpaceId.value = ''
    stopping.value = false
    clearProgress(ws.id)
  }
}

/** 停止正在跑的同步：后端在每个文件前查开关，正在传的那个文件传完就停 */
async function stopSync(): Promise<void> {
  if (!running.value || stopping.value) return
  stopping.value = true
  await useWebdavStore().cancelSync()
}

/** 同步所有开启了同步的空间（设置页「全部同步」用） */
async function syncAll(): Promise<number> {
  const store = useWebdavStore()
  const wsStore = useWorkspaceStore()
  await store.initialize()
  let done = 0
  for (const ws of [...wsStore.workspaces]) {
    if (!store.optionOf(ws.id).enabled) continue
    const report = await syncSpace(ws, { skipDownload: currentNoteRelPath() })
    if (report) done++
  }
  return done
}

function scheduleAutoSync(): void {
  const store = useWebdavStore()
  const ws = useWorkspaceStore().current
  if (!ws || !store.optionOf(ws.id).enabled) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void autoSync()
  }, AUTO_SYNC_DELAY)
}

async function autoSync(): Promise<void> {
  const store = useWebdavStore()
  const ws = useWorkspaceStore().current
  if (!ws || !store.optionOf(ws.id).enabled) return
  await useNoteStore().flushPendingSave()
  await syncSpace(ws, { skipDownload: currentNoteRelPath(), silent: true })
}

/**
 * 订阅后端推的进度事件。设置页和启动流程都会调，只装一次。
 */
async function initProgressListener(): Promise<void> {
  if (progressOff || progressStarting) return
  progressStarting = true
  try {
    progressOff = await listen<WebdavProgress>('webdav://progress', event => {
      const p = event.payload
      if (!p?.workspaceId) return
      progress.value = { ...progress.value, [p.workspaceId]: p }
    })
  } catch (e) {
    console.error('[webdav] 订阅同步进度失败:', e)
  } finally {
    progressStarting = false
  }
}

function clearProgress(workspaceId: string): void {
  if (!progress.value[workspaceId]) return
  const next = { ...progress.value }
  delete next[workspaceId]
  progress.value = next
}

/**
 * 挂上自动同步：保存笔记后 30 秒推一次，启动时先拉一次。
 * 应用启动只调一次，重复调用安全。
 */
async function startAutoSync(): Promise<void> {
  if (started) return
  started = true
  const store = useWebdavStore()
  await store.initialize()
  await initProgressListener()

  if (!unsubscribe) {
    unsubscribe = onNoteSaved(() => {
      if (running.value || suppressAuto) return
      scheduleAutoSync()
    })
  }

  if (!store.hasServer || store.enabledCount === 0) return
  const wsStore = useWorkspaceStore()
  for (const ws of [...wsStore.workspaces]) {
    if (!store.optionOf(ws.id).enabled) continue
    await syncSpace(ws, { silent: true })
  }
}

function stopAutoSync(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  if (progressOff) {
    progressOff()
    progressOff = null
  }
  started = false
}

export function useWebdavSync() {
  const enabledSpaceCount = computed(() => useWebdavStore().enabledCount)

  return {
    running,
    syncingSpaceId,
    summaries,
    progress,
    stopping,
    stopSync,
    initProgressListener,
    enabledSpaceCount,
    startAutoSync,
    stopAutoSync,
    scheduleAutoSync,
    syncSpace,
    forceSpace,
    syncAll,
    currentNoteRelPath,
  }
}
