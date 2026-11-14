<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { emit, emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { writeText as writeClipboardNative } from '@tauri-apps/plugin-clipboard-manager'
import { useI18n } from 'vue-i18n'
import { createPreviewMarkdown, toggleTaskLine } from '@/utils/markdownTasks'
import { useTheme } from '@/composables/useTheme'
import { adaptNoteColor } from '@/utils/noteColorTheme'
import {
  DESKTOP_NOTE_BOUNDS,
  DESKTOP_NOTE_CLOSED,
  DESKTOP_NOTE_EDIT,
  DESKTOP_NOTE_EVENT,
  DESKTOP_NOTE_LABEL_PREFIX,
  DESKTOP_NOTE_REQUEST,
  type DesktopNoteBounds,
  type DesktopNotePayload,
} from '@/composables/useDesktopNotes'

/**
 * 桌面笔记卡片（独立窗口，label = note-widget-<noteId>）。
 *
 * 这个窗口跑的是同一份前端产物，但拿不到 Pinia 里的笔记数据：
 * 内容由主窗口通过 DESKTOP_NOTE_EVENT 推过来，自己起来时也会主动要一次。
 * 窗口层级已经在 Rust 侧压到桌面图标那一层，所以这里只负责「长成一张卡片」。
 */

const { t, locale } = useI18n()
const appWindow = getCurrentWindow()
const noteId = appWindow.label.startsWith(DESKTOP_NOTE_LABEL_PREFIX)
  ? appWindow.label.slice(DESKTOP_NOTE_LABEL_PREFIX.length)
  : ''

const payload = ref<DesktopNotePayload | null>(null)
const missing = ref(false)
const hovering = ref(false)

const md = createPreviewMarkdown()
const mdCache = new Map<string, string>()

const html = computed(() => {
  const source = payload.value?.content || ''
  if (!source) return ''
  const cached = mdCache.get(source)
  if (cached !== undefined) return cached
  const rendered = md.render(source)
  if (mdCache.size > 40) mdCache.clear()
  mdCache.set(source, rendered)
  return rendered
})

/** 判断一个十六进制颜色是深还是浅，用来决定卡片上的文字颜色 */
function isLightColor(hex: string): boolean {
  const value = hex.replace('#', '').trim()
  const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value
  if (full.length !== 6) return true
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  // 相对亮度（sRGB 近似）
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62
}

const { currentTheme } = useTheme()

/** 卡片底色跟笔记颜色同步（按明暗主题适配）；没设颜色就用主题默认色 */
const cardStyle = computed<Record<string, string>>(() => {
  const stored = payload.value?.backgroundColor?.trim()
  if (!stored) return {} as Record<string, string>
  const bg = adaptNoteColor(stored, currentTheme.value)
  const light = isLightColor(bg)
  return {
    background: bg,
    '--card-fg': light ? 'rgba(20, 20, 22, 0.92)' : 'rgba(245, 245, 247, 0.94)',
    '--card-fg-weak': light ? 'rgba(20, 20, 22, 0.55)' : 'rgba(245, 245, 247, 0.6)',
  }
})

const copied = ref(false)
let copiedTimer: number | undefined

/**
 * 写剪贴板：卡片窗口经常不是 key window，`navigator.clipboard` 在 WKWebView 里
 * 会直接 NotAllowedError，所以优先走 Rust 侧的 NSPasteboard（不依赖窗口焦点）。
 */
async function writeClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    await writeClipboardNative(text)
    return true
  } catch (error) {
    console.error('原生写剪贴板失败，改用 web API:', error)
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* 最后退回 execCommand */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.top = '-9999px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

function flashCopied() {
  copied.value = true
  window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => {
    copied.value = false
  }, 1200)
}

/** 双击卡片：把整篇笔记的正文复制走 */
async function copyAll(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  // 点在任务复选框上不算「双击复制」
  if (target?.closest('button, input.md-task')) return
  const text = payload.value?.content?.trim()
  if (!text) return
  const ok = await writeClipboard(text)
  if (ok) {
    window.getSelection()?.removeAllRanges()
    flashCopied()
  }
}

/**
 * 点卡片里的任务复选框：本地先翻一下，再把新正文发给主窗口落盘。
 * 卡片窗口拿不到 Pinia 的笔记数据，只能让主窗口去改。
 */
async function onCardClick(event: MouseEvent) {
  const checkbox = (event.target as HTMLElement | null)?.closest<HTMLInputElement>('input.md-task')
  if (!checkbox) return
  event.preventDefault()
  event.stopPropagation()
  if (!noteId || payload.value?.locked) return
  const current = payload.value?.content || ''
  const line = Number(checkbox.dataset.taskLine)
  const next = Number.isFinite(line) ? toggleTaskLine(current, line, checkbox.checked) : current
  if (next === current) {
    checkbox.checked = !checkbox.checked
    return
  }
  if (payload.value) payload.value = { ...payload.value, content: next }
  await emitTo('main', DESKTOP_NOTE_EDIT, { id: noteId, content: next })
}

