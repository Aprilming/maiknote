import { computed, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useNoteStore } from '@/stores/noteStore'
import { useSettingStore } from '@/stores/settingStore'
import { suppressMainAutoHide } from '@/composables/useEdgePanel'
import type { Note } from '@/types/note'

/** 桌面卡片窗口的位置尺寸（逻辑像素，Quartz 全局坐标） */
export interface DesktopNoteBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 主窗口推给桌面卡片的数据 */
export interface DesktopNotePayload {
  id: string
  title: string
  content: string
  color: string | null
  backgroundColor: string | null
  updatedAt: number
  locked: boolean
}

/** 主窗口 → 桌面卡片：笔记内容（null = 笔记已被删除） */
export const DESKTOP_NOTE_EVENT = 'maiknote:desktop-note'
/** 桌面卡片 → 主窗口：我起来了，给我数据（payload = 笔记 id） */
export const DESKTOP_NOTE_REQUEST = 'maiknote:desktop-note-request'
/** 桌面卡片 → 主窗口：我关掉了（payload = 笔记 id） */
export const DESKTOP_NOTE_CLOSED = 'maiknote:desktop-note-closed'
/** 桌面卡片 → 主窗口：我移动/缩放了（payload = { id, bounds }） */
export const DESKTOP_NOTE_BOUNDS = 'maiknote:desktop-note-bounds'
/** 桌面卡片 → 主窗口：卡片里勾了任务，正文要改（payload = { id, content }） */
export const DESKTOP_NOTE_EDIT = 'maiknote:desktop-note-edit'

/** 窗口 label 前缀，必须与 Rust 侧 desktop_note::LABEL_PREFIX 一致 */
export const DESKTOP_NOTE_LABEL_PREFIX = 'note-widget-'

const CARD_WIDTH = 300
const CARD_HEIGHT = 240
const EDGE_GAP = 32
const CASCADE = 26

/** 卡片里只用得到这几个字段，顺手把标题兜底好 */
export function desktopPayloadOf(note: Note): DesktopNotePayload {
  return {
    id: note.id,
    title: note.title?.trim() || '',
    content: note.content || '',
    color: note.color ?? null,
    backgroundColor: note.backgroundColor ?? null,
    updatedAt: note.updatedAt,
    locked: Boolean(note.isLocked),
  }
}

/**
 * 桌面笔记卡片（主窗口侧）：负责开关窗口、把内容推给卡片、记住卡片位置。
 *
 * 桌面卡片是个独立窗口，跑的是同一份前端产物，靠 label 前缀区分（见 main.ts）。
 * 两边沟通全部走事件，卡片那边拿不到 Pinia 的笔记数据。
 */
