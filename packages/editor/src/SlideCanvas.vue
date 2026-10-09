<script setup lang="ts">
import type { AssetAdapter } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  createSlideCanvasRenderer,
  type ImageDecoder,
  type NodePaintOverride,
  type SlideCanvasRenderResult,
  type SlideCanvasRenderer,
} from './slide-canvas-renderer'
import { hitTestScene, marqueeSelect, pointFromCanvasEvent, type CanvasSelectionIntent } from './slide-canvas'

const props = withDefaults(defineProps<{
  scene: SceneGraph
  adapter: AssetAdapter
  decoder?: ImageDecoder
  zoom?: number
  devicePixelRatio?: number
  groupPath?: string[]
  /** Per-element animation overrides (e.g. from a player); a new map reference re-renders the slide. */
  overrides?: ReadonlyMap<string, NodePaintOverride>
}>(), { zoom: 1, groupPath: () => [] })

const emit = defineEmits<{
  render: [result: SlideCanvasRenderResult]
  select: [intent: CanvasSelectionIntent]
  'move-start': [payload: { nodeId: string; point: { x: number; y: number } }]
  move: [payload: { nodeId: string; dx: number; dy: number }]
  'move-end': [payload: { nodeId: string; dx: number; dy: number }]
  marquee: [payload: { elementIds: string[] }]
  activate: [nodeId: string]
  'enter-group': [groupId: string]
}>()

const canvas = ref<HTMLCanvasElement>()
let renderer: SlideCanvasRenderer | undefined
let rendererAdapter: AssetAdapter | undefined
let rendererDecoder: ImageDecoder | undefined
let controller: AbortController | undefined
let drag: { nodeId: string; pointerId: number; start: { x: number; y: number } } | undefined
// A rubber-band selection started on empty canvas. `local` is canvas-px (for drawing); `emu` is scene
// coordinates (for hit-testing). Present only while dragging on empty space.
const marquee = ref<{ pointerId: number; startLocal: { x: number; y: number }; startEmu: { x: number; y: number }; curLocal: { x: number; y: number }; curEmu: { x: number; y: number } }>()

function currentRenderer(): SlideCanvasRenderer {
  if (!renderer || rendererAdapter !== props.adapter || rendererDecoder !== props.decoder) {
    renderer?.dispose()
    renderer = createSlideCanvasRenderer({ adapter: props.adapter, ...(props.decoder ? { decoder: props.decoder } : {}) })
    rendererAdapter = props.adapter
    rendererDecoder = props.decoder
  }
  return renderer
}

async function draw(): Promise<void> {
  controller?.abort()
  const nextController = new AbortController()
  controller = nextController
  await nextTick()
  if (nextController.signal.aborted || !canvas.value) return
  const context = canvas.value.getContext('2d')
  if (!context) return
  const result = await currentRenderer().render(props.scene, context, {
    zoom: props.zoom,
    devicePixelRatio: props.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1,
    signal: nextController.signal,
    ...(props.overrides ? { overrides: props.overrides } : {}),
  })
  if (controller === nextController && !nextController.signal.aborted) emit('render', result)
}

function point(event: PointerEvent): { x: number; y: number } | undefined {
  if (!canvas.value) return
  return pointFromCanvasEvent(event, canvas.value, props.zoom)
}

