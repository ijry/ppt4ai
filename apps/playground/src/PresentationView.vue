<script setup lang="ts">
import type { AssetAdapter } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { SlideCanvas } from '@ppt4ai/editor'

const EMU_PER_CSS_PIXEL = 914400 / 96

const props = defineProps<{ scenes: SceneGraph[]; adapter: AssetAdapter; startIndex?: number }>()
const emit = defineEmits<{ exit: [] }>()

const index = ref(props.startIndex ?? 0)
const scene = computed(() => props.scenes[index.value])
const viewport = ref({ w: globalThis.innerWidth || 1280, h: globalThis.innerHeight || 720 })

// Fit the slide inside the viewport (with a small margin), the same zoom the canvas renderer expects.
const zoom = computed(() => {
  const page = scene.value?.page
  if (!page || page.w <= 0 || page.h <= 0) return 1
  return Math.min(viewport.value.w * EMU_PER_CSS_PIXEL / page.w, viewport.value.h * EMU_PER_CSS_PIXEL / page.h) * 0.94
})

function next(): void { if (index.value < props.scenes.length - 1) index.value += 1 }
function prev(): void { if (index.value > 0) index.value -= 1 }
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') { emit('exit'); return }
  if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown' || event.key === 'Enter') { event.preventDefault(); next() }
  else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); prev() }
}
function onResize(): void { viewport.value = { w: globalThis.innerWidth, h: globalThis.innerHeight } }
onMounted(() => { window.addEventListener('keydown', onKey); window.addEventListener('resize', onResize) })
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize) })
</script>
<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black" data-presentation @click="next">
    <div v-if="scene" class="bg-white shadow-2xl">
      <SlideCanvas :scene="scene" :adapter="props.adapter" :zoom="zoom" />
    </div>
    <div class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
      {{ index + 1 }} / {{ props.scenes.length }} · ← → 翻页 · Esc 退出
    </div>
    <button type="button" class="absolute right-3 top-3 rounded-md bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20" data-presentation-exit @click.stop="emit('exit')">退出</button>
  </div>
</template>
