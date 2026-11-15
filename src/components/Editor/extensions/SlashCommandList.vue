<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Editor } from '@tiptap/vue-3'
import { invoke } from '@tauri-apps/api/core'
import { emojiCategories, filterEmojis, type EmojiItem } from './emojiData'
import { useSettingStore, normalizeIpApiUrl } from '@/stores/settingStore'
import { useNoteStore } from '@/stores/noteStore'
import { useLinkStore } from '@/stores/linkStore'
import NotePicker from '../NotePicker.vue'
import { sanitizeLinkTitle } from '@/composables/useNoteLinks'

const props = defineProps<{
  command: (item: { title: string; command: string }) => void
  editor: Editor
  items: Array<{ title: string; command: string }>
  range?: { from: number; to: number }
  onReposition?: () => void
}>()

type Mode = 'commands' | 'emoji' | 'link'
const mode = ref<Mode>('commands')

const noteStore = useNoteStore()
const linkStore = useLinkStore()
const linkPickerRef = ref<InstanceType<typeof NotePicker> | null>(null)

// /link 的候选笔记：排除当前笔记与回收站
const linkCandidates = computed(() => linkStore.linkableNotes(noteStore.currentNote?.id))

const selectedIndex = ref(0)
const listRef = ref<HTMLElement>()

// 弹窗尺寸一变（切到 /link、候选变多、进 emoji）就重新定位
function repositionPopup() {
  nextTick(() => props.onReposition?.())
}

watch(mode, () => repositionPopup())
watch(linkCandidates, () => repositionPopup())
const emojiSearchRef = ref<HTMLInputElement>()
const emojiQuery = ref('')
const { t } = useI18n()

// 滚动到选中项
function scrollToSelected() {
  nextTick(() => {
    if (!listRef.value) return
    const buttons = listRef.value.querySelectorAll('.slash-item, .emoji-item')
    const selectedBtn = buttons[selectedIndex.value] as HTMLElement
    if (!selectedBtn) return

    const listHeight = listRef.value.clientHeight
    const itemTop = selectedBtn.offsetTop
    const itemBottom = itemTop + selectedBtn.offsetHeight

    if (itemTop < listRef.value.scrollTop) {
      listRef.value.scrollTop = itemTop
    } else if (itemBottom > listRef.value.scrollTop + listHeight) {
      listRef.value.scrollTop = itemBottom - listHeight
    }
  })
}

// 分组的命令列表
const COMMAND_GROUPS = [
  {
    labelKey: 'slash.basicBlocks',
    items: [
      { titleKey: 'slash.heading1', command: 'heading1', keyword: 'h1', icon: 'H1' },
      { titleKey: 'slash.heading2', command: 'heading2', keyword: 'h2', icon: 'H2' },
      { titleKey: 'slash.heading3', command: 'heading3', keyword: 'h3', icon: 'H3' },
    ]
  },
  {
    labelKey: 'slash.lists',
    items: [
      { titleKey: 'slash.bulletList', command: 'bulletList', keyword: 'ul', icon: '•' },
      { titleKey: 'slash.orderedList', command: 'orderedList', keyword: 'ol', icon: '1.' },
      { titleKey: 'slash.todo', command: 'todo', keyword: 'todo', icon: '☑' },
    ]
  },
  {
    labelKey: 'slash.insert',
    items: [
      { titleKey: 'slash.link', command: 'link', keyword: 'link', icon: '🔗' },
      { titleKey: 'slash.emoji', command: 'emoji', keyword: 'emoji', icon: '😊' },
      { titleKey: 'slash.quote', command: 'blockquote', keyword: 'quote', icon: '"' },
      { titleKey: 'slash.code', command: 'code', keyword: 'code', icon: '<>' },
      { titleKey: 'slash.table', command: 'table', keyword: 'table', icon: '⊞' },
      { titleKey: 'slash.date', command: 'date', keyword: 'date', icon: '📅' },
      { titleKey: 'slash.time', command: 'time', keyword: 'time', icon: '🕐' },
      { titleKey: 'slash.datetime', command: 'datetime', keyword: 'datetime', icon: '🕒' },
    ]
  },
  {
    labelKey: 'slash.tools',
    items: [
      { titleKey: 'slash.ipinfo', command: 'ipinfo', keyword: 'ip', icon: '🌐' },
    ]
  }
]

