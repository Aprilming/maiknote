<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { confirmAction } from '@/composables/useConfirm'
import { useNoteStore } from '@/stores/noteStore'
import { useDesktopNotes } from '@/composables/useDesktopNotes'
import { useDirectoryStore } from '@/stores/directoryStore'
import { useSettingStore } from '@/stores/settingStore'
import type { Directory, Note, NoteFileEntry } from '@/types/note'
import NoteColorPicker from '@/components/NoteColorPicker.vue'
import NoteLogo from '@/components/NoteLogo.vue'
import { useTheme } from '@/composables/useTheme'
import { TREE_DARK_COLORS, TREE_LIGHT_COLORS } from '@/utils/treeColors'

const props = withDefaults(defineProps<{
  width?: number
}>(), {
  width: 216,
})

const emit = defineEmits<{
  (e: 'collapse'): void
  (e: 'resize', width: number): void
}>()

const noteStore = useNoteStore()
const desktopNotes = useDesktopNotes()
const directoryStore = useDirectoryStore()
const settingStore = useSettingStore()

// 文件树字号缩放系数：以 12.5px 为基准，行高与图标尺寸跟随缩放
const treeFontScale = computed(() => {
  const size = Number(settingStore.settings.fileTreeFontSize) || 12.5
  return Math.min(18, Math.max(11, size)) / 12.5
})
const { t } = useI18n()

const { isDark } = useTheme()
const treeColors = computed(() => (isDark() ? TREE_DARK_COLORS : TREE_LIGHT_COLORS))

const EXPANDED_KEY = 'fileTree.expandedDirs'
const ROOT_EXPANDED_KEY = 'fileTree.rootExpanded'

// ---------- 展开状态 ----------

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (raw) return new Set<string>(JSON.parse(raw) as string[])
  } catch {
    // 忽略损坏的本地数据
  }
  return new Set<string>()
}

const expandedDirs = ref<Set<string>>(loadExpanded())
const rootExpanded = ref(localStorage.getItem(ROOT_EXPANDED_KEY) !== 'false')

watch(expandedDirs, (value) => {
  localStorage.setItem(EXPANDED_KEY, JSON.stringify([...value]))
})

watch(rootExpanded, (value) => {
  localStorage.setItem(ROOT_EXPANDED_KEY, value ? 'true' : 'false')
})

// ---------- 收藏区 ----------

const PINNED_EXPANDED_KEY = 'fileTree.pinnedExpanded'
const pinnedExpanded = ref(localStorage.getItem(PINNED_EXPANDED_KEY) !== 'false')
watch(pinnedExpanded, (value) => {
  localStorage.setItem(PINNED_EXPANDED_KEY, value ? 'true' : 'false')
})

function togglePinned() {
  pinnedExpanded.value = !pinnedExpanded.value
}

/** 收藏区里显示笔记所在的目录路径，避免和目录里的同名笔记混淆 */
function noteDirLabel(note: Note): string {
  const names: string[] = []
  let current = note.directoryId ?? null
  let guard = 0
  while (current && guard++ < 64) {
    const dir = directoryStore.getDirectory(current)
    if (!dir) break
    names.unshift(dir.name)
    current = dir.parentId
  }
  return names.length ? names.join(' / ') : t('dirTree.rootDir')
}

// ---------- 回收站 ----------

const TRASH_EXPANDED_KEY = 'fileTree.trashExpanded'
const trashExpanded = ref(localStorage.getItem(TRASH_EXPANDED_KEY) === 'true')
watch(trashExpanded, (value) => {
  localStorage.setItem(TRASH_EXPANDED_KEY, value === true ? 'true' : 'false')
})

const trashPreview = ref<Note | null>(null)

function toggleTrash() {
  trashExpanded.value = !trashExpanded.value
}

function openTrashPreview(note: Note) {
  trashPreview.value = note
}

function closeTrashPreview() {
  trashPreview.value = null
}

