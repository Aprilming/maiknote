/**
 * 文件树里给文件 / 文件夹标记的显示颜色。
 * 这套色板是「文字 + 图标」前景色，所以都取中饱和度的实色，
 * 浅色主题和深色主题各一套，保证对比度。
 */
export interface TreeColorOption {
  nameKey: string
  value: string
}

export const TREE_LIGHT_COLORS: TreeColorOption[] = [
  { nameKey: 'color.textRed', value: '#e5484d' },
  { nameKey: 'color.textOrange', value: '#e07b00' },
  { nameKey: 'color.textAmber', value: '#b08600' },
  { nameKey: 'color.textGreen', value: '#199c4b' },
  { nameKey: 'color.textTeal', value: '#0d9488' },
  { nameKey: 'color.textBlue', value: '#2563eb' },
  { nameKey: 'color.textIndigo', value: '#6366f1' },
  { nameKey: 'color.textPurple', value: '#7c3aed' },
  { nameKey: 'color.textPink', value: '#db2777' },
  { nameKey: 'color.textRose', value: '#e11d48' },
  { nameKey: 'color.textBrown', value: '#92400e' },
  { nameKey: 'color.textGray', value: '#64748b' },
]

export const TREE_DARK_COLORS: TreeColorOption[] = [
  { nameKey: 'color.textRed', value: '#ff8087' },
  { nameKey: 'color.textOrange', value: '#ffa94d' },
  { nameKey: 'color.textAmber', value: '#e9c04a' },
  { nameKey: 'color.textGreen', value: '#4ade80' },
  { nameKey: 'color.textTeal', value: '#2dd4bf' },
  { nameKey: 'color.textBlue', value: '#60a5fa' },
  { nameKey: 'color.textIndigo', value: '#a5b4fc' },
  { nameKey: 'color.textPurple', value: '#c4a6ff' },
  { nameKey: 'color.textPink', value: '#f472b6' },
  { nameKey: 'color.textRose', value: '#fb7185' },
  { nameKey: 'color.textBrown', value: '#d3a06a' },
  { nameKey: 'color.textGray', value: '#94a3b8' },
]
