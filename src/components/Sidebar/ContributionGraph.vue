<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNoteStore } from '@/stores/noteStore'

/**
 * 写作足迹：GitHub 那种一年热力图，看哪一天动过笔记。
 * 笔记只有 createdAt / updatedAt 两个时间戳，edited 之后旧日期会被覆盖，
 * 所以这里把「某篇笔记在哪几天被写过」沉淀到 localStorage，历史才不会丢。
 */
const { t } = useI18n()
const noteStore = useNoteStore()

const LEDGER_KEY = 'marknote.writeDaysByNote'
const DAY_MS = 24 * 60 * 60 * 1000
const KEEP_DAYS = 370

type Ledger = Record<string, string[]> // noteId -> ['2026-03-05', ...]

function dayKey(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function loadLedger(): Ledger {
  try {
    const raw = localStorage.getItem(LEDGER_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed as Ledger
    }
  } catch {
    // 本地数据损坏就当没有
  }
  return {}
}

const ledger = ref<Ledger>(loadLedger())

function persistLedger() {
  const cutoff = dayKey(Date.now() - KEEP_DAYS * DAY_MS)
  const next: Ledger = {}
  for (const [noteId, days] of Object.entries(ledger.value)) {
    const kept = days.filter(d => d >= cutoff) // 键是 `YYYY-MM-DD`，可直接按字符串比大小
    if (kept.length) next[noteId] = kept
  }
  ledger.value = next
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(next))
  } catch {
    // 配额满了就不存，图照常按内存里的算
  }
}

function mergeNotesIntoLedger() {
  let dirty = false
  for (const note of noteStore.notes) {
    const seen = new Set(ledger.value[note.id] ?? [])
    const before = seen.size
    if (note.createdAt) seen.add(dayKey(note.createdAt))
    if (note.updatedAt) seen.add(dayKey(note.updatedAt))
    if (seen.size !== before) {
      ledger.value[note.id] = [...seen]
      dirty = true
    }
  }
  if (dirty) persistLedger()
}

// notes 是原地更新的，浅层 watch 抓不到；用 id:updatedAt 拼一个签名，改一次就会变
const notesSignature = computed(() =>
  noteStore.notes.map(n => `${n.id}:${n.updatedAt}`).join('|'),
)

let mergeTimer: ReturnType<typeof setTimeout> | null = null
watch(notesSignature, () => {
  if (mergeTimer) return
  mergeTimer = setTimeout(() => {
    mergeTimer = null
    mergeNotesIntoLedger()
  }, 1200)
}, { immediate: true })

onBeforeUnmount(() => {
  if (mergeTimer) clearTimeout(mergeTimer)
})

const dayCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const days of Object.values(ledger.value)) {
    for (const day of days) counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  return counts
})

function levelOf(count: number): number {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

const cells = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - 364)
  start.setDate(start.getDate() - start.getDay()) // 对齐到周日，列即一周

  const list: { key: string; label: string; count: number; level: number }[] = []
  const cursor = new Date(start)
  while (cursor <= today) {
    const key = dayKey(cursor.getTime())
    const count = dayCounts.value.get(key) ?? 0
    list.push({
      key,
      label: t('activity.dateLabel', { month: cursor.getMonth() + 1, day: cursor.getDate() }),
      count,
      level: levelOf(count),
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return list
})

const activeDays = computed(() => cells.value.filter(c => c.count > 0).length)

function cellTitle(cell: { label: string; count: number }): string {
  return cell.count
    ? t('activity.tooltip', { date: cell.label, count: cell.count })
    : t('activity.emptyTooltip', { date: cell.label })
}
</script>

<template>
  <section class="contribution-graph">
    <div class="cg-head">
      <span class="cg-summary">{{ t('activity.summary', { days: activeDays }) }}</span>
      <span class="cg-legend">
        <span>{{ t('activity.less') }}</span>
        <i class="cg-cell l0"></i>
        <i class="cg-cell l1"></i>
        <i class="cg-cell l2"></i>
        <i class="cg-cell l3"></i>
        <i class="cg-cell l4"></i>
        <span>{{ t('activity.more') }}</span>
      </span>
    </div>
    <div class="cg-grid">
      <span
        v-for="cell in cells"
        :key="cell.key"
        class="cg-cell"
        :class="`l${cell.level}`"
        :title="cellTitle(cell)"
      ></span>
    </div>
  </section>
</template>

<style scoped>
.contribution-graph {
  flex-shrink: 0;
  padding: 8px 8px 6px;
  border-top: 1px solid var(--color-border);
  --cg-empty: color-mix(in srgb, var(--color-text-secondary) 16%, transparent);
  --cg-1: color-mix(in srgb, var(--color-primary) 26%, transparent);
  --cg-2: color-mix(in srgb, var(--color-primary) 48%, transparent);
  --cg-3: color-mix(in srgb, var(--color-primary) 74%, transparent);
  --cg-4: var(--color-primary);
}

.cg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 10px;
  line-height: 1.2;
  color: var(--color-text-secondary);
}

.cg-summary {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cg-legend {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  font-size: 9px;
}

.cg-legend .cg-cell {
  width: 6px;
  height: 6px;
  aspect-ratio: auto;
}

.cg-grid {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  grid-template-rows: repeat(7, auto);
  gap: 1px;
}

.cg-cell {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 1px;
  background-color: var(--cg-empty);
  transition: background-color var(--duration-fast) var(--ease-out);
}

.cg-cell.l1 { background-color: var(--cg-1); }
.cg-cell.l2 { background-color: var(--cg-2); }
.cg-cell.l3 { background-color: var(--cg-3); }
.cg-cell.l4 { background-color: var(--cg-4); }
</style>
