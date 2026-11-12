// src/utils/clipboard.ts
// 统一的剪贴板写入：原生插件 → Web API → execCommand 兜底。
// 目的：WKWebView 里 navigator.clipboard 依赖窗口焦点与用户手势，
// 首次点击（窗口刚激活 / 焦点不在文档上）容易静默失败，导致要点第二下。

import { writeText as tauriWriteText } from '@tauri-apps/plugin-clipboard-manager'

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 兼容兜底：临时 textarea + execCommand，不依赖焦点状态 */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;'
  document.body.appendChild(ta)

  const selection = document.getSelection()
  const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  let ok = false
  try {
    ta.select()
    ta.setSelectionRange(0, text.length)
    ok = document.execCommand('copy')
  } catch (err) {
    console.error('[clipboard] execCommand 复制失败:', err)
    ok = false
  } finally {
    document.body.removeChild(ta)
    if (savedRange && selection) {
      selection.removeAllRanges()
      selection.addRange(savedRange)
    }
  }
  return ok
}

/**
 * 把文本写入系统剪贴板。
 * @returns 是否写入成功（可用于展示「已复制」态）
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof text !== 'string') return false

  // 1. Tauri 原生剪贴板：不依赖窗口焦点 / 用户手势，最可靠
  if (inTauri()) {
    try {
      await tauriWriteText(text)
      return true
    } catch (err) {
      console.warn('[clipboard] 原生剪贴板写入失败，回退 Web API:', err)
    }
  }

  // 2. 浏览器异步剪贴板
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (err) {
    console.warn('[clipboard] navigator.clipboard 写入失败，回退 execCommand:', err)
  }

  // 3. 同步兜底
  return legacyCopy(text)
}
