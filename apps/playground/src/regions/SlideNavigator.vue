<script setup lang="ts">
import type { AssetAdapter } from '@ppt4ai/model'
import { ThumbnailCanvas, type ThumbnailWorkerFactory } from '@ppt4ai/editor'
import { Plus, Copy, Trash2, ChevronUp, ChevronDown } from 'lucide-vue-next'
import { IconButton, Button } from '../ui'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'

// `workerFactory` is optional and only used to inject a stub in tests; production uses the default worker.
const props = defineProps<{ snapshot: PlaygroundPresentationSnapshot; adapter: AssetAdapter; workerFactory?: ThumbnailWorkerFactory }>()
const emit = defineEmits<{
  select: [string]; add: []; duplicate: [string]; delete: [string]
  move: [{ slideId: string; direction: 'up' | 'down' }]
}>()
</script>
<template>
  <div data-region="navigator" class="flex flex-col gap-3 p-3">
    <div class="flex items-center justify-between px-1 pt-1">
      <span class="section-label">幻灯片</span>
      <span class="text-xs font-medium text-faint">{{ props.snapshot.slideOrder.length }}</span>
    </div>
    <Button data-add-slide variant="primary" class="w-full" @click="emit('add')"><Plus :size="16" />新增页</Button>
    <div
      v-for="(id, i) in props.snapshot.slideOrder"
      :key="id"
      :data-slide-item="id"
      class="group relative cursor-pointer rounded-xl border bg-surface p-2 transition-all hover:shadow-card-hover"
      :class="id === props.snapshot.activeSlideId ? 'border-primary ring-2 ring-primary/25' : 'border-border hover:border-border-strong'"
      @click="emit('select', id)"
    >
      <span
        class="absolute left-3 top-3 z-10 grid h-5 min-w-[20px] place-items-center rounded-md px-1 text-[11px] font-semibold"
        :class="id === props.snapshot.activeSlideId ? 'bg-primary text-white' : 'bg-surface-3 text-muted'"
      >{{ i + 1 }}</span>
      <div class="overflow-hidden rounded-lg border border-border bg-white">
        <ThumbnailCanvas :scene="props.snapshot.slides[id]!.thumbnailScene" :adapter="props.adapter" :width="212" :height="119" :worker-factory="props.workerFactory" />
      </div>
      <div class="absolute right-2 top-2 flex gap-0.5 rounded-lg bg-surface/90 p-0.5 opacity-0 shadow-card backdrop-blur transition group-hover:opacity-100">
        <IconButton label="上移" @click.stop="emit('move', { slideId: id, direction: 'up' })"><ChevronUp :size="15" /></IconButton>
        <IconButton label="下移" @click.stop="emit('move', { slideId: id, direction: 'down' })"><ChevronDown :size="15" /></IconButton>
        <IconButton label="复制" @click.stop="emit('duplicate', id)"><Copy :size="15" /></IconButton>
        <IconButton label="删除" @click.stop="emit('delete', id)"><Trash2 :size="15" /></IconButton>
      </div>
    </div>
  </div>
</template>
