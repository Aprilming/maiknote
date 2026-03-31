import { onMounted, onUnmounted } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useNoteStore } from '@/stores/noteStore'
import { useSettingStore } from '@/stores/settingStore'
import { useSourceMode } from '@/composables/useSourceMode'

/**
 * 检测按键是否匹配快捷键配置
 */
function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1].toLowerCase()
  const modifiers = parts.slice(0, -1)

  // 检查修饰键
  const ctrlMatch = modifiers.some(m => m.toLowerCase() === 'ctrl') ? event.ctrlKey : !event.ctrlKey
  const altMatch = modifiers.some(m => m.toLowerCase() === 'alt') ? event.altKey : !event.altKey
  const shiftMatch = modifiers.some(m => m.toLowerCase() === 'shift') ? event.shiftKey : !event.shiftKey
  const cmdMatch = modifiers.some(m => m.toLowerCase() === 'cmd') ? event.metaKey : !event.metaKey

  // 检查按键
  let keyMatch = false
  if (key === 'arrowleft') {
    keyMatch = event.key === 'ArrowLeft'
  } else if (key === 'arrowright') {
    keyMatch = event.key === 'ArrowRight'
  } else if (key === 'backspace') {
    keyMatch = event.key === 'Backspace'
  } else if (key === 'n' || key === 'f' || key === 'p' || key === 'l') {
    keyMatch = event.key.toLowerCase() === key
  } else if (key === '[') {
    keyMatch = event.key === '['
  } else if (key === ']') {
    keyMatch = event.key === ']'
  } else if (key === '/') {
    keyMatch = event.key === '/'
  }

  return ctrlMatch && altMatch && shiftMatch && cmdMatch && keyMatch
}

/**
 * Application-wide keyboard shortcuts
 */
export function useShortcuts(onOpenSettings?: () => void) {
  const noteStore = useNoteStore()
  const settingStore = useSettingStore()
  const { toggleSourceMode } = useSourceMode()

  async function handleKeydown(e: KeyboardEvent) {
    // 搜索框里不触发快捷键
    if (e.target instanceof HTMLInputElement) {
      return
    }

    const shortcuts = settingStore.settings.shortcuts

    // 新建笔记
    if (matchesShortcut(e, shortcuts.newNote)) {
      e.preventDefault()
      noteStore.createNote()
      return
    }

    // 删除当前笔记
    if (matchesShortcut(e, shortcuts.deleteNote)) {
      e.preventDefault()
      if (noteStore.currentNoteId) {
        noteStore.deleteNote(noteStore.currentNoteId)
      }
      return
    }

    // 上一页
    if (matchesShortcut(e, shortcuts.prevNote)) {
      e.preventDefault()
      noteStore.navigatePrevOrCreate()
      return
    }

    // 下一页
    if (matchesShortcut(e, shortcuts.nextNote)) {
      e.preventDefault()
      noteStore.navigateNextOrCreate()
      return
    }

    // 置顶窗口
    if (matchesShortcut(e, shortcuts.pin)) {
      e.preventDefault()
      try {
        const appWindow = getCurrentWindow()
        const newValue = !settingStore.settings.alwaysOnTop
        await appWindow.setAlwaysOnTop(newValue)
        settingStore.updateSettings('alwaysOnTop', newValue)
      } catch (error) {
        console.error('Failed to toggle pin:', error)
      }
      return
    }

    // 锁定/解锁笔记
    if (matchesShortcut(e, shortcuts.lock)) {
      e.preventDefault()
      if (noteStore.currentNoteId) {
        noteStore.toggleLock(noteStore.currentNoteId)
      }
      return
    }

    // 切换源码模式
    if (matchesShortcut(e, shortcuts.toggleSource)) {
      e.preventDefault()
      toggleSourceMode()
      return
    }

    // 显示/隐藏主窗口
    if (matchesShortcut(e, shortcuts.showMain)) {
      e.preventDefault()
      try {
        const appWindow = getCurrentWindow()
        const visible = await appWindow.isVisible()
        if (visible) {
          await appWindow.hide()
        } else {
          await appWindow.show()
          await appWindow.setFocus()
        }
      } catch (error) {
        console.error('Failed to toggle window visibility:', error)
      }
      return
    }

    // Escape: 清空搜索
    if (e.key === 'Escape' && noteStore.searchQuery) {
      e.preventDefault()
      noteStore.searchQuery = ''
    }

    // Cmd+F: 聚焦搜索框
    if (e.metaKey && e.code === 'KeyF') {
      e.preventDefault()
      const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement
      searchInput?.focus()
    }

    // Cmd+W: 隐藏窗口
    if (e.metaKey && e.code === 'KeyW') {
      e.preventDefault()
      try {
        const appWindow = getCurrentWindow()
        await appWindow.hide()
      } catch (error) {
        console.error('Failed to hide window:', error)
      }
      return
    }

    // Cmd+, : 打开设置（使用 e.code 判断物理按键，避开输入法干扰）
    if (e.metaKey && e.code === 'Comma') {
      e.preventDefault()
      onOpenSettings?.()
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
}
