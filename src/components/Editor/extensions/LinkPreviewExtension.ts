import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import {
  extractSoleUrl,
  fetchLinkPreview,
  peekLinkPreview,
  type LinkPreviewData,
} from '@/utils/linkPreview'

/**
 * 链接卡片预览（Decoration 实现，不写进 Markdown）：
 * 段落里只有一条裸链接时，异步抓取网页 meta，成功就在段落下方渲染一张卡片；
 * 抓取失败什么都不加 —— 也就是回退成原来的纯文字链接。
 *
 * 因为只是 Decoration，正文内容不变，Markdown 往返、撤销历史都不受影响。
 */

export const linkPreviewPluginKey = new PluginKey<DecorationSet>('linkPreview')

/** 触发一次重新计算（设置项开关、抓取完成后用） */
export function refreshLinkPreview(view: EditorView | null | undefined) {
  if (!view || view.isDestroyed) return
  view.dispatch(view.state.tr.setMeta(linkPreviewPluginKey, { refresh: true }))
}

export interface LinkPreviewOptions {
  /** 是否开启预览（读设置项） */
  enabled: () => boolean
  /** 点卡片时的打开方式 */
  openUrl: (url: string) => void
  /** 一篇笔记里最多同时展示几张卡片 */
  maxPerDoc: number
  /** 一篇笔记里最多抓取几个链接（避免打开笔记就狂请求） */
  maxRequestsPerDoc: number
}

function createCardElement(
  data: LinkPreviewData,
  url: string,
  openUrl: (url: string) => void,
): HTMLElement {
  const card = document.createElement('span')
  card.className = 'link-preview-card'
  card.setAttribute('data-link-preview-url', url)
  card.setAttribute('contenteditable', 'false')
  card.spellcheck = false

  const body = document.createElement('span')
  body.className = 'link-preview-body'

  const site = document.createElement('span')
  site.className = 'link-preview-site'
  site.textContent = data.siteName || data.host || ''
  body.appendChild(site)

  const title = document.createElement('span')
  title.className = 'link-preview-title'
  title.textContent = data.title || url
  body.appendChild(title)

  if (data.description) {
    const desc = document.createElement('span')
    desc.className = 'link-preview-desc'
    desc.textContent = data.description
    body.appendChild(desc)
  }

  card.appendChild(body)

  if (data.image) {
    const thumb = document.createElement('span')
    thumb.className = 'link-preview-thumb'
    const img = document.createElement('img')
    img.src = data.image
    img.alt = ''
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    img.addEventListener('error', () => thumb.remove())
    thumb.appendChild(img)
    card.appendChild(thumb)
  }

  card.addEventListener('mousedown', (event) => {
    // 别让点击把光标塞进卡片里
    event.preventDefault()
    event.stopPropagation()
  })
  card.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    openUrl(url)
  })

  return card
}

export const LinkPreviewExtension = Extension.create<LinkPreviewOptions>({
  name: 'linkPreview',

  addOptions() {
    return {
      enabled: () => true,
      openUrl: () => {},
      maxPerDoc: 5,
      maxRequestsPerDoc: 8,
    }
  },

  addProseMirrorPlugins() {
    const options = this.options
    let editorView: EditorView | null = null
    let refreshQueued = false
    const inflight = new Map<string, Promise<LinkPreviewData | null>>()

    const scheduleRefresh = () => {
      if (refreshQueued) return
      refreshQueued = true
      requestAnimationFrame(() => {
        refreshQueued = false
        refreshLinkPreview(editorView)
      })
    }

    const requestPreview = (url: string) => {
      if (inflight.has(url)) return
      if (peekLinkPreview(url) !== undefined) return
      const task = fetchLinkPreview(url).then((data) => {
        inflight.delete(url)
        return data
      })
      inflight.set(url, task)
      void task.then(() => scheduleRefresh())
    }

    const buildDecorations = (state: EditorState): DecorationSet => {
      if (!options.enabled()) return DecorationSet.empty

      const decorations: Decoration[] = []
      let rendered = 0
      let requested = 0

      state.doc.forEach((node, offset) => {
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return
        const url = extractSoleUrl(node.textContent)
        if (!url) return

        const cached = peekLinkPreview(url)
        if (cached === undefined) {
          if (requested < options.maxRequestsPerDoc) {
            requested += 1
            requestPreview(url)
          }
          return
        }
        // 抓取失败（null）→ 不渲染卡片，正文里那条文字链接照旧
        if (!cached) return
        if (rendered >= options.maxPerDoc) return
        rendered += 1
        decorations.push(
          Decoration.widget(offset + node.nodeSize, createCardElement(cached, url, options.openUrl), {
            side: 1,
            key: `link-preview-${offset}-${url}`,
          }),
        )
      })

      return DecorationSet.create(state.doc, decorations)
    }

    return [
      new Plugin<DecorationSet>({
        key: linkPreviewPluginKey,
        state: {
          init: (_config, state) => buildDecorations(state),
          apply: (tr, value, _oldState, newState) => {
            if (tr.docChanged || tr.getMeta(linkPreviewPluginKey)) return buildDecorations(newState)
            return value
          },
        },
        props: {
          decorations(state) {
            return linkPreviewPluginKey.getState(state) ?? DecorationSet.empty
          },
        },
        view: (view) => {
          editorView = view
          scheduleRefresh()
          return {
            destroy: () => {
              editorView = null
            },
          }
        },
      }),
    ]
  },
})
