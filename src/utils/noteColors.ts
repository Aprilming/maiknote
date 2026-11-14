/** 笔记背景色（编辑器右下角色板 / 设置里的默认笔记背景色 共用同一套） */

import { adaptNoteColor, type NoteThemeName } from './noteColorTheme'

export interface NoteColorOption {
  nameKey: string
  /** 笔记里真正存下来的颜色（统一用浅色纸感 hex，切换主题不迁移数据） */
  value: string
  /** 当前主题下这个选项实际显示的样子，不填就按 value 画 */
  swatch?: string
}

/** 浅色主题：低饱和纸感底色 */
export const LIGHT_NOTE_COLORS: NoteColorOption[] = [
  { nameKey: 'color.warmYellow', value: '#fff9e6' },
  { nameKey: 'color.softPink', value: '#fce4ec' },
  { nameKey: 'color.lightPurple', value: '#f3e5f5' },
  { nameKey: 'color.skyBlue', value: '#e3f2fd' },
  { nameKey: 'color.mint', value: '#e0f2f1' },
  { nameKey: 'color.lightOrange', value: '#fff3e0' },
  { nameKey: 'color.grayBlue', value: '#e8eaf6' },
  { nameKey: 'color.lightGray', value: '#f5f5f5' },
  { nameKey: 'color.lightGreen', value: '#e8f5e9' },
  { nameKey: 'color.beige', value: '#faf8f5' },
]

/** 深色主题：同色系的深色底（历史色板，保留导出以兼容旧数据展示） */
export const DARK_NOTE_COLORS: NoteColorOption[] = [
  { nameKey: 'color.darkBlue', value: '#1e293b' },
  { nameKey: 'color.darkPurple', value: '#2a1a3e' },
  { nameKey: 'color.darkGreen', value: '#1a2e24' },
  { nameKey: 'color.darkRed', value: '#3d1a1a' },
  { nameKey: 'color.darkGray', value: '#1f2937' },
  { nameKey: 'color.darkCyan', value: '#1a2e2e' },
  { nameKey: 'color.darkOrange', value: '#3d2a1a' },
  { nameKey: 'color.inkBlue', value: '#0f172a' },
  { nameKey: 'color.darkPink', value: '#2e1a2a' },
  { nameKey: 'color.darkBrown', value: '#2e241a' },
]

/**
 * 当前主题下要展示的色板：value 仍是笔记存储的规范底色，swatch 是它在当前主题
 * 下的实际观感。这样选色板不随主题切换存储值，历史笔记也不用迁移。
 */
export function noteColorOptionsFor(theme: NoteThemeName): NoteColorOption[] {
  return LIGHT_NOTE_COLORS.map((color) => ({
    ...color,
    swatch: adaptNoteColor(color.value, theme),
  }))
}
