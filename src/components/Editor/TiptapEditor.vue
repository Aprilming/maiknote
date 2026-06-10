<script setup lang="ts">
import { watch, watchEffect, onMounted, onUnmounted, ref, computed } from 'vue'
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import Placeholder from '@tiptap/extension-placeholder'
import BubbleMenuExtension from '@tiptap/extension-bubble-menu'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import { useSettingStore } from '@/stores/settingStore'
import { useAssistantsStore } from '@/stores/assistantsStore'
import { callBaiduSearch } from '@/composables/useBaiduSearch'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { all, createLowlight } from 'lowlight'
import { createSlashCommand } from './extensions/SlashCommandExtension'
import { Color } from '@tiptap/extension-color'
import TextStyle from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import FontFamily from '@tiptap/extension-font-family'
import Link from '@tiptap/extension-link'
import { CodeBlockCopyExtension } from './extensions/CodeBlockCopyExtension'
import { CodeBlockLanguageExtension } from './extensions/CodeBlockLanguageExtension'
import { InlineSearchExtension, searchPluginKey } from './extensions/InlineSearchExtension'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { TextSelection, AllSelection } from 'prosemirror-state'
import { useFileSystem } from '@/composables/useFileSystem'
import { openUrl } from '@tauri-apps/plugin-opener'

const lowlight = createLowlight(all)

const settingStore = useSettingStore()
const assistantsStore = useAssistantsStore()
const fileSystem = useFileSystem()

// 动态加载代码高亮主题 CSS
let currentHighlightCss: HTMLLinkElement | null = null

function loadHighlightCss(theme: string) {
  // 移除已加载的 CSS
  if (currentHighlightCss) {
    currentHighlightCss.remove()
    currentHighlightCss = null
  }

  // 创建新的 link 元素
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `highlight.js/styles/${theme}.css`
  link.onload = () => {
    currentHighlightCss = link
  }
  link.onerror = () => {
    console.warn(`Failed to load highlight.js theme: ${theme}, falling back to default`)
    // 加载默认主题作为后备
    const defaultLink = document.createElement('link')
    defaultLink.rel = 'stylesheet'
    defaultLink.href = 'highlight.js/styles/default.css'
    document.head.appendChild(defaultLink)
  }
  document.head.appendChild(link)
}

// 初始化加载默认主题
loadHighlightCss(settingStore.settings.codeTheme)

const props = defineProps<{
  initialContent: string
  fontSize: number
  fontFamily: string
  isLocked: boolean
  noteBgColor?: string
}>()

const emit = defineEmits<{
  update: [markdown: string]
}>()

// 右键菜单
const contextMenuVisible = ref(false)
const contextMenuRef = ref<HTMLElement>()
const contextMenuStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' })
const savedSelectionText = ref('') // 保存右键菜单打开时的选中文本
// 存储右键点击前的 ProseMirror 选区快照（用于在右键处理完成后恢复）
let rightClickSnapshot: { from: number; to: number } | null = null

// AI 相关
const isAILoading = ref(false)
let pendingSelectionText = '' // 待处理的选中文本（用于传递给AI）
let contentBeforeSelection = '' // 选中内容之前的内容
let contentAfterSelection = '' // 选中内容之后的内容
let userHadSelection = false   // 用户发起 AI 请求时是否有选中文本
let originalContent = '' // 原始编辑器内容（用于匹配失败时保留原文）
let aiAbortController: AbortController | null = null

const hasAIConfig = computed(() => true) // 始终显示菜单，未配置时点击会提示

// 用户助手列表（排除模板助手）
const userAssistants = computed(() => {
  return assistantsStore.assistants.filter(a => !a.id.startsWith('template-'))
})

