import type { Note } from '@/types/note'

/** 一处 [[笔记标题]] / [[笔记标题|显示文字]] 引用 */
export interface WikiLinkMatch {
  /** 指向的笔记标题（[[ 之后、| 之前，已 trim） */
  title: string
  /** 正文里显示出来的文字（默认等于 title） */
  label: string
  /** 完整原文，含方括号 */
  raw: string
  /** 原文在文本中的起止偏移 */
  start: number
  end: number
  /** 显示文字在文本中的起止偏移（给装饰上色用） */
  labelStart: number
  labelEnd: number
}

/** 一条反向链接：谁引用了我 */
export interface BacklinkEntry {
  sourceId: string
  sourceTitle: string
  /** 引用处显示的文字 */
  label: string
  /** 引用所在行的摘要 */
  snippet: string
}

const WIKI_LINK_PATTERN = '\\[\\[([^\\[\\]\\n]{1,120}?)\\]\\]'
export const WIKI_LINK_SOURCE = WIKI_LINK_PATTERN

export function parseWikiLinks(text: string): WikiLinkMatch[] {
  if (!text || text.indexOf('[[') === -1) return []

  const matches: WikiLinkMatch[] = []
  const re = new RegExp(WIKI_LINK_PATTERN, 'g')
  let hit: RegExpExecArray | null

  while ((hit = re.exec(text)) !== null) {
    const inner = hit[1]
    const pipe = inner.indexOf('|')
    const rawTitle = pipe === -1 ? inner : inner.slice(0, pipe)
    const title = rawTitle.trim()
    if (!title) continue

    const rawLabel = pipe === -1 ? rawTitle : inner.slice(pipe + 1)
    const label = rawLabel.trim() || title

    const start = hit.index
    const end = start + hit[0].length

    const titleOffsetInInner = inner.indexOf(rawTitle)
    const labelOffsetInInner = pipe === -1
      ? titleOffsetInInner + rawTitle.indexOf(label)
      : pipe + 1 + rawLabel.indexOf(label)
    const labelStart = start + 2 + Math.max(0, labelOffsetInInner)

    matches.push({
      title,
      label,
      raw: hit[0],
      start,
      end,
      labelStart,
      labelEnd: labelStart + label.length,
    })
  }

  return matches
}

/** 标题比对用的归一化：去首尾空白、折叠中间空白、忽略大小写 */
export function normalizeLinkTitle(title: string): string {
  return (title || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function findNoteByTitle(notes: Note[], title: string): Note | null {
  const key = normalizeLinkTitle(title)
  if (!key) return null

  const active = notes.filter(n => !n.trashedAt)
  return active.find(n => normalizeLinkTitle(n.title) === key) ?? null
}

/** 引用所在行的摘要，用于反向链接面板 */
function lineSnippet(content: string, index: number): string {
  let lineStart = content.lastIndexOf('\n', Math.max(0, index - 1)) + 1
  let lineEnd = content.indexOf('\n', index)
  if (lineEnd === -1) lineEnd = content.length

  const line = content
    .slice(lineStart, lineEnd)
    .replace(/^[\s>]*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+|\[[ xX]\]\s+)?/, '')
    .trim()

  return line.length > 90 ? line.slice(0, 90) + '…' : line
}

/**
 * 反向链接索引：被引用笔记 id → 引用它的笔记列表（每篇来源只出现一次）。
 * 标题按归一化后比对，重名取列表中第一篇。
 */
export function buildBacklinkIndex(notes: Note[]): Map<string, BacklinkEntry[]> {
  const active = notes.filter(n => !n.trashedAt)
  const byTitle = new Map<string, Note>()

  for (const note of active) {
    const key = normalizeLinkTitle(note.title)
    if (key && !byTitle.has(key)) byTitle.set(key, note)
  }

  const index = new Map<string, BacklinkEntry[]>()
  for (const source of active) {
    if (!source.content || source.content.indexOf('[[') === -1) continue

    const seen = new Set<string>()
    for (const link of parseWikiLinks(source.content)) {
      const target = byTitle.get(normalizeLinkTitle(link.title))
      if (!target || target.id === source.id) continue

      // 同一篇笔记里多次引用同一目标只记一条（取第一处的位置和措辞）
      if (seen.has(target.id)) continue
      seen.add(target.id)

      const list = index.get(target.id) ?? []
      list.push({
        sourceId: source.id,
        sourceTitle: source.title,
        label: link.label,
        snippet: lineSnippet(source.content, link.start),
      })
      index.set(target.id, list)
    }
  }

  return index
}

/** [[ ]] 选择器里可选的笔记：未进回收站的，最近更新的排前面 */
export function listLinkableNotes(notes: Note[], excludeId?: string | null): Note[] {
  return notes
    .filter(n => !n.trashedAt && n.id !== excludeId)
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 笔记改名后，把别处 [[旧标题]] / [[旧标题|别名]] 改成新标题 */
export function replaceWikiLinkTitle(content: string, fromTitle: string, toTitle: string): string {
  const from = fromTitle.trim()
  const to = toTitle.trim()
  if (!from || !to || from === to || content.indexOf('[[') === -1) return content

  const re = new RegExp('\\[\\[\\s*' + escapeRegExp(from) + '\\s*(\\|[^\\[\\]\\n]*)?\\]\\]', 'g')
  return content.replace(re, (_match: string, alias?: string) => `[[${to}${alias ?? ''}]]`)
}

/** 新建笔记、跳转前用：把标题里会破坏 [[ ]] 语法的字符去掉 */
export function sanitizeLinkTitle(title: string): string {
  return (title || '').replace(/[\[\]|\n\r]/g, ' ').replace(/\s+/g, ' ').trim()
}
