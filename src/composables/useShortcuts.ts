import { onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useNoteStore } from '@/stores/noteStore'
import { useDirectoryStore } from '@/stores/directoryStore'
import { useSettingStore } from '@/stores/settingStore'
import { useSourceMode } from '@/composables/useSourceMode'
import { usePinWindow } from '@/composables/usePinWindow'

/**
 * 焦点是否落在文本输入框里。
 * 笔记正文编辑器是 contenteditable，故意不算：应用焦点几乎总在编辑器上，
 * 把它当输入框会让新建/翻页/删除/锁定等所有应用内快捷键全部失灵。
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

/**
 * 检测按键是否匹配快捷键配置
 */
function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  // 快捷键允许为空（表示未设置/禁用），空值不匹配任何按键
  if (!shortcut) return false

  const parts = shortcut.split('+')
  const key = parts[parts.length - 1].toLowerCase()
  const modifiers = parts.slice(0, -1)

  // 检查修饰键
  const ctrlMatch = modifiers.some(m => m.toLowerCase() === 'ctrl') ? event.ctrlKey : !event.ctrlKey
  const altMatch = modifiers.some(m => /^alt|option$/.test(m.toLowerCase())) ? event.altKey : !event.altKey
  const shiftMatch = modifiers.some(m => m.toLowerCase() === 'shift') ? event.shiftKey : !event.shiftKey
  const cmdMatch = modifiers.some(m => m.toLowerCase() === 'cmd') ? event.metaKey : !event.metaKey

  // 检查按键
  let keyMatch = false
  if (/^[a-z]$/.test(key)) {
    // 字母键：使用 event.code（物理按键位置，不受 IME/修饰键影响）
    keyMatch = event.code === `Key${key.toUpperCase()}`
  } else if (/^\d$/.test(key)) {
    // 数字键
    keyMatch = event.key === key
  } else if (key === 'backspace') {
    keyMatch = event.key === 'Backspace'
  } else if (key === '[') {
    keyMatch = event.code === 'BracketLeft'
  } else if (key === ']') {
    keyMatch = event.code === 'BracketRight'
  } else if (key === '/') {
    keyMatch = event.code === 'Slash'
  } else if (key === '\\') {
    keyMatch = event.code === 'Backslash'
  } else if (key === 'space') {
    keyMatch = event.key === ' '
  } else if (key === 'enter') {
    keyMatch = event.key === 'Enter'
  } else if (key === 'tab') {
    keyMatch = event.key === 'Tab'
  } else if (key === 'esc') {
    keyMatch = event.key === 'Escape'
  }

  return ctrlMatch && altMatch && shiftMatch && cmdMatch && keyMatch
}

/**
 * Application-wide keyboard shortcuts
 */
export function useShortcuts(onOpenSettings?: () => void, onOpenSearch?: () => void) {
  const noteStore = useNoteStore()
  const directoryStore = useDirectoryStore()
  const settingStore = useSettingStore()
  const { toggleSourceMode } = useSourceMode()

  async function handleKeydown(e: KeyboardEvent) {
    // 文本输入框里不触发快捷键，避免打字误触；编辑器（contenteditable）里照常触发
    if (isEditableTarget(e.target)) {
      return
    }

    const shortcuts = settingStore.settings.shortcuts

    // 新建笔记
    if (matchesShortcut(e, shortcuts.newNote)) {
      e.preventDefault()
      noteStore.createNote()
      return
    }

    // 在当前页面之前新建笔记
    if (matchesShortcut(e, shortcuts.newNoteBefore)) {
      e.preventDefault()
      noteStore.createNoteBeforeCurrent()
      return
    }

    // 删除当前笔记（派发事件让 Editor 组件处理动画）
    if (matchesShortcut(e, shortcuts.deleteNote)) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('marknote:delete-note'))
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

    // 上一个目录
    if (matchesShortcut(e, shortcuts.prevDirectory)) {
      e.preventDefault()
      noteStore.setFilterDirectory(directoryStore.getAdjacentDirectoryId('prev'))
      return
    }

    // 下一个目录
    if (matchesShortcut(e, shortcuts.nextDirectory)) {
      e.preventDefault()
      noteStore.setFilterDirectory(directoryStore.getAdjacentDirectoryId('next'))
      return
    }

    // 置顶窗口：全局范围交给 Rust 侧处理，避免同一次按键触发两次；应用内范围走这里
    if (settingStore.settings.pinShortcutScope !== 'global' && matchesShortcut(e, shortcuts.pin)) {
      e.preventDefault()
      try {
        // 取消置顶后是否隐藏页面，由「取消置顶时」设置决定
        await usePinWindow().togglePin()
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

    // 展开/收起左侧文件树（具体显隐状态由 App 维护，这里只派发事件）
    if (matchesShortcut(e, shortcuts.toggleSidebar)) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('marknote:toggle-sidebar'))
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

    // 居中窗口
    if (shortcuts.centerWindow && matchesShortcut(e, shortcuts.centerWindow)) {
      e.preventDefault()
      try {
        const appWindow = getCurrentWindow()
        await appWindow.center()
      } catch (error) {
        console.error('Failed to center window:', error)
      }
      return
    }

    // Escape: 清空搜索
    if (e.key === 'Escape' && noteStore.searchQuery) {
      e.preventDefault()
      noteStore.searchQuery = ''
    }

    // Cmd+F: 打开搜索页；没有搜索页入口（嵌入场景）时退回聚焦侧栏搜索框
    if (e.metaKey && e.code === 'KeyF') {
      e.preventDefault()
      if (onOpenSearch) {
        onOpenSearch()
      } else {
        const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement
        searchInput?.focus()
      }
    }

    // Cmd+W: 按设置里的关闭行为走（退出程序 / 隐藏窗口）
    if (e.metaKey && e.code === 'KeyW') {
      e.preventDefault()
      try {
        if (settingStore.settings.closeBehavior === 'quit') {
          // 退出前先把防抖队列里的内容落盘，否则最后一个保存窗口里的编辑会丢
          await noteStore.flushPendingSave()
          await invoke('exit_app')
        } else {
          const appWindow = getCurrentWindow()
          await appWindow.hide()
        }
      } catch (error) {
        console.error('Failed to close window:', error)
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