function trashDeletedAt(note: Note): string {
  if (!note.trashedAt) return ''
  const d = new Date(note.trashedAt)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function restoreTrashed(note: Note) {
  closeTrashPreview()
  await noteStore.restoreNote(note.id)
}

async function purgeTrashed(note: Note) {
  closeTrashPreview()
  const confirmed = await confirmAction({
    message: t('trash.deleteConfirm'),
    confirmText: t('trash.delete')
  })
  if (!confirmed) return
  await noteStore.permanentlyDeleteNote(note.id)
}

async function emptyTrashAll() {
  const count = noteStore.trashedNotes.length
  if (!count) return
  const confirmed = await confirmAction({
    message: t('trash.emptyConfirm', { count }),
    confirmText: t('trash.empty')
  })
  if (!confirmed) return
  closeTrashPreview()
  await noteStore.emptyTrash()
}

// ---------- 磁盘残留文件（metadata 里没有、但磁盘上还留着的 note_*.md） ----------

const ORPHAN_EXPANDED_KEY = 'fileTree.orphansExpanded'
const orphansExpanded = ref(localStorage.getItem(ORPHAN_EXPANDED_KEY) === 'true')
watch(orphansExpanded, (value) => {
  localStorage.setItem(ORPHAN_EXPANDED_KEY, value ? 'true' : 'false')
})

function toggleOrphans() {
  orphansExpanded.value = !orphansExpanded.value
  if (orphansExpanded.value) void noteStore.scanOrphanFiles()
}

function orphanTime(file: NoteFileEntry): string {
  if (!file.modified) return ''
  const d = new Date(file.modified)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function orphanSize(file: NoteFileEntry): string {
  if (file.size < 1024) return `${file.size} B`
  return `${(file.size / 1024).toFixed(1)} KB`
}

async function restoreOrphan(file: NoteFileEntry) {
  closeContextMenu()
  await noteStore.restoreOrphanFile(file)
}

async function trashOrphan(file: NoteFileEntry) {
  closeContextMenu()
  await noteStore.trashOrphanFile(file)
}

async function trashAllOrphans() {
  const count = noteStore.orphanFiles.length
  if (!count) return
  const confirmed = await confirmAction({
    message: t('trash.orphanTrashAllConfirm', { count }),
    confirmText: t('trash.orphanTrashAll')
  })
  if (!confirmed) return
  closeContextMenu()
  await noteStore.trashAllOrphanFiles()
}

function isExpanded(id: string): boolean {
  return expandedDirs.value.has(id)
}

function expandDirs(...ids: string[]) {
  const next = new Set(expandedDirs.value)
  let changed = false
  for (const id of ids) {
    if (!next.has(id)) {
      next.add(id)
      changed = true
    }
  }
  if (changed) expandedDirs.value = next
}

function toggleDir(id: string) {
  const next = new Set(expandedDirs.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedDirs.value = next
}

function toggleRoot() {
  rootExpanded.value = !rootExpanded.value
}

/** 从当前目录一路往上收集祖先 id（含自身） */
function chainIds(dirId: string | null): string[] {
  if (!dirId) return []
  const ids: string[] = []
  let current: string | null = dirId
  let guard = 0
  while (current && guard++ < 64) {
    ids.push(current)
    current = directoryStore.getDirectory(current)?.parentId ?? null
  }
  return ids
}

/** 展开某目录的所有祖先，保证当前笔记在树里可见 */
function expandChain(dirId: string | null) {
  if (!dirId) return
  expandDirs(...chainIds(dirId))
}

// 切换目录（快捷键 / 点其它目录的笔记）时只保留当前目录这条链展开，其它目录收起
watch(() => noteStore.filterDirectoryId, (dirId, oldDirId) => {
  if (dirId === oldDirId) return
  // 回到主目录时 dirId 为 null，chainIds 返回空集合，等于把子目录全部收起
  rootExpanded.value = true
  expandedDirs.value = new Set(chainIds(dirId))
})

// 切换笔记时自动展开其所在目录链
watch(() => noteStore.currentNoteId, () => {
  const dirId = noteStore.currentNote?.directoryId ?? null
  if (dirId) {
    rootExpanded.value = true
    expandChain(dirId)
  }
}, { immediate: true })

// ---------- 扁平化行数据 ----------

type TreeRow =
  | { key: string; type: 'dir'; dir: Directory; depth: number }
  | { key: string; type: 'note'; note: Note; depth: number }
  | { key: string; type: 'input'; depth: number }

function buildRows(parentId: string | null, depth: number): TreeRow[] {
  const dirRows: TreeRow[] = []
  for (const dir of directoryStore.directories.filter(d => d.parentId === parentId)) {
    dirRows.push({ key: `dir:${dir.id}`, type: 'dir', dir, depth })
    if (creatingIn.value === dir.id) {
      dirRows.push({ key: `input:${dir.id}`, type: 'input', depth: depth + 1 })
    }
    if (isExpanded(dir.id)) {
      dirRows.push(...buildRows(dir.id, depth + 1))
    }
  }
  // 收藏笔记排在同级最前面（其余保持原顺序）
  const dirNotes = noteStore.getNotesByDirectory(parentId)
    .slice()
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned))
  const noteRows: TreeRow[] = dirNotes.map(note => ({ key: `note:${note.id}`, type: 'note', note, depth }))
  // 同级排序：文件夹在上 / 文件在上
  return settingStore.settings.treeOrder === 'files'
    ? [...noteRows, ...dirRows]
    : [...dirRows, ...noteRows]
}

const rows = computed<TreeRow[]>(() => {
  if (!rootExpanded.value) return []
  const list: TreeRow[] = []
  if (creatingIn.value === null) {
    list.push({ key: 'input:root', type: 'input', depth: 1 })
  }
  list.push(...buildRows(null, 1))
  return list
})

const rootNoteCount = computed(() => noteStore.getNotesByDirectory(null).length)
const hasContent = computed(() =>
  directoryStore.directories.length > 0 || noteStore.activeNotes.length > 0
)

function indent(depth: number): string {
  return `${8 + depth * 14}px`
}

function dirNoteCount(dirId: string): number {
  return noteStore.getNotesByDirectory(dirId).length
}

function isCurrentDir(dirId: string | null): boolean {
  return (noteStore.currentNote?.directoryId ?? null) === dirId
}

function noteLabel(note: Note): string {
  return note.title?.trim() || t('notelist.untitled')
}

// ---------- 打开笔记 / 目录 ----------

function openNote(note: Note) {
  if (suppressClick) return
  const dirId = note.directoryId ?? null
  // 静默同步过滤目录，避免 setFilterDirectory 在空目录里自动新建笔记
  if (noteStore.filterDirectoryId !== dirId) {
    noteStore.filterDirectoryId = dirId
    directoryStore.selectDirectory(dirId)
  }
  noteStore.selectNote(note.id)
}

// ---------- 新建目录 ----------

const creatingIn = ref<string | null | undefined>(undefined)
const newDirName = ref('')
let newDirInputEl: HTMLInputElement | null = null

function setNewDirInput(el: unknown) {
  newDirInputEl = el as HTMLInputElement | null
}

async function startCreate(parentId: string | null) {
  creatingIn.value = parentId
  newDirName.value = ''
  if (parentId) expandDirs(parentId)
  else rootExpanded.value = true
  await nextTick()
  newDirInputEl?.focus()
}

async function confirmCreate() {
  const name = newDirName.value.trim()
  const parentId = creatingIn.value
  if (name && parentId !== undefined) {
    await directoryStore.createDirectory(name, parentId)
  }
  creatingIn.value = undefined
  newDirName.value = ''
}

function cancelCreate() {
  creatingIn.value = undefined
  newDirName.value = ''
}

// ---------- 重命名目录 ----------

const renamingId = ref<string | null>(null)
const renameValue = ref('')
let renameInputEl: HTMLInputElement | null = null

function setRenameInput(el: unknown) {
  renameInputEl = el as HTMLInputElement | null
}

async function startRename(dir: Directory) {
  renamingId.value = dir.id
  renameValue.value = dir.name
  await nextTick()
  renameInputEl?.focus()
  renameInputEl?.select()
}

async function confirmRename() {
  const id = renamingId.value
  const name = renameValue.value.trim()
  if (id && name) {
    await directoryStore.renameDirectory(id, name)
  }
  renamingId.value = null
  renameValue.value = ''
}

function cancelRename() {
  renamingId.value = null
  renameValue.value = ''
}

// ---------- 新建笔记 ----------

async function createNoteIn(dirId: string | null) {
  if (dirId) {
    rootExpanded.value = true
    expandChain(dirId)
  }
  noteStore.filterDirectoryId = dirId
  directoryStore.selectDirectory(dirId)
  await noteStore.createNoteAtTail()
}

// ---------- 右键菜单 ----------

type ContextTarget =
  | { type: 'root' }
  | { type: 'blank' }
  | { type: 'dir'; dir: Directory }
  | { type: 'note'; note: Note }
  | { type: 'trash' }
  | { type: 'trashNote'; note: Note }
  | { type: 'orphans' }
  | { type: 'orphanFile'; file: NoteFileEntry }

const ctxMenu = ref<{ x: number; y: number; target: ContextTarget } | null>(null)

function openContextMenu(e: MouseEvent, target: ContextTarget) {
  e.preventDefault()
  e.stopPropagation()
  // 右键笔记时先切到该笔记，菜单动作作用在看得见的对象上
  if (target.type === 'note' && noteStore.currentNoteId !== target.note.id) {
    openNote(target.note)
  }
  const menuWidth = 176
  const menuHeight = 150
  const x = Math.max(6, Math.min(e.clientX, window.innerWidth - menuWidth - 8))
  const y = Math.max(6, Math.min(e.clientY, window.innerHeight - menuHeight - 8))
  ctxMenu.value = { x, y, target }
}

function closeContextMenu() {
  ctxMenu.value = null
}

/** 文件树空白处右键：新建笔记 / 新建文件夹 */
function openBlankContextMenu(e: MouseEvent) {
  const el = e.target as HTMLElement | null
  if (el && el.closest('.tree-row')) return
  openContextMenu(e, { type: 'blank' })
}

const ctxTarget = computed<ContextTarget | null>(() => ctxMenu.value?.target ?? null)
const ctxDir = computed<Directory | null>(() => {
  const target = ctxTarget.value
  return target?.type === 'dir' ? target.dir : null
})
const ctxNote = computed<Note | null>(() => {
  const target = ctxTarget.value
  return target?.type === 'note' ? target.note : null
})
const ctxTrashNote = computed<Note | null>(() => {
  const target = ctxTarget.value
  return target?.type === 'trashNote' ? target.note : null
})
const ctxOrphanFile = computed<NoteFileEntry | null>(() => {
  const target = ctxTarget.value
  return target?.type === 'orphanFile' ? target.file : null
})

// ---- 菜单动作：全部自己读 ctxMenu，避免模板里对联合类型做窄化 ----
function ctxNewNote() {
  const dirId = ctxDir.value?.id ?? null
  closeContextMenu()
  createNoteIn(dirId)
}

function ctxNewSubdir() {
  const dir = ctxDir.value
  closeContextMenu()
  if (dir) startCreate(dir.id)
}

function ctxNewRootDir() {
  closeContextMenu()
  startCreate(null)
}

function ctxNewBlankNote() {
  closeContextMenu()
  createNoteIn(null)
}

function ctxRenameDir() {
  const dir = ctxDir.value
  closeContextMenu()
  if (dir) startRename(dir)
}

function ctxDeleteDir() {
  const dir = ctxDir.value
  closeContextMenu()
  if (dir) deleteDir(dir)
}

function ctxToggleDesktop() {
  const note = ctxNote.value
  if (!note) return
  closeContextMenu()
  void desktopNotes.toggle(note.id)
}

function ctxTogglePin() {
  const note = ctxNote.value
  closeContextMenu()
  if (note) noteStore.togglePin(note.id)
}

function ctxMoveToRoot() {
  const note = ctxNote.value
  closeContextMenu()
  if (note) moveNoteToRoot(note)
}

function ctxDeleteNote() {
  const note = ctxNote.value
  closeContextMenu()
  if (note) removeNote(note)
}

function ctxOpenTrashNote() {
  const note = ctxTrashNote.value
  closeContextMenu()
  if (note) openTrashPreview(note)
}

function ctxRestoreTrashNote() {
  const note = ctxTrashNote.value
  closeContextMenu()
  if (note) restoreTrashed(note)
}

function ctxPurgeTrashNote() {
  const note = ctxTrashNote.value
  closeContextMenu()
  if (note) purgeTrashed(note)
}

function ctxEmptyTrash() {
  closeContextMenu()
  emptyTrashAll()
}

function restorePreviewing() {
  const note = trashPreview.value
  if (note) restoreTrashed(note)
}

function ctxRestoreOrphan() {
  const file = ctxOrphanFile.value
  closeContextMenu()
  if (file) void noteStore.restoreOrphanFile(file)
}

function ctxTrashOrphan() {
  const file = ctxOrphanFile.value
  closeContextMenu()
  if (file) void noteStore.trashOrphanFile(file)
}

function ctxTrashAllOrphans() {
  void trashAllOrphans()
}

function ctxRescanOrphans() {
  closeContextMenu()
  void noteStore.scanOrphanFiles(true)
}

function purgePreviewing() {
  const note = trashPreview.value
  if (note) purgeTrashed(note)
}

// ---------- 文件树颜色 ----------

type ColorTarget = { type: 'dir'; id: string } | { type: 'note'; id: string } | { type: 'root' }

const colorPop = ref<{ x: number; y: number; target: ColorTarget } | null>(null)

const colorPopValue = computed<string | undefined>(() => {
  const pop = colorPop.value
  if (!pop) return undefined
  const target = pop.target
  if (target.type === 'root') return directoryStore.rootDirColor
  if (target.type === 'dir') return directoryStore.getDirectory(target.id)?.color
  if (target.type === 'note') return noteStore.notes.find(n => n.id === target.id)?.color
  return undefined
})

function openColorPopAt(x: number, y: number, target: ColorTarget) {
  const width = 208
  const height = 252
  colorPop.value = {
    x: Math.max(6, Math.min(x, window.innerWidth - width - 8)),
    y: Math.max(6, Math.min(y, window.innerHeight - height - 8)),
    target,
  }
}

function ctxRootDirColor() {
  const pos = ctxMenu.value
  closeContextMenu()
  if (!pos) return
  openColorPopAt(pos.x, pos.y, { type: 'root' })
}

function ctxDirColor() {
  const dir = ctxDir.value
  const pos = ctxMenu.value
  closeContextMenu()
  if (!dir || !pos) return
  openColorPopAt(pos.x, pos.y, { type: 'dir', id: dir.id })
}

function ctxNoteColor() {
  const note = ctxNote.value
  const pos = ctxMenu.value
  closeContextMenu()
  if (!note || !pos) return
  openColorPopAt(pos.x, pos.y, { type: 'note', id: note.id })
}

function closeColorPop() {
  colorPop.value = null
}

function applyTreeColor(color: string | undefined) {
  const pop = colorPop.value
  colorPop.value = null
  if (!pop) return
  const target = pop.target
  if (target.type === 'root') {
    void directoryStore.setRootDirColor(color)
  } else if (target.type === 'dir') {
    void directoryStore.setDirectoryColor(target.id, color)
  } else if (target.type === 'note') {
    noteStore.updateNote(target.id, { color })
  }
}

/** 行内着色：没设颜色就交给 CSS 默认色 */
function rowColorStyle(color: string | undefined) {
  return color ? { color } : undefined
}

function onDocumentPointerDown(e: PointerEvent) {
  const el = e.target as HTMLElement | null
  if (colorPop.value && !el?.closest('.tree-color-pop')) {
    colorPop.value = null
  }
  if (!ctxMenu.value) return
  if (el?.closest('.tree-ctx-menu')) return
  closeContextMenu()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  window.addEventListener('blur', closeContextMenu)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('blur', closeContextMenu)
})

