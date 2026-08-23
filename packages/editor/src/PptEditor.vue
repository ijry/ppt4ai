<script setup lang="ts">
import type { AssetAdapter } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SlideCanvas from './SlideCanvas.vue'
import SelectionOverlay from './SelectionOverlay.vue'
import type { ImageDecoder } from './image-canvas-renderer'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  scene?: SceneGraph
  adapter?: AssetAdapter
  decoder?: ImageDecoder
  selectedElementId?: string
  zoom?: number
  devicePixelRatio?: number
}>(), { zoom: 1 })

const emit = defineEmits<{
  select: [nodeId: string | undefined]
  render: [result: unknown]
}>()

const EMU_TO_CSS_PIXEL = 96 / 914400

function selectedBounds(): { x: number; y: number; w: number; h: number } | undefined {
  if (!props.scene || !props.selectedElementId) return undefined
  const node = props.scene.nodes.find((entry) => entry.id === props.selectedElementId)
  if (!node) return undefined
  const scale = EMU_TO_CSS_PIXEL * props.zoom
  return { x: node.bounds.x * scale, y: node.bounds.y * scale, w: node.bounds.w * scale, h: node.bounds.h * scale }
}

const canvasProps = computed(() => ({
  scene: props.scene!,
  adapter: props.adapter!,
  ...(props.decoder ? { decoder: props.decoder } : {}),
  zoom: props.zoom,
  ...(props.devicePixelRatio === undefined ? {} : { devicePixelRatio: props.devicePixelRatio }),
}))
</script>

<template>
  <section class="ppt-editor" aria-labelledby="ppt-editor-toolbar">
    <header id="ppt-editor-toolbar" class="ppt-editor__toolbar">
      <button type="button" class="ppt-editor__button">
        {{ t('toolbar.insert.shape') }}
      </button>
    </header>
    <div class="ppt-editor__canvas relative" role="img" :aria-label="t('editor.canvas.ariaLabel')">
      <template v-if="props.scene && props.adapter">
        <SlideCanvas
          v-bind="canvasProps"
          @select="emit('select', $event)"
          @render="emit('render', $event)"
        />
        <SelectionOverlay v-if="selectedBounds()" active :bounds="selectedBounds()!" />
      </template>
      <slot v-else />
    </div>
  </section>
</template>
