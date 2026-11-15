<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useWorkspaceTransfer } from '@/composables/useWorkspaceTransfer'
import type { TransferEntry } from '@/composables/useWorkspaceTransfer'
import type { TransferDirOption } from '@/types/workspace'

const { t } = useI18n()
const ws = useWorkspaceStore()
const { pendingRequest, listDirOptions, commitTransfer, closeTransfer } = useWorkspaceTransfer()

/** 弹窗自身可见性：commitTransfer 成功后会先清空 pendingRequest，我们要留着卡片显示「已搬移」 */
const visible = ref(false)
/** 打开时快照一份条目，pendingRequest 被清掉后列表还能继续显示 */
const entries = ref<TransferEntry[]>([])

const targetWorkspaceId = ref('')
const dirRel = ref('')
const dirOptions = ref<TransferDirOption[]>([{ id: null, rel: '', name: '', depth: 0 }])
const loading = ref(false)
const error = ref('')
const doneCount = ref<number | null>(null)

let doneTimer: number | null = null
/** commitTransfer 成功时会先清空 pendingRequest，用它区分「搬运完成」和「别处关闭」 */
let committing = false

const otherWorkspaces = computed(() => ws.workspaces.filter(w => w.id !== ws.currentId))
const canSubmit = computed(
  () => !!targetWorkspaceId.value && otherWorkspaces.value.length > 0 && !loading.value
)

const ROOT_OPTION: TransferDirOption = { id: null, rel: '', name: '', depth: 0 }

function clearDoneTimer() {
  if (doneTimer !== null) {
    window.clearTimeout(doneTimer)
    doneTimer = null
  }
}

/** 取目标空间的目录列表，失败时至少保留根目录 */
async function loadDirOptions(workspaceId: string) {
  dirOptions.value = [ROOT_OPTION]
  if (!workspaceId) return
  try {
    const options = await listDirOptions(workspaceId)
    dirOptions.value = options.length ? options : [ROOT_OPTION]
  } catch {
    dirOptions.value = [ROOT_OPTION]
  }
  // 目标目录必须仍然存在，否则退回根目录
  if (!dirOptions.value.some(option => option.rel === dirRel.value)) dirRel.value = ''
}

/** 下拉里按目录层级缩进（根目录单独显示「根目录」） */
function dirLabel(option: TransferDirOption): string {
  if (!option.rel) return t('workspace.rootDir')
  return '\u3000'.repeat(Math.max(0, option.depth - 1)) + option.name
}

/** 每次打开都重置本地状态：默认第一个其它空间 + 根目录 + 清空错误 */
watch(
  pendingRequest,
  (request) => {
    if (!request) {
      // immediate 首跑时还没有请求（visible 为 false，直接 return，不会误开弹窗）；
      // 之后是别处清空了请求（比如切换工作空间）：跟着关掉，成功路径由 committing / doneCount 挡住
      if (visible.value && !committing && doneCount.value === null) dismiss()
      return
    }
    clearDoneTimer()
    entries.value = request.entries
    loading.value = false
    error.value = ''
    doneCount.value = null
    dirRel.value = ''
    targetWorkspaceId.value = otherWorkspaces.value[0]?.id ?? ''
    void loadDirOptions(targetWorkspaceId.value)
    visible.value = true
  },
  // immediate：FileTree 被 App.vue 整体卸载后重新挂载时，若已有 pendingRequest 也要能把弹窗补出来
  { immediate: true }
)

async function onTargetChange() {
  dirRel.value = ''
  error.value = ''
  await loadDirOptions(targetWorkspaceId.value)
}

function dismiss() {
  if (loading.value) return
  clearDoneTimer()
  visible.value = false
  doneCount.value = null
  error.value = ''
  closeTransfer()
}

