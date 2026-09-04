<script setup lang="ts">
import type { AssetAdapter } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import {
  createThumbnailRenderer,
  type ThumbnailWorkerFactory,
} from './thumbnail-renderer'
import type { ThumbnailRenderResult } from './thumbnail-protocol'

const props = withDefaults(defineProps<{
  scene: SceneGraph
  adapter: AssetAdapter
  width: number
  height: number
  devicePixelRatio?: number
  resourceContext?: string
  workerFactory?: ThumbnailWorkerFactory
}>(), {
  devicePixelRatio: 1,
})

const emit = defineEmits<{
  render: [result: ThumbnailRenderResult]
  error: [error: unknown]
}>()

const canvas = ref<HTMLCanvasElement>()
const renderer = createThumbnailRenderer({
  adapter: props.adapter,
  ...(props.workerFactory ? { workerFactory: props.workerFactory } : {}),
  ...(props.resourceContext ? { resourceContext: props.resourceContext } : {}),
})
let disposed = false

/**
 * Both callers below are fire-and-forget (`void renderThumbnail()`), so a rethrow here would land
 * nowhere and surface as an unhandled rejection — which is what it used to do. A cancelled render is
 * a normal path and stays silent; anything else is reported so the host can show a placeholder.
 */
async function renderThumbnail(): Promise<void> {
  if (disposed || !canvas.value) return
  renderer.cancel()
  try {
    const result = await renderer.render(toRaw(props.scene), canvas.value, {
      width: props.width,
      height: props.height,
      devicePixelRatio: props.devicePixelRatio,
    })
    if (!disposed) emit('render', result)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    if (!disposed) emit('error', error)
  }
}

onMounted(() => { void renderThumbnail() })

watch(
  () => [props.scene, props.width, props.height, props.devicePixelRatio] as const,
  () => { void renderThumbnail() },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  disposed = true
  renderer.dispose()
})
</script>

<template>
  <canvas ref="canvas" data-thumbnail-canvas class="block max-w-full" />
</template>