// 过滤后的命令项
const filteredItems = ref<
  Array<{ titleKey: string; title: string; command: string; keyword: string; icon: string }>
>([])

function updateFilteredItems(query: string) {
  if (!query) {
    filteredItems.value = COMMAND_GROUPS.flatMap(g => g.items).map(item => ({
      ...item,
      title: t(item.titleKey),
    }))
  } else {
    filteredItems.value = COMMAND_GROUPS
      .flatMap(g => g.items)
      // 中文标题里没有英文单词，所以关键词和命令名也参与匹配（敲 /h1、/link 都能命中）
      .filter(item => {
        const q = query.toLowerCase()
        return (
          t(item.titleKey).toLowerCase().includes(q) ||
          item.keyword.toLowerCase().includes(q) ||
          item.command.toLowerCase().includes(q)
        )
      })
      .map(item => ({ ...item, title: t(item.titleKey) }))
  }
  selectedIndex.value = 0
}

// emoji 搜索结果
const filteredEmojis = computed(() => filterEmojis(emojiQuery.value))

const emojiColumns = 8

// 分页显示（每页 40 个）
const emojiPageSize = 40
const emojiPage = ref(0)

const pagedEmojis = computed(() => {
  const all = filteredEmojis.value
  const totalPages = Math.ceil(all.length / emojiPageSize)
  if (emojiPage.value >= totalPages) emojiPage.value = Math.max(0, totalPages - 1)
  return all.slice(emojiPage.value * emojiPageSize, (emojiPage.value + 1) * emojiPageSize)
})

const hasMoreEmojis = computed(() => {
  return filteredEmojis.value.length > (emojiPage.value + 1) * emojiPageSize
})

