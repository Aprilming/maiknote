<script setup lang="ts">
import { ref, computed, watch, watchEffect, onMounted, onUnmounted, nextTick } from 'vue'
import TiptapEditor from './TiptapEditor.vue'
import { useNoteStore, extractTitle } from '@/stores/noteStore'
import { useDirectoryStore } from '@/stores/directoryStore'
import { useSettingStore } from '@/stores/settingStore'
import { useAutoSave } from '@/composables/useAutoSave'
import { useFileSystem } from '@/composables/useFileSystem'
import { useSourceMode } from '@/composables/useSourceMode'
import { useTheme } from '@/composables/useTheme'
import NoteColorPicker from '@/components/NoteColorPicker.vue'
import { createSourceTabInsertText } from './tabInsert'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { copyText } from '@/utils/clipboard'
import { sanitizePathSegment, fileNameForTitle } from '@/utils/notePath'
import { noteColorOptionsFor } from '@/utils/noteColors'
import { adaptNoteColor } from '@/utils/noteColorTheme'

const noteStore = useNoteStore()
const directoryStore = useDirectoryStore()
const settingStore = useSettingStore()

const { getICloudPath } = useFileSystem()
const { isSourceMode, toggleSourceMode } = useSourceMode()

const { currentTheme } = useTheme()

// 色板按主题换算观感，笔记里存的仍是同一份规范底色（切换主题不迁移数据）
const NOTE_COLORS = computed(() => noteColorOptionsFor(currentTheme.value))

// 笔记边框：笔记背景与窗口边界之间的留白宽度，0 时背景直接铺满，不再有边框
const noteFrameStyle = computed(() => {
  const width = settingStore.settings.noteBorderWidth
  return {
    '--note-border-width': `${width}px`,
    '--note-radius': width > 0 ? '8px' : '0px',
  }
})

const colorPickerVisible = ref(false)

function toggleColorPicker() {
  colorPickerVisible.value = !colorPickerVisible.value
}

function handleColorSelect(color: string | undefined) {
  if (currentNote.value) {
    noteStore.updateNote(currentNote.value.id, { backgroundColor: color })
  }
}

const localContent = ref('')
const sourceTextareaRef = ref<HTMLTextAreaElement | null>(null)

// 删除动画状态
const vortexDeleting = ref(false)

