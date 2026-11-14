import { Extension } from '@tiptap/core'
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion'
import { VueRenderer } from '@tiptap/vue-3'
import SlashCommandList from './SlashCommandList.vue'

export interface SlashCommandItem {
  title: string
  command: string
  icon?: string
}

// 弹出框与窗口边缘的留白
const POPUP_GAP = 8

// 更新弹出框位置的辅助函数
// 光标靠近窗口底部时，菜单会被窗口下沿裁掉，所以下方放不下就翻到光标上方，
// 上下都放不下时再夹在可视区内（同时限高，超出的部分在菜单内部滚动）。
function updatePopupPosition(popup: HTMLElement | null, props: any) {
  if (!popup) return

  const { clientRect } = props
  if (!clientRect) return

  const rect = clientRect()
  if (!rect) return

  const viewportW = window.innerWidth
  const viewportH = window.innerHeight

  popup.style.position = 'fixed'
  popup.style.zIndex = '9999'
  popup.style.maxHeight = `${Math.max(120, viewportH - POPUP_GAP * 2)}px`

  // 首次定位时内容刚挂上去，量一次实际尺寸
  const width = popup.offsetWidth || 240
  const height = popup.offsetHeight || 260

  let top = rect.bottom + POPUP_GAP
  if (top + height > viewportH - POPUP_GAP) {
    const above = rect.top - POPUP_GAP - height
    top = above >= POPUP_GAP ? above : Math.max(POPUP_GAP, viewportH - POPUP_GAP - height)
  }

  const left = Math.min(
    Math.max(POPUP_GAP, rect.left),
    Math.max(POPUP_GAP, viewportW - POPUP_GAP - width),
  )

  popup.style.left = `${left}px`
  popup.style.top = `${top}px`
}

export function createSlashCommand() {
  return Extension.create({
    name: 'slashCommand',

    addOptions() {
      return {
        suggestion: {
          char: '/',
          startOfLine: false,
          allowSpaces: false,
          command: ({ editor, range, props }: { editor: any; range: any; props: any }) => {
            editor.chain().focus().deleteRange(range).run()
            // 根据 command 字符串执行相应的编辑器命令
            switch (props.command) {
              case 'paragraph':
                editor.chain().focus().setParagraph().run()
                break
              case 'heading1':
                editor.chain().focus().toggleHeading({ level: 1 }).run()
                break
              case 'heading2':
                editor.chain().focus().toggleHeading({ level: 2 }).run()
                break
              case 'heading3':
                editor.chain().focus().toggleHeading({ level: 3 }).run()
                break
              case 'bulletList':
                editor.chain().focus().toggleBulletList().run()
                break
              case 'orderedList':
                editor.chain().focus().toggleOrderedList().run()
                break
              case 'todo':
                editor.chain().focus().insertContent('- [ ] ').run()
                break
              case 'blockquote':
                editor.chain().focus().toggleBlockquote().run()
                break
              case 'code':
                editor.chain().focus().toggleCodeBlock().run()
                break
            }
          },
          render: () => {
            let component: VueRenderer | null = null
            let popup: HTMLElement | null = null

            return {
              onStart: (props: any) => {
                // 创建容器
                popup = document.createElement('div')
                popup.className = 'slash-command-popup'
                document.body.appendChild(popup)

                // 创建 Vue 组件，传递必要props
                component = new VueRenderer(SlashCommandList, {
                  props: {
                    ...props,
                    range: props.range,
                  },
                  editor: props.editor,
                })

                // 渲染到容器
                if (popup && component.el) {
                  popup.appendChild(component.el)
                }

                // 定位弹出框：挂载当帧还没量到真实高度，下一帧按实际尺寸再校一次
                updatePopupPosition(popup, props)
                requestAnimationFrame(() => updatePopupPosition(popup, props))
              },

              onUpdate: (props: any) => {
                // 更新props，包括range
                component?.updateProps({
                  ...props,
                  range: props.range,
                })
                // 通知组件更新过滤
                component?.ref?.onQueryUpdate?.(props.query)
                updatePopupPosition(popup, props)
                requestAnimationFrame(() => updatePopupPosition(popup, props))
              },

              onKeyDown: (props: any) => {
                if (props.event.key === 'Escape') {
                  popup?.remove()
                  return true
                }
                return component?.ref?.onKeyDown(props.event) ?? false
              },

              onExit: () => {
                popup?.remove()
                component?.destroy()
                component = null
                popup = null
              },
            }
          },

          // 搜索过滤由 SlashCommandList 按 i18n 文案自己完成（标题、表格、日期等命令都以它的列表为准）。
          // 这里只返回一个非空占位：suggestion 在 items 返回空数组时会直接关掉菜单，
          // 早先这里按另一份硬编码标题过滤，导致 /table、/date 之类查不到就把菜单收起来了。
          items: () => [{ title: 'slash', command: 'noop' }],
        } as Partial<SuggestionOptions>,
      }
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ]
    },
  })
}
