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
  directoryId?: string // null/undefined = root directory
  backgroundColor?: string // Optional background color for the note
  color?: string // 文件树里显示的颜色（文字 + 图标）
  trashedAt?: number // Unix timestamp when moved to trash
  fileName?: string // 磁盘文件名（含 .md），默认取标题
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
  directoryId?: string
  backgroundColor?: string
  color?: string
  trashedAt?: number
  fileName?: string
}

/**
 * Directory structure for organizing notes
 */
export interface Directory {
  id: string
  name: string
  parentId: string | null // null = root level
  createdAt: number
  updatedAt: number
  color?: string // 文件树里显示的颜色（文字 + 图标）
}

export interface DirectoryData {
  version: number
  directories: Directory[]
}

/**
 * 磁盘上实际存在的笔记文件（用于发现 metadata 之外的残留文件）
 */
export interface NoteFileEntry {
  fileName: string // 磁盘文件名（含 .md）
  dir: string | null // 所在目录的相对路径（根目录为 null），如 "工作/子目录"
  path: string // 完整路径
  size: number // 字节
  modified: number | null // 修改时间（毫秒）
}