// 日期时间工具
function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function currentDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function currentTime(): string {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// 执行命令
function runCommand(command: string) {
  const editor = props.editor
  if (!editor) return

  switch (command) {
    case 'todo':
      editor.chain().focus().toggleTaskList().run()
      break
    case 'code':
      editor.chain().focus().toggleCodeBlock().run()
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
    case 'blockquote':
      editor.chain().focus().toggleBlockquote().run()
      break
    case 'table':
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      break
    case 'ipinfo':
      handleIpInfo()
      break
    case 'date':
      editor.chain().focus().insertContent(currentDate()).run()
      break
    case 'time':
      editor.chain().focus().insertContent(currentTime()).run()
      break
    case 'datetime':
      editor.chain().focus().insertContent(`${currentDate()} ${currentTime()}`).run()
      break
  }
}

// 网络信息响应类型
interface NetworkInfoResponse {
  public_ip?: {
    country: string
    province: string
    city: string
    ip: string
    isp: string
    scene: string
    company: string
  } | null
  local_interfaces: Array<{
    name: string
    ips: string[]
  }>
}

// 获取并插入网络信息
async function handleIpInfo() {
  const editor = props.editor
  if (!editor) return

  // 记录当前光标位置（/ip 已被 deleteRange 删除）
  const start = editor.state.selection.from

  // 插入 loading 占位
  const loadingHtml = '<p>⏳ 正在获取网络信息...</p>'
  editor.chain().focus().insertContent(loadingHtml).run()

  try {
    // 通用设置里可改查询地址，空值/非法地址在 store 与后端各回落一次默认值
    const ipApiUrl = normalizeIpApiUrl(useSettingStore().settings.ipApiUrl)
    const info = await invoke<NetworkInfoResponse>('get_network_info', { ipApiUrl })
    const html = buildIpInfoHtml(info)
    // 删除 loading 占位，替换为实际内容
    const end = editor.state.selection.to
    editor.chain().focus().setTextSelection({ from: start, to: end }).deleteSelection().insertContent(html).run()
  } catch {
    // 请求失败：删除 loading 占位
    editor.chain().focus().setTextSelection({ from: start, to: editor.state.selection.to }).deleteSelection().run()
  }
}

// 构建 IP 信息 HTML（带颜色）
function buildIpInfoHtml(info: NetworkInfoResponse): string {
  const parts: string[] = []

  // 标题
  parts.push('<h3><span style="color: #667eea">〓 网络信息 〓</span></h3>')

  // 出口 IP
  if (info.public_ip) {
    const p = info.public_ip
    parts.push('<p>')
    parts.push('<strong><span style="color: #e67e22">出口IP</span></strong>')
    parts.push('<br><span style="color: #2ecc71">IP: </span>')
    parts.push(`<code>${escapeHtml(p.ip)}</code>`)
    parts.push('<br><span style="color: #2ecc71">国家: </span>')
    parts.push(`${escapeHtml(p.country)} | ${escapeHtml(p.province)} | ${escapeHtml(p.city)}`)
    parts.push('<br><span style="color: #2ecc71">ISP: </span>')
    parts.push(escapeHtml(p.isp))
    parts.push('</p>')
  }

  // 本地网卡
  parts.push('<p>')
  parts.push('<strong><span style="color: #27ae60">本地网卡</span></strong>')
  for (const iface of info.local_interfaces) {
    parts.push(`<br><span style="color: #3498db">${escapeHtml(iface.name)}</span>`)
    for (let i = 0; i < iface.ips.length; i++) {
      const ip = iface.ips[i]
      const isV4 = ip.includes('.')
      const color = isV4 ? '#9b59b6' : '#1abc9c'
      const label = isV4 ? 'IPv4' : 'IPv6'
      parts.push(` <span style="color: ${color}">${escapeHtml(ip)}</span>`)
      parts.push(`<span style="color: var(--color-text-secondary); font-size: 0.85em">(${label})</span>`)
    }
  }
  parts.push('</p>')

  return parts.join('')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 选择命令项
function selectItem(index: number) {
  const item = filteredItems.value[index]
  if (!item) return

  if (item.command === 'link') {
    // 进入笔记选择模式，暂不删除 range（取消时原文还在）
    mode.value = 'link'
    selectedIndex.value = 0
    return
  }

  if (item.command === 'emoji') {
    // 切换到 emoji 模式，暂不删除 range
    mode.value = 'emoji'
    emojiQuery.value = ''
    emojiPage.value = 0
    selectedIndex.value = 0
    nextTick(() => emojiSearchRef.value?.focus())
    return
  }

  const editor = props.editor
  if (!editor) return

  // 删除 / 及搜索文本
  if (props.range) {
    editor.chain().focus().deleteRange(props.range).run()
  }
  runCommand(item.command)
}

// /link 选中一篇笔记：删掉 /link 输入，写入 [[标题]]
function handleLinkPick(title: string) {
  const editor = props.editor
  if (!editor) return

  const clean = sanitizeLinkTitle(title)
  if (!clean) {
    mode.value = 'commands'
    updateFilteredItems('')
    return
  }

  if (props.range) {
    editor.chain().focus().deleteRange(props.range).insertContent(`[[${clean}]]`).run()
  } else {
    editor.chain().focus().insertContent(`[[${clean}]]`).run()
  }

  mode.value = 'commands'
  updateFilteredItems('')
}

// 取消 /link：恢复命令列表，原文（/link）保留
function cancelLink() {
  mode.value = 'commands'
  nextTick(() => props.editor?.commands?.focus())
  updateFilteredItems('')
}

// 选择 emoji
function selectEmoji(emoji: EmojiItem) {
  const editor = props.editor
  if (!editor) return

  // 删除 / 及搜索文本，然后插入 emoji
  if (props.range) {
    editor.chain().focus().deleteRange(props.range).insertContent(emoji.emoji).run()
  } else {
    editor.chain().focus().insertContent(emoji.emoji).run()
  }
}

function emojiIndexToRowCol(index: number): { row: number; col: number } {
  return {
    row: Math.floor(index / emojiColumns),
    col: index % emojiColumns,
  }
}

function emojiRowColToIndex(row: number, col: number): number {
  return row * emojiColumns + col
}

// 暴露方法给外部
defineExpose({
  onKeyDown: (event: KeyboardEvent) => {
    if (mode.value === 'link') {
      const handled = linkPickerRef.value?.onKeyDown?.(event) ?? false
      // 选择器内部的 Backspace 交给它自己处理，避免编辑器吃掉
      if (handled) event.preventDefault()
      return handled
    }
    if (mode.value === 'emoji') {
      return handleEmojiKeyDown(event)
    }
    return handleCommandsKeyDown(event)
  },
  onQueryUpdate: (query: string) => {
    if (mode.value === 'commands') {
      updateFilteredItems(query)
    }
  }
})

function handleCommandsKeyDown(event: KeyboardEvent): boolean {
  if (filteredItems.value.length === 0) return false

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + filteredItems.value.length) % filteredItems.value.length
    scrollToSelected()
    return true
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % filteredItems.value.length
    scrollToSelected()
    return true
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    selectItem(selectedIndex.value)
    return true
  }
  return false
}

