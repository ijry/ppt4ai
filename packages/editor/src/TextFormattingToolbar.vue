<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { TextFormattingToolbarEmit, TextFormattingToolbarProps } from './text-formatting-toolbar'

const props = defineProps<TextFormattingToolbarProps>()
const emit = defineEmits<TextFormattingToolbarEmit>()
const { t } = useI18n()

function toggle(name: 'bold' | 'italic' | 'underline'): void {
  emit('toggle-mark', name)
}

function alignment(align: 'left' | 'center' | 'right'): void {
  emit('set-alignment', align)
}

function fontFamily(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value) emit('set-marks', { fontFamily: value })
}

function fontFamilyEa(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value) emit('set-marks', { fontFamilyEa: value })
}

function fontSize(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value)
  if (Number.isFinite(value) && value > 0) emit('set-marks', { fontSize: value })
}

function color(event: Event): void {
  const value = (event.target as HTMLInputElement).value.replace(/^#/, '')
  if (value) emit('set-marks', { color: { color: { type: 'srgb', v: value } } })
}

function highlight(event: Event): void {
  const value = (event.target as HTMLInputElement).value.replace(/^#/, '')
  if (value) emit('set-marks', { highlight: { type: 'srgb', v: value } })
}

function clearHighlight(): void {
  emit('set-marks', { highlight: undefined })
}
</script>

<template>
  <div class="flex items-center gap-1 border-b border-slate-200 bg-white p-1" data-text-formatting-toolbar>
    <button
      v-for="name in ['bold', 'italic', 'underline'] as const"
      :key="name"
      type="button"
      class="h-8 min-w-8 border border-transparent px-2 text-sm text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
      :aria-label="t(`toolbar.textFormatting.${name}`)"
      :aria-pressed="props.state[name] === 'mixed' ? 'mixed' : props.state[name] ? 'true' : 'false'"
      :disabled="!props.active"
      @click="toggle(name)"
    >
      {{ name === 'bold' ? 'B' : name === 'italic' ? 'I' : 'U' }}
    </button>

    <button
      v-for="align in ['left', 'center', 'right'] as const"
      :key="align"
      type="button"
      class="h-8 min-w-8 border border-transparent px-2 text-sm text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
      :aria-label="t(`toolbar.textFormatting.align.${align}`)"
      :aria-pressed="props.state.align === align ? 'true' : 'false'"
      :disabled="!props.active"
      @click="alignment(align)"
    >
      {{ align === 'left' ? 'L' : align === 'center' ? 'C' : 'R' }}
    </button>

    <select
      class="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      :aria-label="t('toolbar.textFormatting.fontFamily')"
      :disabled="!props.active"
      :value="props.state.fontFamily ?? ''"
      @change="fontFamily"
    >
      <option value="">{{ t('toolbar.textFormatting.mixed') }}</option>
      <option v-for="font in props.fontFamilies" :key="font" :value="font">{{ font }}</option>
    </select>

    <select
      class="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      :aria-label="t('toolbar.textFormatting.fontFamilyEa')"
      :disabled="!props.active"
      :value="props.state.fontFamilyEa ?? ''"
      @change="fontFamilyEa"
    >
      <option value="">{{ t('toolbar.textFormatting.mixed') }}</option>
      <option v-for="font in (props.eaFontFamilies ?? props.fontFamilies)" :key="font" :value="font">{{ font }}</option>
    </select>

    <select
      class="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      :aria-label="t('toolbar.textFormatting.fontSize')"
      :disabled="!props.active"
      :value="props.state.fontSize ?? ''"
      @change="fontSize"
    >
      <option value="">{{ t('toolbar.textFormatting.mixed') }}</option>
      <option v-for="size in props.fontSizes" :key="size" :value="size">{{ size }}</option>
    </select>

    <input
      type="color"
      class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
      :aria-label="t('toolbar.textFormatting.color')"
      :disabled="!props.active"
      :value="props.state.color?.color.type === 'srgb' ? `#${props.state.color.color.v}` : '#000000'"
      @change="color"
    >

    <input
      type="color"
      class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
      data-text-highlight
      :aria-label="t('toolbar.textFormatting.highlight')"
      :disabled="!props.active"
      :value="props.state.highlight?.type === 'srgb' ? `#${props.state.highlight.v}` : '#FFFF00'"
      @change="highlight"
    >
    <button
      type="button"
      class="h-8 min-w-8 border border-transparent px-2 text-sm text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
      data-text-highlight-clear
      :aria-label="t('toolbar.textFormatting.highlightClear')"
      :disabled="!props.active || !props.state.highlight"
      @click="clearHighlight"
    >
      ✕
    </button>
  </div>
</template>