function handleVortexDelete() {
  if (vortexDeleting.value) return
  const note = noteStore.currentNote
  if (!note || note.isLocked) return
  const id = note.id

  const container = document.querySelector('.editor-container') as HTMLElement | null
  if (!container) {
    noteStore.deleteNote(id)
    return
  }

  vortexDeleting.value = true
  noteStore.setDeletingNoteId(id)

  const DURATION = 900
  const wrapper = container.querySelector('.editor-content-wrapper') as HTMLElement | null
  const host = wrapper?.parentElement ?? container
  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative'
  }

  // 1) 正文：向左下塌陷、虚化、淡出，和粒子流向同一个出口
  if (wrapper) {
    // 与粒子同一条非线性节奏：先撑住不动，42% 之后才塌
    wrapper.animate([
      { transform: 'translate(0, 0) scale(1)', filter: 'blur(0px)', opacity: 1, offset: 0 },
      { transform: 'translate(-1px, 1px) scale(0.9995)', filter: 'blur(0.15px)', opacity: 0.97, offset: 0.42 },
      { transform: 'translate(-6px, 6px)', filter: 'blur(1.1px)', opacity: 0.8, offset: 0.58 },
      { transform: 'translate(-20px, 20px) scale(0.985)', filter: 'blur(3px)', opacity: 0.35, offset: 0.82 },
      { transform: 'translate(-40px, 40px) scale(0.96)', filter: 'blur(5px)', opacity: 0, offset: 1 },
    ], { duration: DURATION, easing: 'linear', fill: 'forwards' })
  }

  // 2) 彩色粒子漏斗：全部从正文区域汇向左下角的一个汇聚点，越接近出口越挤、越密
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = host.getBoundingClientRect()
  const width = rect.width
  const height = rect.height

  const canvas = document.createElement('canvas')
  canvas.className = 'vortex-canvas'
  canvas.width = Math.max(1, Math.round(width * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  host.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    vortexDeleting.value = false
    noteStore.setDeletingNoteId(null)
    return
  }
  ctx.scale(dpr, dpr)

  const srcRect = wrapper ? wrapper.getBoundingClientRect() : rect
  const box = {
    x: Math.max(0, srcRect.left - rect.left),
    y: Math.max(0, srcRect.top - rect.top),
    w: Math.min(width, srcRect.width),
    h: Math.min(height, srcRect.height),
  }

  // 漏斗出口：左下角内侧
  const apex = { x: width * 0.05, y: height * 0.95 }

  // 彩色但克制：一组挑选过的色相，避免纯彩虹的廉价感
  const PALETTE = ['#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#fb7185', '#f59e0b', '#22d3ee', '#38bdf8']

  const COUNT = Math.round(Math.min(900, Math.max(380, (box.w * box.h) / 900)))
  type Particle = {
    // 起点（正文区域随机）
    sx: number
    sy: number
    // 出口附近的抖动半径，让漏斗有厚度而不是一根线
    neck: number
    // 弧线弯曲量（垂直于出口方向的控制点偏移）
    bow: number
    delay: number
    size: number
    color: string
    glow: boolean
    wobbleAmp: number
    wobblePhase: number
    wobbleFreq: number
  }

  const particles: Particle[] = []
  for (let i = 0; i < COUNT; i++) {
    particles.push({
      sx: box.x + Math.random() * box.w,
      sy: box.y + Math.random() * box.h,
      neck: 1.5 + Math.random() * 9,
      // 统一偏向一侧的弯曲（少量反向增加层次），整体像被卷入而不是直线吸过去
      // 弧度要一眼看得出来：控制点偏移到弦长的 22%~56%，且 92% 朝同一侧，形成整体卷动方向
      bow: (0.22 + Math.random() * 0.34) * (Math.random() < 0.92 ? 1 : -1),
      // 起点越靠左上，越晚出发，形成连续不断的流
      delay: Math.random() * 0.28,
      size: 0.8 + Math.random() * 1.9,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      glow: Math.random() < 0.22,
      wobbleAmp: 2 + Math.random() * 8,
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleFreq: 3 + Math.random() * 4,
    })
  }

  // 非线性时间曲线：前半段几乎被「吸住」原地悬停，过了 42% 才猛烈加速冲进出口
  const easeOf = (t: number) => {
    const HOLD = 0.42
    if (t <= HOLD) return 0.05 * Math.pow(t / HOLD, 2.2)
    return 0.05 + 0.95 * Math.pow((t - HOLD) / (1 - HOLD), 2.8)
  }

  // 单个粒子在进度 t 时的位置：以「起点 → 出口」为弦做二次贝塞尔，中途向一侧鼓出去，
  // 所以每条流都是带弧度的曲线；横向摆动幅度随接近出口收窄，形成漏斗收口
  const posAt = (particle: Particle, t: number) => {
    const ease = easeOf(t)
    const shrink = 1 - ease
    const dx = apex.x - particle.sx
    const dy = apex.y - particle.sy
    const len = Math.hypot(dx, dy) || 1
    // 垂直于弦的单位向量，控制点沿它偏移 → 弧线
    const nx = -dy / len
    const ny = dx / len
    // 控制点压向弦的中点：这样弧线的最鼓处在半程，视觉上是一段明显的弯
    const cx = particle.sx + dx * 0.5 + nx * len * particle.bow
    const cy = particle.sy + dy * 0.5 + ny * len * particle.bow
    const inv = 1 - ease
    const bezX = inv * inv * particle.sx + 2 * inv * ease * cx + ease * ease * apex.x
    const bezY = inv * inv * particle.sy + 2 * inv * ease * cy + ease * ease * apex.y

    const wobble = Math.sin(t * Math.PI * particle.wobbleFreq + particle.wobblePhase)
    const spread = particle.neck * shrink * shrink
    return {
      x: bezX + wobble * particle.wobbleAmp * shrink + spread,
      y: bezY + Math.cos(t * Math.PI * particle.wobbleFreq * 0.8 + particle.wobblePhase) * particle.wobbleAmp * 0.6 * shrink,
    }
  }

  let rafId = 0
  const startedAt = performance.now()

  const tick = (now: number) => {
    const elapsed = now - startedAt
    const p = Math.min(1, elapsed / DURATION)
    ctx.clearRect(0, 0, width, height)

    for (const particle of particles) {
      const local = (p - particle.delay) / (1 - particle.delay)
      if (local <= 0) {
        // 还没出发：原地微微颤动，像被吸力扰动
        if (p > 0) {
          ctx.globalAlpha = 0.32
          ctx.fillStyle = particle.color
          ctx.fillRect(
            particle.sx + Math.sin(p * 8 + particle.wobblePhase) * 1.2,
            particle.sy + Math.cos(p * 7 + particle.wobblePhase) * 1.2,
            particle.size,
            particle.size
          )
        }
        continue
      }

      const t = Math.min(1, local)
      const head = posAt(particle, t)
      const ease = easeOf(t)
      // 冲刺阶段的拖尾更长，速度感才看得出来（同一帧里快的地方尾迹更长）
      const sprint = t <= 0.42 ? 0 : Math.min(1, (t - 0.42) / 0.28)
      const tail = posAt(particle, Math.max(0, t - (0.035 + 0.11 * sprint)))

      // 越接近出口越亮，最后 12% 迅速消失
      const shrink = 1 - ease
      const brightness = 0.4 + 0.6 * (1 - shrink)
      const fadeOut = t > 0.88 ? Math.max(0, 1 - (t - 0.88) / 0.12) : 1
      const alpha = brightness * fadeOut
      if (alpha <= 0.012) continue

      const size = particle.size * (1 - t * 0.45)

      if (particle.glow) {
        ctx.globalAlpha = alpha * 0.18
        ctx.fillStyle = particle.color
        ctx.beginPath()
        ctx.arc(head.x, head.y, size * 1.9, 0, Math.PI * 2)
        ctx.fill()
      }

      // 拖尾 + 亮头：每帧上千个渐变太贵，用低透明度线 + 实心亮头做出同样的流动感
      ctx.globalAlpha = alpha * 0.55
      ctx.strokeStyle = particle.color
      ctx.lineWidth = size * 0.8
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(tail.x, tail.y)
      ctx.lineTo(head.x, head.y)
      ctx.stroke()

      ctx.globalAlpha = alpha
      ctx.fillStyle = particle.color
      ctx.beginPath()
      ctx.arc(head.x, head.y, size * 0.62, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = 1
    if (p < 1) {
      rafId = requestAnimationFrame(tick)
    } else {
      ctx.clearRect(0, 0, width, height)
    }
  }
  rafId = requestAnimationFrame(tick)

  setTimeout(() => {
    cancelAnimationFrame(rafId)
    canvas.remove()
  }, DURATION + 120)

  // --- 动画结束后执行实际删除 ---
  setTimeout(() => {
    vortexDeleting.value = false
    if (noteStore.currentNoteId === id) {
      noteStore.deleteNote(id)
    } else {
      noteStore.setDeletingNoteId(null)
    }
  }, DURATION + 40)
}

// 当前笔记是否锁定
const isLocked = computed(() => currentNote.value?.isLocked ?? false)

// 切换锁定状态
function toggleLock() {
  if (currentNote.value) {
    noteStore.toggleLock(currentNote.value.id)
  }
}

// 计算当前笔记字数
const wordCount = computed(() => {
  const text = localContent.value || ''
  const count = text.trim().length
  return count
})

// get current note
const currentNote = computed(() => noteStore.currentNote)

// 笔记底色在当前主题下的实际取值（暗色主题下压暗，亮色主题下提亮）
const adaptedNoteBg = computed(() => {
  const color = currentNote.value?.backgroundColor
  return color ? adaptNoteColor(color, currentTheme.value) : ''
})

// ============================================
// 底部路径：根目录就是 /，末段显示笔记标题
// ============================================
// 当前笔记所在的目录链（从根目录往下，只用可读的目录名）
const noteDirNames = computed<string[]>(() => {
  const names: string[] = []
  let dirId = currentNote.value?.directoryId ?? null
  let guard = 0
  while (dirId && guard < 32) {
    const dir = directoryStore.getDirectory(dirId)
    if (!dir) break
    names.unshift(sanitizePathSegment(dir.name))
    dirId = dir.parentId ?? null
    guard++
  }
  return names
})

// 末段：磁盘上的真实文件名（就是标题，重名时带序号）
const noteDisplayName = computed(() => {
  const note = currentNote.value
  if (!note) return ''
  if (note.fileName) return note.fileName
  const content = note.content
  if (!content) return ''
  const title = extractTitle(content)
  return title === 'Untitled' ? '未命名.md' : fileNameForTitle(title)
})

// 路径前半部分：/ 或 /目录/目录/
const notePathHead = computed(() => {
  if (!currentNote.value) return ''
  const names = noteDirNames.value
  return names.length ? `/${names.join('/')}/` : '/'
})

// ============================================
// 点击路径：复制完整路径 / 在文件管理器中打开
// ============================================
/** 笔记在磁盘上的完整路径（目录按名字嵌套，文件名就是标题） */
async function resolveFullNotePath(): Promise<string> {
  const note = currentNote.value
  if (!note) return ''
  const base = await getICloudPath()
  const dirs = noteDirNames.value
  const fileName = note.fileName || fileNameForTitle(extractTitle(note.content || ''))
  return dirs.length ? `${base}/${dirs.join('/')}/${fileName}` : `${base}/${fileName}`
}

// 点击后的短暂反馈：copied / failed
const pathFeedback = ref<'' | 'copied' | 'failed'>('')
let pathFeedbackTimer: ReturnType<typeof setTimeout> | null = null

function showPathFeedback(kind: 'copied' | 'failed') {
  pathFeedback.value = kind
  if (pathFeedbackTimer) clearTimeout(pathFeedbackTimer)
  pathFeedbackTimer = setTimeout(() => {
    pathFeedback.value = ''
    pathFeedbackTimer = null
  }, 1400)
}

async function handlePathClick() {
  if (!currentNote.value) return
  const action = settingStore.settings.pathClickAction
  try {
    const fullPath = await resolveFullNotePath()
    if (!fullPath) return
    if (action === 'reveal') {
      await revealItemInDir(fullPath)
      return
    }
    const ok = await copyText(fullPath)
    showPathFeedback(ok ? 'copied' : 'failed')
  } catch (err) {
    console.error('[file-path] 路径操作失败:', err)
    showPathFeedback('failed')
  }
}

onUnmounted(() => {
  if (pathFeedbackTimer) clearTimeout(pathFeedbackTimer)
})

// 外部改了正文（顶部标题栏重命名会改正文首行）时，同步回编辑器并重新挂载 Tiptap
const editorResetKey = ref(0)
const editorKey = computed(() => `${currentNote.value?.id ?? 'none'}:${editorResetKey.value}`)

watch(
  () => currentNote.value?.content,
  (content) => {
    if (typeof content !== 'string') return
    if (content === localContent.value) return
    localContent.value = content
    editorResetKey.value++
  }
)


// 导航方向由 store 统一维护（noteStore.navDirection），模板直接绑定，用于滑动过渡动画
// 追踪目录切换，用于决定垂直滑动方向
let pendingDirChange: 'up' | 'down' | null = null

watch(() => noteStore.filterDirectoryId, (newId, oldId) => {
  if (oldId === undefined || newId === oldId) return
  const ids = directoryStore.getFlattenedDirectoryIds()
  const oldIdx = ids.findIndex(id => id === oldId)
  const newIdx = ids.findIndex(id => id === newId)
  pendingDirChange = newIdx > oldIdx ? 'down' : 'up'
})

// update local content when current note changes
watch(
  () => currentNote.value?.id,
  async (newId, oldId) => {
    // 目录切换方向（up/down）：由组件根据目录位置推断并覆盖 store 方向
    if (pendingDirChange) {
      noteStore.navDirection = pendingDirChange
      pendingDirChange = null
    }
    // 其余导航（上一页/下一页/新建/删除）方向已由 store 的导航函数显式设置，
    // 模板直接绑定 noteStore.navDirection，无需在此推断（避免 watch 合并/跳过导致方向残留）

    // 如果是从源码模式切换笔记，需要先同步保存当前笔记的编辑内容
    if (isSourceMode.value && oldId && newId !== oldId) {
      // 确保 textarea 的内容完全同步到 localContent
      if (sourceTextareaRef.value) {
        // 手动同步 textarea 的值到 localContent
        localContent.value = sourceTextareaRef.value.value
      }
      // 直接落盘同步保存，不依赖防抖机制
      noteStore.updateNote(oldId, { content: localContent.value })
      await noteStore.persistNoteNow(oldId)
    }
    localContent.value = currentNote.value?.content || ''
    // 切换笔记时保持源码模式状态，不强制重置
    // isSourceMode.value = false
  },
  { immediate: true }
)

// 监听源码模式切换，确保 textarea 内容同步
watch(isSourceMode, (newVal, oldVal) => {
  if (newVal) {
    // 源码模式激活时，等待 DOM 更新后聚焦
    setTimeout(() => {
      sourceTextareaRef.value?.focus()
      if (searchVisible.value && searchQuery.value) {
        updateSourceSearchState()
      }
    }, 50)
  } else if (oldVal && !newVal) {
    // 从源码模式切换到普通模式时，确保内容已同步
    // 这里不需要额外处理，因为 handleSourceInput 已经实时同步了内容
    nextTick(() => {
      if (searchVisible.value && searchQuery.value) {
        applySearchQuery(searchQuery.value)
      }
    })
  }
})


// auto-save
const { isSaving } = useAutoSave(
  () => currentNote.value?.id || null,
  () => localContent.value,
  async (id, content) => {
    noteStore.updateNote(id, { content })
    await noteStore.persistNoteNow(id)
  },
  settingStore.settings.autoSaveInterval
)

// 追踪手势状态
let gestureFired = false
let lastDeltaX = 0

function handleWheel(e: WheelEvent) {
  // 只处理水平滑动
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) <= 5) {
    return
  }

  e.preventDefault()
  e.stopPropagation()

  // 方向翻转，视为新手势
  if (lastDeltaX !== 0 && Math.sign(e.deltaX) !== Math.sign(lastDeltaX)) {
    gestureFired = false
  }

  lastDeltaX = e.deltaX

  // 每次手势只触发一次
  if (!gestureFired) {
    gestureFired = true

    if (e.deltaX > 0) {
      noteStore.navigateNextOrCreate()
    } else {
      noteStore.navigatePrevOrCreate()
    }
  }

  // 用 cancelable 的 setTimeout 检测手势结束（无后续事件则视为结束）
  clearTimeout(wheelEndTimer)
  wheelEndTimer = setTimeout(() => {
    gestureFired = false
    lastDeltaX = 0
  }, 30) // 80ms 无新事件，视为手势结束
}

