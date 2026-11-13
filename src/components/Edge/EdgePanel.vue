<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useI18n } from 'vue-i18n'
import { useSettingStore } from '@/stores/settingStore'
import type { EdgeNotePayload } from '@/composables/useEdgePanel'
import { createPreviewMarkdown, toggleTaskLine } from '@/utils/markdownTasks'

const { t, locale } = useI18n()
const settingStore = useSettingStore()

// 同步语言设置（边缘窗口独立上下文）
locale.value = settingStore.settings.language || locale.value

type EdgeSide = 'right' | 'left' | 'top' | 'bottom'

/** 折叠条比小白条两边各留的余量（px），与后端 EDGE_STRIP_PADDING 保持一致 */
const STRIP_PADDING = 3
/** 小白条粗细默认值（px），实际值来自设置（edgeStripWidth） */
const DEFAULT_STRIP_W = 5
/** 小白条颜色默认值，实际值来自设置（edgeStripColor） */
const DEFAULT_STRIP_COLOR = '#ffffff'
/** 展开态厚度默认值，实际值来自设置（edgeWidth） */
const DEFAULT_PANEL = 320
/** 触发段占比默认值（%，与后端 EDGE_TRIGGER_SPAN_DEFAULT 一致） */
const DEFAULT_SPAN = 33

const side = ref<EdgeSide>('right')
/** 选中文字后自动复制（设置里可关，默认开） */
const copyOnSelect = ref(true)
/** 小白条粗细（px，设置里可调） */
const stripW = ref(DEFAULT_STRIP_W)
/** 小白条颜色（设置里可调） */
const stripColor = ref(DEFAULT_STRIP_COLOR)
/** 折叠态窗口厚度：小白条 + 两边余量，让白条完整露在窗口里 */
const stripWidth = ref(DEFAULT_STRIP_W + STRIP_PADDING)
const panelWidth = ref(DEFAULT_PANEL)
/** 触发高度（%）：贴边小白条的长度，也就是真正能触发面板的段落 */
const triggerSpan = ref(DEFAULT_SPAN)

/** 小白条粗细变了，折叠态窗口厚度跟着变 */
function syncStripThickness() {
  stripWidth.value = stripW.value + STRIP_PADDING
}

/** 从本地设置里读一次外观偏好（边缘窗口独立上下文，等主窗推送前先有个正确初值） */
function readPrefsFromStorage() {
  try {
    const raw = localStorage.getItem('maiknote-settings')
    if (!raw) return
    const parsed = JSON.parse(raw) as {
      edgePosition?: EdgeSide
      edgeWidth?: number
      edgeTriggerSpan?: number
      edgeStripWidth?: number
      edgeStripColor?: string
      edgeCopyOnSelect?: boolean
    }
    if (parsed.edgePosition) side.value = parsed.edgePosition
    if (typeof parsed.edgeWidth === 'number') panelWidth.value = parsed.edgeWidth
    if (typeof parsed.edgeTriggerSpan === 'number') triggerSpan.value = parsed.edgeTriggerSpan
    if (typeof parsed.edgeStripWidth === 'number') stripW.value = parsed.edgeStripWidth
    if (typeof parsed.edgeStripColor === 'string' && parsed.edgeStripColor) stripColor.value = parsed.edgeStripColor
    if (typeof parsed.edgeCopyOnSelect === 'boolean') copyOnSelect.value = parsed.edgeCopyOnSelect
    syncStripThickness()
  } catch {
    /* 设置读不出来就用默认值 */
  }
}

readPrefsFromStorage()

const notes = ref<EdgeNotePayload[]>([])

const expanded = ref(false)
const flash = ref<{ id: string; label: string } | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | null = null

let currentWidth = stripWidth.value
let animFrame = 0
let collapseTimer: ReturnType<typeof setTimeout> | null = null
const unlisteners: UnlistenFn[] = []

async function applyWidth(width: number) {
  try {
    await invoke('set_edge_width', { width })
  } catch {
    /* 窗口已销毁时忽略 */
  }
}

