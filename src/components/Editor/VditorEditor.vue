<script setup lang="ts">
import {ref, onMounted, onUnmounted, watch, computed} from 'vue'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import 'highlight.js/styles/github.css'
// 导入 i18n 文件以填充 window.VditorI18n
import 'vditor/dist/js/i18n/zh_CN'
import { useSettingStore } from '@/stores/settingStore'
import { useAssistantsStore } from '@/stores/assistantsStore'

const props = defineProps<{
  initialContent: string
  fontSize: number
  fontFamily: string
}>()

const emit = defineEmits<{
  update: [markdown: string]
}>()

const settingStore = useSettingStore()
const assistantsStore = useAssistantsStore()
const editorContainer = ref<HTMLElement>()
let vditorInstance: Vditor | null = null

const isAILoading = ref(false)

const contextMenuVisible = ref(false)
const contextMenuRef = ref<HTMLElement>()
const contextMenuStyle = ref<{left: string, top: string}>({left: '0px', top: '0px'})
const savedSelectionText = ref('') // 保存右键菜单打开时的选中文本
let pendingSelectionText = '' // 待处理的选中文本（用于传递给AI）
let contentBeforeSelection = '' // 选中内容之前的内容
let contentAfterSelection = '' // 选中内容之后的内容
let userHadSelection = false   // 用户发起 AI 请求时是否有选中文本
let originalContent = '' // 原始编辑器内容（用于匹配失败时保留原文）

const hasAIConfig = computed(() => true) // 始终显示菜单，未配置时点击会提示

// 用户助手列表（排除模板助手）
const userAssistants = computed(() => {
  return assistantsStore.assistants.filter(a => !a.id.startsWith('template-'))
})

const fontSizeStyle = computed(() => `${props.fontSize}px`)

// Toast 通知
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

// 获取选中文本，如果没有选中则返回全部内容
function getSelectionText(): string {

  // 优先使用 handleAI 保存的待处理选中文本
  if (pendingSelectionText) {
    return pendingSelectionText
  }

  // 尝试从编辑器获取当前选中文本
  const selection = window.getSelection()
  const selectedText = selection?.toString().trim()

  // 如果有选中文本且在编辑器内，则返回选中文本
  if (selectedText) {
    const editorEl = editorContainer.value?.querySelector('.vditor-reset')
    if (editorEl?.contains(selection?.anchorNode ?? null)) {
      return selectedText
    }
  }

  // 如果没有选中文本，返回整个编辑器内容
  if (vditorInstance) {
    const fullContent = vditorInstance.getValue()
    return fullContent
  }
  return props.initialContent
}

// AbortController 用于取消 AI 请求
let aiAbortController: AbortController | null = null

