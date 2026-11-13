import { onUnmounted, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useNoteStore } from '@/stores/noteStore'
import { useDirectoryStore } from '@/stores/directoryStore'
import { useSettingStore } from '@/stores/settingStore'
import { useI18n } from 'vue-i18n'
import type { Note } from '@/types/note'

/** 边缘面板卡片数据（主窗口 → 边缘窗口） */
export interface EdgeNotePayload {
  id: string
  title: string
  preview: string
  /** 完整正文（卡片里整段展示，可选中复制） */
  content: string
  color: string | null
  updatedAt: number
  dirPath: string
}

/**
 * 边缘面板被点击时会成为 key window，主窗口随即失焦自动隐藏。
 * 从卡片唤起笔记的这段时间内抑制自动隐藏，避免「刚 show 又被 hide」。
 */
let suppressAutoHideUntil = 0

export function suppressMainAutoHide(ms = 900) {
  suppressAutoHideUntil = Date.now() + ms
}

export function isMainAutoHideSuppressed(): boolean {
  return Date.now() < suppressAutoHideUntil
}

const NOTES_EVENT = 'maiknote:pinned-notes'
const READY_EVENT = 'maiknote:edge-ready'
const OPEN_EVENT = 'maiknote:open-note'
const UNPIN_EVENT = 'maiknote:unpin-note'
const EDIT_EVENT = 'maiknote:edit-note'
const PREFS_EVENT = 'maiknote:edge-prefs'

/** 边缘面板外观偏好（设置页 → 主窗口 → Rust + 边缘窗口） */
export interface EdgePrefsPayload {
  enabled: boolean
  side: 'right' | 'left' | 'top' | 'bottom'
  panelWidth: number
  triggerSpan: number
  stripWidth: number
  stripColor: string
  copyOnSelect: boolean
}

interface EdgeEditPayload {
  id: string
  /** replace = 整段正文替换（任务勾选框回写走这条） */
  op: 'cut' | 'paste' | 'replace'
  selection?: string
  text?: string
}

/** 边缘面板的剪切 / 粘贴 / 勾选任务落到笔记正文上 */
function applyEdgeEdit(payload: EdgeEditPayload) {
  const noteStore = useNoteStore()
  const note = noteStore.notes.find(n => n.id === payload.id)
  if (!note) return
  const content = note.content || ''

  // 勾选任务：面板已经算好新正文，直接整段替换
  if (payload.op === 'replace') {
    const next = payload.text
    if (typeof next !== 'string' || next === content) return
    if (note.isLocked) return
    noteStore.updateNote(note.id, { content: next })
    return
  }

  const selection = payload.selection || ''

  if (payload.op === 'cut') {
    if (!selection) return
    const index = content.indexOf(selection)
    if (index < 0) return
    noteStore.updateNote(note.id, {
      content: content.slice(0, index) + content.slice(index + selection.length),
    })
    return
  }

  const text = payload.text || ''
  if (!text) return
  let next: string
  if (selection && content.includes(selection)) {
    next = content.replace(selection, () => text)
  } else {
    const trimmed = content.replace(/\s+$/, '')
    next = trimmed ? `${trimmed}\n\n${text}` : text
  }
  noteStore.updateNote(note.id, { content: next })
}

/** 从 markdown 正文里抽一行纯文本预览 */
export function buildPreview(content: string): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[\s>#\-*+]+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return plain.slice(0, 90)
}

