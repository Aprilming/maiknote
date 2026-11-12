import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Note, NoteMetadata, NoteFileEntry } from '@/types/note'
import { useFileSystem } from '@/composables/useFileSystem'
import { useDirectoryStore } from '@/stores/directoryStore'
import { useSettingStore } from '@/stores/settingStore'
import { directoryRelPath, directoryIdFromRelPath, fileNameForTitle, sanitizePathSegment } from '@/utils/notePath'
import i18n from '@/i18n'

const TITLE_MAX_LENGTH = 50
const TITLE_SCAN_LINES = 20
/** metadata 版本：2 = 真实名字布局（目录按名字嵌套，笔记文件名为标题） */
const METADATA_VERSION = 2

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
}

/** 去掉一行的 Markdown / HTML 语法，只保留纯文本 */
function stripMarkdown(line: string): string {
  return line
    .replace(/^\s*(?:```|~~~).*$/, '')                   // 代码块围栏
    .replace(/<[^>]+>/g, '')                             // HTML 标签（含 <p><br></p> 空段落）
    .replace(/^\s*#{1,6}\s+/, '')                        // 标题
    .replace(/^\s*>+\s*/, '')                            // 引用
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')             // 无序 / 有序列表
    .replace(/^\s*\[[ xX]\]\s*/, '')                     // 任务列表
    .replace(/^\s*([-*_])(?:\s*\1){2,}\s*$/, '')         // 分隔线
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')           // 链接 / 图片，仅保留描述
    .replace(/(\*\*\*|\*\*|__|~~|==|`+)(.+?)\1/g, '$2')  // 粗体 / 斜体 / 删除线 / 高亮 / 行内代码
    .replace(/[*_`~]/g, '')                              // 未成对的残留标记
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')       // 转义字符
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/&#(?:8203|x200b);/gi, '')                  // 空行标记（零宽空格实体）
    .replace(/\u200b/g, '')                              // 残留的零宽空格
    .trim()
}

/** 从 Markdown 内容中提取标题：取首个有内容的行，去掉语法只留文字 */
export function extractTitle(content: string): string {
  for (const line of content.split('\n', TITLE_SCAN_LINES)) {
    const text = stripMarkdown(line)
    if (text) return text.substring(0, TITLE_MAX_LENGTH)
  }
  return 'Untitled'
}

export const useNoteStore = defineStore('note', () => {
  // File system
  const fs = useFileSystem()

  // ---- 真实名字布局：目录按名字嵌套，笔记文件名 = 标题 ----

  /** 目录 id → 磁盘相对路径，如 "工作/子目录"（根目录返回 undefined） */
  function dirRelPath(dirId?: string | null): string | undefined {
    if (!dirId) return undefined
    return directoryRelPath(useDirectoryStore().directories, dirId)
  }

  /** 反查：磁盘相对路径 → 目录 id */
  function dirIdFromRel(rel?: string | null): string | undefined {
    if (!rel) return undefined
    return directoryIdFromRelPath(useDirectoryStore().directories, rel)
  }

  /** 笔记在磁盘上的文件名（缺省按标题推） */
  function noteFile(note: { id: string; title: string; fileName?: string }): string {
    return note.fileName || fileNameForTitle(note.title)
  }

  function isFileNameTaken(dirId: string | null | undefined, fileName: string, exceptId?: string): boolean {
    const target = dirId ?? null
    return notes.value.some(
      n => n.id !== exceptId && (n.directoryId ?? null) === target && noteFile(n) === fileName
    )
  }

  /** 同目录重名时加序号：标题.md → 标题 2.md */
  function uniqueFileName(dirId: string | null | undefined, desired: string, exceptId?: string): string {
    if (!isFileNameTaken(dirId, desired, exceptId)) return desired
    const stem = desired.replace(/\.md$/i, '')
    let i = 2
    while (isFileNameTaken(dirId, `${stem} ${i}.md`, exceptId)) i++
    return `${stem} ${i}.md`
  }

  /** 把一条笔记的文件同步到磁盘：标题改名会顺手重命名文件 */
  async function syncNoteFileToDisk(note: Note): Promise<void> {
    const dir = dirRelPath(note.directoryId)
    const desired = uniqueFileName(note.directoryId, fileNameForTitle(note.title), note.id)
    if (note.fileName && note.fileName !== desired) {
      await fs.moveNoteFile(note.fileName, dir ?? null, dir ?? null, desired)
    }
    note.fileName = desired
    await fs.writeNote(desired, note.content, dir)
  }

  /**
   * 把正文里「产生标题的那一行」换成新名字，保留原有 Markdown 前缀（如 "# "、"1. "）
   * 这样文件名、标题、正文三处始终保持一致
   */
  function replaceTitleLine(content: string, title: string): string {
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      const prefix = line.match(/^[\s>]*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+|\[[ xX]\]\s+)?/)?.[0] ?? ''
      lines[i] = `${prefix}${title}`
      return lines.join('\n')
    }
    return content.trim() ? content : `${title}\n`
  }

  // State
  const notes = ref<Note[]>([])
  const currentNoteId = ref<string | null>(null)
  const searchQuery = ref('')
  const navigationHint = ref<{ message: string; visible: boolean }>({ message: '', visible: false })
  const isLoading = ref(false)
  const loadError = ref<Error | null>(null)
  const filterDirectoryId = ref<string | null>(null) // null = root 目录
  const deletingNoteId = ref<string | null>(null) // 正在播放删除动画的笔记 ID
  // 导航方向：由导航行为显式设置，编辑器直接绑定此值控制切换动画（上一条=left、下一条/新建=right）
  const navDirection = ref<'left' | 'right' | 'up' | 'down'>('right')

  // 监听 currentNoteId 变化，保存到 localStorage
  watch(currentNoteId, (newId) => {
    if (newId) {
      localStorage.setItem('lastOpenedNoteId', newId)
    }
  })

  // Getters
  const activeNotes = computed(() => notes.value.filter(n => !n.trashedAt))

  const trashedNotes = computed(() =>
    notes.value
      .filter(n => n.trashedAt && !isNoteEmpty(n))
      .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
  )

  const currentNote = computed(() =>
    activeNotes.value.find(n => n.id === currentNoteId.value) ?? null
  )

  const currentIndex = computed(() =>
    activeNotes.value.findIndex(n => n.id === currentNoteId.value)
  )

  /** 按 filterDirectoryId 过滤后的笔记列表（置顶的排在最前，和文件树顺序一致） */
  const activeNoteList = computed(() => {
    const list = filterDirectoryId.value === null
      ? activeNotes.value.filter(n => !n.directoryId)
      : activeNotes.value.filter(n => n.directoryId === filterDirectoryId.value)
    return list.slice().sort((a, b) => Number(b.isPinned) - Number(a.isPinned))
  })

  /** 当前笔记在 activeNoteList 中的索引 */
  const activeIndex = computed(() =>
    activeNoteList.value.findIndex(n => n.id === currentNoteId.value)
  )

  const filteredNotes = computed(() => {
    if (!searchQuery.value) return activeNotes.value
    const query = searchQuery.value.toLowerCase()
    return activeNotes.value.filter(n =>
      n.title.toLowerCase().includes(query) ||
      n.content.toLowerCase().includes(query)
    )
  })

  const pinnedNotes = computed(() =>
    activeNoteList.value.filter(n => n.isPinned)
  )

  const unpinnedNotes = computed(() =>
    activeNoteList.value.filter(n => !n.isPinned)
  )

  /**
   * 全部目录下的置顶笔记（不受 filterDirectoryId 影响）
   * 侧栏固顶区用它：不管当前在哪个目录、目录有没有展开，置顶的笔记都固定显示在侧栏顶部
   */
  const allPinnedNotes = computed(() =>
    activeNotes.value.filter(n => n.isPinned)
  )

  // Helper: Check if note is empty
  function isNoteEmpty(note: Note | null): boolean {
    if (!note) return false
    // 空行标记是零宽空格，trim() 不会去掉它，这里显式清掉再判断
    return !note.content || note.content.replace(/\u200b/g, '').trim() === ''
  }

  // Helper: Show navigation hint
  let hintTimeout: number | null = null
  function showHint(message: string) {
    if (hintTimeout) {
      clearTimeout(hintTimeout)
    }
    navigationHint.value = { message, visible: true }
    hintTimeout = setTimeout(() => {
      navigationHint.value = { message: '', visible: false }
    }, 2000)
  }

  // Helper: Shake window when at boundary
  function shakeWindow() {
    const el = document.getElementById('app')
    if (!el) return
    el.classList.remove('shake')
    // Force reflow to restart animation
    void el.offsetWidth
    el.classList.add('shake')
    setTimeout(() => el.classList.remove('shake'), 400)
  }

  // ============================================
  // iCloud Persistence Functions
  // ============================================

  // Debounced save state
  let saveTimeout: number | null = null
  const pendingSaveNotes = new Set<string>()
  let metadataSavePending = false

  /**
   * Schedule a save to iCloud (debounced)
   */
  function scheduleSave(note?: Note) {
    if (note) {
      pendingSaveNotes.add(note.id)
    } else {
      metadataSavePending = true
    }

    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }

    saveTimeout = setTimeout(async () => {
      // Save all pending notes
      const notesToSave = Array.from(pendingSaveNotes)
        .map(id => notes.value.find(n => n.id === id))
        .filter((n): n is Note => n !== undefined)

      for (const note of notesToSave) {
        try {
          await syncNoteFileToDisk(note)
        } catch (e) {
          console.error('Failed to save note to iCloud:', e)
        }
      }

      // Save metadata if any note changed or metadata explicitly requested
      if (notesToSave.length > 0 || metadataSavePending) {
        try {
          await saveMetadataToCloud()
        } catch (e) {
          console.error('Failed to save metadata to iCloud:', e)
        }
      }

      pendingSaveNotes.clear()
      metadataSavePending = false
      saveTimeout = null
    }, 500) as unknown as number
  }

  /**
   * 把老布局迁移成真实名字布局（只跑一次，metadata.version 做版本闸）
   * @returns 是否发生了迁移
   */
  async function migrateLayoutIfNeeded(metadata: NoteMetadata): Promise<boolean> {
    if ((metadata.version ?? 1) >= METADATA_VERSION) return false
    // 同目录重名要在这里就先算好，否则两个笔记会抢同一个文件名
    const taken = new Map<string, Set<string>>()
    const moves = metadata.notes.map((item) => {
      const toDir = dirRelPath(item.directoryId) ?? null
      const key = toDir ?? ''
      let set = taken.get(key)
      if (!set) {
        set = new Set<string>()
        taken.set(key, set)
      }
      let name = item.fileName ?? fileNameForTitle(item.title)
      const stem = name.replace(/\.md$/i, '')
      let i = 2
      while (set.has(name)) {
        name = `${stem} ${i}.md`
        i++
      }
      set.add(name)
      item.fileName = name
      return {
        id: item.id,
        fromDir: item.directoryId ?? null,
        toDir,
        toFileName: name,
      }
    })
    try {
      const count = await fs.migrateNoteLayout(moves)
      metadata.version = METADATA_VERSION
      // 空目录在磁盘上也要存在，访达里看到的树才和侧边栏一致
      const dirs = useDirectoryStore().directories
      for (const dir of dirs) {
        const rel = directoryRelPath(dirs, dir.id)
        if (rel) await fs.createDirectoryFolder(rel)
      }
      console.info(`[MaikNote] 笔记布局迁移完成：${count}/${moves.length} 个文件`)
      return true
    } catch (e) {
      console.error('Failed to migrate note layout:', e)
      return false
    }
  }

  /**
   * Load all notes from iCloud
   */
  async function loadNotes(): Promise<void> {
    if (isLoading.value) return

    isLoading.value = true
    loadError.value = null

    try {
      const metadata = await fs.readMetadata()

      // 老布局（note_<id>.md + 以目录 id 命名的扁平文件夹）一次性迁移成真实名字
      const migrated = await migrateLayoutIfNeeded(metadata)

      // Convert metadata items to full notes with empty content
      const loadedNotes: Note[] = []

      for (const item of metadata.notes) {
        // Read content from file (from directory if applicable)
        const fileName = item.fileName ?? fileNameForTitle(item.title)
        const content = await fs.readNote(fileName, dirRelPath(item.directoryId))

        loadedNotes.push({
          id: item.id,
          title: item.title,
          content,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          tags: item.tags,
          isPinned: item.isPinned,
          isLocked: item.isLocked,
          directoryId: item.directoryId,
          backgroundColor: item.backgroundColor,
          color: item.color,
          trashedAt: item.trashedAt,
          fileName,
        })
      }

      notes.value = loadedNotes

      // 迁移完成后把新的 metadata（含 fileName / 版本号）落盘
      if (migrated) {
        try {
          await saveMetadataToCloud()
        } catch (e) {
          console.error('Failed to persist migrated metadata:', e)
        }
      }

      // 恢复上次打开的笔记（确保在过滤后的列表中）
      const lastOpenedId = localStorage.getItem('lastOpenedNoteId')
      const active = activeNoteList.value
      if (lastOpenedId && active.some(n => n.id === lastOpenedId)) {
        currentNoteId.value = lastOpenedId
      } else if (active.length > 0) {
        currentNoteId.value = active[0].id
      } else {
        createNoteAtHead()
      }
    } catch (e) {
      loadError.value = e as Error
      console.error('Failed to load notes from iCloud:', e)
      // Create initial note on error
      createNoteAtHead()
    } finally {
      isLoading.value = false
    }

    // 启动后异步扫一遍磁盘，把 metadata 之外的残留文件找出来
    void scanOrphanFiles()
  }

  /**
   * Save metadata to iCloud (internal function)
   */
  async function saveMetadataToCloud(): Promise<void> {
    const metadata: NoteMetadata = {
      version: METADATA_VERSION,
      notes: notes.value.map((note) => ({
        id: note.id,
        title: note.title,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        tags: note.tags,
        isPinned: note.isPinned,
        isLocked: note.isLocked,
        directoryId: note.directoryId,
        backgroundColor: note.backgroundColor,
        color: note.color,
        trashedAt: note.trashedAt,
        fileName: noteFile(note),
      })),
    }

    await fs.writeMetadata(metadata)
  }

  /**
   * Save a single note to iCloud immediately (for new notes)
   */
  async function saveNoteToCloud(note: Note): Promise<void> {
    try {
      // Save content to file（目录 / 文件名都按真实名字）
      await syncNoteFileToDisk(note)

      // Update metadata
      await saveMetadataToCloud()
    } catch (e) {
      console.error('Failed to save note to iCloud:', e)
      throw e
    }
  }

  /**
   * 立即把某条笔记写盘（源码模式切换等场景，不等防抖）
   */
  async function persistNoteNow(id: string): Promise<void> {
    const note = notes.value.find(n => n.id === id)
    if (!note) return
    try {
      await syncNoteFileToDisk(note)
      await saveMetadataToCloud()
    } catch (e) {
      console.error('Failed to persist note now:', e)
    }
  }

  /**
   * 把笔记文件移入系统废纸篓（只处理文件，元数据由调用方在成功后再保存）
   */
  /**
   * 空笔记被丢弃时直接清掉磁盘文件：取消待写入任务，再把文件移入系统废纸篓。
   * 这样既不会留在「磁盘残留」里，也不会在回收站出现。
   */
  async function purgeNoteFile(note: Note): Promise<void> {
    pendingSaveNotes.delete(note.id)
    try {
      await fs.deleteNote(noteFile(note), dirRelPath(note.directoryId))
    } catch (e) {
      console.error('Failed to remove empty note file:', e)
    }
  }

  async function deleteNoteFromCloud(id: string): Promise<void> {
    const note = notes.value.find(n => n.id === id)
    if (!note) return
    await fs.deleteNote(noteFile(note), dirRelPath(note.directoryId))
  }

  // ============================================
  // Store Actions
  // ============================================

  function setNotes(newNotes: Note[]) {
    notes.value = newNotes
  }

  function selectNote(id: string) {
    // 侧边栏点击：按列表索引推断方向
    const active = activeNoteList.value
    const oldIdx = active.findIndex(n => n.id === currentNoteId.value)
    const newIdx = active.findIndex(n => n.id === id)
    if (oldIdx >= 0 && newIdx >= 0) {
      navDirection.value = newIdx > oldIdx ? 'right' : 'left'
    }
    currentNoteId.value = id
  }

  /**
   * 设置目录过滤，切换后自动选中该目录下第一篇笔记
   */
  function setFilterDirectory(id: string | null) {
    filterDirectoryId.value = id
    // 同步更新目录选中状态，触发 localStorage 持久化
    const directoryStore = useDirectoryStore()
    directoryStore.selectDirectory(id)
    // 确保当前笔记在过滤后的列表中
    const active = activeNoteList.value
    const hasCurrent = active.some(n => n.id === currentNoteId.value)
    if (!hasCurrent) {
      if (active.length > 0) {
        currentNoteId.value = active[0].id
      } else {
        // 目录为空时创建一篇新笔记
        createNoteAtHead()
      }
    }
  }

  /** 当前目录过滤下的 directoryId，新建笔记时使用 */
  function currentDirectoryId(): string | undefined {
    return filterDirectoryId.value ?? undefined
  }

  /** 设置里的「默认笔记背景色」，新建笔记时套用 */
  function defaultNoteBackgroundColor(): string | undefined {
    const color = useSettingStore().settings.defaultNoteBackgroundColor
    return color || undefined
  }

  async function createNoteAtHead(): Promise<Note> {
    const now = Date.now()
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: 'New Note',
      content: '',
      createdAt: now,
      updatedAt: now,
      isPinned: false,
      isLocked: false,
      directoryId: currentDirectoryId(),
      backgroundColor: defaultNoteBackgroundColor(),
    }
    notes.value.unshift(newNote)
    currentNoteId.value = newNote.id

    // Save to iCloud
    await saveNoteToCloud(newNote)

    return newNote
  }

  async function createNoteAtTail(): Promise<Note> {
    const now = Date.now()
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: 'New Note',
      content: '',
      createdAt: now,
      updatedAt: now,
      isPinned: false,
      isLocked: false,
      directoryId: currentDirectoryId(),
      backgroundColor: defaultNoteBackgroundColor(),
    }
    notes.value.push(newNote)
    navDirection.value = 'right'
    currentNoteId.value = newNote.id

    // Save to iCloud
    await saveNoteToCloud(newNote)

    return newNote
  }

  async function createNoteAfterCurrent(): Promise<Note> {
    const now = Date.now()
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: 'New Note',
      content: '',
      createdAt: now,
      updatedAt: now,
      isPinned: false,
      isLocked: false,
      directoryId: currentDirectoryId(),
      backgroundColor: defaultNoteBackgroundColor(),
    }

    // Find current note index directly to ensure accuracy
    const index = notes.value.findIndex(n => n.id === currentNoteId.value)

    if (index !== -1) {
      // Insert after current note
      notes.value.splice(index + 1, 0, newNote)
    } else {
      // No current note, add to end
      notes.value.push(newNote)
    }
    navDirection.value = 'right'
    currentNoteId.value = newNote.id

    // Save to iCloud
    await saveNoteToCloud(newNote)

    return newNote
  }

  async function createNoteBeforeCurrent(): Promise<Note> {
    const now = Date.now()
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: 'New Note',
      content: '',
      createdAt: now,
      updatedAt: now,
      isPinned: false,
      isLocked: false,
      directoryId: currentDirectoryId(),
      backgroundColor: defaultNoteBackgroundColor(),
    }

    // Find current note index directly to ensure accuracy
    const index = notes.value.findIndex(n => n.id === currentNoteId.value)

    if (index !== -1) {
      // Insert before current note
      notes.value.splice(index, 0, newNote)
    } else {
      // No current note, add to end
      notes.value.push(newNote)
    }
    navDirection.value = 'left'
    currentNoteId.value = newNote.id

    // Save to iCloud
    await saveNoteToCloud(newNote)

    return newNote
  }

  async function createNoteWithContent(title: string, content: string): Promise<Note> {
    const now = Date.now()
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: title,
      content: content,
      createdAt: now,
      updatedAt: now,
      isPinned: false,
      isLocked: false,
      directoryId: currentDirectoryId(),
      backgroundColor: defaultNoteBackgroundColor(),
    }

    // Insert after current note
    const currentIndex = notes.value.findIndex(n => n.id === currentNoteId.value)
    if (currentIndex !== -1) {
      notes.value.splice(currentIndex + 1, 0, newNote)
    } else {
      notes.value.push(newNote)
    }
    navDirection.value = 'right'
    currentNoteId.value = newNote.id

    // Save to iCloud
    await saveNoteToCloud(newNote)

    return newNote
  }

  function updateNote(id: string, updates: Partial<Omit<Note, 'id' | 'createdAt'>>) {
    const index = notes.value.findIndex(n => n.id === id)
    if (index !== -1) {
      const note = notes.value[index]
      // 原地更新字段而非替换数组元素，避免每次内容变化都触发所有依赖 notes 的计算属性重算
      Object.assign(note, updates, { updatedAt: Date.now() })
      // Update title if content changed
      if (updates.content) {
        note.title = extractTitle(updates.content)
      }

      // Schedule save to iCloud (debounced)
      scheduleSave(note)
    }
  }

  function setDeletingNoteId(id: string | null) {
    deletingNoteId.value = id
  }

  async function deleteNote(id: string) {
    const note = notes.value.find(n => n.id === id)
    if (note?.isLocked || note?.trashedAt) {
      return // Cannot delete locked note
    }
    if (note) {
      const oldActive = activeNoteList.value
      const oldActiveIndex = oldActive.findIndex(n => n.id === id)

      // 空笔记不进回收站：直接删掉文件和元数据
      if (isNoteEmpty(note)) {
        const index = notes.value.findIndex(n => n.id === id)
        if (index !== -1) notes.value.splice(index, 1)
        deletingNoteId.value = null
        if (currentNoteId.value === id) {
          const active = activeNoteList.value
          const newIndex = Math.min(Math.max(0, oldActiveIndex - 1), active.length - 1)
          navDirection.value = oldActiveIndex > 0 ? 'left' : 'right'
          currentNoteId.value = active[newIndex]?.id ?? null
        }
        await purgeNoteFile(note)
        await saveMetadataToCloud()
        return
      }

      note.trashedAt = Date.now()
      note.updatedAt = Date.now()
      note.isPinned = false
      deletingNoteId.value = null
      await saveMetadataToCloud()

      // If deleted note was current, select the previous note (or first if at index 0)
      if (currentNoteId.value === id) {
        const active = activeNoteList.value
        const newIndex = Math.min(Math.max(0, oldActiveIndex - 1), active.length - 1)
        // 被删除笔记已从 activeNoteList 移除，watch 反查 oldIndex 会得到 -1，需显式指定方向
        navDirection.value = oldActiveIndex > 0 ? 'left' : 'right'
        currentNoteId.value = active[newIndex]?.id ?? null
      }
    }
  }

  async function restoreNote(id: string): Promise<void> {
    const note = notes.value.find(n => n.id === id)
    if (!note?.trashedAt) return

    const directoryStore = useDirectoryStore()
    const fromRel = dirRelPath(note.directoryId) ?? null
    if (note.directoryId && !directoryStore.getDirectory(note.directoryId)) {
      note.directoryId = undefined
    }
    note.trashedAt = undefined
    note.updatedAt = Date.now()
    const toRel = dirRelPath(note.directoryId) ?? null
    if (fromRel !== toRel) {
      // 目录没了，把文件一起搬到现在的位置
      const fileName = noteFile(note)
      const desired = uniqueFileName(note.directoryId, fileName, note.id)
      await fs.moveNoteFile(fileName, fromRel, toRel, desired)
      note.fileName = desired
    }
    await saveMetadataToCloud()
  }

  /**
   * 彻底删除：把文件移入系统废纸篓，并移除元数据。
   * 文件移入失败时不动元数据（界面与磁盘保持一致），并提示用户。
   * @returns 是否删除成功
   */
  async function permanentlyDeleteNote(id: string): Promise<boolean> {
    const index = notes.value.findIndex(n => n.id === id)
    if (index === -1) return true

    try {
      await deleteNoteFromCloud(id)
    } catch (e) {
      console.error('Failed to move note to trash:', e)
      const msg = e instanceof Error ? e.message : String(e)
      showHint(i18n.global.t('trash.deleteFailed', { reason: msg }))
      return false
    }

    const currentIndex = notes.value.findIndex(n => n.id === id)
    if (currentIndex !== -1) {
      notes.value.splice(currentIndex, 1)
    }
    await saveMetadataToCloud()

    if (currentNoteId.value === id) {
      currentNoteId.value = activeNoteList.value[0]?.id ?? null
    }
    return true
  }

  async function emptyTrash(): Promise<void> {
    const ids = trashedNotes.value.map(n => n.id)
    let failed = 0
    for (const id of ids) {
      const ok = await permanentlyDeleteNote(id)
      if (!ok) failed++
    }
    if (failed > 0) {
      showHint(i18n.global.t('trash.emptyFailed', { count: failed }))
    } else if (ids.length > 0) {
      showHint(i18n.global.t('trash.emptyDone', { count: ids.length }))
      // 文件进了系统废纸篓，刷新残留列表
      await scanOrphanFiles()
    }
  }

  // ============================================
  // 磁盘残留文件：metadata 里已经没有，但磁盘上还留着 note_<id>.md
  // ============================================
  const orphanFiles = ref<NoteFileEntry[]>([])
  const orphanScanning = ref(false)

  async function scanOrphanFiles(notify = false): Promise<void> {
    orphanScanning.value = true
    try {
      const files = await fs.listNoteFiles()

      // metadata 里登记的「目录 + 文件名」就是正本，其余都是残留
      const known = new Set(notes.value.map(n => `${dirRelPath(n.directoryId) ?? ''}/${noteFile(n)}`))
      const candidates = files.filter(
        f => !known.has(`${f.dir ?? ''}/${f.fileName}`)
      )

      // 空文件（切换边界时自动建出来的空笔记）不算残留：顺手清掉，不显示在列表里
      const leftovers: NoteFileEntry[] = []
      for (const file of candidates) {
        if (file.size <= 16) {
          try {
            const content = await fs.readNote(file.fileName, file.dir ?? undefined)
            if (!content || content.replace(/\u200b/g, '').trim() === '') {
              await fs.trashFile(file.path)
              continue
            }
          } catch (e) {
            console.error('Failed to inspect leftover file:', e)
          }
        }
        leftovers.push(file)
      }
      orphanFiles.value = leftovers
      if (notify) {
        showHint(
          orphanFiles.value.length
            ? i18n.global.t('trash.orphanScanDone', { count: orphanFiles.value.length })
            : i18n.global.t('trash.diskLeftoversEmpty')
        )
      }
    } catch (e) {
      console.error('Failed to scan note files on disk:', e)
      orphanFiles.value = []
      if (notify) {
        const msg = e instanceof Error ? e.message : String(e)
        showHint(i18n.global.t('trash.orphanScanFailed', { reason: msg }))
      }
    } finally {
      orphanScanning.value = false
    }
  }

  /** 依据磁盘上的文件重建一条笔记对象（文件本身不动） */
  async function buildNoteFromFileEntry(entry: NoteFileEntry): Promise<Note> {
    const dirId = dirIdFromRel(entry.dir)
    const content = await fs.readNote(entry.fileName, entry.dir ?? undefined)
    const stamp = entry.modified ?? Date.now()
    return {
      id: crypto.randomUUID(),
      title: extractTitle(content),
      content,
      createdAt: stamp,
      updatedAt: stamp,
      isPinned: false,
      isLocked: false,
      directoryId: dirId,
      fileName: entry.fileName,
    }
  }

  /**
   * 把残留文件收进 App 回收站：补回 metadata 并标记 trashedAt，文件先留在原处，
   * 之后在回收站里可以还原，或再「删除」把它移入系统废纸篓。
   */
  async function trashOrphanFile(entry: NoteFileEntry): Promise<boolean> {
    try {
      const note = await buildNoteFromFileEntry(entry)
      const dup = notes.value.findIndex(n => n.id === note.id)
      if (dup !== -1) notes.value.splice(dup, 1)
      notes.value.unshift({ ...note, trashedAt: Date.now() })
      await saveMetadataToCloud()
      orphanFiles.value = orphanFiles.value.filter(f => f.path !== entry.path)
      return true
    } catch (e) {
      console.error('Failed to move orphan file to trash:', e)
      const msg = e instanceof Error ? e.message : String(e)
      showHint(i18n.global.t('trash.restoreFailed', { reason: msg }))
      return false
    }
  }

  /** 一键把所有残留文件收进回收站 */
  async function trashAllOrphanFiles(): Promise<void> {
    const list = [...orphanFiles.value]
    let failed = 0
    let done = 0
    for (const entry of list) {
      const ok = await trashOrphanFile(entry)
      if (ok) done++
      else failed++
    }
    if (failed > 0) {
      showHint(i18n.global.t('trash.emptyFailed', { count: failed }))
    } else if (done > 0) {
      showHint(i18n.global.t('trash.orphanTrashDone', { count: done }))
    }
  }

  /** 把残留文件恢复成笔记（文件已在磁盘上，只需补回元数据） */
  async function restoreOrphanFile(entry: NoteFileEntry): Promise<void> {
    try {
      const restored = await buildNoteFromFileEntry(entry)
      const dup = notes.value.findIndex(n => n.id === restored.id)
      if (dup !== -1) notes.value.splice(dup, 1)
      notes.value.unshift(restored)
      await saveMetadataToCloud()
      orphanFiles.value = orphanFiles.value.filter(f => f.path !== entry.path)
      currentNoteId.value = restored.id
    } catch (e) {
      console.error('Failed to restore orphan file:', e)
      const msg = e instanceof Error ? e.message : String(e)
      showHint(i18n.global.t('trash.restoreFailed', { reason: msg }))
    }
  }

  function togglePin(id: string) {
    const note = notes.value.find(n => n.id === id)
    if (note) {
      note.isPinned = !note.isPinned
      note.updatedAt = Date.now()

      // Schedule metadata save to iCloud (debounced)
      scheduleSave() // Will save metadata
    }
  }

  async function toggleLock(id: string) {
    const note = notes.value.find(n => n.id === id)
    if (note) {
      note.isLocked = !note.isLocked
      note.updatedAt = Date.now()

      // Set file permission based on lock state
      if (note.isLocked) {
        await fs.setNoteReadonly(noteFile(note), dirRelPath(note.directoryId))
      } else {
        await fs.setNoteReadwrite(noteFile(note), dirRelPath(note.directoryId))
      }

      // Schedule metadata save to iCloud (debounced)
      scheduleSave() // Will save metadata
    }
  }

  function selectPrev() {
    const active = activeNoteList.value
    const idx = active.findIndex(n => n.id === currentNoteId.value)
    if (idx > 0) {
      navDirection.value = 'left'
      currentNoteId.value = active[idx - 1].id
    }
  }

  function selectNext() {
    const active = activeNoteList.value
    const idx = active.findIndex(n => n.id === currentNoteId.value)
    if (idx < active.length - 1) {
      navDirection.value = 'right'
      currentNoteId.value = active[idx + 1].id
    }
  }

  // Navigate to previous note
  async function navigatePrevOrCreate() {
    const active = activeNoteList.value
    const activeIdx = active.findIndex(n => n.id === currentNoteId.value)
    const isEmpty = currentNote.value && isNoteEmpty(currentNote.value)

    // At first position - show hint, don't navigate
    if (activeIdx === 0) {
      shakeWindow()
      showHint(i18n.global.t('nav.firstNote'))
      return
    }

    // Current note is empty - delete it and navigate to previous
    if (isEmpty) {
      const noteToDelete = currentNote.value!
      const idToDelete = noteToDelete.id
      const realIndex = notes.value.findIndex(n => n.id === idToDelete)
      if (realIndex !== -1) notes.value.splice(realIndex, 1)
      // 空笔记已从列表移除，watch 无法反查其索引，显式指定向上一条切换的方向
      navDirection.value = 'left'
      currentNoteId.value = active[activeIdx - 1].id

      // 空笔记直接清掉磁盘文件，不留残余
      await purgeNoteFile(noteToDelete)
      await saveMetadataToCloud()
    } else {
      // Navigate to previous note
      navDirection.value = 'left'
      currentNoteId.value = active[activeIdx - 1].id
    }
  }

  // Navigate to next note
  async function navigateNextOrCreate() {
    const active = activeNoteList.value
    const activeIdx = active.findIndex(n => n.id === currentNoteId.value)
    const isEmpty = currentNote.value && isNoteEmpty(currentNote.value)

    // At last position
    if (activeIdx >= active.length - 1) {
      if (isEmpty) {
        // Last note is empty - show hint
        shakeWindow()
        showHint(i18n.global.t('nav.lastNote'))
      } else {
        // Last note has content - create new note at tail
        await createNoteAtTail()
      }
      return
    }

    // Not at last position
    if (isEmpty) {
      // Current note is empty - delete it and navigate to next
      const noteToDelete = currentNote.value!
      const idToDelete = noteToDelete.id
      const realIndex = notes.value.findIndex(n => n.id === idToDelete)
      if (realIndex !== -1) notes.value.splice(realIndex, 1)
      // 空笔记已从列表移除，watch 无法反查其索引，显式指定向下一条切换的方向
      navDirection.value = 'right'
      currentNoteId.value = active[activeIdx + 1].id

      await purgeNoteFile(noteToDelete)
      await saveMetadataToCloud()
    } else {
      // Navigate to next note
      navDirection.value = 'right'
      currentNoteId.value = active[activeIdx + 1].id
    }
  }

  function pinToTop(id: string) {
    const index = notes.value.findIndex(n => n.id === id)
    if (index > 0) {
      const [note] = notes.value.splice(index, 1)
      notes.value.unshift(note)
      note.updatedAt = Date.now()

      // Schedule metadata save to iCloud (debounced)
      scheduleSave() // Will save metadata
    }
  }

  /**
   * Reorder notes by a list of note IDs
   */
  function reorderNotes(noteIds: string[]) {
    const noteMap = new Map(notes.value.map(n => [n.id, n]))
    const reordered = noteIds.map(id => noteMap.get(id)).filter((n): n is Note => n !== undefined)

    // Add any notes not in the reordered list at the end
    const reorderedIds = new Set(noteIds)
    const remaining = notes.value.filter(n => !reorderedIds.has(n.id))

    notes.value = [...reordered, ...remaining]

    // Schedule metadata save to iCloud (debounced)
    scheduleSave()
  }

  /**
   * Get notes filtered by directory
   */
  function getNotesByDirectory(directoryId: string | null): Note[] {
    if (directoryId === null) {
      return activeNotes.value.filter(n => !n.directoryId)
    }
    return activeNotes.value.filter(n => n.directoryId === directoryId)
  }

  /**
   * 重命名笔记：文件名 + 正文标题行一起改名，保持「文件名 = 标题」
   */
  async function renameNoteFile(noteId: string, rawName: string): Promise<boolean> {
    const note = notes.value.find(n => n.id === noteId)
    if (!note) return false
    const trimmed = String(rawName ?? '').replace(/\.md$/i, '').trim()
    if (!trimmed) return false
    const stem = sanitizePathSegment(trimmed)
    const dir = dirRelPath(note.directoryId) ?? null
    const from = noteFile(note)
    if (stem === from.replace(/\.md$/i, '')) return true
    const desired = uniqueFileName(note.directoryId, `${stem}.md`, note.id)
    try {
      await fs.moveNoteFile(from, dir, dir, desired)
    } catch (err) {
      console.error('[rename-note] 重命名文件失败:', err)
      return false
    }
    note.fileName = desired
    note.content = replaceTitleLine(note.content, stem)
    note.title = extractTitle(note.content)
    note.updatedAt = Date.now()
    // 标题行改过了，把新内容写进改名后的文件
    try {
      await fs.writeNote(desired, note.content, dir ?? undefined)
    } catch (err) {
      console.error('[rename-note] 写入内容失败:', err)
    }
    await saveMetadataToCloud()
    return true
  }

  /**
   * Move a note to a directory (also moves the file on filesystem)
   */
  async function moveNoteToDirectory(noteId: string, directoryId: string | null): Promise<void> {
    const note = notes.value.find(n => n.id === noteId)
    if (note) {
      if (note.trashedAt) return
      // 目标就是当前所在目录：什么都不用做（否则会平白给文件名加序号）
      if ((note.directoryId ?? null) === (directoryId ?? null)) return
      const fromRel = dirRelPath(note.directoryId) ?? null
      const fileName = noteFile(note)
      note.directoryId = directoryId || undefined
      note.updatedAt = Date.now()
      const toRel = dirRelPath(note.directoryId) ?? null
      const desired = uniqueFileName(directoryId, fileName, note.id)
      // Move the actual file on the filesystem
      await fs.moveNoteFile(fileName, fromRel, toRel, desired)
      note.fileName = desired
      scheduleSave()
    }
  }

  /**
   * Initialize the store by loading notes from iCloud
   */
  async function initialize(): Promise<void> {
    await loadNotes()
    await purgeEmptyTrash()
  }

  /**
   * 历史遗留：以前空笔记被删会进回收站，这里统一清掉（文件移入系统废纸篓 + 移除元数据）。
   */
  async function purgeEmptyTrash(): Promise<void> {
    const empties = notes.value.filter(n => n.trashedAt && isNoteEmpty(n))
    if (!empties.length) return
    for (const note of empties) {
      await purgeNoteFile(note)
      const index = notes.value.findIndex(n => n.id === note.id)
      if (index !== -1) notes.value.splice(index, 1)
    }
    await saveMetadataToCloud()
  }

  return {
    // State
    notes,
    currentNoteId,
    searchQuery,
    navigationHint,
    isLoading,
    loadError,
    filterDirectoryId,
    deletingNoteId,
    navDirection,
    // Getters
    currentNote,
    currentIndex,
    activeNoteList,
    activeIndex,
    activeNotes,
    trashedNotes,
    filteredNotes,
    pinnedNotes,
    unpinnedNotes,
    allPinnedNotes,
    // Actions
    setNotes,
    selectNote,
    setFilterDirectory,
    createNote: createNoteAfterCurrent,
    createNoteAtHead,
    createNoteAtTail,
    createNoteAfterCurrent,
    createNoteBeforeCurrent,
    createNoteWithContent,
    updateNote,
    deleteNote,
    setDeletingNoteId,
    restoreNote,
    permanentlyDeleteNote,
    emptyTrash,
    orphanFiles,
    orphanScanning,
    scanOrphanFiles,
    trashOrphanFile,
    trashAllOrphanFiles,
    restoreOrphanFile,
    togglePin,
    toggleLock,
    reorderNotes,
    getNotesByDirectory,
    moveNoteToDirectory,
    renameNoteFile,
    selectPrev,
    selectNext,
    navigatePrevOrCreate,
    navigateNextOrCreate,
    pinToTop,
    // iCloud persistence
    initialize,
    loadNotes,
    saveNoteToCloud,
    persistNoteNow,
    saveMetadataToCloud,
  }
})