// 调用AI API（流式响应 + 请求取消）
async function callAI(assistantId: string) {
  // 如果已有请求在运行，先取消
  if (aiAbortController) {
    aiAbortController.abort()
    aiAbortController = null
  }

  isAILoading.value = true
  document.body.style.cursor = 'wait'

  const text = getSelectionText()

  // 根据ID获取助手配置
  const assistant = assistantsStore.getAssistantById(assistantId)
  if (!assistant) {
    showToast('未找到对应的 AI 助手')
    isAILoading.value = false
    document.body.style.cursor = ''
    return
  }
  const prompt = assistant.prompt

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
    // 有选中文本时：handleAI 已经删除了选中内容，编辑器现在只有 contentBeforeSelection + contentAfterSelection
    // 无选中文本时：清空编辑器
    // 注意：如果 pendingSelectionText 存在但匹配失败（userHadSelection=false），保留原文追加 AI 回复
    console.log('[DEBUG callAI] userHadSelection:', userHadSelection, 'pendingSelectionText:', !!pendingSelectionText, 'originalContent:', !!originalContent)
    if (vditorInstance) {
      if (!userHadSelection) {
        // 有选中文本但匹配失败时，保留原文（originalContent）
        if (!pendingSelectionText) {
          console.log('[DEBUG callAI] about to setValue empty')
          vditorInstance.setValue('')
        } else {
          console.log('[DEBUG callAI] skipping setValue empty, preserving content')
        }
      }
      // userHadSelection 为 true 时，编辑器内容已经在 handleAI 中设置好了
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
              if (vditorInstance) {
                console.log('[DEBUG streaming] userHadSelection:', userHadSelection, 'originalContent length:', originalContent.length, 'fullContent length:', fullContent.length)
                if (userHadSelection) {
                  // 有选中文本：拼接 选中前内容 + AI回复 + 选中后内容
                  vditorInstance.setValue(contentBeforeSelection + fullContent + contentAfterSelection)
                } else if (originalContent) {
                  // 匹配失败但有 originalContent：保留原文，追加 AI 回复
                  vditorInstance.setValue(originalContent + fullContent)
                } else {
                  // 没有选中文本：直接显示AI回复
                  vditorInstance.setValue(fullContent)
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
    if (contentAfterSelection && vditorInstance) {
      const finalContent = contentBeforeSelection + fullContent + contentAfterSelection
      vditorInstance.setValue(finalContent)
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
    pendingSelectionText = '' // 清除待处理的选中文本
    contentBeforeSelection = ''
    contentAfterSelection = ''
    originalContent = ''
  }
}

// 右键菜单处理
function handleContextMenu(e: MouseEvent) {
  // 检查是否在编辑器内
  if (!editorContainer.value?.contains(e.target as Node)) {
    hideContextMenu()
    return
  }

  // 阻止默认行为
  e.preventDefault()

  // 计算菜单位置
  const menuWidth = 180
  const menuHeight = 340 // 估算高度（3个菜单项）
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

// ESC 键监听
function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    hideContextMenu()
  }
}


function handleAI(assistantId: string) {
  // 先保存选中文本（避免 hideContextMenu 清空它）
  pendingSelectionText = savedSelectionText.value

  // 判断是否有选中文本
  userHadSelection = false
  contentBeforeSelection = ''
  contentAfterSelection = ''
  originalContent = ''

  // 使用首尾片段匹配来定位选中文本（逐步递减长度）
  if (vditorInstance && savedSelectionText.value) {
    const fullContent = vditorInstance.getValue()
    const text = pendingSelectionText

    const MAX_PREFIX_SUFFIX = 15
    const MIN_PREFIX_SUFFIX = 5

    let prefixIndex = -1
    let suffixIndex = -1
    let matchedPrefixLength = 0
    let matchedSuffixLength = 0

    // 前缀匹配：从长到短递减，直到匹配成功或小于最小长度
    for (let len = MAX_PREFIX_SUFFIX; len >= MIN_PREFIX_SUFFIX; len--) {
      const prefix = text.slice(0, len)
      prefixIndex = fullContent.indexOf(prefix)
      if (prefixIndex !== -1) {
        matchedPrefixLength = len
        console.log('[DEBUG handleAI] prefix matched at length:', len, 'index:', prefixIndex)
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
        console.log('[DEBUG handleAI] suffix matched at length:', len, 'index:', suffixIndex)
        break
      }
    }

    console.log('[DEBUG handleAI] fullContent:', JSON.stringify(fullContent.slice(0, 500)))
    console.log('[DEBUG handleAI] selected text:', JSON.stringify(text.slice(0, 500)))
    console.log('[DEBUG handleAI] prefix matched:', matchedPrefixLength, 'suffix matched:', matchedSuffixLength)

    if (prefixIndex !== -1 && suffixIndex !== -1 && prefixIndex < suffixIndex) {
      // 找到了前缀和后缀，用它们来精确计算位置
      contentBeforeSelection = fullContent.slice(0, prefixIndex)
      contentAfterSelection = fullContent.slice(suffixIndex + matchedSuffixLength)

      // 删除选中内容：设置内容为选中前+选中后
      vditorInstance.setValue(contentBeforeSelection + contentAfterSelection)
      userHadSelection = true
      console.log('[DEBUG handleAI] matched, contentBefore length:', contentBeforeSelection.length, 'contentAfter length:', contentAfterSelection.length)
    } else if (prefixIndex !== -1) {
      // 只找到前缀，用 text.length 估算
      contentBeforeSelection = fullContent.slice(0, prefixIndex)
      contentAfterSelection = fullContent.slice(prefixIndex + text.length)
      vditorInstance.setValue(contentBeforeSelection + contentAfterSelection)
      userHadSelection = true
      console.log('[DEBUG handleAI] prefix only matched, contentBefore length:', contentBeforeSelection.length)
    } else {
      // 匹配失败：保存原文用于流式输出
      originalContent = fullContent
      console.log('[DEBUG handleAI] NOT matched, originalContent length:', fullContent.length)
    }
  }

  hideContextMenu()
  if (!settingStore.settings.aiUrl || !settingStore.settings.aiKey || !settingStore.settings.aiModel) {
    showToast('请先在设置中配置 AI')
    return
  }
  callAI(assistantId)
}

// mousedown 时保存选中文本（右键点击时比 contextmenu 更早触发）
function handleMouseDown(e: MouseEvent) {
  if (e.button === 2) { // 右键
    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (text) {
      savedSelectionText.value = text
    }
  }
}

onMounted(async () => {
  // 确保助手数据已加载
  await assistantsStore.loadAssistants()

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      const vditorReset = editorContainer.value?.querySelector('.vditor-reset')
      if (!vditorReset) return

      const active = document.activeElement
      const hasFocus = vditorReset === active || vditorReset.contains(active)

      if (hasFocus) {
        // 焦点在编辑器内：拦截，自己全选
        e.preventDefault()
        const sel = window.getSelection()
        if (!sel) return
        const range = document.createRange()
        range.selectNodeContents(vditorReset)
        sel.removeAllRanges()
        sel.addRange(range)
      } else {
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return
        // 焦点不在编辑器：阻止全选整个页面
        e.preventDefault()
      }
    }
  }, true)

  document.addEventListener('mousedown', handleMouseDown)

  document.addEventListener('contextmenu', handleContextMenu, true)
  document.addEventListener('click', hideContextMenu)
  document.addEventListener('keydown', handleKeyDown)

  if (editorContainer.value) {
    vditorInstance = new Vditor(editorContainer.value, {
      lang: 'zh_CN',
      mode: 'wysiwyg',
      value: props.initialContent,
      input: (value: string) => {
        emit('update', value)
      },
      hint: {
        extend: [
          {
            key: '/',
            hint(value: string) {
              const commands = [
                { key: '/todo', html: '<span>/todo</span> 任务列表', value: '/todo' },
                { key: '/code', html: '<span>/code</span> 代码块', value: '/code' },
              ]
              if (!value) return commands
              return commands.filter(cmd => cmd.key.includes(value))
            }
          }
        ]
      },
      after: () => {
        const editorEl = editorContainer.value?.querySelector('[contenteditable="true"]')
        if (!editorEl) return

        editorEl.addEventListener('keydown', (e: Event) => {
          const ke = e as KeyboardEvent
          if (ke.key === 'Enter') {
            const selection = window.getSelection()
            const node = selection?.anchorNode
            const text = node?.textContent || ''
            if (text.trim() === '/todo') {
              ke.preventDefault()
              if (node) node.textContent = ''
              const checkBtn = editorContainer.value?.querySelector('[data-type="check"]') as HTMLElement
              checkBtn?.click()
            } else if (text.trim() === '/code') {
              ke.preventDefault()
              if (node) node.textContent = ''
              const checkBtn = editorContainer.value?.querySelector('[data-type="code"]') as HTMLElement
              checkBtn?.click()
            }
          }
        })
      },
      toolbar: [
        'headings',
        'bold',
        'italic',
        'strike',
        '|',
        'line',
        'quote',
        'list',
        'ordered-list',
        'check',
        '|',
        'code',
        'inline-code',
        'table',
        '|',
        'undo',
        'redo',
      ],
      toolbarConfig: {pin: true},
      preview: {mode: 'both'},
      cache: {enable: false},
      resize: {enable: false},
      height: '100%',
      outline: {enable: false, position: 'left'},
      customWysiwygToolbar: (_, popover) => {
        popover.innerHTML = ""  // 清空工具栏内容
        return popover
      },
    })
  }
})

