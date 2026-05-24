import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Note, NoteMetadata } from '@/types/note'
import { useFileSystem } from '@/composables/useFileSystem'

export const useNoteStore = defineStore('note', () => {
  // File system
  const fs = useFileSystem()

  // State
  const notes = ref<Note[]>([])
  const currentNoteId = ref<string | null>(null)
  const searchQuery = ref('')
  const navigationHint = ref<{ message: string; visible: boolean }>({ message: '', visible: false })
  const isLoading = ref(false)
  const loadError = ref<Error | null>(null)
  const filterDirectoryId = ref<string | null>(null) // null = root 目录

  // 监听 currentNoteId 变化，保存到 localStorage
  watch(currentNoteId, (newId) => {
    if (newId) {
      localStorage.setItem('lastOpenedNoteId', newId)
    }
  })

  // Getters
  const currentNote = computed(() =>
    notes.value.find(n => n.id === currentNoteId.value) ?? null
  )

  const currentIndex = computed(() =>
    notes.value.findIndex(n => n.id === currentNoteId.value)
  )

  /** 按 filterDirectoryId 过滤后的笔记列表 */
  const activeNoteList = computed(() => {
    if (filterDirectoryId.value === null) {
      return notes.value.filter(n => !n.directoryId)
    }
    return notes.value.filter(n => n.directoryId === filterDirectoryId.value)
  })

  /** 当前笔记在 activeNoteList 中的索引 */
  const activeIndex = computed(() =>
    activeNoteList.value.findIndex(n => n.id === currentNoteId.value)
  )

  const filteredNotes = computed(() => {
    if (!searchQuery.value) return notes.value
    const query = searchQuery.value.toLowerCase()
    return notes.value.filter(n =>
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

  // Helper: Check if note is empty
  function isNoteEmpty(note: Note | null): boolean {
    if (!note) return false
    return !note.content || note.content.trim() === ''
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
          await fs.writeNote(note.id, note.content, note.directoryId)
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
   * Load all notes from iCloud
   */
  async function loadNotes(): Promise<void> {
    if (isLoading.value) return

    isLoading.value = true
    loadError.value = null

    try {
      const metadata = await fs.readMetadata()

      // Convert metadata items to full notes with empty content
      const loadedNotes: Note[] = []

      for (const item of metadata.notes) {
        // Read content from file (from directory if applicable)
        const content = await fs.readNote(item.id, item.directoryId)

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
        })
      }

      notes.value = loadedNotes

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
  }

  /**
   * Save metadata to iCloud (internal function)
   */
  async function saveMetadataToCloud(): Promise<void> {
    const metadata: NoteMetadata = {
      version: 1,
      notes: notes.value.map((note) => ({
        id: note.id,
        title: note.title,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        tags: note.tags,
        isPinned: note.isPinned,
        isLocked: note.isLocked,
        directoryId: note.directoryId,
      })),
    }

    await fs.writeMetadata(metadata)
  }

  /**
   * Save a single note to iCloud immediately (for new notes)
   */
  async function saveNoteToCloud(note: Note): Promise<void> {
    try {
      // Save content to file (in directory if assigned)
      await fs.writeNote(note.id, note.content, note.directoryId)

      // Update metadata
      await saveMetadataToCloud()
    } catch (e) {
      console.error('Failed to save note to iCloud:', e)
      throw e
    }
  }

  /**
   * Delete note from iCloud
   */
  async function deleteNoteFromCloud(id: string): Promise<void> {
    try {
      const note = notes.value.find(n => n.id === id)
      await fs.deleteNote(id, note?.directoryId)
      await saveMetadataToCloud()
    } catch (e) {
      console.error('Failed to delete note from iCloud:', e)
      throw e
    }
  }

  // ============================================
  // Store Actions
  // ============================================

  function setNotes(newNotes: Note[]) {
    notes.value = newNotes
  }

  function selectNote(id: string) {
    currentNoteId.value = id
  }

  /**
   * 设置目录过滤，切换后自动选中该目录下第一篇笔记
   */
  function setFilterDirectory(id: string | null) {
    filterDirectoryId.value = id
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
    }
    notes.value.push(newNote)
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
    }

    // Insert after current note
    const currentIndex = notes.value.findIndex(n => n.id === currentNoteId.value)
    if (currentIndex !== -1) {
      notes.value.splice(currentIndex + 1, 0, newNote)
    } else {
      notes.value.push(newNote)
    }
    currentNoteId.value = newNote.id

    // Save to iCloud
    await saveNoteToCloud(newNote)

    return newNote
  }

  function updateNote(id: string, updates: Partial<Omit<Note, 'id' | 'createdAt'>>) {
    const index = notes.value.findIndex(n => n.id === id)
    if (index !== -1) {
      notes.value[index] = {
        ...notes.value[index],
        ...updates,
        updatedAt: Date.now(),
      }
      // Update title if content changed
      if (updates.content) {
        notes.value[index].title = extractTitle(updates.content)
      }

      // Schedule save to iCloud (debounced)
      scheduleSave(notes.value[index])
    }
  }

  async function deleteNote(id: string) {
    const note = notes.value.find(n => n.id === id)
    if (note?.isLocked) {
      return // Cannot delete locked note
    }
    const index = notes.value.findIndex(n => n.id === id)
    if (index !== -1) {
      notes.value.splice(index, 1)

      // Delete from iCloud
      await deleteNoteFromCloud(id)

      // If deleted note was current, select the previous note (or first if at index 0)
      if (currentNoteId.value === id) {
        const newIndex = Math.max(0, index - 1)
        currentNoteId.value = notes.value[newIndex]?.id ?? null
      }
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
        await fs.setNoteReadonly(id)
      } else {
        await fs.setNoteReadwrite(id)
      }

      // Schedule metadata save to iCloud (debounced)
      scheduleSave() // Will save metadata
    }
  }

  function selectPrev() {
    const active = activeNoteList.value
    const idx = active.findIndex(n => n.id === currentNoteId.value)
    if (idx > 0) {
      currentNoteId.value = active[idx - 1].id
    }
  }

  function selectNext() {
    const active = activeNoteList.value
    const idx = active.findIndex(n => n.id === currentNoteId.value)
    if (idx < active.length - 1) {
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
      showHint('已经是第一篇笔记')
      return
    }

    // Current note is empty - delete it and navigate to previous
    if (isEmpty) {
      const idToDelete = currentNoteId.value!
      const realIndex = notes.value.findIndex(n => n.id === idToDelete)
      notes.value.splice(realIndex, 1)
      currentNoteId.value = active[activeIdx - 1].id

      // Delete from iCloud
      await deleteNoteFromCloud(idToDelete)
    } else {
      // Navigate to previous note
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
        showHint('已经是最后一篇笔记')
      } else {
        // Last note has content - create new note at tail
        await createNoteAtTail()
      }
      return
    }

    // Not at last position
    if (isEmpty) {
      // Current note is empty - delete it and navigate to next
      const idToDelete = currentNoteId.value!
      const realIndex = notes.value.findIndex(n => n.id === idToDelete)
      notes.value.splice(realIndex, 1)
      currentNoteId.value = active[activeIdx + 1].id

      // Delete from iCloud
      await deleteNoteFromCloud(idToDelete)
    } else {
      // Navigate to next note
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
      return notes.value.filter(n => !n.directoryId)
    }
    return notes.value.filter(n => n.directoryId === directoryId)
  }

  /**
   * Move a note to a directory (also moves the file on filesystem)
   */
  async function moveNoteToDirectory(noteId: string, directoryId: string | null): Promise<void> {
    const note = notes.value.find(n => n.id === noteId)
    if (note) {
      const fromDir = note.directoryId ?? null
      const toDir = directoryId
      note.directoryId = directoryId || undefined
      note.updatedAt = Date.now()
      // Move the actual file on the filesystem
      await fs.moveNoteFile(noteId, fromDir, toDir)
      scheduleSave()
    }
  }

  /**
   * Initialize the store by loading notes from iCloud
   */
  async function initialize(): Promise<void> {
    await loadNotes()
  }

  // Helper function to extract title from content
  function extractTitle(content: string): string {
    const lines = content.trim().split('\n')
    const firstLine = lines[0]?.trim() || ''
    if (firstLine.startsWith('#')) {
      return firstLine.replace(/^#+\s*/, '').substring(0, 50)
    }
    return firstLine.substring(0, 50) || 'Untitled'
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
    // Getters
    currentNote,
    currentIndex,
    activeNoteList,
    activeIndex,
    filteredNotes,
    pinnedNotes,
    unpinnedNotes,
    // Actions
    setNotes,
    selectNote,
    setFilterDirectory,
    createNote: createNoteAfterCurrent,
    createNoteAtHead,
    createNoteAtTail,
    createNoteAfterCurrent,
    createNoteWithContent,
    updateNote,
    deleteNote,
    togglePin,
    toggleLock,
    reorderNotes,
    getNotesByDirectory,
    moveNoteToDirectory,
    selectPrev,
    selectNext,
    navigatePrevOrCreate,
    navigateNextOrCreate,
    pinToTop,
    // iCloud persistence
    initialize,
    loadNotes,
    saveNoteToCloud,
    saveMetadataToCloud,
  }
})