/** 选中即复制：拖选松开后把选中文字写进剪贴板 */
async function copySelectionOnSelect(event: MouseEvent) {
  if (event.button !== 0) return
  await new Promise(resolve => setTimeout(resolve, 20))
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return
  const text = selection.toString().trim()
  if (!text) return
  const target = event.target as HTMLElement | null
  if (target?.closest('button, input.md-task')) return
  if (await writeClipboard(text)) flashCopied()
}
const timeText = computed(() => {
  const stamp = payload.value?.updatedAt
  if (!stamp) return ''
  const diff = Date.now() - stamp
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('notelist.justNow')
  if (mins < 60) return t('notelist.minutesAgo', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('notelist.hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('notelist.daysAgo', { n: days })
  return new Date(stamp).toLocaleDateString()
})

let unlisteners: UnlistenFn[] = []

/** 把当前窗口位置尺寸报给主窗口，下次启动原位还原 */
async function reportBounds() {
  if (!noteId) return
  try {
    const position = await appWindow.outerPosition()
    const size = await appWindow.innerSize()
    const scale = await appWindow.scaleFactor()
    const bounds: DesktopNoteBounds = {
      x: Math.round(position.x / scale),
      y: Math.round(position.y / scale),
      width: Math.round(size.width / scale),
      height: Math.round(size.height / scale),
    }
    await emitTo('main', DESKTOP_NOTE_BOUNDS, { id: noteId, bounds })
  } catch (error) {
    console.error('上报桌面卡片位置失败:', error)
  }
}

async function openInMain() {
  if (!noteId) return
  await invoke('desktop_note_open_in_main', { noteId })
}

/** 取消钉住：通知主窗口把它从设置里删掉，然后关掉自己 */
async function unpin() {
  if (!noteId) return
  await reportBounds()
  await emitTo('main', DESKTOP_NOTE_CLOSED, noteId)
  await appWindow.close()
}

onMounted(async () => {
  // 主题/语言先按本地设置对齐，主窗口后续推送再覆盖
  try {
    const raw = localStorage.getItem('maiknote-settings')
    if (raw) {
      const parsed = JSON.parse(raw) as { language?: string }
      if (parsed.language) locale.value = parsed.language
    }
  } catch {
    /* 忽略解析失败 */
  }

  unlisteners.push(
    await listen<DesktopNotePayload | null>(DESKTOP_NOTE_EVENT, event => {
      if (event.payload && event.payload.id !== noteId) return
      payload.value = event.payload
      missing.value = !event.payload
    }),
  )

  // 告诉主窗口「我起来了，把这篇笔记发给我」
  if (noteId) {
    await emit(DESKTOP_NOTE_REQUEST, noteId)
  }

  // 前端已经挂载、样式也生效了，这时再露脸（后端建窗时是隐藏的）
  await appWindow.show()

  // show 之后 AppKit 会把窗口层级打回 0，按设置再压一次（Rust 侧还有几秒内的多次兜底）
  try {
    const raw = localStorage.getItem('maiknote-settings')
    const level = raw ? (JSON.parse(raw) as { desktopNoteLevel?: string }).desktopNoteLevel : undefined
    if (level) await invoke('desktop_note_apply_level', { level })
  } catch (error) {
    console.error('应用卡片层级失败:', error)
  }

  // 拖动/缩放结束后记一次位置（move/resize 事件很密，这里只关心稳定态）
  let boundsTimer: number | undefined
  const scheduleReport = () => {
    window.clearTimeout(boundsTimer)
    boundsTimer = window.setTimeout(() => void reportBounds(), 500)
  }
  unlisteners.push(await appWindow.onMoved(scheduleReport))
  unlisteners.push(await appWindow.onResized(scheduleReport))
})

onUnmounted(() => {
  unlisteners.forEach(unlisten => unlisten())
  unlisteners = []
})
</script>

<template>
  <div class="desktop-note" :class="{ 'is-hover': hovering }" @mouseenter="hovering = true" @mouseleave="hovering = false">
    <div class="card" :style="cardStyle" @dblclick="copyAll">
      <div class="card-head" data-tauri-drag-region>
        <span class="grip" data-tauri-drag-region></span>
        <span class="spacer" data-tauri-drag-region></span>
        <div class="card-actions">
          <button class="card-btn" :title="$t('desktopNote.open')" @click.stop="openInMain">
            <i class="i-mdi-arrow-top-right"></i>
          </button>
          <button class="card-btn" :title="$t('desktopNote.unpin')" @click.stop="unpin">
            <i class="i-mdi-close"></i>
          </button>
        </div>
      </div>

      <div v-if="missing" class="card-empty">{{ $t('desktopNote.missing') }}</div>
      <div v-else-if="!payload" class="card-empty">{{ $t('desktopNote.loading') }}</div>
      <div
        v-else
        class="card-body markdown-body"
        v-html="html"
        @click="onCardClick"
        @mouseup="copySelectionOnSelect"
      ></div>

      <div class="card-foot">
        <span class="foot-time">{{ timeText }}</span>
        <span v-if="payload?.locked" class="foot-lock"><i class="i-mdi-lock"></i>{{ $t('desktopNote.locked') }}</span>
      </div>

      <transition name="copied-fade">
        <div v-if="copied" class="copied-toast">{{ $t('desktopNote.copied') }}</div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
/* 整窗透明：只让卡片本身有底色，圆角外是桌面 */
.desktop-note {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 6px;
  display: flex;
  background: transparent;
}

.card {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.92);
  overflow: hidden;
  transition: box-shadow 0.16s ease, border-color 0.16s ease;
}

:global(html[data-theme='dark']) .card {
  background: rgba(38, 38, 40, 0.92);
}

.desktop-note.is-hover .card {
  border-color: var(--color-primary);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 18px;
  padding: 6px 8px 2px 10px;
  cursor: grab;
  user-select: none;
}

/* 没有标题了，顶部只留一条可以拖窗口的小握把 */
.grip {
  width: 22px;
  height: 3px;
  border-radius: 2px;
  background: var(--card-fg-weak, var(--color-border));
  opacity: 0.5;
  flex: none;
}

.desktop-note.is-hover .grip {
  opacity: 0.9;
}

.card-head:active {
  cursor: grabbing;
}

.spacer {
  flex: 1;
  min-width: 0;
}

.card-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.14s ease;
}

