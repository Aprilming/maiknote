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

/**
 * 代码块右上角的复制按钮。
 *
 * 编辑器里的复制按钮是 Tiptap 的 CodeBlock 扩展自己挂上去的，预览这边只有
 * markdown-it 渲染出来的裸 `<pre><code>`，所以得自己补：把围栏代码包一层
 * `.md-code-block`，塞一个按钮进去，点击由宿主组件做事件委托处理。
 */
const CODE_COPY_ICON =
  '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">' +
  '<rect x="5.5" y="5.5" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
  '<path d="M10.5 4V3.2A1.2 1.2 0 0 0 9.3 2H3.2A1.2 1.2 0 0 0 2 3.2v6.1A1.2 1.2 0 0 0 3.2 10.5H4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
  '</svg>'

const CODE_DONE_ICON =
  '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">' +
  '<path d="M3.5 8.5 6.5 11.5 12.5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>'

function installCodeCopy(md: MarkdownIt, label: string) {
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]
    const info = token.info ? md.utils.escapeHtml(token.info.trim()) : ''
    const lang = info.split(/\s+/)[0] as string
    const langClass = lang ? ` class="language-${lang}"` : ''
    const escaped = md.utils.escapeHtml(token.content)
    const title = md.utils.escapeHtml(label)
    return (
      '<div class="md-code-block">' +
      `<button class="md-code-copy" type="button" title="${title}" aria-label="${title}">` +
      `<span class="md-code-copy-idle">${CODE_COPY_ICON}</span>` +
      `<span class="md-code-copy-done">${CODE_DONE_ICON}</span>` +
      '</button>' +
      `<pre><code${langClass}>${escaped}</code></pre>` +
      '</div>'
    )
  }
}

/**
 * 建一个带任务列表支持的渲染器（每个窗口各建一份即可）。
 * 传了 `codeCopyLabel` 就给代码块加复制按钮，按钮文案即这个参数（提示文字）。
 */
export function createPreviewMarkdown(options: { codeCopyLabel?: string } = {}): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: false })
  installTaskList(md)
  if (options.codeCopyLabel) installCodeCopy(md, options.codeCopyLabel)
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
