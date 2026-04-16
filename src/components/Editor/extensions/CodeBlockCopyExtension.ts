// src/components/Editor/extensions/CodeBlockCopyExtension.ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const codeBlockCopyKey = new PluginKey('codeBlockCopy')

export const CodeBlockCopyExtension = Extension.create({
  name: 'codeBlockCopy',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeBlockCopyKey,
        props: {
          decorations(state) {
            const decorations: Decoration[] = []

            state.doc.forEach((node, offset) => {
              if (node.type.name === 'codeBlock') {
                const copyButton = Decoration.widget(
                  offset + node.nodeSize - 2,
                  () => {
                    const btn = document.createElement('button')
                    btn.className = 'code-block-copy-btn'
                    btn.setAttribute('contenteditable', 'false')
                    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>`
                    btn.title = '复制代码'

                    btn.addEventListener('click', (e) => {
                      e.preventDefault()
                      e.stopPropagation()

                      // 获取代码块内容
                      const codeContent = node.textContent

                      // 复制到剪贴板
                      navigator.clipboard.writeText(codeContent).then(() => {
                        // 显示复制成功状态
                        btn.classList.add('copied')
                        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>`
                        btn.title = '已复制'

                        // 2秒后恢复原状
                        setTimeout(() => {
                          btn.classList.remove('copied')
                          btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>`
                          btn.title = '复制代码'
                        }, 2000)
                      }).catch((err) => {
                        console.error('复制失败:', err)
                      })
                    })

                    return btn
                  },
                  { side: 1, key: `copy-${offset}` }
                )

                decorations.push(copyButton)
              }
            })

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
