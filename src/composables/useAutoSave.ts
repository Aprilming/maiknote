import { ref, watch, onUnmounted } from 'vue'
import { useDebounceFn } from '@vueuse/core'

export function useAutoSave(
  noteId: () => string | null,
  content: () => string,
  saveFn: (id: string, content: string) => Promise<void>,
  delay = 500
) {
  const isSaving = ref(false)
  const saveError = ref<Error | null>( null)
  let lastSavedContent = ''

  const debouncedSave = useDebounceFn(async () => {
    const id = noteId()
    const currentContent = content()

    // 内容清空（''）也要走一次保存，否则空笔记永远不落盘
    if (!id) return
    if (currentContent === lastSavedContent) return

    isSaving.value = true
    saveError.value = null

    try {
      await saveFn(id, currentContent)
      lastSavedContent = currentContent
    } catch (e) {
      saveError.value = e as Error
      console.error('Auto-save failed:', e)
    } finally {
      isSaving.value = false
    }
  }, delay)

  // Watch content changes
  watch(content, debouncedSave)

  // Force save immediately
  async function forceSave() {
    await debouncedSave()
  }

  // Cleanup
  onUnmounted(() => {
    // Save on unmount
    forceSave()
  })

  return {
    isSaving,
    saveError,
    forceSave,
  }
}