async function deleteDir(dir: Directory) {
  const count = dirNoteCount(dir.id)
  const msg = count > 0
    ? t('dirTree.deleteConfirmWithNotes', { name: dir.name, count })
    : t('dirTree.deleteConfirm', { name: dir.name })
  const confirmed = await confirmAction({ message: msg, confirmText: t('common.delete') })
  if (!confirmed) return
  for (const note of noteStore.getNotesByDirectory(dir.id)) {
    await noteStore.moveNoteToDirectory(note.id, null)
  }
  if (noteStore.filterDirectoryId === dir.id) {
    noteStore.filterDirectoryId = null
  }
  await directoryStore.deleteDirectory(dir.id)
  const next = new Set(expandedDirs.value)
  next.delete(dir.id)
  expandedDirs.value = next
}

async function moveNoteToRoot(note: Note) {
  await noteStore.moveNoteToDirectory(note.id, null)
  if (noteStore.currentNoteId === note.id) {
    noteStore.filterDirectoryId = null
    directoryStore.selectDirectory(null)
  }
}

async function removeNote(note: Note) {
  if (note.isLocked) return
  const confirmed = await confirmAction({
    message: t('fileTree.deleteNoteConfirm', { name: noteLabel(note) }),
    confirmText: t('common.delete')
  })
  if (!confirmed) return
  // 删的是当前正在看的笔记：交给编辑器播粒子动画，动画结束由它落地删除
  if (note.id === noteStore.currentNoteId) {
    window.dispatchEvent(new CustomEvent('marknote:delete-note'))
    return
  }
  await noteStore.deleteNote(note.id)
}

// ---------- 拖拽：目录同级排序 / 笔记拖进目录 ----------
// WKWebView 里 HTML5 drag&drop 不触发，这里全部用 pointer 事件自己实现

const dragDirId = ref<string | null>(null)
const dragNoteId = ref<string | null>(null)
const dragOverDirId = ref<string | null>(null)
const dragOverNoteId = ref<string | null>(null)
const dragOverRoot = ref(false)
const dragOverPos = ref<'before' | 'after' | 'into'>('before')
const dragGhost = ref<{ x: number; y: number; label: string; isDir: boolean } | null>(null)

// 松手后浏览器还会补发一次 click，用它把这次点击吞掉，免得误打开笔记
let suppressClick = false
let dragOrigin: { mode: 'note' | 'dir'; id: string; label: string; x: number; y: number } | null = null
let dragging = false

function resetDrag() {
  dragDirId.value = null
  dragNoteId.value = null
  dragOverDirId.value = null
  dragOverNoteId.value = null
  dragOverRoot.value = false
  dragOverPos.value = 'before'
  dragGhost.value = null
}

function detachDragListeners() {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
  document.body.style.userSelect = ''
}

function beginDrag(e: PointerEvent, mode: 'note' | 'dir', id: string, label: string) {
  if (e.button !== 0) return
  if (mode === 'dir' && renamingId.value === id) return
  const target = e.target as HTMLElement | null
  // 行内按钮/输入框上按下时不算拖拽
  if (target && target.closest('input, .row-actions, .orphan-action, .note-pin, .note-desktop-icon')) return
  dragOrigin = { mode, id, label, x: e.clientX, y: e.clientY }
  dragging = false
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  window.addEventListener('pointercancel', onDragEnd)
}

