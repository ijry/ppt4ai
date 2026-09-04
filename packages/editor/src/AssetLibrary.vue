<script setup lang="ts">
import type { AssetAdapter, AssetMetadata } from '@ppt4ai/model'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createAssetLibraryModel } from './asset-library'
import ThumbnailCanvas from './ThumbnailCanvas.vue'
import type { ThumbnailWorkerFactory } from './thumbnail-renderer'
import type { ThumbnailRenderResult } from './thumbnail-protocol'

const props = withDefaults(defineProps<{
  assets?: Record<string, AssetMetadata>
  adapter: AssetAdapter
  selectedAssetId?: string
  thumbnailWidth?: number
  thumbnailHeight?: number
  resourceContext?: string
  workerFactory?: ThumbnailWorkerFactory
}>(), {
  thumbnailWidth: 160,
  thumbnailHeight: 90,
})

const emit = defineEmits<{
  select: [assetId: string]
  insert: [assetId: string]
  replace: [assetId: string]
}>()

const { t } = useI18n()
const failedAssetIds = ref(new Set<string>())
const model = computed(() => createAssetLibraryModel(props.assets, props.selectedAssetId))

function select(assetId: string): void {
  emit('select', assetId)
}

function renderFinished(itemId: string, result: ThumbnailRenderResult): void {
  markFailure(itemId, result.issues.length > 0)
}

/**
 * A renderer-level failure means the same thing to the reader as a per-node issue does — this asset
 * has no thumbnail — so it reuses the message rather than inventing a second one.
 */
function renderFailed(itemId: string): void {
  markFailure(itemId, true)
}

function markFailure(itemId: string, failed: boolean): void {
  if (failedAssetIds.value.has(itemId) === failed) return
  const next = new Set(failedAssetIds.value)
  if (failed) next.add(itemId)
  else next.delete(itemId)
  failedAssetIds.value = next
}
</script>

<template>
  <section class="w-full max-w-2xl border border-zinc-200 bg-white text-zinc-900" aria-labelledby="asset-library-title">
    <header class="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
      <h2 id="asset-library-title" class="text-sm font-semibold">{{ t('assetLibrary.title') }}</h2>
      <span class="text-xs text-zinc-500">{{ model.items.length }}</span>
    </header>
    <div v-if="model.items.length === 0" role="status" class="px-4 py-8 text-center text-sm text-zinc-500">
      {{ t('assetLibrary.empty') }}
    </div>
    <ul v-else class="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2" :aria-label="t('assetLibrary.title')">
      <li
        v-for="item in model.items"
        :key="item.id"
        :data-asset-id="item.id"
        class="min-w-0 border bg-zinc-50 p-2 transition-colors duration-200"
        :class="model.selectedAssetId === item.id ? 'border-pink-500' : 'border-zinc-200'"
      >
        <button
          type="button"
          data-asset-select
          class="block w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500"
          :aria-pressed="model.selectedAssetId === item.id"
          :aria-label="item.displayName"
          @click="select(item.id)"
          @keydown.enter.prevent="select(item.id)"
          @dblclick="emit('insert', item.id)"
        >
          <div class="flex items-center justify-center overflow-hidden bg-zinc-100" :style="{ width: `${thumbnailWidth}px`, height: `${thumbnailHeight}px` }">
            <ThumbnailCanvas
              :scene="{ slideId: item.id, page: { w: item.metadata.pixelWidth ?? 1, h: item.metadata.pixelHeight ?? 1 }, nodes: [{ id: item.id, kind: 'image', bounds: { x: 0, y: 0, w: item.metadata.pixelWidth ?? 1, h: item.metadata.pixelHeight ?? 1 }, assetId: item.id, metadata: item.metadata }] }"
              :adapter="adapter"
              :width="thumbnailWidth"
              :height="thumbnailHeight"
              v-bind="{
                ...(resourceContext === undefined ? {} : { resourceContext }),
                ...(workerFactory === undefined ? {} : { workerFactory }),
              }"
              @render="renderFinished(item.id, $event)"
              @error="renderFailed(item.id)"
            />
          </div>
          <div class="mt-2 truncate text-sm font-medium" :title="item.displayName">{{ item.metadata.originalFilename ?? t('assetLibrary.unnamed', { id: item.id }) }}</div>
          <div class="mt-1 text-xs text-zinc-500">{{ item.formatLabel }} · {{ item.metadata.pixelWidth === undefined || item.metadata.pixelHeight === undefined ? t('assetLibrary.unknownDimensions') : item.dimensionsLabel }}</div>
        </button>
        <div v-if="failedAssetIds.has(item.id)" role="status" class="mt-2 text-xs text-red-700">{{ t('assetLibrary.thumbnailFailure') }}</div>
        <div class="mt-2 flex gap-2">
          <button type="button" data-asset-insert class="cursor-pointer border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500" @click="emit('insert', item.id)">{{ t('assetLibrary.insert') }}</button>
          <button type="button" data-asset-replace class="cursor-pointer border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500" @click="emit('replace', item.id)">{{ t('assetLibrary.replace') }}</button>
        </div>
      </li>
    </ul>
  </section>
</template>
