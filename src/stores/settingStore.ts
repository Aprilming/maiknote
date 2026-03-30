import { defineStore } from 'pinia'
import { ref } from 'vue'

export type Theme = 'light' | 'dark' | 'auto'

export interface ShortcutSettings {
  showMain: string      // 显示主页面（全局）
  prevNote: string      // 上一页
  nextNote: string      // 下一页
  newNote: string       // 新增页面
  deleteNote: string   // 删除页面
  pin: string          // 置顶窗口
  lock: string         // 锁定/解锁笔记
}

export interface AppSettings {
  theme: Theme
  fontSize: number
  fontFamily: string
  showGrid: boolean
  translucent: boolean
  windowAlpha: number // 窗口透明度 0.1 - 1.0
  alwaysOnTop: boolean
  autoLaunch: boolean // 开机自启动
  globalHotkey: string
  autoSaveInterval: number // milliseconds
  autoDeleteDays: number // 0 = disabled
  shortcuts: ShortcutSettings
  // AI 设置
  aiUrl: string
  aiKey: string
  aiModel: string
  aiOptimizePrompt: string
  aiTodoPrompt: string
  aiPromptPrompt: string
}

export const useSettingStore = defineStore('setting', () => {
  // State
  const settings = ref<AppSettings>({
    theme: 'auto',
    fontSize: 14,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    showGrid: false,
    translucent: true,
    windowAlpha: 1.0,
    alwaysOnTop: false,
    autoLaunch: false,
    globalHotkey: 'Option+Cmd+A',
    autoSaveInterval: 500,
    autoDeleteDays: 0,
    shortcuts: {
      showMain: 'Option+Cmd+A',
      prevNote: 'Cmd+[',
      nextNote: 'Cmd+]',
      newNote: 'Cmd+N',
      deleteNote: 'Cmd+Backspace',
      pin: 'Cmd+P',
      lock: 'Cmd+L',
    },
    aiUrl: 'https://api.deepseek.com/chat/completions',
    aiKey: '',
    aiModel: 'deepseek-chat',
    aiOptimizePrompt: '你是一个笔记优化助手，严格按照以下规则优化笔记内容，直接输出结果，不附加任何说明。\n' +
        '输出格式\n' +
        '返回纯字符串，不使用 ``` 代码块包裹\n' +
        '内容处理规则\n' +
        '删除信息来源（如"来源：""转自："等）\n' +
        '删除所有 tag 标签（如 #标签）\n' +
        '标题处理：全文仅保留一个 H2 标题；若无标题则在顶部生成一个；若已有标题则不新增\n' +
        '链接处理：保留核心内容中的 URL；若为裸链接可转为 Markdown 格式；禁止修改链接本身；无链接时禁止生成链接\n' +
        '禁止输出"注：""备注：""注意："等注释性内容\n' +
        '禁止输出"已优化""优化笔记""以下是"等无关话语',
    aiTodoPrompt: '从以下文本中提取待办事项，按如下格式输出：\n' +
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
    aiPromptPrompt: '你是一个提示词优化专家，用户会给你一段提示词，你需要对其进行优化并直接输出结果。\n' +
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
        '若存在矛盾规则，以最后出现的为准并合并'
  })

  // Actions
  function updateSettings<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    settings.value[key] = value
    // Save to localStorage
    saveSettings()
  }

  function loadSettings() {
    try {
      const saved = localStorage.getItem('maiknote-settings')
      if (saved) {
        const parsed = JSON.parse(saved)
        settings.value = { ...settings.value, ...parsed }
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem('maiknote-settings', JSON.stringify(settings.value))
    } catch (e) {
      console.error('Failed to save settings:', e)
    }
  }

  function resetSettings() {
    settings.value = {
      theme: 'auto',
      fontSize: 14,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      showGrid: false,
      translucent: true,
      windowAlpha: 1.0,
      alwaysOnTop: false,
      autoLaunch: false,
      globalHotkey: 'Option+Cmd+A',
      autoSaveInterval: 500,
      autoDeleteDays: 0,
      shortcuts: {
        showMain: 'Option+Cmd+A',
        prevNote: 'Ctrl+[',
        nextNote: 'Ctrl+]',
        newNote: 'Cmd+N',
        deleteNote: 'Cmd+Backspace',
        pin: 'Cmd+P',
        lock: 'Cmd+L',
      },
      aiUrl: 'https://api.deepseek.com/chat/completions',
      aiKey: '',
      aiModel: 'deepseek-chat',
      aiOptimizePrompt: '你是一个笔记优化助手，严格按照以下规则优化笔记内容，直接输出结果，不附加任何说明。\n' +
          '输出格式\n' +
          '返回纯字符串，不使用 ``` 代码块包裹\n' +
          '内容处理规则\n' +
          '删除信息来源（如"来源：""转自："等）\n' +
          '删除所有 tag 标签（如 #标签）\n' +
          '标题处理：全文仅保留一个 H2 标题；若无标题则在顶部生成一个；若已有标题则不新增\n' +
          '链接处理：保留核心内容中的 URL；若为裸链接可转为 Markdown 格式；禁止修改链接本身；无链接时禁止生成链接\n' +
          '禁止输出"注：""备注：""注意："等注释性内容\n' +
          '禁止输出"已优化""优化笔记""以下是"等无关话语',
      aiTodoPrompt: '从以下文本中提取待办事项，按如下格式输出：\n' +
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
      aiPromptPrompt: '你是一个提示词优化专家，用户会给你一段提示词，你需要对其进行优化并直接输出结果。\n' +
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
          '若存在矛盾规则，以最后出现的为准并合并'
    }
    saveSettings()
  }

  // Initialize
  loadSettings()

  return {
    settings,
    updateSettings,
    loadSettings,
    saveSettings,
    resetSettings,
  }
})
