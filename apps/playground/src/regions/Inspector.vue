<script setup lang="ts">
import type { PlaygroundPresentationSnapshot } from '../presentation-host'
defineProps<{ snapshot: PlaygroundPresentationSnapshot }>()
</script>
<template>
  <div data-region="inspector" class="p-2 text-sm text-muted">inspector</div>
</template>
