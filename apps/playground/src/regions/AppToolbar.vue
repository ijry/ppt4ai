<script setup lang="ts">
import { computed } from 'vue'
import { Undo2, Redo2, Copy, ClipboardPaste, Plus, Group, Ungroup, RotateCcw, RotateCw, FlipHorizontal, FlipVertical, ZoomIn, ZoomOut, Maximize } from 'lucide-vue-next'
import { Toolbar, ToolbarGroup, IconButton, Divider } from '../ui'
import { toolbarModel } from '../editor/toolbar-model'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'

const props = defineProps<{ snapshot: PlaygroundPresentationSnapshot }>()
const emit = defineEmits<{
  undo: []; redo: []; copy: []; paste: []; add: []
  group: []; ungroup: []; rotate: [number]; flip: ['horizontal' | 'vertical']
  zoom: ['in' | 'out' | 'fit']
}>()
const m = computed(() => toolbarModel(props.snapshot))
</script>
<template>
  <Toolbar data-region="toolbar">
    <ToolbarGroup>
      <IconButton data-act="undo" label="撤销" :disabled="!m.canUndo" @click="emit('undo')"><Undo2 :size="18" /></IconButton>
      <IconButton data-act="redo" label="重做" :disabled="!m.canRedo" @click="emit('redo')"><Redo2 :size="18" /></IconButton>
    </ToolbarGroup>
    <Divider />
    <ToolbarGroup>
      <IconButton data-act="copy" label="复制" :disabled="!m.canCopy" @click="emit('copy')"><Copy :size="18" /></IconButton>
      <IconButton data-act="paste" label="粘贴" :disabled="!m.canPaste" @click="emit('paste')"><ClipboardPaste :size="18" /></IconButton>
      <IconButton data-act="add" label="新增页" @click="emit('add')"><Plus :size="18" /></IconButton>
    </ToolbarGroup>
    <Divider />
    <ToolbarGroup>
      <IconButton label="组合" :disabled="!m.canGroup" @click="emit('group')"><Group :size="18" /></IconButton>
      <IconButton label="取消组合" :disabled="!m.canUngroup" @click="emit('ungroup')"><Ungroup :size="18" /></IconButton>
      <IconButton label="左旋" :disabled="!m.hasSelection" @click="emit('rotate', -5400000)"><RotateCcw :size="18" /></IconButton>
      <IconButton label="右旋" :disabled="!m.hasSelection" @click="emit('rotate', 5400000)"><RotateCw :size="18" /></IconButton>
      <IconButton label="水平翻转" :disabled="!m.hasSelection" @click="emit('flip', 'horizontal')"><FlipHorizontal :size="18" /></IconButton>
      <IconButton label="垂直翻转" :disabled="!m.hasSelection" @click="emit('flip', 'vertical')"><FlipVertical :size="18" /></IconButton>
    </ToolbarGroup>
    <div class="ml-auto flex items-center gap-0.5">
      <IconButton label="缩小" @click="emit('zoom', 'out')"><ZoomOut :size="18" /></IconButton>
      <IconButton label="适应" @click="emit('zoom', 'fit')"><Maximize :size="18" /></IconButton>
      <IconButton label="放大" @click="emit('zoom', 'in')"><ZoomIn :size="18" /></IconButton>
    </div>
  </Toolbar>
</template>