function animateTo(target: number) {
  // 直接一步到位：之前用 rAF 逐帧改窗口宽度，遇到 webview 后台节流时动画会卡在中间宽度，
  // 再叠加下一次 hover 信号就表现为「反复伸缩」。这里改成一次性设置，稳定优先。
  cancelAnimationFrame(animFrame)
  if (currentWidth === target) return
  currentWidth = target
  void applyWidth(target)
}

function expand() {
  if (notes.value.length === 0) return
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }
  if (expanded.value) return
  expanded.value = true
  animateTo(panelWidth.value)
}

function collapse(delay = 240) {
  if (collapseTimer) clearTimeout(collapseTimer)
  collapseTimer = setTimeout(() => {
    collapseTimer = null
    if (!expanded.value) return
    expanded.value = false
    animateTo(stripWidth.value)
  }, delay)
}

/// 面板上的隐藏按钮：解除钉住并收回到右侧细条
async function hidePanel() {
  suppressExpandUntil = Date.now() + 800
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }
  expanded.value = false
  currentWidth = stripWidth.value
  closeMenu()
  await invoke('collapse_edge_panel').catch(() => {})
}

function openNote(note: EdgeNotePayload) {
  void emit('maiknote:open-note', { id: note.id })
  collapse(0)
}

/** 写入剪贴板：优先 Clipboard API，失败退回 execCommand */
async function writeClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* 退回 execCommand */
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

/** 卡片上短暂显示一句反馈（已复制 / 已剪切 / 已粘贴） */
function flashNote(id: string, label: string) {
  flash.value = { id, label }
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flashTimer = null
    flash.value = null
  }, 1400)
}

/** 编辑态粘贴：只插入纯文本，并阻止编辑器全局的 markdown 粘贴转换（否则会插入 `1\\.` 这类转义） */
function onContentPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (!text) return
  document.execCommand('insertText', false, text)
  contentDirty = true
}

function markCopied(id: string) {
  flashNote(id, t('edge.copied'))
}

/** 复制整条笔记正文 */
const md = createPreviewMarkdown()
const mdCache = new Map<string, string>()

function renderMarkdown(content: string | undefined | null): string {
  const source = content || ''
  const cached = mdCache.get(source)
  if (cached !== undefined) return cached
  if (mdCache.size > 80) mdCache.clear()
  let html: string
  try {
    html = md.render(source)
  } catch {
    // 渲染炸了也别让整个面板空白，退化成纯文本
    html = `<pre>${source.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)}</pre>`
  }
  mdCache.set(source, html)
  return html
}

const editingId = ref<string | null>(null)
/// 主动隐藏后的一小段时间内不接受「展开」信号
let suppressExpandUntil = 0

function onContentClick(note: EdgeNotePayload, event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target) return
  const anchor = target.closest('a')
  if (anchor) {
    event.preventDefault()
    return
  }
  const checkbox = target.closest<HTMLInputElement>('input.md-task')
  if (checkbox) void toggleTask(note, checkbox, event)
}

/** 点卡片里的任务复选框：直接把正文里对应的 `- [ ]` 改掉并回写 */
async function toggleTask(note: EdgeNotePayload, checkbox: HTMLInputElement, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (editingId.value === note.id) return
  const line = Number(checkbox.dataset.taskLine)
  const current = note.content || ''
  const next = Number.isFinite(line) ? toggleTaskLine(current, line, checkbox.checked) : current
  if (next === current) {
    // 正文已经变了（对不上号），把勾选状态退回去，等主窗口推新内容
    checkbox.checked = !checkbox.checked
    return
  }
  // 先本地更一遍，界面立刻有反馈；主窗口改完会把最新内容回推过来
  note.content = next
  await emit('maiknote:edit-note', { id: note.id, op: 'replace', text: next })
}

