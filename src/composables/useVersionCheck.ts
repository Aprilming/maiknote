import { ref } from 'vue'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import i18n from '../i18n'
import packageJson from '../../package.json'

const currentVersion = packageJson.version

// 最新版本信息
const latestVersion = ref<string | null>(null)
const updateAvailable = ref(false)
const checkError = ref<string | null>(null)

// 下载安装状态
type DownloadState = 'idle' | 'checking' | 'downloading' | 'installing' | 'done' | 'error'
const downloadState = ref<DownloadState>('idle')
const downloadProgress = ref(0)

// 检查更新
async function checkForUpdates(): Promise<boolean> {
  downloadState.value = 'checking'
  checkError.value = null
  updateAvailable.value = false

  try {
    const update = await check()
    if (update) {
      latestVersion.value = update.version
      updateAvailable.value = true
      downloadState.value = 'idle'
      return true
    }
    downloadState.value = 'idle'
    return false
  } catch (error) {
    console.error('Update check failed:', error)
    checkError.value = i18n.global.t('version.networkError')
    downloadState.value = 'error'
    return false
  }
}

// 下载并安装更新
async function downloadAndInstall(): Promise<void> {
  let contentLength = 0
  let downloaded = 0

  try {
    const update = await check()
    if (!update) {
      checkError.value = i18n.global.t('version.noUpdate')
      downloadState.value = 'error'
      return
    }

    downloadState.value = 'downloading'
    downloadProgress.value = 0

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength ?? 0
          downloaded = 0
          break
        case 'Progress':
          downloaded += event.data.chunkLength
          if (contentLength > 0) {
            downloadProgress.value = Math.round(
              (downloaded / contentLength) * 100
            )
          }
          break
        case 'Finished':
          downloadState.value = 'installing'
          break
      }
    })

    downloadState.value = 'done'
    await relaunch()
  } catch (error) {
    console.error('Update download/install failed:', error)
    checkError.value = i18n.global.t('version.downloadError')
    downloadState.value = 'error'
  }
}

export function useVersionCheck() {
  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    checkError,
    downloadState,
    downloadProgress,
    checkForUpdates,
    downloadAndInstall,
  }
}
