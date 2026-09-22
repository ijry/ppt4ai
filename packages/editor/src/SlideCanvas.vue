<script setup lang="ts">
import type { AssetAdapter } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  createSlideCanvasRenderer,
  type ImageDecoder,
  type NodePaintOverride,
  type SlideCanvasRenderResult,
  type SlideCanvasRenderer,
} from './slide-canvas-renderer'
import { hitTestScene, pointFromCanvasEvent, type CanvasSelectionIntent } from './slide-canvas'

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
  activate: [nodeId: string]
  'enter-group': [groupId: string]
}>()

const canvas = ref<HTMLCanvasElement>()
let renderer: SlideCanvasRenderer | undefined
let rendererAdapter: AssetAdapter | undefined
let rendererDecoder: ImageDecoder | undefined
let controller: AbortController | undefined
let drag: { nodeId: string; pointerId: number; start: { x: number; y: number } } | undefined

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

function select(event: PointerEvent): void {
  const nextPoint = point(event)
  if (!nextPoint || !canvas.value) return
  const nodeId = hitTestScene(props.scene, nextPoint, props.groupPath)
  emit('select', { nodeId, toggle: event.shiftKey || event.ctrlKey || event.metaKey })
  if (!nodeId) return
  drag = { nodeId, pointerId: event.pointerId, start: nextPoint }
  canvas.value.setPointerCapture?.(event.pointerId)
  emit('move-start', { nodeId, point: nextPoint })
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
  if (!drag || event.pointerId !== drag.pointerId) return
  const nextPoint = point(event)
  if (!nextPoint) return
  emit('move', { nodeId: drag.nodeId, dx: nextPoint.x - drag.start.x, dy: nextPoint.y - drag.start.y })
}

function releaseDrag(event: PointerEvent): boolean {
  if (!drag || event.pointerId !== drag.pointerId) return false
  canvas.value?.releasePointerCapture?.(event.pointerId)
  drag = undefined
  return true
}

function endMove(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return
  const nextPoint = point(event)
  if (nextPoint) emit('move-end', { nodeId: drag.nodeId, dx: nextPoint.x - drag.start.x, dy: nextPoint.y - drag.start.y })
  releaseDrag(event)
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
  <canvas ref="canvas" class="block max-w-full" data-slide-canvas @pointerdown="select" @pointermove="move" @pointerup="endMove" @pointercancel="cancelMove" @dblclick="activate" />
</template>