async function beginEdit(note: EdgeNotePayload, event?: MouseEvent) {
  // 双击任务复选框不算「进入编辑」，否则勾一下就把卡片变成编辑态
  if ((event?.target as HTMLElement | null)?.closest('input.md-task')) return
  event?.preventDefault()
  contentDirty = false
  editingId.value = note.id
  await nextTick()
  const card = event
    ? (event.currentTarget as HTMLElement | null)?.closest('.note-card')
    : document.querySelector<HTMLElement>(`.note-card[data-note-id="${note.id}"]`)
  const el = card?.querySelector<HTMLElement>('.card-content[contenteditable]')
  if (!el) return
  el.focus()
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

let contentDirty = false

function onContentInput() {
  contentDirty = true
}

async function commitEdit(note: EdgeNotePayload, event: FocusEvent) {
  if (editingId.value === note.id) editingId.value = null
  if (!contentDirty) return
  contentDirty = false
  const el = event.target as HTMLElement | null
  if (!el) return
  const text = (el.innerText || '').replace(/\u00a0/g, ' ').replace(/\s+$/, '')
  const current = note.content || ''
  if (!text || text === current) return
  await emit('maiknote:edit-note', { id: note.id, op: 'paste', text, selection: current })
}

function cancelEdit(note: EdgeNotePayload, event: KeyboardEvent) {
  contentDirty = false
  if (editingId.value === note.id) editingId.value = null
  const el = event.target as HTMLElement | null
  if (el) {
    el.innerText = note.content || ''
    el.blur()
  }
}

/** 选中即复制：拖选松开后把选中的文字写进剪贴板 */
async function copySelectionOnSelect(event: MouseEvent) {
  if (!copyOnSelect.value) return
  if (event.button !== 0) return
  if (editingId.value) return
  // 菜单/按钮上的点击不处理
  const target = event.target as HTMLElement | null
  if (target?.closest('.ctx-menu, button')) return
  // 等浏览器把选区定下来
  await new Promise(resolve => setTimeout(resolve, 20))
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return
  const text = selection.toString().trim()
  if (!text) return
  const anchor = selection.anchorNode
  const element = anchor instanceof Element ? anchor : anchor?.parentElement
  const card = element?.closest<HTMLElement>('.note-card')
  const ok = await writeClipboard(text)
  const noteId = card?.dataset.noteId
  if (ok && noteId) flashNote(noteId, t('edge.selectionCopied'))
}

async function copyNote(note: EdgeNotePayload) {
  const text = note.content || note.title || ''
  if (await writeClipboard(text)) markCopied(note.id)
}

// ---------- 右键菜单 ----------

interface CtxMenuState {
  x: number
  y: number
  note: EdgeNotePayload
}

const MENU_WIDTH = 152
const MENU_HEIGHT = 120

const menu = ref<CtxMenuState | null>(null)
/** 右键瞬间选中的文字（为空则退回复制全文） */
const selectedText = ref('')

function openMenu(event: MouseEvent, note: EdgeNotePayload) {
  event.preventDefault()
  event.stopPropagation()
  // 记住右键瞬间的选区：点菜单会重置选区，动作执行时还要用
  const selection = window.getSelection()
  selectedText.value = selection && !selection.isCollapsed ? selection.toString().trim() : ''
  const maxX = window.innerWidth - MENU_WIDTH - 6
  const maxY = window.innerHeight - MENU_HEIGHT - 6
  menu.value = {
    x: Math.max(6, Math.min(event.clientX, maxX)),
    y: Math.max(6, Math.min(event.clientY, maxY)),
    note,
  }
}

function closeMenu() {
  menu.value = null
  selectedText.value = ''
}

function onDocumentPointerDown(event: MouseEvent) {
  if (!menu.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.ctx-menu')) return
  closeMenu()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}

function menuCopy() {
  const note = menu.value?.note
  const picked = selectedText.value
  closeMenu()
  if (!note) return
  if (picked) {
    void writeClipboard(picked).then(ok => {
      if (ok) markCopied(note.id)
    })
    return
  }
  void copyNote(note)
}

/** 进入编辑态（右键入口） */
function menuEdit() {
  const note = menu.value?.note
  closeMenu()
  if (!note) return
  void beginEdit(note)
}

/** 在主窗口打开这条笔记 */
function menuOpenInMain() {
  const note = menu.value?.note
  closeMenu()
  if (!note) return
  openNote(note)
}

/** 取消收藏（会从侧边栏移除） */
function menuUnpin() {
  const note = menu.value?.note
  closeMenu()
  if (!note) return
  void emit('maiknote:unpin-note', { id: note.id })
}

// ---------- 时间显示 ----------

const relativeFormatter = computed(() => {
  try {
    return new Intl.RelativeTimeFormat(locale.value === 'zh-CN' ? 'zh-CN' : 'en', { numeric: 'auto' })
  } catch {
    return null
  }
})

function timeLabel(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.round(diff / 60000)
  const formatter = relativeFormatter.value
  if (!formatter) return ''
  if (minutes < 1) return t('edge.justNow')
  if (minutes < 60) return formatter.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return formatter.format(-hours, 'hour')
  const days = Math.round(hours / 24)
  if (days < 7) return formatter.format(-days, 'day')
  return new Date(timestamp).toLocaleDateString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  })
}

