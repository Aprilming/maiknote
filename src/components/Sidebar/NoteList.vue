<script setup lang="ts">
import { useNoteStore } from '@/stores/noteStore'
import { useDesktopNotes } from '@/composables/useDesktopNotes'
import { useI18n } from 'vue-i18n'

const noteStore = useNoteStore()
const desktopNotes = useDesktopNotes()
const { t } = useI18n()

async function createNewNote() {
  await noteStore.createNote()
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return t('notelist.justNow')
  if (diffMins < 60) return t('notelist.minutesAgo', { n: diffMins })
  if (diffHours < 24) return t('notelist.hoursAgo', { n: diffHours })
  if (diffDays < 7) return t('notelist.daysAgo', { n: diffDays })

  return date.toLocaleDateString()
}

function extractPreview(content: string): string {
  const lines = content.trim().split('\n')
  const firstLine = lines[0] || ''
  const maxLength = 50
  return firstLine.length > maxLength ? firstLine.substring(0, maxLength) + '...' : firstLine
}
</script>

<template>
  <div class="note-list">
    <!-- Pinned Notes Section -->
    <div v-if="noteStore.pinnedNotes.length > 0" class="note-section">
      <div class="section-title">{{ $t('notelist.pinned') }}</div>
      <TransitionGroup name="note-item" tag="div" class="note-group">
        <div
          v-for="note in noteStore.pinnedNotes"
          :key="note.id"
          class="note-item pinned"
          :class="{
            active: note.id === noteStore.currentNoteId,
            'note-item-deleting': note.id === noteStore.deletingNoteId
          }"
          @click="noteStore.selectNote(note.id)"
        >
          <div class="note-content">
            <div class="note-title">{{ note.title || $t('notelist.untitled') }}</div>
            <div class="note-preview">{{ extractPreview(note.content) }}</div>
          </div>
          <div class="note-meta">
            <button
              v-if="desktopNotes.isOnDesktop(note.id)"
              class="note-desktop active"
              :title="$t('titlebar.desktopNoteOn')"
              @click.stop="desktopNotes.toggle(note.id)"
            >
              <i class="i-mdi-pin"></i>
            </button>
            <span class="note-time">{{ formatTimestamp(note.updatedAt) }}</span>
          </div>
        </div>
      </TransitionGroup>
    </div>

    <!-- Unpinned Notes Section -->
    <div v-if="noteStore.unpinnedNotes.length > 0" class="note-section">
      <div v-if="noteStore.pinnedNotes.length > 0" class="section-title">{{ $t('notelist.notes') }}</div>
      <TransitionGroup name="note-item" tag="div" class="note-group">
        <div
          v-for="note in noteStore.unpinnedNotes"
          :key="note.id"
          class="note-item"
          :class="{
            active: note.id === noteStore.currentNoteId,
            'note-item-deleting': note.id === noteStore.deletingNoteId
          }"
          @click="noteStore.selectNote(note.id)"
        >
          <div class="note-content">
            <div class="note-title">{{ note.title || $t('notelist.untitled') }}</div>
            <div class="note-preview">{{ extractPreview(note.content) }}</div>
          </div>
          <div class="note-meta">
            <button
              v-if="desktopNotes.isOnDesktop(note.id)"
              class="note-desktop active"
              :title="$t('titlebar.desktopNoteOn')"
              @click.stop="desktopNotes.toggle(note.id)"
            >
              <i class="i-mdi-pin"></i>
            </button>
            <span class="note-time">{{ formatTimestamp(note.updatedAt) }}</span>
          </div>
        </div>
      </TransitionGroup>
    </div>

    <!-- Empty State -->
    <div v-if="noteStore.filteredNotes.length === 0" class="empty-state">
      <i class="i-mdi-file-document-outline empty-icon"></i>
      <p class="empty-text">{{ $t('notelist.empty') }}</p>
      <button class="empty-action" @click="createNewNote">
        {{ $t('notelist.createFirst') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.note-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
}

.note-section {
  margin-bottom: 16px;
}

.section-title {
  padding: 12px 0 8px;
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-secondary);
}

.note-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  margin-bottom: 2px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}

.note-item:hover {
  background-color: color-mix(in srgb, var(--color-text-secondary) 8%, transparent);
}

.note-item:active {
  transform: scale(0.985);
}

.note-item.active {
  background-color: var(--color-primary);
}

.note-item.active .note-title,
.note-item.active .note-preview,
.note-item.active .note-time {
  color: white;
}

.note-content {
  flex: 1;
  min-width: 0;
}

.note-title {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-preview {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-meta {
  flex-shrink: 0;
  margin-left: 8px;
}

.note-time {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.note-desktop {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-right: 4px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  opacity: 1;
  transition: opacity 0.14s ease, background-color 0.14s ease, color 0.14s ease;
}

.note-desktop:hover {
  background: var(--color-popup-hover);
  color: var(--color-text);
}

/* 已经在桌面上的，一直亮着，别让用户找不到它在哪 */
.note-desktop.active {
  opacity: 1;
  color: var(--color-primary);
}

.note-item.pinned {
  position: relative;
}

.note-item.pinned::before {
  content: '';
  position: absolute;
  left: 4px;
  width: 3px;
  height: 20px;
  background-color: var(--color-primary);
  border-radius: 2px;
  top: 50%;
  transform: translateY(-50%);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  color: var(--color-text-secondary);
  margin-bottom: 16px;
}

.empty-text {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: 16px;
}

.empty-action {
  padding: 8px 16px;
  font-size: var(--font-size-sm);
  border: none;
  border-radius: var(--radius-md);
  background-color: var(--color-primary);
  color: white;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}

.empty-action:hover {
  background-color: var(--color-primary-hover);
}

.empty-action:active {
  transform: scale(0.97);
}

/* --- 笔记列表动画 --- */

.note-group {
  position: relative;
}

/* 笔记项移出动画：向左滑出 + 折叠 + 淡出 */
.note-item-leave-active {
  transition: all 0.6s cubic-bezier(0.55, 0.0, 0.7, 0.1);
  position: relative;
}

.note-item-leave-to {
  opacity: 0;
  transform: translateX(-30px) scale(0.9);
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  margin-bottom: 0;
  overflow: hidden;
}

/* 笔记项移入动画 */
.note-item-enter-active {
  transition: all 0.3s var(--ease-out);
}

.note-item-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

/* 正在被删除的笔记项：抖动 + 高亮边框 */
.note-item-deleting {
  animation: note-delete-pulse 0.4s ease-in-out;
  position: relative;
  overflow: hidden;
}

.note-item-deleting::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 80, 80, 0.2), transparent);
  animation: note-delete-sweep 0.5s ease-in-out forwards;
  pointer-events: none;
  border-radius: inherit;
}

@keyframes note-delete-pulse {
  0% { transform: scale(1); }
  25% { transform: scale(1.02); }
  50% { transform: scale(0.98); }
  75% { transform: scale(1.01); }
  100% { transform: scale(1); }
}

@keyframes note-delete-sweep {
  0% { transform: translateX(-100%); opacity: 0; }
  30% { opacity: 1; }
  100% { transform: translateX(100%); opacity: 0; }
}
</style>
