import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { Workspace } from '@/stores/workspaceStore'
import {
  emptyWebdavConfig,
  WEBDAV_PASSWORD_ACCOUNT,
  type WebdavConfig,
  type WebdavForceMode,
  type WebdavSyncReport,
  type WebdavWorkspaceConfig,
} from '@/types/webdav'
import { getSecret, setSecret } from '@/composables/useSecrets'
import { useWorkspaceStore } from '@/stores/workspaceStore'

function blankOption(): WebdavWorkspaceConfig {
  return { enabled: false, remoteDir: '', lastSyncAt: 0, lastError: '' }
}

/** 远端目录里的名字：去掉路径分隔符和首尾空白，避免把空间名写成一串目录 */
function safeName(name: string): string {
  return name.replace(/[/\\]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '') || 'workspace'
}

export const useWebdavStore = defineStore('webdav', () => {
  const config = ref<WebdavConfig>(emptyWebdavConfig())
  const password = ref('')
  const loaded = ref(false)
  const syncingId = ref('')
  const reports = ref<Record<string, WebdavSyncReport>>({})
  const testing = ref(false)
  const testResult = ref('')

  const enabledCount = computed(
    () => Object.values(config.value.workspaces).filter(w => w.enabled).length
  )
  const hasServer = computed(() => config.value.url.trim().length > 0)

  function optionOf(workspaceId: string): WebdavWorkspaceConfig {
    return config.value.workspaces[workspaceId] ?? blankOption()
  }

  /** 远端默认目录：MaikNote/<空间名> */
  function defaultRemoteDir(ws?: Workspace | null): string {
    return `MaikNote/${safeName(ws?.name ?? 'workspace')}`
  }

  async function initialize(force = false): Promise<void> {
    if (loaded.value && !force) return
    try {
      const raw = await invoke<WebdavConfig | null>('read_webdav_config')
      config.value = {
        ...emptyWebdavConfig(),
        ...(raw ?? {}),
        workspaces: { ...(raw?.workspaces ?? {}) },
      }
      password.value = await getSecret(WEBDAV_PASSWORD_ACCOUNT)
    } catch (e) {
      console.error('[webdav] 读取同步配置失败:', e)
    }
    loaded.value = true
  }

  async function persist(): Promise<void> {
    try {
      await invoke('write_webdav_config', { content: JSON.stringify(config.value) })
    } catch (e) {
      console.error('[webdav] 保存同步配置失败:', e)
    }
  }

  async function setServer(patch: Partial<Pick<WebdavConfig, 'url' | 'username' | 'insecureTls'>>): Promise<void> {
    config.value = { ...config.value, ...patch }
    await persist()
  }

  async function savePassword(value: string): Promise<void> {
    password.value = value
    await setSecret(WEBDAV_PASSWORD_ACCOUNT, value)
  }

  function setOption(workspaceId: string, patch: Partial<WebdavWorkspaceConfig>): void {
    config.value = {
      ...config.value,
      workspaces: {
        ...config.value.workspaces,
        [workspaceId]: { ...optionOf(workspaceId), ...patch },
      },
    }
  }

  /** 开关某个空间的同步：第一次打开时把远端目录定下来，之后不再跟着空间名改 */
  async function setEnabled(ws: Workspace, enabled: boolean): Promise<void> {
    const prev = optionOf(ws.id)
    setOption(ws.id, {
      enabled,
      remoteDir: prev.remoteDir || defaultRemoteDir(ws),
      lastError: enabled ? prev.lastError : '',
    })
    await persist()
  }

  async function setRemoteDir(workspaceId: string, remoteDir: string): Promise<void> {
    setOption(workspaceId, { remoteDir })
    await persist()
  }

  async function testConnection(): Promise<string> {
    testing.value = true
    testResult.value = ''
    try {
      const message = await invoke<string>('webdav_test', {
        url: config.value.url.trim(),
        username: config.value.username,
        password: password.value,
        insecureTls: config.value.insecureTls,
      })
      testResult.value = message
      return message
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      testResult.value = message
      throw e
    } finally {
      testing.value = false
    }
  }

  /**
   * 同步一个空间：后端对账全部做完，这里只负责把参数凑齐并把结果记下来
   * @param skipDownload 只在远端存在时才用到：正在编辑的笔记不让远端版本盖掉
   */
  /** 把一空间的后端入参凑齐：普通同步和三种强制动作共用 */
  async function buildRequest(
    ws: Workspace,
    skipDownload: string[] = []
  ): Promise<Record<string, unknown>> {
    const wsStore = useWorkspaceStore()
    const contentRoot = await wsStore.basePathOf('content', ws)
    const metaRoot = wsStore.metaPathOf(ws)
    const opt = optionOf(ws.id)
    const remoteDir = opt.remoteDir || defaultRemoteDir(ws)
    if (!opt.remoteDir) setOption(ws.id, { remoteDir })
    return {
      workspaceId: ws.id,
      contentRoot,
      metaRoot,
      remoteDir,
      url: config.value.url.trim(),
      username: config.value.username,
      password: password.value,
      skipDownload,
      insecureTls: config.value.insecureTls,
    }
  }

  async function syncWorkspace(
    ws: Workspace,
    options: { skipDownload?: string[] } = {}
  ): Promise<WebdavSyncReport> {
    await initialize()
    syncingId.value = ws.id
    try {
      const req = await buildRequest(ws, options.skipDownload ?? [])
      const report = await invoke<WebdavSyncReport>('webdav_sync', { req })
      reports.value = { ...reports.value, [ws.id]: report }
      setOption(ws.id, {
        lastSyncAt: report.finishedAt,
        // 手动停止不是错误，别在空间行留一条红字
        lastError: report.cancelled ? '' : report.errors[0] ?? '',
      })
      await persist()
      return report
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setOption(ws.id, { lastError: message })
      await persist()
      throw e
    } finally {
      if (syncingId.value === ws.id) syncingId.value = ''
    }
  }

  /**
   * 强制动作：本地盖云端 / 云端盖本地 / 清空云端。
   * 跟普通同步不同，这三件事不做对账，照做。
   */
  async function forceSync(ws: Workspace, mode: WebdavForceMode): Promise<WebdavSyncReport> {
    await initialize()
    syncingId.value = ws.id
    try {
      const req = await buildRequest(ws)
      const report = await invoke<WebdavSyncReport>('webdav_force', { req, mode })
      reports.value = { ...reports.value, [ws.id]: report }
      setOption(ws.id, {
        lastSyncAt: report.finishedAt,
        // 强制动作半路被停 / 出错都得说出来：清空云端没清干净不能显示成正常
        lastError: report.errors[0] ?? '',
      })
      await persist()
      return report
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setOption(ws.id, { lastError: message })
      await persist()
      throw e
    } finally {
      if (syncingId.value === ws.id) syncingId.value = ''
    }
  }

  /** 让后端把正在跑的同步收尾：当前这个文件传完就停 */
  async function cancelSync(): Promise<void> {
    try {
      await invoke('webdav_cancel_sync')
    } catch (e) {
      console.error('[webdav] 停止同步失败', e)
    }
  }

  return {
    config,
    password,
    loaded,
    syncingId,
    reports,
    testing,
    testResult,
    enabledCount,
    hasServer,
    optionOf,
    defaultRemoteDir,
    initialize,
    persist,
    setServer,
    savePassword,
    setOption,
    setEnabled,
    setRemoteDir,
    testConnection,
    syncWorkspace,
    forceSync,
    cancelSync,
  }
})