// Toast 通知函数
function showToast(message: string, duration = 2000) {
  const toast = document.createElement('div')
  toast.textContent = message
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.8);
    color: #fff;
    padding: 10px 20px;
    border-radius: 4px;
    z-index: 10000;
    font-size: 14px;
  `
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), duration)
}

// 停止 AI 请求
function stopAI() {
  if (aiAbortController) {
    aiAbortController.abort()
    aiAbortController = null
    isAILoading.value = false
    document.body.style.cursor = ''
    showToast('已停止')
  }
}

// 右键菜单处理
function handleContextMenu(e: MouseEvent) {
  // 锁定状态下不显示右键菜单
  if (props.isLocked) {
    e.preventDefault()
    return
  }

  // 使用右键点击前的选区快照（handleContextMenu 在 capture 阶段触发时，
  // macOS WebKit 可能已经在底层原生层面修改了 DOM 选区，故不能信任当前值）
  if (rightClickSnapshot) {
    const { from, to } = rightClickSnapshot
    if (from !== to && editor.value) {
      savedSelectionText.value = editor.value.state.doc.textBetween(from, to, ' ')
    } else {
      savedSelectionText.value = ''
    }
  } else if (editor.value) {
    const { from, to } = editor.value.state.selection
    if (from !== to) {
      savedSelectionText.value = editor.value.state.doc.textBetween(from, to, ' ')
    } else {
      savedSelectionText.value = ''
    }
  }

  // 阻止默认行为
  e.preventDefault()

  // 计算菜单位置
  const menuWidth = 180
  const menuHeight = 200
  let left = e.clientX
  let top = e.clientY

  // 避免超出右边界
  if (left + menuWidth > window.innerWidth) {
    left = window.innerWidth - menuWidth - 10
  }
  // 避免超出下边界
  if (top + menuHeight > window.innerHeight) {
    top = window.innerHeight - menuHeight - 10
  }

  contextMenuStyle.value = {
    left: `${left}px`,
    top: `${top}px`
  }
  contextMenuVisible.value = true

  // 在下一个 macrotask 恢复选区：macOS 原生右键处理会在事件分发前后修改 DOM 选区
  // setTimeout(0) 确保在所有同步事件 + 微任务（含 MutationObserver）完成后恢复
  if (rightClickSnapshot) {
    const saved = rightClickSnapshot
    setTimeout(() => {
      if (editor.value) {
        const cur = editor.value.state.selection
        if (cur.from !== saved.from || cur.to !== saved.to) {
          editor.value.chain().setTextSelection(saved).run()
        }
      }
      rightClickSnapshot = null
    }, 0)
  }
}

// 隐藏右键菜单
function hideContextMenu() {
  contextMenuVisible.value = false
  savedSelectionText.value = ''
  rightClickSnapshot = null
}

// 点击编辑器容器时确保光标正确放置
function handleWrapperClick(e: MouseEvent) {
  if (!editor.value) {
    return
  }

  // 如果点击的是编辑器内部元素，让编辑器自己处理
  const target = e.target as HTMLElement
  if (target.closest('.ProseMirror')) {
    return
  }
  if (target.closest('.bubble-menu') || target.closest('.ai-loading-indicator')) {
    return
  }

  // 点击空白区域时，将光标设置到点击位置
  const view = editor.value.view
  const coords = { left: e.clientX, top: e.clientY }
  let domPos = view.posAtCoords(coords)

  let targetPos: number

  if (domPos && domPos.pos >= 0) {
    targetPos = domPos.pos
  } else {
    const doc = view.state.doc
    const clickY = e.clientY

    let bestPos = 0

    doc.descendants((node, pos) => {
      if (node.isBlock && pos >= 0) {
        try {
          const blockCoords = view.coordsAtPos(pos)
          if (blockCoords.top >= clickY) {
            bestPos = pos
            return false
          }
          bestPos = pos + node.nodeSize
        } catch (e) {
          // ignore
        }
      }
    })

    targetPos = Math.min(bestPos, doc.content.size)
  }

  const $pos = view.state.doc.resolve(targetPos)
  const selection = TextSelection.near($pos, -1)
  view.dispatch(view.state.tr.setSelection(selection))
  view.dom.focus()
}

// AI 处理函数
function handleAI(assistantId: string) {
  // 先保存选中文本（避免 hideContextMenu 清空它）
  pendingSelectionText = savedSelectionText.value

  // 判断是否有选中文本
  userHadSelection = false
  contentBeforeSelection = ''
  contentAfterSelection = ''
  originalContent = ''

  // 使用首尾片段匹配来定位选中文本（逐步递减长度）
  if (editor.value && savedSelectionText.value) {
    const fullContent = editor.value.storage.markdown.getMarkdown()
    const text = pendingSelectionText

    const MAX_PREFIX_SUFFIX = 15
    const MIN_PREFIX_SUFFIX = 5

    let prefixIndex = -1
    let suffixIndex = -1
    let matchedSuffixLength = 0

    // 前缀匹配：从长到短递减，直到匹配成功或小于最小长度
    for (let len = MAX_PREFIX_SUFFIX; len >= MIN_PREFIX_SUFFIX; len--) {
      const prefix = text.slice(0, len)
      prefixIndex = fullContent.indexOf(prefix)
      if (prefixIndex !== -1) {
        break
      }
    }

    // 后缀匹配：从长到短递减，直到匹配成功或小于最小长度
    for (let len = MAX_PREFIX_SUFFIX; len >= MIN_PREFIX_SUFFIX; len--) {
      const suffix = text.slice(-len)
      const searchFrom = prefixIndex !== -1 ? prefixIndex : 0
      const found = fullContent.indexOf(suffix, searchFrom)
      if (found !== -1) {
        suffixIndex = found
        matchedSuffixLength = len
        break
      }
    }

    if (prefixIndex !== -1 && suffixIndex !== -1 && prefixIndex < suffixIndex) {
      // 找到了前缀和后缀，用它们来精确计算位置
      contentBeforeSelection = fullContent.slice(0, prefixIndex)
      contentAfterSelection = fullContent.slice(suffixIndex + matchedSuffixLength)
      userHadSelection = true
    } else if (prefixIndex !== -1) {
      // 只找到前缀，用 text.length 估算
      contentBeforeSelection = fullContent.slice(0, prefixIndex)
      contentAfterSelection = fullContent.slice(prefixIndex + text.length)
      userHadSelection = true
    } else {
      // 匹配失败：保存原文用于流式输出
      originalContent = fullContent
    }
  }

  hideContextMenu()
  const assistant = assistantsStore.getAssistantById(assistantId)
  console.log('[BaiduSearch] 选中助手:', assistant?.name, 'searchEnabled:', assistant?.searchEnabled, 'baiduSearchKey exists:', !!settingStore.settings.baiduSearchKey)
  if (!settingStore.settings.aiUrl || !settingStore.settings.aiKey || !settingStore.settings.aiModel) {
    showToast('请先在设置中配置 AI')
    return
  }
  callAI(assistantId)
}

// 调用AI API（流式响应 + 请求取消）
async function callAI(assistantId: string) {
  // 如果已有请求在运行，先取消
  if (aiAbortController) {
    aiAbortController.abort()
    aiAbortController = null
  }

  isAILoading.value = true
  document.body.style.cursor = 'wait'

  const text = String(pendingSelectionText || editor.value?.storage.markdown.getMarkdown() || '')

  // 根据ID获取助手配置
  const assistant = assistantsStore.getAssistantById(assistantId)
  if (!assistant) {
    showToast('未找到对应的 AI 助手')
    isAILoading.value = false
    document.body.style.cursor = ''
    return
  }
  const prompt = String(assistant.prompt || '')

  // 百度搜索增强：如果助手启用了搜索且有 API Key，先搜索获取实时信息
  let searchContext = ''
  console.log('[BaiduSearch] 检查搜索条件:', { searchEnabled: assistant.searchEnabled, hasKey: !!settingStore.settings.baiduSearchKey, keyLen: settingStore.settings.baiduSearchKey?.length })
  if (assistant.searchEnabled && settingStore.settings.baiduSearchKey) {
    showToast('正在搜索...')
    try {
      const searchQuery = pendingSelectionText || text.slice(0, 200)
      console.log('[BaiduSearch] 开始搜索, query:', searchQuery)
      const searchResult = await callBaiduSearch(searchQuery, settingStore.settings.baiduSearchKey, {
        resource_type_filter: [{ type: 'web', top_k: 5 }],
      })
      console.log('[BaiduSearch] 搜索结果长度:', searchResult.length)
      searchContext = `\n\n以下是与用户问题相关的互联网搜索结果（仅供事实参考，请基于搜索结果和你的知识综合回答）：\n${searchResult}\n\n请基于以上搜索结果和你的知识，完成用户请求。`
    } catch (e) {
      console.error('[BaiduSearch] 搜索失败:', e)
      showToast(`搜索失败: ${e instanceof Error ? e.message : '未知错误'}，将继续处理`)
    }
  }

  console.log('[BaiduSearch] 最终 searchContext 长度:', searchContext.length, '将注入 LLM')

  aiAbortController = new AbortController()
  const signal = aiAbortController.signal

  try {
    const response = await fetch(`${settingStore.settings.aiUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settingStore.settings.aiKey}`
      },
      body: JSON.stringify({
        model: settingStore.settings.aiModel,
        messages: [
          { role: 'system', content: '你是一个笔记助手, 协助用户完成文字处理，严格遵守用户的规则！' },
          { role: 'user', content: `${prompt}\n\n${text}${searchContext}` }
        ],
        temperature: 0.7,
        stream: true  // 启用流式响应
      }),
      signal
    })

    if (!response.ok) {
      throw new Error(`API错误: ${response.status}`)
    }

    // 流式读取响应
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('无法读取响应流')
    }

    const decoder = new TextDecoder()
    let fullContent = ''

    // 根据是否有选中文本决定初始内容
    if (editor.value) {
      if (userHadSelection) {
        // 有选中文本：先删除选中的内容，设置内容为选中前+选中后
        editor.value.commands.setContent(contentBeforeSelection + contentAfterSelection)
      } else if (!pendingSelectionText) {
        // 没有选中文本且没有待处理文本：清空编辑器
        editor.value.commands.setContent('')
      } else {
        // 有 pendingSelectionText 但匹配失败：保留原文
        editor.value.commands.setContent(originalContent)
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      // 解析 SSE 格式的数据
      const lines = chunk.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            const content = parsed.choices?.[0]?.delta?.content
            if (content) {
              fullContent += content
              // 流式更新编辑器内容
              if (editor.value) {
                if (userHadSelection) {
                  // 有选中文本：拼接 选中前内容 + AI回复 + 选中后内容
                  editor.value.commands.setContent(contentBeforeSelection + fullContent + contentAfterSelection)
                } else if (originalContent) {
                  // 匹配失败但有 originalContent：保留原文，追加 AI 回复
                  editor.value.commands.setContent(originalContent + fullContent)
                } else {
                  // 没有选中文本：直接显示AI回复
                  editor.value.commands.setContent(fullContent)
                }
              }
            }
          } catch {
            // 忽略解析错误（可能是不完整的 JSON）
          }
        }
      }
    }

    // 生成完成后，如果有选中后的内容，需要完整拼接
    if (contentAfterSelection && editor.value) {
      const finalContent = contentBeforeSelection + fullContent + contentAfterSelection
      editor.value.commands.setContent(finalContent)
    }

    if (fullContent) {
      // 发送完整内容（包括选中前后的内容如果有的话）
      const finalContent = contentBeforeSelection + fullContent + contentAfterSelection
      emit('update', finalContent)
    }
    showToast('已完成')
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // 请求被取消，不显示错误
      return
    }
    console.error('AI调用失败:', error)
    showToast(`AI调用失败: ${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    isAILoading.value = false
    document.body.style.cursor = ''
    aiAbortController = null
    pendingSelectionText = ''
    contentBeforeSelection = ''
    contentAfterSelection = ''
    originalContent = ''
  }
}