function onDragMove(e: PointerEvent) {
  const origin = dragOrigin
  if (!origin) return
  if (!dragging && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 4) return
  if (!dragging) {
    dragging = true
    document.body.style.userSelect = 'none'
    if (origin.mode === 'note') {
      dragNoteId.value = origin.id
    } else {
      dragDirId.value = origin.id
    }
  }
  dragGhost.value = { x: e.clientX, y: e.clientY, label: origin.label, isDir: origin.mode === 'dir' }

  // 用坐标反查指针下面的行
  dragOverRoot.value = false
  dragOverDirId.value = null
  dragOverNoteId.value = null
  const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null

  if (under?.closest('[data-root-drop]')) {
    dragOverRoot.value = true
    dragOverPos.value = 'into'
    return
  }

  if (origin.mode === 'note') {
    // 落在别的笔记行上 = 同级排序（上下半区决定插在前还是插在后）
    const noteEl = under?.closest('[data-note-id]') as HTMLElement | null
    const overNoteId = noteEl?.dataset.noteId
    if (noteEl && overNoteId && overNoteId !== origin.id) {
      const rect = noteEl.getBoundingClientRect()
      dragOverNoteId.value = overNoteId
      dragOverPos.value = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      return
    }
    const dirElForNote = under?.closest('[data-dir-id]') as HTMLElement | null
    const dirIdForNote = dirElForNote?.dataset.dirId
    if (dirIdForNote) {
      dragOverDirId.value = dirIdForNote
      dragOverPos.value = 'into'
    }
    return
  }

  const dirEl = under?.closest('[data-dir-id]') as HTMLElement | null
  const dirId = dirEl?.dataset.dirId
  if (!dirEl || !dirId) return

  const source = directoryStore.getDirectory(origin.id)
  const target = directoryStore.getDirectory(dirId)
  // 目录只允许同级排序，跨级请用右键菜单
  if (!source || !target || source.id === target.id || source.parentId !== target.parentId) return
  const rect = dirEl.getBoundingClientRect()
  dragOverDirId.value = dirId
  dragOverPos.value = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

async function onDragEnd() {
  const origin = dragOrigin
  const moved = dragging
  const overDirId = dragOverDirId.value
  const overNoteId = dragOverNoteId.value
  const overRoot = dragOverRoot.value
  const position = dragOverPos.value
  const targetParent = overDirId ? directoryStore.getDirectory(overDirId) : null

  dragOrigin = null
  dragging = false
  detachDragListeners()
  resetDrag()
  if (!origin || !moved) return

  suppressClick = true
  setTimeout(() => {
    suppressClick = false
  }, 0)

  if (origin.mode === 'note') {
    if (overNoteId && position !== 'into') {
      await reorderNoteNextTo(origin.id, overNoteId, position)
      return
    }
    if (overRoot) {
      await noteStore.moveNoteToDirectory(origin.id, null)
      return
    }
    if (overDirId) {
      await noteStore.moveNoteToDirectory(origin.id, overDirId)
      expandDirs(overDirId)
    }
    return
  }

  if (!overDirId || !targetParent || position === 'into') return
  await directoryStore.moveDirectory(origin.id, targetParent.parentId, position, overDirId)
}

/** 同级可见顺序（收藏的排在同级最前，和模板里的排序保持一致） */
function siblingNoteIds(dirId: string | null): string[] {
  return noteStore.getNotesByDirectory(dirId)
    .slice()
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned))
    .map(n => n.id)
}

/** 把笔记插到目标笔记的前/后：跨目录时先搬进目标目录，再按同级顺序落位 */
async function reorderNoteNextTo(noteId: string, targetId: string, position: 'before' | 'after') {
  const moving = noteStore.notes.find(n => n.id === noteId)
  const target = noteStore.notes.find(n => n.id === targetId)
  if (!moving || !target) return

  const targetDir = target.directoryId ?? null
  if ((moving.directoryId ?? null) !== targetDir) {
    await noteStore.moveNoteToDirectory(noteId, targetDir)
    expandChain(targetDir)
  }

  const ids = siblingNoteIds(targetDir).filter(id => id !== noteId)
  const index = ids.indexOf(targetId)
  if (index === -1) return
  ids.splice(position === 'before' ? index : index + 1, 0, noteId)

  // 收藏笔记永远排同级最前：插到收藏上方时落成"最靠上的非收藏笔记"，位置稳定不打滑
  const byId = new Map(noteStore.notes.map(n => [n.id, n]))
  const pinnedIds = ids.filter(id => byId.get(id)?.isPinned)
  const plainIds = ids.filter(id => !byId.get(id)?.isPinned)
  noteStore.reorderNotesInDirectory([...pinnedIds, ...plainIds])
}

// ---------- 拖拽调宽 ----------

const resizing = ref(false)
let resizeStartX = 0
let resizeStartWidth = 0

function startResize(e: PointerEvent) {
  resizing.value = true
  resizeStartX = e.clientX
  resizeStartWidth = props.width
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', stopResize)
}

function onResizeMove(e: PointerEvent) {
  if (!resizing.value) return
  const next = Math.min(360, Math.max(160, resizeStartWidth + e.clientX - resizeStartX))
  emit('resize', next)
}

function stopResize() {
  resizing.value = false
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', stopResize)
}

// 点浮层外面就收起回收站浮层
function onGlobalPointerDown(e: PointerEvent) {
  if (!trashExpanded.value) return
  const el = e.target as HTMLElement | null
  if (el && (el.closest('.trash-pop') || el.closest('.trash-foot-btn'))) return
  trashExpanded.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', onGlobalPointerDown, true)
})

onBeforeUnmount(() => {
  stopResize()
  document.removeEventListener('pointerdown', onGlobalPointerDown, true)
})
</script>

