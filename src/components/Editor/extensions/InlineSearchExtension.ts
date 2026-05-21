import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'

export interface SearchMatch {
  from: number
  to: number
  text: string
}

export interface SearchPluginState {
  query: string
  matches: SearchMatch[]
  currentIndex: number
}

export const searchPluginKey = new PluginKey('inlineSearch')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineSearch: {
      setSearchQuery: (query: string) => ReturnType
      searchNext: () => ReturnType
      searchPrev: () => ReturnType
      clearSearch: () => ReturnType
    }
  }
}

function findMatches(doc: Node, query: string): SearchMatch[] {
  if (!query.trim()) return []
  const matches: SearchMatch[] = []
  const lowerQuery = query.toLowerCase()

  doc.descendants((node, pos) => {
    if (node.isText) {
      const text = node.text ?? ''
      const lowerText = text.toLowerCase()
      let idx = 0
      while (true) {
        idx = lowerText.indexOf(lowerQuery, idx)
        if (idx === -1) break
        matches.push({
          from: pos + idx,
          to: pos + idx + query.length,
          text: text.slice(idx, idx + query.length),
        })
        idx += 1
      }
    }
  })

  return matches
}

function createDecorations(doc: Node, matches: SearchMatch[], currentIndex: number): DecorationSet {
  const decorations: Decoration[] = []

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const cls = i === currentIndex ? 'search-match-current' : 'search-match'
    decorations.push(Decoration.inline(match.from, match.to, { class: cls }))
  }

  return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty
}

function scrollToMatch(editorView: any, pos: number) {
  const view = editorView as { coordsAtPos: (pos: number) => { top: number } | null; dom: HTMLElement }
  const editorDom = view.dom
  const coords = view.coordsAtPos(pos)
  if (!coords) return

  const editorRect = editorDom.getBoundingClientRect()
  const relativeTop = coords.top - editorRect.top + editorDom.scrollTop
  const centered = relativeTop - editorDom.clientHeight / 3
  editorDom.scrollTop = Math.max(0, centered)
}

type CommandContext = { editor: Editor }

export const InlineSearchExtension = Extension.create({
  name: 'inlineSearch',

  addCommands() {
    return {
      setSearchQuery:
        (query: string) =>
        ({ editor }: CommandContext) => {
          const tr = editor.state.tr.setMeta(searchPluginKey, { query })
          editor.view.dispatch(tr)
          return true
        },

      searchNext:
        () =>
        ({ editor }: CommandContext) => {
          const state = searchPluginKey.getState(editor.state) as SearchPluginState | undefined
          if (!state || state.matches.length === 0) return false
          const nextIndex = (state.currentIndex + 1) % state.matches.length
          const tr = editor.state.tr.setMeta(searchPluginKey, { currentIndex: nextIndex })
          editor.view.dispatch(tr)
          scrollToMatch(editor.view, state.matches[nextIndex].from)
          return true
        },

      searchPrev:
        () =>
        ({ editor }: CommandContext) => {
          const state = searchPluginKey.getState(editor.state) as SearchPluginState | undefined
          if (!state || state.matches.length === 0) return false
          const prevIndex = (state.currentIndex - 1 + state.matches.length) % state.matches.length
          const tr = editor.state.tr.setMeta(searchPluginKey, { currentIndex: prevIndex })
          editor.view.dispatch(tr)
          scrollToMatch(editor.view, state.matches[prevIndex].from)
          return true
        },

      clearSearch:
        () =>
        ({ editor }: CommandContext) => {
          const tr = editor.state.tr.setMeta(searchPluginKey, { query: '' })
          editor.view.dispatch(tr)
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init() {
            return { query: '', matches: [], currentIndex: 0, decorationSet: DecorationSet.empty } as any
          },
          apply(tr, prev: any, _oldState, newState) {
            const meta = tr.getMeta(searchPluginKey) as { query?: string; currentIndex?: number } | null
            const prevState = prev as { query: string; matches: SearchMatch[]; currentIndex: number; decorationSet: DecorationSet }

            if (meta) {
              const query = meta.query !== undefined ? meta.query : prevState.query
              const index = meta.currentIndex !== undefined ? meta.currentIndex : prevState.currentIndex

              if (meta.query !== undefined || (query && tr.docChanged)) {
                const matches = findMatches(newState.doc, query)
                const cappedIndex = matches.length > 0 ? Math.min(index, matches.length - 1) : 0
                const decorationSet = createDecorations(newState.doc, matches, cappedIndex)
                return { query, matches, currentIndex: cappedIndex, decorationSet }
              }

              if (meta.currentIndex !== undefined) {
                const decorationSet = createDecorations(newState.doc, prevState.matches, index)
                return { ...prevState, currentIndex: index, decorationSet }
              }
            }

            if (tr.docChanged && prevState.query) {
              const matches = findMatches(newState.doc, prevState.query)
              const cappedIndex = matches.length > 0 ? Math.min(prevState.currentIndex, matches.length - 1) : 0
              const decorationSet = createDecorations(newState.doc, matches, cappedIndex)
              return { ...prevState, matches, currentIndex: cappedIndex, decorationSet }
            }

            return prev
          },
        },
        props: {
          decorations(state) {
            const pluginState = searchPluginKey.getState(state) as any
            return pluginState?.decorationSet ?? DecorationSet.empty
          },
        },
      }),
    ]
  },
})
