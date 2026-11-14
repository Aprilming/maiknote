/**
 * 笔记 Logo 预设。
 * 配色取自设计稿《Markdown 笔记 Logo 方案》，分「标准风格」（圆角方块）
 * 与「MeeGo / N9 风格」（拟物胶囊 + 高光 + 描边）两套。
 */

export type NoteLogoStyle = 'standard' | 'meego'

export interface NoteLogoPreset {
  id: string
  style: NoteLogoStyle
  /** 名称文案 key */
  nameKey: string
  /** 描述文案 key */
  descKey: string
  /** 底色；有 bgTo 时作为渐变起始色 */
  bg: string
  /** 渐变结束色，缺省表示纯色底 */
  bgTo?: string
  /** 主标记 M 的颜色 */
  mark: string
  /** 两侧箭头与圆点的颜色 */
  accent: string
  /** MeeGo 风格外描边色 */
  border?: string
  /** MeeGo 风格顶部高光起始不透明度 */
  gloss?: number
}

/** MeeGo 风格的圆角方（squircle）轮廓，坐标系 0 0 200 200 */
export const MEEGO_SQUIRCLE_PATH =
  'M200.0 100.0 L199.9 122.9 L199.7 132.3 L199.4 139.6 L198.9 145.6 L198.3 150.9 L197.5 155.6 L196.6 159.9 L195.6 163.8 L194.4 167.4 L193.1 170.7 L191.6 173.8 L189.9 176.7 L188.2 179.3 L186.2 181.8 L184.1 184.1 L181.8 186.2 L179.3 188.2 L176.7 189.9 L173.8 191.6 L170.7 193.1 L167.4 194.4 L163.8 195.6 L159.9 196.6 L155.6 197.5 L150.9 198.3 L145.6 198.9 L139.6 199.4 L132.3 199.7 L122.9 199.9 L100.0 200.0 L77.1 199.9 L67.7 199.7 L60.4 199.4 L54.4 198.9 L49.1 198.3 L44.4 197.5 L40.1 196.6 L36.2 195.6 L32.6 194.4 L29.3 193.1 L26.2 191.6 L23.3 189.9 L20.7 188.2 L18.2 186.2 L15.9 184.1 L13.8 181.8 L11.8 179.3 L10.1 176.7 L8.4 173.8 L6.9 170.7 L5.6 167.4 L4.4 163.8 L3.4 159.9 L2.5 155.6 L1.7 150.9 L1.1 145.6 L0.6 139.6 L0.3 132.3 L0.1 122.9 L0.0 100.0 L0.1 77.1 L0.3 67.7 L0.6 60.4 L1.1 54.4 L1.7 49.1 L2.5 44.4 L3.4 40.1 L4.4 36.2 L5.6 32.6 L6.9 29.3 L8.4 26.2 L10.1 23.3 L11.8 20.7 L13.8 18.2 L15.9 15.9 L18.2 13.8 L20.7 11.8 L23.3 10.1 L26.2 8.4 L29.3 6.9 L32.6 5.6 L36.2 4.4 L40.1 3.4 L44.4 2.5 L49.1 1.7 L54.4 1.1 L60.4 0.6 L67.7 0.3 L77.1 0.1 L100.0 0.0 L122.9 0.1 L132.3 0.3 L139.6 0.6 L145.6 1.1 L150.9 1.7 L155.6 2.5 L159.9 3.4 L163.8 4.4 L167.4 5.6 L170.7 6.9 L173.8 8.4 L176.7 10.1 L179.3 11.8 L181.8 13.8 L184.1 15.9 L186.2 18.2 L188.2 20.7 L189.9 23.3 L191.6 26.2 L193.1 29.3 L194.4 32.6 L195.6 36.2 L196.6 40.1 L197.5 44.4 L198.3 49.1 L198.9 54.4 L199.4 60.4 L199.7 67.7 L199.9 77.1 Z'

/** MeeGo 风格顶部高光区域 */
export const MEEGO_GLOSS_PATH = 'M0 0 H200 V96 Q100 122 0 96 Z'

