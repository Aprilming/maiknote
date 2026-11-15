<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore, type Workspace } from '@/stores/workspaceStore'
import { useWorkspaceSwitch } from '@/composables/useWorkspaceSwitch'
import { confirmAction } from '@/composables/useConfirm'

const { t } = useI18n()
const ws = useWorkspaceStore()
const { switchWorkspace, addWorkspace, renameWorkspace, removeWorkspace, displayNameOf } = useWorkspaceSwitch()

const rootEl = ref<HTMLElement | null>(null)
const open = ref(false)
/** 新增流程里系统文件夹选择器还开着的时候也算忙，避免重复点 */
const adding = ref(false)

const renamingId = ref<string | null>(null)
const renameValue = ref('')
let renameInputEl: HTMLInputElement | null = null

function setRenameInput(el: unknown) {
  renameInputEl = el as HTMLInputElement | null
}

/** 点卡片外侧：mousedown 阶段就关，免得先触发输入框 blur 再提交改名 */
function onOutsidePointer(event: MouseEvent) {
  const target = event.target as Node | null
  if (rootEl.value && target && rootEl.value.contains(target)) return
  close()
}

/** 卡片打开时挂 Esc；改名输入框自己 stop 掉了，Esc 在输入框里只取消改名 */
function onWindowKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  close()
}

function openCard() {
  if (open.value) return
  open.value = true
  window.addEventListener('keydown', onWindowKeydown)
  document.addEventListener('mousedown', onOutsidePointer, true)
}

function close() {
  if (!open.value) return
  open.value = false
  renamingId.value = null
  renameValue.value = ''
  window.removeEventListener('keydown', onWindowKeydown)
  document.removeEventListener('mousedown', onOutsidePointer, true)
}

function toggleCard() {
  if (ws.switching || adding.value) return
  if (open.value) close()
  else openCard()
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  document.removeEventListener('mousedown', onOutsidePointer, true)
})

// ---------- 切换 ----------

async function selectWorkspace(id: string) {
  if (id === ws.currentId) {
    close()
    return
  }
  close()
  await switchWorkspace(id)
}

// ---------- 重命名 ----------

async function startRename(target: Workspace) {
  if (target.kind !== 'custom') return
  renamingId.value = target.id
  renameValue.value = target.name
  await nextTick()
  renameInputEl?.focus()
  renameInputEl?.select()
}

/** 空名字等于取消：不调用 renameWorkspace */
async function commitRename() {
  const id = renamingId.value
  if (!id) return
  const name = renameValue.value.trim()
  renamingId.value = null
  renameValue.value = ''
  if (!name) return
  await renameWorkspace(id, name)
}

function cancelRename() {
  renamingId.value = null
  renameValue.value = ''
}

// ---------- 删除 ----------

async function removeSpace(target: Workspace) {
  if (target.kind !== 'custom') return
  const ok = await confirmAction({
    title: t('workspace.removeTitle'),
    message: t('workspace.removeMessage'),
    confirmText: t('workspace.remove'),
    danger: true,
  })
  if (!ok) return
  close()
  await removeWorkspace(target.id)
}

// ---------- 新增 ----------

async function addSpace() {
  if (adding.value || ws.switching) return
  adding.value = true
  try {
    await addWorkspace()
  } finally {
    adding.value = false
    close()
  }
}
</script>

<template>
  <div ref="rootEl" class="ws-switcher">
    <button
      class="ws-trigger"
      type="button"
      :class="{ 'is-busy': ws.switching || adding }"
      :disabled="ws.switching || adding"
      :title="displayNameOf(ws.current)"
      @click="toggleCard"
    >
      <span class="ws-trigger-name">{{ displayNameOf(ws.current) }}</span>
      <i class="i-mdi-chevron-down ws-trigger-arrow"></i>
    </button>

    <div v-if="open" class="ws-card">
      <div class="ws-head">{{ t('workspace.label') }}</div>

      <div class="ws-list">
        <div v-for="item in ws.workspaces" :key="item.id" class="ws-item">
          <input
            v-if="renamingId === item.id"
            :ref="setRenameInput"
            v-model="renameValue"
            class="ws-rename"
            type="text"
            :placeholder="t('workspace.renamePlaceholder')"
            @click.stop
            @keydown.enter.stop="commitRename"
            @keydown.esc.stop="cancelRename"
            @blur="commitRename"
          />
          <div
            v-else
            class="ws-row"
            :class="{ 'is-current': item.id === ws.currentId }"
            role="button"
            tabindex="0"
            @click="selectWorkspace(item.id)"
            @keydown.enter="selectWorkspace(item.id)"
          >
            <i class="ws-check" :class="item.id === ws.currentId ? 'i-mdi-check' : ''"></i>
            <span class="ws-name" :title="displayNameOf(item)">{{ displayNameOf(item) }}</span>
            <span v-if="item.kind === 'custom'" class="ws-actions" @click.stop>
              <button class="ws-action" type="button" :title="t('workspace.rename')" @click.stop="startRename(item)">
                <i class="i-mdi-pencil-outline"></i>
              </button>
              <button
                class="ws-action danger"
                type="button"
                :title="t('workspace.remove')"
                @click.stop="removeSpace(item)"
              >
                <i class="i-mdi-trash-can-outline"></i>
              </button>
            </span>
          </div>
        </div>
      </div>

      <button class="ws-add" type="button" :disabled="adding || ws.switching" @click="addSpace">
        <i class="i-mdi-plus"></i>
        <span class="ws-add-text">{{ t('workspace.add') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ws-switcher {
  position: relative;
  flex: 1;
  min-width: 0;
}

/* 触发按钮：当前空间名 + 下拉箭头，单行省略 */
.ws-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  min-width: 0;
  padding: 2px var(--space-1) 2px 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-align: left;
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out);
}

.ws-trigger:hover {
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
}

.ws-trigger.is-busy {
  opacity: 0.5;
  pointer-events: none;
}

.ws-trigger-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ws-trigger-arrow {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--color-text-secondary);
}

/* 下拉卡片 */
.ws-card {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 300;
  width: 220px;
  padding: var(--space-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.ws-head {
  padding: var(--space-1) var(--space-2);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}

.ws-list {
  display: flex;
  flex-direction: column;
  max-height: 260px;
  overflow-y: auto;
}

.ws-item {
  display: block;
}

.ws-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 28px;
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: 13px;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out);
}

.ws-row:hover {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

.ws-row.is-current {
  color: var(--color-primary);
}

.ws-check {
  flex-shrink: 0;
  width: 14px;
  font-size: 14px;
  color: var(--color-primary);
}

.ws-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 行内小图标按钮：hover 才出现 */
.ws-actions {
  display: none;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.ws-row:hover .ws-actions {
  display: flex;
}

.ws-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.ws-action:hover {
  background: color-mix(in srgb, var(--color-text) 10%, transparent);
  color: var(--color-text);
}

.ws-action.danger:hover {
  color: #e5484d;
}

.ws-rename {
  width: 100%;
  height: 28px;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-surface) 70%, #fff);
  color: var(--color-text);
  font-size: 13px;
  outline: none;
}

.ws-add {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 28px;
  margin-top: var(--space-1);
  padding: 0 var(--space-1);
  border: none;
  border-top: 1px solid var(--color-border);
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.ws-add:hover {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
}

.ws-add:disabled {
  opacity: 0.5;
  pointer-events: none;
}

.ws-add-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