function createDesktopNotes() {
  const noteStore = useNoteStore()
  const settingStore = useSettingStore()

  /** 用户钉在桌面上的笔记（持久化在设置里，重启后按它还原） */
  const pinnedIds = computed<string[]>(() => settingStore.settings.desktopNotes ?? [])
  /** 当前真实打开的卡片窗口 */
  const openIds = ref<string[]>([])

  let started = false
  let unlisteners: UnlistenFn[] = []
  let pushTimer: number | undefined
  let stopWatch: (() => void) | undefined

  /** 笔记内容指纹：任何一篇变了就把卡片刷新一遍（比 deep watch 便宜） */
  const signature = computed(() =>
    noteStore.notes
      .map(
        note =>
          `${note.id}:${note.updatedAt}:${note.title}:${note.content.length}:${note.color ?? ''}:${note.backgroundColor ?? ''}:${note.isLocked ? 1 : 0}`,
      )
      .join('|'),
  )

  function isOnDesktop(noteId: string | null | undefined): boolean {
    if (!noteId) return false
    return pinnedIds.value.includes(noteId)
  }

  /** 新卡片的落点：从右上角往左下排，避免叠在一起 */
  function nextBounds(): DesktopNoteBounds {
    const index = pinnedIds.value.length
    const availWidth = window.screen?.availWidth || 1440
    return {
      x: Math.max(EDGE_GAP, availWidth - CARD_WIDTH - EDGE_GAP - (index % 6) * CASCADE),
      y: EDGE_GAP + 40 + (index % 6) * CASCADE,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    }
  }

  function boundsOf(noteId: string): DesktopNoteBounds {
    const saved = settingStore.settings.desktopNoteBounds?.[noteId]
    return saved ?? nextBounds()
  }

  async function refreshOpenIds() {
    try {
      openIds.value = await invoke<string[]>('desktop_note_list')
    } catch (error) {
      console.error('读取桌面笔记窗口失败:', error)
    }
  }

  /** 把某篇笔记的最新内容推给它的卡片窗口 */
  async function pushNote(noteId: string) {
    const note = noteStore.notes.find(item => item.id === noteId)
    try {
      await emitTo(`${DESKTOP_NOTE_LABEL_PREFIX}${noteId}`, DESKTOP_NOTE_EVENT, note ? desktopPayloadOf(note) : null)
    } catch (error) {
      console.error('推送桌面笔记内容失败:', error)
    }
  }

  async function pushAll() {
    // 笔记还没读出来（刚启动/iCloud 未就绪）时不能judge「笔记没了」，否则一上来就把卡片全收掉
    if (noteStore.notes.length === 0) return
    const alive = new Set(noteStore.notes.map(note => note.id))
    // 笔记被删了/被清空回收站了，桌面上那张卡片就跟着收掉
    for (const id of pinnedIds.value.filter(id => !alive.has(id))) {
      await close(id)
    }
    await Promise.all(pinnedIds.value.map(id => pushNote(id)))
  }

  /** 内容变了就防抖推给所有卡片，卡片窗口实时跟着编辑器走 */
  function schedulePush() {
    window.clearTimeout(pushTimer)
    pushTimer = window.setTimeout(() => void pushAll(), 400)
  }

  async function open(noteId: string) {
    if (!noteId) return
    // 新建窗口会让主窗口失焦，先压住「失焦自动隐藏」
    suppressMainAutoHide(1500)
    try {
      await invoke('desktop_note_open', {
        noteId,
        bounds: boundsOf(noteId),
        level: settingStore.settings.desktopNoteLevel,
      })
    } catch (error) {
      console.error('打开桌面笔记失败:', error)
      return
    }
    const ids = pinnedIds.value
    if (!ids.includes(noteId)) {
      settingStore.updateSettings('desktopNotes', [...ids, noteId])
    }
    await refreshOpenIds()
    // 新窗口的 webview 还没挂载完，稍等一下再推数据（卡片起来后也会自己再要一次）
    window.setTimeout(() => void pushNote(noteId), 300)
  }

  async function close(noteId: string) {
    try {
      await invoke('desktop_note_close', { noteId })
    } catch (error) {
      console.error('关闭桌面笔记失败:', error)
    }
    forget(noteId)
    await refreshOpenIds()
  }

  /** 从设置里抹掉（窗口被卡片自己关掉时也走这里） */
  function forget(noteId: string) {
    const ids = pinnedIds.value
    if (ids.includes(noteId)) {
      settingStore.updateSettings('desktopNotes', ids.filter(id => id !== noteId))
    }
    const bounds = { ...(settingStore.settings.desktopNoteBounds ?? {}) }
    if (bounds[noteId]) {
      delete bounds[noteId]
      settingStore.updateSettings('desktopNoteBounds', bounds)
    }
    openIds.value = openIds.value.filter(id => id !== noteId)
  }

  async function toggle(noteId: string) {
    if (isOnDesktop(noteId)) {
      await close(noteId)
    } else {
      await open(noteId)
    }
  }

  /** 卡片层级三选一：立刻作用到所有已经打开的卡片 */
  async function applyLevel() {
    try {
      await invoke<number>('desktop_note_apply_level', {
        level: settingStore.settings.desktopNoteLevel,
      })
    } catch (error) {
      console.error('切换桌面卡片层级失败:', error)
    }
  }

  function rememberBounds(noteId: string, bounds: DesktopNoteBounds) {
    const all = { ...(settingStore.settings.desktopNoteBounds ?? {}) }
    all[noteId] = bounds
    settingStore.updateSettings('desktopNoteBounds', all)
  }

  /** 应用启动时按设置还原所有桌面卡片 */
  async function restore() {
    const ids = [...pinnedIds.value]
    if (ids.length === 0) return
    for (const id of ids) {
      // 笔记已经不在了就别开空窗口
      if (!noteStore.notes.some(note => note.id === id)) continue
      try {
        await invoke('desktop_note_open', {
          noteId: id,
          bounds: boundsOf(id),
          level: settingStore.settings.desktopNoteLevel,
        })
      } catch (error) {
        console.error('还原桌面笔记失败:', error)
      }
    }
    await refreshOpenIds()
    window.setTimeout(() => void pushAll(), 800)
  }

  /** 主窗口侧的事件接线（只能调一次） */
  async function start() {
    if (started) return
    started = true

    unlisteners.push(
      // 卡片起来了，要数据
      await listen<string>(DESKTOP_NOTE_REQUEST, event => {
        void pushNote(event.payload)
      }),
      // 卡片被关掉（用户点卡片上的「取消钉住」或窗口本身消失）
      await listen<string>(DESKTOP_NOTE_CLOSED, event => {
        forget(event.payload)
      }),
      // 卡片被拖动/缩放过
      await listen<{ id: string; bounds: DesktopNoteBounds }>(DESKTOP_NOTE_BOUNDS, event => {
        rememberBounds(event.payload.id, event.payload.bounds)
      }),
      // 卡片里勾了任务：把正文写回笔记（卡片窗口没有笔记数据，只能由这边落盘）
      await listen<{ id: string; content: string }>(DESKTOP_NOTE_EDIT, event => {
        const payload = event.payload
        if (!payload?.id || typeof payload.content !== 'string') return
        const note = noteStore.notes.find(item => item.id === payload.id)
        if (!note || note.isLocked) return
        if (note.content === payload.content) return
        noteStore.updateNote(payload.id, { content: payload.content })
      }),
      // Rust 侧「打开这篇」（desktop_note_open_in_main）
      await listen<string>('maiknote:open-note', event => {
        if (event.payload) void noteStore.selectNote(event.payload)
      }),
    )

    stopWatch = watch(signature, () => schedulePush())

    await restore()
  }

  function stop() {
    unlisteners.forEach(unlisten => unlisten())
    unlisteners = []
    started = false
    window.clearTimeout(pushTimer)
    stopWatch?.()
    stopWatch = undefined
  }

  return {
    pinnedIds,
    openIds,
    isOnDesktop,
    open,
    close,
    toggle,
    pushNote,
    pushAll,
    schedulePush,
    rememberBounds,
    applyLevel,
    restore,
    start,
    stop,
  }
}

/**
 * 主窗口是唯一实例：TitleBar / NoteList / App 都可能调，共用一份状态和监听，
 * 否则每处调用都会多挂一套事件监听。
 */
let shared: ReturnType<typeof createDesktopNotes> | null = null

export function useDesktopNotes() {
  if (!shared) shared = createDesktopNotes()
  return shared
}
