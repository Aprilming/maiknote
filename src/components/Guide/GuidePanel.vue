<script setup lang="ts">
/**
 * 内置使用教程：内容来自 TUTORIAL.md（scripts/build-guide.mjs 生成 guideContent.generated.ts）。
 * 第一次启动自动弹一次（settings.guideSeen），设置 → 关于 → 使用教程 可随时重看。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { openUrl } from '@tauri-apps/plugin-opener'
import { guideHtml, guideToc } from './guideContent.generated'

/**
 * firstRun：第一次启动自动弹出的那一次。这时不做模态——
 * 遮罩全透明、不挡点击，主界面照样能用，用户边看教程边试。
 */
const props = defineProps<{ firstRun?: boolean }>()

const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const panelRef = ref<HTMLElement | null>(null)
const articleRef = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)
const activeId = ref(guideToc[0]?.id ?? '')

let scroller: HTMLElement | null = null
let onScroll: (() => void) | null = null

function close() {
  emit('close')
}

function jumpTo(id: string) {
  const el = articleRef.value?.querySelector<HTMLElement>('#' + id)
  if (!el || !articleRef.value) return
  articleRef.value.scrollTop += el.getBoundingClientRect().top - articleRef.value.getBoundingClientRect().top - 8
  activeId.value = id
}

/** 滚动时高亮左侧目录对应的小节 */
function trackScroll() {
  if (!scroller) return
  const top = scroller.getBoundingClientRect().top
  let current = guideToc[0]?.id ?? ''
  for (const item of guideToc) {
    const el = scroller.querySelector<HTMLElement>('#' + item.id)
    if (el && el.getBoundingClientRect().top - top <= 20) current = item.id
  }
  activeId.value = current
}

/** 正文里的链接：外链走系统浏览器，页内锚点自己跳（webview 里 target=_blank 不靠谱） */
async function onArticleClick(e: MouseEvent) {
  const anchor = (e.target as HTMLElement | null)?.closest('a')
  if (!anchor) return
  const href = anchor.getAttribute('href') ?? ''
  if (/^https?:/i.test(href)) {
    e.preventDefault()
    await openUrl(href)
  } else if (href.startsWith('#')) {
    e.preventDefault()
    jumpTo(href.slice(1))
  }
}

