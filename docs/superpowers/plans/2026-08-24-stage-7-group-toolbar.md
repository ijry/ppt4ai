# Group/Ungroup Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add top-level multi-selection, a union selection frame, selection-preserving drag, and native UnoCSS Group/Ungroup controls wired to the existing engine commands.

**Architecture:** `SlideCanvas` reports hit-test intent plus modifier state; `PptEditor` converts that intent into a controlled selection array while continuing to emit the legacy single-selection event. The editor derives single or union bounds from the existing flat scene/group metadata, and the Playground host remains the only layer that dispatches engine commands and refreshes snapshots.

**Tech Stack:** Vue 3.5, TypeScript 6, Vue-I18n 11, UnoCSS 66, Vitest 4, existing `@ppt4ai/engine` and `@ppt4ai/render` APIs.

## Global Constraints

- Runtime UI dependencies remain Vue, Vue-I18n, and UnoCSS only; do not add Element Plus or another component framework.
- Multi-selection, Group, and Ungroup operate only on top-level objects while `groupPath` is empty.
- Preserve `selectedElementId` and `select` compatibility while adding `selectedElementIds` and `selection-change`.
- Single selection keeps eight resize handles; multi-selection has one union border and no resize handles.
- Group/Ungroup buttons use native `<button type="button">` elements with visible focus and disabled states and 150–200ms transitions.
- Reuse atomic engine commands `{ type: 'group' }` and `{ type: 'ungroup', groupId }`; do not add protocol or engine command variants.
- Follow strict TDD: add a focused failing test, run it to observe RED, implement the minimum behavior, then rerun to GREEN.
- Keep all implementation and test changes in one stage commit; commit `进度.md` separately after full verification.

---

### Task 1: Carry Selection Intent From SlideCanvas

**Files:**
- Modify: `packages/editor/src/slide-canvas.ts`
- Modify: `packages/editor/src/SlideCanvas.vue`
- Test: `packages/editor/src/SlideCanvas.test.ts`

**Interfaces:**
- Consumes: existing `hitTestScene(scene, point, groupPath)` and pointer modifier fields.
- Produces: `type CanvasSelectionIntent = { nodeId?: string; toggle: boolean }` and `select: [intent: CanvasSelectionIntent]`.

- [ ] **Step 1: Write failing modifier-intent tests**

Add focused tests that dispatch pointerdown events against a known node and blank canvas. Assert exact payloads for normal, Shift, Ctrl, and Meta clicks:

```ts
expect(wrapper.emitted('select')).toEqual([
  [{ nodeId: 'shape-1', toggle: false }],
  [{ nodeId: 'shape-1', toggle: true }],
  [{ nodeId: 'shape-1', toggle: true }],
  [{ nodeId: 'shape-1', toggle: true }],
  [{ nodeId: undefined, toggle: false }],
])
```

Keep the existing move-start assertion so the test also proves selection intent is emitted before drag startup.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src/SlideCanvas.test.ts
```

Expected: FAIL because `SlideCanvas` still emits a string or `undefined` instead of the intent object.

- [ ] **Step 3: Implement the typed intent payload**

Define and export the payload type from `slide-canvas.ts`, import it into the component, update `defineEmits`, and emit modifier state before existing drag setup:

```ts
export type CanvasSelectionIntent = {
  nodeId?: string
  toggle: boolean
}

emit('select', {
  nodeId,
  toggle: event.shiftKey || event.ctrlKey || event.metaKey,
})
```

Do not alter hit testing, pointer capture, move deltas, activation, or group-entry behavior.

- [ ] **Step 4: Rerun the focused test to verify GREEN**

Run the same command. Expected: PASS with all existing `SlideCanvas` tests unchanged except their updated selection payload assertions.

---

### Task 2: Add Controlled Multi-Selection And Union Overlay

**Files:**
- Modify: `packages/editor/src/PptEditor.vue`
- Test: `packages/editor/src/PptEditor.test.ts`

**Interfaces:**
- Consumes: `CanvasSelectionIntent`, `SceneGraph.nodes`, `SceneGraph.groups`, existing `SelectionOverlay`.
- Produces: prop `selectedElementIds?: string[]`; event `selection-change: [payload: { elementIds: string[] }]`; compatible `select` emission.

- [ ] **Step 1: Write failing controlled-selection tests**

Add tests for these exact cases:

1. `selectedElementIds` takes precedence over `selectedElementId`.
2. Duplicate and missing IDs are removed while valid order is preserved.
3. Normal click emits `selection-change` before `select` and replaces selection.
4. Shift/Ctrl/Meta intent toggles an object at the end of the array or removes it.
5. Modified blank click emits nothing because selection is unchanged; unmodified blank click emits `{ elementIds: [] }` then `undefined`.
6. Entered-group selection keeps the existing single-selection behavior and ignores toggle expansion.

Use the mounted child component to emit intent directly rather than depending on Canvas coordinates:

```ts
slideCanvas.vm.$emit('select', { nodeId: 'shape-2', toggle: true })
await nextTick()
expect(wrapper.emitted('selection-change')?.at(-1)).toEqual([{ elementIds: ['shape-1', 'shape-2'] }])
expect(wrapper.emitted('select')?.at(-1)).toEqual([undefined])
```

- [ ] **Step 2: Write failing union-border tests**

Mount a scene containing one top-level node and one top-level group with separated bounds. Pass both IDs and assert:

- one `[data-selection-border]` is rendered at the scaled union rectangle;
- zero `[data-selection-handle]` elements are rendered;
- a single selected group still renders eight handles;
- a selection containing only missing IDs renders no overlay.

Expected union example at zoom 1 for bounds `{ x: 0, y: 0, w: 914400, h: 914400 }` and `{ x: 1828800, y: 914400, w: 914400, h: 914400 }`: `left: 0px`, `top: 0px`, `width: 288px`, `height: 192px`.

- [ ] **Step 3: Run PptEditor tests to verify RED**

Run:

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src/PptEditor.test.ts
```

