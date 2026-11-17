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
  // 预览渲染器给代码块挂的复制按钮；剥掉它按钮会退化成裸 span，绝对定位和点击都失效
  'button',
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

// 这些协议一律先拒：前几个是可执行脚本协议，"java\nscript:" 之类去掉空白后就落到这里；
// 剩下的能碰本地文件、读浏览器内部页面或把内容交给系统别的 App，白名单里的用法也用不到
const FORBIDDEN_SCHEMES = new Set([
  'javascript:', 'vbscript:', 'livescript:', 'mocha:',
  'file:', 'filesystem:', 'blob:', 'about:', 'chrome:',
  'resource:', 'jar:', 'view-source:',
])

function isSafeUrl(value: string, tag: string, attr: string): boolean {
  // 去掉控制字符和空白再判断，避免 "java\nscript:" 这类变形
  const normalized = value.replace(/[\u0000-\u0020]/g, '').toLowerCase()

  // 内联图片只对 img[src] 放行，且必须是 image/*；data:text/html 之类照旧拒绝
  if (normalized.startsWith('data:')) {
    return tag === 'img' && attr === 'src' && normalized.startsWith('data:image/')
  }

  // 可执行 / 伪协议放在任何通配规则之前，避免被下面 host:port 规则顺手放行
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized)
  if (scheme && FORBIDDEN_SCHEMES.has(scheme[1] + ':')) return false

  // host:port 形态（localhost:3000/x）的 "localhost:" 不是协议，先于协议白名单放行
  if (/^[a-z0-9.-]+:\d/.test(normalized)) return true

  // 没有协议头的是相对路径 / 锚点，交给页面自己处理
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