/// 读取「边缘面板自动隐藏」设置（边缘窗口是独立上下文，直接读 localStorage 最新值）
function autoHideEnabled(): boolean {
  try {
    const raw = localStorage.getItem('maiknote-settings')
    if (!raw) return true
    const parsed = JSON.parse(raw)
    return parsed?.edgeAutoHide !== false
  } catch {
    return true
  }
}

onMounted(async () => {
  unlisteners.push(
    await listen<EdgeNotePayload[]>('maiknote:pinned-notes', event => {
      notes.value = Array.isArray(event.payload) ? event.payload : []
      // 回执：告诉主窗口「贴边面板还活着」，主窗口收不到就重载这个窗口
      void emit('maiknote:edge-ack', { at: Date.now(), count: notes.value.length }).catch(() => {})
      if (notes.value.length === 0) {
        expanded.value = false
        currentWidth = stripWidth.value
      }
    }),
  )
  // 设置页改了贴边方向 / 尺寸
  unlisteners.push(
    await listen<{
      side: EdgeSide
      panelWidth: number
      triggerSpan?: number
      stripWidth?: number
      stripColor?: string
      copyOnSelect?: boolean
    }>(
      'maiknote:edge-prefs',
      event => {
        const prefs = event.payload
        if (!prefs) return
        if (typeof prefs.copyOnSelect === 'boolean') copyOnSelect.value = prefs.copyOnSelect
        if (prefs.side) side.value = prefs.side
        if (typeof prefs.panelWidth === 'number') panelWidth.value = prefs.panelWidth
        // 触发高度变了，小白条跟着变长/变短
        if (typeof prefs.triggerSpan === 'number') triggerSpan.value = prefs.triggerSpan
        // 小白条粗细 / 颜色变了，折叠条厚度跟着算
        if (typeof prefs.stripWidth === 'number') stripW.value = prefs.stripWidth
        if (typeof prefs.stripColor === 'string' && prefs.stripColor) stripColor.value = prefs.stripColor
        syncStripThickness()
        // 折叠态下厚度变了要按新厚度归位
        if (!expanded.value) {
          currentWidth = stripWidth.value
          void applyWidth(stripWidth.value)
        } else {
          currentWidth = panelWidth.value
          void applyWidth(panelWidth.value)
        }
      },
    ),
  )
  // 主线程轮询的光标热区状态：鼠标碰到屏幕上对应边缘就展开，离开就收起
  unlisteners.push(
    await listen<boolean>('maiknote:edge-hover', event => {
      if (event.payload) {
        // 刚点了隐藏按钮时，鼠标往往还贴在最右侧，这里短暂忽略展开信号，避免「收起又弹开」
        if (Date.now() >= suppressExpandUntil) expand()
      } else if (autoHideEnabled()) {
        collapse()
      }
    }),
  )
  // 组件重挂载（含热更新）后把窗口宽度归位到折叠态，避免残留展开宽度
  currentWidth = stripWidth.value
  void applyWidth(stripWidth.value)
  // 菜单点外面 / Esc 关闭
  window.addEventListener('mouseup', copySelectionOnSelect)
  window.addEventListener('mousedown', onDocumentPointerDown, true)
  window.addEventListener('keydown', onDocumentKeydown)
  window.addEventListener('scroll', closeMenu, true)
  // 通知主窗口：边缘面板已就绪，可以推送置顶列表
  void emit('maiknote:edge-ready', {})

})