Expected: FAIL because the prop/event do not exist, selection events accept only IDs, and overlay bounds only support one selected element.

- [ ] **Step 4: Implement selection normalization and event compatibility**

Add a computed normalized selection with these helpers:

```ts
function elementBounds(elementId: string) {
  return props.scene?.groups?.find((entry) => entry.id === elementId)?.bounds
    ?? props.scene?.nodes.find((entry) => entry.id === elementId)?.bounds
}

function isInteractiveElementId(elementId: string): boolean {
  const currentGroupId = groupPath.value[groupPath.value.length - 1]
  if (currentGroupId) {
    return props.scene?.groups?.find((group) => group.id === currentGroupId)?.childIds.includes(elementId) ?? false
  }
  const group = props.scene?.groups?.find((entry) => entry.id === elementId)
  if (group) return group.ancestorIds.length === 0
  return !props.scene?.groups?.some((entry) => entry.childIds.includes(elementId))
}

const selectedElementIds = computed(() => {
  const source = props.selectedElementIds !== undefined
    ? props.selectedElementIds
    : props.selectedElementId ? [props.selectedElementId] : []
  return source.filter((id, index) => isInteractiveElementId(id) && elementBounds(id) && source.indexOf(id) === index)
})

function emitSelection(elementIds: string[]): void {
  emit('selection-change', { elementIds })
  emit('select', elementIds.length === 1 ? elementIds[0] : undefined)
}
```

Handle `CanvasSelectionIntent` according to the approved toggle matrix. While `groupPath` is non-empty, coerce the selection to the existing single-node behavior.

- [ ] **Step 5: Implement single and union screen bounds**

Replace the single-ID bounds helper with a computed frame model:

```ts
const selectionFrame = computed(() => {
  const bounds = selectedElementIds.value.map(elementBounds).filter(isBounds)
  if (bounds.length === 0) return
  const union = bounds.length === 1 ? bounds[0] : unionBounds(bounds)
  return { bounds: toScreenBounds(union), resizable: bounds.length === 1 }
})
```

Render the existing `SelectionOverlay` once. Pass an empty handle list or a dedicated `show-handles` prop only if the current component API requires it; prefer the smallest change that keeps single-selection resize behavior intact. Guard `startResize` so a multi-selection frame cannot start a resize gesture.

- [ ] **Step 6: Rerun PptEditor tests to verify GREEN**

Run the focused command. Expected: PASS for new controlled selection, event ordering, union bounds, and existing single-selection/group-entry/text-edit tests.

---

### Task 3: Add Native Group/Ungroup Toolbar Controls

**Files:**
- Modify: `packages/editor/src/PptEditor.vue`
- Modify: `packages/editor/src/locales/en-US.ts`
- Modify: `packages/editor/src/locales/zh-CN.ts`
- Test: `packages/editor/src/PptEditor.test.ts`

**Interfaces:**
- Consumes: normalized `selectedElementIds`, valid top-level group metadata, `groupPath`.
- Produces: `group: []` and `ungroup: [payload: { groupId: string }]` events.

- [ ] **Step 1: Write failing toolbar-state tests**

Add assertions covering the full enablement matrix:

| Selection | Entered group | Group | Ungroup |
| --- | --- | --- | --- |
| none | no | disabled | disabled |
| one leaf | no | disabled | disabled |
| two leaves | no | enabled | disabled |
| one top-level group | no | disabled | enabled |
| group plus leaf | no | enabled | disabled |
| any valid selection | yes | disabled | disabled |

