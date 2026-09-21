<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Fill } from '@ppt4ai/model'
import {
  emuFromPoints,
  pointsFromEmu,
  STROKE_STYLE_OPTIONS,
  strokeStyleOptions,
  shapeGradientFrom,
  type ShapePaintToolbarEmit,
  type ShapePaintToolbarProps,
} from './shape-paint-toolbar'

const props = withDefaults(defineProps<ShapePaintToolbarProps>(), {
  fillColor: '#FFFFFF',
  fillIsGradient: false,
  strokeColor: '#000000',
  strokeIsGradient: false,
})
const emit = defineEmits<ShapePaintToolbarEmit>()
const { t } = useI18n()

const widthPoints = ref(pointsFromEmu(props.strokeWidth) ?? '')
watch(() => props.strokeWidth, (value) => { widthPoints.value = pointsFromEmu(value) ?? '' })

const styleValue = computed(() => props.strokeStyle ?? 'solid')
/**
 * Only the three offered styles have a label; one of the other eight `a:prstDash` tokens shows its own
 * word, because the toolbar cannot describe a style it cannot set and inventing a name would be worse.
 */
const styleOptions = computed(() => strokeStyleOptions(props.strokeStyle).map((option) => ({
  value: option,
  label: STROKE_STYLE_OPTIONS.includes(option) ? t(`toolbar.shapePaint.styles.${option}`) : option,
})))

function colorValue(value: string): string {
  const normalized = value.replace(/^#/, '').toUpperCase()
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : '000000'
}

function paintFrom(event: Event): Fill {
  return { color: { type: 'srgb', v: colorValue((event.target as HTMLInputElement).value) } }
}

/** Picking a flat colour replaces the whole paint, gradient included; the command says the same. */
function setFill(event: Event): void {
  emit('set-fill', paintFrom(event))
}

function setStroke(event: Event): void {
  emit('set-stroke', paintFrom(event))
}

function applyFillGradient(start: string, end: string, angle: number): void {
  const fill = shapeGradientFrom(start, end, angle)
  if (fill) emit('set-fill', fill)
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

function commitWidth(): void {
  const raw = widthPoints.value
  if (raw === '') return
  const width = emuFromPoints(raw)
  if (width !== undefined) emit('set-stroke-width', width)
}

function setStrokeStyle(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  emit('set-stroke-style', STROKE_STYLE_OPTIONS.find((option) => option === value) ?? null)
}
</script>

<template>
  <div class="flex items-center gap-1 border-b border-slate-200 bg-white p-1" data-shape-paint-toolbar>
    <input
      type="color"
      class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      data-shape-fill-color
      :aria-label="t('toolbar.shapePaint.fillColor')"
      :disabled="!props.active"
      :value="props.fillColor"
      @change="setFill"
    >
    <span
      v-if="props.fillIsGradient"
      data-shape-fill-gradient
      class="text-xs text-slate-500"
    >{{ t('toolbar.shapePaint.gradient') }}</span>
    <input
      type="color"
      class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
      data-shape-fill-gradient-start
      :aria-label="t('toolbar.shapePaint.fillGradientStart')"
      :disabled="!props.active"
      :value="props.fillGradientStart ?? props.fillColor ?? '#FFFFFF'"
      @change="fillGradientStart"
    >
    <input
      type="color"
      class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
      data-shape-fill-gradient-end
      :aria-label="t('toolbar.shapePaint.fillGradientEnd')"
      :disabled="!props.active"
      :value="props.fillGradientEnd ?? '#FFFFFF'"
      @change="fillGradientEnd"
    >
    <input
      type="number"
      min="0"
      max="359"
      class="h-8 w-14 border border-slate-300 px-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      data-shape-fill-gradient-angle
      :aria-label="t('toolbar.shapePaint.fillGradientAngle')"
      :disabled="!props.active"
      :value="props.fillGradientAngle ?? 0"
      @change="fillGradientAngle"
    >
    <button
      type="button"
      class="h-8 min-w-8 border border-transparent px-2 text-sm text-slate-700 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      data-action="clear-fill"
      :aria-label="t('toolbar.shapePaint.clearFill')"
      :disabled="!props.active"
      @click="emit('set-fill', null)"
    >
      {{ t('toolbar.shapePaint.clear') }}
    </button>

    <input
      type="color"
      class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      data-shape-stroke-color
      :aria-label="t('toolbar.shapePaint.strokeColor')"
      :disabled="!props.active"
      :value="props.strokeColor"
      @change="setStroke"
    >
    <span
      v-if="props.strokeIsGradient"
      data-shape-stroke-gradient
      class="text-xs text-slate-500"
    >{{ t('toolbar.shapePaint.gradient') }}</span>
    <button
      type="button"
      class="h-8 min-w-8 border border-transparent px-2 text-sm text-slate-700 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      data-action="clear-stroke"
      :aria-label="t('toolbar.shapePaint.clearStroke')"
      :disabled="!props.active"
      @click="emit('set-stroke', null)"
    >
      {{ t('toolbar.shapePaint.clear') }}
    </button>

    <input
      type="number"
      min="0"
      step="0.25"
      class="h-8 w-16 border border-slate-300 px-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      data-shape-stroke-width
      :aria-label="t('toolbar.shapePaint.strokeWidth')"
      :placeholder="t('toolbar.shapePaint.inherited')"
      :disabled="!props.active"
      v-model="widthPoints"
      @change="commitWidth"
    >
    <button
      type="button"
      class="h-8 min-w-8 border border-transparent px-2 text-sm text-slate-700 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      data-action="clear-stroke-width"
      :aria-label="t('toolbar.shapePaint.clearStrokeWidth')"
      :disabled="!props.active"
      @click="emit('set-stroke-width', null)"
    >
      {{ t('toolbar.shapePaint.clear') }}
    </button>

    <select
      class="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      data-shape-stroke-style
      :aria-label="t('toolbar.shapePaint.strokeStyle')"
      :disabled="!props.active"
      :value="styleValue"
      @change="setStrokeStyle"
    >
      <option v-for="option in styleOptions" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </div>
</template>
