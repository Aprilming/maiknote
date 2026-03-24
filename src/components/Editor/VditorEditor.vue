<script setup lang="ts">
import {ref, onMounted, onUnmounted, watch, computed} from 'vue'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import 'highlight.js/styles/github.css'
import { useSettingStore } from '@/stores/settingStore'

const props = defineProps<{
  initialContent: string
  fontSize: number
  fontFamily: string
}>()

const emit = defineEmits<{
  update: [markdown: string]
}>()

const settingStore = useSettingStore()
const editorContainer = ref<HTMLElement>()
let vditorInstance: Vditor | null = null

const isAILoading = ref(false)

const contextMenuVisible = ref(false)
const contextMenuRef = ref<HTMLElement>()
const contextMenuStyle = ref<{left: string, top: string}>({left: '0px', top: '0px'})

const hasAIConfig = computed(() => true) // 始终显示菜单，未配置时点击会提示

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

// 获取选中文本或全部内容
function getSelectionText(): string {
  const selection = window.getSelection()
  const text = selection?.toString().trim()
  return text || props.initialContent
}

// 调用AI API
async function callAI(promptType: 'optimize' | 'todo' | 'prompt') {
  isAILoading.value = true
  document.body.style.cursor = 'wait'

  const text = getSelectionText()
  let prompt: string
  switch (promptType) {
    case 'optimize':
      prompt = settingStore.settings.aiOptimizePrompt
      break
    case 'todo':
      prompt = settingStore.settings.aiTodoPrompt
      break
    case 'prompt':
      prompt = settingStore.settings.aiPromptPrompt
      break
  }

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
          { role: 'system', content: '你是一个笔记软件的文本处理助手。' },
          { role: 'user', content: `${prompt}\n\n${text}` }
        ],
        temperature: 0.7
      })
    })

    if (!response.ok) {
      throw new Error(`API错误: ${response.status}`)
    }

    const data = await response.json()
    const result = data.choices?.[0]?.message?.content?.trim()

    if (result) {
      const trimmedResult = result.trim()
      if (trimmedResult && vditorInstance) {
        vditorInstance.setValue(trimmedResult)
        emit('update', trimmedResult)
      }
    }
    showToast('已完成')
  } catch (error) {
    console.error('AI调用失败:', error)
    showToast(`AI调用失败: ${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    isAILoading.value = false
    document.body.style.cursor = ''
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
}

// ESC 键监听
function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    hideContextMenu()
  }
}


function handleAI(type: 'optimize' | 'todo' | 'prompt') {
  hideContextMenu()
  if (!settingStore.settings.aiUrl || !settingStore.settings.aiKey || !settingStore.settings.aiModel) {
    showToast('请先在设置中配置 AI')
    return
  }
  callAI(type)
}

onMounted(() => {
  // 在capture阶段监听，确保在Vditor之前处理
  document.addEventListener('contextmenu', handleContextMenu, true)
  document.addEventListener('click', hideContextMenu)
  document.addEventListener('keydown', handleKeyDown)

  if (editorContainer.value) {
    vditorInstance = new Vditor(editorContainer.value, {
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
      outline: {enable: false, position: 'left'}
    })
  }
})

onUnmounted(() => {
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
      <template v-if="hasAIConfig">
        <div class="context-menu-item" @click="handleAI('optimize')">
          <span class="context-menu-icon">✨</span>
          <span>优化显示</span>
        </div>
        <div class="context-menu-item" @click="handleAI('todo')">
          <span class="context-menu-icon">☐</span>
          <span>提取任务</span>
        </div>
        <div class="context-menu-item" @click="handleAI('prompt')">
          <span class="context-menu-icon">💡</span>
          <span>提示词优化</span>
        </div>
<!--        <div class="context-menu-divider"></div>-->
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
/* 全局强制覆盖 Vditor 滚动和间距 */
.vditor {
  overflow: auto !important;
  height: 100% !important;
  min-height: 100% !important;
  padding: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  background: transparent !important;
}

.vditor-content {
  overflow: auto !important;
  height: auto !important;
  min-height: 0 !important;
  flex: 1 !important;
  padding: 0 !important;
  background: transparent !important;
}

.vditor-ir {
  overflow: auto !important;
  height: auto !important;
  min-height: 100% !important;
  padding: 0 !important;
  background: transparent !important;
}

.vditor-preview {
  overflow: auto !important;
  height: auto !important;
  padding: 0 !important;
  background: transparent !important;
}

.vditor-reset {
  overflow: visible !important;
  padding: 40px 48px !important;
  margin: 0 !important;
  background: transparent !important;
}

.vditor-toolbar {
  flex-shrink: 0 !important;
  order: 2 !important;
  border-top: 1px solid var(--border-color) !important;
  border-bottom: none !important;
  background: transparent !important;
  justify-content: center !important;
}

.vditor-ir {
  order: 1 !important;
}

.vditor-panel {
  flex-shrink: 0 !important;
  background: transparent !important;
}

/* 分页显示移到右上角 */
.vditor-page {
  position: absolute !important;
  top: 8px !important;
  right: 16px !important;
  bottom: auto !important;
  left: auto !important;
  z-index: 10 !important;
  background: transparent !important;
  padding: 4px 8px !important;
  border-radius: 4px !important;
}

.vditor-toolbar {
  flex-shrink: 0 !important;
  order: 2 !important;
  border-top: 1px solid var(--border-color) !important;
  border-bottom: none !important;
  background: transparent !important;
  justify-content: center !important;
  display: flex !important;
  flex-wrap: wrap !important;
  padding-left: 0 !important;
  margin: 0 auto !important;
}
</style>