let wheelEndTimer: ReturnType<typeof setTimeout>

onMounted(() => {
  window.addEventListener('marknote:delete-note', handleVortexDelete)
  const editor = document.querySelector('.editor-container')
  if (editor) {
    editor.addEventListener('wheel', handleWheel as EventListener, { passive: false })
  }

  // 直接监听背景色变化并设置DOM样式（同时依赖 currentTheme，主题切换后要重算）
  watchEffect(() => {
    const color = adaptedNoteBg.value
    const wrapper = document.querySelector('.editor-wrapper') as HTMLElement | null
    if (wrapper) {
      if (color) {
        wrapper.style.setProperty('--note-bg', color)
      } else {
        wrapper.style.removeProperty('--note-bg')
      }
    }
    const textarea = document.querySelector('.source-textarea') as HTMLElement | null
    if (textarea) {
      if (color) {
        textarea.style.setProperty('background', color, 'important')
      } else {
        textarea.style.removeProperty('background')
      }
    }
  })
})

onUnmounted(() => {
  window.removeEventListener('marknote:delete-note', handleVortexDelete)
  // 在组件卸载前同步源码模式下的内容
  if (isSourceMode.value && sourceTextareaRef.value && currentNote.value) {
    // 确保 textarea 的内容同步到 localContent 和 store
    localContent.value = sourceTextareaRef.value.value
    noteStore.updateNote(currentNote.value.id, { content: sourceTextareaRef.value.value })
  }

  const editor = document.querySelector('.editor-container')
  if (editor) {
    editor.removeEventListener('wheel', handleWheel as EventListener)
  }
  clearTimeout(wheelEndTimer)
})

