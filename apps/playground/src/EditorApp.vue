<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { createPlaygroundPresentationHost } from './presentation-host'
import { readImageUploadFile } from './image-file-upload'
import { zoomIn, zoomOut, fitZoom } from './editor/zoom'
import AppToolbar from './regions/AppToolbar.vue'
import SlideNavigator from './regions/SlideNavigator.vue'
import CanvasStage from './regions/CanvasStage.vue'
import Inspector from './regions/Inspector.vue'
import PresentationView from './PresentationView.vue'

const host = createPlaygroundPresentationHost()
const snapshot = shallowRef(host.getSnapshot())
const zoom = ref(0.6)
const presenting = ref(false)
const scenes = computed(() => snapshot.value.slideOrder.map((id) => snapshot.value.slides[id]!.thumbnailScene))
const activeIndex = computed(() => snapshot.value.slideOrder.indexOf(snapshot.value.activeSlideId))
function present(): void { presenting.value = true }

function selectSlide(id: string): void { snapshot.value = host.selectSlide(id) }
function addSlide(): void { snapshot.value = host.addSlide() }
function duplicateSlide(id: string): void { host.selectSlide(id); snapshot.value = host.duplicateSlide() }
function deleteSlide(id: string): void { host.selectSlide(id); snapshot.value = host.deleteSlide() }
function moveSlide(p: { slideId: string; direction: 'up' | 'down' }): void { snapshot.value = host.moveSlide(p.slideId, p.direction) }

function undo(): void { snapshot.value = host.undo() }
function redo(): void { snapshot.value = host.redo() }
function copySel(): void { snapshot.value = host.copySelected() }
async function paste(): Promise<void> { snapshot.value = await host.paste() }
function group(): void { snapshot.value = host.groupSelected() }
function ungroup(): void {
  const slide = snapshot.value.slides[snapshot.value.activeSlideId]!
  const groupId = [...slide.engineState.selection][0]
  if (groupId) snapshot.value = host.ungroupSelected(groupId)
}
function rotate(deg: number): void { snapshot.value = host.rotateSelection(deg) }
function flip(axis: 'horizontal' | 'vertical'): void { snapshot.value = host.flipSelection(axis) }
function insertText(): void { snapshot.value = host.insertText() }
function insertShape(preset: string): void { snapshot.value = host.insertShape(preset) }
const imageInput = ref<HTMLInputElement>()
function insertImage(): void { imageInput.value?.click() }
async function onImageFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    snapshot.value = await host.uploadAndInsert(await readImageUploadFile(file))
  } catch { /* a bad/unreadable image is surfaced via host status; ignore here */ }
}
function reorder(action: 'front' | 'back' | 'forward' | 'backward'): void {
  snapshot.value = action === 'front' ? host.bringToFront()
    : action === 'back' ? host.sendToBack()
      : action === 'forward' ? host.bringForward() : host.sendBackward()
}
function deleteSelected(): void { snapshot.value = host.deleteSelected() }
function duplicate(): void { snapshot.value = host.duplicateSelected() }
function align(edge: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'): void {
  const count = snapshot.value.slides[snapshot.value.activeSlideId]!.engineState.selection.length
  snapshot.value = host.alignSelected(edge, count >= 2 ? 'selection' : 'slide')
}
function distribute(axis: 'horizontal' | 'vertical'): void { snapshot.value = host.distributeSelected(axis) }

// Delete/Backspace removes the selection, unless the user is typing in a field or editing text.
function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}
function onKeydown(event: KeyboardEvent): void {
  if (isEditableTarget(event.target)) return
  const selection = snapshot.value.slides[snapshot.value.activeSlideId]!.engineState.selection
  if ((event.ctrlKey || event.metaKey) && (event.key === 'd' || event.key === 'D')) {
    if (selection.length === 0) return
    event.preventDefault()
    snapshot.value = host.duplicateSelected()
    return
  }
  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  if (selection.length === 0) return
  event.preventDefault()
  snapshot.value = host.deleteSelected()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
function onZoom(kind: 'in' | 'out' | 'fit'): void {
  const page = snapshot.value.slides[snapshot.value.activeSlideId]!.thumbnailScene.page
  zoom.value = kind === 'in' ? zoomIn(zoom.value) : kind === 'out' ? zoomOut(zoom.value) : fitZoom({ w: 960, h: 540 }, page)
}
function onStageUpdate(next: typeof snapshot.value): void { snapshot.value = next }
</script>
<template>
  <div class="grid h-screen grid-rows-[auto_1fr] bg-bg text-text font-sans antialiased">
    <input ref="imageInput" type="file" accept="image/*" class="hidden" data-image-input @change="onImageFile" />
    <AppToolbar
      :snapshot="snapshot"
      @undo="undo" @redo="redo" @copy="copySel" @paste="paste" @add="addSlide"
      @insert-text="insertText" @insert-shape="insertShape" @insert-image="insertImage" @reorder="reorder" @delete="deleteSelected" @align="align" @distribute="distribute" @duplicate="duplicate"
      @group="group" @ungroup="ungroup" @rotate="rotate" @flip="flip" @zoom="onZoom" @present="present"
    />
    <div class="grid min-h-0 grid-cols-[17rem_1fr_26rem]">
      <SlideNavigator
        :snapshot="snapshot"
        :adapter="host.adapter"
        class="min-h-0 overflow-y-auto border-r border-border bg-surface"
        @select="selectSlide" @add="addSlide" @duplicate="duplicateSlide" @delete="deleteSlide" @move="moveSlide"
      />
      <CanvasStage :snapshot="snapshot" :host="host" :zoom="zoom" class="min-h-0 overflow-auto" @update="onStageUpdate" />
      <Inspector :snapshot="snapshot" :host="host" class="min-h-0 overflow-y-auto border-l border-border bg-bg" @update="onStageUpdate" />
    </div>
    <PresentationView v-if="presenting" :scenes="scenes" :adapter="host.adapter" :start-index="activeIndex" @exit="presenting = false" />
  </div>
</template>
