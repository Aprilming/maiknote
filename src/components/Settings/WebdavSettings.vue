<template>
  <div class="webdav-settings">
    <!-- 服务器 ------------------------------------------------ -->
    <div class="settings-group-title">{{ $t('webdav.groupServer') }}</div>
    <section class="wd-panel">
      <div class="wd-item">
        <div class="wd-head">
          <span class="wd-name">{{ $t('webdav.serverUrl') }}</span>
        </div>
        <input
          class="wd-input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          :value="config.url"
          :placeholder="$t('webdav.serverUrlPlaceholder')"
          @change="onUrlChange"
        />
        <p class="wd-desc">{{ $t('webdav.serverUrlDesc') }}</p>
      </div>

      <div class="wd-item">
        <div class="wd-head">
          <span class="wd-name">{{ $t('webdav.username') }}</span>
        </div>
        <input
          class="wd-input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          :value="config.username"
          @change="onUsernameChange"
        />
      </div>

      <div class="wd-item">
        <div class="wd-head">
          <span class="wd-name">{{ $t('webdav.password') }}</span>
        </div>
        <input
          class="wd-input"
          type="password"
          autocomplete="off"
          :value="password"
          :placeholder="$t('webdav.passwordPlaceholder')"
          @change="onPasswordChange"
        />
        <p class="wd-desc">{{ $t('webdav.passwordDesc') }}</p>
      </div>

      <div class="wd-item wd-item-row">
        <div class="wd-head wd-head-col">
          <span class="wd-name">{{ $t('webdav.insecureTls') }}</span>
          <span class="wd-desc">{{ $t('webdav.insecureTlsDesc') }}</span>
        </div>
        <button
          class="wd-switch"
          :class="{ on: config.insecureTls }"
          type="button"
          @click="onInsecureToggle"
        >
          <span class="wd-knob" />
        </button>
      </div>

      <div class="wd-item wd-item-row">
        <div class="wd-test-line">
          <button class="wd-btn" type="button" :disabled="store.testing" @click="onTest">
            <i v-if="store.testing" class="i-mdi-loading animate-spin" />
            {{ store.testing ? $t('webdav.testing') : $t('webdav.test') }}
          </button>
          <span class="wd-status" :class="{ bad: testFailed }">{{ store.testResult }}</span>
        </div>
      </div>
    </section>

    <!-- 空间 ------------------------------------------------ -->
    <div class="settings-group-title">{{ $t('webdav.groupSpaces') }}</div>
    <section class="wd-panel">
      <div class="wd-item wd-hint-row">
        <p class="wd-desc">{{ $t('webdav.spacesDesc') }}</p>
        <button
          class="wd-btn wd-btn-sm"
          type="button"
          :disabled="sync.running.value || store.enabledCount === 0"
          @click="onSyncAll"
        >
          {{ $t('webdav.syncAll') }}
        </button>
        <button
          v-if="sync.running.value"
          class="wd-btn wd-btn-sm wd-btn-danger"
          type="button"
          :disabled="sync.stopping.value"
          @click="onStop"
        >
          {{ sync.stopping.value ? $t('webdav.stopping') : $t('webdav.stop') }}
        </button>
      </div>
    </section>

    <!-- 本机文件夹 -->
    <div class="settings-group-title wd-subtitle">{{ $t('webdav.localSpaces') }}</div>
    <section class="wd-panel">
      <p class="wd-section-desc">{{ $t('webdav.localSpacesDesc') }}</p>

      <div v-for="ws in workspaceStore.workspaces" :key="ws.id" class="wd-item wd-space">
        <div class="wd-head">
          <span class="wd-name">{{ ws.name }}</span>
          <span class="wd-badge">
            {{ ws.kind === 'icloud' ? $t('webdav.kindIcloud') : $t('webdav.kindCustom') }}
          </span>
          <button class="wd-btn wd-btn-xs" type="button" @click="openPwd(ws)">
            <i class="i-mdi-lock-outline" />{{ hasPassword(ws) ? $t('webdav.changePassword') : $t('webdav.setPassword') }}
          </button>
          <span class="wd-spacer" />
          <span v-if="summaryOf(ws.id)" class="wd-summary">{{ summaryOf(ws.id) }}</span>
          <button
            class="wd-switch"
            :class="{ on: store.optionOf(ws.id).enabled }"
            type="button"
            @click="onToggle(ws)"
          >
            <span class="wd-knob" />
          </button>
        </div>

        <div class="wd-dir-line">
          <span class="wd-sub">{{ $t('webdav.remoteDir') }}</span>
          <input
            class="wd-input wd-input-sm"
            type="text"
            spellcheck="false"
            :value="store.optionOf(ws.id).remoteDir || store.defaultRemoteDir(ws)"
            :disabled="!store.optionOf(ws.id).enabled"
            @change="onRemoteDirChange(ws, $event)"
          />
          <button
            class="wd-btn wd-btn-sm"
            type="button"
            :disabled="!store.optionOf(ws.id).enabled || sync.running.value"
            @click="onSyncOne(ws)"
          >
            {{ sync.syncingSpaceId.value === ws.id ? $t('webdav.syncing') : $t('webdav.syncNow') }}
          </button>
        </div>

        <div class="wd-force-line">
          <button
            class="wd-btn wd-btn-xs"
            type="button"
            :disabled="!store.optionOf(ws.id).enabled || sync.running.value"
            @click="askForce(ws, 'push')"
          >
            <i class="i-mdi-cloud-upload-outline" />{{ $t('webdav.forcePush') }}
          </button>
          <button
            class="wd-btn wd-btn-xs"
            type="button"
            :disabled="!store.optionOf(ws.id).enabled || sync.running.value"
            @click="askForce(ws, 'pull')"
          >
            <i class="i-mdi-cloud-download-outline" />{{ $t('webdav.forcePull') }}
          </button>
          <button
            class="wd-btn wd-btn-xs wd-btn-danger"
            type="button"
            :disabled="!store.optionOf(ws.id).enabled || sync.running.value"
            @click="askForce(ws, 'wipe')"
          >
            <i class="i-mdi-delete-sweep-outline" />{{ $t('webdav.forceWipe') }}
          </button>
        </div>

        <div v-if="pendingForce && pendingForce.spaceId === ws.id" class="wd-confirm">
          <span class="wd-confirm-text">{{ confirmText(ws, pendingForce.mode) }}</span>
          <span class="wd-spacer" />
          <button class="wd-btn wd-btn-xs wd-btn-danger" type="button" @click="confirmForce(ws)">
            {{ $t('webdav.confirmDo') }}
          </button>
          <button class="wd-btn wd-btn-xs" type="button" @click="cancelForce">
            {{ $t('webdav.confirmCancel') }}
          </button>
        </div>

        <div v-if="isBusy(ws.id)" class="wd-progress">
          <div class="wd-progress-track">
            <span class="wd-progress-fill" :style="{ width: progressPercent(ws.id) }" />
          </div>
          <div class="wd-progress-foot">
            <span class="wd-progress-text">{{ progressText(ws.id) }}</span>
            <span class="wd-spacer" />
            <button
              class="wd-btn wd-btn-xs wd-btn-danger"
              type="button"
              :disabled="sync.stopping.value"
              @click="onStop"
            >
              {{ sync.stopping.value ? $t('webdav.stopping') : $t('webdav.stop') }}
            </button>
          </div>
        </div>

        <!-- 设置 / 修改这个空间的密码 -->
        <div v-if="editingPwd === ws.id" class="wd-join-form">
          <div class="wd-join-title">{{ hasPassword(ws) ? $t('webdav.changePassword') : $t('webdav.setPassword') }}</div>
          <template v-if="hasPassword(ws)">
            <label class="wd-field-label">{{ $t('webdav.currentPassword') }}</label>
            <input v-model="pwdCurrent" class="wd-input wd-input-sm" type="password" autocomplete="off" spellcheck="false" />
          </template>
          <label class="wd-field-label">{{ $t('webdav.newPassword') }}</label>
          <input v-model="pwdNew" class="wd-input wd-input-sm" type="password" autocomplete="off" spellcheck="false" />
          <p v-if="pwdMsg" class="wd-error">{{ pwdMsg }}</p>
          <div class="wd-join-actions">
            <button class="wd-btn wd-btn-sm" type="button" :disabled="pwdBusy" @click="cancelPwd">
              {{ $t('webdav.cancel') }}
            </button>
            <button class="wd-btn wd-btn-sm wd-btn-primary" type="button" :disabled="pwdBusy" @click="confirmPwd(ws)">
              {{ pwdBusy ? $t('webdav.saving') : $t('webdav.save') }}
            </button>
          </div>
        </div>

        <div class="wd-space-foot">
          <span class="wd-sub">{{ lastSyncText(ws.id) }}</span>
          <span v-if="store.optionOf(ws.id).lastError" class="wd-error">
            {{ store.optionOf(ws.id).lastError }}
          </span>
        </div>
      </div>
    </section>

    <!-- 加入云端空间 -->
    <div class="settings-group-title wd-subtitle">{{ $t('webdav.joinCloud') }}</div>
    <section class="wd-panel">
      <p class="wd-section-desc">{{ $t('webdav.joinCloudDesc') }}</p>
      <!-- 扫描云端空间并加入：B 端不用手动建同名文件夹 -->
      <div class="wd-item wd-cloud">
        <div class="wd-head">
          <span class="wd-sub">{{ $t('webdav.cloudSpaces') }}</span>
          <span class="wd-spacer" />
          <button class="wd-btn wd-btn-sm" type="button" :disabled="!store.hasServer || scanning" @click="onScanCloud">
            {{ scanning ? $t('webdav.scanning') : $t('webdav.scanCloud') }}
          </button>
        </div>
        <p v-if="scanMsg" class="wd-hint-text">{{ scanMsg }}</p>

        <div v-for="sp in cloudSpaces" :key="sp.remoteDir" class="wd-cloud-row">
          <div class="wd-cloud-meta">
            <span class="wd-name">{{ sp.name }}</span>
            <span class="wd-badge" :class="{ locked: sp.locked }">
              {{ !sp.initialized ? $t('webdav.uninitialized') : (sp.locked ? $t('webdav.locked') : $t('webdav.unlocked')) }}
            </span>
            <span class="wd-sub">{{ $t('webdav.cloudNotes', { n: sp.noteCount }) }}</span>
            <span v-if="rotationChanged(sp)" class="wd-rotate-hint">{{ $t('webdav.rotationChanged') }}</span>
          </div>
          <button class="wd-btn wd-btn-sm" type="button" :disabled="joiningBusy" @click="openJoin(sp)">
            {{ $t('webdav.join') }}
          </button>
        </div>

        <!-- 加入表单：输空间密码 + 选本地父目录，本地文件夹自动建 -->
        <div v-if="joining" class="wd-join-form">
          <div class="wd-join-title">{{ $t('webdav.joinTitle', { name: joining.name }) }}</div>
          <label class="wd-field-label">{{ $t('webdav.spacePassword') }}</label>
          <input
            v-model="joinPassword"
            class="wd-input wd-input-sm"
            type="password"
            autocomplete="off"
            spellcheck="false"
            :placeholder="$t('webdav.spacePasswordPlaceholder')"
          />
          <label class="wd-field-label">{{ $t('webdav.localParent') }}</label>
          <input v-model="joinParent" class="wd-input wd-input-sm" type="text" spellcheck="false" />
          <p class="wd-hint-text">{{ $t('webdav.localParentDesc') }}</p>
          <p v-if="joinMsg" class="wd-error">{{ joinMsg }}</p>
          <div class="wd-join-actions">
            <button class="wd-btn wd-btn-sm" type="button" :disabled="joiningBusy" @click="cancelJoin">
              {{ $t('webdav.cancel') }}
            </button>
            <button class="wd-btn wd-btn-sm wd-btn-primary" type="button" :disabled="joiningBusy" @click="confirmJoin">
              {{ joiningBusy ? $t('webdav.joining') : $t('webdav.joinConfirm') }}
            </button>
          </div>
        </div>
      </div>

    </section>

    <!-- 规则 ------------------------------------------------ -->
    <div class="settings-group-title">{{ $t('webdav.groupPolicy') }}</div>
    <section class="wd-panel wd-policy">
      <p class="wd-desc"><i class="i-mdi-source-branch" />{{ $t('webdav.policyConflict') }}</p>
      <p class="wd-desc"><i class="i-mdi-delete-outline" />{{ $t('webdav.policyDelete') }}</p>
      <p class="wd-desc"><i class="i-mdi-content-save-outline" />{{ $t('webdav.policySave') }}</p>
      <p class="wd-desc"><i class="i-mdi-timer-outline" />{{ $t('webdav.policyAuto') }}</p>
      <p class="wd-desc"><i class="i-mdi-swap-horizontal" />{{ $t('webdav.policyForce') }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Workspace } from '@/stores/workspaceStore'
