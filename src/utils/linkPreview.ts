import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

/**
 * 链接卡片预览：抓到目标网页的 og/meta 信息，供编辑器渲染成卡片。
 * 抓取失败一律返回 null（调用方据此回退为纯文字链接）。
 */

export interface LinkPreviewData {
  /** 原始链接（Markdown 里写的那个地址） */
  url: string
  /** 跟随重定向后的最终地址 */
  finalUrl: string
  /** 站点域名（卡片上展示） */
  host: string
  title: string
  description: string
  /** 缩略图绝对地址，没有则为空串 */
  image: string
  siteName: string
  /** 抓取时间戳（毫秒） */
  fetchedAt: number
}

interface CacheEntry {
  data: LinkPreviewData | null
  ts: number
}

const CACHE_KEY = 'maiknote-link-preview-cache'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 成功结果缓存 7 天
const FAIL_TTL = 10 * 60 * 1000 // 失败结果 10 分钟后重试
const MAX_CACHE_ENTRIES = 300
const MAX_HTML_CHARS = 400_000
const FETCH_TIMEOUT = 8000

const memoryCache = new Map<string, CacheEntry>()
const pending = new Map<string, Promise<LinkPreviewData | null>>()
let cacheLoaded = false
let persistTimer: ReturnType<typeof setTimeout> | null = null

function loadCache() {
  if (cacheLoaded) return
  cacheLoaded = true
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>
    if (!parsed || typeof parsed !== 'object') return
    Object.entries(parsed).forEach(([url, entry]) => {
      if (!entry || typeof entry.ts !== 'number') return
      memoryCache.set(url, { data: entry.data ?? null, ts: entry.ts })
    })
  } catch {
    /* 缓存坏了就当没有 */
  }
}

function persistCache() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      const entries = Array.from(memoryCache.entries())
        .sort((a, b) => b[1].ts - a[1].ts)
        .slice(0, MAX_CACHE_ENTRIES)
      const payload: Record<string, CacheEntry> = {}
      entries.forEach(([url, entry]) => {
        payload[url] = entry
      })
      memoryCache.clear()
      entries.forEach(([url, entry]) => memoryCache.set(url, entry))
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
    } catch {
      /* 写不进去不影响使用 */
    }
  }, 500)
}

/** 只认 http/https */
export function isPreviewableUrl(raw: string): boolean {
  const url = (raw || '').trim()
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return false
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.includes('.')) return false
    // 本机 / 内网地址不做卡片预览
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(parsed.hostname)) return false
    if (/^(10\.|192\.168\.|169\.254\.)/.test(parsed.hostname)) return false
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(parsed.hostname)) return false
    return true
  } catch {
    return false
  }
}

/** 段落文本是不是「一个裸链接」；是则返回规范化的地址 */
export function extractSoleUrl(text: string): string {
  const value = (text || '').trim()
  if (!value || value.length > 2048) return ''
  if (/\s/.test(value)) return ''
  if (!isPreviewableUrl(value)) return ''
  return value
}

function metaContent(doc: Document, keys: string[]): string {
  for (const key of keys) {
    const el = doc.querySelector(`meta[property="${key}" i], meta[name="${key}" i]`)
    const content = el?.getAttribute('content')?.trim()
    if (content) return content
  }
  return ''
}

function absoluteUrl(value: string, base: string): string {
  if (!value) return ''
  try {
    return new URL(value, base).toString()
  } catch {
    return ''
  }
}

function cleanText(value: string, maxLength: number): string {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function parseHtml(html: string, url: string, finalUrl: string): LinkPreviewData | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (!doc) return null

  const title = cleanText(
    metaContent(doc, ['og:title', 'twitter:title']) || doc.querySelector('title')?.textContent || '',
    160,
  )
  const description = cleanText(
    metaContent(doc, ['og:description', 'twitter:description', 'description']),
    260,
  )
  const image = absoluteUrl(metaContent(doc, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']), finalUrl)
  const siteName = cleanText(metaContent(doc, ['og:site_name', 'application-name']), 60)

  let host = ''
  try {
    host = new URL(finalUrl).hostname.replace(/^www\./i, '')
  } catch {
    host = ''
  }

  // 什么都没抓到，就当预览失败，让编辑器保持纯文字链接
  if (!title && !description && !image) return null

  return {
    url,
    finalUrl,
    host,
    title: title || host || url,
    description: description && description !== title ? description : '',
    image,
    siteName: siteName || host,
    fetchedAt: Date.now(),
  }
}

async function getHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  const inTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const request = (target: string) =>
      inTauri
        ? tauriFetch(target, {
            method: 'GET',
            headers: {
              Accept: 'text/html,application/xhtml+xml',
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
            },
            signal: controller.signal,
            connectTimeout: FETCH_TIMEOUT,
            maxRedirections: 5,
          })
        : fetch(target, {
            method: 'GET',
            headers: { Accept: 'text/html,application/xhtml+xml' },
            signal: controller.signal,
            redirect: 'follow',
          })

    const response = await request(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    return { html: text.slice(0, MAX_HTML_CHARS), finalUrl: response.url || url }
  } finally {
    clearTimeout(timer)
  }
}

/** 抓取并解析链接预览；失败返回 null（永不抛错） */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreviewData | null> {
  const url = (rawUrl || '').trim()
  if (!isPreviewableUrl(url)) return null

  loadCache()

  const cached = memoryCache.get(url)
  if (cached) {
    const ttl = cached.data ? CACHE_TTL : FAIL_TTL
    if (Date.now() - cached.ts < ttl) return cached.data
  }

  const running = pending.get(url)
  if (running) return running

  const task = (async () => {
    try {
      const { html, finalUrl } = await getHtml(url)
      const data = parseHtml(html, url, finalUrl)
      memoryCache.set(url, { data, ts: Date.now() })
      persistCache()
      return data
    } catch (err) {
      console.warn('[link-preview] 抓取失败，回退为文字链接:', url, err)
      memoryCache.set(url, { data: null, ts: Date.now() })
      persistCache()
      return null
    } finally {
      pending.delete(url)
    }
  })()

  pending.set(url, task)
  return task
}

/** 读缓存（不发请求），用于首帧同步渲染 */
export function peekLinkPreview(rawUrl: string): LinkPreviewData | null | undefined {
  loadCache()
  const entry = memoryCache.get(rawUrl)
  if (!entry) return undefined
  const ttl = entry.data ? CACHE_TTL : FAIL_TTL
  if (Date.now() - entry.ts >= ttl) return undefined
  return entry.data
}

export function clearLinkPreviewCache() {
  memoryCache.clear()
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
}
