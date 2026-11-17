/** WebDAV 同步：配置、同步状态与报告的类型定义 */

/** 单个工作空间的同步设置 */
export interface WebdavWorkspaceConfig {
  enabled: boolean
  /** 远端目录（相对服务器根），首次开启时定下来，之后改名也不动它 */
  remoteDir: string
  lastSyncAt: number
  lastError: string
}

export interface WebdavConfig {
  version: number
  url: string
  username: string
  insecureTls: boolean
  workspaces: Record<string, WebdavWorkspaceConfig>
}

export interface WebdavSyncReport {
  /** 用户在传输途中点了「停止同步」 */
  cancelled: boolean;
  workspaceId: string
  remoteDir: string
  uploaded: number
  downloaded: number
  deleted: number
  skipped: number
  /** 索引文件（metadata.json 等）也被远端更新了，需要重读一遍 */
  metaChanged: boolean
  errors: string[]
  downloadedFiles: string[]
  finishedAt: number
}

/** 同步过程中的实时进度（后端事件 webdav://progress 推过来） */
export interface WebdavProgress {
  workspaceId: string
  /** scan 清点本地 / remote 对比云端 / transfer 传文件 / manifest 写清单 / done 收工 */
  phase: 'scan' | 'remote' | 'transfer' | 'manifest' | 'done'
  done: number
  total: number
  detail: string
}

/** 强制动作：push 本地盖云端 / pull 云端盖本地 / wipe 清空云端 */
export type WebdavForceMode = 'push' | 'pull' | 'wipe'

/** 钥匙串里存 WebDAV 密码的账号名 */
export const WEBDAV_PASSWORD_ACCOUNT = 'webdavPassword'

export function emptyWebdavConfig(): WebdavConfig {
  return { version: 1, url: '', username: '', insecureTls: false, workspaces: {} }
}
