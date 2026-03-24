<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { useNoteStore } from '@/stores/noteStore'
import { useSettingStore } from '@/stores/settingStore'
import { useShortcuts } from '@/composables/useShortcuts'
import { useGlobalShortcut } from '@/composables/useGlobalShortcut'
import { useVersionCheck } from '@/composables/useVersionCheck'
import { isNativeDialogCurrentlyOpen } from '@/stores/dialogStore'
import TitleBar from '@/components/TitleBar/TitleBar.vue'
import Editor from '@/components/Editor/MilkdownEditor.vue'
import Settings from '@/components/Settings/Settings.vue'
import SearchPage from '@/components/Search/SearchPage.vue'

// Initialize stores and composables
const noteStore = useNoteStore()
const settingStore = useSettingStore()
useShortcuts()
useGlobalShortcut()
const { latestVersion, updateAvailable, checkForUpdates, openReleasePage } = useVersionCheck()

// 当前页面：'editor' | 'settings' | 'search'
const currentView = ref<'editor' | 'settings' | 'search'>('editor')

// 更新提示 toast，8秒后自动消失
const showUpdateToast = ref(false)
let updateToastTimer: ReturnType<typeof setTimeout> | null = null

watch(updateAvailable, (val) => {
  if (val) {
    showUpdateToast.value = true
    if (updateToastTimer) clearTimeout(updateToastTimer)
    updateToastTimer = setTimeout(() => {
      showUpdateToast.value = false
    }, 8000)
  }
})

function openSettings() {
  currentView.value = 'settings'
}

function closeSettings() {
  currentView.value = 'editor'
}

function openSearchPage() {
  currentView.value = 'search'
}

function closeSearchPage() {
  noteStore.searchQuery = '' // 清空搜索关键词
  currentView.value = 'editor'
}

let unlistenFocus: (() => void) | null = null

onMounted(async () => {
  // 获取 Tauri 窗口实例
  const appWindow = getCurrentWindow()

  // 监听键盘快捷键 Cmd+F 打开搜索页面
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
      event.preventDefault()
      openSearchPage()
    }
  })

  // Load settings
  settingStore.loadSettings()

  // 应用窗口透明度
  if (settingStore.settings.windowAlpha < 1.0) {
    await invoke('set_window_alpha', { alpha: settingStore.settings.windowAlpha })
  }

  // Load notes from iCloud (will create initial note if none exists)
  await noteStore.initialize()

  // 同步窗口置顶状态并监听焦点变化
  if (settingStore.settings.alwaysOnTop) {
    await appWindow.setAlwaysOnTop(true)
  }

  // 窗口失去焦点时隐藏（置顶时不隐藏，对话框打开时不隐藏）
  unlistenFocus = await appWindow.onFocusChanged(({ payload: focused }) => {
    if (!focused && !settingStore.settings.alwaysOnTop && !isNativeDialogCurrentlyOpen()) {
      appWindow.hide()
    }
  })

  // 冷启动时自动检查更新
  await checkForUpdates()
})

onUnmounted(() => {
  if (unlistenFocus) {
    unlistenFocus()
  }
})
</script>

<template>
  <div class="app-container">
    <div class="app-background" :class="{ 'show-grid': settingStore.settings.showGrid }"></div>
    <div class="app-content">
      <TitleBar @open-settings="openSettings" @open-search="openSearchPage" />
      <SearchPage v-if="currentView === 'search'" @close="closeSearchPage" />
      <Settings v-else-if="currentView === 'settings'" @back="closeSettings" />
      <Editor v-else />

      <!-- 更新提示 -->
      <div v-if="showUpdateToast" class="update-toast">
        <div class="update-toast-content">
          <i class="i-mdi-update"></i>
          <span>发现新版本 v{{ latestVersion }}</span>
        </div>
        <button class="update-toast-btn" @click="openReleasePage">
          前往下载
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  position: relative;
  /* 确保容器真正透明 */
  background: transparent;
  /* 裁剪圆角 - 与原生 NSVisualEffectView 圆角 (12px) 保持一致 */
  overflow: hidden;
  border-radius: 12px;
}

/* 毛玻璃背景层 - 由 macOS 原生 NSVisualEffectView 渲染 */
.app-background {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 0;
  overflow: hidden;
  background: transparent !important;
  /* 圆角 - 与原生 NSVisualEffectView 圆角 (12px) 保持一致 */
  border-radius: 12px;
}

/* 深色模式毛玻璃 - 由 macOS 原生 NSVisualEffectView 渲染 */
@media (prefers-color-scheme: dark) {
  .app-background {
    background: transparent !important;
  }
}

/* Grid background */
.app-background.show-grid::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image:
    linear-gradient(var(--color-border) 1px, transparent 1px),
    linear-gradient(90deg, var(--color-border) 1px, transparent 1px);
  background-size: 20px 20px;
  background-position: -1px -1px;
  opacity: 0.5;
  pointer-events: none;
}

.app-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  /* 内容区域完全透明，让毛玻璃透出来 */
  background: transparent;
  /* 圆角 - 与原生 NSVisualEffectView 圆角 (12px) 保持一致 */
  border-radius: 12px;
}

/* 更新提示 Toast */
.update-toast {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
}

.update-toast-content {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--color-primary);
}

.update-toast-content i {
  font-size: 18px;
}

.update-toast-btn {
  padding: 6px 12px;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  color: white;
  cursor: pointer;
  transition: opacity 0.15s;
}

.update-toast-btn:hover {
  opacity: 0.9;
}
</style>
