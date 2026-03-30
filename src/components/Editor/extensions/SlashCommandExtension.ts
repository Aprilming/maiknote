import { Extension } from '@tiptap/core'
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion'
import { VueRenderer } from '@tiptap/vue-3'
import SlashCommandList from './SlashCommandList.vue'

export interface SlashCommandItem {
  title: string
  command: string
  icon?: string
}

// 更新弹出框位置的辅助函数
function updatePopupPosition(popup: HTMLElement | null, props: any) {
  if (!popup) return

  const { clientRect } = props
  if (!clientRect) return

  const rect = clientRect()
  if (!rect) return

  popup.style.position = 'fixed'
  popup.style.left = `${rect.left}px`
  popup.style.top = `${rect.bottom + 8}px`
  popup.style.zIndex = '9999'
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

                // 定位弹出框
                updatePopupPosition(popup, props)
              },

              onUpdate: (props: any) => {
                // 更新props，包括range
                component?.updateProps({
                  ...props,
                  range: props.range,
                })
                updatePopupPosition(popup, props)
                // 通知组件更新过滤
                component?.ref?.onQueryUpdate?.(props.query)
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

          items: ({ query }: { query: string }) => {
            const allItems = [
              { title: '文本', command: 'paragraph' },
              { title: '标题 1', command: 'heading1' },
              { title: '标题 2', command: 'heading2' },
              { title: '标题 3', command: 'heading3' },
              { title: '无序列表', command: 'bulletList' },
              { title: '有序列表', command: 'orderedList' },
              { title: '待办事项', command: 'todo' },
              { title: '引用', command: 'blockquote' },
              { title: '代码块', command: 'code' },
            ]
            return allItems.filter(item =>
              item.title.toLowerCase().includes(query.toLowerCase())
            )
          },
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