import { useWebdavStore } from '@/stores/webdavStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useWebdavSync } from '@/composables/useWebdavSync'
import type { WebdavForceMode, CloudSpaceInfo } from '@/types/webdav'

const { t, locale } = useI18n()
const store = useWebdavStore()
const workspaceStore = useWorkspaceStore()
const sync = useWebdavSync()

const config = computed(() => store.config)
const password = computed(() => store.password)
const testFailed = computed(() => !!store.testResult && !store.testResult.includes(t('webdav.testOk')))

onMounted(() => {
  void store.initialize()
  void sync.initProgressListener()
})

function valueOf(event: Event): string {
  return (event.target as HTMLInputElement).value
}

async function onUrlChange(event: Event) {
  await store.setServer({ url: valueOf(event).trim() })
}

async function onUsernameChange(event: Event) {
  await store.setServer({ username: valueOf(event).trim() })
}

async function onPasswordChange(event: Event) {
  await store.savePassword(valueOf(event))
}

async function onInsecureToggle() {
  await store.setServer({ insecureTls: !config.value.insecureTls })
}

async function onTest() {
  try {
    await store.testConnection()
  } catch {
    // 错误信息已经在 store.testResult 里
  }
}

async function onToggle(ws: Workspace) {
  await store.setEnabled(ws, !store.optionOf(ws.id).enabled)
}

