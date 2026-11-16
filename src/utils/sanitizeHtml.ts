/**
 * 轻量 HTML 白名单清洗。
 *
 * 用在把 Markdown 渲染结果塞进 v-html 的地方（桌面便签、速记栏）：
 * markdown-it 是 html:true，笔记正文里的裸 HTML 会被原样输出，
 * 而这几处渲染在独立的 Tauri 窗口里，留着脚本等于把 IPC 交给正文。
 */

const ALLOWED_TAGS = new Set([
  'a', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark',
  'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'span', 'div', 'label', 'input', 'sup', 'sub', 'kbd', 'figure', 'figcaption',
])

// 这些标签连内容一起丢掉（unwrapped 会把脚本正文留在页面里）
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form',
  'svg', 'math', 'template', 'noscript',
])

const ALLOWED_ATTRS = new Set([
  'class', 'id', 'href', 'src', 'alt', 'title', 'align', 'colspan', 'rowspan',
  'start', 'type', 'checked', 'disabled', 'target', 'rel', 'role', 'tabindex',
  'aria-hidden', 'aria-label', 'data-line',
  // 任务列表靠这两个属性把行号和勾选状态带回点击处理，剥掉就点不动
  'data-task-line', 'data-checked',
])

const URL_ATTRS = new Set(['href', 'src'])

// 白名单之外一律不放行：file: 能落到本地文件，javascript:/vbscript: 直接执行，
// 还有一堆自定义协议会被系统交给别的 App 处理
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'asset:'])

function isSafeUrl(value: string, tag: string, attr: string): boolean {
  // 去掉控制字符和空白再判断，避免 "java\nscript:" 这类变形
  const normalized = value.replace(/[\u0000-\u0020]/g, '').toLowerCase()
  if (normalized.startsWith('data:')) {
    return tag === 'img' && attr === 'src' && normalized.startsWith('data:image/')
  }
  // 没有协议头的是相对路径 / 锚点，交给页面自己处理
  // host:port 形式（localhost:3000/x）不是协议
  if (/^[a-z0-9.-]+:\d/i.test(normalized)) return true
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized)
  if (!scheme) return true
  return ALLOWED_SCHEMES.has(scheme[1] + ':')
}

export function sanitizeHtml(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html')
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT)

  const elements: Element[] = []
  while (walker.nextNode()) elements.push(walker.currentNode as Element)

  for (const el of elements) {
    const tag = el.tagName.toLowerCase()

    if (DROP_WITH_CONTENT.has(tag)) {
      el.remove()
      continue
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // 不认识的标签只保留文字内容
      el.replaceWith(...Array.from(el.childNodes))
      continue
    }

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || !ALLOWED_ATTRS.has(name)) {
        el.removeAttribute(attr.name)
        continue
      }
      if (URL_ATTRS.has(name) && !isSafeUrl(attr.value, tag, name)) {
        el.removeAttribute(attr.name)
      }
    }

    if (tag === 'a' && el.getAttribute('href')) {
      el.setAttribute('rel', 'noreferrer noopener')
      el.setAttribute('target', '_blank')
    }
  }

  return doc.body.innerHTML
}
