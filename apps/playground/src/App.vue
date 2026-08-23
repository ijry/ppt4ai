<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { AssetLibrary, PptEditor, ThumbnailCanvas } from '@ppt4ai/editor'
import { useI18n } from 'vue-i18n'
import { createPlaygroundAssetHost } from './asset-host'
import { createThumbnailScene, thumbnailAdapter } from './thumbnail-smoke'

const { t } = useI18n()
const assetHost = createPlaygroundAssetHost()
const assetSnapshot = shallowRef(assetHost.getSnapshot())
const activeSlide = ref<'red' | 'blue'>('red')
const scene = computed(() => createThumbnailScene(activeSlide.value))
const thumbnailResult = ref('')
const selectedElementId = computed(() => assetSnapshot.value.engineState.selection.length === 1 ? assetSnapshot.value.engineState.selection[0] : undefined)
const selectedElementText = computed(() => {
  if (!selectedElementId.value) return '—'
  const element = assetSnapshot.value.engineState.document.elements[selectedElementId.value]
  return element?.kind === 'image' ? `${element.id} → ${element.assetId}` : selectedElementId.value
})

function selectAsset(assetId: string): void {
  assetSnapshot.value = assetHost.selectAsset(assetId)
}

function insertAsset(assetId: string): void {
  assetSnapshot.value = assetHost.insertAsset(assetId)
}

function replaceAsset(assetId: string): void {
  assetSnapshot.value = assetHost.replaceSelectedImage(assetId)
}

function statusText(): string {
  const message = assetSnapshot.value.status.message
  return message ? t(`playground.assetHost.status.${message}`) : t('playground.assetHost.status.idle')
}
</script>

<template>
  <main class="min-h-screen bg-slate-100 p-4 text-slate-900 sm:p-8">
    <div class="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,32rem)]">
      <section class="min-w-0">
        <PptEditor>
          <span class="text-slate-500">Slide 1</span>
        </PptEditor>
        <section class="mt-8 border border-slate-200 bg-white p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-sm font-semibold">Thumbnail smoke</h2>
            <button data-testid="thumbnail-next" class="border border-slate-400 px-3 py-1 text-sm" type="button" @click="activeSlide = 'blue'">
              Next
            </button>
          </div>
          <ThumbnailCanvas
            :scene="scene"
            :adapter="thumbnailAdapter"
            :width="320"
            :height="180"
            data-testid="thumbnail-canvas"
            @render="thumbnailResult = JSON.stringify($event)"
          />
          <output data-testid="thumbnail-result" class="mt-2 block text-sm text-slate-600">{{ thumbnailResult }}</output>
        </section>
      </section>

      <aside class="min-w-0 space-y-4">
        <AssetLibrary
          :assets="assetSnapshot.engineState.document.assets"
          :adapter="assetHost.adapter"
          :selected-asset-id="assetSnapshot.selectedAssetId"
          @select="selectAsset"
          @insert="insertAsset"
          @replace="replaceAsset"
        />
        <section class="border border-slate-200 bg-white p-4 text-sm" :aria-label="t('playground.assetHost.title')">
          <h2 class="font-semibold">{{ t('playground.assetHost.title') }}</h2>
          <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-slate-600">
            <dt>{{ t('playground.assetHost.selectedAsset') }}</dt>
            <dd data-testid="asset-selected" class="font-mono text-slate-900">{{ assetSnapshot.selectedAssetId ?? '—' }}</dd>
            <dt>{{ t('playground.assetHost.selectedElement') }}</dt>
            <dd data-testid="selected-element" class="font-mono text-slate-900">{{ selectedElementText }}</dd>
            <dt>{{ t('playground.assetHost.undoDepth') }}</dt>
            <dd data-testid="undo-depth" class="font-mono text-slate-900">{{ assetSnapshot.engineState.history.undoDepth }}</dd>
            <dt>{{ t('playground.assetHost.statusLabel') }}</dt>
            <dd data-testid="asset-status" :class="assetSnapshot.status.kind === 'error' ? 'text-red-700' : 'text-slate-900'">{{ statusText() }}</dd>
          </dl>
        </section>
      </aside>
    </div>
  </main>
</template>
