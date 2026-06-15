import { watch } from 'vue'
import { useSettingStore } from '@/stores/settingStore'
import { useTheme } from '@/composables/useTheme'
import { editorStylePresets, type PresetColors } from '@/composables/editorStylePresets'

const CSS_VAR_MAP: Record<string, string> = {
  codeBg: '--editor-code-bg',
  codeBorder: '--editor-code-border',
  codeText: '--editor-code-text',
  inlineCodeBg: '--editor-inline-code-bg',
  inlineCodeText: '--editor-inline-code-text',
  blockquoteBg: '--editor-blockquote-bg',
  blockquoteBorder: '--editor-blockquote-border',
  blockquoteText: '--editor-blockquote-text',
}

function applyColors(colors: PresetColors) {
  const root = document.documentElement
  for (const [key, varName] of Object.entries(CSS_VAR_MAP)) {
    root.style.setProperty(varName, colors[key as keyof PresetColors])
  }
}

export function useEditorStyle() {
  const settingStore = useSettingStore()
  const { currentTheme } = useTheme()

  function applyCurrentPreset() {
    const presetName = settingStore.settings.editorStylePreset
    const theme = currentTheme.value

    if (presetName === 'custom') {
      applyColors(settingStore.settings.customEditorStyle[theme])
    } else {
      const preset = editorStylePresets[presetName]
      if (preset) {
        applyColors(preset[theme])
      }
    }
  }

  watch(
    () => settingStore.settings.editorStylePreset,
    () => applyCurrentPreset(),
    { immediate: true },
  )

  watch(currentTheme, () => applyCurrentPreset())

  // 自定义颜色变更时也需即时生效
  watch(
    () => settingStore.settings.customEditorStyle,
    () => {
      if (settingStore.settings.editorStylePreset === 'custom') {
        applyCurrentPreset()
      }
    },
    { deep: true },
  )
}
