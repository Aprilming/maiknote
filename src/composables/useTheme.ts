import { ref, watch, onUnmounted } from 'vue'
import { setTheme } from '@tauri-apps/api/app'
import { useSettingStore } from '@/stores/settingStore'

// 当前生效的主题：'light' | 'dark'
const currentTheme = ref<'light' | 'dark'>('light')

// 系统主题媒体查询
let mediaQuery: MediaQueryList | null = null

// 获取系统主题（同步，直接读 media query）
function getSystemThemeSync(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

// 判断当前设置是否为 auto
function isAutoMode(): boolean {
  const settings = localStorage.getItem('maiknote-settings')
  if (settings) {
    try {
      const parsed = JSON.parse(settings)
      return parsed.theme === 'auto'
    } catch {}
  }
  return true
}

// 仅设置 CSS 主题（不操作 Tauri setTheme）
function applyThemeStyle(theme: 'light' | 'dark') {
  currentTheme.value = theme
  document.documentElement.setAttribute('data-theme', theme)
}

// 应用主题到 document + Tauri 原生外观
async function applyTheme(theme: 'light' | 'dark') {
  applyThemeStyle(theme)

  const themeArg = isAutoMode() ? null : theme
  try {
    await setTheme(themeArg)
  } catch (e) {
    console.warn('Failed to set macOS window theme:', e)
  }
}

// 监听系统主题变化
function handleSystemThemeChange(e: MediaQueryListEvent) {
  if (isAutoMode()) {
    applyThemeStyle(e.matches ? 'dark' : 'light')
  }
}

// 检测并应用当前应使用的主题
async function detectAndApplyTheme() {
  const settings = localStorage.getItem('maiknote-settings')
  let targetTheme: 'light' | 'dark' = 'light'

  if (settings) {
    try {
      const parsed = JSON.parse(settings)
      if (parsed.theme === 'auto') {
        // 先重置 webview 主题覆盖，让 matchMedia 恢复真实系统值
        try { await setTheme(null) } catch { /* ignore */ }
        targetTheme = getSystemThemeSync()
      } else {
        targetTheme = (parsed.theme as 'light' | 'dark') || 'light'
      }
    } catch {
      targetTheme = getSystemThemeSync()
    }
  }

  await applyTheme(targetTheme)
}

// 同步初始化主题（在应用挂载前调用）
export async function initTheme() {
  await detectAndApplyTheme()

  if (typeof window !== 'undefined' && window.matchMedia) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', handleSystemThemeChange)
  }
}

export function useTheme() {
  const settingStore = useSettingStore()

  watch(
    () => settingStore.settings.theme,
    () => {
      detectAndApplyTheme()
    }
  )

  onUnmounted(() => {
    if (mediaQuery) {
      mediaQuery.removeEventListener('change', handleSystemThemeChange)
    }
  })

  return {
    currentTheme,
    isDark: () => currentTheme.value === 'dark',
  }
}
