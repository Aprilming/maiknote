<script setup lang="ts">
/**
 * 隐私与承诺：设置页「关于」、隐私说明弹窗外、首次启动欢迎页三处共用同一份文案与样式。
 * 内容只在这里维护一次，改一处三处同时生效。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { openUrl } from '@tauri-apps/plugin-opener'

withDefaults(
  defineProps<{
    /** 是否显示末尾的作者行 */
    showAuthor?: boolean
    /** 是否显示末尾的致谢名单（设置 → 关于、首次引导、隐私弹窗共用一份） */
    showThanks?: boolean
    /** 宽松排版（弹窗 / 欢迎页里字号大一点） */
    loose?: boolean
  }>(),
  { showAuthor: true, showThanks: true, loose: false },
)

const { t } = useI18n()

const pledgeKeys = [
  'settings.privacyLocal',
  'settings.privacyAi',
  'settings.privacyHarm',
  'settings.privacyPay',
  'settings.privacyEdition',
  'settings.privacyExit',
] as const

const authorEmail = '7w0v0w7@gmail.com'
const authorHome = 'https://www.91kfc.vip/'
const copied = ref(false)
let copiedTimer: number | undefined

async function copyEmail() {
  try {
    await navigator.clipboard.writeText(authorEmail)
    copied.value = true
    if (copiedTimer) window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => {
      copied.value = false
    }, 1600)
  } catch {
    // 剪贴板不可用就算了，邮箱本身在界面上直接可读
  }
}

function openMail() {
  void openUrl(`mailto:${authorEmail}`).catch(() => {})
}

function openHome() {
  void openUrl(authorHome).catch(() => {})
}

/** 致谢名单：点名字直接开 GitHub 主页 */
const thanksUsers = ['cat-clever', 'kinzun', 'zhanggang807'] as const

function openProfile(name: string) {
  void openUrl(`https://github.com/${name}`).catch(() => {})
}
</script>

<template>
  <div class="pp" :class="{ 'pp-loose': loose }">
    <p class="pp-intro">{{ t('settings.privacyIntro') }}</p>

    <ul class="pp-list">
      <li v-for="key in pledgeKeys" :key="key">
        <i class="i-mdi-check-bold"></i>
        <span>{{ t(key) }}</span>
      </li>
    </ul>

    <div v-if="showAuthor" class="pp-author">
      <span class="pp-author-label">{{ t('settings.author') }}</span>
      <span class="pp-author-name">{{ t('settings.authorName') }}</span>
      <span class="pp-dot">·</span>
      <a class="pp-mail" :href="`mailto:${authorEmail}`" @click.prevent="openMail">{{ authorEmail }}</a>
      <button class="pp-copy" type="button" @click="copyEmail">
        <i :class="copied ? 'i-mdi-check' : 'i-mdi-content-copy'"></i>
        <span>{{ copied ? t('settings.authorEmailCopied') : t('settings.authorEmailCopy') }}</span>
      </button>
      <a class="pp-home" :href="authorHome" target="_blank" rel="noreferrer" @click.prevent="openHome">
        <i class="i-mdi-home-variant-outline"></i>
        <span>{{ t('settings.authorHome') }}</span>
      </a>
    </div>

    <div v-if="showThanks" class="pp-thanks">
      <i class="i-mdi-heart-outline"></i>
      <span class="pp-thanks-text">
        {{ t('welcome.thanksLead') }}
        <template v-for="(name, index) in thanksUsers" :key="name">
          <span v-if="index > 0" class="pp-thanks-sep">{{ t('welcome.thanksSep') }}</span>
          <a
            class="pp-thanks-link"
            :href="`https://github.com/${name}`"
            @click.prevent="openProfile(name)"
            >{{ name }}</a
          >
        </template>
        {{ t('welcome.thanksTail') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.pp {
  /* 自成一套令牌，肉眼在设置页（浅/深）与弹窗、欢迎页里表现一致 */
  --pp-text: var(--st-text, var(--color-text, #1d1d1f));
  --pp-dim: var(--st-text-dim, var(--color-text-secondary, rgba(60, 60, 67, 0.62)));
  --pp-accent: var(--st-accent, var(--color-primary, #007aff));
  --pp-success: var(--st-success, var(--color-success, #34c759));
  --pp-line: var(--st-row-line, var(--color-border, rgba(0, 0, 0, 0.07)));
  --pp-sunken: var(--st-sunken, rgba(120, 120, 128, 0.12));
  --pp-hover: var(--st-hover, var(--color-popup-hover, rgba(120, 120, 128, 0.16)));
  --pp-border: var(--st-panel-border, var(--color-border, rgba(0, 0, 0, 0.055)));

  --pp-size: 12px;
  --pp-line-height: 1.65;
  --pp-gap: 8px;
}

.pp-loose {
  --pp-size: 13px;
  --pp-line-height: 1.8;
  --pp-gap: 11px;
}

.pp-intro {
  margin: 0 0 10px;
  font-size: calc(var(--pp-size) + 0.5px);
  line-height: var(--pp-line-height);
  color: var(--pp-dim);
}

.pp-list {
  display: flex;
  flex-direction: column;
  gap: var(--pp-gap);
  margin: 0;
  padding: 0;
  list-style: none;
}

.pp-list li {
  display: flex;
  gap: 8px;
  font-size: var(--pp-size);
  line-height: var(--pp-line-height);
  color: var(--pp-text);
}

.pp-list li i {
  flex-shrink: 0;
  margin-top: 0.42em;
  font-size: 10px;
  color: var(--pp-success);
}

.pp-author {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--pp-line);
  font-size: var(--pp-size);
  color: var(--pp-dim);
}

.pp-author-name {
  font-weight: 600;
  color: var(--pp-text);
}

.pp-dot {
  opacity: 0.45;
}

.pp-mail {
  color: var(--pp-accent);
  text-decoration: none;
  font-variant-numeric: tabular-nums;
}

.pp-mail:hover {
  text-decoration: underline;
}

.pp-copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 2px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--pp-border);
  background: var(--pp-sunken);
  color: var(--pp-dim);
  font-size: calc(var(--pp-size) - 0.5px);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.pp-copy:hover {
  background: var(--pp-hover);
  color: var(--pp-accent);
}

.pp-copy i {
  font-size: 12px;
}

.pp-home {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 2px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--pp-border);
  background: transparent;
  color: var(--pp-dim);
  font-size: calc(var(--pp-size) - 0.5px);
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease;
}

.pp-home:hover {
  background: var(--pp-hover);
  color: var(--pp-accent);
}

.pp-home i {
  font-size: 12px;
}

.pp-thanks {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 10px;
  font-size: calc(var(--pp-size) - 0.5px);
  line-height: var(--pp-line-height);
  color: var(--pp-dim);
}

.pp-thanks i {
  flex-shrink: 0;
  margin-top: 0.32em;
  font-size: 12px;
  color: var(--pp-accent);
}

.pp-thanks-link {
  color: var(--pp-accent);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in srgb, var(--pp-accent) 45%, transparent);
  cursor: pointer;
}

.pp-thanks-link:hover {
  border-bottom-style: solid;
}
</style>