onUnmounted(() => {
  cancelAnimationFrame(animFrame)
  if (collapseTimer) clearTimeout(collapseTimer)
  if (flashTimer) clearTimeout(flashTimer)
  unlisteners.forEach(fn => fn())
  unlisteners.length = 0
  window.removeEventListener('mouseup', copySelectionOnSelect)
  window.removeEventListener('mousedown', onDocumentPointerDown, true)
  window.removeEventListener('keydown', onDocumentKeydown)
  window.removeEventListener('scroll', closeMenu, true)
})
</script>

<template>
  <div
    class="edge-root"
    :class="[`side-${side}`, { 'is-expanded': expanded }]"
    :style="{
      '--edge-trigger': stripWidth + 'px',
      '--edge-panel': panelWidth + 'px',
      '--edge-span': triggerSpan + '%',
      '--strip-w': stripW + 'px',
      '--strip-color': stripColor,
    }"
  >
    <!-- 折叠态触发条：贴边的一根小白条，长度 = 触发高度，居中 -->
    <div class="edge-strip" @click="expand">
      <span class="strip-handle" />
    </div>

    <!-- 展开态卡片面板 -->
    <aside class="edge-panel" @contextmenu.prevent="closeMenu()">
      <header class="panel-head">
        <span class="head-icon">⭐</span>
        <span class="head-title">{{ t('fileTree.pinnedSection') }}</span>
        <span class="head-count">{{ notes.length }}</span>
        <button
          class="head-hide"
          type="button"
          :title="t('edge.hidePanel')"
          @click.stop="hidePanel"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none" />
          </svg>
        </button>
      </header>

      <div class="panel-list">
        <div
          v-for="note in notes"
          :key="note.id"
          class="note-card"
          :data-note-id="note.id"
          :class="{ 'is-copied': flash?.id === note.id }"
          @contextmenu.prevent="openMenu($event, note)"
        >
          <span class="card-accent" :style="{ background: note.color || 'var(--color-primary)' }" />
          <div class="card-main">
            <div class="card-head">
              <button class="card-title" type="button" :title="t('edge.open')" @click="openNote(note)">
                {{ note.title }}
              </button>
              <button
                class="card-copy"
                type="button"
                :title="t('edge.copy')"
                @click.stop="copyNote(note)"
              >
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                  <rect
                    x="5.5"
                    y="5.5"
                    width="8"
                    height="8"
                    rx="1.6"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.2"
                  />
                  <path
                    d="M10.5 4V3.2A1.2 1.2 0 0 0 9.3 2H3.2A1.2 1.2 0 0 0 2 3.2v6.1A1.2 1.2 0 0 0 3.2 10.5H4"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.2"
                    stroke-linecap="round"
                  />
                </svg>
                <span class="copy-label">{{ flash?.id === note.id ? flash.label : t('edge.copy') }}</span>
              </button>
              <button
                class="card-copy card-edit"
                type="button"
                :title="t('edge.edit')"
                @click.stop="beginEdit(note, $event)"
              >
                <span class="copy-label">{{ t('edge.edit') }}</span>
              </button>
            </div>
            <pre
              v-if="editingId === note.id"
              class="card-content is-editing"
              contenteditable="plaintext-only"
              spellcheck="false"
              @input="onContentInput"
              @blur="commitEdit(note, $event)"
              @keydown.esc="cancelEdit(note, $event)"
              @paste.stop.prevent="onContentPaste"
            >{{ note.content }}</pre>
            <div
              v-else
              class="card-content md"
              @dblclick="beginEdit(note, $event)"
              @click="onContentClick(note, $event)"
              v-html="renderMarkdown(note.content)"
            ></div>
            <div class="card-meta">
              <span v-if="note.dirPath" class="card-dir">{{ note.dirPath }}</span>
              <span class="card-time">{{ timeLabel(note.updatedAt) }}</span>
            </div>
          </div>
        </div>

        <p v-if="notes.length === 0" class="panel-empty">{{ t('edge.empty') }}</p>
      </div>

      <footer class="panel-foot">
        <span class="foot-hint">{{ t('edge.hint') }}</span>
      </footer>
    </aside>

    <!-- 卡片右键菜单 -->
    <ul
      v-if="menu"
      class="ctx-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @contextmenu.prevent
    >
      <li>
        <button class="ctx-item" type="button" @click="menuCopy">
          {{ selectedText ? t('edge.copySelection') : t('edge.copy') }}
        </button>
      </li>
      <li>
        <button class="ctx-item" type="button" @click="menuEdit">{{ t('edge.edit') }}</button>
      </li>
      <li>
        <button class="ctx-item" type="button" @click="menuOpenInMain">
          {{ t('edge.openInMain') }}
        </button>
      </li>
      <li>
        <button class="ctx-item" type="button" @click="menuUnpin">{{ t('edge.unpin') }}</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.edge-root {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  justify-content: flex-end;
  user-select: none;
}

