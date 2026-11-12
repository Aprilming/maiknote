import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { isEmptyLineMarkerText } from '../emptyLine'

const emptyLineNormalizerKey = new PluginKey('emptyLineNormalizer')

/**
 * 把 Markdown 里当作空行标记的 &#8203;（零宽空格）段落，还原成真正的空段落。
 * - 只删除“只有空行标记”的段落里的文本节点；
 * - 用户敲的空格 / \u00A0（Tab 缩进）算实际内容，一律保留（否则空行行首按空格会被清掉）；
 * - 只含硬换行的段落保持原样（由 HardBreak 的 <br> 负责往返）。
 */
function buildNormalizeTransaction(state: EditorState): Transaction | null {
  const ranges: { from: number; to: number }[] = []

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph' || node.childCount === 0) return true

    let hasContent = false
    node.forEach((child) => {
      if (child.type.name === 'hardBreak') return
      if (child.isText && isEmptyLineMarkerText(child.text)) return
      hasContent = true
    })
    if (hasContent) return true

    node.forEach((child, offset) => {
      if (!child.isText || !isEmptyLineMarkerText(child.text)) return
      const from = pos + 1 + offset
      ranges.push({ from, to: from + child.nodeSize })
    })
    return true
  })

  if (ranges.length === 0) return null

  const tr = state.tr
  for (let i = ranges.length - 1; i >= 0; i -= 1) {
    tr.delete(ranges[i].from, ranges[i].to)
  }
  return tr.docChanged ? tr : null
}

export const EmptyLineNormalizer = Extension.create({
  name: 'emptyLineNormalizer',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: emptyLineNormalizerKey,
        // 初始加载由 AlignedParagraph 的 markdown.parse.updateDOM 处理；
        // 这里兜住粘贴 / setContent 等后续进入文档的空行标记
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null
          return buildNormalizeTransaction(newState)
        },
      }),
    ]
  },
})
