<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useNoteStore } from '@/stores/noteStore'
import { useDirectoryStore } from '@/stores/directoryStore'
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const noteStore = useNoteStore()
const directoryStore = useDirectoryStore()
const { t, locale } = useI18n()

const searchInput = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLDivElement | null>(null)
const localQuery = ref('')
const activeIndex = ref(0)

const isSearching = computed(() => localQuery.value.trim().length > 0)

/** 只有一个范围：全部未删除的笔记，按修改时间倒序 */
const searchResults = computed(() => {
  const q = localQuery.value.trim().toLowerCase()
  let results = noteStore.activeNotes

  // 空查询时列表不渲染，这里不必计算
  if (q) {
    results = results.filter(n => searchableText(n).includes(q))
  }

  return [...results].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100)
})

const emptyText = computed(() =>
  isSearching.value ? t('search.noMatch') : t('search.emptyNotes')
)

// ---- 工具函数 ----

function formatDate(ts: number): string {
  const d = new Date(ts)
  const diff = Date.now() - ts
  const day = 86400000
  if (diff < day) return t('search.today')
  if (diff < 2 * day) return t('search.yesterday')
  if (diff < 7 * day) return t('search.daysAgo', { n: Math.floor(diff / day) })
  return d.toLocaleDateString(locale.value === 'en-US' ? 'en-US' : 'zh-CN', {
    month: 'short',
    day: 'numeric'
  })
}

