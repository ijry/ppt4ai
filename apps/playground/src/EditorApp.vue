<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import { createPlaygroundPresentationHost } from './presentation-host'
import { zoomIn, zoomOut, fitZoom } from './editor/zoom'
import AppToolbar from './regions/AppToolbar.vue'
import SlideNavigator from './regions/SlideNavigator.vue'
import CanvasStage from './regions/CanvasStage.vue'
import Inspector from './regions/Inspector.vue'

const host = createPlaygroundPresentationHost()
const snapshot = shallowRef(host.getSnapshot())
const zoom = ref(0.6)

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
function onZoom(kind: 'in' | 'out' | 'fit'): void {
  const page = snapshot.value.slides[snapshot.value.activeSlideId]!.thumbnailScene.page
  zoom.value = kind === 'in' ? zoomIn(zoom.value) : kind === 'out' ? zoomOut(zoom.value) : fitZoom({ w: 960, h: 540 }, page)
}
function onStageUpdate(next: typeof snapshot.value): void { snapshot.value = next }
</script>
<template>
  <div class="grid h-screen grid-rows-[auto_1fr] bg-bg text-text">
    <AppToolbar
      :snapshot="snapshot"
      @undo="undo" @redo="redo" @copy="copySel" @paste="paste" @add="addSlide"
      @group="group" @ungroup="ungroup" @rotate="rotate" @flip="flip" @zoom="onZoom"
    />
    <div class="grid min-h-0 grid-cols-[16rem_1fr_20rem]">
      <SlideNavigator
        :snapshot="snapshot"
        :adapter="host.adapter"
        class="min-h-0 overflow-y-auto border-r border-border bg-surface"
        @select="selectSlide" @add="addSlide" @duplicate="duplicateSlide" @delete="deleteSlide" @move="moveSlide"
      />
      <CanvasStage :snapshot="snapshot" :host="host" :zoom="zoom" class="min-h-0 overflow-auto" @update="onStageUpdate" />
      <Inspector :snapshot="snapshot" class="min-h-0 overflow-y-auto border-l border-border bg-surface" />
    </div>
  </div>
</template>