async function onRemoteDirChange(ws: Workspace, event: Event) {
  const raw = valueOf(event).trim()
  await store.setRemoteDir(ws.id, raw || store.defaultRemoteDir(ws))
}

async function onSyncOne(ws: Workspace) {
  await sync.syncSpace(ws, { skipDownload: sync.currentNoteRelPath() })
}

async function onSyncAll() {
  await sync.syncAll()
}

/** 停止：后端正在传的那个文件传完就会收尾，界面上先显示「正在停止」 */
async function onStop() {
  await sync.stopSync()
}

/** 强制动作要二次确认：这三个按钮都是不可逆方向的操作 */
const pendingForce = ref<{ spaceId: string; mode: WebdavForceMode } | null>(null)

function askForce(ws: Workspace, mode: WebdavForceMode) {
  pendingForce.value = { spaceId: ws.id, mode }
}

function cancelForce() {
  pendingForce.value = null
}

function confirmText(ws: Workspace, mode: WebdavForceMode): string {
  const dir = store.optionOf(ws.id).remoteDir || store.defaultRemoteDir(ws)
  if (mode === 'push') return t('webdav.confirmPush', { dir })
  if (mode === 'pull') return t('webdav.confirmPull', { dir })
  return t('webdav.confirmWipe', { dir })
}