/* ---------- 触发条（贴边小白条） ---------- */

.edge-strip {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: transparent;
}

.side-right .edge-strip {
  top: 0;
  right: 0;
  width: 100%;
  height: 100%;
  flex-direction: column;
}

.side-left .edge-strip {
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  flex-direction: column;
}

.side-top .edge-strip {
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  flex-direction: row;
}

.side-bottom .edge-strip {
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  flex-direction: row;
}

.is-expanded .edge-strip {
  opacity: 0;
  pointer-events: none;
}

/* 小白条：长度 = 触发高度（居中），白色实心 + 深色描边 + 双向柔光，浅色背景上也一眼能看见 */
.strip-handle {
  display: block;
  width: var(--strip-w, 5px);
  height: var(--edge-span, 33%);
  min-height: 48px;
  max-height: 100%;
  border-radius: 999px;
  background: var(--strip-color, #ffffff);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.55),
    0 0 0 1px rgba(0, 0, 0, 0.42),
    0 0 8px rgba(0, 0, 0, 0.3),
    0 0 14px rgba(255, 255, 255, 0.9);
  transition: background 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}

.side-top .strip-handle,
.side-bottom .strip-handle {
  width: var(--edge-span, 33%);
  height: var(--strip-w, 5px);
  min-width: 48px;
  max-width: 100%;
}

.edge-strip:hover .strip-handle {
  background: var(--strip-color, #ffffff);
  filter: brightness(1.12);
  box-shadow:
    0 0 0 1.5px rgba(0, 0, 0, 0.5),
    0 0 12px rgba(0, 0, 0, 0.34),
    0 0 20px rgba(255, 255, 255, 1);
}

.edge-strip:active .strip-handle {
  transform: scale(0.96);
}

/* ---------- 面板 ---------- */

.edge-panel {
  position: absolute;
  display: flex;
  flex-direction: column;
  padding: 14px 12px 10px;
  box-sizing: border-box;
  opacity: 0;
  transition: opacity 0.16s ease, transform 0.2s cubic-bezier(0.22, 0.61, 0.36, 1);
  background: var(--color-surface, rgba(235, 238, 242, 0.86));
  backdrop-filter: blur(24px);
}

.side-right .edge-panel {
  top: 0;
  right: 0;
  width: var(--edge-panel, 320px);
  height: 100%;
  transform: translateX(16px);
  border-left: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: -12px 0 28px rgba(0, 0, 0, 0.12);
  border-radius: 14px 0 0 14px;
}

.side-left .edge-panel {
  top: 0;
  left: 0;
  width: var(--edge-panel, 320px);
  height: 100%;
  transform: translateX(-16px);
  border-right: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: 12px 0 28px rgba(0, 0, 0, 0.12);
  border-radius: 0 14px 14px 0;
}

.side-top .edge-panel {
  top: 0;
  left: 0;
  width: 100%;
  height: var(--edge-panel, 320px);
  transform: translateY(-16px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
  border-radius: 0 0 14px 14px;
}

.side-bottom .edge-panel {
  bottom: 0;
  left: 0;
  width: 100%;
  height: var(--edge-panel, 320px);
  transform: translateY(16px);
  border-top: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: 0 -12px 28px rgba(0, 0, 0, 0.12);
  border-radius: 14px 14px 0 0;
}

.edge-root.is-expanded .edge-panel {
  opacity: 1;
  transform: none;
}

/* 上下贴边时面板是「宽而矮」的，卡片改成横向排布 */
.side-top .panel-list,
.side-bottom .panel-list {
  flex-direction: row;
  overflow-x: auto;
  overflow-y: hidden;
}

.side-top .note-card,
.side-bottom .note-card {
  min-width: 260px;
  max-width: 320px;
}

.head-hide {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: auto;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-secondary, rgba(0, 0, 0, 0.45));
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.12s ease, background 0.12s ease;
}

.head-hide:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.07);
}