function localPoint(event: PointerEvent): { x: number; y: number } | undefined {
  if (!canvas.value) return
  const rect = canvas.value.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

/** The marquee rectangle in canvas pixels, for drawing the rubber band. */
const marqueeStyle = computed(() => {
  const m = marquee.value
  if (!m) return undefined
  return {
    left: `${Math.min(m.startLocal.x, m.curLocal.x)}px`,
    top: `${Math.min(m.startLocal.y, m.curLocal.y)}px`,
    width: `${Math.abs(m.curLocal.x - m.startLocal.x)}px`,
    height: `${Math.abs(m.curLocal.y - m.startLocal.y)}px`,
  }
})

function select(event: PointerEvent): void {
  const nextPoint = point(event)
  if (!nextPoint || !canvas.value) return
  const nodeId = hitTestScene(props.scene, nextPoint, props.groupPath)
  emit('select', { nodeId, toggle: event.shiftKey || event.ctrlKey || event.metaKey })
  if (nodeId) {
    drag = { nodeId, pointerId: event.pointerId, start: nextPoint }
    canvas.value.setPointerCapture?.(event.pointerId)
    emit('move-start', { nodeId, point: nextPoint })
    return
  }
  // Empty space: begin a marquee. The deselect above stands for a plain click; a drag past the
  // threshold replaces it with a marquee selection on pointer-up.
  const startLocal = localPoint(event)
  if (!startLocal) return
  marquee.value = { pointerId: event.pointerId, startLocal, startEmu: nextPoint, curLocal: startLocal, curEmu: nextPoint }
  canvas.value.setPointerCapture?.(event.pointerId)
}

function activate(event: MouseEvent): void {
  if (!canvas.value) return
  const nextPoint = pointFromCanvasEvent(event as unknown as PointerEvent, canvas.value, props.zoom)
  if (!nextPoint) return
  const nodeId = hitTestScene(props.scene, nextPoint, props.groupPath)
  if (!nodeId) return
  if (props.scene.groups?.some((group) => group.id === nodeId)) emit('enter-group', nodeId)
  else emit('activate', nodeId)
}

function move(event: PointerEvent): void {
  if (drag && event.pointerId === drag.pointerId) {
    const nextPoint = point(event)
    if (!nextPoint) return
    emit('move', { nodeId: drag.nodeId, dx: nextPoint.x - drag.start.x, dy: nextPoint.y - drag.start.y })
    return
  }
  if (marquee.value && event.pointerId === marquee.value.pointerId) {
    const local = localPoint(event)
    const emu = point(event)
    if (local && emu) marquee.value = { ...marquee.value, curLocal: local, curEmu: emu }
  }
}

function releaseDrag(event: PointerEvent): boolean {
  if (marquee.value && event.pointerId === marquee.value.pointerId) {
    canvas.value?.releasePointerCapture?.(event.pointerId)
    marquee.value = undefined
    return true
  }
  if (!drag || event.pointerId !== drag.pointerId) return false
  canvas.value?.releasePointerCapture?.(event.pointerId)
  drag = undefined
  return true
}

function endMove(event: PointerEvent): void {
  if (drag && event.pointerId === drag.pointerId) {
    const nextPoint = point(event)
    if (nextPoint) emit('move-end', { nodeId: drag.nodeId, dx: nextPoint.x - drag.start.x, dy: nextPoint.y - drag.start.y })
    releaseDrag(event)
    return
  }
  const m = marquee.value
  if (m && event.pointerId === m.pointerId) {
    // Only treat it as a marquee if the pointer actually dragged; a plain click already deselected.
    if (Math.abs(m.curLocal.x - m.startLocal.x) > 3 || Math.abs(m.curLocal.y - m.startLocal.y) > 3) {
      const rect = { x: Math.min(m.startEmu.x, m.curEmu.x), y: Math.min(m.startEmu.y, m.curEmu.y), w: Math.abs(m.curEmu.x - m.startEmu.x), h: Math.abs(m.curEmu.y - m.startEmu.y) }
      emit('marquee', { elementIds: marqueeSelect(props.scene, rect, props.groupPath) })
    }
    releaseDrag(event)
  }
}

function cancelMove(event: PointerEvent): void {
  releaseDrag(event)
}

watch(
  () => [props.scene, props.zoom, props.devicePixelRatio, props.adapter, props.decoder, props.overrides] as const,
  () => { void draw() },
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(() => {
  controller?.abort()
  renderer?.dispose()
})
</script>

<template>
  <div class="relative inline-block max-w-full">
    <canvas ref="canvas" class="block max-w-full" data-slide-canvas @pointerdown="select" @pointermove="move" @pointerup="endMove" @pointercancel="cancelMove" @dblclick="activate" />
    <div v-if="marqueeStyle" class="pointer-events-none absolute border border-blue-500 bg-blue-400/20" data-marquee :style="marqueeStyle" />
  </div>
</template>