async function confirmForce(ws: Workspace) {
  const pending = pendingForce.value
  if (!pending || pending.spaceId !== ws.id) return
  pendingForce.value = null
  await sync.forceSpace(ws, pending.mode)
}

/** 正在同步某个空间：有进度事件且还没 done */
function isBusy(workspaceId: string): boolean {
  // 正在跑这个空间就显示：后端最后一条事件可能是 done，但后面还有收尾动作
  if (sync.running.value && sync.syncingSpaceId.value === workspaceId) return true
  const p = sync.progress.value[workspaceId]
  return !!p && p.phase !== 'done'
}

function progressPercent(workspaceId: string): string {
  const p = sync.progress.value[workspaceId]
  if (!p) return '8%'
  if (!p.total) return '12%'
  const ratio = Math.min(100, Math.round((p.done / p.total) * 100))
  return (ratio < 6 ? 6 : ratio) + '%'
}

/** 阶段文案：清点本地、对比云端、传文件是三件事，别用一句话把整段网络往返都盖住 */
function phaseText(phase: string): string {
  if (phase === 'remote') return t('webdav.phaseRemote')
  if (phase === 'manifest') return t('webdav.phaseManifest')
  if (phase === 'scan') return t('webdav.phaseScan')
  return t('webdav.phaseWrap')
}

