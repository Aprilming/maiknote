import { onMounted, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useSettingStore } from '@/stores/settingStore'

/**
 * 注册全局快捷键 - 用于在应用隐藏时显示主窗口和居中
 * 使用 Rust 后端处理全局快捷键
 */
export function useGlobalShortcut() {
  const settingStore = useSettingStore()

  // 注册全局快捷键（showMain）
  async function registerGlobalShortcut() {
    const shortcut = settingStore.settings.shortcuts.showMain
    try {
      await invoke('register_global_shortcut', { shortcutStr: shortcut })
    } catch (e) {
      console.error('Failed to register global shortcut:', e)
    }
  }

  // 注册全局居中快捷键
  async function registerCenterShortcut() {
    const shortcut = settingStore.settings.shortcuts.centerWindow
    if (!shortcut) return
    try {
      await invoke('register_center_shortcut', { shortcutStr: shortcut })
    } catch (e) {
      console.error('Failed to register center shortcut:', e)
    }
  }

  // 监听快捷键设置变化
  watch(
    () => settingStore.settings.shortcuts.showMain,
    () => {
      registerGlobalShortcut()
    }
  )

  watch(
    () => settingStore.settings.shortcuts.centerWindow,
    () => {
      registerCenterShortcut()
    }
  )

  onMounted(() => {
    registerGlobalShortcut()
    registerCenterShortcut()
  })

  return {
    registerGlobalShortcut,
    registerCenterShortcut,
  }
}
