<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Fill } from '@ppt4ai/model'
import type { TableFormattingToolbarEmit, TableFormattingToolbarProps } from './table-formatting-toolbar'
import { shapeGradientFrom, shapePatternFrom, SHAPE_FILL_PATTERN_PRESETS } from './shape-paint-toolbar'

const props = withDefaults(defineProps<TableFormattingToolbarProps>(), {
  fillColor: '#FFFFFF',
  borderColor: '#000000',
  borderWidth: 12700,
  borderStyle: 'solid',
  borderSides: () => [],
})
const emit = defineEmits<TableFormattingToolbarEmit>()
const { t } = useI18n()
const sides = ['left', 'right', 'top', 'bottom'] as const
const selectedSides = ref(new Set(props.borderSides))
const currentBorderColor = ref(props.borderColor)
const currentBorderWidth = ref(props.borderWidth)
const currentBorderStyle = ref(props.borderStyle)

function colorValue(value: string): string {
  const normalized = value.replace(/^#/, '').toUpperCase()
  return normalized.length === 6 ? normalized : '000000'
}

function fill(event: Event): void {
  const value = colorValue((event.target as HTMLInputElement).value)
  const payload: Fill = { color: { type: 'srgb', v: value } }
  emit('set-fill', payload)
}

function toggleSide(side: typeof sides[number]): void {
  const next = new Set(selectedSides.value)
  if (next.has(side)) next.delete(side)
  else next.add(side)
  selectedSides.value = next
}

function border(): void {
  const value = {
    color: { type: 'srgb' as const, v: colorValue(currentBorderColor.value) },
    width: currentBorderWidth.value,
    style: currentBorderStyle.value,
  }
  const payload = Object.fromEntries([...selectedSides.value].map((side) => [side, value]))
  if (Object.keys(payload).length > 0) emit('set-borders', payload)
}

function clearFill(): void {
  emit('set-fill', null)
}

const patternPresets = SHAPE_FILL_PATTERN_PRESETS

function applyFillGradient(start: string, end: string, angle: number): void {
  const value = shapeGradientFrom(start, end, angle)
  if (value) emit('set-fill', value)
}

function fillGradientStart(event: Event): void {
  applyFillGradient((event.target as HTMLInputElement).value, props.fillGradientEnd ?? '#FFFFFF', props.fillGradientAngle ?? 0)
}

function fillGradientEnd(event: Event): void {
  applyFillGradient(props.fillGradientStart ?? props.fillColor ?? '#FFFFFF', (event.target as HTMLInputElement).value, props.fillGradientAngle ?? 0)
}

function fillGradientAngle(event: Event): void {
  const angle = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(angle)) applyFillGradient(props.fillGradientStart ?? props.fillColor ?? '#FFFFFF', props.fillGradientEnd ?? '#FFFFFF', angle)
}

function applyFillPattern(preset: string, fg: string, bg: string): void {
  const value = shapePatternFrom(preset, fg, bg)
  if (value) emit('set-fill', value)
}

function fillPatternPreset(event: Event): void {
  applyFillPattern((event.target as HTMLSelectElement).value, props.fillPatternForeground ?? props.fillColor ?? '#FFFFFF', props.fillPatternBackground ?? '#FFFFFF')
}

function fillPatternForeground(event: Event): void {
  applyFillPattern(props.fillPatternPreset ?? patternPresets[0]!, (event.target as HTMLInputElement).value, props.fillPatternBackground ?? '#FFFFFF')
}

function fillPatternBackground(event: Event): void {
  applyFillPattern(props.fillPatternPreset ?? patternPresets[0]!, props.fillPatternForeground ?? props.fillColor ?? '#FFFFFF', (event.target as HTMLInputElement).value)
}

function clearBorders(): void {
  const payload = Object.fromEntries([...selectedSides.value].map((side) => [side, null]))
  if (Object.keys(payload).length > 0) emit('set-borders', payload)
}
</script>