function progressText(workspaceId: string): string {
  const p = sync.progress.value[workspaceId]
  if (!p) return t('webdav.phaseScan')
  if (p.phase === 'transfer' && p.total) {
    const head = t('webdav.progress', { done: p.done, total: p.total })
    return p.detail ? head + ' · ' + p.detail : head
  }
  return phaseText(p.phase)
}

function summaryOf(workspaceId: string): string {
  return sync.summaries.value[workspaceId] ?? ''
}

function lastSyncText(workspaceId: string): string {
  const stamp = store.optionOf(workspaceId).lastSyncAt
  if (!stamp) return t('webdav.neverSynced')
  const when = new Date(stamp * 1000).toLocaleString(locale.value)
  return t('webdav.lastSync', { time: when })
}

// ===== 云端空间：扫描 / 加入 / 每空间密码 =====
const cloudSpaces = ref<CloudSpaceInfo[]>([])
const scanning = ref(false)
const scanMsg = ref('')
/** 正在加入的云端空间；有值就展开加入表单 */
const joining = ref<CloudSpaceInfo | null>(null)
const joinPassword = ref('')
const joinParent = ref('~/Documents/MaikNote')
const joiningBusy = ref(false)
const joinMsg = ref('')
/** 正在设密码的本地空间 */
const editingPwd = ref<string | null>(null)
const pwdCurrent = ref('')
const pwdNew = ref('')
const pwdBusy = ref(false)
const pwdMsg = ref('')

async function onScanCloud() {
  scanning.value = true
  scanMsg.value = ''
  cloudSpaces.value = []
  try {
    cloudSpaces.value = await store.scanSpaces()
    if (cloudSpaces.value.length === 0) scanMsg.value = t('webdav.scanEmpty')
  } catch (e) {
    scanMsg.value = t('webdav.scanFail') + '：' + (e instanceof Error ? e.message : String(e))
  } finally {
    scanning.value = false
  }
}

function openJoin(sp: CloudSpaceInfo) {
  joining.value = sp
  joinPassword.value = ''
  joinMsg.value = ''
}

function cancelJoin() {
  joining.value = null
}

function rotationChanged(sp: CloudSpaceInfo): boolean {
  return workspaceStore.workspaces.some(ws => {
    const opt = store.optionOf(ws.id)
    return !!opt.spaceId && opt.spaceId === sp.spaceId && opt.rotation !== sp.rotation
  })
}

/** 加入：校验密码 → 自动建本地文件夹 → 建工作空间 → 绑定 → 首次拉取 */
async function confirmJoin() {
  const sp = joining.value
  if (!sp) return
  if (!joinPassword.value) {
    joinMsg.value = t('webdav.passwordEmpty')
    return
  }
  joiningBusy.value = true
  joinMsg.value = ''
  try {
    const joined = await store.joinSpace(sp.remoteDir, joinPassword.value)
    const localPath = await store.prepareLocalDir(joinParent.value.trim(), joined.name)
    const ws = await workspaceStore.addFromPath(localPath)
    store.setOption(ws.id, {
      enabled: true,
      remoteDir: joined.remoteDir,
      spaceId: joined.spaceId,
      rotation: joined.rotation,
    })
    await store.persist()
    joining.value = null
    joinMsg.value = ''
    await onScanCloud()
    await sync.syncSpace(ws, { skipDownload: sync.currentNoteRelPath() })
  } catch (e) {
    joinMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    joiningBusy.value = false
  }
}

