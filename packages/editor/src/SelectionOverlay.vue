<script setup lang="ts">
import type { Rect } from '@ppt4ai/model'
import {
  createSelectionOverlay,
  type Point,
  type SelectionHandle,
} from './selection-overlay'

const props = withDefaults(defineProps<{
  active: boolean
  bounds: Rect
  handleSize?: number
}>(), {
  handleSize: 8,
})

const emit = defineEmits<{
  'resize-start': [payload: { handle: SelectionHandle; point: Point }]
  resize: [payload: { handle: SelectionHandle; point: Point }]
  'resize-end': [payload: { handle: SelectionHandle; point: Point }]
}>()

const handleCursor: Record<SelectionHandle, string> = {
  nw: 'cursor-nwse-resize',
  n: 'cursor-ns-resize',
  ne: 'cursor-nesw-resize',
  e: 'cursor-ew-resize',
  se: 'cursor-nwse-resize',
  s: 'cursor-ns-resize',
  sw: 'cursor-nesw-resize',
  w: 'cursor-ew-resize',
}

function pointFromEvent(event: PointerEvent): Point {
  return { x: event.clientX, y: event.clientY }
}

function emitPointer(eventName: 'resize-start' | 'resize' | 'resize-end', handle: SelectionHandle, event: PointerEvent): void {
  const payload = { handle, point: pointFromEvent(event) }
  switch (eventName) {
    case 'resize-start': emit('resize-start', payload); break
    case 'resize': emit('resize', payload); break
    case 'resize-end': emit('resize-end', payload); break
  }
}
</script>

<template>
  <div v-if="props.active" class="ppt-selection-overlay pointer-events-none absolute" data-selection-overlay>
    <div
      class="pointer-events-none absolute border-2 border-blue-500"
      data-selection-border
      :style="{
        left: `${props.bounds.x}px`,
        top: `${props.bounds.y}px`,
        width: `${props.bounds.w}px`,
        height: `${props.bounds.h}px`,
      }"
    />
    <button
      v-for="handle in createSelectionOverlay(props.bounds, { handleSize: props.handleSize }).handles"
      :key="handle.name"
      type="button"
      :class="['pointer-events-auto absolute h-2 w-2 border border-blue-600 bg-white', handleCursor[handle.name]]"
      :data-selection-handle="handle.name"
      :aria-label="`Resize ${handle.name}`"
      :style="{
        left: `${handle.rect.x}px`,
        top: `${handle.rect.y}px`,
        width: `${handle.rect.w}px`,
        height: `${handle.rect.h}px`,
      }"
      @pointerdown="emitPointer('resize-start', handle.name, $event)"
      @pointermove="emitPointer('resize', handle.name, $event)"
      @pointerup="emitPointer('resize-end', handle.name, $event)"
    />
  </div>
</template>