export const STANDARD_LOGO_PRESETS: NoteLogoPreset[] = [
  { id: 'violet', style: 'standard', nameKey: 'settings.logo.presetViolet', descKey: 'settings.logo.presetVioletDesc', bg: '#14141A', mark: '#FFFFFF', accent: '#8B5CF6' },
  { id: 'mint', style: 'standard', nameKey: 'settings.logo.presetMint', descKey: 'settings.logo.presetMintDesc', bg: '#0F1F1C', mark: '#5EEAD4', accent: '#5EEAD4' },
  { id: 'sunset', style: 'standard', nameKey: 'settings.logo.presetSunset', descKey: 'settings.logo.presetSunsetDesc', bg: '#FFF1E6', mark: '#EA580C', accent: '#EA580C' },
  { id: 'ocean', style: 'standard', nameKey: 'settings.logo.presetOcean', descKey: 'settings.logo.presetOceanDesc', bg: '#1D4ED8', bgTo: '#0EA5E9', mark: '#FFFFFF', accent: '#FFFFFF' },
  { id: 'dawn', style: 'standard', nameKey: 'settings.logo.presetDawn', descKey: 'settings.logo.presetDawnDesc', bg: '#F97316', bgTo: '#EC4899', mark: '#FFFFFF', accent: '#FFFFFF' },
  { id: 'graphite', style: 'standard', nameKey: 'settings.logo.presetGraphite', descKey: 'settings.logo.presetGraphiteDesc', bg: '#18181B', mark: '#F5C84C', accent: '#F5C84C' },
]

export const MEEGO_LOGO_PRESETS: NoteLogoPreset[] = [
  { id: 'n9blue', style: 'meego', nameKey: 'settings.logo.presetN9Blue', descKey: 'settings.logo.presetN9BlueDesc', bg: '#0A92FF', bgTo: '#0060F5', border: '#0B3D9C', mark: '#FFFFFF', accent: '#FFFFFF', gloss: 0.4 },
  { id: 'n9green', style: 'meego', nameKey: 'settings.logo.presetN9Green', descKey: 'settings.logo.presetN9GreenDesc', bg: '#3BC21E', bgTo: '#0B7A0B', border: '#064D06', mark: '#FFFFFF', accent: '#FFFFFF', gloss: 0.4 },
  { id: 'n9orange', style: 'meego', nameKey: 'settings.logo.presetN9Orange', descKey: 'settings.logo.presetN9OrangeDesc', bg: '#F56400', bgTo: '#CF1F00', border: '#8A1010', mark: '#FFFFFF', accent: '#FFFFFF', gloss: 0.4 },
  { id: 'n9pink', style: 'meego', nameKey: 'settings.logo.presetN9Pink', descKey: 'settings.logo.presetN9PinkDesc', bg: '#F2307F', bgTo: '#B3125E', border: '#6E0838', mark: '#FFFFFF', accent: '#FFFFFF', gloss: 0.4 },
  { id: 'n9white', style: 'meego', nameKey: 'settings.logo.presetN9White', descKey: 'settings.logo.presetN9WhiteDesc', bg: '#FFFFFF', bgTo: '#C6C6CC', border: '#8E8E96', mark: '#33333C', accent: '#33333C', gloss: 0.05 },
]

export const NOTE_LOGO_PRESETS: NoteLogoPreset[] = [...STANDARD_LOGO_PRESETS, ...MEEGO_LOGO_PRESETS]

export const DEFAULT_NOTE_LOGO_STYLE: NoteLogoStyle = 'standard'
export const DEFAULT_NOTE_LOGO_VARIANT = 'violet'

/** 某套风格下的全部预设 */
export function presetsOfStyle(style: NoteLogoStyle): NoteLogoPreset[] {
  return style === 'meego' ? MEEGO_LOGO_PRESETS : STANDARD_LOGO_PRESETS
}

/** 按 id 取预设，找不到返回 undefined */
export function findNoteLogoPreset(id: unknown): NoteLogoPreset | undefined {
  const key = typeof id === 'string' ? id.trim() : ''
  return NOTE_LOGO_PRESETS.find(preset => preset.id === key)
}

/** 某套风格的兜底预设（第一项） */
export function defaultPresetOfStyle(style: NoteLogoStyle): NoteLogoPreset {
  return presetsOfStyle(style)[0] ?? STANDARD_LOGO_PRESETS[0]
}

export function normalizeNoteLogoStyle(value: unknown): NoteLogoStyle {
  return value === 'meego' ? 'meego' : DEFAULT_NOTE_LOGO_STYLE
}

/** 变体必须属于给定风格，否则回落到该风格的默认预设 */
export function normalizeNoteLogoVariant(style: NoteLogoStyle, value: unknown): string {
  const preset = findNoteLogoPreset(value)
  return preset && preset.style === style ? preset.id : defaultPresetOfStyle(style).id
}
