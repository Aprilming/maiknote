import { ref } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { fetch } from '@tauri-apps/plugin-http'
import packageJson from '../../package.json'

const currentVersion = packageJson.version

// 最新版本信息
const latestVersion = ref<string | null>(null)
const isLoading = ref(false)
const updateAvailable = ref(false)
const checkError = ref<string | null>(null)
const releaseUrl = 'https://github.com/Aprilming/maiknote/releases'
const tagsUrl = 'https://github.com/Aprilming/maiknote/tags'

// 比较版本号
function compareVersions(current: string, latest: string): boolean {
  const currentParts = current.replace(/^v/, '').split('.').map(Number)
  const latestParts = latest.replace(/^v/, '').split('.').map(Number)

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const a = currentParts[i] || 0
    const b = latestParts[i] || 0
    if (b > a) return true
    if (a > b) return false
  }
  return false
}

// 获取最新版本
async function checkForUpdates(): Promise<boolean> {
  isLoading.value = true
  updateAvailable.value = false
  checkError.value = null

  try {
    // 请求 releases/latest，跟随重定向获取最终 URL
    const response = await fetch('https://github.com/Aprilming/maiknote/releases/latest', {
      method: 'GET',
      redirect: 'follow'
    })

    // 获取重定向后的最终 URL
    const finalUrl = response.url

    // 从 URL 中提取版本号，格式: https://github.com/Aprilming/maiknote/releases/tag/v0.2.0
    const match = finalUrl.match(/\/releases\/tag\/(v?[\d.]+)/)

    if (match) {
      latestVersion.value = match[1]

      if (compareVersions(currentVersion, match[1])) {
        updateAvailable.value = true
      }
    } else {
      checkError.value = '无法解析版本信息'
    }

    return updateAvailable.value
  } catch (error) {
    console.error('Failed to check for updates:', error)
    checkError.value = '网络错误，请检查网络连接'
    return false
  } finally {
    isLoading.value = false
  }
}

// 打开 release 页面
async function openReleasePage() {
  await openUrl(releaseUrl)
}

export function useVersionCheck() {
  return {
    currentVersion,
    latestVersion,
    isLoading,
    updateAvailable,
    checkError,
    releaseUrl,
    tagsUrl,
    checkForUpdates,
    openReleasePage
  }
}
