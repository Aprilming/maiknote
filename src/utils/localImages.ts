/**
 * 笔记里图片地址的两种形态与换算。
 *
 * 落盘（.md 文件里）一律写「相对工作空间内容根」的路径，形如 images/img_xxx.png。
 * 以前写的是 asset://localhost/%2FUsers%2F... 这种把本机用户名烧进地址的绝对路径，
 * 笔记跟着 iCloud 同步到另一台机器就指向一个不存在的文件。
 *
 * 渲染（编辑器 / 桌面卡片 / 贴边面板）只认 asset:// 协议地址，加载不了相对路径，
 * 所以换算只发生在 markdown 文本这一层：读进渲染器时 相对 → asset，写回笔记时 asset → 相对。
 * 围栏代码块里的示例文本不参与换算。
 */

const ASSET_PREFIX = 'asset://localhost/'
/** 带协议头（http:、data:、asset:…）或协议相对（//host）的地址不算相对路径 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** 拼内容根与相对路径，去掉多余的斜杠 */
export function joinContentPath(base: string, relative: string): string {
  const root = base.replace(/\/+$/, '')
  const rel = relative.replace(/^\.?\//, '')
  return root ? `${root}/${rel}` : rel
}

/** 本机绝对路径 → asset:// 地址（编码方式和原来一致，Tauri 侧会解码） */
export function assetUrlOf(absolutePath: string): string {
  return ASSET_PREFIX + encodeURIComponent(absolutePath)
}

/** 渲染用：相对图片地址 → asset:// 地址；本来就绝对（asset/http/data）的原样返回 */
export function imageSrcForRender(src: string, base: string): string {
  const value = src.trim()
  if (!value) return src
  if (value.startsWith(ASSET_PREFIX)) return value
  if (HAS_SCHEME.test(value) || value.startsWith('//')) return src
  if (!base) return src
  return assetUrlOf(joinContentPath(base, value))
}

/** 落盘用：asset:// 地址 → 相对工作空间内容根的路径；不在这个空间里的地址原样保留 */
export function imageSrcForStorage(src: string, base: string): string {
  const value = src.trim()
  if (!value.startsWith(ASSET_PREFIX)) return src
  let decoded: string
  try {
    decoded = decodeURIComponent(value.slice(ASSET_PREFIX.length))
  } catch {
    return src
  }
  const root = base.replace(/\/+$/, '')
  if (!root || !decoded.startsWith(root + '/')) return src
  return decoded.slice(root.length + 1)
}

/** 围栏代码块的开头/结尾（``` 或 ~~~，允许缩进） */
const FENCE = /^\s{0,3}(```|~~~)/

/**
 * 只对代码块之外的部分做替换：正文里的示例代码常常写着图片语法，
 * 那是要给人看的字符串，不能跟着换算。
 */
function mapOutsideCodeFences(markdown: string, map: (segment: string) => string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let buffer: string[] = []
  let inFence = false
  const flush = () => {
    if (!buffer.length) return
    out.push(map(buffer.join('\n')))
    buffer = []
  }
  for (const line of lines) {
    if (FENCE.test(line)) {
      flush()
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) out.push(line)
    else buffer.push(line)
  }
  flush()
  return out.join('\n')
}

/** 把 markdown 里的图片地址交给 rewrite 处理（含 ![alt](src) 与行内 <img src>） */
function rewriteImageSources(segment: string, rewrite: (src: string) => string): string {
  return segment
    .replace(/(!\[[^\]]*\]\(\s*)(<[^>\n]*>|[^)\s]+)/g, (_match, head: string, target: string) => {
      if (target.startsWith('<')) return head + '<' + rewrite(target.slice(1, -1)) + '>'
      return head + rewrite(target)
    })
    .replace(
      /(<img\b[^>]*?\bsrc\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      (_match, head: string, _quoted: string, doubleQuoted?: string, singleQuoted?: string, bare?: string) => {
        if (doubleQuoted !== undefined) return `${head}"${rewrite(doubleQuoted)}"`
        if (singleQuoted !== undefined) return `${head}'${rewrite(singleQuoted)}'`
        return head + rewrite(bare ?? '')
      },
    )
}

/** 读进渲染器前：把相对图片地址补成 asset:// 地址 */
export function markdownImagesForRender(markdown: string, base: string): string {
  if (!markdown || !base) return markdown
  return mapOutsideCodeFences(markdown, segment => rewriteImageSources(segment, src => imageSrcForRender(src, base)))
}

/** 写回笔记前：把 asset:// 地址换回相对路径 */
export function markdownImagesForStorage(markdown: string, base: string): string {
  if (!markdown || !base) return markdown
  return mapOutsideCodeFences(markdown, segment => rewriteImageSources(segment, src => imageSrcForStorage(src, base)))
}