onUnmounted(() => {
  // 取消正在进行的 AI 请求
  if (aiAbortController) {
    aiAbortController.abort()
  }
  document.removeEventListener('mousedown', handleMouseDown)
  document.removeEventListener('contextmenu', handleContextMenu, true)
  document.removeEventListener('click', hideContextMenu)
  document.removeEventListener('keydown', handleKeyDown)
  if (vditorInstance) {
    vditorInstance.destroy()
    vditorInstance = null
  }
})

watch(() => props.initialContent, (newContent) => {
  if (vditorInstance && newContent !== vditorInstance.getValue()) {
    vditorInstance.setValue(newContent)
  }
})

defineExpose({getVditor: () => vditorInstance})
</script>

<template>
  <div ref="editorContainer" class="vditor-wrapper" :style="{ fontSize: fontSizeStyle }"></div>
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
</template>

<style scoped>
.vditor-wrapper {
  height: 100%;
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 右键菜单 */
.context-menu {
  position: fixed;
  background: rgba(30, 30, 30, 0.95);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
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
  color: #e0e0e0;
  gap: 10px;
}

.context-menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.context-menu-item--disabled {
  color: #888;
  cursor: default;
}

.context-menu-item--disabled:hover {
  background: transparent;
}

.context-menu-icon {
  width: 18px;
  text-align: center;
}

.context-menu-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 6px 0;
}
</style>

