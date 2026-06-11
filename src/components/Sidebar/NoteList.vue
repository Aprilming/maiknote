<script setup lang="ts">
import { useNoteStore } from '@/stores/noteStore'
import { useI18n } from 'vue-i18n'

const noteStore = useNoteStore()
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
      <div
        v-for="note in noteStore.pinnedNotes"
        :key="note.id"
        class="note-item pinned"
        :class="{ active: note.id === noteStore.currentNoteId }"
        @click="noteStore.selectNote(note.id)"
      >
        <div class="note-content">
          <div class="note-title">{{ note.title || $t('notelist.untitled') }}</div>
          <div class="note-preview">{{ extractPreview(note.content) }}</div>
        </div>
        <div class="note-meta">
          <span class="note-time">{{ formatTimestamp(note.updatedAt) }}</span>
        </div>
      </div>
    </div>

    <!-- Unpinned Notes Section -->
    <div v-if="noteStore.unpinnedNotes.length > 0" class="note-section">
      <div v-if="noteStore.pinnedNotes.length > 0" class="section-title">{{ $t('notelist.notes') }}</div>
      <div
        v-for="note in noteStore.unpinnedNotes"
        :key="note.id"
        class="note-item"
        :class="{ active: note.id === noteStore.currentNoteId }"
        @click="noteStore.selectNote(note.id)"
      >
        <div class="note-content">
          <div class="note-title">{{ note.title || $t('notelist.untitled') }}</div>
          <div class="note-preview">{{ extractPreview(note.content) }}</div>
        </div>
        <div class="note-meta">
          <span class="note-time">{{ formatTimestamp(note.updatedAt) }}</span>
        </div>
      </div>
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
  padding: 8px 0;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
}

.note-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  margin-bottom: 4px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color 0.15s;
}

.note-item:hover {
  background-color: var(--color-border);
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

.note-item.pinned {
  position: relative;
}

.note-item.pinned::before {
  content: '';
  position: absolute;
  left: 4px;
  width: 3px;
  height: 24px;
  background-color: var(--color-primary);
  border-radius: 2px;
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
  transition: background-color 0.15s;
}

.empty-action:hover {
  background-color: var(--color-primary-hover);
}
</style>