/** 去掉语法噪音，只留可读文字；预览与搜索共用同一份口径 */
function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // 代码块
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片语法
    .replace(/!\{[^}]*\}\S*/g, ' ') // !{asset://...} 本地资源
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只留文字
    .replace(/https?:\/\/\S+/g, ' ') // 裸 URL
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ') // HTML 标签
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)])\s+/gm, ' ') // 标题/列表前缀
    .replace(/[#*`_~|>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 搜索用文本：标题 + 正文，带缓存（note 内容变化时按 updatedAt 失效） */
const searchTextCache = new Map<string, string>()

function searchableText(note: { id: string; title: string; content: string; updatedAt: number }): string {
  const key = `${note.id}@${note.updatedAt}`
  const cached = searchTextCache.get(key)
  if (cached !== undefined) return cached

  if (searchTextCache.size > 400) searchTextCache.clear()
  const value = `${note.title} ${plainText(note.content)}`.toLowerCase()
  searchTextCache.set(key, value)
  return value
}

function getPreview(s: string): string {
  return plainText(s).substring(0, 120)
}

/** 正文开头就是标题时不再重复展示预览 */
function isSameAsTitle(note: { title: string; content: string }): boolean {
  const title = note.title.trim()
  const body = getPreview(note.content)
  return !body || body === title
}

function dirNameOf(note: { directoryId?: string | null }): string {
  if (!note.directoryId) return t('dirTree.rootDir')
  return directoryStore.getDirectory(note.directoryId)?.name ?? t('dirTree.rootDir')
}

function highlightKeyword(text: string, kw: string): string {
  if (!kw) return text
  return text.replace(
    new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
    '<mark>$1</mark>'
  )
}

// ---- 交互 ----

function scrollActiveIntoView() {
  nextTick(() => {
    const el = listRef.value?.querySelector(`[data-idx="${activeIndex.value}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function moveActive(delta: number) {
  if (searchResults.value.length === 0) return
  const next = activeIndex.value + delta
  activeIndex.value = Math.min(searchResults.value.length - 1, Math.max(0, next))
  scrollActiveIntoView()
}

function openNote(noteId: string) {
  const note = noteStore.notes.find(n => n.id === noteId)
  // 同步目录过滤，使主编辑器只显示该目录下的笔记
  noteStore.setFilterDirectory(note?.directoryId ?? null)
  noteStore.selectNote(noteId)
  emit('close')
}

function handleSelect(noteId: string) {
  openNote(noteId)
}

function handleCancel() {
  localQuery.value = ''
  emit('close')
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    handleCancel()
    return
  }
  if (!isSearching.value) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    moveActive(1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    moveActive(-1)
    return
  }
  if (e.key === 'Enter') {
    const target = searchResults.value[activeIndex.value]
    if (target) {
      e.preventDefault()
      openNote(target.id)
    }
  }
}

watch(searchResults, () => {
  activeIndex.value = 0
})

onMounted(() => {
  searchInput.value?.focus()
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="search-page" :class="{ 'is-idle': !isSearching }">
    <div class="search-wrap">
      <!-- 搜索框 -->
      <div class="search-bar" :class="{ 'is-active': isSearching }">
        <i class="i-mdi-magnify search-icon"></i>
        <input
          ref="searchInput"
          v-model="localQuery"
          type="text"
          :placeholder="$t('search.searchAll')"
          class="search-input"
        />
        <button v-if="localQuery" class="clear-btn" :title="$t('search.cancel')" @click="localQuery = ''">
          <i class="i-mdi-close"></i>
        </button>
        <span v-else class="esc-hint">esc</span>
      </div>

      <!-- 结果列表：只在有查询时出现 -->
      <div v-if="isSearching" ref="listRef" class="result-list">
        <div v-if="searchResults.length === 0" class="empty-state">
          <i class="i-mdi-text-box-search-outline"></i>
          <p>{{ emptyText }}</p>
        </div>

        <div
          v-for="(note, index) in searchResults"
          :key="note.id"
          :data-idx="index"
          class="result-item"
          :class="{ 'is-active': index === activeIndex }"
          @mouseenter="activeIndex = index"
          @click="handleSelect(note.id)"
        >
          <div class="result-title" v-html="highlightKeyword(note.title || $t('search.untitled'), localQuery)"></div>
          <div
            v-if="!isSameAsTitle(note)"
            class="result-preview"
            v-html="highlightKeyword(getPreview(note.content), localQuery)"
          ></div>

          <div class="result-meta">
            <span class="meta-dir">
              <i class="i-mdi-folder-outline"></i>
              {{ dirNameOf(note) }}
            </span>
            <i v-if="note.isLocked" class="i-mdi-lock-outline meta-lock"></i>
            <span class="meta-dot">·</span>
            <span class="meta-date">{{ formatDate(note.updatedAt) }}</span>
          </div>
        </div>
      </div>

      <!-- 底部提示：只在有查询时出现 -->
      <div v-if="isSearching" class="search-footer">
        <span class="hint"><kbd>↑</kbd><kbd>↓</kbd> {{ $t('search.hintMove') }}</span>
        <span class="hint"><kbd>↵</kbd> {{ $t('search.hintOpen') }}</span>
        <span class="hint"><kbd>esc</kbd> {{ $t('search.hintClose') }}</span>
        <span v-if="searchResults.length" class="result-count">{{ $t('search.noteCount', { count: searchResults.length }) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ============================================
   全局搜索页 · 磨砂玻璃皮肤
   口径：整页透明露出原生 vibrancy，中间一块半透明玻璃面板；
   面板内部按「下沉槽位 / 悬停白雾」两级语言处理，不再用实色卡片。
   ============================================ */
.search-page {
  /* ---- 玻璃令牌（浅色） ---- */
  --sp-mesh:
    radial-gradient(70% 60% at 8% -8%, rgba(120, 160, 255, 0.34) 0%, transparent 72%),
    radial-gradient(65% 60% at 92% 2%, rgba(204, 148, 242, 0.28) 0%, transparent 70%),
    radial-gradient(85% 70% at 50% 112%, rgba(104, 204, 176, 0.3) 0%, transparent 70%),
    linear-gradient(160deg, rgba(230, 237, 251, 0.94) 0%, rgba(243, 233, 247, 0.92) 100%);
  --sp-panel-strong: rgba(255, 255, 255, 0.72);
  --sp-border: rgba(255, 255, 255, 0.7);
  --sp-line: rgba(0, 0, 0, 0.07);
  --sp-sunken: rgba(120, 120, 128, 0.11);
  --sp-row-hover: rgba(255, 255, 255, 0.46);
  --sp-mark: rgba(255, 214, 10, 0.42);
  --sp-blur: blur(30px) saturate(180%);

  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  justify-content: center;
  padding: 0;
  overflow: hidden;
  /* 页底铺一层低饱和柔光雾（半透，原生 vibrancy 仍能透上来），
     卡片 blur 的才是「有内容可模糊」的背景，而不是一片白 */
  background: var(--sp-mesh);
  animation: fade-in var(--duration-normal) var(--ease-out);
}

/* 细密的霜面颗粒：白底上也能看出「磨砂」而不是纯色块 */
.search-page::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.22;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.32'/%3E%3C/svg%3E");
  mix-blend-mode: multiply;
}

:global([data-theme='dark'] .search-page) {
  --sp-mesh:
    radial-gradient(70% 60% at 10% -5%, rgba(58, 104, 220, 0.3) 0%, transparent 72%),
    radial-gradient(65% 60% at 90% 5%, rgba(146, 84, 206, 0.22) 0%, transparent 70%),
    radial-gradient(80% 65% at 50% 110%, rgba(36, 148, 128, 0.2) 0%, transparent 70%),
    linear-gradient(165deg, rgba(20, 22, 28, 0.92) 0%, rgba(25, 21, 30, 0.9) 100%);
  --sp-panel-strong: rgba(255, 255, 255, 0.15);
  --sp-border: rgba(255, 255, 255, 0.16);
  --sp-line: rgba(255, 255, 255, 0.1);
  --sp-sunken: rgba(0, 0, 0, 0.16);
  --sp-row-hover: rgba(255, 255, 255, 0.1);
  --sp-mark: rgba(255, 214, 10, 0.28);
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* ---- 内容列（整页就是一块玻璃，不再往里套卡片） ---- */
.search-wrap {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 880px;
  /* 顶部留出悬浮标题栏（40px + 8px 边距）的位置，避免搜索框被压住 */
  padding: 50px 18px 10px;
  transition: padding var(--duration-normal) var(--ease-out);
  box-sizing: border-box;
  overflow: hidden;
}

/* ---- 搜索框（下沉槽位） ---- */
.search-bar {
  position: relative;
  display: flex;
  align-items: center;
  height: 46px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--sp-border);
  background: linear-gradient(165deg, var(--sp-panel-strong) 0%, color-mix(in srgb, var(--sp-panel-strong) 78%, transparent) 100%);
  -webkit-backdrop-filter: var(--sp-blur);
  backdrop-filter: var(--sp-blur);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 6px 18px rgba(0, 0, 0, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  transition: background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.search-bar:focus-within {
  background: var(--sp-panel-strong);
  border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 15%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.search-icon {
  flex-shrink: 0;
  font-size: 20px;
  color: var(--color-text-secondary);
  margin-right: 10px;
}

.search-input {
  flex: 1;
  height: 100%;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 16px;
  font-family: var(--font-sans);
  color: var(--color-text);
  letter-spacing: -0.01em;
}

.search-input::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.85;
}

.clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-text-secondary) 20%, transparent);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 14px;
  transition: background var(--duration-fast) var(--ease-out);
}

.clear-btn:hover {
  background: color-mix(in srgb, var(--color-text-secondary) 32%, transparent);
}

.esc-hint {
  flex-shrink: 0;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
  opacity: 0.7;
  border: 1px solid var(--sp-line);
  border-radius: 5px;
  padding: 1px 5px;
  background: var(--sp-panel-strong);
}

.search-page.is-idle .search-wrap {
  justify-content: center;
  padding-top: 0;
  padding-bottom: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 72px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  user-select: none;
}

.empty-state i {
  font-size: 22px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
}

/* ---- 结果列表 ---- */
.result-list {
  flex: 1;
  min-height: 0;
  margin-top: 14px;
  overflow-y: auto;
  padding: 2px 0 10px;
  scroll-padding: 8px 0 10px;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 10px, #000 calc(100% - 26px), transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0, #000 10px, #000 calc(100% - 26px), transparent 100%);
}

.result-item {
  padding: 10px 12px;
  border-bottom: 1px solid var(--sp-line);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.result-item.is-active {
  background: var(--sp-row-hover);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35), 0 1px 3px rgba(0, 0, 0, 0.04);
}

:global([data-theme='dark'] .result-item.is-active) {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
}

.result-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-preview {
  margin-top: 3px;
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--color-text-secondary);
  opacity: 0.85;
  min-height: 18px;
}

.meta-dir {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-dir i,
.meta-lock {
  font-size: 12px;
}

.meta-dot {
  opacity: 0.5;
}

.meta-date {
  flex-shrink: 0;
}

/* ---- 底部提示 ---- */
.search-footer {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 4px 2px;
  border-top: 1px solid var(--sp-line);
  font-size: 11px;
  color: var(--color-text-secondary);
  opacity: 0.8;
  flex-shrink: 0;
}

.hint {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.hint kbd {
  font-family: var(--font-sans);
  font-size: 10px;
  line-height: 1;
  padding: 2px 4px;
  border: 1px solid var(--sp-line);
  border-radius: 3px;
  background: var(--sp-panel-strong);
}

.result-count {
  margin-left: auto;
}

/* 高亮关键词 */
.result-item :deep(mark) {
  background: var(--sp-mark);
  color: inherit;
  padding: 0 1px;
  border-radius: 2px;
}
</style>
