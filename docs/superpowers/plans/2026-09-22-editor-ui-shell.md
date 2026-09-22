# Editor UI Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apps/playground` from a dev test harness into a designed, classic-PPT editor UI (top toolbar · left slide navigator · center canvas stage · right contextual inspector) over the existing `@ppt4ai/editor` components and `presentation-host`.

**Architecture:** Product chrome around the existing `PptEditor` (which already owns canvas + selection/drag/resize/rotate + text/table editing + floating contextual toolbars). New app-level regions bind to the `presentation-host` snapshot (single source of truth) and call its methods — the same wiring `App.vue` already proves, reorganized into styled components with a small design system.

**Tech Stack:** Vue 3.5.41, UnoCSS (`presetUno`), TypeScript (strict), Vitest + happy-dom, Playwright (e2e), lucide-vue-next (icons).

**Spec:** `docs/superpowers/specs/2026-09-22-editor-ui-shell-design.md`

## Global Constraints

- Set `TMPDIR=/d/tmp TEMP=/d/tmp TMP=/d/tmp` for every test/build command (C: drive is full; otherwise random ENOSPC).
- Downstream tests consume built dist, not source: after modifying `@ppt4ai/editor` (Task 6), run `pnpm --filter @ppt4ai/editor build` before any playground test/typecheck.
- Gates read exit codes, not grep counts: a task is done only when its `npx vitest run <path>` exits 0 AND `pnpm --filter @ppt4ai/playground typecheck` exits 0 (vitest does not type-check).
- Pin new dependencies to an exact version (no `^`/`~`).
- Reuse existing `@ppt4ai/editor` components and `presentation-host` methods; never copy PPTist code.
- Preserve routes: `#dev` → existing `App.vue` harness, `#animation` → `AnimationDemo.vue`, everything else → new `EditorApp.vue`.
- Vue component tests start with `// @vitest-environment happy-dom` as the first line.
- AI generation is out of scope (separate later spec).

## File Structure

- `apps/playground/uno.config.ts` — extend theme with design tokens + shortcuts (modify).
- `apps/playground/package.json` — add `lucide-vue-next` (modify).
- `apps/playground/src/ui/` — presentational primitives: `Button.vue`, `IconButton.vue`, `Panel.vue`, `PanelSection.vue`, `Field.vue`, `Toolbar.vue`, `ToolbarGroup.vue`, `Divider.vue`, `index.ts`.
- `apps/playground/src/editor/` — pure logic: `toolbar-model.ts`, `inspector-context.ts`, `zoom.ts` (+ tests).
- `apps/playground/src/EditorApp.vue` — shell: 4-region grid, owns host + snapshot, passes down.
- `apps/playground/src/regions/` — `AppToolbar.vue`, `SlideNavigator.vue`, `CanvasStage.vue`, `Inspector.vue` (+ tests).
- `apps/playground/src/main.ts` — hash routing (modify).
- `packages/editor/src/PptEditor.vue` — add `showObjectToolbar?: boolean` prop (modify).
- `apps/playground/e2e/editor-shell.spec.ts` — Playwright smoke (create).

---

### Task 1: Design tokens + lucide + Button/IconButton

**Files:**
- Modify: `apps/playground/uno.config.ts`
- Modify: `apps/playground/package.json`
- Create: `apps/playground/src/ui/Button.vue`, `apps/playground/src/ui/IconButton.vue`, `apps/playground/src/ui/index.ts`
- Test: `apps/playground/src/ui/Button.test.ts`

**Interfaces:**
- Produces: `Button` props `{ variant?: 'default'|'primary'|'danger'|'ghost'; disabled?: boolean }`, emits `click`. `IconButton` props `{ label: string; disabled?: boolean; active?: boolean }` + default slot (the icon), emits `click`. Shortcut classes `btn`, `btn-primary`, `btn-danger`, `btn-ghost`, `icon-btn`, `panel`, `panel-title`, `field`.

- [ ] **Step 1: Add tokens + shortcuts to UnoCSS**

In `apps/playground/uno.config.ts`, extend the config:

```ts
import { defineConfig, presetUno } from 'unocss'

export default defineConfig({
  presets: [presetUno()],
  content: { filesystem: ['../../packages/editor/src/**/*.{vue,ts}'] },
  theme: {
    colors: {
      surface: '#ffffff', 'surface-2': '#f8fafc', bg: '#f1f5f9',
      border: '#e2e8f0', text: '#0f172a', muted: '#64748b',
      primary: '#2563eb', 'primary-hover': '#1d4ed8', danger: '#dc2626',
    },
  },
  shortcuts: {
    btn: 'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
    'btn-primary': 'btn border-primary bg-primary text-white hover:bg-primary-hover',
    'btn-danger': 'btn border-danger text-danger hover:bg-red-50',
    'btn-ghost': 'btn border-transparent bg-transparent',
    'icon-btn': 'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40 aria-[pressed=true]:bg-surface-2 aria-[pressed=true]:text-primary',
    panel: 'rounded-lg border border-border bg-surface shadow-sm',
    'panel-title': 'px-3 py-2 text-sm font-semibold text-text',
    field: 'flex items-center gap-2 text-sm text-text',
  },
})
```

- [ ] **Step 2: Add the lucide dependency**

Run (from repo root, env set): `pnpm --filter @ppt4ai/playground add lucide-vue-next@0.544.0`
Verify `apps/playground/package.json` lists `"lucide-vue-next": "0.544.0"` (exact, no caret).

- [ ] **Step 3: Write the failing Button test**

Create `apps/playground/src/ui/Button.test.ts`:

```ts
// @vitest-environment happy-dom
import { createApp, h, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import Button from './Button.vue'

let app: App | undefined
function mount(props: Record<string, unknown>, onClick: () => void) {
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(Button, { ...props, onClick }, () => 'Go') })
  app.mount(host)
  return host.querySelector('button')!
}

afterEach(() => { app?.unmount(); document.body.innerHTML = '' })

describe('Button', () => {
  it('emits click and renders its slot', () => {
    let clicked = 0
    const btn = mount({ variant: 'primary' }, () => { clicked += 1 })
    expect(btn.textContent).toContain('Go')
    expect(btn.className).toContain('btn-primary')
    btn.click()
    expect(clicked).toBe(1)
  })

  it('does not emit when disabled', () => {
    let clicked = 0
    const btn = mount({ disabled: true }, () => { clicked += 1 })
    expect(btn.disabled).toBe(true)
    btn.click()
    expect(clicked).toBe(0)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `TMPDIR=/d/tmp TEMP=/d/tmp TMP=/d/tmp npx vitest run apps/playground/src/ui/Button.test.ts`
Expected: FAIL (cannot resolve `./Button.vue`).

- [ ] **Step 5: Implement Button, IconButton, index**

Create `apps/playground/src/ui/Button.vue`:

```vue
<script setup lang="ts">
const props = withDefaults(defineProps<{ variant?: 'default' | 'primary' | 'danger' | 'ghost'; disabled?: boolean }>(), { variant: 'default' })
defineEmits<{ click: [] }>()
const cls = { default: 'btn', primary: 'btn-primary', danger: 'btn-danger', ghost: 'btn-ghost' }
</script>
<template>
  <button type="button" :class="cls[props.variant]" :disabled="props.disabled" @click="$emit('click')">
    <slot />
  </button>
