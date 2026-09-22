<script setup lang="ts">
import { computed } from 'vue'
import { SlideBackgroundPanel, slideBackgroundModel } from '@ppt4ai/editor'
import type { Color } from '@ppt4ai/model'
import { Panel, PanelSection, Field } from '../ui'
import { inspectorContext } from '../editor/inspector-context'
import type { PlaygroundPresentationHost, PlaygroundPresentationSnapshot } from '../presentation-host'

const props = defineProps<{ snapshot: PlaygroundPresentationSnapshot; host: PlaygroundPresentationHost }>()
const emit = defineEmits<{ update: [PlaygroundPresentationSnapshot] }>()

const context = computed(() => inspectorContext(props.snapshot))

const selected = computed(() => {
  const slide = props.snapshot.slides[props.snapshot.activeSlideId]!
  const id = [...slide.engineState.selection][0]
  const el = id ? (slide.engineState.document.elements[id] as { id: string; bounds?: { x: number; y: number; w: number; h: number }; transform?: { rotation?: number } }) : undefined
  return el && el.bounds ? { id: el.id, bounds: el.bounds, rotation: el.transform?.rotation ?? 0 } : undefined
})

function setGeom(field: 'x' | 'y' | 'w' | 'h', value: string): void {
  const sel = selected.value; if (!sel) return
  const n = Number(value); if (!Number.isFinite(n)) return
  emit('update', props.host.resizeElement(sel.id, { ...sel.bounds, [field]: n }))
}
function setRotation(value: string): void {
  const sel = selected.value; if (!sel) return
  const deg = Number(value); if (!Number.isFinite(deg)) return
  emit('update', props.host.rotateSelectedElement(sel.id, Math.round(deg * 60000)))
}

// Slide-context background (slide target only for M1; layout/master targets, theme and assets are a follow-up).
const backgroundModel = computed(() => {
  const doc = props.snapshot.slides[props.snapshot.activeSlideId]!.engineState.document
  const slideId = doc.slideOrder[0]
  const sc = props.snapshot.slides[props.snapshot.activeSlideId]!.thumbnailScene
  return slideBackgroundModel(slideId ? doc.slides[slideId]?.background : undefined, sc.background, sc.backgroundGradient, slideId !== undefined, sc.backgroundPattern)
})
const backgroundPictureAssets = computed(() => Object.values(props.snapshot.slides[props.snapshot.activeSlideId]!.engineState.document.assets ?? {})
  .map((asset) => ({ id: (asset as { id: string }).id, label: (asset as { id: string; originalFilename?: string }).originalFilename ?? (asset as { id: string }).id })))

function setBackgroundColor(color: Color): void { emit('update', props.host.setSlideBackground({ fill: { color } })) }
function setBackgroundGradient(fill: unknown): void { emit('update', props.host.setSlideBackground({ fill: fill as never })) }
function setBackgroundPattern(fill: unknown): void { emit('update', props.host.setSlideBackground({ fill: fill as never })) }
function setBackgroundPicture(assetId: string): void { emit('update', props.host.setSlideBackground({ pictureFill: { assetId } })) }
function clearBackground(): void { emit('update', props.host.setSlideBackground(null)) }
</script>
<template>
  <div v-if="context === 'object' && selected" data-inspector="object" class="flex flex-col gap-3 p-3">
    <Panel title="位置与大小">
      <PanelSection>
        <Field label="X"><input class="w-24 rounded border border-border px-1 text-right" type="number" :value="selected.bounds.x" data-geom="x" @change="setGeom('x', ($event.target as HTMLInputElement).value)" /></Field>
        <Field label="Y"><input class="w-24 rounded border border-border px-1 text-right" type="number" :value="selected.bounds.y" data-geom="y" @change="setGeom('y', ($event.target as HTMLInputElement).value)" /></Field>
        <Field label="宽"><input class="w-24 rounded border border-border px-1 text-right" type="number" :value="selected.bounds.w" data-geom="w" @change="setGeom('w', ($event.target as HTMLInputElement).value)" /></Field>
        <Field label="高"><input class="w-24 rounded border border-border px-1 text-right" type="number" :value="selected.bounds.h" data-geom="h" @change="setGeom('h', ($event.target as HTMLInputElement).value)" /></Field>
        <Field label="旋转°"><input class="w-24 rounded border border-border px-1 text-right" type="number" :value="Math.round(selected.rotation / 60000)" data-geom="r" @change="setRotation(($event.target as HTMLInputElement).value)" /></Field>
      </PanelSection>
    </Panel>
  </div>
  <div v-else data-inspector="slide" class="flex flex-col gap-3 p-3">
    <SlideBackgroundPanel
      :model="backgroundModel"
      :picture-assets="backgroundPictureAssets"
      @set-color="setBackgroundColor"
      @set-gradient="setBackgroundGradient"
      @set-pattern="setBackgroundPattern"
      @set-picture="setBackgroundPicture"
      @clear="clearBackground"
    />
  </div>
</template>
