import CodeBlock, { type CodeBlockOptions } from '@tiptap/extension-code-block'
import { findChildren, type Editor } from '@tiptap/core'
import type { Node as ProsemirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
// @ts-ignore highlight.js does not expose the core module types through this path
import highlight from 'highlight.js/lib/core'

export const refreshLowlightAfterImeMeta = 'refreshLowlightAfterIme'

interface CodeBlockLowlightImeSafeOptions extends CodeBlockOptions {
  lowlight: any
}

function imeDebugEnabled() {
  return typeof window !== 'undefined' && (window as any).__maiknoteImeDebug !== false
}

function imeDebug(phase: string, payload: Record<string, unknown> = {}) {
  if (!imeDebugEnabled()) return
  console.debug(`[MaikNote IME] ${phase}`, payload)
}

function parseNodes(nodes: any[], className: string[] = []): { text: string; classes: string[] }[] {
  return nodes
    .map((node) => {
      const classes = [...className, ...(node.properties ? node.properties.className : [])]

      if (node.children) {
        return parseNodes(node.children, classes)
      }

      return {
        text: node.value,
        classes,
      }
    })
    .flat()
}

function getHighlightNodes(result: any) {
  return result.value || result.children || []
}

function registered(aliasOrLanguage: string) {
  return Boolean(highlight.getLanguage(aliasOrLanguage))
}

function isImeComposing() {
  return Boolean((window as any).__imeComposing)
}

const IME_GUARD_WINDOW_MS = 500

type KeyboardShortcutCommand = (props: { editor: Editor }) => boolean

/** 代码块里的真实文本：排除复制按钮等 widget 节点自带的空白 */
function codeBlockDomText(dom: HTMLElement): string {
  const code = dom.querySelector('code') ?? dom
  const clone = code.cloneNode(true) as HTMLElement

  clone.querySelectorAll('button, img, br, [contenteditable="false"]').forEach((el) => el.remove())

  return clone.textContent ?? ''
}

/** 代码块 DOM 里存在尚未进入文档的文本（输入法组合态只活在 DOM 中） */
function hasUncommittedCodeBlockText(editor: Editor): boolean {
  const { state, view } = editor
  const { $head } = state.selection

  if ($head.parent.type.name !== 'codeBlock') return false

  const dom = view.nodeDOM($head.before($head.depth))
  if (!(dom instanceof HTMLElement)) return false

  return codeBlockDomText(dom).length > $head.parent.textContent.length
}

/** CodeBlock 自带的 Backspace 会销毁节点：光标在文档首的块首，或块内没有文本时 clearNodes() */
function isCodeBlockDestructionTarget(editor: Editor): boolean {
  const { $head, empty } = editor.state.selection

  if ($head.parent.type.name !== 'codeBlock') return false
  if (!empty) return false

  return $head.pos === 1 || $head.parent.textContent.length === 0
}

function imeActiveRecently(): boolean {
  const win = window as any
  if (win.__imeComposing) return true

  const endedAt = typeof win.__imeEndedAt === 'number' ? win.__imeEndedAt : 0

  return Boolean(endedAt) && performance.now() - endedAt < IME_GUARD_WINDOW_MS
}

/**
 * 输入法组合期间，组合文本往往只存在于 DOM、尚未进入文档，ProseMirror 眼里的代码块仍是「空块」。
 * 此时 CodeBlock 自带的 Backspace（clearNodes）会把代码块换成段落，随后上屏的中文落进段落，
 * 表现为「代码块没了，只剩字」。只有确认没有未提交文本时才允许这些销毁型快捷键。
 */
function imeProtectsCodeBlock(editor: Editor): boolean {
  if (!isCodeBlockDestructionTarget(editor)) return false
  if (imeActiveRecently()) return true

  return hasUncommittedCodeBlockText(editor)
}

function withImeGuard(shortcut?: KeyboardShortcutCommand): KeyboardShortcutCommand {
  return (props) => {
    if (imeProtectsCodeBlock(props.editor)) return true
    return shortcut ? shortcut(props) : false
  }
}

function getActiveCodeBlockRange(doc: ProsemirrorNode, name: string, pos: number) {
  return findChildren(doc, (node) => node.type.name === name)
    .map((block) => ({ from: block.pos, to: block.pos + block.node.nodeSize }))
    .find((range) => pos >= range.from && pos <= range.to)
}

function getDecorations({
  doc,
  name,
  lowlight,
  defaultLanguage,
  skipRange,
}: {
  doc: ProsemirrorNode
  name: string
  lowlight: any
  defaultLanguage: string | null | undefined
  skipRange?: { from: number; to: number }
}) {
  const decorations: Decoration[] = []

  findChildren(doc, (node) => node.type.name === name).forEach((block) => {
    if (skipRange && block.pos >= skipRange.from && block.pos + block.node.nodeSize <= skipRange.to) {
      return
    }

    let from = block.pos + 1
    const language = block.node.attrs.language || defaultLanguage
    const languages = lowlight.listLanguages()

    const nodes =
      language && (languages.includes(language) || registered(language) || lowlight.registered?.(language))
        ? getHighlightNodes(lowlight.highlight(language, block.node.textContent))
        : getHighlightNodes(lowlight.highlightAuto(block.node.textContent))

    parseNodes(nodes).forEach((node) => {
      const to = from + node.text.length

      if (node.classes.length) {
        decorations.push(Decoration.inline(from, to, { class: node.classes.join(' ') }))
      }

      from = to
    })
  })

  return DecorationSet.create(doc, decorations)
}

function isFunction(param: any): param is Function {
  return typeof param === 'function'
}

function LowlightImeSafePlugin({
  name,
  lowlight,
  defaultLanguage,
}: {
  name: string
  lowlight: any
  defaultLanguage: string | null | undefined
}) {
  if (!['highlight', 'highlightAuto', 'listLanguages'].every((api) => isFunction(lowlight[api]))) {
    throw Error('You should provide an instance of lowlight to use the code-block-lowlight extension')
  }

  const plugin: Plugin<DecorationSet> = new Plugin({
    key: new PluginKey('lowlight-ime-safe'),

    state: {
      init: (_, { doc }) => getDecorations({ doc, name, lowlight, defaultLanguage }),
      apply: (transaction, decorationSet, oldState, newState) => {
        if (transaction.getMeta(refreshLowlightAfterImeMeta)) {
          imeDebug('lowlight recompute:refresh-meta', {
            docChanged: transaction.docChanged,
            selection: { from: newState.selection.from, to: newState.selection.to },
          })
          return getDecorations({ doc: transaction.doc, name, lowlight, defaultLanguage })
        }

        const activeCodeBlockRange = getActiveCodeBlockRange(newState.doc, name, newState.selection.$head.pos)

        if (transaction.docChanged && isImeComposing() && activeCodeBlockRange) {
          const node = transaction.doc.nodeAt(activeCodeBlockRange.from)
          imeDebug('lowlight skip active codeBlock during composition', {
            activeCodeBlockRange,
            text: node?.textContent,
            stepCount: transaction.steps.length,
          })
          return getDecorations({
            doc: transaction.doc,
            name,
            lowlight,
            defaultLanguage,
            skipRange: activeCodeBlockRange,
          })
        }

        const oldNodeName = oldState.selection.$head.parent.type.name
        const newNodeName = newState.selection.$head.parent.type.name
        const oldNodes = findChildren(oldState.doc, (node) => node.type.name === name)
        const newNodes = findChildren(newState.doc, (node) => node.type.name === name)

        if (
          transaction.docChanged &&
          ([oldNodeName, newNodeName].includes(name) ||
            newNodes.length !== oldNodes.length ||
            transaction.steps.some((step) => {
              const stepWithRange = step as unknown as { from?: number; to?: number }

              return (
                stepWithRange.from !== undefined &&
                stepWithRange.to !== undefined &&
                oldNodes.some((node) => node.pos >= stepWithRange.from! && node.pos + node.node.nodeSize <= stepWithRange.to!)
              )
            }))
        ) {
          imeDebug('lowlight recompute:docChanged', {
            oldNodeName,
            newNodeName,
            composing: isImeComposing(),
            activeCodeBlockRange,
            stepCount: transaction.steps.length,
          })
          return getDecorations({ doc: transaction.doc, name, lowlight, defaultLanguage })
        }

        if (transaction.docChanged && activeCodeBlockRange) {
          imeDebug('lowlight map existing decorations', {
            composing: isImeComposing(),
            activeCodeBlockRange,
            stepCount: transaction.steps.length,
          })
        }

        return decorationSet.map(transaction.mapping, transaction.doc)
      },
    },

    props: {
      decorations(state) {
        return plugin.getState(state)
      },
    },
  })

  return plugin
}

export const CodeBlockLowlightImeSafe = CodeBlock.extend<CodeBlockLowlightImeSafeOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      lowlight: {},
      languageClassPrefix: 'language-',
      exitOnTripleEnter: true,
      exitOnArrowDown: true,
      defaultLanguage: null,
      HTMLAttributes: {},
    }
  },

  addKeyboardShortcuts() {
    const parent = this.parent?.() || {}

    return {
      ...parent,
      Backspace: withImeGuard(parent.Backspace),
      ArrowDown: withImeGuard(parent.ArrowDown),
    }
  },

  addProseMirrorPlugins() {
    return [
      ...this.parent?.() || [],
      LowlightImeSafePlugin({
        name: this.name,
        lowlight: this.options.lowlight,
        defaultLanguage: this.options.defaultLanguage,
      }),
    ]
  },
})