<template>
  <aside
    class="file-tree"
    data-filetree
    :class="{ resizing }"
    :style="{ width: `${props.width}px`, '--tree-fs-scale': treeFontScale }"
    @contextmenu.prevent
  >
    <header class="tree-head">
      <span class="tree-heading">
        <NoteLogo
          :logo-style="settingStore.settings.noteLogoStyle"
          :variant="settingStore.settings.noteLogoVariant"
          :size="16"
        />
        <span class="tree-heading-text">{{ $t('fileTree.title') }}</span>
      </span>
    </header>

    <div class="tree-body" @contextmenu="openBlankContextMenu">
      <!-- 收藏区：所有目录下的收藏笔记都固定显示在这里，不受目录展开/当前目录影响 -->
      <template v-if="settingStore.settings.fileTreePinnedSection !== false && noteStore.allPinnedNotes.length">
        <div
          class="tree-row pinned-head"
          @click="togglePinned"
        >
          <span class="row-toggle">
            <i class="i-mdi-chevron-right" :class="{ expanded: pinnedExpanded }"></i>
          </span>
          <i class="i-mdi-star row-icon"></i>
          <span class="row-label">{{ $t('fileTree.pinnedSection') }}</span>
          <span class="row-count">{{ noteStore.allPinnedNotes.length }}</span>
        </div>
        <template v-if="pinnedExpanded">
          <div
            v-for="note in noteStore.allPinnedNotes"
            :key="`pinned:${note.id}`"
            class="tree-row note-row pinned-note-row"
            :class="{ active: note.id === noteStore.currentNoteId, dragging: dragNoteId === note.id }"
            :data-pinned-note-id="note.id"
            :title="`${noteLabel(note)}\n${noteDirLabel(note)}`"
            @click="openNote(note)"
            @contextmenu="openContextMenu($event, { type: 'note', note })"
            @pointerdown="beginDrag($event, 'note', note.id, noteLabel(note))"
          >
            <span class="row-toggle placeholder"></span>
            <i class="i-mdi-file-document-outline row-icon" :style="rowColorStyle(note.color)"></i>
            <span class="row-label" :style="rowColorStyle(note.color)">{{ noteLabel(note) }}</span>
            <i
              v-if="desktopNotes.isOnDesktop(note.id)"
              class="i-mdi-pin note-desktop-icon active"
              :title="$t('titlebar.desktopNoteOn')"
              @click.stop="desktopNotes.toggle(note.id)"
            ></i>
            <i
              class="i-mdi-star note-pin"
              :title="$t('fileTree.unpin')"
              @click.stop="noteStore.togglePin(note.id)"
            ></i>
            <i v-if="note.isLocked" class="i-mdi-lock note-lock"></i>
          </div>
        </template>
        <div class="pinned-divider"></div>
      </template>

      <!-- 根节点 -->
      <div
        class="tree-row root-row"
        :class="{ 'drop-into': dragOverRoot }"
        data-root-drop="true"
        @click="toggleRoot"
        @contextmenu="openContextMenu($event, { type: 'root' })"
      >
        <span class="row-toggle">
          <i class="i-mdi-chevron-right" :class="{ expanded: rootExpanded }"></i>
        </span>
        <i class="i-mdi-notebook-outline row-icon" :style="rowColorStyle(directoryStore.rootDirColor)"></i>
        <span class="row-label" :style="rowColorStyle(directoryStore.rootDirColor)">{{ $t('dirTree.rootDir') }}</span>
        <span class="row-count">{{ rootNoteCount || '' }}</span>
        <span class="row-actions" @click.stop>
          <i class="i-mdi-plus" :title="$t('fileTree.newNote')" @click.stop="createNoteIn(null)"></i>
        </span>
      </div>

      <template v-for="row in rows" :key="row.key">
        <!-- 新建目录输入框 -->
        <div v-if="row.type === 'input'" class="tree-row input-row" :style="{ paddingLeft: indent(row.depth) }">
          <i class="i-mdi-folder-outline row-icon muted"></i>
          <input
            :ref="setNewDirInput"
            v-model="newDirName"
            class="row-input"
            :placeholder="$t('dirTree.newDirPlaceholder')"
            @keydown.enter="confirmCreate"
            @keydown.esc="cancelCreate"
            @blur="confirmCreate"
          />
        </div>

        <!-- 目录 -->
        <div
          v-else-if="row.type === 'dir'"
          class="tree-row dir-row"
          :class="{
            'is-current': isCurrentDir(row.dir.id),
            dragging: dragDirId === row.dir.id,
            'drop-before': dragOverDirId === row.dir.id && dragOverPos === 'before',
            'drop-after': dragOverDirId === row.dir.id && dragOverPos === 'after',
            'drop-into': dragOverDirId === row.dir.id && dragOverPos === 'into',
          }"
          :style="{ paddingLeft: indent(row.depth) }"
          :data-dir-id="row.dir.id"
          @click="toggleDir(row.dir.id)"
          @contextmenu="openContextMenu($event, { type: 'dir', dir: row.dir })"
          @pointerdown="beginDrag($event, 'dir', row.dir.id, row.dir.name)"
        >
          <span class="row-toggle">
            <i class="i-mdi-chevron-right" :class="{ expanded: isExpanded(row.dir.id) }"></i>
          </span>
          <i
            class="row-icon"
            :style="rowColorStyle(row.dir.color)"
            :class="isExpanded(row.dir.id) ? 'i-mdi-folder-open-outline' : 'i-mdi-folder-outline'"
          ></i>
          <input
            v-if="renamingId === row.dir.id"
            :ref="setRenameInput"
            v-model="renameValue"
            class="row-input"
            @click.stop
            @keydown.enter="confirmRename"
            @keydown.esc="cancelRename"
            @blur="confirmRename"
          />
          <template v-else>
            <span
              class="row-label"
              :style="rowColorStyle(row.dir.color)"
              :title="row.dir.name"
              @dblclick.stop="startRename(row.dir)"
            >
              {{ row.dir.name }}
            </span>
            <span class="row-count">{{ dirNoteCount(row.dir.id) || '' }}</span>
            <span class="row-actions" @click.stop>
              <i class="i-mdi-plus" :title="$t('fileTree.newNoteHere')" @click.stop="createNoteIn(row.dir.id)"></i>
              <i class="i-mdi-folder-plus-outline" :title="$t('dirTree.newSubdir')" @click.stop="startCreate(row.dir.id)"></i>
            </span>
          </template>
        </div>

        <!-- 笔记 -->
        <div
          v-else
          class="tree-row note-row"
          :class="{
            active: row.note.id === noteStore.currentNoteId,
            dragging: dragNoteId === row.note.id,
            'drop-before': dragOverNoteId === row.note.id && dragOverPos === 'before',
            'drop-after': dragOverNoteId === row.note.id && dragOverPos === 'after',
          }"
          :style="{ paddingLeft: indent(row.depth) }"
          :data-note-id="row.note.id"
          @click="openNote(row.note)"
          @contextmenu="openContextMenu($event, { type: 'note', note: row.note })"
          @pointerdown="beginDrag($event, 'note', row.note.id, noteLabel(row.note))"
        >
          <span class="row-toggle placeholder"></span>
          <i class="i-mdi-file-document-outline row-icon" :style="rowColorStyle(row.note.color)"></i>
          <span class="row-label" :title="noteLabel(row.note)" :style="rowColorStyle(row.note.color)">{{ noteLabel(row.note) }}</span>
          <i
            v-if="desktopNotes.isOnDesktop(row.note.id)"
            class="i-mdi-pin note-desktop-icon active"
            :title="$t('titlebar.desktopNoteOn')"
            @click.stop="desktopNotes.toggle(row.note.id)"
          ></i>
          <i
            v-if="row.note.isPinned"
            class="i-mdi-star note-pin"
            :title="$t('fileTree.unpin')"
            @click.stop="noteStore.togglePin(row.note.id)"
          ></i>
          <i v-if="row.note.isLocked" class="i-mdi-lock note-lock"></i>
        </div>
      </template>

      <div v-if="rootExpanded && !hasContent" class="tree-empty">{{ $t('notelist.empty') }}</div>

      <!-- 磁盘残留：metadata 里已经没有、但磁盘上还留着的文件 -->
      <div
        v-if="noteStore.orphanFiles.length || orphansExpanded"
        class="tree-row trash-row"
        @click="toggleOrphans"
        @contextmenu="openContextMenu($event, { type: 'orphans' })"
      >
        <span class="row-toggle">
          <i class="i-mdi-chevron-right" :class="{ expanded: orphansExpanded }"></i>
        </span>
        <i class="i-mdi-database-alert-outline row-icon"></i>
        <span class="row-label">{{ $t('trash.diskLeftovers') }}</span>
        <span class="row-count">{{ noteStore.orphanFiles.length }}</span>
      </div>

      <template v-if="noteStore.orphanFiles.length && orphansExpanded">
        <div
          v-for="file in noteStore.orphanFiles"
          :key="`orphan:${file.path}`"
          class="tree-row note-row trash-note-row orphan-row"
          :style="{ paddingLeft: indent(2) }"
          :title="`${file.path}\n${orphanTime(file)} · ${orphanSize(file)}`"
          @contextmenu="openContextMenu($event, { type: 'orphanFile', file })"
        >
          <span class="row-toggle placeholder"></span>
          <i class="i-mdi-file-document-outline row-icon"></i>
          <span class="row-label">{{ file.fileName }}</span>
          <button
            class="orphan-action"
            :title="$t('trash.orphanRestore')"
            @click.stop="restoreOrphan(file)"
          >
            <i class="i-mdi-restore"></i>
          </button>
          <button
            class="orphan-action"
            :title="$t('trash.orphanTrash')"
            @click.stop="trashOrphan(file)"
          >
            <i class="i-mdi-trash-can-outline"></i>
          </button>
        </div>
        <div v-if="!noteStore.orphanFiles.length" class="tree-empty small">
          {{ $t('trash.diskLeftoversEmpty') }}
        </div>
      </template>
    </div>

    <!-- 回收站浮层：从侧栏底部往上弹出，不混进文件树 -->
    <Transition name="trash-pop">
      <div v-if="trashExpanded" class="trash-pop" @contextmenu.stop>
        <div class="trash-pop-head">
          <button
            class="trash-pop-empty"
            :class="{ disabled: !noteStore.trashedNotes.length }"
            :title="$t('trash.empty')"
            @click.stop="emptyTrashAll"
          >
            <i class="i-mdi-trash-can-outline"></i>
          </button>
          <span class="trash-pop-title">{{ $t('fileTree.trash') }}</span>
          <span class="trash-pop-count">{{ noteStore.trashedNotes.length }}</span>
          <button class="trash-pop-close" :title="$t('trash.hidePanel')" @click.stop="toggleTrash">
            <i class="i-mdi-chevron-down"></i>
            <span>{{ $t('trash.hidePanel') }}</span>
          </button>
        </div>
        <div class="trash-pop-body">
          <div
            v-for="trashed in noteStore.trashedNotes"
            :key="`trash:${trashed.id}`"
            class="trash-pop-row"
            :title="noteLabel(trashed)"
            @click="openTrashPreview(trashed)"
            @contextmenu="openContextMenu($event, { type: 'trashNote', note: trashed })"
          >
            <i class="i-mdi-file-document-outline"></i>
            <span class="trash-pop-label">{{ noteLabel(trashed) }}</span>
          </div>
          <div v-if="!noteStore.trashedNotes.length" class="tree-empty small">
            {{ $t('trash.emptyState') }}
          </div>
        </div>
      </div>
    </Transition>

    <footer class="tree-foot">
      <button
        class="foot-btn trash-foot-btn"
        :class="{ expanded: trashExpanded }"
        @click="toggleTrash"
        @contextmenu="openContextMenu($event, { type: 'trash' })"
      >
        <i class="i-mdi-trash-can-outline"></i>
        <span>{{ $t('fileTree.trash') }}</span>
        <span class="foot-count">{{ noteStore.trashedNotes.length || '' }}</span>
        <i class="i-mdi-chevron-right foot-chevron" :class="{ expanded: trashExpanded }"></i>
      </button>
    </footer>

    <div class="resize-handle" @pointerdown.prevent="startResize"></div>

    <!-- 回收站内容预览 -->
    <div v-if="trashPreview" class="trash-preview-overlay" @click.self="closeTrashPreview">
      <div class="trash-preview">
        <header class="tp-head">
          <div class="tp-title-wrap">
            <span class="tp-title">{{ noteLabel(trashPreview) }}</span>
            <span class="tp-meta">{{ $t('fileTree.trashDeletedAt') }} {{ trashDeletedAt(trashPreview) }}</span>
          </div>
          <button class="tp-close" :title="$t('titlebar.close')" @click="closeTrashPreview">
            <i class="i-mdi-close"></i>
          </button>
        </header>
        <pre class="tp-body">{{ trashPreview.content || '—' }}</pre>
        <footer class="tp-foot">
          <button class="tp-btn" @click="restorePreviewing">
            <i class="i-mdi-restore"></i>
            <span>{{ $t('trash.restore') }}</span>
          </button>
          <button class="tp-btn danger" @click="purgePreviewing">
            <i class="i-mdi-delete-forever-outline"></i>
            <span>{{ $t('trash.delete') }}</span>
          </button>
        </footer>
      </div>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="ctxMenu"
      class="tree-ctx-menu"
      :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
      @contextmenu.prevent
    >
      <template v-if="ctxTarget?.type === 'root'">
        <button class="ctx-item" @click="ctxNewNote">
          <i class="i-mdi-file-plus-outline"></i>
          <span>{{ $t('fileTree.newNote') }}</span>
        </button>
        <button class="ctx-item" @click="ctxNewRootDir">
          <i class="i-mdi-folder-plus-outline"></i>
          <span>{{ $t('dirTree.newDir') }}</span>
        </button>
        <button class="ctx-item" @click="ctxRootDirColor">
          <i class="i-mdi-palette-outline"></i>
          <span>{{ $t('fileTree.color') }}</span>
        </button>
      </template>

      <template v-else-if="ctxTarget?.type === 'blank'">
        <button class="ctx-item" @click="ctxNewBlankNote">
          <i class="i-mdi-file-plus-outline"></i>
          <span>{{ $t('fileTree.newNote') }}</span>
        </button>
        <button class="ctx-item" @click="ctxNewRootDir">
          <i class="i-mdi-folder-plus-outline"></i>
          <span>{{ $t('dirTree.newDir') }}</span>
        </button>
      </template>

      <template v-else-if="ctxDir">
        <button class="ctx-item" @click="ctxNewNote">
          <i class="i-mdi-file-plus-outline"></i>
          <span>{{ $t('fileTree.newNote') }}</span>
        </button>
        <button class="ctx-item" @click="ctxNewSubdir">
          <i class="i-mdi-folder-plus-outline"></i>
          <span>{{ $t('dirTree.newSubdir') }}</span>
        </button>
        <button class="ctx-item" @click="ctxRenameDir">
          <i class="i-mdi-pencil-outline"></i>
          <span>{{ $t('dirTree.rename') }}</span>
        </button>
        <button class="ctx-item" @click="ctxDirColor">
          <i class="i-mdi-palette-outline"></i>
          <span>{{ $t('fileTree.color') }}</span>
        </button>
        <div class="ctx-sep"></div>
        <button class="ctx-item danger" @click="ctxDeleteDir">
          <i class="i-mdi-trash-can-outline"></i>
          <span>{{ $t('fileTree.deleteDir') }}</span>
        </button>
      </template>

      <template v-else-if="ctxTarget?.type === 'trash'">
        <button class="ctx-item" :class="{ disabled: !noteStore.trashedNotes.length }" @click="ctxEmptyTrash">
          <i class="i-mdi-delete-sweep-outline"></i>
          <span>{{ $t('trash.empty') }}</span>
        </button>
        <div class="ctx-sep"></div>
        <button class="ctx-item" @click="ctxRescanOrphans">
          <i class="i-mdi-database-search-outline"></i>
          <span>{{ $t('trash.orphanRescan') }}</span>
        </button>
      </template>

      <template v-else-if="ctxTrashNote">
        <button class="ctx-item" @click="ctxOpenTrashNote">
          <i class="i-mdi-text-box-search-outline"></i>
          <span>{{ $t('fileTree.trashView') }}</span>
        </button>
        <button class="ctx-item" @click="ctxRestoreTrashNote">
          <i class="i-mdi-restore"></i>
          <span>{{ $t('trash.restore') }}</span>
        </button>
        <div class="ctx-sep"></div>
        <button class="ctx-item danger" @click="ctxPurgeTrashNote">
          <i class="i-mdi-delete-forever-outline"></i>
          <span>{{ $t('trash.delete') }}</span>
        </button>
      </template>

      <template v-else-if="ctxTarget?.type === 'orphans'">
        <button class="ctx-item" :class="{ disabled: !noteStore.orphanFiles.length }" @click="ctxTrashAllOrphans">
          <i class="i-mdi-delete-sweep-outline"></i>
          <span>{{ $t('trash.orphanTrashAll') }}</span>
        </button>
        <div class="ctx-sep"></div>
        <button class="ctx-item" @click="ctxRescanOrphans">
          <i class="i-mdi-refresh"></i>
          <span>{{ $t('trash.orphanRescan') }}</span>
        </button>
      </template>

      <template v-else-if="ctxOrphanFile">
        <button class="ctx-item" @click="ctxRestoreOrphan">
          <i class="i-mdi-restore"></i>
          <span>{{ $t('trash.orphanRestore') }}</span>
        </button>
        <div class="ctx-sep"></div>
        <button class="ctx-item danger" @click="ctxTrashOrphan">
          <i class="i-mdi-trash-can-outline"></i>
          <span>{{ $t('trash.orphanTrash') }}</span>
        </button>
      </template>

      <template v-else-if="ctxNote">
        <button class="ctx-item" @click="ctxTogglePin">
          <i :class="ctxNote.isPinned ? 'i-mdi-star' : 'i-mdi-star-outline'"></i>
          <span>{{ ctxNote.isPinned ? $t('fileTree.unpin') : $t('fileTree.pin') }}</span>
        </button>
        <button class="ctx-item" @click="ctxToggleDesktop">
          <i :class="desktopNotes.isOnDesktop(ctxNote.id) ? 'i-mdi-pin' : 'i-mdi-pin-outline'"></i>
          <span>{{ desktopNotes.isOnDesktop(ctxNote.id) ? $t('titlebar.desktopNoteOn') : $t('notelist.desktop') }}</span>
        </button>
        <button v-if="ctxNote.directoryId" class="ctx-item" @click="ctxMoveToRoot">
          <i class="i-mdi-folder-move-outline"></i>
          <span>{{ $t('fileTree.moveToRoot') }}</span>
        </button>
        <button class="ctx-item" @click="ctxNoteColor">
          <i class="i-mdi-palette-outline"></i>
          <span>{{ $t('fileTree.color') }}</span>
        </button>
        <div class="ctx-sep"></div>
        <button class="ctx-item danger" :class="{ disabled: ctxNote.isLocked }" @click="ctxDeleteNote">
          <i class="i-mdi-trash-can-outline"></i>
          <span>{{ $t('fileTree.deleteNote') }}</span>
        </button>
      </template>
    </div>

    <!-- 颜色选择弹层 -->
    <div
      v-if="colorPop"
      class="tree-color-pop"
      :style="{ left: `${colorPop.x}px`, top: `${colorPop.y}px` }"
      @click.stop
      @contextmenu.prevent
    >
      <NoteColorPicker
        :model-value="colorPopValue"
        :colors="treeColors"
        :heading="$t('fileTree.colorTitle')"
        @update:model-value="applyTreeColor"
        @close="closeColorPop"
      />
    </div>

    <!-- 拖拽时跟随指针的小标签 -->
    <Teleport to="body">
      <div
        v-if="dragGhost"
        class="drag-ghost"
        :class="{ 'is-dir': dragGhost.isDir }"
        :style="{ left: `${dragGhost.x}px`, top: `${dragGhost.y}px` }"
      >
        <i :class="dragGhost.isDir ? 'i-mdi-folder-outline' : 'i-mdi-file-document-outline'"></i>
        <span>{{ dragGhost.label }}</span>
      </div>
    </Teleport>
  </aside>
