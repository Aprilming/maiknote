import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useFileSystem } from '@/composables/useFileSystem'

// Assistant interface
export interface Assistant {
  id: string
  name: string
  prompt: string
  searchEnabled: boolean
  createdAt: number // timestamp in milliseconds
}

export interface AiConfig {
  url: string
  key: string
  model: string
}

// Default template assistants - using string literals to avoid Pinia initialization issues
export const defaultAssistants: Assistant[] = [
  {
    id: 'template-1',
    name: '优化内容',
    prompt: '你是一个笔记优化助手，严格按照以下规则优化笔记内容，直接输出结果，不附加任何说明。\n' +
        '输出格式\n' +
        '返回纯字符串，不使用 ``` 代码块包裹\n' +
        '内容处理规则\n' +
        '删除信息来源（如"来源：""转自："等）\n' +
        '删除所有 tag 标签（如 #标签）\n' +
        '标题处理：全文仅保留一个 H2 标题；若无标题则在顶部生成一个；若已有标题则不新增\n' +
        '链接处理：保留核心内容中的 URL；若为裸链接可转为 Markdown 格式；禁止修改链接本身；无链接时禁止生成链接\n' +
        '禁止输出"注：""备注：""注意："等注释性内容\n' +
        '禁止输出"已优化""优化笔记""以下是"等无关话语',
    createdAt: 0,
    searchEnabled: true,
  },
  {
    id: 'template-2',
    name: '提取任务',
    prompt: '从以下文本中提取待办事项，按如下格式输出：\n' +
        '第一部分：笔记摘要\n' +
        '用 h1–h3 标题概括笔记主题，标题 10 字以内\n' +
        '标题下方正文仅保留日期、时间及关键信息，无则省略\n' +
        '可适当添加表情 🎯\n' +
        '第二部分：任务列表\n' +
        '每条任务以 - [ ] 开头，保留时间、日期等关键信息\n' +
        '不使用有序或无序列表，只用 - [ ] 格式\n' +
        '特殊情况\n' +
        '若无法提取到任务，则对笔记进行格式优化后输出\n' +
        '不要输出任何引导语（如"以下是……"）',
    createdAt: 0,
    searchEnabled: true,
  },
  {
    id: 'template-3',
    name: '优化提示词',
    prompt: '你是一个提示词优化专家，用户会给你一段提示词，你需要对其进行优化并直接输出结果。\n' +
        '优化原则\n' +
        '保留用户的原始意图，不改变核心需求\n' +
        '补全缺失的约束条件（格式、边界情况、禁止行为等）\n' +
        '消除歧义表达，改为明确、可执行的指令\n' +
        '合并重复或冲突的规则\n' +
        '结构清晰，分块呈现\n' +
        '输出格式\n' +
        '直接输出优化后的提示词，不加任何说明\n' +
        '不使用 ``` 包裹\n' +
        '不输出"以下是优化后的提示词"等引导语\n' +
        '特殊情况\n' +
        '若用户的提示词过于简单，主动补全合理的默认规则\n' +
        '若存在矛盾规则，以最后出现的为准并合并',
    createdAt: 0,
    searchEnabled: true,
  },
]

export const defaultAiConfig: AiConfig = {
  url: 'https://api.deepseek.com/chat/completions',
  key: '',
  model: 'deepseek-chat',
}

