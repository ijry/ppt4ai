<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { backgroundColorFrom, backgroundGradientFrom, backgroundPatternFrom, type SlideBackgroundPanelEmit, type SlideBackgroundPanelModel } from './slide-background-panel'

const props = defineProps<{ model: SlideBackgroundPanelModel; pictureAssets?: readonly { id: string; label: string }[] }>()
const emit = defineEmits<SlideBackgroundPanelEmit>()
const { t } = useI18n()

const note = computed(() => {
  if (props.model.kind === 'gradient') return t('panel.slideBackground.gradient')
  if (props.model.kind === 'pattern') return t('panel.slideBackground.pattern')
  if (props.model.kind === 'styleRef') return t('panel.slideBackground.styleRef')
  return props.model.inherited ? t('panel.slideBackground.inherited') : ''
})

function pick(event: Event): void {
  const color = backgroundColorFrom((event.target as HTMLInputElement).value)
  if (color) emit('set-color', color)
}

// The gradient inputs read from the model each render, so editing one reads the other two off the model.
function applyGradient(start: string, end: string, angle: number): void {
  const fill = backgroundGradientFrom(start, end, angle)
  if (fill) emit('set-gradient', fill)
}

function pickGradientStart(event: Event): void {
  applyGradient((event.target as HTMLInputElement).value, props.model.gradientEnd, props.model.gradientAngle)
}

function pickGradientEnd(event: Event): void {
  applyGradient(props.model.gradientStart, (event.target as HTMLInputElement).value, props.model.gradientAngle)
}

function pickGradientAngle(event: Event): void {
  const angle = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(angle)) applyGradient(props.model.gradientStart, props.model.gradientEnd, angle)
}

function applyPattern(preset: string, foreground: string, background: string): void {
  const fill = backgroundPatternFrom(preset, foreground, background)
  if (fill) emit('set-pattern', fill)
}

function pickPatternPreset(event: Event): void {
  applyPattern((event.target as HTMLSelectElement).value, props.model.patternForeground, props.model.patternBackground)
}

function pickPatternForeground(event: Event): void {
  applyPattern(props.model.patternPreset, (event.target as HTMLInputElement).value, props.model.patternBackground)
}

function pickPatternBackground(event: Event): void {
  applyPattern(props.model.patternPreset, props.model.patternForeground, (event.target as HTMLInputElement).value)
}

function pickPicture(event: Event): void {
  const assetId = (event.target as HTMLSelectElement).value
  if (assetId) emit('set-picture', assetId)
}
</script>

<template>
  <section class="border border-slate-200 bg-white p-4" :aria-label="t('panel.slideBackground.title')">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-sm font-semibold">{{ t('panel.slideBackground.title') }}</h2>
      <button
        class="h-8 border border-slate-300 px-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        data-slide-background-clear
        :disabled="!props.model.active || !props.model.own"
        @click="emit('clear')"
      >
        {{ t('panel.slideBackground.clear') }}
      </button>
    </div>
    <label class="mt-3 flex items-center gap-2 text-sm text-slate-700">
      <span>{{ t('panel.slideBackground.color') }}</span>
      <input
        class="h-8 w-12 border border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
        type="color"
        data-slide-background-color
        :aria-label="t('panel.slideBackground.color')"
        :disabled="!props.model.active"
        :value="props.model.color"
        @change="pick"
      >
      <span class="font-mono text-xs text-slate-500">{{ props.model.color }}</span>
    </label>
    <fieldset class="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-700" data-slide-background-gradient>
      <legend class="text-xs text-slate-500">{{ t('panel.slideBackground.gradientEditor') }}</legend>
      <input
        class="h-8 w-12 border border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
        type="color"
        data-slide-background-gradient-start
        :aria-label="t('panel.slideBackground.gradientStart')"
        :disabled="!props.model.active"
        :value="props.model.gradientStart"
        @change="pickGradientStart"
      >
      <input
        class="h-8 w-12 border border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
        type="color"
        data-slide-background-gradient-end
        :aria-label="t('panel.slideBackground.gradientEnd')"
        :disabled="!props.model.active"
        :value="props.model.gradientEnd"
        @change="pickGradientEnd"
      >
      <input
        class="h-8 w-16 border border-slate-300 px-1 disabled:cursor-not-allowed disabled:opacity-50"
        type="number"
        min="0"
        max="359"
        data-slide-background-gradient-angle
        :aria-label="t('panel.slideBackground.gradientAngle')"
        :disabled="!props.model.active"
        :value="props.model.gradientAngle"
        @change="pickGradientAngle"
      >
    </fieldset>
    <fieldset class="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-700" data-slide-background-pattern>
      <legend class="text-xs text-slate-500">{{ t('panel.slideBackground.patternEditor') }}</legend>
      <select
        class="h-8 border border-slate-300 bg-white px-1 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        data-slide-background-pattern-preset
        :aria-label="t('panel.slideBackground.patternPreset')"
        :disabled="!props.model.active"
        :value="props.model.patternPreset"
        @change="pickPatternPreset"
      >
        <option v-for="preset in props.model.patternPresets" :key="preset" :value="preset">{{ preset }}</option>
      </select>
      <input
        class="h-8 w-12 border border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
        type="color"
        data-slide-background-pattern-foreground
        :aria-label="t('panel.slideBackground.patternForeground')"
        :disabled="!props.model.active"
        :value="props.model.patternForeground"
        @change="pickPatternForeground"
      >
      <input
        class="h-8 w-12 border border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
        type="color"
        data-slide-background-pattern-background
        :aria-label="t('panel.slideBackground.patternBackground')"
        :disabled="!props.model.active"
        :value="props.model.patternBackground"
        @change="pickPatternBackground"
      >
    </fieldset>
    <fieldset v-if="props.pictureAssets && props.pictureAssets.length > 0" class="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-700" data-slide-background-picture>
      <legend class="text-xs text-slate-500">{{ t('panel.slideBackground.pictureEditor') }}</legend>
      <select
        class="h-8 border border-slate-300 bg-white px-1 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        data-slide-background-picture-asset
        :aria-label="t('panel.slideBackground.pictureAsset')"
        :disabled="!props.model.active"
        :value="props.model.pictureAssetId"
        @change="pickPicture"
      >
        <option value="">{{ t('panel.slideBackground.pictureNone') }}</option>
        <option v-for="asset in props.pictureAssets" :key="asset.id" :value="asset.id">{{ asset.label }}</option>
      </select>
    </fieldset>
    <p v-if="note" role="note" class="mt-2 text-xs text-slate-500">{{ note }}</p>
  </section>
</template>
