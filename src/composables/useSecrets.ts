import { invoke } from '@tauri-apps/api/core'

/**
 * 密钥存取：AI Key 与百度搜索 Key 只放 macOS 钥匙串，
 * 既不写 localStorage（明文可读），也不写 iCloud 的 assistants.json（会同步上云）。
 */

/** 钥匙串里的账号名：一个 Key 一条记录 */
export const SECRET_AI_KEY = 'aiKey'
export const SECRET_BAIDU_KEY = 'baiduSearchKey'

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * 读密钥。钥匙串没解锁、没这条记录、不在 Tauri 环境里都返回空串，
 * 调用方按「没配置」处理，不阻断启动。
 */
export async function getSecret(account: string): Promise<string> {
  if (!inTauri()) return ''
  try {
    const value = await invoke<string | null>('secret_get', { account })
    return value ?? ''
  } catch (e) {
    console.error(`[secrets] 读取 ${account} 失败:`, e)
    return ''
  }
}

/** 写密钥；value 为空等同删除 */
export async function setSecret(account: string, value: string): Promise<void> {
  if (!inTauri()) return
  try {
    await invoke('secret_set', { account, value })
  } catch (e) {
    console.error(`[secrets] 写入 ${account} 失败:`, e)
  }
}

/**
 * 迁移并取值：老版本把 Key 明文写在 localStorage / assistants.json 里。
 * 钥匙串里有值就以钥匙串为准（本地配置可能是旧的），否则把传进来的明文搬进钥匙串。
 * @returns 最终应该使用的值
 */
export async function hydrateSecret(account: string, legacy: string): Promise<string> {
  const stored = await getSecret(account)
  if (stored) return stored
  if (legacy) {
    await setSecret(account, legacy)
    return legacy
  }
  return ''
}