<style isGlobal>
/* Vditor headings 菜单向上弹出（因为工具栏在底部） */
.vditor-hint.vditor-panel--arrow {
  top: auto !important;
  bottom: 40px !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  border-radius: 8px 8px 0 0 !important;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3) !important;
}

/* 全局强制覆盖 Vditor 滚动和间距 */
.vditor {
  overflow: auto !important;
  height: 100% !important;
  min-height: 100% !important;
  padding: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  background: var(--color-background) !important;
  border: none !important;
  outline: none !important;
}

.vditor-content {
  overflow: auto !important;
  height: auto !important;
  min-height: 0 !important;
  flex: 1 !important;
  padding: 0 !important;
  background: var(--color-background) !important;
}

.vditor-ir {
  overflow: auto !important;
  height: auto !important;
  min-height: 100% !important;
  padding: 0 !important;
  background: var(--color-background) !important;
}

.vditor-preview {
  overflow: auto !important;
  height: auto !important;
  padding: 0 !important;
  background: var(--color-background) !important;
}

.vditor-reset {
  overflow: visible !important;
  padding: 40px 48px !important;
  margin: 0 !important;
  background: var(--color-background) !important;
  color: var(--color-text) !important;
}

.vditor-toolbar {
  flex-shrink: 0 !important;
  order: 2 !important;
  border-top: 1px solid var(--color-border) !important;
  border-bottom: none !important;
  background: var(--color-surface) !important;
  justify-content: center !important;
}

.vditor-ir {
  order: 1 !important;
}

.vditor-panel {
  flex-shrink: 0 !important;
  background: var(--color-surface) !important;
}

/* 分页显示移到右上角 */
.vditor-page {
  position: absolute !important;
  top: 8px !important;
  right: 16px !important;
  bottom: auto !important;
  left: auto !important;
  z-index: 10 !important;
  background: var(--color-surface) !important;
  padding: 4px 8px !important;
  border-radius: 4px !important;
}

.vditor-toolbar {
  flex-shrink: 0 !important;
  order: 2 !important;
  border-top: 1px solid var(--color-border) !important;
  border-bottom: none !important;
  background: var(--color-surface) !important;
  justify-content: center !important;
  display: flex !important;
  flex-wrap: wrap !important;
  padding-left: 0 !important;
  margin: 0 auto !important;
}
</style>
