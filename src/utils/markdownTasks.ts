import MarkdownIt from 'markdown-it'

/**
 * 预览类界面（贴边面板卡片、桌面小卡片）用的 Markdown 渲染器。
 *
 * markdown-it 原生不认 `- [ ]` 任务列表语法，会把它当成普通列表项渲染成一串
 * 字面量「[ ] 文字」，既难看也点不动。这里补一个小插件：
 * - 列表项开头是 `[ ]` / `[x]` 的，抠掉方括号，换成真的 checkbox；
 * - checkbox 上带 data-task-line = 这一项在正文里的行号（0 开始），
 *   点击后由 toggleTaskLine 按行号回写原文，不依赖「第几个任务」的计数，
 *   正文里混着代码块、空任务也不会串号。
 */

/** 任务行：`- [ ] xxx` / `* [x] xxx` / `1. [ ] xxx`，允许前导引用符 */
const TASK_LINE = /^([ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\](?:[ \t]+|$))/

function installTaskList(md: MarkdownIt) {
  md.core.ruler.after('inline', 'preview-task-list', state => {
    const tokens = state.tokens
    for (let i = 2; i < tokens.length; i += 1) {
      const inline = tokens[i]
      if (inline.type !== 'inline' || !inline.children?.length) continue
      if (tokens[i - 1].type !== 'paragraph_open') continue
      const item = tokens[i - 2]
      if (item.type !== 'list_item_open') continue
      const first = inline.children[0]
      if (!first || first.type !== 'text') continue
      const match = /^\[([ xX])\](?:[ \t]+|$)/.exec(first.content)
      if (!match) continue

      const checked = match[1].toLowerCase() === 'x'
      // 方括号标记从文字里抠掉，只留正文
      first.content = first.content.slice(match[0].length)

      // 列表项起始行（markdown-it 的 map 是 0 基的源码行号）
      const line = item.map ? item.map[0] : -1
      const checkbox = new state.Token('html_inline', '', 0)
      checkbox.content =
        `<input class="md-task" type="checkbox" tabindex="-1" data-task-line="${line}"` +
        `${checked ? ' checked' : ''}>`
      inline.children.unshift(checkbox)

      item.attrJoin('class', 'md-task-item')
      item.attrSet('data-checked', checked ? 'true' : 'false')

      // 所属列表挂个类名，用来去掉圆点
      for (let j = i - 3; j >= 0; j -= 1) {
        const type = tokens[j].type
        if (type === 'bullet_list_open' || type === 'ordered_list_open') {
          const existing = tokens[j].attrGet('class') || ''
          if (!existing.includes('md-task-list')) {
            tokens[j].attrSet('class', `${existing} md-task-list`.trim())
          }
          break
        }
        if (type === 'bullet_list_close' || type === 'ordered_list_close') break
      }
    }
    return true
  })
}

/** 建一个带任务列表支持的渲染器（每个窗口各建一份即可） */
export function createPreviewMarkdown(): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: false })
  installTaskList(md)
  return md
}

/**
 * 把正文里第 line 行（0 基）的任务勾选状态改成 checked，返回新正文。
 * 行号对不上（正文刚被别处改过、或那行不是任务行）就原样返回，上层据此忽略这次点击。
 */
export function toggleTaskLine(content: string, line: number, checked: boolean): string {
  if (!Number.isFinite(line) || line < 0) return content
  const lines = content.split('\n')
  if (line >= lines.length) return content
  const current = lines[line]
  if (!TASK_LINE.test(current)) return content
  const next = current.replace(
    TASK_LINE,
    (_full: string, pre: string, _mark: string, post: string) => `${pre}${checked ? 'x' : ' '}${post}`,
  )
  if (next === current) return content
  lines[line] = next
  return lines.join('\n')
}