:global(html[data-theme='dark']) .head-hide:hover {
  background: rgba(255, 255, 255, 0.12);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px 10px;
  border-bottom: 1px solid var(--color-border);
  flex: 0 0 auto;
}

.head-icon {
  font-size: 12px;
}

.head-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-text);
}

.head-count {
  margin-left: auto;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  border-radius: 999px;
  color: var(--color-text-secondary);
  background: rgba(120, 130, 150, 0.16);
}

.panel-list {
  flex: 1 1 auto;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px 2px 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.panel-list::-webkit-scrollbar {
  width: 4px;
}

.panel-list::-webkit-scrollbar-thumb {
  background: rgba(120, 130, 150, 0.35);
  border-radius: 999px;
}

.note-card {
  display: flex;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  box-sizing: border-box;
  text-align: left;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.55);
  transition: background 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}

.note-card:hover {
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
}

.note-card.is-copied {
  border-color: var(--color-primary, #3b82f6);
}

.card-accent {
  flex: 0 0 3px;
  border-radius: 999px;
  min-height: 100%;
}

.card-main {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  flex: 1 1 auto;
}

.card-head {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.card-title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--color-text);
  text-align: left;
  word-break: break-word;
  cursor: pointer;
  user-select: text;
}

.card-title:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.card-copy {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 10px;
  line-height: 1.4;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s ease, color 0.15s ease;
}

.card-copy:hover {
  background: rgba(120, 130, 150, 0.16);
  color: var(--color-text);
}

