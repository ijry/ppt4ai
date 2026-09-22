<script setup lang="ts">
import type { PlaygroundPresentationSnapshot } from '../presentation-host'
defineProps<{ snapshot: PlaygroundPresentationSnapshot }>()
</script>
<template>
  <div data-region="stage" class="p-2 text-sm text-muted">stage</div>
</template>