<template>
  <div class="flex items-center gap-1 border-b border-slate-200 bg-white p-1" data-table-formatting-toolbar>
    <input
      type="color"
      class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      :aria-label="t('toolbar.tableFormatting.fillColor')"
      :disabled="!props.active"
      :value="props.fillColor"
      @change="fill"
    >
    <button
      type="button"
      class="h-8 min-w-8 border border-transparent px-2 text-sm text-slate-700 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      data-action="clear-fill"
      :aria-label="t('toolbar.tableFormatting.clearFill')"
      :disabled="!props.active"
      @click="clearFill"
    >
      {{ t('toolbar.tableFormatting.clear') }}
    </button>
    <input
      type="color"
      class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
      data-table-fill-gradient-start
      :aria-label="t('toolbar.tableFormatting.fillGradientStart')"
      :disabled="!props.active"
      :value="props.fillGradientStart ?? props.fillColor ?? '#FFFFFF'"
      @change="fillGradientStart"
    >
    <input
      type="color"
      class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
      data-table-fill-gradient-end
      :aria-label="t('toolbar.tableFormatting.fillGradientEnd')"
      :disabled="!props.active"
      :value="props.fillGradientEnd ?? '#FFFFFF'"
      @change="fillGradientEnd"
    >
    <input
      type="number"
      min="0"
      max="359"
      class="h-8 w-14 border border-slate-300 px-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      data-table-fill-gradient-angle
      :aria-label="t('toolbar.tableFormatting.fillGradientAngle')"
      :disabled="!props.active"
      :value="props.fillGradientAngle ?? 0"
      @change="fillGradientAngle"
    >
    <select
      class="h-8 border border-slate-300 bg-white px-1 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      data-table-fill-pattern-preset
      :aria-label="t('toolbar.tableFormatting.fillPatternPreset')"
      :disabled="!props.active"
      :value="props.fillPatternPreset ?? patternPresets[0]"
      @change="fillPatternPreset"
    >
      <option v-for="preset in patternPresets" :key="preset" :value="preset">{{ preset }}</option>
    </select>
    <input
      type="color"
      class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
      data-table-fill-pattern-foreground
      :aria-label="t('toolbar.tableFormatting.fillPatternForeground')"
      :disabled="!props.active"
      :value="props.fillPatternForeground ?? props.fillColor ?? '#FFFFFF'"
      @change="fillPatternForeground"
    >
    <input
      type="color"
      class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
      data-table-fill-pattern-background
      :aria-label="t('toolbar.tableFormatting.fillPatternBackground')"
      :disabled="!props.active"
      :value="props.fillPatternBackground ?? '#FFFFFF'"
      @change="fillPatternBackground"
    >

    <button
      v-for="side in sides"
      :key="side"
      type="button"
      class="h-8 min-w-8 border border-transparent px-2 text-sm text-slate-700 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      :data-border-side="side"
      :aria-label="t(`toolbar.tableFormatting.side.${side}`)"
      :aria-pressed="selectedSides.has(side) ? 'true' : 'false'"
      :disabled="!props.active"
      @click="toggleSide(side)"
    >
      {{ side.charAt(0).toUpperCase() }}
    </button>

    <input
      type="color"
      class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      data-table-border-color
      :aria-label="t('toolbar.tableFormatting.borderColor')"
      :disabled="!props.active"
      v-model="currentBorderColor"
    >
    <select
      class="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      data-table-border-width
      :aria-label="t('toolbar.tableFormatting.borderWidth')"
      :disabled="!props.active"
      v-model.number="currentBorderWidth"
    >
      <option value="6350">0.5 pt</option>
      <option value="12700">1 pt</option>
      <option value="25400">2 pt</option>
    </select>
    <select
      class="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      data-table-border-style
      :aria-label="t('toolbar.tableFormatting.borderStyle')"
      :disabled="!props.active"
      v-model="currentBorderStyle"
    >
      <option value="solid">{{ t('toolbar.tableFormatting.styles.solid') }}</option>
      <option value="dash">{{ t('toolbar.tableFormatting.styles.dash') }}</option>
      <option value="dot">{{ t('toolbar.tableFormatting.styles.dot') }}</option>
    </select>
    <button
      type="button"
      class="h-8 min-w-8 border border-transparent px-2 text-sm text-slate-700 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      data-action="apply-borders"
      :aria-label="t('toolbar.tableFormatting.applyBorders')"
      :disabled="!props.active"
      @click="border"
    >
      {{ t('toolbar.tableFormatting.apply') }}
    </button>
    <button
      type="button"
      class="h-8 min-w-8 border border-transparent px-2 text-sm text-slate-700 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      data-action="clear-borders"
      :aria-label="t('toolbar.tableFormatting.clearBorders')"
      :disabled="!props.active"
      @click="clearBorders"
    >
      {{ t('toolbar.tableFormatting.clear') }}
    </button>
  </div>
</template>