const editorRef = ref<InstanceType<typeof TiptapEditor> | null>(null)
const searchVisible = ref(false)
const searchQuery = ref('')
const searchMatchCount = ref(0)
const searchCurrentIndex = ref(0)
const sourceSearchMatches = ref<Array<{ start: number; end: number }>>([])
const sourceSearchCurrentIndex = ref(0)
const markdownScrollRatios = new Map<string, number>()
const sourceScrollRatios = new Map<string, number>()

function getTextareaScrollRatio() {
  const textarea = sourceTextareaRef.value
  if (!textarea) return 0
  const maxScroll = textarea.scrollHeight - textarea.clientHeight
  return maxScroll > 0 ? textarea.scrollTop / maxScroll : 0
}

function setTextareaScrollRatio(ratio: number) {
  const textarea = sourceTextareaRef.value
  if (!textarea) return
  const maxScroll = textarea.scrollHeight - textarea.clientHeight
  textarea.scrollTop = Math.max(0, Math.min(1, ratio)) * Math.max(0, maxScroll)
}

function getCurrentNoteId() {
  return currentNote.value?.id || ''
}

function saveCurrentModeScrollRatio() {
  const noteId = getCurrentNoteId()
  if (!noteId) return

  if (isSourceMode.value) {
    sourceScrollRatios.set(noteId, getTextareaScrollRatio())
  } else {
    markdownScrollRatios.set(noteId, editorRef.value?.getScrollRatio() ?? 0)
  }
}