</template>
```

Create `apps/playground/src/ui/IconButton.vue`:

```vue
<script setup lang="ts">
const props = defineProps<{ label: string; disabled?: boolean; active?: boolean }>()
defineEmits<{ click: [] }>()
</script>
<template>
  <button type="button" class="icon-btn" :aria-label="props.label" :aria-pressed="props.active ? 'true' : 'false'" :disabled="props.disabled" @click="$emit('click')">
    <slot />
  </button>
</template>
```

Create `apps/playground/src/ui/index.ts`:

```ts
export { default as Button } from './Button.vue'
export { default as IconButton } from './IconButton.vue'
export { default as Panel } from './Panel.vue'
export { default as PanelSection } from './PanelSection.vue'
export { default as Field } from './Field.vue'
export { default as Toolbar } from './Toolbar.vue'
export { default as ToolbarGroup } from './ToolbarGroup.vue'
export { default as Divider } from './Divider.vue'
```

(The Panel/PanelSection/Field/Toolbar/ToolbarGroup/Divider files are created in Task 2; `index.ts` references them now so it compiles only after Task 2. If running Task 1 in isolation, temporarily comment the not-yet-created exports, then restore in Task 2.)

- [ ] **Step 6: Run Button test — expect PASS**

Run: `TMPDIR=/d/tmp TEMP=/d/tmp TMP=/d/tmp npx vitest run apps/playground/src/ui/Button.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/playground/uno.config.ts apps/playground/package.json pnpm-lock.yaml apps/playground/src/ui/
git commit -m "feat(playground): design tokens, lucide, Button/IconButton primitives"
```

---

### Task 2: Layout primitives (Panel/PanelSection/Field/Toolbar/ToolbarGroup/Divider)

**Files:**
- Create: `apps/playground/src/ui/Panel.vue`, `PanelSection.vue`, `Field.vue`, `Toolbar.vue`, `ToolbarGroup.vue`, `Divider.vue`
- Test: `apps/playground/src/ui/primitives.test.ts`

**Interfaces:**
- Produces: `Panel` (default slot; optional `title` prop rendered via `panel-title`). `PanelSection` props `{ title?: string }` (title + default slot). `Field` props `{ label: string }` (label + default slot control). `Toolbar` (flex row, default slot). `ToolbarGroup` (grouped children with a trailing `Divider`-free gap). `Divider` (1px vertical rule). All presentational, no emits.

- [ ] **Step 1: Write the failing render test**

Create `apps/playground/src/ui/primitives.test.ts`:

```ts
// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { Panel, Field } from './index'

function html(node: unknown): string {
  const host = document.createElement('div'); document.body.append(host)
  createApp({ render: () => node }).mount(host)
  return host.innerHTML
}

