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
  <div data-region="navigator" class="flex flex-col gap-2 p-2">
    <Button data-add-slide variant="primary" @click="emit('add')"><Plus :size="16" />新增页</Button>
    <div
      v-for="(id, i) in props.snapshot.slideOrder"
      :key="id"
      :data-slide-item="id"
      class="group cursor-pointer rounded-md border p-1"
      :class="id === props.snapshot.activeSlideId ? 'border-primary' : 'border-border'"
      @click="emit('select', id)"
    >
      <div class="flex items-center gap-1">
        <span class="w-5 text-center text-xs text-muted">{{ i + 1 }}</span>
        <ThumbnailCanvas :scene="props.snapshot.slides[id]!.thumbnailScene" :adapter="props.adapter" :width="200" :height="112" :worker-factory="props.workerFactory" />
      </div>
      <div class="mt-1 hidden items-center justify-end gap-0.5 group-hover:flex">
        <IconButton label="上移" @click.stop="emit('move', { slideId: id, direction: 'up' })"><ChevronUp :size="16" /></IconButton>
        <IconButton label="下移" @click.stop="emit('move', { slideId: id, direction: 'down' })"><ChevronDown :size="16" /></IconButton>
        <IconButton label="复制" @click.stop="emit('duplicate', id)"><Copy :size="16" /></IconButton>
        <IconButton label="删除" @click.stop="emit('delete', id)"><Trash2 :size="16" /></IconButton>
      </div>
    </div>
  </div>
</template>