export const useAssistantsStore = defineStore('assistants', () => {
  // State
  const assistants = ref<Assistant[]>([])
  const isLoaded = ref(false)
  const aiUrl = ref(defaultAiConfig.url)
  const aiKey = ref(defaultAiConfig.key)
  const aiModel = ref(defaultAiConfig.model)
  const aiConfigExists = ref(false)
  const baiduSearchKey = ref('')

  // File system operations
  const { getICloudPath } = useFileSystem()

  /**
   * Generate a unique ID using crypto.randomUUID()
   */
  function generateId(): string {
    return crypto.randomUUID()
  }

  /**
   * Load assistants from iCloud file
   */
  async function loadAssistants(): Promise<void> {
    try {
      const path = await getICloudPath()
      const content = await invoke<string>('read_assistants', { basePath: path })

      if (content) {
        const parsed = JSON.parse(content)
        assistants.value = (parsed.assistants || []).map((a: Record<string, unknown>) => ({
          ...a,
          searchEnabled: a.searchEnabled === true,
        })) as Assistant[]

        // Load AI config from iCloud
        if (parsed.aiConfig) {
          aiUrl.value = parsed.aiConfig.url || defaultAiConfig.url
          aiKey.value = parsed.aiConfig.key || defaultAiConfig.key
          aiModel.value = parsed.aiConfig.model || defaultAiConfig.model
          aiConfigExists.value = true
        }

        // Load Baidu search key from iCloud
        if (parsed.baiduSearchKey) {
          baiduSearchKey.value = parsed.baiduSearchKey
        }
      }

      isLoaded.value = true
    } catch (e) {
      // If file doesn't exist or read fails, use default assistants
      console.error('Failed to load assistants, using defaults:', e)
      assistants.value = [...defaultAssistants]
      isLoaded.value = true
    }
  }

  /**
   * Save assistants and AI config to iCloud file
   */
  async function saveAssistants(): Promise<void> {
    try {
      const path = await getICloudPath()
      const content = JSON.stringify({
        version: 1,
        assistants: assistants.value,
        aiConfig: { url: aiUrl.value, key: aiKey.value, model: aiModel.value },
        baiduSearchKey: baiduSearchKey.value,
      }, null, 2)
      await invoke('write_assistants', { basePath: path, content })
    } catch (e) {
      console.error('Failed to save assistants:', e)
    }
  }

  /**
   * Add a new assistant
   */
  async function addAssistant(name: string, prompt: string, searchEnabled = false): Promise<Assistant> {
    const newAssistant: Assistant = {
      id: generateId(),
      name,
      prompt,
      searchEnabled,
      createdAt: Date.now(),
    }

    assistants.value.push(newAssistant)
    await saveAssistants()
    return newAssistant
  }

  /**
   * Update an existing assistant
   */
  async function updateAssistant(id: string, updates: Partial<Pick<Assistant, 'name' | 'prompt' | 'searchEnabled'>>): Promise<boolean> {
    const index = assistants.value.findIndex(a => a.id === id)
    if (index === -1) {
      return false
    }

    assistants.value[index] = {
      ...assistants.value[index],
      ...updates,
    }

    await saveAssistants()
    return true
  }

  /**
   * Delete an assistant
   */
  async function deleteAssistant(id: string): Promise<boolean> {
    const index = assistants.value.findIndex(a => a.id === id)
    if (index === -1) {
      return false
    }

    assistants.value.splice(index, 1)
    await saveAssistants()
    return true
  }

  /**
   * Get assistant by ID
   */
  function getAssistantById(id: string): Assistant | undefined {
    return assistants.value.find(a => a.id === id)
  }

  /**
   * Check if an assistant with the same prompt already exists
   * @param prompt The prompt to check
   * @param excludeId Optional ID to exclude from check (for updates)
   */
  function hasPrompt(prompt: string, excludeId?: string): boolean {
    return assistants.value.some(a => a.prompt === prompt && a.id !== excludeId)
  }

  /**
   * Check if an assistant with the same prompt already exists (excluding template assistants)
   * @param prompt The prompt to check
   * @param excludeId Optional ID to exclude from check (for updates)
   */
  function hasUserPrompt(prompt: string, excludeId?: string): boolean {
    return assistants.value.some(
      a => a.prompt === prompt && a.id !== excludeId && !a.id.startsWith('template-')
    )
  }

  /**
   * Update AI config (url, key, model) and persist to iCloud
   */
  async function updateAiConfig(url: string, key: string, model: string): Promise<void> {
    aiUrl.value = url
    aiKey.value = key
    aiModel.value = model
    await saveAssistants()
  }

  async function updateBaiduSearchKey(key: string): Promise<void> {
    baiduSearchKey.value = key
    await saveAssistants()
  }

  return {
    assistants,
    isLoaded,
    aiConfigExists,
    aiUrl,
    aiKey,
    aiModel,
    baiduSearchKey,
    loadAssistants,
    saveAssistants,
    addAssistant,
    updateAssistant,
    deleteAssistant,
    getAssistantById,
    hasPrompt,
    hasUserPrompt,
    updateAiConfig,
    updateBaiduSearchKey,
  }
})
