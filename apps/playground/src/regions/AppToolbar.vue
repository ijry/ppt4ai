<script setup lang="ts">
import { computed, ref } from 'vue'
import { Undo2, Redo2, Copy, ClipboardPaste, CopyPlus, Plus, Type, Square, Group, Ungroup, RotateCcw, RotateCw, FlipHorizontal, FlipVertical, Trash2, BringToFront, SendToBack, ArrowUp, ArrowDown, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, ZoomIn, ZoomOut, Maximize } from 'lucide-vue-next'
import { ToolbarGroup, IconButton, Divider } from '../ui'
import { toolbarModel } from '../editor/toolbar-model'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'

const props = defineProps<{ snapshot: PlaygroundPresentationSnapshot }>()
const emit = defineEmits<{
  undo: []; redo: []; copy: []; paste: []; add: []; duplicate: []
  'insert-text': []; 'insert-shape': []
  group: []; ungroup: []; rotate: [number]; flip: ['horizontal' | 'vertical']; delete: []
  align: ['left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom']
  distribute: ['horizontal' | 'vertical']
  reorder: ['front' | 'back' | 'forward' | 'backward']
  zoom: ['in' | 'out' | 'fit']
}>()
const m = computed(() => toolbarModel(props.snapshot))
const tabs = [{ id: 'home', label: '开始' }, { id: 'insert', label: '插入' }, { id: 'arrange', label: '排列' }] as const
const tab = ref<'home' | 'insert' | 'arrange'>('home')
</script>
<template>
  <div data-region="toolbar" class="border-b border-border bg-surface shadow-toolbar">
    <!-- Tab strip: brand, tabs, and the always-visible zoom control. -->
    <div class="flex items-center gap-1 px-3 h-11">
      <span class="mr-2 flex items-center gap-2 select-none">
        <span class="grid h-7 w-7 place-items-center rounded-lg bg-primary text-xs font-bold text-white">P</span>
        <span class="text-sm font-semibold tracking-tight">ppt4ai</span>
      </span>
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="rounded-md px-3 h-8 text-sm transition-colors"
        :class="tab === t.id ? 'bg-primary-soft font-medium text-primary' : 'text-muted hover:bg-surface-2 hover:text-text'"
        :data-tab="t.id"
        @click="tab = t.id"
      >{{ t.label }}</button>
      <div class="ml-auto flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
        <IconButton label="缩小" @click="emit('zoom', 'out')"><ZoomOut :size="18" /></IconButton>
        <IconButton label="适应" @click="emit('zoom', 'fit')"><Maximize :size="18" /></IconButton>
        <IconButton label="放大" @click="emit('zoom', 'in')"><ZoomIn :size="18" /></IconButton>
      </div>
    </div>
    <!-- Tool row for the active tab. -->
    <div class="flex items-center gap-2 border-t border-border px-3 h-12">
      <template v-if="tab === 'home'">
        <ToolbarGroup>
          <IconButton data-act="undo" label="撤销" :disabled="!m.canUndo" @click="emit('undo')"><Undo2 :size="18" /></IconButton>
          <IconButton data-act="redo" label="重做" :disabled="!m.canRedo" @click="emit('redo')"><Redo2 :size="18" /></IconButton>
        </ToolbarGroup>
        <Divider />
        <ToolbarGroup>
          <IconButton data-act="copy" label="复制" :disabled="!m.canCopy" @click="emit('copy')"><Copy :size="18" /></IconButton>
          <IconButton data-act="paste" label="粘贴" :disabled="!m.canPaste" @click="emit('paste')"><ClipboardPaste :size="18" /></IconButton>
          <IconButton data-act="duplicate" label="再制" :disabled="!m.hasSelection" @click="emit('duplicate')"><CopyPlus :size="18" /></IconButton>
          <IconButton data-act="add" label="新增页" @click="emit('add')"><Plus :size="18" /></IconButton>
        </ToolbarGroup>
        <Divider />
        <ToolbarGroup>
          <IconButton data-act="delete" label="删除" :disabled="!m.hasSelection" @click="emit('delete')"><Trash2 :size="18" /></IconButton>
        </ToolbarGroup>
      </template>
      <template v-else-if="tab === 'insert'">
        <ToolbarGroup>
          <IconButton data-act="insert-text" label="插入文本" @click="emit('insert-text')"><Type :size="18" /></IconButton>
          <IconButton data-act="insert-shape" label="插入形状" @click="emit('insert-shape')"><Square :size="18" /></IconButton>
        </ToolbarGroup>
      </template>
      <template v-else>
        <ToolbarGroup>
          <IconButton label="组合" :disabled="!m.canGroup" @click="emit('group')"><Group :size="18" /></IconButton>
          <IconButton label="取消组合" :disabled="!m.canUngroup" @click="emit('ungroup')"><Ungroup :size="18" /></IconButton>
          <IconButton label="左旋" :disabled="!m.hasSelection" @click="emit('rotate', -5400000)"><RotateCcw :size="18" /></IconButton>
          <IconButton label="右旋" :disabled="!m.hasSelection" @click="emit('rotate', 5400000)"><RotateCw :size="18" /></IconButton>
          <IconButton label="水平翻转" :disabled="!m.hasSelection" @click="emit('flip', 'horizontal')"><FlipHorizontal :size="18" /></IconButton>
          <IconButton label="垂直翻转" :disabled="!m.hasSelection" @click="emit('flip', 'vertical')"><FlipVertical :size="18" /></IconButton>
        </ToolbarGroup>
        <Divider />
        <ToolbarGroup>
          <IconButton data-act="to-front" label="置于顶层" :disabled="!m.hasSelection" @click="emit('reorder', 'front')"><BringToFront :size="18" /></IconButton>
          <IconButton label="上移一层" :disabled="!m.hasSelection" @click="emit('reorder', 'forward')"><ArrowUp :size="18" /></IconButton>
          <IconButton label="下移一层" :disabled="!m.hasSelection" @click="emit('reorder', 'backward')"><ArrowDown :size="18" /></IconButton>
          <IconButton label="置于底层" :disabled="!m.hasSelection" @click="emit('reorder', 'back')"><SendToBack :size="18" /></IconButton>
        </ToolbarGroup>
        <Divider />
        <ToolbarGroup>
          <IconButton data-act="align-left" label="左对齐" :disabled="!m.hasSelection" @click="emit('align', 'left')"><AlignStartVertical :size="18" /></IconButton>
          <IconButton label="水平居中" :disabled="!m.hasSelection" @click="emit('align', 'centerX')"><AlignCenterVertical :size="18" /></IconButton>
          <IconButton label="右对齐" :disabled="!m.hasSelection" @click="emit('align', 'right')"><AlignEndVertical :size="18" /></IconButton>
          <IconButton label="顶对齐" :disabled="!m.hasSelection" @click="emit('align', 'top')"><AlignStartHorizontal :size="18" /></IconButton>
          <IconButton label="垂直居中" :disabled="!m.hasSelection" @click="emit('align', 'centerY')"><AlignCenterHorizontal :size="18" /></IconButton>
          <IconButton label="底对齐" :disabled="!m.hasSelection" @click="emit('align', 'bottom')"><AlignEndHorizontal :size="18" /></IconButton>
          <IconButton data-act="distribute-h" label="横向分布" :disabled="!m.canDistribute" @click="emit('distribute', 'horizontal')"><AlignHorizontalDistributeCenter :size="18" /></IconButton>
          <IconButton label="纵向分布" :disabled="!m.canDistribute" @click="emit('distribute', 'vertical')"><AlignVerticalDistributeCenter :size="18" /></IconButton>
        </ToolbarGroup>
      </template>
    </div>
  </div>
</template>
