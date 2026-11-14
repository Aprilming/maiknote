<script setup lang="ts">
import { computed, useId } from 'vue'
import {
  MEEGO_GLOSS_PATH,
  MEEGO_SQUIRCLE_PATH,
  defaultPresetOfStyle,
  findNoteLogoPreset,
  type NoteLogoPreset,
  type NoteLogoStyle,
} from '@/utils/noteLogoPresets'

const props = withDefaults(
  defineProps<{
    /** 风格：标准 / MeeGo（不能叫 style，会和根元素的 style 属性打架） */
    logoStyle?: NoteLogoStyle
    /** 预设 id；不属于当前风格时自动回落到该风格默认预设 */
    variant?: string
    /** 标准风格为边长，MeeGo 风格高度按 220:236 比例换算 */
    size?: number
  }>(),
  { logoStyle: 'standard', variant: '', size: 22 },
)

const uid = useId()

const preset = computed<NoteLogoPreset>(() => {
  const picked = findNoteLogoPreset(props.variant)
  return picked && picked.style === props.logoStyle ? picked : defaultPresetOfStyle(props.logoStyle)
})

const isMeego = computed(() => preset.value.style === 'meego')
const width = computed(() => props.size)
const height = computed(() => (isMeego.value ? Math.round((props.size * 236) / 220) : props.size))

const bgId = computed(() => `nl-bg-${uid}`)
const glossId = computed(() => `nl-gloss-${uid}`)
const clipId = computed(() => `nl-clip-${uid}`)
const blurId = computed(() => `nl-blur-${uid}`)
const dropId = computed(() => `nl-drop-${uid}`)

const hasGradient = computed(() => Boolean(preset.value.bgTo))
</script>

<template>
  <svg
    class="note-logo"
    :class="isMeego ? 'note-logo--meego' : 'note-logo--standard'"
    :viewBox="isMeego ? '0 0 220 236' : '0 0 200 200'"
    :width="width"
    :height="height"
    aria-hidden="true"
    focusable="false"
  >
    <defs v-if="!isMeego">
      <linearGradient v-if="hasGradient" :id="bgId" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" :stop-color="preset.bg" />
        <stop offset="1" :stop-color="preset.bgTo" />
      </linearGradient>
    </defs>

    <template v-if="!isMeego">
      <rect
        width="200"
        height="200"
        rx="44"
        :fill="hasGradient ? `url(#${bgId})` : preset.bg"
      />
      <g fill="none" :stroke="preset.mark" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M46 104 V56 L100 100 L154 56 V104" />
      </g>
      <g fill="none" :stroke="preset.accent" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.65">
        <path d="M70 140 L58 150 L70 160" />
        <path d="M130 140 L142 150 L130 160" />
      </g>
      <circle cx="100" cy="150" r="7" :fill="preset.accent" />
    </template>

    <template v-else>
      <defs>
        <linearGradient :id="bgId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" :stop-color="preset.bg" />
          <stop offset="1" :stop-color="preset.bgTo" />
        </linearGradient>
        <linearGradient :id="glossId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#FFFFFF" :stop-opacity="preset.gloss ?? 0.4" />
          <stop offset="1" stop-color="#FFFFFF" stop-opacity="0.05" />
        </linearGradient>
        <clipPath :id="clipId">
          <path :d="MEEGO_SQUIRCLE_PATH" />
        </clipPath>
        <filter :id="blurId" x="-40%" y="-40%" width="180%" height="190%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter :id="dropId" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#000000" flood-opacity="0.45" />
        </filter>
      </defs>

      <g transform="translate(10 6)">
        <path
          :d="MEEGO_SQUIRCLE_PATH"
          transform="translate(0 12)"
          fill="#000000"
          opacity="0.55"
          :filter="`url(#${blurId})`"
        />
        <path
          :d="MEEGO_SQUIRCLE_PATH"
          :fill="`url(#${bgId})`"
          :stroke="preset.border"
          stroke-width="2"
        />
        <g :clip-path="`url(#${clipId})`">
          <path :d="MEEGO_GLOSS_PATH" :fill="`url(#${glossId})`" />
        </g>
        <path
          :d="MEEGO_SQUIRCLE_PATH"
          transform="translate(1 1) scale(0.99)"
          fill="none"
          stroke="#FFFFFF"
          stroke-opacity="0.35"
          stroke-width="1.5"
        />
        <g :filter="`url(#${dropId})`">
          <path
            d="M48 104 V58 L100 100 L152 58 V104"
            fill="none"
            :stroke="preset.mark"
            stroke-width="13"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M66 138 L53 150 L66 162"
            fill="none"
            :stroke="preset.accent"
            stroke-width="7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="100" cy="150" r="9" :fill="preset.accent" />
          <path
            d="M134 138 L147 150 L134 162"
            fill="none"
            :stroke="preset.accent"
            stroke-width="7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </g>
      </g>
    </template>
  </svg>
</template>

<style scoped>
.note-logo {
  display: block;
  flex-shrink: 0;
  overflow: visible;
}
</style>