function getSavedScrollRatio(targetSourceMode: boolean) {
  const noteId = getCurrentNoteId()
  if (!noteId) return 0

  return (targetSourceMode ? sourceScrollRatios : markdownScrollRatios).get(noteId) ?? 0
}

function restoreScrollAfterModeSwitch(targetSourceMode: boolean) {
  const ratio = getSavedScrollRatio(targetSourceMode)

  nextTick(() => {
    requestAnimationFrame(() => {
      if (targetSourceMode) {
        setTextareaScrollRatio(ratio)
      } else {
        editorRef.value?.setScrollRatio(ratio)
      }
    })
  })
}

function openSearch() {
  searchVisible.value = true
  searchQuery.value = ''
  searchMatchCount.value = 0
  searchCurrentIndex.value = 0
  sourceSearchMatches.value = []
  sourceSearchCurrentIndex.value = 0
  nextTick(() => {
    document.querySelector<HTMLInputElement>('.search-input')?.focus()
  })
}

function closeSearch() {
  searchVisible.value = false
  searchQuery.value = ''
  searchMatchCount.value = 0
  searchCurrentIndex.value = 0
  sourceSearchMatches.value = []
  sourceSearchCurrentIndex.value = 0
  editorRef.value?.clearSearch()
}

function findSourceMatches(query: string) {
  if (!query.trim()) return []

  const content = sourceTextareaRef.value?.value ?? localContent.value
  const lowerContent = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matches: Array<{ start: number; end: number }> = []
  let index = 0

  while (true) {
    index = lowerContent.indexOf(lowerQuery, index)
    if (index === -1) break
    matches.push({ start: index, end: index + query.length })
    index += 1
  }

  return matches
}

function updateSourceSearchState(query = searchQuery.value) {
  sourceSearchMatches.value = findSourceMatches(query)
  sourceSearchCurrentIndex.value = sourceSearchMatches.value.length > 0
    ? Math.min(sourceSearchCurrentIndex.value, sourceSearchMatches.value.length - 1)
    : 0
  searchMatchCount.value = sourceSearchMatches.value.length
  searchCurrentIndex.value = searchMatchCount.value > 0 ? sourceSearchCurrentIndex.value + 1 : 0
}

function selectSourceMatch(index: number) {
  const textarea = sourceTextareaRef.value
  const match = sourceSearchMatches.value[index]
  if (!textarea || !match) return

  nextTick(() => {
    textarea.focus()
    textarea.setSelectionRange(match.start, match.end)
    const beforeMatch = textarea.value.slice(0, match.start)
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || settingStore.settings.fontSize * 1.6
    const lineIndex = beforeMatch.split('\n').length - 1
    const centered = lineIndex * lineHeight - textarea.clientHeight / 3
    textarea.scrollTop = Math.max(0, centered)
  })
}

function applySearchQuery(query: string) {
  if (isSourceMode.value) {
    updateSourceSearchState(query)
  } else {
    editorRef.value?.setSearchQuery(query)
    const state = editorRef.value?.getSearchState()
    if (state) {
      searchMatchCount.value = state.matches
      searchCurrentIndex.value = state.matches > 0 ? state.currentIndex + 1 : 0
    }
  }
}

function handleSearchInput(e: Event) {
  const query = (e.target as HTMLInputElement).value
  searchQuery.value = query
  sourceSearchCurrentIndex.value = 0
  applySearchQuery(query)
}

function handleSearchPrev() {
  if (searchMatchCount.value === 0) return

  if (isSourceMode.value) {
    sourceSearchCurrentIndex.value = (sourceSearchCurrentIndex.value - 1 + sourceSearchMatches.value.length) % sourceSearchMatches.value.length
    searchCurrentIndex.value = sourceSearchCurrentIndex.value + 1
    selectSourceMatch(sourceSearchCurrentIndex.value)
  } else {
    editorRef.value?.searchPrev()
    const state = editorRef.value?.getSearchState()
    if (state) {
      searchCurrentIndex.value = state.currentIndex + 1
    }
  }
}

function handleSearchNext() {
  if (searchMatchCount.value === 0) return

  if (isSourceMode.value) {
    sourceSearchCurrentIndex.value = (sourceSearchCurrentIndex.value + 1) % sourceSearchMatches.value.length
    searchCurrentIndex.value = sourceSearchCurrentIndex.value + 1
    selectSourceMatch(sourceSearchCurrentIndex.value)
  } else {
    editorRef.value?.searchNext()
    const state = editorRef.value?.getSearchState()
    if (state) {
      searchCurrentIndex.value = state.currentIndex + 1
    }
  }
}

function handleSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    closeSearch()
  } else if (e.key === 'Enter') {
    if (e.shiftKey) {
      handleSearchPrev()
    } else {
      handleSearchNext()
    }
    e.preventDefault()
  }
}

function handleEditorUpdate(md: string) {
  localContent.value = md
  if (currentNote.value) {
    noteStore.updateNote(currentNote.value.id, { content: md })
  }
}