Also assert:

- both controls are native buttons with `type="button"` and `disabled` attributes;
- English and Chinese mounts display localized visible text and matching `aria-label`;
- enabled buttons contain `focus-visible:` and `transition-` UnoCSS classes;
- clicking enabled Group emits `group` once;
- clicking enabled Ungroup emits `{ groupId: 'group-1' }`;
- clicking disabled controls emits neither event.

- [ ] **Step 2: Run PptEditor tests to verify RED**

Run the focused `PptEditor.test.ts` command. Expected: FAIL because the toolbar and events do not exist.

- [ ] **Step 3: Implement toolbar state, events, and copy**

Add locale keys:

```ts
object: {
  group: 'Group',
  ungroup: 'Ungroup',
}
```

and Chinese values `组合` / `取消组合`.

Add computed state:

```ts
const isInsideGroup = computed(() => groupPath.value.length > 0)
const selectedGroupId = computed(() => selectedElementIds.value.length === 1
  && props.scene?.groups?.some((group) => group.id === selectedElementIds.value[0] && group.ancestorIds.length === 0)
  ? selectedElementIds.value[0]
  : undefined)
const canGroup = computed(() => !isInsideGroup.value && selectedElementIds.value.length >= 2)
const canUngroup = computed(() => !isInsideGroup.value && Boolean(selectedGroupId.value))
```

Render a stable toolbar container with `data-object-toolbar`, `data-group-button`, and `data-ungroup-button`. Use flat border/background utilities, native disabled state, `focus-visible:outline-2`, and a 150–200ms color/border transition. Do not add icon packages, custom CSS, or Element Plus.

- [ ] **Step 4: Rerun PptEditor tests to verify GREEN**

Run the focused command. Expected: PASS for the toolbar matrix, localization, event payloads, and all earlier editor behavior.

---

### Task 4: Wire Multi-Selection And Atomic Commands In Playground

**Files:**
- Modify: `apps/playground/src/asset-host.ts`
- Modify: `apps/playground/src/asset-host.test.ts`
- Modify: `apps/playground/src/App.vue`
- Modify: `apps/playground/src/App.test.ts`

**Interfaces:**
- Consumes: engine commands `select`, `move`, `group`, `ungroup`; editor events `selection-change`, `group`, `ungroup`.
- Produces: `selectElements(elementIds: string[]): AssetHostSnapshot`, `groupSelected(): AssetHostSnapshot`, `ungroupSelected(groupId: string): AssetHostSnapshot`, selection-preserving `moveSelected`.

- [ ] **Step 1: Write failing host unit tests**

Create a host fixture with at least two top-level leaves. Assert:

```ts
host.selectElements(['shape-1', 'shape-2'])
expect(host.snapshot().engineState.selection).toEqual(['shape-1', 'shape-2'])

const undoBeforeMove = host.snapshot().engineState.undoDepth
host.moveSelected('shape-1', 100, 200)
expect(host.snapshot().engineState.selection).toEqual(['shape-1', 'shape-2'])
expect(host.snapshot().engineState.undoDepth).toBe(undoBeforeMove + 1)
```

Then verify dragging an unselected leaf replaces selection before moving. Add group/ungroup assertions proving group selects the created group, ungroup selects the former children, and each command increases undo depth by one atomic transaction.

- [ ] **Step 2: Run host tests to verify RED**

Run:

```powershell
pnpm exec vitest run apps/playground/src/asset-host.test.ts
```

Expected: FAIL because the new methods do not exist and `moveSelected` collapses every drag to one selected node.

- [ ] **Step 3: Implement host command wrappers**

Add `selectElements` and keep `selectElement` as a compatibility wrapper:

```ts
function selectElements(elementIds: string[]): AssetHostSnapshot {
  engine.dispatch({ type: 'select', elementIds })
  return refresh()
}

function selectElement(elementId: string | undefined): AssetHostSnapshot {
  return selectElements(elementId ? [elementId] : [])
}
```

Update `moveSelected` to inspect `engine.getState().selection` before selecting the drag target. Add thin `groupSelected` and `ungroupSelected` wrappers that dispatch existing commands and call the same snapshot refresh path.

- [ ] **Step 4: Rerun host tests to verify GREEN**

Run the focused host command. Expected: PASS with existing asset insertion/replacement behavior unchanged.

- [ ] **Step 5: Write failing App integration tests**

Mount `App.vue` and assert that `PptEditor` receives the full engine selection through `selectedElementIds`. Emit:

```ts
editor.vm.$emit('selection-change', { elementIds: ['shape-1', 'shape-2'] })
editor.vm.$emit('group')
editor.vm.$emit('ungroup', { groupId })
```

Assert the displayed selected-element state and engine undo depth follow refreshed snapshots. Include a move event from an already selected member and prove both selected objects remain selected.