const handleLink = () => {
  const ed = editor.value
  if (!ed) return
  if (ed.isActive('link')) {
    ed.chain().focus().unsetLink().run()
  } else {
    const url = window.prompt('输入链接地址:')
    if (url) {
      ed.chain().focus().setLink({ href: url }).run()
    }
  }
}

const editor = useEditor({
  editable: !props.isLocked,
  extensions: [
    StarterKit.configure({
      codeBlock: false,
      bulletList: {
        keepMarks: true,
        keepAttributes: false,
      },
      orderedList: {
        keepMarks: true,
        keepAttributes: false,
      },
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: 'javascript',
    }),
    BubbleMenuExtension.configure({
      element: undefined,
      tippyOptions: {
        duration: 100,
        placement: 'top',
      },
    }),
    Markdown,
    Placeholder.configure({
      placeholder: ''
    }),
    Image.configure({
      inline: true,
      allowBase64: false, // 禁用 base64，改为保存到文件
    }),
    Link.configure({
      openOnClick: false,
      linkOnPaste: true,
      autolink: true,
    }),
    TextStyle,
    createSlashCommand(),
    Color,
    Highlight.configure({ multicolor: true }),
    Underline,
    FontFamily,
    CodeBlockCopyExtension,
    CodeBlockLanguageExtension,
    InlineSearchExtension,
    // 表格扩展
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableCell,
    TableHeader,
  ],
  content: props.initialContent,
  editorProps: {
    handleDOMEvents: {
      compositionstart: () => {
        ;(window as any).__imeComposing = true
      },
      compositionend: () => {
        ;(window as any).__imeComposing = false
        ;(window as any).__imeEndedAt = performance.now()
      },
    },
    handleClickOn(_view, _pos, _node, _nodePos, event) {
      // 只处理左键点击
      if (event.button !== 0) return false
      // 点击链接时使用系统浏览器打开
      const target = event.target as HTMLElement
      const anchor = target.closest('a')
      if (anchor?.href) {
        event.preventDefault()
        openUrl(anchor.href)
        return true
      }
      return false
    },
    handleKeyDown(view, event) {
      // IME 组合中或结束后 100ms 内的 Enter 仅用于确认输入法，不做 ProseMirror 块拆分
      if (event.key === 'Enter' && (
        event.isComposing ||
        (window as any).__imeComposing ||
        performance.now() - ((window as any).__imeEndedAt || 0) < 100
      )) {
        return true
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'a') {
        event.preventDefault()
        const { state, dispatch } = view

        // ProseMirror 的 AllSelection 映射到 DOM 为容器级选区 (DIV offset 0→N)，
        // 浏览器对跨元素容器级选区不渲染 ::selection（尤其 <pre>、<ul> 等块）。
        // 这里改为文本节点级选区，并临时解除 contenteditable="false" 的编辑宿主隔离。
        dispatch(state.tr.setSelection(new AllSelection(state.doc)))

        requestAnimationFrame(() => {
          const domSel = window.getSelection()
          if (!domSel) return

          // 找到编辑器内第一个和最后一个文本节点
          const walker = document.createTreeWalker(view.dom, NodeFilter.SHOW_TEXT)
          const first = walker.nextNode() as Text | null
          if (!first) return
          let last: Text = first
          let node: Node | null
          while ((node = walker.nextNode())) last = node as Text

          // 临时解除 NodeView 外壳的 contenteditable="false"，使选区跨宿主可行
          const nonEditables = view.dom.querySelectorAll('[contenteditable="false"]')
          nonEditables.forEach((el: any) => el.setAttribute('contenteditable', 'true'))

          try {
            ;(view as any).domObserver.disconnectSelection()
            domSel.setBaseAndExtent(first, 0, last, (last.textContent || '').length)
            ;(view as any).domObserver.setCurSelection()
          } finally {
            ;(view as any).domObserver.connectSelection()
          }

          // 等浏览器渲染完选区后，在下次用户交互时恢复 contenteditable
          const restore = () => {
            nonEditables.forEach((el: any) => el.setAttribute('contenteditable', 'false'))
            view.dom.removeEventListener('mousedown', restore)
            view.dom.removeEventListener('keydown', restore)
          }
          view.dom.addEventListener('mousedown', restore, { once: true })
          view.dom.addEventListener('keydown', restore, { once: true })
        })
        return true
      }
      return false
    },
    handleClick(view, _pos, event) {
      // 只处理左键点击，右键点击保持选择状态
      if (event.button !== 0) {
        return true
      }

      // 尝试将光标设置到点击位置
      const coords = { left: event.clientX, top: event.clientY }
      const domPos = view.posAtCoords(coords)

      if (domPos && domPos.pos >= 0) {
        // 能找到有效位置，设置光标到该位置
        const $pos = view.state.doc.resolve(domPos.pos)
        const selection = TextSelection.near($pos, -1)
        view.dispatch(view.state.tr.setSelection(selection))
        return true
      } else {
        // 找不到有效位置，将光标设置到文档末尾
        const docEnd = view.state.doc.content.size
        const selection = TextSelection.near(view.state.doc.resolve(docEnd), 1)
        view.dispatch(view.state.tr.setSelection(selection))
        return true
      }
    },
    // 全选 + 复制时粘贴 markdown 源码（含 ``` 等标记），非全选时将链接序列化为 [text](url)
    clipboardTextSerializer: (slice) => {
      const ed = editor.value
      if (ed) {
        const { from, to } = ed.state.selection
        if (from === 0 && to === ed.state.doc.content.size) {
          return ed.storage.markdown.getMarkdown() || ''
        }
      }
      // 遍历选中的节点：链接文本输出 [text](url)，其余输出纯文本
      let result = ''
      slice.content.descendants((node) => {
        if (node.isText) {
          const linkMark = node.marks.find(mark => mark.type.name === 'link')
          if (linkMark) {
            result += `[${node.text}](${linkMark.attrs.href || ''})`
          } else {
            result += node.text || ''
          }
          return false
        }
        return true
      })
      return result
    },
    handlePaste(view, event) {
      // 处理粘贴事件，特别是图片粘贴
      const clipboardData = event.clipboardData
      if (!clipboardData) return false

      // 检查是否有图片
      const items = clipboardData.items
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/')) {
          event.preventDefault()

          // 从剪贴板获取文件
          let file = item.getAsFile()
          // 如果 getAsFile 返回 null，尝试从 files 获取
          if (!file && clipboardData.files.length > 0) {
            for (let j = 0; j < clipboardData.files.length; j++) {
              const f = clipboardData.files[j]
              if (f.type.startsWith('image/')) {
                file = f
                break
              }
            }
          }
          if (!file) {
            return true
          }

          const reader = new FileReader()
          reader.onload = async (e) => {
            const dataUrl = e.target?.result as string
            if (!dataUrl) return

            try {
              // 生成唯一文件名
              const timestamp = Date.now()
              const randomStr = Math.random().toString(36).substring(2, 8)
              const ext = item.type.split('/')[1] || 'png'
              const filename = `img_${timestamp}_${randomStr}.${ext}`

              // 保存图片到 iCloud 的 images 文件夹
              const relativePath = await fileSystem.saveImage(dataUrl, filename)

              // 插入图片到编辑器（relativePath 已经是 asset:// URL）
              const imageNode = view.state.schema.nodes.image.create({ src: relativePath, alt: '', title: '' })
              view.dispatch(view.state.tr.replaceSelectionWith(imageNode))
            } catch (err) {
              console.error('Failed to save image:', err)
              showToast('图片保存失败')
            }
          }
          reader.readAsDataURL(file)
          return true
        }
      }

      // 非图片内容，尝试处理 Markdown 链接语法
      const text = clipboardData.getData('text/plain')
      if (text && /\[([^\]]+)\]\(([^)]+)\)/.test(text)) {
        event.preventDefault()
        const html = text.replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2">$1</a>'
        )
        editor.value?.commands.insertContent(html)
        return true
      }

      return false
    },
    handleDrop(view, event) {
      // 处理外部文件（特别是图片）拖入
      const dataTransfer = event.dataTransfer
      if (!dataTransfer) return false

      // 检查是否有文件
      const files = dataTransfer.files

      if (files.length === 0) return false

      // 检查是否是图片文件
      const imageFiles: File[] = []
      for (let i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('image/')) {
          imageFiles.push(files[i])
        }
      }

      if (imageFiles.length === 0) return false

      event.preventDefault()

      // 获取插入位置
      const coords = { left: event.clientX, top: event.clientY }
      const pos = view.posAtCoords(coords)
      if (!pos) return true

      // 设置光标位置
      const $pos = view.state.doc.resolve(pos.pos)
      const selection = TextSelection.near($pos)
      view.dispatch(view.state.tr.setSelection(selection))

      // 异步处理每个图片
      for (const file of imageFiles) {
        const reader = new FileReader()
        reader.onload = async (e) => {
          const dataUrl = e.target?.result as string
          if (!dataUrl) return

          try {
            // 生成唯一文件名
            const timestamp = Date.now()
            const randomStr = Math.random().toString(36).substring(2, 8)
            const ext = file.type.split('/')[1] || 'png'
            const filename = `img_${timestamp}_${randomStr}.${ext}`

            // 保存图片到 iCloud 的 images 文件夹
            const relativePath = await fileSystem.saveImage(dataUrl, filename)

            // 插入图片到编辑器（relativePath 已经是完整的 file:// URL）
            const imageNode = view.state.schema.nodes.image.create({ src: relativePath, alt: '', title: '' })
            view.dispatch(view.state.tr.replaceSelectionWith(imageNode))
          } catch (err) {
            console.error('Failed to save image:', err)
            showToast('图片保存失败')
          }
        }
        reader.readAsDataURL(file)
      }

      return true
    },
  },
  onUpdate: ({ editor }) => {
    const markdown = editor.storage.markdown.getMarkdown()
    emit('update', markdown)
  }
})

