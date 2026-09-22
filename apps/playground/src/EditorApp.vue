<script setup lang="ts">
import { shallowRef } from 'vue'
import { createPlaygroundPresentationHost } from './presentation-host'
import AppToolbar from './regions/AppToolbar.vue'
import SlideNavigator from './regions/SlideNavigator.vue'
import CanvasStage from './regions/CanvasStage.vue'
import Inspector from './regions/Inspector.vue'

const host = createPlaygroundPresentationHost()
const snapshot = shallowRef(host.getSnapshot())
</script>
<template>
  <div class="grid h-screen grid-rows-[auto_1fr] bg-bg text-text">
    <AppToolbar :snapshot="snapshot" />
    <div class="grid min-h-0 grid-cols-[16rem_1fr_20rem]">
      <SlideNavigator :snapshot="snapshot" class="min-h-0 overflow-y-auto border-r border-border bg-surface" />
      <CanvasStage :snapshot="snapshot" class="min-h-0 overflow-auto" />
      <Inspector :snapshot="snapshot" class="min-h-0 overflow-y-auto border-l border-border bg-surface" />
    </div>
  </div>
</template>