</template>

<style scoped>
/* 悬浮圆角卡片：四周留白 + 圆角 + 细描边 + 轻阴影，不再贴边到底
   注意：这里不能加 backdrop-filter / overflow:hidden —— 会给内部 position:fixed 的
   右键菜单与回收站预览造 containing block 并裁切它们 */
.file-tree {
  position: relative;
  flex-shrink: 0;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  /* 与顶栏同一套几何：左边距 10px、圆角 12px、细描边保持一致 */
  margin: 8px 0 10px 10px;
  border-radius: 12px;
  /* 面板自己一套底色（--side-panel-bg，亮/暗各一版），和笔记纸面同色系但不同色，
     靠这层中性面板浮在笔记底色上；窗口留白仍跟笔记同色 */
  background: var(--side-panel-bg);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-md);
  min-height: 0;
  user-select: none;
  -webkit-user-select: none;
}

.file-tree.resizing {
  cursor: col-resize;
}

/* 顶部 */
.tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 6px 0 14px;
  flex-shrink: 0;
}

.tree-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: calc(11px * var(--tree-fs-scale, 1));
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--tree-root) 55%, var(--color-text-secondary));
}

/* Logo 取代原来的小圆点，尺寸跟随字号缩放 */
.tree-heading :deep(.note-logo) {
  width: calc(16px * var(--tree-fs-scale, 1));
  height: auto;
}