watch(() => props.initialContent, (newContent) => {
  if (editor.value && newContent !== editor.value.storage.markdown.getMarkdown()) {
    editor.value.commands.setContent(newContent)
    // 切换笔记时滚动到顶部
    editor.value.view.dom.scrollTop = 0
  }
})

watch(() => props.fontSize, (newFontSize) => {
  if (editor.value) {
    editor.value.view.dom.style.fontSize = `${newFontSize}px`
  }
})

watch(() => props.fontFamily, (newFontFamily) => {
  if (editor.value) {
    editor.value.view.dom.style.fontFamily = newFontFamily
  }
})

// 监听锁定状态变化
watch(() => props.isLocked, (locked) => {
  if (editor.value) {
    editor.value.setEditable(!locked)
  }
})

// 监听代码主题变化
watch(() => settingStore.settings.codeTheme, (newTheme) => {
  loadHighlightCss(newTheme)
})

onMounted(async () => {
  await assistantsStore.loadAssistants()
  // 从 iCloud 同步 AI 配置到设置
  if (assistantsStore.aiConfigExists) {
    settingStore.settings.aiUrl = assistantsStore.aiUrl
    settingStore.settings.aiKey = assistantsStore.aiKey
    settingStore.settings.aiModel = assistantsStore.aiModel
    settingStore.saveSettings()
  }
  document.addEventListener('contextmenu', handleContextMenu, true)
  document.addEventListener('click', hideContextMenu)

  // 编辑器 DOM 上 capture 阶段拦截右键 mousedown，保存 ProseMirror 选区快照
  // 不调用 preventDefault/stopImmediatePropagation，让事件自然传播
  // macOS WebKit 会在 JS 事件分发前后通过原生层面修改 DOM 选区，
  // 故本方法仅记录"右键前"的选区状态，后续由 handleContextMenu 负责恢复
  if (editor.value) {
    const saveSelectionOnRightMousedown = (e: MouseEvent) => {
      if (e.button === 2 && editor.value) {
        const { from, to } = editor.value.state.selection
        rightClickSnapshot = { from, to }
      }
    }
    editor.value.view.dom.addEventListener('mousedown', saveSelectionOnRightMousedown, true)
    ;(editor.value.view.dom as any)._saveSelectionOnRightMousedown = saveSelectionOnRightMousedown
  }

  // 监听代码块语言变更
  document.addEventListener('codeblock-language-change', ((e: CustomEvent) => {
    const { pos, language } = e.detail
    if (editor.value) {
      const node = editor.value.state.doc.nodeAt(pos)
      if (node && node.type.name === 'codeBlock') {
        const tr = editor.value.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          language: language,
        })
        editor.value.view.dispatch(tr)
      }
    }
  }) as EventListener)

  // 直接监听背景色变化并设置DOM样式
  watchEffect(() => {
    const color = props.noteBgColor
    const wrapper = document.querySelector('.tiptap-wrapper') as HTMLElement | null
    if (wrapper) {
      if (color) {
        wrapper.style.setProperty('--note-bg', color)
      } else {
        wrapper.style.removeProperty('--note-bg')
      }
    }
  })
})

