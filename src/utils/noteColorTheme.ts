/**
 * 笔记底色的主题适配。
 *
 * 笔记里只存一种颜色（新建/选色时写入的固定 hex），但同一种颜色不可能在亮色
 * 和暗色主题下都看得清：暗色主题配一张亮纸，`--color-text` 已经转成浅色文字，
 * 直接糊在背景里。所以渲染时按当前主题把存储颜色换算成能看清的版本：
 *   暗色主题 → 保留色相，压暗到 L≈17%，降低饱和度
 *   亮色主题 → 保留色相，提亮到 L≈94.5%
 * 已经合适的颜色原样返回（幂等，重复渲染不会越来越偏），非 hex 值（rgba/var）
 * 不处理。
 */

export type NoteThemeName = 'light' | 'dark'

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** 规范化成小写 6 位 hex；不是 hex 时返回 null */
export function normalizeHexColor(color: string): string | null {
  if (typeof color !== 'string') return null
  const value = color.trim()
  if (!HEX_RE.test(value)) return null
  const body = value.slice(1)
  const full = body.length === 3
    ? body.split('').map((c) => c + c).join('')
    : body
  return '#' + full.toLowerCase()
}

function hexToRgb(hex: string): [number, number, number] {
  const full = normalizeHexColor(hex) ?? '#000000'
  return [
    parseInt(full.slice(1, 3), 16),
    parseInt(full.slice(3, 5), 16),
    parseInt(full.slice(5, 7), 16),
  ]
}

/** sRGB 相对亮度：0 全黑，1 全白 */
export function relativeLuminance(color: string): number {
  const [r, g, b] = hexToRgb(color).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 偏亮（适合配深色文字）返回 true */
export function isLightColor(color: string): boolean {
  return relativeLuminance(color) > 0.5
}

/** rgb(0-255) → hsl(色相 0-360, 饱和度 0-1, 亮度 0-1) */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return [h * 360, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360 / 360
  const sat = Math.min(Math.max(s, 0), 1)
  const lig = Math.min(Math.max(l, 0), 1)
  const channel = (p: number, q: number, t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  let r: number
  let g: number
  let b: number
  if (sat === 0) {
    r = g = b = lig
  } else {
    const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat
    const p = 2 * lig - q
    r = channel(p, q, hue + 1 / 3)
    g = channel(p, q, hue)
    b = channel(p, q, hue - 1 / 3)
  }
  const toHex = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0')
  return '#' + toHex(r) + toHex(g) + toHex(b)
}

// 暗色主题：亮度高于这个值就算「亮纸」，要压暗
const DARK_LUMINANCE_LIMIT = 0.2
const DARK_TARGET_LIGHTNESS = 0.17
const DARK_MAX_SATURATION = 0.3

// 亮色主题：亮度低于这个值就算「黑纸」，要提亮
const LIGHT_LUMINANCE_LIMIT = 0.55
const LIGHT_TARGET_LIGHTNESS = 0.945
const LIGHT_MAX_SATURATION = 0.36

/**
 * 把笔记存储的底色换算成当前主题下能看清的版本。
 * 非 hex 值、以及本来就合适的颜色都原样返回。
 */
export function adaptNoteColor(color: string, theme: NoteThemeName): string {
  const hex = normalizeHexColor(color)
  if (!hex) return color

  const luminance = relativeLuminance(hex)
  const [h, s] = rgbToHsl(...hexToRgb(hex))

  if (theme === 'dark') {
    if (luminance <= DARK_LUMINANCE_LIMIT) return hex
    return hslToHex(h, Math.min(s, DARK_MAX_SATURATION), DARK_TARGET_LIGHTNESS)
  }

  if (luminance >= LIGHT_LUMINANCE_LIMIT) return hex
  return hslToHex(h, Math.min(s, LIGHT_MAX_SATURATION), LIGHT_TARGET_LIGHTNESS)
}
