import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import { parseWikiLinks } from '@/composables/useNoteLinks'

/**
 * 双向链接渲染（Decoration 实现，不写进 Markdown）：
 * 正文里 [[标题]] 保持纯文本，Markdown 往返、源码模式、撤销历史都不受影响；
 * 编辑态只负责把它染成可点的胶囊，点一下跳到目标笔记（不存在就新建）。
 */
export interface WikiLinkOptions {
  /** 按标题找已存在的笔记，找不到返回 null（渲染成「待创建」样式） */
  resolve: (title: string) => { id: string } | null
  /** 跳到目标笔记 */
  openNote: (id: string, title: string) => void
  /** 目标笔记不存在时新建 */
  createNote: (title: string) => void
  enabled: () => boolean
}

export const wikiLinkPluginKey = new PluginKey<DecorationSet>('wikiLink')

/** 笔记列表变化后重新算一次装饰（新建/改名/删除笔记时调用） */
export function refreshWikiLinks(view: EditorView | null | undefined) {
  if (!view || view.isDestroyed) return
  view.dispatch(view.state.tr.setMeta(wikiLinkPluginKey, { refresh: true }))
}

export const WikiLinkExtension = Extension.create<WikiLinkOptions>({
  name: 'wikiLink',

  addOptions() {
    return {
      resolve: () => null,
      openNote: () => {},
      createNote: () => {},
      enabled: () => true,
    }
  },

  addProseMirrorPlugins() {
    const options = this.options

    const buildDecorations = (state: EditorState): DecorationSet => {
      if (!options.enabled()) return DecorationSet.empty

      const decorations: Decoration[] = []

      state.doc.descendants((node, pos, parent) => {
        if (!node.isText || !node.text) return
        // 代码块里不当作链接
        if (parent && parent.type.name === 'codeBlock') return

        for (const link of parseWikiLinks(node.text)) {
          const exists = Boolean(options.resolve(link.title))
          const base = exists ? 'wiki-link' : 'wiki-link is-missing'
          // ProseMirror 会把重叠的行内装饰拆成不相邻的 span，拆出来的片段拿不到
          // data-wiki-title，点标题文字就跳不动。所以这里刻意切成三段不重叠的装饰，
          // 每段都带标题，任何位置点击都能命中。
          const segments: Array<[number, number, string]> = [
            [pos + link.start, pos + link.labelStart, 'wiki-link-bracket'],
            [pos + link.labelStart, pos + link.labelEnd, 'wiki-link-label'],
            [pos + link.labelEnd, pos + link.end, 'wiki-link-bracket'],
          ]

          for (const [segFrom, segTo, modifier] of segments) {
            if (segTo <= segFrom) continue
            decorations.push(
              Decoration.inline(segFrom, segTo, {
                class: `${base} ${modifier}`,
                'data-wiki-title': link.title,
              }),
            )
          }
        }
      })

      return DecorationSet.create(state.doc, decorations)
    }

    return [
      new Plugin<DecorationSet>({
        key: wikiLinkPluginKey,
        state: {
          init: (_config, state) => buildDecorations(state),
          apply: (tr, value, _oldState, newState) => {
            if (tr.docChanged || tr.getMeta(wikiLinkPluginKey)) return buildDecorations(newState)
            return value
          },
        },
        props: {
          decorations(state) {
            return wikiLinkPluginKey.getState(state) ?? DecorationSet.empty
          },
          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement | null
            const el = target?.closest?.('[data-wiki-title]') as HTMLElement | null
            if (!el) return false

            const title = el.getAttribute('data-wiki-title') || ''
            if (!title) return false

            event.preventDefault()
            const note = options.resolve(title)
            if (note) options.openNote(note.id, title)
            else options.createNote(title)
            return true
          },
        },
      }),
    ]
  },
})
