import type { Directory } from '@/types/note'

/**
 * 路径段清洗：去掉路径分隔符与非法字符，截断 60 字，空则回落「未命名」
 */
export function sanitizePathSegment(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/[\u0000-\u001f]/g, '-')
  const trimmed = cleaned.trim().replace(/^\.+/, '').replace(/\.+$/, '').trim()
  const limited = Array.from(trimmed).slice(0, 60).join('').trim()
  return limited || '未命名'
}

/**
 * 目录 id → 磁盘相对路径，如 "工作/子目录"（根目录返回 undefined）
 */
export function directoryRelPath(
  directories: Directory[],
  dirId?: string | null
): string | undefined {
  if (!dirId) return undefined
  const byId = new Map(directories.map(d => [d.id, d]))
  const names: string[] = []
  let cur = byId.get(dirId)
  let guard = 0
  while (cur && guard < 32) {
    names.unshift(sanitizePathSegment(cur.name))
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
    guard++
  }
  return names.length ? names.join('/') : undefined
}

/**
 * 反查：磁盘相对路径 → 目录 id
 */
export function directoryIdFromRelPath(
  directories: Directory[],
  rel?: string | null
): string | undefined {
  if (!rel) return undefined
  return directories.find(d => directoryRelPath(directories, d.id) === rel)?.id
}

/**
 * 标题 → 磁盘文件名（含 .md）
 */
export function fileNameForTitle(title: string): string {
  return `${sanitizePathSegment(title || '未命名')}.md`
}
