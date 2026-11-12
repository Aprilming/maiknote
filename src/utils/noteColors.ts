/** 笔记背景色（编辑器右下角色板 / 设置里的默认笔记背景色 共用同一套） */

export interface NoteColorOption {
  nameKey: string
  value: string
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

/** 深色主题：同色系的深色底 */
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
