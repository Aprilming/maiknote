<script setup lang="ts">
import { useNoteStore } from '@/stores/noteStore'
import SearchBar from './SearchBar.vue'
import NoteList from './NoteList.vue'

const noteStore = useNoteStore()

async function createNewNote() {
  await noteStore.createNote()
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <h1 class="app-title">MaikNote</h1>
      <button class="new-note-btn" @click="createNewNote" :title="$t('sidebar.newNote')">
        <i class="i-mdi-plus"></i>
      </button>
    </div>

    <SearchBar />

    <NoteList />
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: 240px;
  min-width: 240px;
  max-width: 240px;
  height: 100%;
  background-color: var(--color-surface);
  border-right: 1px solid var(--color-border);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
}

.app-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
}

.new-note-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-md);
  background-color: var(--color-primary);
  color: white;
  cursor: pointer;
  transition: background-color 0.15s;
}

.new-note-btn:hover {
  background-color: var(--color-primary-hover);
}

.new-note-btn i {
  font-size: 18px;
}
</style>