.desktop-note.is-hover .card-actions {
  opacity: 1;
}

.card-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--card-fg-weak, var(--color-text-secondary));
  font-size: 13px;
  cursor: pointer;
}

.card-btn:hover {
  background: var(--color-popup-hover);
  color: var(--card-fg, var(--color-text));
}

.card-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 2px 14px 8px;
  font-size: 12.5px;
  line-height: 1.62;
  color: var(--card-fg, var(--color-text));
  cursor: default;
  user-select: text;
}

.card-body :deep(h1),
.card-body :deep(h2),
.card-body :deep(h3) {
  margin: 8px 0 4px;
  font-size: 13px;
  font-weight: 600;
}

.card-body :deep(h1) {
  font-size: 14.5px;
}

.card-body :deep(p) {
  margin: 4px 0;
}

.card-body :deep(ul),
.card-body :deep(ol) {
  margin: 4px 0;
  padding-left: 18px;
}

.card-body :deep(code) {
  font-family: var(--font-mono);
  font-size: 11.5px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--color-code-bg);
}

.card-body :deep(pre) {
  margin: 6px 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-code-bg);
  border: 1px solid var(--color-code-border);
  overflow: auto;
}

.card-body :deep(pre code) {
  padding: 0;
  background: transparent;
}

.card-body :deep(blockquote) {
  margin: 6px 0;
  padding-left: 9px;
  border-left: 2px solid var(--card-fg-weak, var(--color-border));
  color: var(--card-fg-weak, var(--color-text-secondary));
}

.card-body :deep(a) {
  color: var(--color-primary);
  text-decoration: none;
}

.card-body :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}

.card-body :deep(input[type='checkbox']) {
  margin-right: 5px;
}

/* ---------- 任务列表：真复选框，点一下就能勾 ---------- */

.card-body :deep(ul.md-task-list),
.card-body :deep(ol.md-task-list) {
  padding-left: 2px;
  list-style: none;
}

.card-body :deep(li.md-task-item) {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 3px 0;
  list-style: none;
}

.card-body :deep(input.md-task) {
  flex: none;
  width: 13px;
  height: 13px;
  margin: 3.2px 0 0;
  appearance: none;
  -webkit-appearance: none;
  border: 1.4px solid var(--card-fg-weak, var(--color-border));
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  position: relative;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.card-body :deep(input.md-task:hover) {
  border-color: var(--color-primary);
}

.card-body :deep(input.md-task:checked) {
  border-color: var(--color-primary);
  background: var(--color-primary);
}

.card-body :deep(input.md-task:checked)::after {
  content: '';
  position: absolute;
  left: 3.4px;
  top: 0.6px;
  width: 3.4px;
  height: 6.6px;
  border: solid #fff;
  border-width: 0 1.6px 1.6px 0;
  transform: rotate(42deg);
}

.card-body :deep(li.md-task-item[data-checked='true']) {
  color: var(--card-fg-weak, var(--color-text-secondary));
  text-decoration: line-through;
  text-decoration-color: currentColor;
  opacity: 0.72;
}

.card-body :deep(table) {
  border-collapse: collapse;
  font-size: 11.5px;
}

.card-body :deep(th),
.card-body :deep(td) {
  border: 1px solid var(--color-border);
  padding: 2px 6px;
}

.card-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 8px;
  font-size: 11px;
  color: var(--card-fg-weak, var(--color-text-secondary));
}

.foot-lock {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.copied-toast {
  position: absolute;
  right: 12px;
  bottom: 30px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 11px;
  pointer-events: none;
}

.copied-fade-enter-active,
.copied-fade-leave-active {
  transition: opacity 0.16s ease;
}

.copied-fade-enter-from,
.copied-fade-leave-to {
  opacity: 0;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 3px;
}

.desktop-note.is-hover ::-webkit-scrollbar-thumb {
  background: var(--color-border);
}
</style>
