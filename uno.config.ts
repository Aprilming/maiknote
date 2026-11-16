import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetUno,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'

export default defineConfig({
  // 图标类名写在 .ts 的模板字符串里，扫描器看不见，必须显式安全列出
  safelist: ['i-mdi-content-copy', 'i-mdi-check'],
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      warn: true,
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle',
      },
    }),
  ],
  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
  ],
  theme: {
    colors: {
      primary: 'var(--color-primary)',
      background: 'var(--color-background)',
      surface: 'var(--color-surface)',
      text: 'var(--color-text)',
      border: 'var(--color-border)',
    },
  },
})