// 处理源码模式下的输入事件，确保内容实时同步
function handleSourceInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  localContent.value = target.value
  if (currentNote.value) {
    noteStore.updateNote(currentNote.value.id, { content: target.value })
  }
  if (searchVisible.value) {
    updateSourceSearchState()
  }
}

function handleSourceKeydown(e: KeyboardEvent) {
  if (searchVisible.value) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSearch()
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        handleSearchPrev()
      } else {
        handleSearchNext()
      }
      return
    }
  }

  if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return

  const textarea = e.target as HTMLTextAreaElement
  if (textarea.readOnly) return

  e.preventDefault()
  textarea.setRangeText(createSourceTabInsertText(settingStore.settings.tabSize), textarea.selectionStart, textarea.selectionEnd, 'end')
  localContent.value = textarea.value
  if (currentNote.value) {
    noteStore.updateNote(currentNote.value.id, { content: textarea.value })
  }
}

// 自定义切换源码模式函数，确保内容同步
function handleToggleSourceMode() {
  saveCurrentModeScrollRatio()
  const targetSourceMode = !isSourceMode.value

  // 如果当前是源码模式，切换到普通模式前确保内容同步
  if (isSourceMode.value && sourceTextareaRef.value) {
    // 手动同步 textarea 的内容到 localContent
    localContent.value = sourceTextareaRef.value.value
    if (currentNote.value) {
      noteStore.updateNote(currentNote.value.id, { content: sourceTextareaRef.value.value })
    }
  }
  // 切换模式
  toggleSourceMode()
  restoreScrollAfterModeSwitch(targetSourceMode)
}
</script>

<template>
  <div class="editor-container" :style="noteFrameStyle">
    <!-- navigation hint toast - 显示在工具栏上方 -->
    <Transition name="hint-fade">
      <div v-if="noteStore.navigationHint.visible" class="navigation-hint">
        <i class="i-mdi-information"></i>
        <span>{{ noteStore.navigationHint.message }}</span>
      </div>
    </Transition>

    <div class="editor-wrapper">
      <div
        class="editor-content-wrapper"
        :key="currentNote?.id"
        :class="[`dir-${noteStore.navDirection}`, { 'vortex-deleting': vortexDeleting }]"
      >
        <!-- 源码模式编辑 -->
        <textarea
          v-if="isSourceMode"
          ref="sourceTextareaRef"
          :value="localContent"
          @input="handleSourceInput"
          @keydown="handleSourceKeydown"
          class="source-textarea"
          :style="adaptedNoteBg ? { background: adaptedNoteBg + ' !important' } : {}"
          :readonly="isLocked"
          :placeholder="$t('editor.sourcePlaceholder')"
        ></textarea>

        <!-- 正常 Markdown 编辑模式 -->
        <TiptapEditor
          v-else
          ref="editorRef"
          :key="editorKey"
          :initial-content="localContent"
          :font-size="settingStore.settings.fontSize"
          :font-family="settingStore.settings.fontFamily"
          :is-locked="isLocked"
          :note-bg-color="adaptedNoteBg"
          @update="handleEditorUpdate"
        />
      </div>

      <!-- navigation hints -->
      <div v-if="noteStore.activeIndex > 0" class="nav-hint left-hint" @click.stop="noteStore.selectPrev()">
        <i class="i-mdi-chevron-left"></i>
      </div>
      <div v-if="noteStore.activeIndex < noteStore.activeNoteList.length - 1" class="nav-hint right-hint" @click.stop="noteStore.selectNext()">
        <i class="i-mdi-chevron-right"></i>
      </div>

      <div class="right-bottom-controls">
        <!-- source mode toggle button -->
        <button
          class="source-mode-button"
          :class="{ 'is-active': isSourceMode }"
          @click.stop="handleToggleSourceMode"
          :title="isSourceMode ? $t('editor.switchMarkdown') : $t('editor.switchSource')"
        >
          <i v-if="isSourceMode" class="i-mdi-markdown"></i>
          <i v-else class="i-mdi-code-tags"></i>
        </button>

        <!-- lock button -->
        <button
          class="lock-button"
          :class="{ 'is-locked': isLocked }"
          @click.stop="toggleLock"
          :title="isLocked ? $t('editor.unlockNote') : $t('editor.lockNote')"
        >
          <i v-if="isLocked" class="i-mdi-lock"></i>
          <i v-else class="i-mdi-lock-open-variant"></i>
        </button>

        <!-- note indicator -->
        <div class="note-indicator" @click.stop>
          {{ $t('editor.noteIndicator', { index: noteStore.activeIndex + 1, total: noteStore.activeNoteList.length }) }}
        </div>
      </div>

      <!-- bottom bar: word count, color, search -->
      <div class="bottom-bar">
        <div v-show="!searchVisible" class="word-count" @click.stop>
          {{ $t('editor.wordCount', { count: wordCount }) }}
        </div>
        <button
          class="color-btn"
          :class="{ 'has-color': currentNote?.backgroundColor }"
          @click.stop="toggleColorPicker"
          :title="$t('editor.noteBgColor')"
        >
          <i class="i-mdi-palette-outline"></i>
        </button>
        <button
          v-if="!searchVisible"
          class="search-toggle-btn"
          @click.stop="openSearch"
          :title="$t('editor.searchInNote')"
        >
          <i class="i-mdi-magnify"></i>
        </button>
      </div>

      <!-- 当前笔记的路径：根目录为 /，末段是文件名，过长时中间省略；点击按设置复制或打开 -->
      <div
        v-if="noteDisplayName"
        class="file-path-bar"
        :class="{ 'is-copied': pathFeedback === 'copied', 'is-failed': pathFeedback === 'failed' }"
        :title="settingStore.settings.pathClickAction === 'reveal' ? $t('editor.pathClickRevealHint') : $t('editor.pathClickCopyHint')"
        @click.stop="handlePathClick"
      >
        <i
          :class="pathFeedback === 'copied'
            ? 'i-mdi-check file-path-icon'
            : pathFeedback === 'failed'
              ? 'i-mdi-alert-circle-outline file-path-icon'
              : 'i-mdi-file-document-outline file-path-icon'"
        ></i>
        <template v-if="pathFeedback === 'copied'">
          <span class="file-path-tail">{{ $t('editor.pathCopied') }}</span>
        </template>
        <template v-else-if="pathFeedback === 'failed'">
          <span class="file-path-tail">{{ $t('editor.pathCopyFailed') }}</span>
        </template>
        <template v-else>
          <span class="file-path-head">{{ notePathHead }}</span>
          <span class="file-path-tail">{{ noteDisplayName }}</span>
        </template>
      </div>

      <!-- color picker popup -->
      <div v-if="colorPickerVisible" class="color-picker-overlay" @click="colorPickerVisible = false">
        <NoteColorPicker
          class="color-picker-wrapper"
          :model-value="currentNote?.backgroundColor"
          :colors="NOTE_COLORS"
          @update:model-value="handleColorSelect"
          @close="colorPickerVisible = false"
        />
      </div>

      <!-- search bar -->
      <div v-if="searchVisible" class="search-bar" @click.stop>
        <input
          type="text"
          class="search-input"
          :placeholder="$t('editor.searchPlaceholder')"
          :value="searchQuery"
          @input="handleSearchInput"
          @keydown="handleSearchKeydown"
        />
        <span v-if="searchQuery" class="search-count">
          {{ searchMatchCount > 0 ? `${searchCurrentIndex}/${searchMatchCount}` : '0/0' }}
        </span>
        <button
          class="search-nav-btn"
          @click="handleSearchPrev"
          :disabled="searchMatchCount === 0"
          :title="$t('editor.searchPrev')"
        >
          <i class="i-mdi-chevron-up"></i>
        </button>
        <button
          class="search-nav-btn"
          @click="handleSearchNext"
          :disabled="searchMatchCount === 0"
          :title="$t('editor.searchNext')"
        >
          <i class="i-mdi-chevron-down"></i>
        </button>
        <button class="search-close-btn" @click="closeSearch" :title="$t('editor.searchClose')">
          <i class="i-mdi-close"></i>
        </button>
      </div>

      <!-- save indicator -->
      <div v-if="isSaving" class="save-indicator" @click.stop>
        <i class="i-mdi-loading spinning"></i>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  min-height: 0;
}

