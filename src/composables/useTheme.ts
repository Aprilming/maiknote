import { ref, watch, onUnmounted } from 'vue'
import { useSettingStore } from '@/stores/settingStore'

// 当前生效的主题：'light' | 'dark'
const currentTheme = ref<'light' | 'dark'>('light')

// 系统主题媒体查询
let mediaQuery: MediaQueryList | null = null

// 获取系统主题
function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

// 根据设置计算当前应使用的主题
function computeTheme(): 'light' | 'dark' {
  const settings = localStorage.getItem('marknote-settings')
  if (settings) {
    try {
      const parsed = JSON.parse(settings)
      if (parsed.theme === 'auto') {
        return getSystemTheme()
      }
      return parsed.theme || 'light'
    } catch {
      return getSystemTheme()
    }
  }
  return getSystemTheme()
}

// 应用主题到 document
function applyTheme(theme: 'light' | 'dark') {
  currentTheme.value = theme
  // 通过 data 属性让 CSS 选择器可以区分
  document.documentElement.setAttribute('data-theme', theme)
}

// 监听系统主题变化
function handleSystemThemeChange(e: MediaQueryListEvent) {
  const settings = localStorage.getItem('marknote-settings')
  let theme: string = 'auto'
  if (settings) {
    try {
      const parsed = JSON.parse(settings)
      theme = parsed.theme || 'auto'
    } catch {
      theme = 'auto'
    }
  }
  if (theme === 'auto') {
    applyTheme(e.matches ? 'dark' : 'light')
  }
}

// 同步初始化主题（在应用挂载前调用）
export function initTheme() {
  applyTheme(computeTheme())

  // 监听系统主题变化
  if (typeof window !== 'undefined' && window.matchMedia) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', handleSystemThemeChange)
  }
}

export function useTheme() {
  const settingStore = useSettingStore()

  // 监听设置变化
  watch(
    () => settingStore.settings.theme,
    () => {
      applyTheme(computeTheme())
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