.is-copied .card-copy {
  color: var(--color-primary, #3b82f6);
  border-color: var(--color-primary, #3b82f6);
}

.card-content.is-editing:focus {
  outline: 1px dashed var(--color-primary, #3b82f6);
  outline-offset: 2px;
  border-radius: 4px;
}

.card-content.md {
  overflow-wrap: anywhere;
  white-space: normal;
}

.card-content.md :deep(h1),
.card-content.md :deep(h2),
.card-content.md :deep(h3),
.card-content.md :deep(h4),
.card-content.md :deep(h5),
.card-content.md :deep(h6) {
  margin: 6px 0 3px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
}

.card-content.md :deep(h1) {
  font-size: 14px;
}

.card-content.md :deep(h2) {
  font-size: 13px;
}

.card-content.md :deep(p) {
  margin: 3px 0;
}

.card-content.md :deep(ul),
.card-content.md :deep(ol) {
  margin: 3px 0;
  padding-left: 16px;
}

.card-content.md :deep(li) {
  margin: 2px 0;
}

.card-content.md :deep(li > p) {
  margin: 0;
}

/* ---------- 任务列表：真复选框，可点 ---------- */

.card-content.md :deep(.md-task-list) {
  padding-left: 2px;
  list-style: none;
}

.card-content.md :deep(li.md-task-item) {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding-left: 0;
  list-style: none;
}

.card-content.md :deep(li.md-task-item)::marker {
  content: '';
}

.card-content.md :deep(input.md-task) {
  flex: none;
  width: 13px;
  height: 13px;
  margin: 2px 0 0;
  appearance: none;
  -webkit-appearance: none;
  border: 1.4px solid var(--color-border);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  position: relative;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.card-content.md :deep(input.md-task:hover) {
  border-color: var(--color-primary, #3b82f6);
}

.card-content.md :deep(input.md-task:checked) {
  border-color: var(--color-primary, #3b82f6);
  background: var(--color-primary, #3b82f6);
}

.card-content.md :deep(input.md-task:checked)::after {
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

/* 勾掉的任务整条灰掉 + 删除线，跟编辑器里一致 */
.card-content.md :deep(li.md-task-item[data-checked='true']) {
  color: var(--color-text-secondary);
  text-decoration: line-through;
  text-decoration-color: currentColor;
  opacity: 0.72;
}

.card-content.md :deep(del) {
  opacity: 0.62;
}

.card-content.md :deep(strong) {
  font-weight: 600;
}

.card-content.md :deep(code) {
  padding: 1px 3.5px;
  border-radius: 3.5px;
  background: rgba(0, 0, 0, 0.06);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
}

.card-content.md :deep(pre) {
  margin: 5px 0;
  padding: 6px 8px;
  overflow-x: auto;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.055);
}

.card-content.md :deep(pre code) {
  padding: 0;
  background: none;
  font-size: 10.5px;
}

.card-content.md :deep(blockquote) {
  margin: 4px 0;
  padding-left: 8px;
  border-left: 2px solid rgba(0, 0, 0, 0.16);
  opacity: 0.82;
}

.card-content.md :deep(a) {
  color: var(--color-primary, #3b82f6);
  text-decoration: underline;
  cursor: text;
}

.card-content.md :deep(hr) {
  margin: 7px 0;
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.12);
}

.card-content.md :deep(img) {
  max-width: 100%;
  border-radius: 4px;
}

.card-content.md :deep(table) {
  margin: 4px 0;
  border-collapse: collapse;
  font-size: 10.5px;
}

.card-content.md :deep(th),
.card-content.md :deep(td) {
  padding: 2px 5px;
  border: 1px solid rgba(0, 0, 0, 0.12);
}

:global([data-theme="dark"]) .card-content.md :deep(code),
:global([data-theme="dark"]) .card-content.md :deep(pre) {
  background: rgba(255, 255, 255, 0.1);
}

:global([data-theme="dark"]) .card-content.md :deep(blockquote) {
  border-left-color: rgba(255, 255, 255, 0.24);
}

:global([data-theme="dark"]) .card-content.md :deep(hr) {
  border-top-color: rgba(255, 255, 255, 0.18);
}

:global([data-theme="dark"]) .card-content.md :deep(th),
:global([data-theme="dark"]) .card-content.md :deep(td) {
  border-color: rgba(255, 255, 255, 0.18);
}

.card-content {
  margin: 0;
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  cursor: text;
  user-select: text;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--color-text-secondary);
  opacity: 0.85;
}

.card-dir {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 65%;
}

.card-time {
  margin-left: auto;
  flex: 0 0 auto;
}

.panel-empty {
  margin: 24px 0;
  text-align: center;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.panel-foot {
  flex: 0 0 auto;
  padding: 8px 4px 0;
  border-top: 1px solid var(--color-border);
}

.foot-hint {
  font-size: 10px;
  color: var(--color-text-secondary);
  opacity: 0.8;
}

/* ---------- 右键菜单 ---------- */

.ctx-menu {
  position: fixed;
  z-index: 999;
  min-width: 152px;
  margin: 0;
  padding: 4px;
  list-style: none;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  background: var(--color-surface, rgba(240, 242, 245, 0.96));
  backdrop-filter: blur(24px);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
  animation: ctx-in 0.12s ease;
}

@keyframes ctx-in {
  from {
    opacity: 0;
    transform: translateY(-3px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.ctx-item {
  display: block;
  width: 100%;
  margin: 0;
  padding: 5px 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1.5;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.ctx-item:disabled {
  opacity: 0.42;
  cursor: default;
}

.ctx-item:disabled:hover {
  background: transparent;
  color: var(--color-text);
}

.ctx-item:hover {
  background: var(--color-primary, #3b82f6);
  color: #fff;
}

.ctx-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--color-border);
  opacity: 0.8;
}

/* 深色主题微调 */
:global([data-theme='dark']) .note-card,
:global(html[data-theme='dark']) .note-card {
  background: rgba(255, 255, 255, 0.06);
}

:global(html[data-theme='dark']) .note-card:hover {
  background: rgba(255, 255, 255, 0.12);
}

:global(html[data-theme='dark']) .ctx-menu {
  background: rgba(38, 40, 44, 0.96);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
}

:global(html[data-theme='dark']) .edge-panel {
  border-left-color: rgba(255, 255, 255, 0.08);
  box-shadow: -12px 0 28px rgba(0, 0, 0, 0.45);
}
</style>