describe('layout primitives', () => {
  it('Panel renders its title and slot', () => {
    const out = html(h(Panel, { title: '背景' }, () => 'body'))
    expect(out).toContain('背景'); expect(out).toContain('body')
  })
  it('Field renders label and control', () => {
    const out = html(h(Field, { label: '宽度' }, () => 'ctrl'))
    expect(out).toContain('宽度'); expect(out).toContain('ctrl')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`Panel.vue` unresolved).
Run: `TMPDIR=/d/tmp TEMP=/d/tmp TMP=/d/tmp npx vitest run apps/playground/src/ui/primitives.test.ts`

- [ ] **Step 3: Implement the six primitives**

`Panel.vue`:
```vue
<script setup lang="ts">
defineProps<{ title?: string }>()
</script>
<template>
  <section class="panel">
    <h2 v-if="title" class="panel-title">{{ title }}</h2>
    <div class="p-3 pt-0"><slot /></div>
  </section>
</template>
```
`PanelSection.vue`:
```vue
<script setup lang="ts">
defineProps<{ title?: string }>()
</script>
<template>
  <div class="border-t border-border py-3 first:border-t-0">
    <h3 v-if="title" class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{{ title }}</h3>
    <slot />
  </div>
</template>
```
`Field.vue`:
```vue
<script setup lang="ts">
defineProps<{ label: string }>()
</script>
<template>
  <label class="field justify-between py-1">
    <span class="text-muted">{{ label }}</span>
    <span class="flex items-center gap-1"><slot /></span>
  </label>
</template>
```
`Toolbar.vue`:
```vue
<template><div class="flex items-center gap-1 border-b border-border bg-surface px-2 py-1.5"><slot /></div></template>
```
`ToolbarGroup.vue`:
```vue
<template><div class="flex items-center gap-0.5"><slot /></div></template>
```
`Divider.vue`:
```vue
<template><span class="mx-1 h-5 w-px bg-border" role="separator" /></template>
```

- [ ] **Step 4: Run — expect PASS.** If Task 1's `index.ts` had commented exports, restore them now.
Run: `TMPDIR=/d/tmp TEMP=/d/tmp TMP=/d/tmp npx vitest run apps/playground/src/ui/primitives.test.ts`

- [ ] **Step 5: Commit**
```bash
git add apps/playground/src/ui/
git commit -m "feat(playground): Panel/PanelSection/Field/Toolbar/ToolbarGroup/Divider primitives"
```

---

### Task 3: Pure logic — toolbar model, inspector context, zoom

**Files:**
- Create: `apps/playground/src/editor/toolbar-model.ts`, `apps/playground/src/editor/inspector-context.ts`, `apps/playground/src/editor/zoom.ts`
- Test: `apps/playground/src/editor/editor-logic.test.ts`

**Interfaces:**
- Produces:
  - `toolbarModel(snapshot): { canUndo, canRedo, canCopy, canPaste, hasSelection, canGroup, canUngroup }` (all `boolean`).
  - `inspectorContext(snapshot): 'slide' | 'object'`.
  - `zoomIn(zoom: number): number`, `zoomOut(zoom: number): number`, `fitZoom(container: {w,h}, page: {w,h}): number`, `ZOOM_STEPS: readonly number[]`.
- Consumes: `PlaygroundPresentationSnapshot` from `../presentation-host`; selection is `snapshot.slides[activeSlideId].engineState.selection` (iterable of element ids), element kind at `engineState.document.elements[id].kind`.

- [ ] **Step 1: Write the failing tests**

Create `apps/playground/src/editor/editor-logic.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'
import { toolbarModel } from './toolbar-model'
import { inspectorContext } from './inspector-context'
import { zoomIn, zoomOut, fitZoom } from './zoom'

function snap(opts: { selection?: string[]; kinds?: Record<string, string>; clipboard?: boolean; undo?: number }): PlaygroundPresentationSnapshot {
  const elements = Object.fromEntries(Object.entries(opts.kinds ?? {}).map(([id, kind]) => [id, { id, kind }]))
  return {
    slideOrder: ['sld_1'], activeSlideId: 'sld_1',
    slides: { sld_1: { id: 'sld_1', title: 'S', thumbnailScene: {} as never,
      engineState: { selection: new Set(opts.selection ?? []), document: { elements },
        history: { undoDepth: opts.undo ?? 0, redoDepth: 0 } } } },
    presentationHistory: { undoDepth: 0, redoDepth: 0 },
    clipboard: { hasContent: opts.clipboard ?? false, rootCount: 0, elementCount: 0 },
    status: 'idle',
  } as unknown as PlaygroundPresentationSnapshot
}

describe('toolbarModel', () => {
  it('reflects selection, clipboard, history, group/ungroup', () => {
    expect(toolbarModel(snap({}))).toMatchObject({ canUndo: false, canCopy: false, canPaste: false, canGroup: false, canUngroup: false })
    expect(toolbarModel(snap({ selection: ['a', 'b'] })).canGroup).toBe(true)
    expect(toolbarModel(snap({ selection: ['g'], kinds: { g: 'group' } })).canUngroup).toBe(true)
    expect(toolbarModel(snap({ clipboard: true })).canPaste).toBe(true)
    expect(toolbarModel(snap({ undo: 1 })).canUndo).toBe(true)
  })
})

describe('inspectorContext', () => {
  it('is object when something is selected, else slide', () => {
    expect(inspectorContext(snap({}))).toBe('slide')
    expect(inspectorContext(snap({ selection: ['a'] }))).toBe('object')
  })
})

describe('zoom', () => {
  it('steps and fits', () => {
    expect(zoomIn(1)).toBeGreaterThan(1)
    expect(zoomOut(1)).toBeLessThan(1)
    expect(fitZoom({ w: 960, h: 540 }, { w: 9600, h: 5400 })).toBeCloseTo(0.1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**
Run: `TMPDIR=/d/tmp TEMP=/d/tmp TMP=/d/tmp npx vitest run apps/playground/src/editor/editor-logic.test.ts`

- [ ] **Step 3: Implement the three modules**

`apps/playground/src/editor/inspector-context.ts`:
```ts
import type { PlaygroundPresentationSnapshot } from '../presentation-host'

export type InspectorContext = 'slide' | 'object'

export function inspectorContext(snapshot: PlaygroundPresentationSnapshot): InspectorContext {
  const slide = snapshot.slides[snapshot.activeSlideId]
  const selection = slide ? [...slide.engineState.selection] : []
  return selection.length > 0 ? 'object' : 'slide'
}
```

`apps/playground/src/editor/toolbar-model.ts`:
```ts
import type { PlaygroundPresentationSnapshot } from '../presentation-host'

export interface ToolbarModel {
  canUndo: boolean; canRedo: boolean; canCopy: boolean; canPaste: boolean
  hasSelection: boolean; canGroup: boolean; canUngroup: boolean
}

export function toolbarModel(snapshot: PlaygroundPresentationSnapshot): ToolbarModel {
  const slide = snapshot.slides[snapshot.activeSlideId]
  const selection = slide ? [...slide.engineState.selection] : []
  const elements = slide?.engineState.document.elements ?? {}
  const first = selection[0]
  return {
    canUndo: snapshot.presentationHistory.undoDepth > 0 || (slide?.engineState.history.undoDepth ?? 0) > 0,
    canRedo: snapshot.presentationHistory.redoDepth > 0 || (slide?.engineState.history.redoDepth ?? 0) > 0,
    canCopy: selection.length > 0,
    canPaste: snapshot.clipboard.hasContent,
    hasSelection: selection.length > 0,
    canGroup: selection.length >= 2,
    canUngroup: selection.length === 1 && first !== undefined && elements[first]?.kind === 'group',
  }
}
```

`apps/playground/src/editor/zoom.ts`:
```ts
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const

export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((z) => z > zoom + 1e-9) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!
}
export function zoomOut(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-9) ?? ZOOM_STEPS[0]!
}
export function fitZoom(container: { w: number; h: number }, page: { w: number; h: number }): number {
  if (page.w <= 0 || page.h <= 0) return 1
  return Math.min(container.w / page.w, container.h / page.h)
}
```

- [ ] **Step 4: Run — expect PASS.** `TMPDIR=/d/tmp … npx vitest run apps/playground/src/editor/editor-logic.test.ts`
- [ ] **Step 5: Commit**
```bash
git add apps/playground/src/editor/
git commit -m "feat(playground): pure toolbar/inspector/zoom logic for the editor shell"
```

---

### Task 4: EditorApp shell skeleton + hash routing

**Files:**
- Create: `apps/playground/src/EditorApp.vue`
- Create (stubs, fleshed out later): `apps/playground/src/regions/AppToolbar.vue`, `SlideNavigator.vue`, `CanvasStage.vue`, `Inspector.vue`
- Modify: `apps/playground/src/main.ts`
- Test: `apps/playground/src/EditorApp.test.ts`

**Interfaces:**
- Produces: `EditorApp.vue` owns `host = createPlaygroundPresentationHost()` and `snapshot = shallowRef(host.getSnapshot())`; renders four regions inside a grid; each region carries a `data-region="toolbar|navigator|stage|inspector"` attribute on its root. Region stubs accept a `snapshot` prop (type `PlaygroundPresentationSnapshot`).
- Consumes: `createPlaygroundPresentationHost` from `./presentation-host`.

- [ ] **Step 1: Failing test**

Create `apps/playground/src/EditorApp.test.ts`:
```ts
// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import EditorApp from './EditorApp.vue'

describe('EditorApp', () => {
  it('renders the four regions', () => {
    const host = document.createElement('div'); document.body.append(host)
    createApp({ render: () => h(EditorApp) }).mount(host)
    for (const r of ['toolbar', 'navigator', 'stage', 'inspector']) {
      expect(host.querySelector(`[data-region="${r}"]`)).not.toBeNull()
    }
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** `TMPDIR=/d/tmp … npx vitest run apps/playground/src/EditorApp.test.ts`

- [ ] **Step 3: Create the four region stubs**

Each of `apps/playground/src/regions/{AppToolbar,SlideNavigator,CanvasStage,Inspector}.vue` starts as:
```vue
<script setup lang="ts">
import type { PlaygroundPresentationSnapshot } from '../presentation-host'
defineProps<{ snapshot: PlaygroundPresentationSnapshot }>()
</script>
<template>
  <div data-region="REGION" class="p-2 text-sm text-muted">REGION</div>
</template>
```
Replace `REGION` with `toolbar` / `navigator` / `stage` / `inspector` respectively.

- [ ] **Step 4: Implement EditorApp.vue**

```vue
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
```
(Later tasks add `:host` / callback props to the regions and thread real behaviour; the grid and ownership are fixed here.)

- [ ] **Step 5: Hash routing in main.ts**
```ts
import 'uno.css'
import { createApp } from 'vue'
import { createPpt4aiI18n } from '@ppt4ai/editor'
import App from './App.vue'
import AnimationDemo from './AnimationDemo.vue'
import EditorApp from './EditorApp.vue'

const hash = globalThis.location?.hash
const root = hash === '#dev' ? App : hash === '#animation' ? AnimationDemo : EditorApp
createApp(root).use(createPpt4aiI18n('zh-CN')).mount('#app')
```

- [ ] **Step 6: Run test — expect PASS.** Then `pnpm --filter @ppt4ai/playground typecheck` (exit 0).
- [ ] **Step 7: Commit**
```bash
git add apps/playground/src/EditorApp.vue apps/playground/src/regions/ apps/playground/src/main.ts apps/playground/src/EditorApp.test.ts
git commit -m "feat(playground): EditorApp four-region shell + hash routing"
```

---

### Task 5: SlideNavigator

**Files:**
- Modify: `apps/playground/src/regions/SlideNavigator.vue`, `apps/playground/src/EditorApp.vue`
- Test: `apps/playground/src/regions/SlideNavigator.test.ts`

**Interfaces:**
- Produces: `SlideNavigator` props `{ snapshot: PlaygroundPresentationSnapshot; adapter: AssetAdapter }`, emits `select: [slideId: string]`, `add: []`, `duplicate: [slideId: string]`, `delete: [slideId: string]`, `move: [payload: { slideId: string; direction: 'up' | 'down' }]`. Each slide row root has `data-slide-item="<slideId>"`.
- Consumes: `ThumbnailCanvas` (props `scene`, `adapter`, `width`, `height`) from `@ppt4ai/editor`; `IconButton`, `Button` from `../ui`; icons `Plus`, `Copy`, `Trash2`, `ChevronUp`, `ChevronDown` from `lucide-vue-next`. Snapshot fields: `snapshot.slideOrder`, `snapshot.activeSlideId`, `snapshot.slides[id].thumbnailScene`.

- [ ] **Step 1: Failing test**

Create `apps/playground/src/regions/SlideNavigator.test.ts`:
```ts
// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SlideNavigator from './SlideNavigator.vue'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'

const adapter = { get: async () => undefined, put: async () => {} }
function snap(): PlaygroundPresentationSnapshot {
  const slide = (id: string) => ({ id, title: id, thumbnailScene: { slideId: id, page: { w: 9600, h: 5400 }, nodes: [] }, engineState: {} })
  return { slideOrder: ['sld_1', 'sld_2'], activeSlideId: 'sld_1',
    slides: { sld_1: slide('sld_1'), sld_2: slide('sld_2') },
    presentationHistory: { undoDepth: 0, redoDepth: 0 }, clipboard: { hasContent: false, rootCount: 0, elementCount: 0 }, status: 'idle' } as unknown as PlaygroundPresentationSnapshot
}

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('SlideNavigator', () => {
  it('emits select for a clicked slide and add for the add button', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ canvas: { width: 0, height: 0, style: {} }, save() {}, restore() {}, setTransform() {}, clearRect() {} } as never)
    const events: Array<[string, unknown]> = []
    const el = document.createElement('div'); document.body.append(el)
    createApp({ render: () => h(SlideNavigator, { snapshot: snap(), adapter,
      onSelect: (id: string) => events.push(['select', id]), onAdd: () => events.push(['add', null]) }) }).mount(el)
    ;(el.querySelector('[data-slide-item="sld_2"]') as HTMLElement).click()
    ;(el.querySelector('[data-add-slide]') as HTMLElement).click()
    expect(events).toContainEqual(['select', 'sld_2'])
    expect(events).toContainEqual(['add', null])
  })
})
```
- [ ] **Step 2: Run — expect FAIL.** `TMPDIR=/d/tmp … npx vitest run apps/playground/src/regions/SlideNavigator.test.ts`

- [ ] **Step 3: Implement SlideNavigator.vue**
```vue
<script setup lang="ts">
import type { AssetAdapter } from '@ppt4ai/model'
import { ThumbnailCanvas } from '@ppt4ai/editor'
import { Plus, Copy, Trash2, ChevronUp, ChevronDown } from 'lucide-vue-next'
import { IconButton, Button } from '../ui'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'
const props = defineProps<{ snapshot: PlaygroundPresentationSnapshot; adapter: AssetAdapter }>()
const emit = defineEmits<{ select: [string]; add: []; duplicate: [string]; delete: [string]; move: [{ slideId: string; direction: 'up' | 'down' }] }>()
</script>
<template>
  <div class="flex flex-col gap-2 p-2">
    <Button data-add-slide variant="primary" @click="emit('add')"><Plus :size="16" />新增页</Button>
    <div v-for="(id, i) in props.snapshot.slideOrder" :key="id"
      :data-slide-item="id"
      class="group cursor-pointer rounded-md border p-1"
      :class="id === props.snapshot.activeSlideId ? 'border-primary' : 'border-border'"
      @click="emit('select', id)">
      <div class="flex items-center gap-1">
        <span class="w-5 text-center text-xs text-muted">{{ i + 1 }}</span>
        <ThumbnailCanvas :scene="props.snapshot.slides[id]!.thumbnailScene" :adapter="props.adapter" :width="200" :height="112" />
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
```

- [ ] **Step 4: Wire it in EditorApp.vue.** Add handlers and pass adapter + listeners:
```ts
// in <script setup>
function selectSlide(id: string) { snapshot.value = host.selectSlide(id) }
function addSlide() { snapshot.value = host.addSlide() }
function duplicateSlide(id: string) { host.selectSlide(id); snapshot.value = host.duplicateSlide() }
function deleteSlide(id: string) { host.selectSlide(id); snapshot.value = host.deleteSlide() }
function moveSlide(p: { slideId: string; direction: 'up' | 'down' }) { snapshot.value = host.moveSlide(p.slideId, p.direction) }
```
```vue
<SlideNavigator :snapshot="snapshot" :adapter="host.adapter"
  class="min-h-0 overflow-y-auto border-r border-border bg-surface"
  @select="selectSlide" @add="addSlide" @duplicate="duplicateSlide" @delete="deleteSlide" @move="moveSlide" />
```

- [ ] **Step 5: Run test — expect PASS.** Then `pnpm --filter @ppt4ai/playground typecheck`.
- [ ] **Step 6: Commit**
```bash
git add apps/playground/src/regions/SlideNavigator.vue apps/playground/src/regions/SlideNavigator.test.ts apps/playground/src/EditorApp.vue
git commit -m "feat(playground): slide navigator (select/add/duplicate/delete/move)"
```

---

### Task 6: PptEditor `showObjectToolbar` prop + AppToolbar

**Files:**
- Modify: `packages/editor/src/PptEditor.vue`
- Test: `packages/editor/src/ppt-editor-toolbar-toggle.test.ts`
- Modify: `apps/playground/src/regions/AppToolbar.vue`, `apps/playground/src/EditorApp.vue`
- Test: `apps/playground/src/regions/AppToolbar.test.ts`

**Interfaces:**
- Produces: `PptEditor` new prop `showObjectToolbar?: boolean` (default `true`); when `false` its built-in `<header class="ppt-editor__toolbar">` is not rendered. `AppToolbar` props `{ snapshot }`, emits `undo`,`redo`,`copy`,`paste`,`add`,`insert-shape`,`insert-image`,`group`,`ungroup`,`rotate: [deg: number]`,`flip: ['horizontal'|'vertical']`,`zoom: ['in'|'out'|'fit']`. Disabled states come from `toolbarModel(snapshot)` (Task 3).

- [ ] **Step 1: Failing PptEditor prop test** — `packages/editor/src/ppt-editor-toolbar-toggle.test.ts`:
```ts
// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import PptEditor from './PptEditor.vue'
function mount(props: Record<string, unknown>) {
  const el = document.createElement('div'); document.body.append(el)
  createApp({ render: () => h(PptEditor, props) }).mount(el); return el
}
describe('PptEditor showObjectToolbar', () => {
  it('renders its object toolbar by default and hides it when false', () => {
    expect(mount({}).querySelector('.ppt-editor__toolbar')).not.toBeNull()
    document.body.innerHTML = ''
    expect(mount({ showObjectToolbar: false }).querySelector('.ppt-editor__toolbar')).toBeNull()
  })
})
```
- [ ] **Step 2: Run — expect FAIL** (default renders, but `false` still renders).
Run: `TMPDIR=/d/tmp … npx vitest run packages/editor/src/ppt-editor-toolbar-toggle.test.ts`

- [ ] **Step 3: Implement the prop.** In `PptEditor.vue`, add to `defineProps` (before the closing `}>()`): `showObjectToolbar?: boolean` and set `withDefaults(..., { zoom: 1, showObjectToolbar: true })`. Wrap the toolbar header: change `<header id="ppt-editor-toolbar" class="ppt-editor__toolbar …">` to add `v-if="showObjectToolbar"`.

- [ ] **Step 4: Run — expect PASS.** Then rebuild the dist the playground consumes:
Run: `TMPDIR=/d/tmp … pnpm --filter @ppt4ai/editor build` (exit 0). *(Downstream playground tests read this dist.)*

- [ ] **Step 5: Commit the library change**
```bash
git add packages/editor/src/PptEditor.vue packages/editor/src/ppt-editor-toolbar-toggle.test.ts
git commit -m "feat(editor): showObjectToolbar prop to let a host supply its own toolbar"
```

- [ ] **Step 6: Failing AppToolbar test** — `apps/playground/src/regions/AppToolbar.test.ts`:
```ts
// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { describe, expect, it } from 'vitest'
import AppToolbar from './AppToolbar.vue'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'
function snap(over: Partial<{ undo: number; clipboard: boolean }> = {}): PlaygroundPresentationSnapshot {
  return { slideOrder: ['s'], activeSlideId: 's',
    slides: { s: { id: 's', title: 's', thumbnailScene: {}, engineState: { selection: new Set(), document: { elements: {} }, history: { undoDepth: over.undo ?? 0, redoDepth: 0 } } } },
    presentationHistory: { undoDepth: 0, redoDepth: 0 }, clipboard: { hasContent: over.clipboard ?? false, rootCount: 0, elementCount: 0 }, status: 'idle' } as unknown as PlaygroundPresentationSnapshot
}
describe('AppToolbar', () => {
  it('disables undo with empty history and emits add', () => {
    const events: string[] = []
    const el = document.createElement('div'); document.body.append(el)
    createApp({ render: () => h(AppToolbar, { snapshot: snap(), onAdd: () => events.push('add') }) }).mount(el)
    expect((el.querySelector('[data-act="undo"]') as HTMLButtonElement).disabled).toBe(true)
    ;(el.querySelector('[data-act="add"]') as HTMLElement).click()
    expect(events).toContain('add')
  })
})
```
- [ ] **Step 7: Run — expect FAIL.**

- [ ] **Step 8: Implement AppToolbar.vue** (icons from lucide; disabled via `toolbarModel`):
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { Undo2, Redo2, Copy, ClipboardPaste, Plus, Square, Image, Group, Ungroup, RotateCcw, RotateCw, FlipHorizontal, FlipVertical, ZoomIn, ZoomOut, Maximize } from 'lucide-vue-next'
import { Toolbar, ToolbarGroup, IconButton, Divider } from '../ui'
import { toolbarModel } from '../editor/toolbar-model'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'
const props = defineProps<{ snapshot: PlaygroundPresentationSnapshot }>()
const emit = defineEmits<{ undo: []; redo: []; copy: []; paste: []; add: []; 'insert-shape': []; 'insert-image': []; group: []; ungroup: []; rotate: [number]; flip: ['horizontal' | 'vertical']; zoom: ['in' | 'out' | 'fit'] }>()
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
      <IconButton label="插入形状" @click="emit('insert-shape')"><Square :size="18" /></IconButton>
      <IconButton label="插入图片" @click="emit('insert-image')"><Image :size="18" /></IconButton>
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
```

- [ ] **Step 9: Wire AppToolbar in EditorApp** (map emits to host; `insert-image` triggers a hidden file input or `host.uploadAndInsert`; `zoom` mutates a `zoom` ref used by CanvasStage in Task 7):
```ts
function undo() { snapshot.value = host.undo() }
function redo() { snapshot.value = host.redo() }
function copySel() { snapshot.value = host.copySelected() }
async function paste() { snapshot.value = await host.paste() }
function group() { snapshot.value = host.groupSelected() }
function ungroup() { const s = snapshot.value.slides[snapshot.value.activeSlideId]!; const gid = [...s.engineState.selection][0]; if (gid) snapshot.value = host.ungroupSelected(gid) }
function rotate(deg: number) { snapshot.value = host.rotateSelection(deg) }
function flip(axis: 'horizontal' | 'vertical') { snapshot.value = host.flipSelection(axis) }
```
Bind: `<AppToolbar :snapshot="snapshot" @undo="undo" @redo="redo" @copy="copySel" @paste="paste" @add="addSlide" @group="group" @ungroup="ungroup" @rotate="rotate" @flip="flip" @zoom="onZoom" @insert-shape="…" @insert-image="…" />`. (`onZoom`/insert handlers finalized in Task 7 alongside the zoom ref and the canvas insert path.)

- [ ] **Step 10: Run AppToolbar test — expect PASS.** Then `pnpm --filter @ppt4ai/playground typecheck`.
- [ ] **Step 11: Commit**
```bash
git add apps/playground/src/regions/AppToolbar.vue apps/playground/src/regions/AppToolbar.test.ts apps/playground/src/EditorApp.vue
git commit -m "feat(playground): app toolbar (history/clipboard/insert/object/zoom)"
```

---

### Task 7: CanvasStage

**Files:**
- Create: `apps/playground/src/editor/stage-bindings.ts`
- Test: `apps/playground/src/editor/stage-bindings.test.ts`
- Modify: `apps/playground/src/regions/CanvasStage.vue`, `apps/playground/src/EditorApp.vue`

**Interfaces:**
- Produces: `stageBindings(snapshot): { scene: SceneGraph; selectedElementId: string | undefined; selectedElementIds: string[]; textBodies: Record<string, TextBody> }` (pure). `CanvasStage` props `{ snapshot; host: PlaygroundPresentationHost; zoom: number }`, emits `update: [PlaygroundPresentationSnapshot]`.
- Consumes: `PptEditor` (props/emits per `packages/editor/src/PptEditor.vue`), `normalizeTextElement` from `@ppt4ai/text`. The exact PptEditor↔host wiring already exists in `App.vue` and is lifted here.

- [ ] **Step 1: Failing test** — `apps/playground/src/editor/stage-bindings.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'
import { stageBindings } from './stage-bindings'
function snap(sel: string[], elements: Record<string, unknown>, scene: unknown): PlaygroundPresentationSnapshot {
  return { slideOrder: ['s'], activeSlideId: 's',
    slides: { s: { id: 's', title: 's', thumbnailScene: scene, engineState: { selection: new Set(sel), document: { elements }, history: { undoDepth: 0, redoDepth: 0 } } } },
    presentationHistory: { undoDepth: 0, redoDepth: 0 }, clipboard: { hasContent: false, rootCount: 0, elementCount: 0 }, status: 'idle' } as unknown as PlaygroundPresentationSnapshot
}
describe('stageBindings', () => {
  it('exposes the active scene, single/multi selection, and text bodies', () => {
    const scene = { slideId: 's', page: { w: 9600, h: 5400 }, nodes: [] }
    const b = stageBindings(snap(['t1'], { t1: { id: 't1', kind: 'text', text: 'hi' } }, scene))
    expect(b.scene).toBe(scene)
    expect(b.selectedElementId).toBe('t1')
    expect(b.selectedElementIds).toEqual(['t1'])
    expect(b.textBodies.t1).toBeTruthy()
    expect(stageBindings(snap(['a', 'b'], {}, scene)).selectedElementId).toBeUndefined()
  })
})
```
- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `stage-bindings.ts`**
```ts
import type { SceneGraph } from '@ppt4ai/render'
import type { TextBody } from '@ppt4ai/model'
import { normalizeTextElement } from '@ppt4ai/text'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'

export interface StageBindings {
  scene: SceneGraph; selectedElementId: string | undefined
  selectedElementIds: string[]; textBodies: Record<string, TextBody>
}
export function stageBindings(snapshot: PlaygroundPresentationSnapshot): StageBindings {
  const slide = snapshot.slides[snapshot.activeSlideId]!
  const selectedElementIds = [...slide.engineState.selection]
  const textBodies: Record<string, TextBody> = {}
  for (const el of Object.values(slide.engineState.document.elements)) {
    if ((el as { kind: string }).kind === 'text') textBodies[(el as { id: string }).id] = normalizeTextElement(el as never)
  }
  return {
    scene: slide.thumbnailScene,
    selectedElementId: selectedElementIds.length === 1 ? selectedElementIds[0] : undefined,
    selectedElementIds, textBodies,
  }
}
```
- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Implement CanvasStage.vue.** Lift, verbatim from `App.vue`, the handler functions for these PptEditor events and the `tableCellSelection` computed: `selectElements, groupSelected, ungroupSelected, resizeSelected, moveElement, resizeElement, rotateImage, rotateElement, rotateSelection, flipImage, flipElement, flipSelection, updateTextElement, setShapeFill, setShapeStroke, setShapeStrokeWidth, setShapeStrokeStyle, selectTableCell, setTableCellFill, setTableCellBorders, setTableCellText`. In CanvasStage each handler calls `props.host.<method>(…)` and does `emit('update', <result>)` instead of `App.vue`'s `assetSnapshot.value = …`. Skeleton + the (verbatim) PptEditor binding block:
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { PptEditor } from '@ppt4ai/editor'
import { stageBindings } from '../editor/stage-bindings'
import type { PlaygroundPresentationHost, PlaygroundPresentationSnapshot } from '../presentation-host'
const props = defineProps<{ snapshot: PlaygroundPresentationSnapshot; host: PlaygroundPresentationHost; zoom: number }>()
const emit = defineEmits<{ update: [PlaygroundPresentationSnapshot] }>()
const b = computed(() => stageBindings(props.snapshot))
// tableCellSelection: lift App.vue's computed (line ~152) verbatim, reading props.snapshot.
// handlers: lift the 22 named functions from App.vue; body pattern e.g.:
function selectElements(p: { elementIds: string[] }) { emit('update', props.host.selectElements(p.elementIds)) }
function moveElement(p: { nodeId: string; dx: number; dy: number }) { emit('update', props.host.moveSelected(p.nodeId, p.dx, p.dy)) }
// …the remaining 20 follow the same lift-and-emit pattern.
</script>
<template>
  <div data-region="stage" class="flex items-start justify-center p-6">
    <PptEditor
      :scene="b.scene" :adapter="props.host.adapter" :snap-options="props.host.snapOptions"
      :selected-element-id="b.selectedElementId" :selected-element-ids="b.selectedElementIds"
      :table-cell-selection="tableCellSelection" :text-bodies="b.textBodies"
      :zoom="props.zoom" :show-object-toolbar="false"
      @selection-change="selectElements" @group="groupSelected" @ungroup="ungroupSelected"
      @resize-selection="resizeSelected" @move-end="moveElement" @resize="resizeElement"
      @rotate-image="rotateImage" @rotate-element="rotateElement" @rotate-selection="rotateSelection"
      @flip-image="flipImage" @flip-element="flipElement" @flip-selection="flipSelection"
      @text-edit="updateTextElement" @set-fill="setShapeFill" @set-stroke="setShapeStroke"
      @set-stroke-width="setShapeStrokeWidth" @set-stroke-style="setShapeStrokeStyle"
      @select-table-cell="selectTableCell" @set-table-cell-fill="setTableCellFill"
      @set-table-cell-borders="setTableCellBorders" @table-cell-text="setTableCellText" />
  </div>
</template>
```

- [ ] **Step 6: Wire zoom + stage in EditorApp**
```ts
import { ref } from 'vue'
import { zoomIn, zoomOut, fitZoom } from './editor/zoom'
const zoom = ref(0.6)
function onZoom(kind: 'in' | 'out' | 'fit') {
  const page = snapshot.value.slides[snapshot.value.activeSlideId]!.thumbnailScene.page
  zoom.value = kind === 'in' ? zoomIn(zoom.value) : kind === 'out' ? zoomOut(zoom.value) : fitZoom({ w: 960, h: 540 }, page)
}
```
Bind: `<CanvasStage :snapshot="snapshot" :host="host" :zoom="zoom" class="min-h-0 overflow-auto" @update="(s) => (snapshot = s)" />` (with `let snapshot = shallowRef(...)`, assign `.value`). Also finish AppToolbar's `@insert-image="() => host.uploadAndInsert?.()"` path or a hidden file input; `@insert-shape` emits to PptEditor's insert — for M1 route insert-shape through `host` if available, else leave the button disabled and note it (do not fake it).

- [ ] **Step 7: Typecheck + run stage-bindings test.** `pnpm --filter @ppt4ai/playground typecheck` (exit 0).
- [ ] **Step 8: Commit**
```bash
git add apps/playground/src/editor/stage-bindings.ts apps/playground/src/editor/stage-bindings.test.ts apps/playground/src/regions/CanvasStage.vue apps/playground/src/EditorApp.vue
git commit -m "feat(playground): canvas stage wrapping PptEditor with zoom"
```

---

### Task 8: Inspector (contextual)

**Files:**
- Modify: `apps/playground/src/regions/Inspector.vue`, `apps/playground/src/EditorApp.vue`
- Test: `apps/playground/src/regions/Inspector.test.ts`

**Interfaces:**
- Produces: `Inspector` props `{ snapshot; host: PlaygroundPresentationHost }`, emits `update: [PlaygroundPresentationSnapshot]`. Root carries `data-inspector="slide"` or `data-inspector="object"` per `inspectorContext(snapshot)` (Task 3). Object context shows number `Field`s for x/y/w/h/rotation bound to `host.resizeElement` / `host.rotateSelectedElement`.
- Consumes: `inspectorContext`; `ThemePanel`, `SlideBackgroundPanel`, `AssetLibrary` from `@ppt4ai/editor` (their existing props/emits, wired as in `App.vue`); `Panel`, `PanelSection`, `Field` from `../ui`.

- [ ] **Step 1: Failing test** — `apps/playground/src/regions/Inspector.test.ts`:
```ts
// @vitest-environment happy-dom
import { createApp, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Inspector from './Inspector.vue'
import type { PlaygroundPresentationSnapshot } from '../presentation-host'
function snap(selection: string[], elements: Record<string, unknown> = {}): PlaygroundPresentationSnapshot {
  return { slideOrder: ['s'], activeSlideId: 's',
    slides: { s: { id: 's', title: 's', thumbnailScene: { slideId: 's', page: { w: 9600, h: 5400 }, nodes: [] },
      engineState: { selection: new Set(selection), document: { elements, themes: {}, assets: {} }, history: { undoDepth: 0, redoDepth: 0 } } } },
    presentationHistory: { undoDepth: 0, redoDepth: 0 }, clipboard: { hasContent: false, rootCount: 0, elementCount: 0 }, status: 'idle' } as unknown as PlaygroundPresentationSnapshot
}
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })
describe('Inspector', () => {
  it('switches between slide and object context', () => {
    const el = document.createElement('div'); document.body.append(el)
    createApp({ render: () => h(Inspector, { snapshot: snap([]), host: {} }) }).mount(el)
    expect(el.querySelector('[data-inspector="slide"]')).not.toBeNull()
    document.body.innerHTML = ''
    const el2 = document.createElement('div'); document.body.append(el2)
    const host = { resizeElement: vi.fn(() => snap(['e1'])) }
    createApp({ render: () => h(Inspector, { snapshot: snap(['e1'], { e1: { id: 'e1', kind: 'shape', bounds: { x: 0, y: 0, w: 100, h: 50 } } }), host }) }).mount(el2)
    expect(el2.querySelector('[data-inspector="object"]')).not.toBeNull()
    const w = el2.querySelector('[data-geom="w"]') as HTMLInputElement
    w.value = '200'; w.dispatchEvent(new Event('change', { bubbles: true }))
    expect(host.resizeElement).toHaveBeenCalled()
  })
})
```
- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement Inspector.vue.** Object context (new code) + slide context (compose panels, lifting `App.vue`'s panel handlers verbatim — `setSlideBackground`, `setSlideBackgroundGradient`, `setSlideBackgroundPattern`, `setSlideBackgroundPicture`, `clearSlideBackground`, `setSlideLayout`, theme `set-color`/`set-font`, asset `select`/`insert`/`replace` — each calling `props.host.*` and `emit('update', …)`):
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { ThemePanel, SlideBackgroundPanel, AssetLibrary } from '@ppt4ai/editor'
import { Panel, PanelSection, Field } from '../ui'
import { inspectorContext } from '../editor/inspector-context'
import type { PlaygroundPresentationHost, PlaygroundPresentationSnapshot } from '../presentation-host'
const props = defineProps<{ snapshot: PlaygroundPresentationSnapshot; host: PlaygroundPresentationHost }>()
const emit = defineEmits<{ update: [PlaygroundPresentationSnapshot] }>()
const context = computed(() => inspectorContext(props.snapshot))
const selected = computed(() => {
  const s = props.snapshot.slides[props.snapshot.activeSlideId]!
  const id = [...s.engineState.selection][0]
  const el = id ? (s.engineState.document.elements[id] as { id: string; bounds?: { x: number; y: number; w: number; h: number }; transform?: { rotation?: number } }) : undefined
  return el && el.bounds ? { id: el.id, bounds: el.bounds, rotation: el.transform?.rotation ?? 0 } : undefined
})
function setGeom(field: 'x' | 'y' | 'w' | 'h', value: string) {
  const sel = selected.value; if (!sel) return
  const n = Number(value); if (!Number.isFinite(n)) return
  emit('update', props.host.resizeElement(sel.id, { ...sel.bounds, [field]: n }))
}
function setRotation(value: string) {
  const sel = selected.value; if (!sel) return
  const deg = Number(value); if (!Number.isFinite(deg)) return
  emit('update', props.host.rotateSelectedElement(sel.id, Math.round(deg * 60000)))
}
// slide-context handlers: lift from App.vue (setSlideBackground family, setSlideLayout, theme, asset), calling props.host.* + emit('update', …)
</script>
<template>
  <div v-if="context === 'object' && selected" data-inspector="object" class="flex flex-col gap-3 p-3">
    <Panel title="位置与大小">
      <PanelSection>
        <Field label="X"><input class="w-24 rounded border border-border px-1 text-right" type="number" :value="selected.bounds.x" data-geom="x" @change="setGeom('x', ($event.target as HTMLInputElement).value)" /></Field>
        <Field label="Y"><input class="w-24 rounded border border-border px-1 text-right" type="number" :value="selected.bounds.y" data-geom="y" @change="setGeom('y', ($event.target as HTMLInputElement).value)" /></Field>
        <Field label="宽"><input class="w-24 rounded border border-border px-1 text-right" type="number" :value="selected.bounds.w" data-geom="w" @change="setGeom('w', ($event.target as HTMLInputElement).value)" /></Field>
        <Field label="高"><input class="w-24 rounded border border-border px-1 text-right" type="number" :value="selected.bounds.h" data-geom="h" @change="setGeom('h', ($event.target as HTMLInputElement).value)" /></Field>
        <Field label="旋转°"><input class="w-24 rounded border border-border px-1 text-right" type="number" :value="Math.round(selected.rotation / 60000)" data-geom="r" @change="setRotation(($event.target as HTMLInputElement).value)" /></Field>
      </PanelSection>
    </Panel>
  </div>
  <div v-else data-inspector="slide" class="flex flex-col gap-3 p-3">
    <!-- ThemePanel / SlideBackgroundPanel / AssetLibrary composed here with lifted App.vue bindings -->
  </div>
</template>
```
- [ ] **Step 4: Run test — expect PASS.**
- [ ] **Step 5: Wire in EditorApp:** `<Inspector :snapshot="snapshot" :host="host" @update="(s) => (snapshot = s)" class="min-h-0 overflow-y-auto border-l border-border bg-surface" />`. Typecheck (exit 0).
- [ ] **Step 6: Commit**
```bash
git add apps/playground/src/regions/Inspector.vue apps/playground/src/regions/Inspector.test.ts apps/playground/src/EditorApp.vue
git commit -m "feat(playground): contextual inspector (slide panels + object geometry)"
```

---

### Task 9: Polish, e2e smoke, full gates

**Files:**
- Create: `apps/playground/e2e/editor-shell.spec.ts`
- Modify: any region for visual polish surfaced by screenshots (spacing, empty states).

**Interfaces:** none new — this task verifies the whole shell end to end.

- [ ] **Step 1: Build the dist the app loads, then start the dev server**
```
TMPDIR=/d/tmp TEMP=/d/tmp TMP=/d/tmp pnpm --filter @ppt4ai/editor build
TMPDIR=/d/tmp TEMP=/d/tmp TMP=/d/tmp pnpm --filter @ppt4ai/playground dev   # background; note the 127.0.0.1:4174 URL
```

- [ ] **Step 2: Write the e2e smoke** — `apps/playground/e2e/editor-shell.spec.ts` (mirrors the existing `editor-canvas.spec.ts` style):
```ts
import { expect, test } from '@playwright/test'

test('editor shell: four regions, add + select a slide', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174/')
  for (const r of ['toolbar', 'navigator', 'stage', 'inspector']) {
    await expect(page.locator(`[data-region="${r}"]`)).toBeVisible()
  }
  const before = await page.locator('[data-slide-item]').count()
  await page.locator('[data-add-slide]').click()
  await expect.poll(() => page.locator('[data-slide-item]').count()).toBeGreaterThan(before)
  await page.locator('[data-slide-item]').last().click()
  await expect(page.locator('[data-region="stage"] canvas[data-slide-canvas]')).toBeVisible()
})
```

- [ ] **Step 3: Run the e2e** the same way the repo runs `apps/playground/e2e/*.spec.ts` (dev server up). If a `playwright.config` is absent, run `npx playwright test apps/playground/e2e/editor-shell.spec.ts`. Expected: PASS. (Best-effort smoke; if the harness cannot run headless here, capture a screenshot instead — Step 4 — and note it.)

- [ ] **Step 4: Screenshot verification.** With the dev server up, screenshot `http://127.0.0.1:4174/` (1366×850) via Playwright chromium and eyeball: four regions laid out, toolbar icons styled, navigator thumbnails, canvas centered, inspector shows the slide panel. Fix spacing/empty-state issues inline in the region SFCs.

- [ ] **Step 5: Full gates (exit codes)**
```
TMPDIR=/d/tmp TEMP=/d/tmp TMP=/d/tmp npx vitest run            # exit 0
TMPDIR=/d/tmp TEMP=/d/tmp TMP=/d/tmp pnpm -r typecheck         # exit 0
TMPDIR=/d/tmp TEMP=/d/tmp TMP=/d/tmp pnpm --filter @ppt4ai/playground build   # exit 0
```

- [ ] **Step 6: Commit**
```bash
git add apps/playground/e2e/editor-shell.spec.ts apps/playground/src/regions/
git commit -m "test(playground): editor shell e2e smoke; polish pass"
```

## Self-Review

- **Spec coverage:** §3 shell/data-flow → Task 4; §4 design system → Tasks 1–2; §5 toolbar → Task 6, navigator → Task 5, canvas stage → Task 7, inspector → Task 8; §6 PptEditor prop + lucide → Tasks 6 + 1; §7 testing (pure/unit, component+stub host, e2e) → Tasks 3/5/6/8 + 9; §8 build order → Tasks 1→9 in order; §10 acceptance → Task 9 gates. AI generation (§9) intentionally excluded.
- **Placeholder scan:** the only "lift from App.vue" instructions name the exact functions to copy from existing, proven code (Tasks 7–8) — concrete, not TBD. No "add error handling"/"write tests"-style gaps.
- **Type consistency:** `PlaygroundPresentationSnapshot`, `PlaygroundPresentationHost`, `stageBindings`, `toolbarModel`, `inspectorContext`, `zoomIn/zoomOut/fitZoom`, and `showObjectToolbar` names are used identically across tasks and match the host/PptEditor signatures gathered from the codebase.


















