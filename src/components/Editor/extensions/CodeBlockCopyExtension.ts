// src/components/Editor/extensions/CodeBlockCopyExtension.ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { copyText } from '@/utils/clipboard'

const codeBlockCopyKey = new PluginKey('codeBlockCopy')

const COPY_ICON = `<svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
</svg>`
const DONE_ICON = `<svg class="done-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <polyline points="20 6 9 17 4 12"></polyline>
</svg>`

/** 复制按钮 DOM 上的状态附加字段 */
interface CopyButtonEl extends HTMLButtonElement {
  __resetTimer?: number
}

export const CodeBlockCopyExtension = Extension.create({
  name: 'codeBlockCopy',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeBlockCopyKey,
        props: {
          decorations(state) {
            const decorations: Decoration[] = []

            // 用 descendants 而不是 forEach：列表 / 引用块里嵌套的代码块也要有复制按钮
            state.doc.descendants((node: PMNode, pos: number) => {
              if (node.type.name !== 'codeBlock') return true
              decorations.push(
                Decoration.widget(
                  pos + 1,
                  (view: EditorView, getPos: () => number | undefined) =>
                    createCopyButton(view, getPos),
                  {
                    side: 1,
                    key: `copy-${pos}`,
                    ignoreSelection: true,
                    relaxedSide: true,
                    // 事件冒泡到编辑器时直接忽略，避免 ProseMirror 抢焦点 / 改选区
                    stopEvent: (event: Event) => {
                      const target = event.target as HTMLElement | null
                      return !!target?.closest?.('.code-block-copy-btn')
                    },
                  }
                )
              )
              // 代码块内部没有其它可递归的块节点，直接跳过子节点
              return false
            })

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})

/** 从编辑器实时状态取代码块内容，避免闭包里拿到旧文档 */
function readCodeAt(view: EditorView, pos: number | undefined): string | null {
  if (typeof pos !== 'number' || pos < 0 || pos > view.state.doc.content.size) return null
  const $pos = view.state.doc.resolve(pos)
  const node = $pos.parent.type.name === 'codeBlock' ? $pos.parent : view.state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'codeBlock') return null
  return node.textContent
}

/** 兜底：位置映射失效时直接从 DOM 读（code 元素不含语言按钮） */
function readCodeFromDom(btn: HTMLElement): string | null {
  const pre = btn.closest('pre')
  if (!pre) return null
  const code = pre.querySelector('code')
  return (code ?? pre).textContent
}

function createCopyButton(view: EditorView, getPos: () => number | undefined): CopyButtonEl {
  const btn = document.createElement('button') as CopyButtonEl
  btn.type = 'button'
  btn.className = 'code-block-copy-btn'
  btn.setAttribute('contenteditable', 'false')
  btn.setAttribute('tabindex', '-1')
  btn.setAttribute('aria-label', '复制代码')
  btn.innerHTML = COPY_ICON + DONE_ICON
  btn.title = '复制代码'
  btn.draggable = false

  let lastCopyAt = 0

  // 只切 class，不改 DOM 结构：避免按钮内部变动被 ProseMirror 当成文档变更重新解析
  const flashDone = () => {
    btn.classList.add('copied')
    btn.title = '已复制'
    if (btn.__resetTimer) window.clearTimeout(btn.__resetTimer)
    btn.__resetTimer = window.setTimeout(() => {
      btn.__resetTimer = undefined
      btn.classList.remove('copied')
      btn.title = '复制代码'
    }, 1500)
  }

  const doCopy = () => {
    // mousedown 与 click 会连续触发，150ms 内只处理一次
    const now = Date.now()
    if (now - lastCopyAt < 150) return
    lastCopyAt = now

    const code = readCodeAt(view, getPos()) ?? readCodeFromDom(btn)
    if (code == null) return

    void copyText(code).then((ok) => {
      if (ok) {
        flashDone()
      } else {
        btn.title = '复制失败，请重试'
      }
    })
  }

  // 用 mousedown 触发：不依赖 click 事件能否配对成功（首次点击常被焦点/选区变化吞掉）
  btn.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    doCopy()
  })

  // 键盘 / 触控板等手段触发的 click 仍可用
  btn.addEventListener('click', (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    doCopy()
  })

  btn.addEventListener('dragstart', (e: DragEvent) => e.preventDefault())

  return btn
}
