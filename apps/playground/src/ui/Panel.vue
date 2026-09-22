<script setup lang="ts">
defineProps<{ title?: string }>()
</script>
<template>
  <section class="panel">
    <h2 v-if="title" class="panel-title">{{ title }}</h2>
    <div class="p-3 pt-0"><slot /></div>
  </section>
</template>