function handleEmojiKeyDown(event: KeyboardEvent): boolean {
  const total = pagedEmojis.value.length
  if (total === 0) return false

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    const { row, col } = emojiIndexToRowCol(selectedIndex.value)
    if (row > 0) {
      selectedIndex.value = emojiRowColToIndex(row - 1, col)
      if (selectedIndex.value >= total) {
        selectedIndex.value = col // 上一行可能更短，回退到第一行的同列
      }
    }
    scrollToSelected()
    return true
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    const { row, col } = emojiIndexToRowCol(selectedIndex.value)
    const newIndex = emojiRowColToIndex(row + 1, col)
    if (newIndex < total) {
      selectedIndex.value = newIndex
    } else {
      // 没有更多行，翻到下一页
      if (hasMoreEmojis.value) {
        emojiPage.value++
        selectedIndex.value = col
        if (selectedIndex.value >= pagedEmojis.value.length) {
          selectedIndex.value = pagedEmojis.value.length - 1
        }
      }
    }
    scrollToSelected()
    return true
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    if (selectedIndex.value > 0) {
      selectedIndex.value--
    }
    scrollToSelected()
    return true
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    if (selectedIndex.value < total - 1) {
      selectedIndex.value++
    } else if (hasMoreEmojis.value) {
      // 到末尾翻下一页
      emojiPage.value++
      selectedIndex.value = 0
    }
    scrollToSelected()
    return true
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const emoji = pagedEmojis.value[selectedIndex.value]
    if (emoji) {
      selectEmoji(emoji)
    }
    return true
  }
  if (event.key === 'Backspace') {
    if (emojiQuery.value === '') {
      // 搜索为空时，Backspace 返回命令列表
      event.preventDefault()
      mode.value = 'commands'
      updateFilteredItems('')
      return true
    }
    return false
  }
  return false
}

// 搜索输入框键盘事件处理（独立于编辑器键盘事件）
function onEmojiSearchKeydown(event: KeyboardEvent) {
  // 让字符输入正常传递
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return // 字符输入交给 input 处理
  }
  // 导航和功能键由 handleEmojiKeyDown 处理
  handleEmojiKeyDown(event)
}

// 初始化
updateFilteredItems('')
</script>