.tree-heading-text {
  line-height: 1;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: calc(24px * var(--tree-fs-scale, 1));
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.icon-btn i {
  font-size: calc(15px * var(--tree-fs-scale, 1));
}

.icon-btn:hover {
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  color: var(--color-text);
}

/* 树区域 */
.file-tree {
  --tree-root: #6366f1;
  --tree-folder: #f59e0b;
  --tree-note: #0ea5e9;
  --tree-trash: #f43f5e;
  --tree-orphan: #f97316;
}

:global(html[data-theme='dark']) .file-tree {
  --tree-root: #a78bfa;
  --tree-folder: #fbbf24;
  --tree-note: #38bdf8;
  --tree-trash: #fb7185;
  --tree-orphan: #fb923c;
}

.tree-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 2px 6px 8px;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: calc(24px * var(--tree-fs-scale, 1));
  padding-right: 6px;
  border-radius: 5px;
  cursor: pointer;
  font-size: calc(12.5px * var(--tree-fs-scale, 1));
  line-height: calc(24px * var(--tree-fs-scale, 1));
  color: var(--color-text);
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.tree-row:hover {
  background: color-mix(in srgb, var(--color-primary) 9%, transparent);
}

.tree-row.active {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--color-primary) 22%, transparent),
    color-mix(in srgb, var(--tree-note) 14%, transparent)
  );
  box-shadow: inset 2px 0 0 var(--color-primary);
}

.tree-row.active .row-label {
  color: var(--color-primary);
  font-weight: 600;
}

/* 各类节点用彩色图标，别一片灰 */
.root-row .row-icon {
  color: var(--tree-root);
}

.root-row .row-label {
  color: color-mix(in srgb, var(--tree-root) 70%, var(--color-text));
}

.dir-row .row-icon {
  color: var(--tree-folder);
}

.dir-row.is-current .row-label {
  color: var(--color-primary);
}

.note-row .row-icon {
  color: var(--tree-note);
}

.trash-row .row-icon {
  color: var(--tree-orphan);
}

.trash-row .row-label {
  color: color-mix(in srgb, var(--tree-orphan) 60%, var(--color-text));
}

.orphan-row .row-icon {
  color: var(--tree-orphan);
}

.note-lock {
  color: var(--tree-folder) !important;
}

.note-pin {
  flex-shrink: 0;
  font-size: calc(12px * var(--tree-fs-scale, 1));
  color: var(--color-primary);
  cursor: pointer;
  opacity: 0.9;
}

.note-pin:hover {
  opacity: 1;
  transform: scale(1.08);
}

/* 钉到桌面：只有已经在桌面上的笔记才显示这个图标（点一下收起） */
.note-desktop-icon {
  flex-shrink: 0;
  font-size: calc(12.5px * var(--tree-fs-scale, 1));
  cursor: pointer;
  opacity: 1;
  transition: opacity 0.14s ease, color 0.14s ease, transform 0.14s ease;
}

.note-desktop-icon:hover {
  opacity: 1;
  color: var(--color-primary);
  transform: scale(1.08);
}

.note-desktop-icon.active {
  opacity: 1;
  color: var(--color-primary);
}

.row-count {
  flex-shrink: 0;
  padding: 0 5px;
  font-size: calc(10px * var(--tree-fs-scale, 1));
  line-height: calc(14px * var(--tree-fs-scale, 1));
  border-radius: 999px;
  color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
}

.dir-row .row-count {
  color: var(--tree-folder);
  background: color-mix(in srgb, var(--tree-folder) 18%, transparent);
}

.root-row .row-count {
  color: var(--tree-root);
  background: color-mix(in srgb, var(--tree-root) 18%, transparent);
}

.trash-row .row-count {
  color: var(--tree-orphan);
  background: color-mix(in srgb, var(--tree-orphan) 18%, transparent);
}

/* 收藏区 */
.pinned-head .row-icon {
  color: var(--color-primary);
}

.pinned-head .row-label {
  color: color-mix(in srgb, var(--color-primary) 60%, var(--color-text));
  font-weight: 500;
}

.pinned-head .row-count {
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 16%, transparent);
}

.pinned-note-row .row-label {
  color: color-mix(in srgb, var(--color-text) 88%, var(--color-primary));
}

.pinned-divider {
  height: 1px;
  margin: 4px 6px 6px;
  background: color-mix(in srgb, var(--color-border) 90%, transparent);
}

.tree-row.is-current .row-label {
  font-weight: 500;
}

.root-row .row-label {
  font-weight: 500;
}

.row-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: calc(14px * var(--tree-fs-scale, 1));
  flex-shrink: 0;
}

.row-toggle.placeholder {
  visibility: hidden;
}

.row-toggle i {
  font-size: calc(13px * var(--tree-fs-scale, 1));
  color: var(--color-text-secondary);
  transition: transform var(--duration-fast) var(--ease-out);
}

.row-toggle i.expanded {
  transform: rotate(90deg);
}

.dir-row .row-toggle i {
  color: color-mix(in srgb, var(--tree-folder) 60%, var(--color-text-secondary));
}

.root-row .row-toggle i {
  color: color-mix(in srgb, var(--tree-root) 60%, var(--color-text-secondary));
}

.row-icon {
  font-size: calc(14px * var(--tree-fs-scale, 1));
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.row-icon.muted {
  opacity: 0.5;
}

.row-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 拖拽排序：目录同级排序 + 笔记同级排序 / 拖进目录 */
.dir-row.dragging {
  opacity: 0.45;
}

.dir-row.drop-before {
  box-shadow: inset 0 2px 0 var(--color-primary);
}

.dir-row.drop-into,
.root-row.drop-into {
  background: color-mix(in srgb, var(--color-primary) 16%, transparent);
  box-shadow: inset 0 0 0 1px var(--color-primary);
}

.dir-row.drop-into .row-label,
.root-row.drop-into .row-label {
  color: var(--color-primary);
  font-weight: 600;
}

.note-row.dragging {
  opacity: 0.45;
}

.dir-row.drop-after {
  box-shadow: inset 0 -2px 0 var(--color-primary);
}

.note-row.drop-before {
  box-shadow: inset 0 2px 0 var(--color-primary);
}

.note-row.drop-after {
  box-shadow: inset 0 -2px 0 var(--color-primary);
}

/* 拖拽时跟随指针的浮标（Teleport 到 body，样式靠 scoped 传递） */
.drag-ghost {
  position: fixed;
  z-index: 999;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 5px 10px;
  border-radius: 8px;
  font-size: calc(12px * var(--tree-fs-scale, 1));
  line-height: 1.3;
  color: var(--color-text);
  background: var(--color-popup-bg, var(--color-surface));
  border: 1px solid color-mix(in srgb, var(--color-primary) 45%, transparent);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22);
  pointer-events: none;
  transform: translate(10px, 10px) rotate(-1.5deg);
  opacity: 0.95;
}

.drag-ghost span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drag-ghost i {
  flex: 0 0 auto;
  font-size: calc(13px * var(--tree-fs-scale, 1));
  color: var(--color-primary);
}

.drag-ghost.is-dir i {
  color: #f59e0b;
}

.row-actions {
  display: none;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.tree-row:hover .row-actions {
  display: flex;
}

.row-actions i {
  font-size: calc(13px * var(--tree-fs-scale, 1));
  padding: 1px;
  border-radius: 4px;
  color: var(--color-text-secondary);
  opacity: 0.75;
}

.row-actions i:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--color-text-secondary) 18%, transparent);
  color: var(--color-text);
}

