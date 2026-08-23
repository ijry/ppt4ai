<script setup lang="ts">
import type { AssetAdapter } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  createSlideCanvasRenderer,
  type ImageDecoder,
  type SlideCanvasRenderResult,
  type SlideCanvasRenderer,
} from './slide-canvas-renderer'
import { hitTestScene, pointFromCanvasEvent } from './slide-canvas'

const props = withDefaults(defineProps<{
  scene: SceneGraph
  adapter: AssetAdapter
  decoder?: ImageDecoder
  zoom?: number
  devicePixelRatio?: number
}>(), { zoom: 1 })

const emit = defineEmits<{
  render: [result: SlideCanvasRenderResult]
  select: [nodeId: string | undefined]
}>()

const canvas = ref<HTMLCanvasElement>()
let renderer: SlideCanvasRenderer | undefined
let rendererAdapter: AssetAdapter | undefined
let rendererDecoder: ImageDecoder | undefined
let controller: AbortController | undefined

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
  })
  if (controller === nextController && !nextController.signal.aborted) emit('render', result)
}

function select(event: PointerEvent): void {
  if (!canvas.value) return
  const point = pointFromCanvasEvent(event, canvas.value, props.zoom)
  emit('select', hitTestScene(props.scene, point))
}

watch(
  () => [props.scene, props.zoom, props.devicePixelRatio, props.adapter, props.decoder] as const,
  () => { void draw() },
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(() => {
  controller?.abort()
  renderer?.dispose()
})
</script>

<template>
  <canvas ref="canvas" class="block max-w-full" data-slide-canvas @pointerdown="select" />
</template>
