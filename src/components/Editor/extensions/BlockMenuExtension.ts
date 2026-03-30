// src/components/extensions/BlockMenuExtension.ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Fragment } from '@tiptap/pm/model'

const blockMenuKey = new PluginKey('blockMenu')

export const BlockMenuExtension = Extension.create({
  name: 'blockMenu',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockMenuKey,
        props: {
          handleDrop(view, event, _slice, _moved) {
            console.log('[BlockMenu] handleDrop called')
            const sel = view.state.selection
            if (!(sel instanceof NodeSelection)) {
              console.log('[BlockMenu] not a NodeSelection')
              return false
            }

            const coords = { left: event.clientX, top: event.clientY }
            const dropPos = view.posAtCoords(coords)
            if (!dropPos) return false

            const resolvedPos = view.state.doc.resolve(dropPos.pos)
            const node = sel.node
            const from = sel.from
            const to = sel.to

            let targetPos = resolvedPos.before(resolvedPos.depth)
            if (targetPos >= from) {
              targetPos = resolvedPos.after(resolvedPos.depth)
            }

            const tr = view.state.tr.delete(from, to)
            const inserted = tr.mapping.map(targetPos)
            tr.insert(inserted, node)
            view.dispatch(tr.scrollIntoView())

            return true
          },
          decorations(state) {
            console.log('[BlockMenu] decorations called, doc child count:', state.doc.childCount)
            const decorations: Decoration[] = []

            state.doc.forEach((node, offset) => {
              if (node.type.name === 'doc') return

              const widget = Decoration.widget(
                offset + 1,
                () => {
                  const btn = document.createElement('button')
                  btn.className = 'block-menu-trigger'
                  btn.setAttribute('contenteditable', 'false')
                  btn.setAttribute('draggable', 'true')
                  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/>
                    <circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/>
                    <circle cx="5" cy="12" r="1.5"/><circle cx="11" cy="12" r="1.5"/>
                  </svg>`
                  btn.dataset.nodePos = String(offset)

                  btn.addEventListener('dragstart', (e) => {
                    console.log('[BlockMenu] dragstart fired on btn')
                    if (!(e instanceof DragEvent)) return

                    const editorView = (window as any).__tiptapEditorView
                    if (!editorView) return

                    const pos = parseInt(btn.dataset.nodePos || '0', 10)
                    const nodeSelection = NodeSelection.create(editorView.state.doc, pos)
                    editorView.dispatch(editorView.state.tr.setSelection(nodeSelection))

                    const slice = nodeSelection.content()
                    const div = document.createElement('div')
                    const fragment = Fragment.fromJSON(editorView.state.schema, slice.content.toJSON())
                    div.appendChild(div.ownerDocument.createTextNode(fragment.textBetween(0, fragment.size, '\n')))

                    e.dataTransfer?.setData('text/plain', div.textContent || '')
                    e.dataTransfer!.effectAllowed = 'move'

                    editorView.dragging = { slice, move: true }
                  })

                  btn.addEventListener('mousedown', (e) => {
                    e.stopPropagation()
                  })

                  btn.addEventListener('click', (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    btn.dispatchEvent(new CustomEvent('block-menu-open', {
                      bubbles: true,
                      detail: {
                        pos: offset,
                        nodeType: node.type.name,
                        nodeSize: node.nodeSize,
                        rect: btn.getBoundingClientRect(),
                      },
                    }))
                  })

                  return btn
                },
                { side: -1, key: `bm-${offset}` }
              )

              decorations.push(widget)
            })

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