<template>
  <div class="slash-command-popup">
    <!-- 命令列表模式 -->
    <div v-if="mode === 'commands'" ref="listRef" class="slash-command-list">
      <template v-if="filteredItems.length === 0">
        <div class="slash-empty">{{ $t('slash.noMatch') }}</div>
      </template>
      <template v-else>
        <button
          v-for="(item, index) in filteredItems"
          :key="item.command + index"
          class="slash-item"
          :class="{ 'is-selected': index === selectedIndex }"
          @click="selectItem(index)"
          @mouseenter="selectedIndex = index"
        >
          <span class="slash-icon">{{ item.icon }}</span>
          <span class="slash-title">{{ item.title }}</span>
          <span class="slash-keyword">/{{ item.keyword }}</span>
        </button>
      </template>
    </div>

    <!-- 笔记链接选择模式（/link） -->
    <div v-else-if="mode === 'link'" class="link-picker">
      <div class="link-picker-header">
        <span class="link-picker-title">{{ $t('slash.linkTitle') }}</span>
        <button class="emoji-back-btn" :title="$t('slash.backToCommands')" @click="cancelLink">
          <i class="i-mdi-arrow-left"></i>
        </button>
      </div>
      <NotePicker
        ref="linkPickerRef"
        :notes="linkCandidates"
        :placeholder="$t('slash.linkSearch')"
        :empty-text="$t('slash.linkEmpty')"
        :create-label="$t('slash.linkNew')"
        @select="handleLinkPick"
        @cancel="cancelLink"
        @resize="repositionPopup"
      />
    </div>

    <!-- Emoji 选择模式 -->
    <div v-else class="emoji-picker">
      <div class="emoji-header">
        <input
          ref="emojiSearchRef"
          v-model="emojiQuery"
          class="emoji-search"
          :placeholder="$t('slash.searchEmoji')"
          @keydown="onEmojiSearchKeydown"
        />
        <button class="emoji-back-btn" :title="$t('slash.backToCommands')" @click="mode = 'commands'; updateFilteredItems('')">
          <i class="i-mdi-arrow-left"></i>
        </button>
      </div>
      <div ref="listRef" class="emoji-grid-wrap">
        <template v-if="filteredEmojis.length === 0">
          <div class="slash-empty">{{ $t('slash.noEmoji') }}</div>
        </template>
        <template v-else>
          <!-- 搜索结果分类显示（仅无搜索词时显示分类） -->
          <template v-if="!emojiQuery">
            <div
              v-for="cat in emojiCategories"
              :key="cat.label"
              class="emoji-category"
            >
              <div class="emoji-category-label">{{ cat.label }}</div>
              <div class="emoji-grid">
                <button
                  v-for="emoji in cat.items"
                  :key="emoji.emoji"
                  class="emoji-item"
                  :class="{ 'is-selected': false }"
                  :title="emoji.name"
                  @click="selectEmoji(emoji)"
                >
                  {{ emoji.emoji }}
                </button>
              </div>
            </div>
          </template>
          <!-- 搜索模式 -->
          <template v-else>
            <div class="emoji-grid">
              <button
                v-for="(emoji, i) in pagedEmojis"
                :key="emoji.emoji"
                class="emoji-item"
                :class="{ 'is-selected': i === selectedIndex }"
                :title="emoji.name"
                @click="selectEmoji(emoji)"
                @mouseenter="selectedIndex = i"
              >
                {{ emoji.emoji }}
              </button>
            </div>
            <div v-if="hasMoreEmojis" class="emoji-more">
              {{ $t('slash.continueTyping') }}
            </div>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.slash-command-popup {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.link-picker {
  width: 288px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.link-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 2px 10px;
}

.link-picker-title {
  font-size: 12px;
  color: var(--color-text-secondary);
}

/* 选择器自带的边框/阴影在弹出框里是双层的，这里抹掉 */
.link-picker :deep(.note-picker) {
  width: 100%;
  max-height: min(300px, 60vh);
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.slash-command-list {
  padding: 6px;
  min-width: 230px;
  max-height: 320px;
  overflow-y: auto;
}

.slash-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text);
  text-align: left;
  transition: background 0.1s;
}

.slash-item:hover,
.slash-item.is-selected {
  background: var(--color-surface);
}

.slash-icon {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface);
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.slash-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 命令关键词：右侧灰字提示，告诉用户可以直接敲 /keyword */
.slash-keyword {
  flex-shrink: 0;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  color: var(--color-text-secondary);
  opacity: 0.7;
  letter-spacing: 0.2px;
}

.slash-item.is-selected .slash-keyword,
.slash-item:hover .slash-keyword {
  opacity: 1;
}

.slash-empty {
  padding: 16px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 13px;
}

/* Emoji picker */
.emoji-picker {
  width: 340px;
}

.emoji-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--color-border);
}

.emoji-search {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
  outline: none;
}

.emoji-search:focus {
  border-color: var(--color-primary);
}

.emoji-search::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.emoji-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  transition: background 0.1s;
  flex-shrink: 0;
}

.emoji-back-btn:hover {
  background: var(--color-surface);
}

.emoji-back-btn i {
  font-size: 18px;
}

.emoji-grid-wrap {
  max-height: 300px;
  overflow-y: auto;
  padding: 6px;
}

.emoji-category {
  margin-bottom: 4px;
}

.emoji-category-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  padding: 6px 4px 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
}

.emoji-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  transition: all 0.1s;
}

.emoji-item:hover {
  background: var(--color-surface);
  transform: scale(1.15);
}

.emoji-item.is-selected {
  background: var(--color-surface);
  border-color: var(--color-primary);
}

.emoji-more {
  padding: 10px;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-secondary);
  opacity: 0.6;
}

</style>
