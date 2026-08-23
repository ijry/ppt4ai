<script setup lang="ts">
import { computed, ref } from 'vue'
import { PptEditor, ThumbnailCanvas } from '@ppt4ai/editor'
import { createThumbnailScene, thumbnailAdapter } from './thumbnail-smoke'

const activeSlide = ref<'red' | 'blue'>('red')
const scene = computed(() => createThumbnailScene(activeSlide.value))
const thumbnailResult = ref('')
</script>

<template>
  <main class="min-h-screen bg-slate-100 p-8 text-slate-900">
    <PptEditor>
      <span class="text-slate-500">Slide 1</span>
    </PptEditor>
    <section class="mt-8">
      <ThumbnailCanvas
        :scene="scene"
        :adapter="thumbnailAdapter"
        :width="320"
        :height="180"
        data-testid="thumbnail-canvas"
        @render="thumbnailResult = JSON.stringify($event)"
      />
      <output data-testid="thumbnail-result" class="block text-sm">{{ thumbnailResult }}</output>
      <button data-testid="thumbnail-next" class="mt-2 border border-slate-400 px-3 py-1" type="button" @click="activeSlide = 'blue'">
        Next
      </button>
    </section>
  </main>
</template>