- [ ] **Step 6: Run App tests to verify RED**

Run:

```powershell
pnpm exec vitest run apps/playground/src/App.test.ts
```

Expected: FAIL because `App.vue` still passes only `selectedElementId` and has no new event handlers.

- [ ] **Step 7: Implement App bindings**

Derive the controlled values and bind both compatibility props:

```ts
const selectedElementIds = computed(() => [...assetSnapshot.value.engineState.selection])
const selectedElementId = computed(() => selectedElementIds.value.length === 1 ? selectedElementIds.value[0] : undefined)
```

Bind `:selected-element-ids`, handle `@selection-change` with `assetHost.selectElements`, handle `@group` and `@ungroup` with the new wrappers, and retain `@select` only where legacy compatibility tests require it. Avoid dispatching the same selection twice from both events; the Playground should use `selection-change` as its authoritative new path.

- [ ] **Step 8: Rerun App and host tests to verify GREEN**

Run:

```powershell
pnpm exec vitest run apps/playground/src/asset-host.test.ts apps/playground/src/App.test.ts
```

Expected: PASS for host commands, Vue wiring, atomic undo depth, and existing upload/asset behavior.

---

### Task 5: Verify Regressions And Commit The Stage

**Files:**
- Verify: `packages/editor/src/SlideCanvas.vue`
- Verify: `packages/editor/src/slide-canvas.ts`
- Verify: `packages/editor/src/PptEditor.vue`
- Verify: `packages/editor/src/locales/en-US.ts`
- Verify: `packages/editor/src/locales/zh-CN.ts`
- Verify: `apps/playground/src/asset-host.ts`
- Verify: `apps/playground/src/App.vue`
- Test: `packages/editor/src/SlideCanvas.test.ts`
- Test: `packages/editor/src/PptEditor.test.ts`
- Test: `apps/playground/src/asset-host.test.ts`
- Test: `apps/playground/src/App.test.ts`

**Interfaces:**
- Consumes: all behavior produced by Tasks 1–4.
- Produces: one verified implementation/tests commit ready for the separate milestone update.

- [ ] **Step 1: Run focused editor and Playground tests**

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src/SlideCanvas.test.ts src/PptEditor.test.ts
pnpm exec vitest run apps/playground/src/asset-host.test.ts apps/playground/src/App.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run all editor source tests**

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src
```

Expected: PASS. Do not run compiled `packages/editor/dist` test files.

- [ ] **Step 3: Run workspace source tests and static checks**

```powershell
pnpm test -- --exclude "**/dist/**"
pnpm typecheck
pnpm build
pnpm check:boundaries
```

Expected: all commands PASS.

- [ ] **Step 4: Scan forbidden dependencies and patch hygiene**

```powershell
rg -n -i "element-plus|element plus" package.json pnpm-lock.yaml packages apps
git diff --check
git status --short
```

Expected: the Element Plus scan has no matches, `git diff --check` is clean, and status contains only the intended implementation/test files.

- [ ] **Step 5: Commit implementation and tests**

```powershell
git add -- packages/editor/src/slide-canvas.ts packages/editor/src/SlideCanvas.vue packages/editor/src/SlideCanvas.test.ts packages/editor/src/PptEditor.vue packages/editor/src/PptEditor.test.ts packages/editor/src/locales/en-US.ts packages/editor/src/locales/zh-CN.ts apps/playground/src/asset-host.ts apps/playground/src/asset-host.test.ts apps/playground/src/App.vue apps/playground/src/App.test.ts
git commit -m "feat: add group toolbar interactions"
```

---

### Task 6: Record The Milestone Separately

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: final verification counts and implementation commit hash from Task 5.
- Produces: a standalone documentation commit recording the completed stage.

- [ ] **Step 1: Update the current Stage 7 milestone**

Add a concise entry recording:

- controlled top-level multi-selection and compatibility API;
- modifier-click toggling and blank-click clearing;
- union border without multi-resize handles;
- selection-preserving multi-object drag;
- native UnoCSS Group/Ungroup toolbar and entered-group disablement;
- Playground engine wiring and atomic group/ungroup selection results;
- exact focused/full test counts plus typecheck, build, boundary, forbidden dependency, and diff checks.

- [ ] **Step 2: Check documentation diff**

```powershell
git diff --check
git diff -- 进度.md
```

Expected: clean whitespace and only the new milestone entry.

- [ ] **Step 3: Commit the milestone**

```powershell
git add -- 进度.md
git commit -m "docs: record group toolbar milestone"
```

- [ ] **Step 4: Confirm clean handoff**

```powershell
git status --short --branch
git log -5 --oneline
```

Expected: clean working tree with separate spec, plan, implementation/tests, and milestone commits.
