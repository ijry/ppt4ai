<script setup lang="ts">
import type { PlaygroundPresentationSnapshot } from '../presentation-host'
defineProps<{ snapshot: PlaygroundPresentationSnapshot }>()
</script>
<template>
  <div data-region="toolbar" class="p-2 text-sm text-muted">toolbar</div>
</template>
