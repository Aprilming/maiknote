// src/components/Editor/extensions/CodeBlockSelectAllExtension.ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'

const codeBlockSelectAllKey = new PluginKey('codeBlockSelectAll')

export const CodeBlockSelectAllExtension = Extension.create({
  name: 'codeBlockSelectAll',

  addKeyboardShortcuts() {
    return {
      // Cmd+A (macOS) 或 Ctrl+A (Windows/Linux)
      'Mod-a': () => {
        const { editor } = this
        const { state } = editor
        const { selection } = state

        // 查找当前光标所在的代码块
        const $pos = state.doc.resolve(selection.from)
        let codeBlockNode = null
        let codeBlockStart = -1

        // 向上遍历查找 codeBlock
        for (let depth = $pos.depth; depth >= 0; depth--) {
          const node = $pos.node(depth)
          if (node.type.name === 'codeBlock') {
            codeBlockNode = node
            codeBlockStart = $pos.before(depth)
            break
          }
        }

        // 如果在代码块内，只选择代码块内容
        if (codeBlockNode && codeBlockStart !== -1) {
          // 计算代码块内容的起始和结束位置
          // codeBlock 节点结构: <codeBlock> text... </codeBlock>
          // 所以内容从 codeBlockStart + 1 开始，到 codeBlockStart + codeBlockNode.nodeSize - 1 结束
          const codeStart = codeBlockStart + 1
          const codeEnd = codeBlockStart + codeBlockNode.nodeSize - 1

          const newSelection = TextSelection.create(state.doc, codeStart, codeEnd)
          const tr = state.tr.setSelection(newSelection)
          editor.view.dispatch(tr)
          return true
        }

        // 不在代码块内，让默认行为处理
        return false
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeBlockSelectAllKey,
      }),
    ]
  },
})
