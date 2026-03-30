<script setup lang="ts">
import { watch, onMounted, onUnmounted, ref, computed } from 'vue'
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
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { all, createLowlight } from 'lowlight'
import 'highlight.js/styles/tokyo-night-dark.css'
import { createSlashCommand } from './extensions/SlashCommandExtension'
import GlobalDragHandle from 'tiptap-extension-global-drag-handle'
import { Color } from '@tiptap/extension-color'
import TextStyle from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import FontFamily from '@tiptap/extension-font-family'
import { BlockMenuExtension } from './extensions/BlockMenuExtension'
import BlockMenuPopover from '../BlockMenuPopover.vue'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'

const lowlight = createLowlight(all)

const props = defineProps<{
  initialContent: string
  fontSize: number
  fontFamily: string
  isLocked: boolean
}>()

const emit = defineEmits<{
  update: [markdown: string]
}>()

const settingStore = useSettingStore()
const assistantsStore = useAssistantsStore()

// 右键菜单
const contextMenuVisible = ref(false)
const contextMenuRef = ref<HTMLElement>()
const contextMenuStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' })
const savedSelectionText = ref('') // 保存右键菜单打开时的选中文本

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

  // 检查是否有选中文本
  if (editor.value) {
    const { from, to } = editor.value.state.selection
    if (from !== to) {
      // 使用 textBetween 获取纯文本内容
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
}

// 隐藏右键菜单
function hideContextMenu() {
  contextMenuVisible.value = false
  savedSelectionText.value = ''
}

// mousedown 时保存选中文本
function handleMouseDown(e: MouseEvent) {
  if (e.button === 2 && editor.value) { // 右键
    const { from, to } = editor.value.state.selection
    if (from !== to) {
      savedSelectionText.value = editor.value.state.doc.textBetween(from, to, ' ')
    }
  }
}

// AI 处理函数
function handleAI(assistantId: string) {
  // 先保存选中文本（避免 hideContextMenu 清空它）
  pendingSelectionText = savedSelectionText.value

  console.log('[DEBUG handleAI] start')
  console.log('[DEBUG handleAI] savedSelectionText:', JSON.stringify(savedSelectionText.value?.slice(0, 100)))
  console.log('[DEBUG handleAI] pendingSelectionText:', JSON.stringify(pendingSelectionText?.slice(0, 100)))

  // 判断是否有选中文本
  userHadSelection = false
  contentBeforeSelection = ''
  contentAfterSelection = ''
  originalContent = ''

  // 使用首尾片段匹配来定位选中文本（逐步递减长度）
  if (editor.value && savedSelectionText.value) {
    const fullContent = editor.value.storage.markdown.getMarkdown()
    const text = pendingSelectionText

    console.log('[DEBUG handleAI] fullContent:', JSON.stringify(fullContent?.slice(0, 200)))
    console.log('[DEBUG handleAI] text:', JSON.stringify(text?.slice(0, 200)))

    const MAX_PREFIX_SUFFIX = 15
    const MIN_PREFIX_SUFFIX = 5

    let prefixIndex = -1
    let suffixIndex = -1
    let matchedSuffixLength = 0

    // 前缀匹配：从长到短递减，直到匹配成功或小于最小长度
    for (let len = MAX_PREFIX_SUFFIX; len >= MIN_PREFIX_SUFFIX; len--) {
      const prefix = text.slice(0, len)
      prefixIndex = fullContent.indexOf(prefix)
      console.log(`[DEBUG handleAI] prefix len=${len}, prefix="${prefix}", found at=${prefixIndex}`)
      if (prefixIndex !== -1) {
        break
      }
    }

    // 后缀匹配：从长到短递减，直到匹配成功或小于最小长度
    for (let len = MAX_PREFIX_SUFFIX; len >= MIN_PREFIX_SUFFIX; len--) {
      const suffix = text.slice(-len)
      const searchFrom = prefixIndex !== -1 ? prefixIndex : 0
      const found = fullContent.indexOf(suffix, searchFrom)
      console.log(`[DEBUG handleAI] suffix len=${len}, suffix="${suffix}", found at=${found}, searchFrom=${searchFrom}`)
      if (found !== -1) {
        suffixIndex = found
        matchedSuffixLength = len
        break
      }
    }

    console.log(`[DEBUG handleAI] prefixIndex=${prefixIndex}, suffixIndex=${suffixIndex}, userHadSelection=${userHadSelection}`)

    if (prefixIndex !== -1 && suffixIndex !== -1 && prefixIndex < suffixIndex) {
      // 找到了前缀和后缀，用它们来精确计算位置
      contentBeforeSelection = fullContent.slice(0, prefixIndex)
      contentAfterSelection = fullContent.slice(suffixIndex + matchedSuffixLength)
      userHadSelection = true
      console.log('[DEBUG handleAI] matched both prefix and suffix')
    } else if (prefixIndex !== -1) {
      // 只找到前缀，用 text.length 估算
      contentBeforeSelection = fullContent.slice(0, prefixIndex)
      contentAfterSelection = fullContent.slice(prefixIndex + text.length)
      userHadSelection = true
      console.log('[DEBUG handleAI] matched prefix only')
    } else {
      // 匹配失败：保存原文用于流式输出
      originalContent = fullContent
      console.log('[DEBUG handleAI] NOT matched, preserving original')
    }
  } else {
    console.log('[DEBUG handleAI] no selection or no editor, userHadSelection=false')
  }

  console.log('[DEBUG handleAI] final userHadSelection:', userHadSelection)
  console.log('[DEBUG handleAI] contentBeforeSelection length:', contentBeforeSelection.length)
  console.log('[DEBUG handleAI] contentAfterSelection length:', contentAfterSelection.length)

  hideContextMenu()
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

  console.log('[DEBUG callAI] start')
  console.log('[DEBUG callAI] userHadSelection:', userHadSelection)
  console.log('[DEBUG callAI] pendingSelectionText:', JSON.stringify(pendingSelectionText?.slice(0, 100)))
  console.log('[DEBUG callAI] contentBeforeSelection length:', contentBeforeSelection.length)
  console.log('[DEBUG callAI] contentAfterSelection length:', contentAfterSelection.length)

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

  console.log('[DEBUG callAI] text to send:', JSON.stringify(text?.slice(0, 200)))
  console.log('[DEBUG callAI] prompt:', JSON.stringify(prompt?.slice(0, 100)))

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
          { role: 'user', content: `${prompt}\n\n${text}` }
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
    console.log('[DEBUG callAI] before content check, userHadSelection:', userHadSelection)
    if (editor.value) {
      if (userHadSelection) {
        // 有选中文本：先删除选中的内容，设置内容为选中前+选中后
        console.log('[DEBUG callAI] userHadSelection=true, deleting selection and setting content')
        editor.value.commands.setContent(contentBeforeSelection + contentAfterSelection)
      } else if (!pendingSelectionText) {
        // 没有选中文本且没有待处理文本：清空编辑器
        console.log('[DEBUG callAI] no selection, clearing editor')
        editor.value.commands.setContent('')
      } else {
        // 有 pendingSelectionText 但匹配失败：保留原文
        console.log('[DEBUG callAI] pendingSelectionText exists but not matched, preserving original')
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

const editor = useEditor({
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
      allowBase64: true,
    }),
    createSlashCommand(),
    // ---- 新增扩展 ----
    GlobalDragHandle.configure({
      dragHandleWidth: 20,
      scrollTreshold: 100,
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Underline,
    FontFamily,
    BlockMenuExtension,
    // 表格扩展
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableCell,
    TableHeader,
  ],
  content: props.initialContent,
  onUpdate: ({ editor }) => {
    const markdown = editor.storage.markdown.getMarkdown()
    emit('update', markdown)
  }
})

watch(() => props.initialContent, (newContent) => {
  if (editor.value && newContent !== editor.value.storage.markdown.getMarkdown()) {
    editor.value.commands.setContent(newContent)
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

onMounted(() => {
  assistantsStore.loadAssistants()
  document.addEventListener('mousedown', handleMouseDown)
  document.addEventListener('contextmenu', handleContextMenu, true)
  document.addEventListener('click', hideContextMenu)
  // 存储 editor view 供 block menu 拖拽使用
  if (editor.value) {
    ;(window as any).__tiptapEditorView = editor.value.view
  }
})

onUnmounted(() => {
  editor.value?.destroy()
  document.removeEventListener('mousedown', handleMouseDown)
  document.removeEventListener('contextmenu', handleContextMenu, true)
  document.removeEventListener('click', hideContextMenu)
  ;(window as any).__tiptapEditorView = null
})
</script>

<template>
  <div class="tiptap-wrapper" :class="{ 'is-locked': isLocked }">
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
    <EditorContent :editor="editor" />
    <BubbleMenu
      v-if="editor"
      :editor="editor"
      :tippy-options="{ duration: 100, placement: 'top' }"
      class="bubble-menu"
    >
      <!-- 格式 -->
      <button @click="editor.chain().focus().toggleBold().run()"
        :class="{ 'is-active': editor.isActive('bold') }"><b>B</b></button>
      <button @click="editor.chain().focus().toggleItalic().run()"
        :class="{ 'is-active': editor.isActive('italic') }"><i>I</i></button>
      <button @click="editor.chain().focus().toggleUnderline().run()"
        :class="{ 'is-active': editor.isActive('underline') }"><u>U</u></button>
      <button @click="editor.chain().focus().toggleStrike().run()"
        :class="{ 'is-active': editor.isActive('strike') }"><s>S</s></button>
      <button @click="editor.chain().focus().toggleCode().run()"
        :class="{ 'is-active': editor.isActive('code') }">Code</button>

      <div class="bm-sep" />

      <!-- 字体颜色 inline picker -->
      <div class="bm-color-picker">
        <span class="bm-label" style="color: var(--color-popup-text, #e0e0e0);">A</span>
        <input
          type="color"
          class="bm-color-input"
          @input="(e) => editor?.chain().focus().setColor((e.target as HTMLInputElement).value).run()"
        />
      </div>

      <!-- 背景色 inline picker -->
      <div class="bm-color-picker">
        <span class="bm-label" style="background: #ff0000; padding: 0 3px; border-radius: 2px; color: var(--color-popup-text, #e0e0e0);">A</span>
        <input
          type="color"
          class="bm-color-input"
          @input="(e) => editor?.chain().focus().setHighlight({ color: (e.target as HTMLInputElement).value }).run()"
        />
      </div>

      <div class="bm-sep" />

      <!-- 块类型快速切 -->
      <button @click="editor.chain().focus().setHeading({ level: 1 }).run()"
        :class="{ 'is-active': editor.isActive('heading', { level: 1 }) }">H1</button>
      <button @click="editor.chain().focus().setHeading({ level: 2 }).run()"
        :class="{ 'is-active': editor.isActive('heading', { level: 2 }) }">H2</button>
      <button @click="editor.chain().focus().toggleBlockquote().run()"
        :class="{ 'is-active': editor.isActive('blockquote') }">"</button>
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
          </div>
        </template>
        <template v-else-if="hasAIConfig">
          <div class="context-menu-item context-menu-item--disabled">
            <span>暂无助手</span>
          </div>
        </template>
      </div>
    </Teleport>
    <!-- 块左侧菜单弹窗 -->
    <BlockMenuPopover :editor="editor" />
  </div>
</template>

<style scoped>
.tiptap-wrapper {
  height: 100%;
  overflow-y: auto;
  padding: 40px 48px;
  background: var(--color-background);
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
  gap: 4px;
  padding: 6px;
  background: var(--color-popup-bg, #2a2a2a);
  border-radius: 6px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.bubble-menu button {
  padding: 6px 6px;
  border: none;
  background: transparent;
  color: var(--color-popup-text, #e0e0e0);
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  font-weight: bold;
}

.bubble-menu button:hover {
  background: var(--color-popup-hover, rgba(255, 255, 255, 0.1));
}

.bubble-menu button.is-active {
  background: var(--color-primary);
  color: white;
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

/* 块左侧触发按钮 */
:deep(.block-menu-trigger) {
  position: absolute;
  left: -28px;
  opacity: 0;
  transition: opacity 0.15s;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-secondary);
  padding: 2px 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  line-height: 1;
}
:deep(.ProseMirror:hover .block-menu-trigger),
:deep(.block-menu-trigger:hover) {
  opacity: 1;
  background: var(--color-surface);
}

/* BubbleMenu 新增元素 */
.bm-sep {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 2px;
}
.bm-color-picker {
  position: relative;
  display: flex;
  align-items: center;
  cursor: pointer;
}
.bm-label {
  font-size: 13px;
  font-weight: bold;
  color: var(--color-popup-text, #e0e0e0);
  padding: 4px 6px;
  border-radius: 4px;
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

/* 拖拽手柄样式覆盖 */
:deep(.drag-handle) {
  opacity: 0;
  transition: opacity 0.15s;
  cursor: grab;
}
:deep(.ProseMirror:hover .drag-handle) {
  opacity: 0.4;
}
:deep(.drag-handle:hover) {
  opacity: 1 !important;
}

/* 编辑器左侧留白（给块按钮 + 拖拽手柄腾空间） */
.tiptap-wrapper {
  padding: 40px 48px 40px 72px; /* 左侧从 48px 改为 72px */
}

:deep(.tiptap pre) {
  background: var(--color-surface);
  border-radius: 8px;
  padding: 12px 16px;
  margin: 16px 0;
}

:deep(.tiptap pre code) {
  background: none;
  padding: 0;
  font-size: 13px;
  color: var(--color-text);
}
</style>

<style>
/* 全局样式 - 确保代码块内的选中文本颜色一致 */
.tiptap pre::selection,
.tiptap pre code::selection,
.tiptap code::selection {
  background-color: var(--color-primary) !important;
  color: white !important;
}

.tiptap pre::-moz-selection,
.tiptap pre code::-moz-selection,
.tiptap code::-moz-selection {
  background-color: var(--color-primary) !important;
  color: white !important;
}

/* Tiptap 基础样式覆盖 */
.tiptap {
  height: 100%;
  padding: 0;
  background: var(--color-background);
}

/* 锁定状态样式 */
.tiptap-wrapper.is-locked .tiptap {
  cursor: not-allowed;
}

.tiptap-wrapper.is-locked .ProseMirror {
  cursor: not-allowed;
  opacity: 0.8;
}

/* 锁定状态下隐藏块操作按钮和悬浮条 */
.tiptap-wrapper.is-locked .block-menu-trigger,
.tiptap-wrapper.is-locked .drag-handle,
.tiptap-wrapper.is-locked .bubble-menu {
  display: none !important;
}

.tiptap > .ProseMirror {
  height: auto;
  min-height: 100%;
  padding: 40px 48px 40px 72px;
  background: var(--color-background);
  color: var(--color-text);
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

/* 分隔线样式 */
.tiptap hr {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 24px 0;
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
</style>