.editor-wrapper {
  --bottom-control-gap: 8px;

  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* 笔记边框宽度由设置控制，0 时笔记背景铺满整个编辑区 */
  padding: var(--note-border-width, 8px);
  background: transparent;
}

.source-textarea {
  position: relative;
  z-index: 10;
  flex: 1;
  width: 100%;
  height: 100%;
  padding: 48px 56px;
  overflow: auto;
  background: var(--note-bg, transparent) !important;
  color: var(--color-text);
  border: none;
  outline: none;
  resize: none;
  font-family: v-bind('settingStore.settings.fontFamily');
  font-size: v-bind('settingStore.settings.fontSize + "px"');
  line-height: 1.75;
  white-space: pre-wrap;
  word-wrap: break-word;
  box-sizing: border-box;
  border-radius: var(--note-radius, 8px);
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
}

.source-textarea::placeholder {
  color: var(--color-text-secondary);
}

.source-textarea:read-only {
  cursor: not-allowed;
  background: var(--color-surface);
}

.editor-content-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* key 变化时 DOM 重建，CSS animation 自动触发 */
  animation-duration: 420ms;
  animation-timing-function: var(--ease-out);
}

/* 从右侧进入（下一条笔记） */
.editor-content-wrapper.dir-right {
  animation-name: note-slide-in-right;
}

/* 从左侧进入（上一条） */
.editor-content-wrapper.dir-left {
  animation-name: note-slide-in-left;
}