onUnmounted(() => {
  editor.value?.destroy()
  // 清理编辑器 DOM 级别的右键选区保存
  if (editor.value && (editor.value.view.dom as any)._saveSelectionOnRightMousedown) {
    editor.value.view.dom.removeEventListener(
      'mousedown',
      (editor.value.view.dom as any)._saveSelectionOnRightMousedown,
      true
    )
  }
  document.removeEventListener('contextmenu', handleContextMenu, true)
  document.removeEventListener('click', hideContextMenu)
})

defineExpose({
  setSearchQuery(query: string) {
    editor.value?.commands.setSearchQuery(query)
  },
  searchNext() {
    editor.value?.commands.searchNext()
  },
  searchPrev() {
    editor.value?.commands.searchPrev()
  },
  clearSearch() {
    editor.value?.commands.clearSearch()
  },
  getSearchState() {
    if (!editor.value) return { matches: 0, currentIndex: 0 }
    const state = searchPluginKey.getState(editor.value.state) as any
    if (!state) return { matches: 0, currentIndex: 0 }
    return {
      matches: state.matches?.length ?? 0,
      currentIndex: state.currentIndex ?? 0,
    }
  },
})
</script>

<template>
  <div class="tiptap-wrapper" :class="{ 'is-locked': isLocked }" :style="noteBgColor ? { '--note-bg': noteBgColor } : undefined" @click="handleWrapperClick">
    <!-- AI 加载指示器 -->
    <div v-if="isAILoading" class="ai-loading-indicator">
      <div class="ai-loading-content">
        <span class="ai-loading-text">AI 思考中...</span>
        <button class="ai-stop-btn" @click="stopAI">
          <i class="i-mdi-stop"></i>
          停止
        </button>
      </div>
    </div>
    <EditorContent :editor="editor" class="tiptap" />
    <BubbleMenu
      v-if="editor"
      :editor="editor"
      :tippy-options="{ duration: 100, placement: 'top', maxWidth: 'none' }"
      class="bubble-menu"
    >
      <!-- 文本格式 -->
      <button @click="editor.chain().focus().toggleBold().run()"
        :class="{ 'is-active': editor.isActive('bold') }" data-tip="加粗"><b>B</b></button>
      <button @click="editor.chain().focus().toggleItalic().run()"
        :class="{ 'is-active': editor.isActive('italic') }" data-tip="斜体"><i>I</i></button>
      <button @click="editor.chain().focus().toggleUnderline().run()"
        :class="{ 'is-active': editor.isActive('underline') }" data-tip="下划线"><u>U</u></button>
      <button @click="editor.chain().focus().toggleStrike().run()"
        :class="{ 'is-active': editor.isActive('strike') }" data-tip="删除线"><s>S</s></button>
      <button @click="editor.chain().focus().toggleCode().run()"
        :class="{ 'is-active': editor.isActive('code') }" data-tip="行内代码">&lt;/&gt;</button>
      <button @click="editor.chain().focus().unsetAllMarks().run()"
        data-tip="清除格式" class="bm-clear-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 5l14 14M5 19l7-7 7 7M5 5l7 7 7-7"/>
        </svg>
      </button>

      <div class="bm-sep" />

      <!-- 链接 -->
      <button @click="handleLink"
        :class="{ 'is-active': editor.isActive('link') }"
        data-tip="链接">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
      </button>

      <div class="bm-sep" />

      <!-- 颜色 -->
      <div class="bm-color-picker" data-tip="字体颜色">
        <span class="bm-label" style="color: var(--color-popup-text, #e0e0e0);">A</span>
        <input
          type="color"
          class="bm-color-input"
          @input="(e) => editor?.chain().focus().setColor((e.target as HTMLInputElement).value).run()"
        />
      </div>
      <div class="bm-color-picker" data-tip="背景色">
        <span class="bm-label" style="background: #ff0000; padding: 0 3px; border-radius: 2px; color: var(--color-popup-text, #e0e0e0);">A</span>
        <input
          type="color"
          class="bm-color-input"
          @input="(e) => editor?.chain().focus().setHighlight({ color: (e.target as HTMLInputElement).value }).run()"
        />
      </div>

      <div class="bm-sep" />

      <!-- 标题 -->
      <button @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
        :class="{ 'is-active': editor.isActive('heading', { level: 1 }) }" data-tip="标题 1">H1</button>
      <button @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
        :class="{ 'is-active': editor.isActive('heading', { level: 2 }) }" data-tip="标题 2">H2</button>
      <button @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
        :class="{ 'is-active': editor.isActive('heading', { level: 3 }) }" data-tip="标题 3">H3</button>

      <div class="bm-sep" />

      <!-- 列表 -->
      <button @click="editor.chain().focus().toggleBulletList().run()"
        :class="{ 'is-active': editor.isActive('bulletList') }" data-tip="无序列表">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>
        </svg>
      </button>
      <button @click="editor.chain().focus().toggleOrderedList().run()"
        :class="{ 'is-active': editor.isActive('orderedList') }" data-tip="有序列表">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>
        </svg>
      </button>
      <button @click="editor.chain().focus().toggleTaskList().run()"
        :class="{ 'is-active': editor.isActive('taskList') }" data-tip="任务列表">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
      </button>

      <div class="bm-sep" />

      <!-- 块级元素 -->
      <button @click="editor.chain().focus().toggleBlockquote().run()"
        :class="{ 'is-active': editor.isActive('blockquote') }" data-tip="引用">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>
        </svg>
      </button>
      <button @click="editor.chain().focus().toggleCodeBlock().run()"
        :class="{ 'is-active': editor.isActive('codeBlock') }" data-tip="代码块">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
        </svg>
      </button>
      <button @click="editor.chain().focus().setHorizontalRule().run()"
        data-tip="分割线">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="3" y1="12" x2="21" y2="12"/>
        </svg>
      </button>
      <div class="bm-sep" />
      <button @click="editor.chain().focus().setParagraph().run()"
        :class="{ 'is-active': editor.isActive('paragraph') }" data-tip="普通文本"><span style="font-size:10px">¶</span></button>
    </BubbleMenu>
    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenuVisible"
        ref="contextMenuRef"
        class="context-menu"
        :style="contextMenuStyle"
        @click.stop
      >
        <template v-if="hasAIConfig && userAssistants.length > 0">
          <div
            v-for="assistant in userAssistants"
            :key="assistant.id"
            class="context-menu-item"
            @click="handleAI(assistant.id)"
          >
            <span>{{ assistant.name }}</span>
            <i v-if="assistant.searchEnabled" class="i-mdi-web context-menu-search-icon"></i>
          </div>
        </template>
        <template v-else-if="hasAIConfig">
          <div class="context-menu-item context-menu-item--disabled">
            <span>暂无助手</span>
          </div>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tiptap-wrapper {
  height: 100%;
  overflow-y: auto;
  background: var(--note-bg, transparent);
}

