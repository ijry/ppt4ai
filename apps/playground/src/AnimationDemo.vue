<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from 'vue'
import { SlideCanvas } from '@ppt4ai/editor'
import type { OverridePaintTransform } from '@ppt4ai/player'
import { createAnimationDemo } from './animation-demo-host'

const demo = createAnimationDemo()
const overrides = shallowRef<Map<string, OverridePaintTransform>>(new Map())
const player = demo.createPlayer((next) => { overrides.value = next })

onBeforeUnmount(() => player.dispose())
</script>

<template>
  <div class="p-4 space-y-3">
    <h1 class="text-lg font-semibold">动画演示</h1>
    <div class="flex gap-2">
      <button class="px-3 py-1 border rounded" data-demo-play @click="player.play()">播放</button>
      <button class="px-3 py-1 border rounded" data-demo-next @click="player.next()">下一步</button>
      <button class="px-3 py-1 border rounded" data-demo-reset @click="player.reset()">重置</button>
    </div>
    <p class="text-sm text-gray-500">点击「下一步」逐步触发：淡入 → 从左飞入 → 旋转强调。</p>
    <SlideCanvas :scene="demo.scene" :adapter="demo.adapter" :overrides="overrides" :zoom="0.6" />
  </div>
</template>
