<script setup lang="ts">
import { computed } from 'vue'
import { SlideBackgroundPanel, slideBackgroundModel, AssetLibrary, ThemePanel, THEME_SLOT_GROUPS, themeSlotGroup, themeFontModels, hexFromColor, type ThemePanelSlotModel, type ThemePanelFontModel } from '@ppt4ai/editor'
import { DEFAULT_THEME_COLORS, type Color, type ThemeColorSlot, type ThemeFontSlot, type ThemeFontScript } from '@ppt4ai/model'
import { Panel, PanelSection, Field } from '../ui'
import { inspectorContext } from '../editor/inspector-context'
import type { PlaygroundPresentationHost, PlaygroundPresentationSnapshot } from '../presentation-host'

// Suggestions for the font boxes — a browser cannot enumerate installed fonts, and a theme typeface
// need not exist locally to be written.
const THEME_FONT_SUGGESTIONS: readonly string[] = ['Aptos', 'Aptos Display', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', '宋体', '等线', '微软雅黑']

const props = defineProps<{ snapshot: PlaygroundPresentationSnapshot; host: PlaygroundPresentationHost }>()
const emit = defineEmits<{ update: [PlaygroundPresentationSnapshot] }>()

const active = () => props.snapshot.slides[props.snapshot.activeSlideId]!
const context = computed(() => inspectorContext(props.snapshot))

const selected = computed(() => {
  const slide = active()
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

// Slide-context background (slide target only for M1; layout/master targets are a follow-up).
const backgroundModel = computed(() => {
  const doc = active().engineState.document
  const slideId = doc.slideOrder[0]
  const sc = active().thumbnailScene
  return slideBackgroundModel(slideId ? doc.slides[slideId]?.background : undefined, sc.background, sc.backgroundGradient, slideId !== undefined, sc.backgroundPattern)
})
const backgroundPictureAssets = computed(() => Object.values(active().engineState.document.assets ?? {})
  .map((asset) => ({ id: (asset as { id: string }).id, label: (asset as { id: string; originalFilename?: string }).originalFilename ?? (asset as { id: string }).id })))
function setBackgroundColor(color: Color): void { emit('update', props.host.setSlideBackground({ fill: { color } })) }
function setBackgroundGradient(fill: unknown): void { emit('update', props.host.setSlideBackground({ fill: fill as never })) }
function setBackgroundPattern(fill: unknown): void { emit('update', props.host.setSlideBackground({ fill: fill as never })) }
function setBackgroundPicture(assetId: string): void { emit('update', props.host.setSlideBackground({ pictureFill: { assetId } })) }
function clearBackground(): void { emit('update', props.host.setSlideBackground(null)) }

// Layout picker (same-master layouts) and the asset library.
const layoutChoices = computed(() => {
  const doc = active().engineState.document
  const slide = doc.slides[doc.slideOrder[0] ?? '']
  const layout = slide?.layoutId ? doc.layouts?.[slide.layoutId] : undefined
  const masterId = slide?.masterId ?? layout?.masterId
  const layouts = Object.values(doc.layouts ?? {}).filter((entry) => entry.masterId === masterId)
  return { current: slide?.layoutId ?? '', layouts: layouts.map((entry) => ({ id: entry.id, label: entry.id })) }
})
const assets = computed(() => active().engineState.document.assets)
function setLayout(event: Event): void {
  const id = (event.target as HTMLSelectElement).value
  if (id) emit('update', props.host.setSlideLayout(id))
}
function selectAsset(id: string): void { emit('update', props.host.selectAsset(id)) }
function insertAsset(id: string): void { emit('update', props.host.insertAsset(id)) }
function replaceAsset(id: string): void { emit('update', props.host.replaceSelectedImage(id)) }

// Theme (colors + fonts) for the active slide's resolved theme.
const activeThemeId = computed(() => {
  const doc = active().engineState.document
  const slide = doc.slides[props.snapshot.activeSlideId]
  const layout = slide?.layoutId ? doc.layouts?.[slide.layoutId] : undefined
  const masterId = slide?.masterId ?? layout?.masterId
  const themeId = masterId ? doc.masters?.[masterId]?.themeId : undefined
  return themeId && doc.themes?.[themeId] ? themeId : undefined
})
const themeSlots = computed<ThemePanelSlotModel[]>(() => {
  const themeId = activeThemeId.value
  const colors = themeId ? active().engineState.document.themes?.[themeId]?.colors : undefined
  if (!colors) return []
  return THEME_SLOT_GROUPS.flatMap((group) => group.slots).map((slot) => {
    const value = colors[slot]
    return { slot, group: themeSlotGroup(slot), color: hexFromColor(value ?? DEFAULT_THEME_COLORS[slot], slot), isDefault: value === null, inherited: value === undefined }
  })
})
const themeFonts = computed<ThemePanelFontModel[]>(() => {
  const themeId = activeThemeId.value
  const theme = themeId ? active().engineState.document.themes?.[themeId] : undefined
  return theme ? themeFontModels(theme.fonts) : []
})
function setThemeColor(slot: ThemeColorSlot, color: Color): void { emit('update', props.host.setThemeColor(slot, color)) }
function resetThemeColor(slot: ThemeColorSlot): void { emit('update', props.host.setThemeColor(slot, null)) }
function setThemeFont(slot: ThemeFontSlot, script: ThemeFontScript, typeface: string): void { emit('update', props.host.setThemeFont(slot, script, typeface)) }
function resetThemeFont(slot: ThemeFontSlot, script: ThemeFontScript): void { emit('update', props.host.setThemeFont(slot, script, null)) }
</script>
<template>
  <div v-if="context === 'object' && selected" data-region="inspector" data-inspector="object" class="flex flex-col gap-3 p-3">
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
  <div v-else data-region="inspector" data-inspector="slide" class="flex flex-col gap-3 p-3">
    <Panel v-if="layoutChoices.layouts.length" title="版式">
      <Field label="版式">
        <select class="h-8 rounded border border-border bg-surface px-1 text-sm" data-layout-picker :value="layoutChoices.current" @change="setLayout">
          <option v-for="opt in layoutChoices.layouts" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
        </select>
      </Field>
    </Panel>
    <Panel title="背景">
      <SlideBackgroundPanel
        :model="backgroundModel"
        :picture-assets="backgroundPictureAssets"
        @set-color="setBackgroundColor"
        @set-gradient="setBackgroundGradient"
        @set-pattern="setBackgroundPattern"
        @set-picture="setBackgroundPicture"
        @clear="clearBackground"
      />
    </Panel>
    <Panel v-if="activeThemeId" title="主题" data-theme-panel>
      <ThemePanel
        :active="activeThemeId !== undefined"
        :slots="themeSlots"
        :fonts="themeFonts"
        :font-families="THEME_FONT_SUGGESTIONS"
        @set-color="setThemeColor"
        @reset-color="resetThemeColor"
        @set-font="setThemeFont"
        @reset-font="resetThemeFont"
      />
    </Panel>
    <Panel title="素材">
      <AssetLibrary
        :assets="assets"
        :adapter="props.host.adapter"
        :selected-asset-id="props.snapshot.selectedAssetId"
        @select="selectAsset"
        @insert="insertAsset"
        @replace="replaceAsset"
      />
    </Panel>
  </div>
</template>
