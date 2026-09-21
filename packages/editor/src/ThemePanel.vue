<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ThemeColorSlot, ThemeFontScript, ThemeFontSlot } from '@ppt4ai/model'
import { colorFromHex, THEME_FONT_ROWS, THEME_SLOT_GROUPS, type ThemePanelEmit, type ThemePanelProps } from './theme-panel'

const props = defineProps<ThemePanelProps>()
const emit = defineEmits<ThemePanelEmit>()
const { t } = useI18n()
const familyListId = useId()

const groups = computed(() => THEME_SLOT_GROUPS
  .map((entry) => ({ group: entry.group, slots: props.slots.filter((model) => model.group === entry.group) }))
  .filter((entry) => entry.slots.length > 0))

const fontGroups = computed(() => THEME_FONT_ROWS
  .map((entry) => ({ slot: entry.slot, rows: props.fonts.filter((model) => model.slot === entry.slot) }))
  .filter((entry) => entry.rows.length > 0))

function change(slot: ThemeColorSlot, event: Event): void {
  const color = colorFromHex((event.target as HTMLInputElement).value)
  if (color) emit('set-color', slot, color)
}

/** An empty box is not a typeface; going back to the default is what the reset button is for. */
function changeFont(slot: ThemeFontSlot, script: ThemeFontScript, event: Event): void {
  const typeface = (event.target as HTMLInputElement).value.trim()
  if (typeface) emit('set-font', slot, script, typeface)
}
</script>

<template>
  <section class="flex flex-col gap-2 border-l border-slate-200 bg-white p-2" data-theme-panel :aria-label="t('panel.theme.title')">
    <h2 class="text-sm font-medium text-slate-700">{{ t('panel.theme.title') }}</h2>
    <h3 class="text-xs font-medium text-slate-600">{{ t('panel.theme.colors') }}</h3>
    <div v-for="entry in groups" :key="entry.group" class="flex flex-col gap-1" data-slot-group :data-group="entry.group">
      <h3 class="text-xs text-slate-500">{{ t(`panel.theme.groups.${entry.group}`) }}</h3>
      <div
        v-for="model in entry.slots"
        :key="model.slot"
        class="flex items-center gap-2"
        :data-slot-row="model.slot"
        :data-inherited="model.inherited ? 'true' : 'false'"
      >
        <input
          type="color"
          class="h-8 w-8 cursor-pointer border border-slate-300 p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          :data-slot="model.slot"
          :aria-label="t(`panel.theme.slots.${model.slot}`)"
          :disabled="!props.active"
          :value="model.color"
          @change="change(model.slot, $event)"
        >
        <span class="flex-1 text-sm text-slate-700">{{ t(`panel.theme.slots.${model.slot}`) }}</span>
        <span v-if="model.inherited" class="text-xs text-slate-400">{{ t('panel.theme.inherited') }}</span>
        <button
          type="button"
          class="h-8 border border-transparent px-2 text-sm text-slate-700 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          data-action="reset-slot"
          :data-slot="model.slot"
          :aria-label="t('panel.theme.reset')"
          :disabled="!props.active"
          @click="emit('reset-color', model.slot)"
        >
          {{ t('panel.theme.reset') }}
        </button>
      </div>
    </div>

    <h3 class="text-xs font-medium text-slate-600">{{ t('panel.theme.fonts') }}</h3>
    <datalist :id="familyListId">
      <option v-for="family in props.fontFamilies" :key="family" :value="family" />
    </datalist>
    <div v-for="entry in fontGroups" :key="entry.slot" class="flex flex-col gap-1" data-font-group :data-slot="entry.slot">
      <h4 class="text-xs text-slate-500">{{ t(`panel.theme.fontSlots.${entry.slot}`) }}</h4>
      <div
        v-for="model in entry.rows"
        :key="model.script"
        class="flex items-center gap-2"
        :data-font-row="`${model.slot}-${model.script}`"
        :data-inherited="model.inherited ? 'true' : 'false'"
      >
        <label class="w-16 text-sm text-slate-700" :for="`${familyListId}-${model.slot}-${model.script}`">
          {{ t(`panel.theme.fontScripts.${model.script}`) }}
        </label>
        <input
          type="text"
          class="h-8 min-w-0 flex-1 border border-slate-300 bg-white px-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          :id="`${familyListId}-${model.slot}-${model.script}`"
          :list="familyListId"
          :data-font="`${model.slot}-${model.script}`"
          :disabled="!props.active"
          :value="model.typeface"
          @change="changeFont(model.slot, model.script, $event)"
        >
        <button
          type="button"
          class="h-8 border border-transparent px-2 text-sm text-slate-700 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          data-action="reset-font"
          :data-font="`${model.slot}-${model.script}`"
          :aria-label="t('panel.theme.reset')"
          :disabled="!props.active"
          @click="emit('reset-font', model.slot, model.script)"
        >
          {{ t('panel.theme.reset') }}
        </button>
      </div>
    </div>
  </section>
</template>