async function submit(mode: 'copy' | 'move') {
  if (!canSubmit.value) return
  const targetId = targetWorkspaceId.value
  const rel = dirRel.value
  error.value = ''
  doneCount.value = null
  loading.value = true
  committing = true
  try {
    const count = await commitTransfer(targetId, rel, mode)
    doneCount.value = count
    clearDoneTimer()
    doneTimer = window.setTimeout(() => {
      doneTimer = null
      doneCount.value = null
      visible.value = false
      closeTransfer()
    }, 1200)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    committing = false
    loading.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!visible.value || e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  dismiss()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  clearDoneTimer()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="wt-mask" @mousedown.self="dismiss" @contextmenu.prevent>
      <div class="wt-card" role="dialog" aria-modal="true">
        <div class="wt-title">{{ $t('workspace.transferTitle') }}</div>

        <div class="wt-entries">
          <div v-for="entry in entries" :key="entry.kind + ':' + entry.id" class="wt-entry">
            <i :class="entry.kind === 'directory' ? 'i-mdi-folder-outline' : 'i-mdi-note-outline'"></i>
            <span class="wt-entry-label">{{ entry.label }}</span>
          </div>
        </div>

        <div class="wt-field">
          <span class="wt-label">{{ $t('workspace.targetSpace') }}</span>
          <select
            v-if="otherWorkspaces.length"
            v-model="targetWorkspaceId"
            class="wt-select"
            :disabled="loading"
            @change="onTargetChange"
          >
            <option v-for="space in otherWorkspaces" :key="space.id" :value="space.id">
              {{ space.name }}
            </option>
          </select>
          <span v-else class="wt-empty">{{ $t('workspace.noOtherSpace') }}</span>
        </div>

        <div class="wt-field">
          <span class="wt-label">{{ $t('workspace.targetDir') }}</span>
          <select v-model="dirRel" class="wt-select" :disabled="loading || !otherWorkspaces.length">
            <option v-for="option in dirOptions" :key="option.rel || '__root__'" :value="option.rel">
              {{ dirLabel(option) }}
            </option>
          </select>
        </div>

        <div v-if="error" class="wt-error">{{ $t('workspace.transferFailed', { error }) }}</div>
        <div v-else-if="doneCount !== null" class="wt-done">
          {{ $t('workspace.transferDone', { count: doneCount }) }}
        </div>

        <div class="wt-actions">
          <button class="wt-btn" :disabled="loading" @click="dismiss">
            {{ $t('workspace.cancel') }}
          </button>
          <button class="wt-btn" :disabled="!canSubmit" @click="submit('copy')">
            <i v-if="loading" class="i-mdi-loading wt-spin"></i>
            <span>{{ $t('workspace.copy') }}</span>
          </button>
          <button class="wt-btn primary" :disabled="!canSubmit" @click="submit('move')">
            <i v-if="loading" class="i-mdi-loading wt-spin"></i>
            <span>{{ $t('workspace.move') }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wt-mask {
  position: fixed;
  inset: 0;
  z-index: 620;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4, 24px);
  background: rgba(0, 0, 0, 0.26);
}

.wt-card {
  width: 380px;
  max-width: 100%;
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: var(--space-3, 16px) 18px 14px;
  border-radius: var(--radius-lg, 14px);
  border: 1px solid var(--color-border);
  background: var(--color-popup-bg, var(--color-surface));
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.08));
  color: var(--color-text);
  user-select: none;
}

.wt-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: var(--space-2, 8px);
}

.wt-entries {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 120px;
  overflow: auto;
  padding: 6px 8px;
  border-radius: var(--radius-md, 10px);
  border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface) 70%, transparent);
}

.wt-entry {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--color-text);
}

.wt-entry i {
  font-size: 14px;
  color: var(--color-text-secondary, var(--color-text));
  flex: none;
}

.wt-entry-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wt-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: var(--space-2, 8px);
}

.wt-label {
  font-size: 12px;
  color: var(--color-text-secondary, var(--color-text));
}

.wt-select {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
  transition: border-color var(--duration-fast, 150ms) var(--ease-out, ease);
}

.wt-select:focus {
  border-color: var(--color-primary);
}

.wt-select:disabled {
  opacity: 0.55;
}

.wt-empty {
  font-size: 12.5px;
  padding: 5px 0;
  color: var(--color-text-secondary, var(--color-text));
}

.wt-error {
  margin-top: var(--space-2, 8px);
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-danger, #ef4444);
  word-break: break-word;
}

.wt-done {
  margin-top: var(--space-2, 8px);
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-success, #22c55e);
}

.wt-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2, 8px);
  margin-top: var(--space-3, 16px);
}

.wt-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 62px;
  height: 28px;
  padding: 0 14px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background var(--duration-fast, 150ms) var(--ease-out, ease),
    border-color var(--duration-fast, 150ms) var(--ease-out, ease), opacity var(--duration-fast, 150ms);
}

.wt-btn:hover:not(:disabled) {
  background: rgba(127, 127, 127, 0.12);
}

.wt-btn.primary {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: #fff;
}

.wt-btn.primary:hover:not(:disabled) {
  background: var(--color-primary-hover, var(--color-primary));
}

.wt-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.wt-spin {
  animation: wt-spin 0.9s linear infinite;
}

@keyframes wt-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