function openPwd(ws: Workspace) {
  editingPwd.value = ws.id
  pwdCurrent.value = ''
  pwdNew.value = ''
  pwdMsg.value = ''
}

function cancelPwd() {
  editingPwd.value = null
}

async function confirmPwd(ws: Workspace) {
  if (!pwdNew.value) {
    pwdMsg.value = t('webdav.passwordEmpty')
    return
  }
  pwdBusy.value = true
  pwdMsg.value = ''
  try {
    const opt = store.optionOf(ws.id)
    await store.setSpacePassword(ws, pwdNew.value, opt.spaceId ? pwdCurrent.value : '')
    editingPwd.value = null
    pwdMsg.value = ''
  } catch (e) {
    pwdMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    pwdBusy.value = false
  }
}

function hasPassword(ws: Workspace): boolean {
  return !!store.optionOf(ws.id).spaceId
}
</script>

<style scoped>
.webdav-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--st-text-dim, #6b7280);
  padding: 0 4px 6px;
  letter-spacing: 0.02em;
}

.wd-panel {
  border-radius: 14px;
  background: var(--st-panel, rgba(255, 255, 255, 0.66));
  border: 1px solid var(--st-panel-border, rgba(0, 0, 0, 0.07));
  box-shadow: var(--st-shadow, 0 1px 2px rgba(0, 0, 0, 0.05));
  overflow: hidden;
}

.wd-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
}

.wd-item + .wd-item {
  border-top: 1px solid var(--st-row-line, rgba(0, 0, 0, 0.06));
}

.wd-item-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.wd-hint-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.wd-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wd-head-col {
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}

.wd-name {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--st-text, #1f2937);
}

