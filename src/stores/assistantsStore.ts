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
    name: '笔记优化',
    prompt: [
      '你是一个笔记整理助手。紧随本提示词之后的内容是待整理的笔记原文，请按规则改写并直接输出改写后的全文。',
      '改写规则',
      '- 保持原意与信息量，不增删事实、不臆造内容、不缩写省略',
      '- 保留原有术语、代码、数字；链接保持原样，纯 URL 可改为 Markdown 链接，禁止修改或新增链接',
      '- 删除来源署名（来源：、转自：、原文链接：等）、#标签、广告与推荐语',
      '- 标题：全文只保留一个 H2 标题；原文没有标题就按内容自拟（20 字以内）；已有标题则就地规范，不重复添加',
      '- 用 Markdown 组织内容，列表、引用、代码块、加粗按语义使用且层级正确',
      '- 段落之间只留一个空行，去掉多余空格、空行和残留符号',
      '',
      '输出要求',
      '- 只输出整理后的正文本身，第一个字就是正文',
      '- 不使用 Markdown 代码块包裹整体内容',
      '- 不输出“以下是”“已优化”“注：”“备注：”“注意：”等说明性文字',
      '- 语言与原文一致',
    ].join('\n'),
    createdAt: 0,
    searchEnabled: true,
  },
  {
    id: 'template-2',
    name: '提取任务',
    prompt: [
      '你是一个待办提取助手。紧随本提示词之后的内容是笔记原文，请先概括主题，再抽出可执行的事项，直接输出结果。',
      '',
      '输出结构（两部分，顺序固定）',
      '第一部分：主题概括',
      '- 一个 H2 标题，20 字以内，说清这段笔记在讲什么',
      '- 标题下用一到三行正文交代时间、地点、人物、对象等关键背景，没有则省去这段',
      '第二部分：待办列表',
      '- 每条任务一行，格式固定为 - [ ] 任务描述',
      '- 每行必须以「- 空格 [ 空格 ] 空格」开头，连字符和方括号缺一个都会退化成普通文字、不再是勾选框；不要写成 [ ]、[]、- [ ] 以外的任何形式',
      '- 描述写明动作和对象；能带上日期、时间、截止点的一律带上，例如 10 月 12 日 14:00 前提交报价',
      '- 一条任务只讲一件事；原文里明确但有隐含的下一步可以拆成独立任务',
      '- 只记录文中真正要做的事，不臆造，不把纯陈述句硬改成任务',
      '',
      '输出要求',
      '- 不使用“以下是”“任务列表如下”等引导语，直接给结果',
      '- 除 H2 标题和 - [ ] 行，不使用其他列表记号；有序列表、圆点列表、表格一律不用',
      '- 若原文没有任何可执行事项，则去掉两部分结构，只输出格式优化后的正文：保留标题与段落，清理多余空格空行，规范原有列表',
      '- 不使用 Markdown 代码块包裹整体内容，语言与原文一致',
    ].join('\n'),
    createdAt: 0,
    searchEnabled: true,
  },
  {
    id: 'template-3',
    name: '优化提示词',
    prompt: [
      '你是一个提示词改写专家。紧随本提示词之后的内容是用户写的原始提示词，请把它改写成更可靠、可直接使用的版本，并直接输出改写结果。',
      '',
      '改写原则',
      '- 忠于原始意图，不改变任务目标，不替换用户指定的对象与口径',
      '- 把口语、含糊、前后矛盾的表述改成明确、可执行的指令',
      '- 补齐缺失的关键约束：角色与目标、输入说明、输出格式、篇幅、语气、禁止行为、边界情况',
      '- 合并重复规则；规则冲突时以后出现的为准，并在改写里只保留一个版本',
      '- 按角色、任务、输入、规则、输出格式、特殊情况分块，用短标题加列表，不写成大段散文',
      '- 原文里的专有名词、数字、格式要求原样保留',
      '',
      '输出要求',
      '- 只输出改写后的提示词本身，不加解释、对比或修改说明',
      '- 不使用 Markdown 代码块包裹整体内容',
      '- 若原文极简（只有一句话），按最合理的默认设定补全，不要反问用户',
    ].join('\n'),
    createdAt: 0,
    searchEnabled: true,
  },
]

export const defaultAiConfig: AiConfig = {
  url: 'https://api.deepseek.com/chat/completions',
  key: '',
  model: 'deepseek-v4-flash',
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
   * Move one assistant to another assistant's position (drag to reorder)
   */
  async function moveAssistant(fromId: string, toId: string): Promise<boolean> {
    if (fromId === toId) return false
    const list = assistants.value
    const from = list.findIndex(a => a.id === fromId)
    const to = list.findIndex(a => a.id === toId)
    if (from === -1 || to === -1) return false

    const [moved] = list.splice(from, 1)
    // 目标卡片上方落点：向下拖时目标索引已被自身移除影响，需要回退一位
    const insertAt = from < to ? to - 1 : to
    list.splice(insertAt, 0, moved)
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
    moveAssistant,
    deleteAssistant,
    getAssistantById,
    hasPrompt,
    hasUserPrompt,
    updateAiConfig,
    updateBaiduSearchKey,
  }
})