@keyframes note-slide-in-right {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes note-slide-in-left {
  from {
    transform: translateX(-100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

/* 从下方进入（下一个目录） */
.editor-content-wrapper.dir-down {
  animation-name: note-slide-in-down;
}

/* 从上方进入（上一个目录） */
.editor-content-wrapper.dir-up {
  animation-name: note-slide-in-up;
}

@keyframes note-slide-in-down {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes note-slide-in-up {
  from {
    transform: translateY(-100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.nav-hint {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 11;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background-color: var(--color-surface);
  color: var(--color-text-secondary);
  opacity: 0;
  transition: opacity var(--duration-normal) var(--ease-out), transform var(--duration-normal) var(--ease-out), background-color var(--duration-fast) var(--ease-out);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  user-select: none;
  -webkit-user-select: none;
}

.left-hint {
  left: calc(var(--note-border-width, 8px) + 2px);
}

.right-hint {
  right: calc(var(--note-border-width, 8px) + 2px);
}

.editor-wrapper:hover .nav-hint {
  opacity: 0.5;
}

.nav-hint:hover {
  opacity: 0.8 !important;
  background-color: var(--color-popup-bg);
}

.nav-hint:active {
  transform: translateY(-50%) scale(0.92);
}

.nav-hint i {
  font-size: 20px;
}

.right-bottom-controls {
  position: absolute;
  bottom: calc(var(--note-border-width, 8px) + 2px);
  right: calc(var(--note-border-width, 8px) + 2px);
  z-index: 11;
  display: flex;
  align-items: center;
  gap: var(--bottom-control-gap);
}

.note-indicator {
  padding: 5px 12px;
  background-color: var(--color-surface);
  border-radius: 20px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-xs);
  pointer-events: none;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.lock-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background-color: var(--color-surface);
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-xs);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.lock-button:hover {
  color: var(--color-text);
  background-color: var(--color-popup-bg);
}

.lock-button:active {
  transform: scale(0.92);
}

.lock-button.is-locked {
  color: var(--color-primary);
}

.lock-button i {
  font-size: 15px;
}

.source-mode-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background-color: var(--color-surface);
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-xs);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.source-mode-button:hover {
  color: var(--color-text);
  background-color: var(--color-popup-bg);
}

.source-mode-button:active {
  transform: scale(0.92);
}

.source-mode-button.is-active {
  color: var(--color-primary);
}

.source-mode-button i {
  font-size: 15px;
}

.bottom-bar {
  position: absolute;
  bottom: calc(var(--note-border-width, 8px) + 2px);
  left: calc(var(--note-border-width, 8px) + 2px);
  z-index: 11;
  display: flex;
  align-items: center;
  gap: var(--bottom-control-gap);
}

/* 当前笔记的文件路径：底部居中，过长时由头部省略、文件名保持完整 */
.file-path-bar {
  position: absolute;
  bottom: calc(var(--note-border-width, 8px) + 2px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: calc(100% - 300px);
  padding: 5px 12px;
  background-color: var(--color-surface);
  border-radius: 20px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-xs);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
  pointer-events: auto;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.file-path-bar:hover {
  color: var(--color-text);
  background-color: var(--color-popup-bg);
}

.file-path-bar:active {
  transform: translateX(-50%) scale(0.98);
}

.file-path-bar.is-copied {
  color: var(--color-primary);
}

.file-path-bar.is-failed {
  color: #e5484d;
}

.file-path-icon {
  flex-shrink: 0;
  font-size: 13px;
  opacity: 0.75;
}

.file-path-head {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  opacity: 0.75;
}

.file-path-tail {
  flex: 0 0 auto;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 720px) {
  .file-path-bar {
    max-width: calc(100% - 260px);
  }
}

.word-count {
  padding: 5px 12px;
  background-color: var(--color-surface);
  border-radius: 20px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-xs);
  pointer-events: none;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.search-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background-color: var(--color-surface);
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-xs);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.search-toggle-btn:hover {
  color: var(--color-text);
  background-color: var(--color-popup-bg);
}

.search-toggle-btn:active {
  transform: scale(0.92);
}

.search-toggle-btn i {
  font-size: 15px;
}

.color-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background-color: var(--color-surface);
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-xs);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  flex-shrink: 0;
  -webkit-user-select: none;
}

.color-btn:hover {
  color: var(--color-text);
  background-color: var(--color-popup-bg);
}

.color-btn:active {
  transform: scale(0.92);
}

.color-btn.has-color {
  color: var(--color-primary);
}

.color-btn i {
  font-size: 15px;
}

.color-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.color-picker-wrapper {
  position: absolute;
  bottom: 50px;
  left: 118px;
}

.search-bar {
  position: absolute;
  bottom: 10px;
  left: 10px;
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background-color: var(--color-surface);
  border-radius: 20px;
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.search-input {
  width: 140px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 12px;
  outline: none;
}

.search-input::placeholder {
  color: var(--color-text-secondary);
}

.search-count {
  font-size: 11px;
  color: var(--color-text-secondary);
  min-width: 30px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.search-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}

.search-nav-btn:hover:not(:disabled) {
  background: var(--color-popup-hover);
  color: var(--color-text);
}

.search-nav-btn:active:not(:disabled) {
  transform: scale(0.9);
}

.search-nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.search-nav-btn i {
  font-size: 14px;
}

.search-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}

.search-close-btn:hover {
  background: var(--color-popup-hover);
  color: var(--color-text);
}

.search-close-btn:active {
  transform: scale(0.9);
}

.search-close-btn i {
  font-size: 14px;
}

.save-indicator {
  position: absolute;
  bottom: 24px;
  right: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background-color: var(--color-surface);
  border-radius: 50%;
  color: var(--color-primary);
  box-shadow: var(--shadow-xs);
  pointer-events: none;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  user-select: none;
  -webkit-user-select: none;
}

.spinning {
  animation: spin 1s linear infinite;
  font-size: 16px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.navigation-hint {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background-color: var(--color-surface);
  border-radius: var(--radius-md);
  color: var(--color-text);
  box-shadow: var(--shadow-md);
  font-size: 14px;
  pointer-events: none;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  z-index: 10;
}

.navigation-hint i {
  font-size: 18px;
  color: var(--color-primary);
}

.navigation-hint {
  user-select: none;
  -webkit-user-select: none;
}

.hint-fade-enter-active,
.hint-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.hint-fade-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}

.hint-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}

/* 删除动画：正文散成粒子飘向左下角的画布层 */
:deep(.vortex-canvas) {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 100;
  pointer-events: none;
}

/* 漩涡删除期间阻止交互 */
.editor-content-wrapper.vortex-deleting {
  pointer-events: none;
}
</style>
