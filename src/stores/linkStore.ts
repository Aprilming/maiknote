import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useNoteStore } from './noteStore'
import { buildBacklinkIndex, findNoteByTitle, listLinkableNotes, type BacklinkEntry } from '@/composables/useNoteLinks'

/**
 * 双向链接索引：谁引用了我（反向链接），以及选中器要用的候选笔记。
 * noteStore 里内容是原地改的（Object.assign），不会触发 notes 数组的依赖，
 * 所以这里用 revision 显式失效，编辑时隔一小会儿重建一次。
 */
export const useLinkStore = defineStore('links', () => {
  const noteStore = useNoteStore()

  const revision = ref(0)
  let timer: ReturnType<typeof setTimeout> | null = null

  const index = computed(() => {
    void revision.value
    return buildBacklinkIndex(noteStore.notes)
  })

  function backlinksOf(noteId?: string | null): BacklinkEntry[] {
    if (!noteId) return []
    return index.value.get(noteId) ?? []
  }

  function resolve(title: string) {
    return findNoteByTitle(noteStore.notes, title)
  }

  function linkableNotes(excludeId?: string | null) {
    return listLinkableNotes(noteStore.notes, excludeId)
  }

  function refreshNow() {
    revision.value += 1
  }

  function refreshSoon(delay = 600) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      refreshNow()
    }, delay)
  }

  return {
    index,
    revision,
    backlinksOf,
    resolve,
    linkableNotes,
    refreshNow,
    refreshSoon,
  }
})
