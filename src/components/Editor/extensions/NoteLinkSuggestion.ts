import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { VueRenderer } from '@tiptap/vue-3'
import NotePicker from '../NotePicker.vue'
import { updatePopupPosition } from './SlashCommandExtension'
import { sanitizeLinkTitle } from '@/composables/useNoteLinks'

// 斜杠菜单用的是默认 SuggestionPluginKey，这里必须另起一个，否则两个 suggestion 插件抢同一个 key
const noteLinkSuggestionKey = new PluginKey('noteLinkSuggestion')

export interface NoteLinkSuggestionOptions {
  /** 候选笔记（已排除当前笔记），每次唤出时现取，避免拿到旧列表 */
  getNotes: () => { id: string; title: string }[]
}

interface NotePickerItem {
  title: string
  command: 'picker'
}

/**
 * 输入 [[ 唤出笔记选择器，选中后写入 [[标题]] 纯文本。
 * 与 /link 共用 NotePicker 组件，只是唤出入口不同。
 */
export function createNoteLinkSuggestion(options: NoteLinkSuggestionOptions) {
  return Extension.create({
    name: 'noteLinkSuggestion',

    addOptions() {
      return {
        suggestion: {
          char: '[[',
          startOfLine: false,
          allowSpaces: true,
          pluginKey: noteLinkSuggestionKey,
          // 返回空 items 并不会关掉菜单，必须在 allow 里关。
          // 注意 allow 拿到的 state 是 EditorState（不是插件 state），query 只能从 range 的文本里取：
          // 末尾是 ']' 说明已经写完 ]] 或刚插入完 [[链接]]，此时直接让 suggestion 退出。
          allow: ({ state, range }: any) => {
            const text = state?.doc?.textBetween?.(range.from, range.to) ?? ''
            return !text.endsWith(']')
          },
          items: ({ query }: { query: string }) => {
            const q = query.trim()
            // 敲完 ]] 就把菜单收掉；其余情况都要保留菜单，空 query 时展示全部候选
            if (q.endsWith(']')) return []
            // 真正的过滤在选择器组件里做，这里只保证菜单保持打开
            return [{ title: q, command: 'picker' }] as NotePickerItem[]
          },
          command: ({
            editor,
            range,
            props,
          }: {
            editor: any
            range: any
            props: { title: string }
          }) => {
            const title = sanitizeLinkTitle(props?.title ?? '')
            if (!title) return
            editor.chain().focus().deleteRange(range).insertContent(`[[${title}]]`).run()
          },
          render: () => {
            let component: VueRenderer | null = null
            let popup: HTMLElement | null = null

            let latestProps: any = null
            // 选中过一条后就标记，避免插件状态残留时弹窗重新冒出来
            let picked = false

            const cleanup = () => {
              // 先摘 DOM，destroy 抛错也不会留下孤儿弹窗
              popup?.remove()
              popup = null
              try {
                component?.destroy()
              } catch {
                // ignore
              }
              component = null
            }

            return {
              onStart: (props: any) => {
                if (picked) {
                  cleanup()
                  return
                }
                latestProps = props
                const notes = options.getNotes()

                component = new VueRenderer(NotePicker, {
                  props: {
                    notes,
                    placeholder: '搜索要链接的笔记…',
                    emptyText: '没有匹配的笔记',
                    createLabel: '新建',
                    onSelect: (title: string) => {
                      picked = true
                      cleanup()
                      props.command({ title })
                    },
                    // NotePicker 用 emit 抛事件，VueRenderer 以 onXxx 形式接到

                    onCancel: () => {
                      cleanup()
                      latestProps?.editor?.commands?.focus?.()
                    },

                    // 选择器内部过滤/候选变化会改高度，文档没变不会走 onUpdate，这里补一次定位
                    onResize: () => updatePopupPosition(popup, latestProps ?? props),
                  },
                  editor: props.editor,
                })

                popup = document.createElement('div')
                popup.className = 'note-link-popup'
                document.body.appendChild(popup)
                if (component.element) popup.appendChild(component.element)
                updatePopupPosition(popup, props)
              },

              onUpdate: (props: any) => {
                if (!popup) return
                latestProps = props
                component?.updateProps({ notes: options.getNotes() })
                updatePopupPosition(popup, props)
              },

              onKeyDown: (props: any) => {
                if (props.event.key === 'Escape') {
                  cleanup()
                  return true
                }
                const ref = component?.ref as unknown as {
                  onKeyDown?: (e: KeyboardEvent) => boolean
                } | null
                return ref?.onKeyDown?.(props.event) ?? false
              },

              onExit: () => {
                cleanup()
                picked = false
              },
            }
          },
        } as any,
      }
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...(this.options as any).suggestion,
        }),
      ]
    },
  })
}
