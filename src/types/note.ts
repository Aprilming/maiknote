/**
 * Note data model
 */
export interface Note {
  id: string // UUID, also used as filename e.g. "note_uuid.md"
  title: string // Auto-extracted from first line, max 50 chars
  content: string // Markdown content
  createdAt: number // Unix timestamp
  updatedAt: number // Unix timestamp
  tags?: string[] // Optional tags
  isPinned: boolean // Whether the note is pinned
  isLocked: boolean // Whether the note is locked (cannot edit or delete)
}

/**
 * Metadata structure for storing note index
 */
export interface NoteMetadata {
  version: number
  notes: NoteMetadataItem[]
}

export interface NoteMetadataItem {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  tags?: string[]
  isPinned: boolean
  isLocked: boolean
}