/** 主窗口侧：把收藏笔记同步给边缘面板，并处理卡片点击 */
export function useEdgePanel() {
  const noteStore = useNoteStore()
  const settingStore = useSettingStore()
  const directoryStore = useDirectoryStore()
  const appWindow = getCurrentWindow()
  const { t } = useI18n()

  const unlisteners: UnlistenFn[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let edgeVisible = false

  function dirPathOf(note: Note): string {
    const names: string[] = []
    let current = note.directoryId ? directoryStore.directories.find(d => d.id === note.directoryId) : undefined
    let guard = 0
    while (current && guard < 20) {
      names.unshift(current.name)
      current = current.parentId
        ? directoryStore.directories.find(d => d.id === current!.parentId)
        : undefined
      guard += 1
    }
    return names.join(' / ')
  }

  function buildPayload(): EdgeNotePayload[] {
    return noteStore.allPinnedNotes.map(note => ({
      id: note.id,
      title: note.title?.trim() || t('notelist.untitled'),
      preview: buildPreview(note.content || ''),
      content: note.content || '',
      color: note.color ?? null,
      updatedAt: note.updatedAt,
      dirPath: dirPathOf(note),
    }))
  }

  async function syncEdge() {
    const payload = buildPayload()
    // 侧边栏总开关关掉：贴边条直接隐藏，快捷键钉住也不再生效
    if (!settingStore.settings.edgeEnabled) {
      if (edgeVisible) {
        edgeVisible = false
        edgePinned = false
        await invoke('hide_edge_window').catch(() => {})
      }
      await emit(NOTES_EVENT, []).catch(() => {})
      return
    }
    // 没有收藏笔记时直接把边缘条收起来（快捷键钉住时保持显示）
    if (payload.length === 0 && !edgePinned) {
      if (edgeVisible) {
        edgeVisible = false
        await invoke('hide_edge_window').catch(() => {})
      }
      await emit(NOTES_EVENT, payload).catch(() => {})
      return
    }
    if (!edgeVisible) {
      edgeVisible = true
      await invoke('init_edge_window').catch(() => {})
    }
    await emit(NOTES_EVENT, payload).catch(() => {})
    armEdgeWatchdog()
  }

  function scheduleSync(delay = 300) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void syncEdge()
    }, delay)
  }

  // 快捷键钉住状态：钉住时即使没有收藏笔记也不收起边缘条
  let edgePinned = false

  // 贴边窗口的「活着」回执：收到就刷新时间戳
  let lastEdgeAckAt = 0
  let lastEdgeReloadAt = 0

  /**
   * 贴边窗口看门狗：推完消息 1.5s 收不到回执，说明那个 webview 的前端已经挂了
   * （开发时 HMR 更新到一半失败就会出现：窗口还在、但内容空白、事件全无响应，
   * 后续 HMR 也进不去）。这种状态只有重载 webview 能救，所以这里主动 reload 一次。
   * 重载后前端会重新挂载并发 ready，主窗口随即再同步一次，不会形成重载风暴。
   */
  function armEdgeWatchdog() {
    const sentAt = Date.now()
    window.setTimeout(() => {
      if (lastEdgeAckAt >= sentAt) return
      const now = Date.now()
      if (now - lastEdgeReloadAt < 5000) return
      lastEdgeReloadAt = now
      void invoke('reload_edge_window').catch(() => {})
    }, 1500)
  }

  async function openFromEdge(id: string) {
    const note = noteStore.notes.find(n => n.id === id)
    if (!note) return
    suppressMainAutoHide(1200)
    const dirId = note.directoryId ?? null
    if (noteStore.filterDirectoryId !== dirId) {
      noteStore.filterDirectoryId = dirId
      directoryStore.selectDirectory(dirId)
    }
    noteStore.selectNote(id)
    await appWindow.show().catch(() => {})
    await appWindow.setFocus().catch(() => {})
  }

  /** 把贴边方向 / 展开宽度 / 触发厚度同步给 Rust 与边缘窗口 */
  async function pushPrefs() {
    const prefs: EdgePrefsPayload = {
      enabled: settingStore.settings.edgeEnabled,
      side: settingStore.settings.edgePosition,
      panelWidth: settingStore.settings.edgeWidth,
      triggerSpan: settingStore.settings.edgeTriggerSpan,
      stripWidth: settingStore.settings.edgeStripWidth,
      stripColor: settingStore.settings.edgeStripColor,
      copyOnSelect: settingStore.settings.edgeCopyOnSelect,
    }
    await invoke('set_edge_prefs', { ...prefs }).catch(() => {})
    await emit(PREFS_EVENT, prefs).catch(() => {})
  }

  void pushPrefs()
  // 总开关一改就立刻显隐贴边条（外观类改动走 pushPrefs 就够了）
  watch(() => settingStore.settings.edgeEnabled, () => scheduleSync(0))
  watch(
    () => [
      settingStore.settings.edgeEnabled,
      settingStore.settings.edgePosition,
      settingStore.settings.edgeWidth,
      settingStore.settings.edgeTriggerSpan,
      settingStore.settings.edgeStripWidth,
      settingStore.settings.edgeStripColor,
      settingStore.settings.edgeCopyOnSelect,
    ].join('|'),
    () => {
      void pushPrefs()
    },
  )

  void (async () => {
    unlisteners.push(
      await listen(READY_EVENT, () => scheduleSync(0)),
      // 贴边窗口收到笔记后的回执（看门狗用）
      await listen('maiknote:edge-ack', () => {
        lastEdgeAckAt = Date.now()
      }),
      await listen<{ id: string }>(OPEN_EVENT, e => {
        void openFromEdge(e.payload.id)
      }),
      await listen<boolean>('maiknote:edge-pinned', e => {
        edgePinned = e.payload === true
        scheduleSync(0)
      }),
      // 边缘面板右键菜单「取消收藏」
      await listen<{ id: string }>(UNPIN_EVENT, e => {
        void noteStore.togglePin(e.payload.id)
      }),
      // 边缘面板右键菜单「剪切 / 粘贴」
      await listen<EdgeEditPayload>(EDIT_EVENT, e => {
        applyEdgeEdit(e.payload)
      }),
    )
    // 首次同步（等 noteStore 加载完由 watch 触发一次）
    scheduleSync(0)
  })()

  // 收藏集合 / 标题 / 正文 / 目录 变化时增量同步
  watch(
    () => noteStore.allPinnedNotes
      .map(n => `${n.id}|${n.title}|${n.updatedAt}|${n.content?.length ?? 0}|${n.directoryId ?? ''}|${n.color ?? ''}`)
      .join(','),
    () => scheduleSync(),
  )

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
    unlisteners.forEach(fn => fn())
    unlisteners.length = 0
  })
}