.wd-desc {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  color: var(--st-text-soft, #8b93a1);
  flex: 1;
}

.wd-sub {
  font-size: 11px;
  color: var(--st-text-dim, #6b7280);
}

.wd-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--st-sunken, rgba(0, 0, 0, 0.05));
  color: var(--st-text-soft, #8b93a1);
}

.wd-spacer {
  flex: 1;
}

.wd-input {
  width: 100%;
  font-size: 12px;
  padding: 6px 9px;
  border-radius: 8px;
  color: var(--st-text, #1f2937);
  background: var(--st-sunken, rgba(0, 0, 0, 0.04));
  border: 1px solid var(--st-panel-border, rgba(0, 0, 0, 0.08));
  outline: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.wd-input:focus {
  border-color: var(--st-accent, #3b82f6);
  background: var(--st-panel, rgba(255, 255, 255, 0.66));
}

.wd-input:disabled {
  opacity: 0.5;
}

.wd-input-sm {
  flex: 1;
  min-width: 0;
}

.wd-dir-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wd-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wd-progress-track {
  flex: 1;
  height: 4px;
  border-radius: 99px;
  overflow: hidden;
  background: var(--st-sunken, rgba(0, 0, 0, 0.08));
}

.wd-progress-fill {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: var(--st-accent, #3b82f6);
  transition: width 0.25s ease;
}

.wd-progress-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wd-progress-text {
  flex: none;
  max-width: 62%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--st-text-soft, #8b93a1);
}

.wd-space-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.wd-error {
  font-size: 11px;
  color: #e0574a;
  line-height: 1.5;
}

.wd-summary {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  padding: 1px 7px;
  border-radius: 7px;
  color: var(--st-text-dim, #6b7280);
  background: var(--st-sunken, rgba(0, 0, 0, 0.05));
}

.wd-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  padding: 5px 11px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--st-text, #1f2937);
  background: var(--st-sunken, rgba(0, 0, 0, 0.05));
  border: 1px solid var(--st-panel-border, rgba(0, 0, 0, 0.08));
}

.wd-btn:hover:not(:disabled) {
  background: var(--st-panel, rgba(0, 0, 0, 0.09));
}

.wd-btn:disabled {
  color: var(--st-text-dim, #9ca3af);
  background: var(--st-sunken, rgba(0, 0, 0, 0.05));
  border-color: var(--st-panel-border, rgba(0, 0, 0, 0.08));
  cursor: default;
}

.wd-btn-sm {
  font-size: 11.5px;
  padding: 4px 9px;
  white-space: nowrap;
}

.wd-force-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wd-btn-xs {
  font-size: 11px;
  padding: 3px 8px;
  white-space: nowrap;
}

.wd-btn-danger {
  color: var(--st-danger, #b42318);
  border-color: var(--st-danger-border, rgba(180, 35, 24, 0.28));
}

.wd-btn-danger:hover:not(:disabled) {
  background: var(--st-danger-bg, rgba(180, 35, 24, 0.08));
}

.wd-confirm {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border-radius: 9px;
  background: var(--st-danger-bg, rgba(180, 35, 24, 0.07));
  border: 1px solid var(--st-danger-border, rgba(180, 35, 24, 0.22));
}

.wd-confirm-text {
  font-size: 11px;
  line-height: 1.45;
  color: var(--st-text, #1f2937);
}

.wd-test-line {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  flex-wrap: wrap;
}

.wd-status {
  font-size: 11px;
  color: #2f9e63;
  line-height: 1.5;
}

.wd-status.bad {
  color: #e0574a;
}

.wd-switch {
  position: relative;
  flex: none;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  background: var(--st-sunken, rgba(0, 0, 0, 0.16));
  transition: background 0.18s ease;
}

.wd-switch.on {
  background: var(--st-accent, #3b82f6);
}

.wd-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: transform 0.18s ease;
}

.wd-switch.on .wd-knob {
  transform: translateX(14px);
}

.wd-policy {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wd-policy .wd-desc {
  display: flex;
  gap: 7px;
  align-items: flex-start;
}

.wd-policy .wd-desc i {
  font-size: 13px;
  margin-top: 1px;
  color: var(--st-text-soft, #8b93a1);
  flex: none;
}

.animate-spin {
  animation: wd-spin 1s linear infinite;
}

@keyframes wd-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 三个分区的子标题与说明 */
.settings-group-title.wd-subtitle {
  margin-top: 14px;
}
.wd-section-desc {
  font-size: 11px;
  line-height: 1.6;
  color: var(--st-text-dim, #6b7280);
  margin: 0;
  padding: 2px 4px 4px;
}

/* 云端空间发现 / 加入 */
.wd-cloud {
  background: var(--st-sunken, rgba(0, 0, 0, 0.03));
}
.wd-cloud-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 4px;
}
.wd-cloud-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  flex-wrap: wrap;
}
.wd-badge.locked {
  background: rgba(224, 87, 74, 0.14);
  color: #c0453a;
}
.wd-rotate-hint {
  font-size: 10px;
  color: #c98a2b;
}
.wd-join-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding: 10px;
  border-radius: 10px;
  background: var(--st-panel, rgba(255, 255, 255, 0.66));
  border: 1px solid var(--st-panel-border, rgba(0, 0, 0, 0.07));
}
.wd-join-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--st-text, #1f2937);
  margin-bottom: 2px;
}
.wd-field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--st-text-dim, #6b7280);
}
.wd-hint-text {
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--st-text-soft, #8b93a1);
  margin: 0;
}
.wd-join-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.wd-join-actions .wd-btn {
  flex: 0 0 auto;
}
.wd-btn-primary {
  background: var(--st-accent, #3b82f6);
  color: #fff;
  border-color: transparent;
}
.wd-btn-primary:disabled {
  color: #e6f0ff;
  background: #8fb8f5;
  border-color: transparent;
}
</style>
