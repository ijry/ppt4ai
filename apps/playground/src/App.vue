<script setup lang="ts">
import type { Color, Fill, SlideBackground, StrokeStyle, TableBorder, TextBody, ThemeColorSlot, ThemeFontScript, ThemeFontSlot } from '@ppt4ai/model'
import type { TableCellSelection } from '@ppt4ai/editor'
import { DEFAULT_THEME_COLORS } from '@ppt4ai/model'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { AssetLibrary, hexFromColor, PptEditor, SlideBackgroundPanel, slideBackgroundModel, THEME_SLOT_GROUPS, ThemePanel, themeFontModels, themeSlotGroup, ThumbnailCanvas, type ThemePanelFontModel, type ThemePanelSlotModel } from '@ppt4ai/editor'
import { normalizeTextElement } from '@ppt4ai/text'
import { useI18n } from 'vue-i18n'
import { ImageFileReadError, readImageUploadFile, type PlaygroundImageUploadInput } from './image-file-upload'
import { createPlaygroundPresentationHost } from './presentation-host'

/**
 * Suggestions for the theme font boxes, not a claim about what is installed: browsers cannot
 * enumerate system fonts, and a theme typeface does not have to exist locally to be written.
 */
const THEME_FONT_SUGGESTIONS: readonly string[] = ['Aptos', 'Aptos Display', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', '宋体', '等线', '微软雅黑']

const { t } = useI18n()
const assetHost = createPlaygroundPresentationHost()
const assetSnapshot = shallowRef(assetHost.getSnapshot())
const activeSlideSnapshot = computed(() => assetSnapshot.value.slides[assetSnapshot.value.activeSlideId]!)
const activeSlideIndex = computed(() => assetSnapshot.value.slideOrder.indexOf(assetSnapshot.value.activeSlideId))
const canMoveSlideUp = computed(() => activeSlideIndex.value > 0)
const canMoveSlideDown = computed(() => activeSlideIndex.value >= 0 && activeSlideIndex.value < assetSnapshot.value.slideOrder.length - 1)
const scene = computed(() => activeSlideSnapshot.value.thumbnailScene)
const textBodies = computed<Record<string, TextBody>>(() => {
  const bodies: Record<string, TextBody> = {}
  for (const element of Object.values(activeSlideSnapshot.value.engineState.document.elements)) {
    if (element.kind === 'text') bodies[element.id] = normalizeTextElement(element)
  }
  return bodies
})
const fileInput = ref<HTMLInputElement>()
const pendingUploadIntent = ref<'insert' | 'replace' | undefined>()
const uploadBusy = ref(false)
const clipboardBusy = ref(false)
const selectedElementIds = computed(() => [...activeSlideSnapshot.value.engineState.selection])
const selectedElementId = computed(() => selectedElementIds.value.length === 1 ? selectedElementIds.value[0] : undefined)
const canUndo = computed(() => activeSlideSnapshot.value.engineState.history.undoDepth > 0 || assetSnapshot.value.presentationHistory.undoDepth > 0)
const canRedo = computed(() => activeSlideSnapshot.value.engineState.history.redoDepth > 0 || assetSnapshot.value.presentationHistory.redoDepth > 0)
const canCopy = computed(() => selectedElementIds.value.length > 0)
const canPaste = computed(() => assetSnapshot.value.clipboard.hasContent && !clipboardBusy.value)
const selectedElementText = computed(() => {
  if (selectedElementIds.value.length === 0) return '—'
  if (selectedElementIds.value.length > 1) return selectedElementIds.value.join(', ')
  const elementId = selectedElementIds.value[0]!
  const element = activeSlideSnapshot.value.engineState.document.elements[elementId]
  return element?.kind === 'image' ? `${element.id} → ${element.assetId}` : elementId
})

const activeThemeId = computed(() => {
  const document = activeSlideSnapshot.value.engineState.document
  const slide = document.slides[assetSnapshot.value.activeSlideId]
  const layout = slide?.layoutId ? document.layouts?.[slide.layoutId] : undefined
  const masterId = slide?.masterId ?? layout?.masterId
  const themeId = masterId ? document.masters?.[masterId]?.themeId : undefined
  return themeId && document.themes?.[themeId] ? themeId : undefined
})
const themeSlots = computed<ThemePanelSlotModel[]>(() => {
  const themeId = activeThemeId.value
  const colors = themeId ? activeSlideSnapshot.value.engineState.document.themes?.[themeId]?.colors : undefined
  if (!colors) return []
  return THEME_SLOT_GROUPS.flatMap((group) => group.slots).map((slot) => {
    const value = colors[slot]
    return {
      slot,
      group: themeSlotGroup(slot),
      color: hexFromColor(value ?? DEFAULT_THEME_COLORS[slot], slot),
      isDefault: value === null,
      inherited: value === undefined,
    }
  })
})

/**
 * The panel shows the colour the scene resolved — slide, layout or master, whichever declared one — and
 * clears only what this slide owns.
 */
type BackgroundTarget = 'slide' | 'layout' | 'master'
const backgroundTarget = ref<BackgroundTarget>('slide')

function ownBackgroundOf(target: BackgroundTarget) {
  const document = activeSlideSnapshot.value.engineState.document
  const slide = document.slides[document.slideOrder[0] ?? '']
  if (target === 'slide') return slide?.background
  const layout = slide?.layoutId ? document.layouts?.[slide.layoutId] : undefined
  if (target === 'layout') return layout?.background
  const masterId = slide?.masterId ?? layout?.masterId
  return masterId ? document.masters?.[masterId]?.background : undefined
}

const slideBackground = computed(() => {
  const document = activeSlideSnapshot.value.engineState.document
  const slideId = document.slideOrder[0]
  const resolvedScene = scene.value
  // The resolved scene colours describe the slide as painted; for the layout/master target the panel
  // edits that part's *own* background, so its declared fill drives the model instead of the scene.
  const own = ownBackgroundOf(backgroundTarget.value)
  if (backgroundTarget.value === 'slide') {
    return slideBackgroundModel(
      slideId ? document.slides[slideId]?.background : undefined,
      resolvedScene?.background,
      resolvedScene?.backgroundGradient,
      slideId !== undefined,
      resolvedScene?.backgroundPattern,
    )
  }
  return slideBackgroundModel(own, undefined, undefined, true, undefined)
})

const slideLayoutChoices = computed(() => {
  const document = activeSlideSnapshot.value.engineState.document
  const slide = document.slides[document.slideOrder[0] ?? '']
  const layout = slide?.layoutId ? document.layouts?.[slide.layoutId] : undefined
  const masterId = slide?.masterId ?? layout?.masterId
  const layouts = Object.values(document.layouts ?? {}).filter((entry) => entry.masterId === masterId)
  return { current: slide?.layoutId ?? '', layouts: layouts.map((entry) => ({ id: entry.id, label: entry.id })) }
})

function setSlideLayout(event: Event): void {
  const layoutId = (event.target as HTMLSelectElement).value
  if (layoutId) assetSnapshot.value = assetHost.setSlideLayout(layoutId)
}

const themeFonts = computed<ThemePanelFontModel[]>(() => {
  const themeId = activeThemeId.value
  const theme = themeId ? activeSlideSnapshot.value.engineState.document.themes?.[themeId] : undefined
  return theme ? themeFontModels(theme.fonts) : []
})

/**
 * The overlay reports anchor and focus points; the engine command takes the focus cell plus an
 * `extend` flag. Note the overlay and the engine each export a `TableCellSelection` and they are
 * different shapes.
 */
function selectTableCell(payload: { elementId: string; selection: TableCellSelection }): void {
  const { elementId, selection } = payload
  const extend = selection.anchor.row !== selection.focus.row || selection.anchor.column !== selection.focus.column
  assetSnapshot.value = assetHost.selectTableCell(elementId, selection.focus.row, selection.focus.column, extend)
}

const tableCellSelection = computed(() => {
  const selection = activeSlideSnapshot.value.engineState.tableCellSelection
  return selection ? { elementId: selection.elementId, row: selection.row, column: selection.column } : undefined
})

function setTableCellText(payload: { elementId: string; point: { row: number; column: number }; body: TextBody }): void {
  const { elementId, point, body } = payload
  assetSnapshot.value = assetHost.setTableCellText(elementId, point.row, point.column, body)
}

function setTableCellFill(fill: Fill | null): void {
  assetSnapshot.value = assetHost.setTableCellFill(fill)
}

function setTableCellBorders(borders: Partial<Record<'left' | 'right' | 'top' | 'bottom', TableBorder | null>>): void {
  assetSnapshot.value = assetHost.setTableCellBorders(borders)
}

function setShapeFill(fill: Fill | null): void {
  assetSnapshot.value = assetHost.setSelectedFill(fill)
}

function setShapeStroke(stroke: Fill | null): void {
  assetSnapshot.value = assetHost.setSelectedStroke(stroke)
}

function setShapeStrokeWidth(width: number | null): void {
  assetSnapshot.value = assetHost.setSelectedStrokeWidth(width)
}

function setShapeStrokeStyle(style: StrokeStyle | null): void {
  assetSnapshot.value = assetHost.setSelectedStrokeStyle(style)
}

function applyBackground(background: SlideBackground | null): void {
  const target = backgroundTarget.value
  assetSnapshot.value = target === 'slide'
    ? assetHost.setSlideBackground(background)
    : target === 'layout'
      ? assetHost.setLayoutBackground(background)
      : assetHost.setMasterBackground(background)
}

function setSlideBackground(color: Color): void {
  applyBackground({ fill: { color } })
}

function clearSlideBackground(): void {
  applyBackground(null)
}

function setSlideBackgroundGradient(fill: Fill): void {
  applyBackground({ fill })
}

function setSlideBackgroundPattern(fill: Fill): void {
  applyBackground({ fill })
}

function setSlideBackgroundPicture(assetId: string): void {
  applyBackground({ pictureFill: { assetId } })
}

const backgroundPictureAssets = computed(() => Object.values(activeSlideSnapshot.value.engineState.document.assets ?? {})
  .map((asset) => ({ id: asset.id, label: asset.originalFilename ?? asset.id })))

function setThemeColor(slot: ThemeColorSlot, color: Color): void {
  assetSnapshot.value = assetHost.setThemeColor(slot, color)
}

function resetThemeColor(slot: ThemeColorSlot): void {
  assetSnapshot.value = assetHost.setThemeColor(slot, null)
}

function setThemeFont(slot: ThemeFontSlot, script: ThemeFontScript, typeface: string): void {
  assetSnapshot.value = assetHost.setThemeFont(slot, script, typeface)
}

function resetThemeFont(slot: ThemeFontSlot, script: ThemeFontScript): void {
  assetSnapshot.value = assetHost.setThemeFont(slot, script, null)
}

function selectAsset(assetId: string): void {
  assetSnapshot.value = assetHost.selectAsset(assetId)
}

function selectSlide(slideId: string): void {
  assetSnapshot.value = assetHost.selectSlide(slideId)
}

function addSlide(): void {
  assetSnapshot.value = assetHost.addSlide()
}

function duplicateSlide(): void {
  assetSnapshot.value = assetHost.duplicateSlide()
}

function deleteSlide(): void {
  assetSnapshot.value = assetHost.deleteSlide()
}

function moveSlide(direction: 'up' | 'down'): void {
  assetSnapshot.value = assetHost.moveSlide(assetSnapshot.value.activeSlideId, direction)
}

function undo(): void {
  if (!canUndo.value) return
  assetSnapshot.value = assetHost.undo()
}

function redo(): void {
  if (!canRedo.value) return
  assetSnapshot.value = assetHost.redo()
}

function copySelected(): void {
  if (!canCopy.value) return
  assetSnapshot.value = assetHost.copySelected()
}

async function paste(): Promise<void> {
  if (!canPaste.value) return
  clipboardBusy.value = true
  try {
    assetSnapshot.value = await assetHost.paste()
  } finally {
    clipboardBusy.value = false
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function handleKeydown(event: KeyboardEvent): void {
  if (isEditableTarget(event.target) || (!event.ctrlKey && !event.metaKey) || event.altKey) return
  const key = event.key.toLowerCase()
  if (key === 'c' && canCopy.value) {
    event.preventDefault()
    copySelected()
  } else if (key === 'v' && canPaste.value) {
    event.preventDefault()
    void paste()
  } else if (key === 'z' && (canUndo.value || (event.shiftKey && canRedo.value))) {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
  } else if (key === 'y' && canRedo.value) {
    event.preventDefault()
    redo()
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))

function selectElements(payload: { elementIds: string[] }): void {
  assetSnapshot.value = assetHost.selectElements(payload.elementIds)
}

function groupSelected(): void {
  assetSnapshot.value = assetHost.groupSelected()
}

function ungroupSelected(payload: { groupId: string }): void {
  assetSnapshot.value = assetHost.ungroupSelected(payload.groupId)
}

function resizeSelected(payload: { elementIds: string[]; bounds: { x: number; y: number; w: number; h: number } }): void {
  assetSnapshot.value = assetHost.resizeSelected(payload.elementIds, payload.bounds)
}

function moveElement(payload: { nodeId: string; dx: number; dy: number }): void {
  if (payload.dx === 0 && payload.dy === 0) return
  assetSnapshot.value = assetHost.moveSelected(payload.nodeId, payload.dx, payload.dy)
}

function resizeElement(payload: { elementId: string; bounds: { x: number; y: number; w: number; h: number } }): void {
  assetSnapshot.value = assetHost.resizeElement(payload.elementId, payload.bounds)
}

function rotateImage(payload: { elementId: string; rotation: number }): void {
  assetSnapshot.value = assetHost.rotateSelectedImage(payload.elementId, payload.rotation)
}

function rotateElement(payload: { elementId: string; rotation: number }): void {
  assetSnapshot.value = assetHost.rotateSelectedElement(payload.elementId, payload.rotation)
}

function rotateSelection(payload: { rotation: number }): void {
  assetSnapshot.value = assetHost.rotateSelection(payload.rotation)
}

function flipImage(payload: { elementId: string; axis: 'horizontal' | 'vertical' }): void {
  assetSnapshot.value = assetHost.toggleSelectedImageFlip(payload.elementId, payload.axis)
}

function flipElement(payload: { elementId: string; axis: 'horizontal' | 'vertical' }): void {
  assetSnapshot.value = assetHost.toggleSelectedElementFlip(payload.elementId, payload.axis)
}

function flipSelection(payload: { axis: 'horizontal' | 'vertical' }): void {
  assetSnapshot.value = assetHost.flipSelection(payload.axis)
}

function updateTextElement(payload: { elementId: string; body: TextBody }): void {
  assetSnapshot.value = assetHost.updateTextElement(payload.elementId, payload.body)
}

function insertAsset(assetId: string): void {
  assetSnapshot.value = assetHost.insertAsset(assetId)
}

function replaceAsset(assetId: string): void {
  assetSnapshot.value = assetHost.replaceSelectedImage(assetId)
}

function statusText(): string {
  const message = assetSnapshot.value.status.message
  if (message === 'image-rotated') return t('status.imageRotated')
  if (message === 'image-flipped') return t('status.imageFlipped')
  return message ? t(`playground.assetHost.status.${message}`) : t('playground.assetHost.status.idle')
}

function openUploadPicker(intent: 'insert' | 'replace'): void {
  if (uploadBusy.value) return
  pendingUploadIntent.value = intent
  fileInput.value?.click()
}

async function uploadFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const intent = pendingUploadIntent.value
  pendingUploadIntent.value = undefined
  if (!file || !intent) {
    input.value = ''
    return
  }
  uploadBusy.value = true
  try {
    const upload: PlaygroundImageUploadInput = await readImageUploadFile(file)
    assetSnapshot.value = intent === 'insert'
      ? await assetHost.uploadAndInsert(upload)
      : await assetHost.uploadAndReplace(upload)
  } catch (error) {
    if (error instanceof ImageFileReadError) {
      const current = assetSnapshot.value
      assetSnapshot.value = {
        ...current,
        status: { kind: 'error', message: 'image-file-read-failed' },
      }
    } else {
      const current = assetSnapshot.value
      assetSnapshot.value = {
        ...current,
        status: { kind: 'error', message: 'image-upload-failed' },
      }
    }
  } finally {
    uploadBusy.value = false
    await nextTick()
    input.value = ''
  }
}
</script>

<template>
  <main class="min-h-screen bg-slate-100 p-4 text-slate-900 sm:p-8">
    <div class="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,32rem)]">
      <section class="min-w-0">
        <PptEditor
          :scene="scene"
          :adapter="assetHost.adapter"
          :snap-options="assetHost.snapOptions"
          :selected-element-id="selectedElementId"
          :selected-element-ids="selectedElementIds"
          :table-cell-selection="tableCellSelection"
          :text-bodies="textBodies"
          @selection-change="selectElements"
          @group="groupSelected"
          @ungroup="ungroupSelected"
          @resize-selection="resizeSelected"
          @move-end="moveElement"
          @resize="resizeElement"
          @rotate-image="rotateImage"
          @rotate-element="rotateElement"
          @rotate-selection="rotateSelection"
          @flip-image="flipImage"
          @flip-element="flipElement"
          @flip-selection="flipSelection"
          @text-edit="updateTextElement"
          @set-fill="setShapeFill"
          @set-stroke="setShapeStroke"
          @set-stroke-width="setShapeStrokeWidth"
          @set-stroke-style="setShapeStrokeStyle"
          @select-table-cell="selectTableCell"
          @set-table-cell-fill="setTableCellFill"
          @set-table-cell-borders="setTableCellBorders"
          @table-cell-text="setTableCellText"
        />
        <nav data-testid="editing-history-toolbar" class="mt-4 flex flex-wrap items-center gap-2" :aria-label="t('playground.history.title')">
          <button data-testid="history-undo" type="button" :disabled="!canUndo" :aria-label="t('playground.history.undo')" :title="t('playground.history.undo')" class="border border-slate-400 px-3 py-1 text-sm hover:border-slate-700 disabled:cursor-not-allowed disabled:opacity-50" @click="undo">
            {{ t('playground.history.undo') }}
          </button>
          <button data-testid="history-redo" type="button" :disabled="!canRedo" :aria-label="t('playground.history.redo')" :title="t('playground.history.redo')" class="border border-slate-400 px-3 py-1 text-sm hover:border-slate-700 disabled:cursor-not-allowed disabled:opacity-50" @click="redo">
            {{ t('playground.history.redo') }}
          </button>
          <button data-testid="clipboard-copy" type="button" :disabled="!canCopy" :aria-label="t('playground.history.copy')" :title="t('playground.history.copy')" class="border border-slate-400 px-3 py-1 text-sm hover:border-slate-700 disabled:cursor-not-allowed disabled:opacity-50" @click="copySelected">
            {{ t('playground.history.copy') }}
          </button>
          <button data-testid="clipboard-paste" type="button" :disabled="!canPaste" :aria-label="t('playground.history.paste')" :title="t('playground.history.paste')" class="border border-slate-400 px-3 py-1 text-sm hover:border-slate-700 disabled:cursor-not-allowed disabled:opacity-50" @click="paste">
            {{ t('playground.history.paste') }}
          </button>
        </nav>
        <section class="mt-8 border border-slate-200 bg-white p-4" :aria-label="t('playground.slides.title')">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-sm font-semibold">{{ t('playground.slides.title') }}</h2>
            <div class="flex flex-wrap gap-2">
              <button data-testid="slide-add" type="button" class="border border-slate-400 px-2 py-1 text-xs hover:border-slate-700" @click="addSlide">
                {{ t('playground.slides.add') }}
              </button>
              <button data-testid="slide-duplicate" type="button" class="border border-slate-400 px-2 py-1 text-xs hover:border-slate-700" @click="duplicateSlide">
                {{ t('playground.slides.duplicate') }}
              </button>
              <button data-testid="slide-delete" type="button" :disabled="assetSnapshot.slideOrder.length <= 1" class="border border-slate-400 px-2 py-1 text-xs hover:border-slate-700 disabled:cursor-not-allowed disabled:opacity-50" @click="deleteSlide">
                {{ t('playground.slides.delete') }}
              </button>
              <button data-testid="slide-move-up" type="button" :disabled="!canMoveSlideUp" class="border border-slate-400 px-2 py-1 text-xs hover:border-slate-700 disabled:cursor-not-allowed disabled:opacity-50" @click="moveSlide('up')">
                {{ t('playground.slides.moveUp') }}
              </button>
              <button data-testid="slide-move-down" type="button" :disabled="!canMoveSlideDown" class="border border-slate-400 px-2 py-1 text-xs hover:border-slate-700 disabled:cursor-not-allowed disabled:opacity-50" @click="moveSlide('down')">
                {{ t('playground.slides.moveDown') }}
              </button>
            </div>
          </div>
          <div data-testid="slide-thumbnail-list" class="mt-3 grid gap-3 sm:grid-cols-2">
            <button
              v-for="(slideId, index) in assetSnapshot.slideOrder"
              :key="slideId"
              :data-testid="`slide-thumbnail-${slideId}`"
              :data-slide-id="slideId"
              :aria-current="assetSnapshot.activeSlideId === slideId ? 'page' : undefined"
              class="min-w-0 border p-2 text-left transition-colors hover:border-slate-500 aria-[current=page]:border-blue-600 aria-[current=page]:ring-2 aria-[current=page]:ring-blue-200"
              type="button"
              @click="selectSlide(slideId)"
            >
              <ThumbnailCanvas
                :scene="assetSnapshot.slides[slideId]!.thumbnailScene"
                :adapter="assetHost.adapter"
                :width="240"
                :height="135"
              />
              <span class="mt-2 block text-xs text-slate-600">{{ t('playground.slides.page', { number: index + 1 }) }}</span>
            </button>
          </div>
        </section>
      </section>

      <aside class="min-w-0 space-y-4">
        <section class="border border-slate-200 bg-white p-4" :aria-label="t('playground.assetHost.uploadTitle')">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-sm font-semibold">{{ t('playground.assetHost.uploadTitle') }}</h2>
            <span v-if="uploadBusy" data-testid="upload-busy" class="text-xs text-slate-500">{{ t('playground.assetHost.uploading') }}</span>
          </div>
          <input
            ref="fileInput"
            data-testid="image-file-input"
            class="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/bmp,image/webp"
            @change="uploadFile"
          >
          <div class="mt-3 flex flex-wrap gap-2">
            <button data-testid="upload-insert" type="button" :disabled="uploadBusy" class="border border-slate-400 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50" @click="openUploadPicker('insert')">
              {{ t('playground.assetHost.uploadInsert') }}
            </button>
            <button data-testid="upload-replace" type="button" :disabled="uploadBusy" class="border border-slate-400 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50" @click="openUploadPicker('replace')">
              {{ t('playground.assetHost.uploadReplace') }}
            </button>
          </div>
        </section>
        <AssetLibrary
          :assets="activeSlideSnapshot.engineState.document.assets"
          :adapter="assetHost.adapter"
          :selected-asset-id="assetSnapshot.selectedAssetId"
          @select="selectAsset"
          @insert="insertAsset"
          @replace="replaceAsset"
        />
        <label v-if="slideLayoutChoices.layouts.length > 1" class="flex items-center gap-2 border border-slate-200 bg-white p-2 text-sm text-slate-700">
          <span>{{ t('panel.slideLayout.label') }}</span>
          <select class="h-8 border border-slate-300 bg-white px-1" data-slide-layout-picker :value="slideLayoutChoices.current" @change="setSlideLayout">
            <option v-for="choice in slideLayoutChoices.layouts" :key="choice.id" :value="choice.id">{{ choice.label }}</option>
          </select>
        </label>
        <label class="flex items-center gap-2 border border-slate-200 bg-white p-2 text-sm text-slate-700">
          <span>{{ t('panel.slideBackground.target') }}</span>
          <select v-model="backgroundTarget" class="h-8 border border-slate-300 bg-white px-1" data-slide-background-target>
            <option value="slide">{{ t('panel.slideBackground.targetSlide') }}</option>
            <option value="layout">{{ t('panel.slideBackground.targetLayout') }}</option>
            <option value="master">{{ t('panel.slideBackground.targetMaster') }}</option>
          </select>
        </label>
        <SlideBackgroundPanel
          :model="slideBackground"
          :picture-assets="backgroundPictureAssets"
          @set-color="setSlideBackground"
          @set-gradient="setSlideBackgroundGradient"
          @set-pattern="setSlideBackgroundPattern"
          @set-picture="setSlideBackgroundPicture"
          @clear="clearSlideBackground"
        />
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
        <section class="border border-slate-200 bg-white p-4 text-sm" :aria-label="t('playground.assetHost.title')">
          <h2 class="font-semibold">{{ t('playground.assetHost.title') }}</h2>
          <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-slate-600">
            <dt>{{ t('playground.assetHost.selectedAsset') }}</dt>
            <dd data-testid="asset-selected" class="font-mono text-slate-900">{{ assetSnapshot.selectedAssetId ?? '—' }}</dd>
            <dt>{{ t('playground.assetHost.selectedElement') }}</dt>
            <dd data-testid="selected-element" class="font-mono text-slate-900">{{ selectedElementText }}</dd>
            <dt>{{ t('playground.assetHost.undoDepth') }}</dt>
            <dd data-testid="undo-depth" class="font-mono text-slate-900">{{ activeSlideSnapshot.engineState.history.undoDepth }}</dd>
            <dt>{{ t('playground.assetHost.redoDepth') }}</dt>
            <dd data-testid="redo-depth" class="font-mono text-slate-900">{{ activeSlideSnapshot.engineState.history.redoDepth }}</dd>
            <dt>{{ t('playground.assetHost.presentationUndoDepth') }}</dt>
            <dd data-testid="presentation-undo-depth" class="font-mono text-slate-900">{{ assetSnapshot.presentationHistory.undoDepth }}</dd>
            <dt>{{ t('playground.assetHost.presentationRedoDepth') }}</dt>
            <dd data-testid="presentation-redo-depth" class="font-mono text-slate-900">{{ assetSnapshot.presentationHistory.redoDepth }}</dd>
            <dt>{{ t('playground.assetHost.clipboard') }}</dt>
            <dd data-testid="clipboard-state" class="font-mono text-slate-900">{{ assetSnapshot.clipboard.rootCount }}</dd>
            <dt>{{ t('playground.assetHost.statusLabel') }}</dt>
            <dd data-testid="asset-status" :class="assetSnapshot.status.kind === 'error' ? 'text-red-700' : 'text-slate-900'">{{ statusText() }}</dd>
          </dl>
        </section>
      </aside>
    </div>
  </main>
</template>
