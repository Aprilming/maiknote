<script setup lang="ts">
import { useNoteStore } from '@/stores/noteStore'

const noteStore = useNoteStore()
</script>

<template>
  <div class="search-bar">
    <div class="search-input-wrapper">
      <i class="i-mdi-magnify search-icon"></i>
      <input
        v-model="noteStore.searchQuery"
        type="text"
        :placeholder="$t('sidebar.searchPlaceholder')"
        class="search-input"
        data-search-input
      />
      <button
        v-if="noteStore.searchQuery"
        class="clear-btn"
        @click="noteStore.searchQuery = ''"
        :title="$t('sidebar.clear')"
      >
        <i class="i-mdi-close"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.search-bar {
  padding: 0 16px 16px;
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 12px;
  color: var(--color-text-secondary);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 8px 36px;
  padding-left: 36px;
  font-size: var(--font-size-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-background);
  color: var(--color-text);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.search-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.search-input::placeholder {
  color: var(--color-text-secondary);
}

.clear-btn {
  position: absolute;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background-color 0.15s;
}

.clear-btn:hover {
  background-color: var(--color-border);
}

.clear-btn i {
  font-size: 14px;
}
</style>
