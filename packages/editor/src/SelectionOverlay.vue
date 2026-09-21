<script setup lang="ts">
import type { Rect } from '@ppt4ai/model'
import {
  createSelectionOverlay,
  type Point,
  type RotatePointerPayload,
  type SelectionHandle,
  type ResizePointerPayload,
} from './selection-overlay'

const props = withDefaults(defineProps<{
  active: boolean
  bounds: Rect
  handleSize?: number
  showHandles?: boolean
  rotation?: number
  showRotationHandle?: boolean
}>(), {
  handleSize: 8,
  showHandles: true,
  rotation: 0,
  showRotationHandle: false,
})

const emit = defineEmits<{
  'resize-start': [payload: ResizePointerPayload]
  resize: [payload: ResizePointerPayload]
  'resize-end': [payload: ResizePointerPayload]
  'resize-cancel': [payload: ResizePointerPayload]
  'rotate-start': [payload: RotatePointerPayload]
  rotate: [payload: RotatePointerPayload]
  'rotate-end': [payload: RotatePointerPayload]
  'rotate-cancel': [payload: RotatePointerPayload]
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

function emitPointer(eventName: 'resize-start' | 'resize' | 'resize-end' | 'resize-cancel', handle: SelectionHandle, event: PointerEvent): void {
  const payload: ResizePointerPayload = { handle, point: pointFromEvent(event), shiftKey: event.shiftKey, altKey: event.altKey }
  const target = event.currentTarget as HTMLButtonElement | null
  if (eventName === 'resize-start') target?.setPointerCapture?.(event.pointerId)
  if (eventName === 'resize-end' || eventName === 'resize-cancel') target?.releasePointerCapture?.(event.pointerId)
  switch (eventName) {
    case 'resize-start': emit('resize-start', payload); break
    case 'resize': emit('resize', payload); break
    case 'resize-end': emit('resize-end', payload); break
    case 'resize-cancel': emit('resize-cancel', payload); break
  }
}

function emitRotatePointer(eventName: 'rotate-start' | 'rotate' | 'rotate-end' | 'rotate-cancel', event: PointerEvent): void {
  const payload: RotatePointerPayload = { point: pointFromEvent(event), shiftKey: event.shiftKey }
  const target = event.currentTarget as HTMLButtonElement | null
  if (eventName === 'rotate-start') target?.setPointerCapture?.(event.pointerId)
  if (eventName === 'rotate-end' || eventName === 'rotate-cancel') target?.releasePointerCapture?.(event.pointerId)
  switch (eventName) {
    case 'rotate-start': emit('rotate-start', payload); break
    case 'rotate': emit('rotate', payload); break
    case 'rotate-end': emit('rotate-end', payload); break
    case 'rotate-cancel': emit('rotate-cancel', payload); break
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
        transform: `rotate(${props.rotation / 60000}deg)`,
        transformOrigin: 'center center',
      }"
    />
    <div
      class="pointer-events-none absolute"
      data-selection-frame
      :style="{
        left: `${props.bounds.x}px`,
        top: `${props.bounds.y}px`,
        width: `${props.bounds.w}px`,
        height: `${props.bounds.h}px`,
        transform: `rotate(${props.rotation / 60000}deg)`,
        transformOrigin: 'center center',
      }"
    >
      <button
        v-if="props.showHandles"
        v-for="handle in createSelectionOverlay({ x: 0, y: 0, w: props.bounds.w, h: props.bounds.h }, { handleSize: props.handleSize }).handles"
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
        @pointercancel="emitPointer('resize-cancel', handle.name, $event)"
      />
      <div
        v-if="props.showRotationHandle"
        class="pointer-events-none absolute bg-blue-500"
        data-selection-rotation-connector
        :style="{
          left: `${props.bounds.w / 2 - 1}px`,
          top: '-24px',
          width: '2px',
          height: '24px',
        }"
      />
      <button
        v-if="props.showRotationHandle"
        type="button"
        class="pointer-events-auto absolute rounded-full border border-blue-600 bg-white cursor-grab"
        data-selection-rotation-handle
        aria-label="Rotate selection"
        :style="{
          left: `${props.bounds.w / 2 - props.handleSize / 2}px`,
          top: `${-24 - props.handleSize}px`,
          width: `${props.handleSize}px`,
          height: `${props.handleSize}px`,
        }"
        @pointerdown="emitRotatePointer('rotate-start', $event)"
        @pointermove="emitRotatePointer('rotate', $event)"
        @pointerup="emitRotatePointer('rotate-end', $event)"
        @pointercancel="emitRotatePointer('rotate-cancel', $event)"
      />
    </div>
  </div>
</template>
