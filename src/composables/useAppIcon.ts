import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

/** 后端 apply_app_icon 的返回结构 */
export interface AppIconReport {
  variant: string
  /** 运行中进程的图标是否切换成功 */
  runtime: boolean
  /** 被改写的 .app 路径，开发模式下为 null */
  bundle: string | null
  /** 包内 icon.icns 是否真的被替换 */
  bundle_updated: boolean
  /** 后端给的原始说明（中文，仅兜底用） */
  message: string
}

/** 最近一次同步结果，设置页用来显示状态 */
export const appIconReport = ref<AppIconReport | null>(null)
export const appIconError = ref('')

/**
 * 把设置里选中的 Logo 同步成 macOS 的应用图标：
 * 运行期换掉进程图标，并把 icns 写进 .app 包，让访达 / 启动台里的图标跟着变。
 */
export async function syncAppIcon(variant: string): Promise<AppIconReport | null> {
  if (!variant) return null
  try {
    const report = await invoke<AppIconReport>('apply_app_icon', { variant })
    appIconReport.value = report
    appIconError.value = ''
    return report
  } catch (error) {
    appIconError.value = error instanceof Error ? error.message : String(error)
    return null
  }
}
