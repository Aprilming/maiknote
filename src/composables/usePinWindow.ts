import { getCurrentWindow } from '@tauri-apps/api/window'
import { useSettingStore } from '@/stores/settingStore'

/**
 * 置顶窗口操作
 * 统一处理置顶开关与「取消置顶时」的窗口显示/隐藏行为，快捷键、标题栏按钮共用
 */
export function usePinWindow() {
  const settingStore = useSettingStore()

  /** 取消置顶后：按设置决定是否隐藏窗口（show=依旧显示页面，hide=隐藏页面） */
  async function applyPinOffBehavior() {
    if (settingStore.settings.pinOffBehavior !== 'hide') return
    try {
      await getCurrentWindow().hide()
    } catch (error) {
      console.error('Failed to hide window after unpin:', error)
    }
  }

  /** 切换置顶状态，返回切换后的值 */
  async function togglePin(): Promise<boolean> {
    const appWindow = getCurrentWindow()
    const newValue = !settingStore.settings.alwaysOnTop
    await appWindow.setAlwaysOnTop(newValue)
    settingStore.updateSettings('alwaysOnTop', newValue)
    if (!newValue) {
      await applyPinOffBehavior()
    }
    return newValue
  }

  return { applyPinOffBehavior, togglePin }
}