/* AI 加载指示器 */
.ai-loading-indicator {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 100;
  background: rgba(30, 30, 30, 0.95);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.ai-loading-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ai-loading-text {
  color: #e0e0e0;
  font-size: 13px;
}

.ai-stop-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: rgba(255, 100, 100, 0.9);
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.ai-stop-btn:hover {
  background: rgba(255, 80, 80, 1);
}

.ai-stop-btn i {
  font-size: 14px;
}

:deep(.tiptap) {
  min-height: 100%;
  outline: none;
  font-size: v-bind('fontSize + "px"');
  font-family: v-bind('fontFamily');
}

.bubble-menu {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  padding: 5px;
  background: var(--color-popup-bg, #2a2a2a);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  max-width: min(95vw, 600px);
}

.bubble-menu button {
  padding: 3px 4px;
  border: none;
  background: transparent;
  color: var(--color-popup-text, #e0e0e0);
  cursor: pointer;
  border-radius: 3px;
  font-size: 11px;
  font-weight: bold;
  line-height: 1;
  white-space: nowrap;
}

.bubble-menu button:hover {
  background: var(--color-popup-hover, rgba(255, 255, 255, 0.1));
}

.bubble-menu button.is-active {
  background: var(--color-primary);
  color: white;
}

.bubble-menu button svg {
  display: block;
}

.bm-clear-btn:hover {
  color: #f87171 !important;
}

/* 自定义 tooltip (WKWebView 不支持原生 title) */
.bubble-menu [data-tip] {
  position: relative;
}

.bubble-menu [data-tip]:hover::after {
  content: attr(data-tip);
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.85);
  color: #fff;
  font-size: 11px;
  font-weight: normal;
  white-space: nowrap;
  border-radius: 4px;
  pointer-events: none;
  z-index: 100;
}

:deep(ul[data-type="taskList"]) {
  list-style: none;
  padding-left: 0;
}

:deep(ul[data-type="taskList"] li) {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

:deep(ul[data-type="taskList"] li > label) {
  flex-shrink: 0;
  margin-top: 2px;
}

:deep(ul[data-type="taskList"] li > label input[type="checkbox"]) {
  cursor: pointer;
  width: 16px;
  height: 16px;
  margin: 0;
}

:deep(ul[data-type="taskList"] li > div) {
  flex: 1;
}

:deep(ul[data-type="taskList"] li[data-checked="true"] > div) {
  text-decoration: line-through;
  color: var(--color-text-secondary);
}

/* 右键菜单 */
.context-menu {
  position: fixed;
  background: var(--color-popup-bg, rgba(30, 30, 30, 0.95));
  backdrop-filter: blur(10px);
  border: 1px solid var(--color-popup-border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  padding: 6px 0;
  min-width: 160px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  z-index: 10000;
}

.context-menu-item {
  display: flex;
  align-items: center;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-popup-text, #e0e0e0);
  gap: 10px;
}

.context-menu-item:hover {
  background: var(--color-popup-hover, rgba(255, 255, 255, 0.1));
}

.context-menu-item--disabled {
  color: var(--color-text-secondary);
  cursor: default;
}

.context-menu-item--disabled:hover {
  background: transparent;
}

.context-menu-item {
  justify-content: space-between;
}

.context-menu-search-icon {
  font-size: 14px;
  color: var(--color-primary);
  opacity: 0.7;
}

/* BubbleMenu 新增元素 */
.bm-sep {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.15);
  margin: 0 1px;
  align-self: center;
}
.bm-color-picker {
  position: relative;
  display: flex;
  align-items: center;
  cursor: pointer;
}
.bm-label {
  font-size: 11px;
  font-weight: bold;
  color: var(--color-popup-text, #e0e0e0);
  padding: 2px 4px;
  border-radius: 3px;
  cursor: pointer;
}
.bm-color-input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}
.bm-label:hover { background: rgba(255, 255, 255, 0.1); }

/* 编辑器左侧留白已在 .tiptap > .ProseMirror 中设置 */

:deep(.tiptap pre) {
  background: var(--color-code-bg, #f5f5f5);
  border: 2px solid var(--color-code-border, #e0e0e0);
  border-radius: 8px;
  padding: 12px 16px;
  margin: 16px 0;
}

:deep(.tiptap pre code) {
  background: none !important;
  padding: 0;
  font-size: 13px;
  /* 让 highlight.js 主题控制颜色 */
  color: inherit;
}

/* 代码块复制按钮样式 */
:deep(.code-block-copy-btn) {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

:deep(.tiptap pre:hover .code-block-copy-btn) {
  opacity: 1;
}

:deep(.code-block-copy-btn:hover) {
  background: rgba(255, 255, 255, 0.2);
  color: var(--color-text);
}

:deep(.code-block-copy-btn.copied) {
  background: rgba(76, 175, 80, 0.3);
  color: #4caf50;
}

/* 代码块语言选择器样式 */
:deep(.code-block-language-selector) {
  position: absolute;
  bottom: -32px;
  right: 0;
  z-index: 10;
}

:deep(.code-block-lang-btn) {
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s, color 0.15s;
}

:deep(.tiptap pre:hover .code-block-lang-btn) {
  opacity: 1;
  background: rgba(255, 255, 255, 0.15);
}

:deep(.code-block-lang-btn:hover) {
  background: rgba(255, 255, 255, 0.2);
  color: var(--color-text);
}

:deep(.code-block-lang-dropdown) {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  background: var(--color-popup-bg, #2a2a2a);
  border: 1px solid var(--color-popup-border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  min-width: 200px;
  max-height: 300px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

:deep(.code-block-lang-search) {
  padding: 8px 12px;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: var(--color-popup-text, #e0e0e0);
  font-size: 13px;
  outline: none;
  width: 100%;
}

:deep(.code-block-lang-search::placeholder) {
  color: var(--color-text-secondary);
}

:deep(.code-block-lang-list) {
  overflow-y: auto;
  max-height: 250px;
  padding: 4px 0;
}

:deep(.code-block-lang-item) {
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-popup-text, #e0e0e0);
  transition: background 0.1s;
}

:deep(.code-block-lang-item:hover) {
  background: var(--color-popup-hover, rgba(255, 255, 255, 0.1));
}

:deep(.code-block-lang-item.active) {
  background: var(--color-primary);
  color: white;
}
</style>

<style>
/* Tiptap 基础样式覆盖 */
.tiptap {
  height: 100%;
  padding: 0;
  background: transparent;
}

/* 锁定状态样式 */
.tiptap-wrapper.is-locked .tiptap {
  cursor: not-allowed;
}

.tiptap-wrapper.is-locked .ProseMirror {
  cursor: not-allowed;
  opacity: 0.8;
}

/* 分隔线样式 */
.tiptap hr {
  display: block;
  border: none;
  border-top: 1px solid var(--color-text-secondary);
  height: 0;
  margin: 24px 0;
  padding: 0;
  opacity: 0.35;
}

/* 锁定状态下隐藏悬浮条和代码块按钮 */
.tiptap-wrapper.is-locked .bubble-menu,
.tiptap-wrapper.is-locked .code-block-copy-btn,
.tiptap-wrapper.is-locked .code-block-lang-btn {
  display: none !important;
}

.tiptap-wrapper.is-locked ul[data-type="taskList"] li > label input[type="checkbox"] {
  pointer-events: none !important;
}

.tiptap > .ProseMirror {
  height: auto;
  min-height: 100%;
  padding: 40px 48px 40px 72px;
  color: var(--color-text);
  border-radius: 8px;
}

/* 标题样式 */
.tiptap h1,
.tiptap h2,
.tiptap h3 {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
}

.tiptap h1 {
  font-size: 2em;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 8px;
}

.tiptap h2 {
  font-size: 1.5em;
}

.tiptap h3 {
  font-size: 1.25em;
}

/* 段落样式 */
.tiptap p {
  margin-bottom: 12px;
  line-height: 1.6;
}

/* 引用样式 */
.tiptap blockquote {
  border-left: 3px solid var(--color-border);
  padding-left: 16px;
  margin: 16px 0;
  color: var(--color-text-secondary);
}

/* 列表样式 */
.tiptap ul,
.tiptap ol {
  padding-left: 24px;
  margin: 12px 0;
}

/* 链接样式 */
.tiptap a {
  color: var(--color-primary);
  text-decoration: underline;
}

/* Placeholder 样式 */
.tiptap p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  color: var(--color-text-secondary);
  pointer-events: none;
  height: 0;
}

/* 代码块样式增强 */
.tiptap pre {
  position: relative;
  background: var(--color-surface) !important;
  border-radius: 8px;
  padding: 12px 16px;
  margin: 16px 0;
}

.tiptap pre code {
  background: none !important;
  padding: 0;
  font-size: 13px;
  font-family: 'Fira Code', 'Consolas', monospace;
  color: inherit;
}

/* 行内代码样式 */
.tiptap code {
  background: var(--color-surface);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: 'Fira Code', 'Consolas', monospace;
}

/* 图片样式 */
.tiptap img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
}

/* 表格样式 */
.tiptap table {
  border-collapse: collapse;
  width: 100%;
  margin: 16px 0;
}

.tiptap th,
.tiptap td {
  border: 1px solid var(--color-border);
  padding: 8px 12px;
  text-align: left;
}

.tiptap th {
  background: var(--color-surface);
  font-weight: 600;
}

/* 任务列表样式增强 */
.tiptap ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0;
}

.tiptap ul[data-type="taskList"] li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.tiptap ul[data-type="taskList"] li > label {
  flex-shrink: 0;
  margin-top: 2px;
}

.tiptap ul[data-type="taskList"] li > label input[type="checkbox"] {
  cursor: pointer;
  width: 16px;
  height: 16px;
  margin: 0;
}

.tiptap ul[data-type="taskList"] li > div {
  flex: 1;
}

.tiptap ul[data-type="taskList"] li[data-checked="true"] > div {
  text-decoration: line-through;
  color: var(--color-text-secondary);
}

/* 笔记内搜索高亮 */
.search-match {
  background-color: rgba(255, 213, 0, 0.3);
  border-radius: 2px;
  padding: 0 1px;
}

.search-match-current {
  background-color: rgba(255, 183, 0, 0.6);
  border-radius: 2px;
  padding: 0 1px;
  box-shadow: 0 0 0 1px rgba(255, 160, 0, 0.5);
}
</style>