.note-lock {
  font-size: calc(11px * var(--tree-fs-scale, 1));
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.input-row {
  cursor: default;
}

.row-input {
  flex: 1;
  min-width: 0;
  height: calc(20px * var(--tree-fs-scale, 1));
  padding: 0 4px;
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  background: var(--color-background);
  color: var(--color-text);
  font-size: calc(12.5px * var(--tree-fs-scale, 1));
  outline: none;
}

.tree-empty {
  padding: 16px 12px;
  font-size: calc(12px * var(--tree-fs-scale, 1));
  color: var(--color-text-secondary);
  text-align: center;
}

/* 底部 */
.tree-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px 8px;
  border-top: 1px solid var(--color-border);
}

.foot-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  gap: 4px;
  height: calc(26px * var(--tree-fs-scale, 1));
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: calc(12px * var(--tree-fs-scale, 1));
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.foot-btn i {
  font-size: calc(14px * var(--tree-fs-scale, 1));
}

.foot-btn:hover {
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  color: var(--color-text);
}

/* 回收站浮层 */
.trash-pop {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 46px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  max-height: min(46vh, 420px);
  background: var(--color-popup-bg, var(--color-surface));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.trash-pop-head {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  padding: 7px 8px 6px 10px;
  border-bottom: 1px solid var(--color-border);
  font-size: calc(11px * var(--tree-fs-scale, 1));
  color: var(--color-text-secondary);
}

.trash-pop-head i {
  font-size: calc(13px * var(--tree-fs-scale, 1));
  color: var(--tree-trash);
}

/* 清空回收站：点图标触发，带二次确认 */
.trash-pop-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: calc(20px * var(--tree-fs-scale, 1));
  margin-left: -2px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.trash-pop-empty:hover {
  background: color-mix(in srgb, var(--tree-trash) 16%, transparent);
}

.trash-pop-empty.disabled {
  opacity: 0.35;
  cursor: default;
}

.trash-pop-empty.disabled:hover {
  background: transparent;
}

.trash-pop-title {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  color: var(--tree-trash);
}

.trash-pop-count {
  padding: 0 5px;
  font-size: calc(10px * var(--tree-fs-scale, 1));
  line-height: calc(14px * var(--tree-fs-scale, 1));
  border-radius: 999px;
  color: var(--tree-trash);
  background: color-mix(in srgb, var(--tree-trash) 16%, transparent);
  font-variant-numeric: tabular-nums;
}

.trash-pop-close {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: calc(18px * var(--tree-fs-scale, 1));
  padding: 0 6px 0 4px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tree-trash) 12%, transparent);
  color: var(--tree-trash);
  font-size: calc(10.5px * var(--tree-fs-scale, 1));
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.trash-pop-close i {
  font-size: calc(12px * var(--tree-fs-scale, 1));
}

.trash-pop-close:hover {
  background: color-mix(in srgb, var(--tree-trash) 22%, transparent);
}

.trash-pop-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 3px 4px 5px;
}

.trash-pop-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 7px;
  border-radius: 5px;
  font-size: calc(12.5px * var(--tree-fs-scale, 1));
  color: var(--color-text-secondary);
  cursor: pointer;
}

.trash-pop-row i {
  font-size: calc(13px * var(--tree-fs-scale, 1));
  flex-shrink: 0;
  color: var(--tree-trash);
}

.trash-pop-row:hover {
  background: color-mix(in srgb, var(--tree-trash) 12%, transparent);
  color: var(--color-text);
}

.trash-pop-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.trash-pop-enter-active,
.trash-pop-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}

.trash-pop-enter-from,
.trash-pop-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

/* 侧栏底部：回收站入口 */
.trash-foot-btn {
  justify-content: flex-start;
  padding: 0 8px;
  color: color-mix(in srgb, var(--tree-trash) 55%, var(--color-text-secondary));
}

.trash-foot-btn > i:first-child {
  color: var(--tree-trash);
}

.trash-foot-btn.expanded {
  background: color-mix(in srgb, var(--tree-trash) 14%, transparent);
  color: var(--tree-trash);
}

.foot-count {
  margin-left: auto;
  padding: 0 5px;
  font-size: calc(10px * var(--tree-fs-scale, 1));
  line-height: calc(14px * var(--tree-fs-scale, 1));
  border-radius: 999px;
  color: var(--tree-trash);
  background: color-mix(in srgb, var(--tree-trash) 16%, transparent);
  font-variant-numeric: tabular-nums;
}

.foot-btn .foot-chevron {
  font-size: calc(12px * var(--tree-fs-scale, 1));
  opacity: 0.55;
  transition: transform var(--duration-fast) var(--ease-out);
}

.foot-btn .foot-chevron.expanded {
  transform: rotate(90deg);
}

/* 拖拽调宽 */
.resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
  border-radius: 0 12px 12px 0;
}

.resize-handle:hover {
  background: color-mix(in srgb, var(--color-primary) 40%, transparent);
}

/* 右键菜单 */
.tree-ctx-menu {
  position: fixed;
  z-index: 300;
  min-width: 168px;
  padding: 4px;
  background: var(--color-popup-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: calc(26px * var(--tree-fs-scale, 1));
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text);
  font-size: calc(12.5px * var(--tree-fs-scale, 1));
  text-align: left;
  cursor: pointer;
}

.ctx-item i {
  font-size: calc(14px * var(--tree-fs-scale, 1));
  color: var(--color-text-secondary);
}

.ctx-item:hover {
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
}

.ctx-item.danger {
  color: #e5484d;
}

.ctx-item.danger i {
  color: #e5484d;
}

.ctx-item.danger:hover {
  background: color-mix(in srgb, #e5484d 14%, transparent);
}

.ctx-item.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.ctx-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--color-border);
}

/* 文件树颜色选择弹层 */
.tree-color-pop {
  position: fixed;
  z-index: 320;
}

/* 回收站 */
.trash-row {
  margin-top: 6px;
}

.trash-note-row .row-label {
  color: var(--color-text-secondary);
}

/* 磁盘残留文件行 */
.orphan-row .row-label {
  color: var(--color-text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: calc(11.5px * var(--tree-fs-scale, 1));
}

.orphan-action {
  display: none;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 20px;
  height: calc(20px * var(--tree-fs-scale, 1));
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-tertiary, var(--color-text-secondary));
  font-size: calc(13px * var(--tree-fs-scale, 1));
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.orphan-row:hover .orphan-action {
  display: inline-flex;
}

.orphan-action:hover {
  background: color-mix(in srgb, var(--tree-orphan) 16%, transparent);
  color: var(--tree-orphan);
}

.orphan-row .orphan-action:first-of-type {
  color: var(--color-success);
}

.tree-empty.small {
  padding: 8px 12px;
  font-size: calc(11.5px * var(--tree-fs-scale, 1));
}

/* 回收站内容预览 */
.trash-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, #000 26%, transparent);
}

.trash-preview {
  display: flex;
  flex-direction: column;
  width: min(520px, 86vw);
  max-height: 72vh;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.tp-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 12px 10px 14px;
  border-bottom: 1px solid var(--color-border);
}

.tp-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tp-title {
  font-size: calc(13px * var(--tree-fs-scale, 1));
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tp-meta {
  font-size: calc(11px * var(--tree-fs-scale, 1));
  color: var(--color-text-secondary);
}

.tp-close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: calc(22px * var(--tree-fs-scale, 1));
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.tp-close:hover {
  background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  color: var(--color-text);
}

.tp-body {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 12px 14px;
  overflow: auto;
  font-family: inherit;
  font-size: calc(12.5px * var(--tree-fs-scale, 1));
  line-height: 1.7;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
}

.tp-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--color-border);
}

.tp-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: calc(26px * var(--tree-fs-scale, 1));
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font-size: calc(12px * var(--tree-fs-scale, 1));
  cursor: pointer;
}

.tp-btn i {
  font-size: calc(14px * var(--tree-fs-scale, 1));
}

.tp-btn:hover {
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
}

.tp-btn.danger {
  color: #e5484d;
  border-color: color-mix(in srgb, #e5484d 45%, transparent);
}

.tp-btn.danger:hover {
  background: color-mix(in srgb, #e5484d 12%, transparent);
}
</style>