function onKeydown(e: KeyboardEvent) {
  // 盖在整个应用之上时，别让全局快捷键穿透
  e.stopPropagation()
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

onMounted(async () => {
  await nextTick()
  closeBtn.value?.focus()
  scroller = articleRef.value
  if (scroller) {
    onScroll = trackScroll
    scroller.addEventListener('scroll', onScroll, { passive: true })
    trackScroll()
  }
})

onBeforeUnmount(() => {
  if (scroller && onScroll) scroller.removeEventListener('scroll', onScroll)
  scroller = null
  onScroll = null
})
</script>

<template>
  <div class="guide-mask" :class="{ 'is-first-run': props.firstRun }" @keydown="onKeydown">
    <div
      ref="panelRef"
      class="guide-panel"
      role="dialog"
      :aria-modal="props.firstRun ? 'false' : 'true'"
      aria-labelledby="guide-title"
    >
      <header class="guide-head">
        <div class="guide-badge">
          <i class="i-mdi-book-open-variant"></i>
        </div>
        <div class="guide-titles">
          <h1 id="guide-title">{{ t('settings.userGuide') }}</h1>
          <p>{{ props.firstRun ? t('guide.firstRun') : t('guide.hint') }}</p>
        </div>
        <button ref="closeBtn" class="guide-close" type="button" :title="t('guide.close')" @click="close">
          <i class="i-mdi-close"></i>
        </button>
      </header>

      <div class="guide-body">
        <aside class="guide-toc">
          <nav>
            <button
              v-for="item in guideToc"
              :key="item.id"
              type="button"
              class="guide-toc-item"
              :class="{ 'is-active': activeId === item.id }"
              @click="jumpTo(item.id)"
            >
              {{ item.text }}
            </button>
          </nav>
        </aside>

        <article ref="articleRef" class="guide-doc" @click="onArticleClick">
          <div v-html="guideHtml"></div>
        </article>
      </div>

      <footer class="guide-foot">
        <p class="guide-tip">{{ t('guide.foot') }}</p>
        <button class="guide-ok" type="button" @click="close">{{ t('guide.close') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.guide-mask {
  position: fixed;
  inset: 0;
  z-index: 630;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(6px);
  animation: guide-in 0.2s ease;
}

/* 首次启动：教程只负责「在旁边指」，不抢主界面 */
.guide-mask.is-first-run {
  background: transparent;
  backdrop-filter: none;
  pointer-events: none;
}

.guide-mask.is-first-run .guide-panel {
  pointer-events: auto;
}

.guide-panel {
  display: flex;
  flex-direction: column;
  width: 880px;
  max-width: 100%;
  height: 86vh;
  max-height: 760px;
  border-radius: 16px;
  background: var(--color-popup-bg, var(--color-surface));
  border: 1px solid var(--color-border);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.guide-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px 14px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.guide-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: rgba(0, 122, 255, 0.12);
  color: var(--color-primary, #007aff);
  flex-shrink: 0;
}

.guide-badge i {
  font-size: 19px;
}

.guide-titles {
  flex: 1;
  min-width: 0;
}

.guide-titles h1 {
  margin: 0;
  font-size: 15.5px;
  font-weight: 600;
  color: var(--color-text);
}

.guide-titles p {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--color-text-secondary, var(--color-text));
}

.guide-close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-secondary, var(--color-text));
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.guide-close:hover {
  background: rgba(127, 127, 127, 0.16);
  color: var(--color-text);
}

.guide-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 186px minmax(0, 1fr);
}

.guide-toc {
  overflow-y: auto;
  padding: 10px 8px 10px 12px;
  border-right: 1px solid var(--color-border);
}

.guide-toc nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.guide-toc-item {
  display: block;
  width: 100%;
  padding: 6px 9px;
  border: none;
  border-left: 2px solid transparent;
  border-radius: 0 7px 7px 0;
  background: transparent;
  color: var(--color-text-secondary, var(--color-text));
  font-size: 12px;
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.guide-toc-item:hover {
  background: rgba(127, 127, 127, 0.1);
  color: var(--color-text);
}

.guide-toc-item.is-active {
  border-left-color: var(--color-primary, #007aff);
  background: rgba(0, 122, 255, 0.1);
  color: var(--color-text);
}

.guide-doc {
  overflow-y: auto;
  padding: 4px 22px 28px;
  scroll-behavior: smooth;
}

.guide-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 18px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.guide-tip {
  flex: 1;
  margin: 0;
  font-size: 11.5px;
  color: var(--color-text-secondary, var(--color-text));
}

.guide-ok {
  flex-shrink: 0;
  padding: 7px 18px;
  border: none;
  border-radius: 9px;
  background: var(--color-primary, #007aff);
  color: #fff;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: filter 0.15s ease;
}

.guide-ok:hover {
  filter: brightness(1.06);
}

/* ---- 渲染出来的 Markdown ---- */
.guide-doc :deep(h1) {
  font-size: 20px;
  font-weight: 600;
  margin: 14px 0 8px;
  color: var(--color-text);
}

.guide-doc :deep(h2) {
  font-size: 15.5px;
  font-weight: 600;
  margin: 26px 0 8px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
  color: var(--color-text);
  scroll-margin-top: 8px;
}

.guide-doc :deep(h3) {
  font-size: 13.5px;
  font-weight: 600;
  margin: 16px 0 6px;
  color: var(--color-text);
}

.guide-doc :deep(p),
.guide-doc :deep(li) {
  font-size: 12.8px;
  line-height: 1.72;
  color: var(--color-text-secondary, var(--color-text));
  margin: 7px 0;
}

.guide-doc :deep(strong) {
  color: var(--color-text);
  font-weight: 600;
}

.guide-doc :deep(ul),
.guide-doc :deep(ol) {
  margin: 7px 0;
  padding-left: 20px;
}

.guide-doc :deep(li) {
  margin: 3px 0;
}

.guide-doc :deep(a) {
  color: var(--color-primary, #007aff);
  text-decoration: none;
}

.guide-doc :deep(a:hover) {
  text-decoration: underline;
}

.guide-doc :deep(code) {
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(127, 127, 127, 0.16);
  font-family: var(--font-mono, 'SF Mono', ui-monospace, Menlo, monospace);
  font-size: 0.92em;
  white-space: nowrap;
  color: var(--color-text);
}

.guide-doc :deep(pre) {
  margin: 10px 0;
  padding: 11px 13px;
  border-radius: 10px;
  background: rgba(127, 127, 127, 0.12);
  overflow-x: auto;
}

.guide-doc :deep(pre code) {
  background: none;
  padding: 0;
  white-space: pre;
  font-size: 0.9em;
}

.guide-doc :deep(blockquote) {
  margin: 10px 0;
  padding: 9px 13px;
  border-left: 3px solid var(--color-primary, #007aff);
  border-radius: 0 9px 9px 0;
  background: rgba(127, 127, 127, 0.09);
}

.guide-doc :deep(blockquote p) {
  margin: 3px 0;
}

.guide-doc :deep(.doc-table) {
  overflow-x: auto;
  margin: 10px 0;
}

.guide-doc :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.4px;
}

.guide-doc :deep(th),
.guide-doc :deep(td) {
  padding: 6px 9px;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  color: var(--color-text-secondary, var(--color-text));
}

.guide-doc :deep(th) {
  color: var(--color-text);
  font-weight: 600;
  white-space: nowrap;
}

.guide-doc :deep(hr) {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 18px 0;
}

@keyframes guide-in {
  from {
    opacity: 0;
    transform: scale(0.99);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 720px) {
  .guide-body {
    grid-template-columns: 1fr;
  }
  .guide-toc {
    display: none;
  }
}
</style>
