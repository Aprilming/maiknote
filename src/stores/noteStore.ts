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

  const filteredNotes = computed(() => {
    if (!searchQuery.value) return notes.value
    const query = searchQuery.value.toLowerCase()
    return notes.value.filter(n =>
      n.title.toLowerCase().includes(query) ||
      n.content.toLowerCase().includes(query)
    )
  })

  const pinnedNotes = computed(() =>
    notes.value.filter(n => n.isPinned)
  )

  const unpinnedNotes = computed(() =>
    notes.value.filter(n => !n.isPinned)
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
          await fs.writeNote(note.id, note.content)
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
        // Read content from file
        const content = await fs.readNote(item.id)

        loadedNotes.push({
          id: item.id,
          title: item.title,
          content,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          tags: item.tags,
          isPinned: item.isPinned,
        })
      }

      notes.value = loadedNotes

      // 恢复上次打开的笔记
      const lastOpenedId = localStorage.getItem('lastOpenedNoteId')
      if (lastOpenedId && notes.value.some(n => n.id === lastOpenedId)) {
        currentNoteId.value = lastOpenedId
      } else if (notes.value.length > 0) {
        currentNoteId.value = notes.value[0].id
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
      })),
    }

    await fs.writeMetadata(metadata)
  }

  /**
   * Save a single note to iCloud immediately (for new notes)
   */
  async function saveNoteToCloud(note: Note): Promise<void> {
    try {
      // Save content to file
      await fs.writeNote(note.id, note.content)

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
      await fs.deleteNote(id)
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

  async function createNoteAtHead(): Promise<Note> {
    const now = Date.now()
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: 'New Note',
      content: '',
      createdAt: now,
      updatedAt: now,
      isPinned: false,
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

  function selectPrev() {
    const index = currentIndex.value
    if (index > 0) {
      currentNoteId.value = notes.value[index - 1].id
    }
  }

  function selectNext() {
    const index = currentIndex.value
    if (index < notes.value.length - 1) {
      currentNoteId.value = notes.value[index + 1].id
    }
  }

  // Navigate to previous note
  async function navigatePrevOrCreate() {
    const index = currentIndex.value
    const isEmpty = currentNote.value && isNoteEmpty(currentNote.value)

    // At first position - show hint, don't navigate
    if (index === 0) {
      showHint('已经是第一篇笔记')
      return
    }

    // Current note is empty - delete it and navigate to previous
    if (isEmpty) {
      const idToDelete = notes.value[index].id
      notes.value.splice(index, 1)
      currentNoteId.value = notes.value[index - 1].id

      // Delete from iCloud
      await deleteNoteFromCloud(idToDelete)
    } else {
      // Navigate to previous note
      currentNoteId.value = notes.value[index - 1].id
    }
  }

  // Navigate to next note
  async function navigateNextOrCreate() {
    const index = currentIndex.value
    const isEmpty = currentNote.value && isNoteEmpty(currentNote.value)

    // At last position
    if (index >= notes.value.length - 1) {
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
      const idToDelete = notes.value[index].id
      notes.value.splice(index, 1)
      currentNoteId.value = notes.value[index].id

      // Delete from iCloud
      await deleteNoteFromCloud(idToDelete)
    } else {
      // Navigate to next note
      currentNoteId.value = notes.value[index + 1].id
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
    // Getters
    currentNote,
    currentIndex,
    filteredNotes,
    pinnedNotes,
    unpinnedNotes,
    // Actions
    setNotes,
    selectNote,
    createNote: createNoteAfterCurrent,
    createNoteAtHead,
    createNoteAtTail,
    createNoteAfterCurrent,
    createNoteWithContent,
    updateNote,
    deleteNote,
    togglePin,
    reorderNotes,
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
