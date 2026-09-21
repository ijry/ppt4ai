# 阶段 7 图片旋转、翻转与中心缩放实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有图片补齐旋转、水平/垂直翻转和 Alt 中心缩放，并通过 editor、engine 与 Playground 形成一次性、可撤销的受控事务。

**Architecture:** `@ppt4ai/editor` 负责纯几何计算、pointer capture、预览和修饰键；`@ppt4ai/engine` 只接受最终图片角度、翻转轴或 bounds，并以 patch 记录文档变更；Playground 负责把 typed event 映射到一个 engine command。现有图片模型、SceneGraph、Canvas painter 和 PPTX 导入保持不变，已有图片源包 `a:xfrm` 写回另行处理。

**Tech Stack:** Vue 3.5、TypeScript 6、Vue-I18n 11、UnoCSS 66、Vitest 4、现有 `@ppt4ai/engine`、`@ppt4ai/model`、`@ppt4ai/render`。

**Spec:** `docs/superpowers/specs/2026-08-29-stage-7-image-transform-editing-design.md`

## Global Constraints

- `ElementTransform` remains image-only; do not add transform state to shape, text, table, or group.
- Rotation and flip commands accept only one `kind: 'image'` element; group and multi-selection rotation/flip remain unsupported.
- Rotation uses OOXML `1/60000` degree integer units; positive values are clockwise in Canvas/CSS coordinates.
- `ResizePointerPayload` always contains `handle`, `point`, `shiftKey`, and `altKey`, all clone-safe.
- `resizeBounds` and `resizeBoundsWithAspectRatio` retain their existing fixed-opposite-edge behavior when `center` is absent or false.
- Centered corner resizing with Shift preserves the starting aspect ratio and the starting center; edge handles remain single-axis.
- Centered snapping preserves the starting center and reports only guides actually used to produce the final bounds.
- Every mutation goes through `EditorEngine.dispatch`; one completed gesture creates at most one history entry.
- A scene, selection, zoom, scope, pointercancel, or unmount change cancels local preview without dispatching a command.
- Existing image crop, mask, effect, asset, bounds, selection, undo, and redo data remain unchanged unless the command explicitly changes rotation or one flip axis.
- Rotation preview changes only the selection overlay; the content Canvas is rerendered after the controlled document update.
- Source PPTX transform writeback is outside this plan; unchanged source-package behavior must remain intact.
- Runtime UI dependencies remain Vue, Vue-I18n, and UnoCSS only; do not add Element Plus or any other dependency.
- Follow strict TDD for every behavior: write a focused failing test, observe the expected RED failure, implement the minimum behavior, then verify GREEN.
- Commit each completed implementation task separately; update `进度.md` in a separate documentation commit after all feature tests pass.

---

## File Map

- `packages/editor/src/selection-overlay.ts` owns resize geometry, modifier payload types, and shared point types.
- `packages/editor/src/SelectionOverlay.vue` renders the border, resize handles, rotation handle, and pointer events without owning document state.
- `packages/editor/src/image-transform.ts` owns browser-independent image rotation math and 15-degree snapping.
- `packages/editor/src/resize-snapping.ts` extends existing resize candidates with center-preserving application.
- `packages/engine/src/index.ts` owns image rotation/flip commands and atomic patch history.
- `packages/editor/src/PptEditor.vue` owns image gesture snapshots, preview state, toolbar intents, and typed emits.
- `packages/editor/src/i18n.ts`, `packages/editor/src/locales/zh-CN.ts`, and `packages/editor/src/locales/en-US.ts` own image transform copy.
- `apps/playground/src/asset-host.ts` maps image transform intents to engine commands and statuses; `App.vue` wires the events.
- Existing renderer/importer files are not modified in this slice because image transform data and painting already work.

## Task 1: Center Resize Geometry And Modifier Payload

**Files:**
- Modify: `packages/editor/src/selection-overlay.ts`
- Modify: `packages/editor/src/SelectionOverlay.vue`
- Test: `packages/editor/src/selection-overlay.test.ts`

**Interfaces:**
- Consumes: existing `Rect`, `SelectionHandle`, `Point`, `resizeBounds`, and `resizeBoundsWithAspectRatio`.
- Produces: `ResizeOptions.center?: boolean` and `ResizePointerPayload.altKey: boolean` for the snapping and editor tasks.

- [ ] **Step 1: Write the failing centered geometry and Alt payload tests**

Add these cases before changing production code:

```ts
it('resizes an east edge symmetrically around the starting center', () => {
  expect(resizeBounds(bounds, 'e', { x: 160, y: 50 }, { center: true })).toEqual({
    x: -40, y: 20, w: 200, h: 60,
  })
})

it('keeps the center and ratio for an Alt-Shift corner resize', () => {
  expect(resizeBoundsWithAspectRatio(
    bounds,
    'se',
    { x: 150, y: 104 },
    { center: true },
  )).toEqual({ x: -30, y: -4, w: 180, h: 108 })
})

it('clamps centered resize at the minimum without crossing the center', () => {
  expect(resizeBounds(bounds, 'nw', { x: 55, y: 52 }, {
    center: true,
    minWidth: 30,
    minHeight: 25,
  })).toEqual({ x: 45, y: 37.5, w: 30, h: 25 })
})
```

Extend the existing Vue event test so the two payloads are exactly:

```ts
[
  { handle: 'se', point: { x: 140, y: 80 }, shiftKey: true, altKey: true },
  { handle: 'se', point: { x: 150, y: 90 }, shiftKey: false, altKey: false },
]
```

Dispatch `pointerdown` with both `shiftKey` and `altKey` set, then a separate `pointermove` with neither flag to prove the component reads modifiers from every event.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src/selection-overlay.test.ts
```

Expected: FAIL because `ResizeOptions` has no centered mode, the centered expected bounds are not produced, and emitted payloads do not contain `altKey`.

- [ ] **Step 3: Implement the minimum centered geometry and payload**

In `selection-overlay.ts`:

1. Add `center?: boolean` to `ResizeOptions`.
2. Keep `resizeBounds`'s current branch as the default path.
3. For `center: true`, compute the start center, derive each active half-size from the pointer distance on its active axis, clamp the final width/height to the minimums, and return a fresh rectangle centered on the original center.
4. For inactive axes, retain the original dimension and center.
5. Let `resizeBoundsWithAspectRatio` call the centered raw calculation first; for a corner, choose the larger normalized size change, derive the other dimension from `startBounds.w / startBounds.h`, and keep the original center when centered.

In `SelectionOverlay.vue`:

- Add `altKey` to every emitted `ResizePointerPayload` using `event.altKey` at emission time.
- Preserve pointer capture, release, data attributes, and existing event names.

- [ ] **Step 4: Rerun the focused test and verify GREEN**

Run the same Vitest command. Expected: all existing fixed-edge tests and the new centered/Alt tests pass.

- [ ] **Step 5: Commit the geometry checkpoint**

```powershell
git add packages/editor/src/selection-overlay.ts packages/editor/src/SelectionOverlay.vue packages/editor/src/selection-overlay.test.ts
git commit -m "feat: add centered resize geometry"
```

## Task 2: Image Rotation Geometry

**Files:**
- Create: `packages/editor/src/image-transform.ts`
- Create: `packages/editor/src/image-transform.test.ts`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- Consumes: `Point` from `selection-overlay.ts` and an integer starting rotation.
- Produces:

```ts
export type ImageFlipAxis = 'horizontal' | 'vertical'
export const IMAGE_ROTATION_SNAP_STEP = 900000
export function rotationFromPointer(
  startRotation: number,
  center: Point,
  startPoint: Point,
  currentPoint: Point,
  shiftKey?: boolean,
): number
```

- [ ] **Step 1: Write failing rotation math tests**

Create tests with these exact expectations:

```ts
it('computes a clockwise quarter turn in OOXML units', () => {
  expect(rotationFromPointer(0, { x: 50, y: 50 }, { x: 50, y: 0 }, { x: 100, y: 50 })).toBe(5400000)
})

it('adds a starting rotation and snaps Shift rotations to fifteen degrees', () => {
  const radians = 17 * Math.PI / 180
  expect(rotationFromPointer(
    1800000,
    { x: 0, y: 0 },
    { x: 0, y: -100 },
    { x: Math.sin(radians) * 100, y: -Math.cos(radians) * 100 },
    true,
  )).toBe(2700000)
})

it('unwraps a pointer crossing the negative-positive angle boundary', () => {
  const start = { x: Math.cos(Math.PI - 0.05) * 100, y: Math.sin(Math.PI - 0.05) * 100 }
  const current = { x: Math.cos(-Math.PI + 0.05) * 100, y: Math.sin(-Math.PI + 0.05) * 100 }
  expect(rotationFromPointer(0, { x: 0, y: 0 }, start, current)).toBe(343775)
})

it('rejects non-finite rotation inputs', () => {
  expect(() => rotationFromPointer(0, { x: Number.NaN, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toThrow('rotation points must be finite')
})
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src/image-transform.test.ts
```

Expected: FAIL because `image-transform.ts` and `rotationFromPointer` do not exist.

- [ ] **Step 3: Implement deterministic angle calculation**

Validate all five points/coordinates and `startRotation`. Calculate `atan2` from the center, unwrap the signed delta into `[-Math.PI, Math.PI]`, convert the delta to `1/60000` degree units with `Math.round`, and add it to `startRotation`. When `shiftKey` is true, round the absolute result to the nearest `IMAGE_ROTATION_SNAP_STEP`; otherwise return the unsnapped integer. Export the union type and function from the editor package index.

- [ ] **Step 4: Rerun the new test and verify GREEN**

Run the same command. Expected: all four rotation math tests pass and `structuredClone` of returned numbers remains trivial.

- [ ] **Step 5: Commit the rotation geometry checkpoint**

```powershell
git add packages/editor/src/image-transform.ts packages/editor/src/image-transform.test.ts packages/editor/src/index.ts
git commit -m "feat: add image rotation geometry"
```

## Task 3: Center-Preserving Resize Snapping

**Files:**
- Modify: `packages/editor/src/resize-snapping.ts`
- Test: `packages/editor/src/resize-snapping.test.ts`

**Interfaces:**
- Consumes: `ResizeSnapRequest`, `sourceBounds`, `proposedBounds`, `SelectionHandle`, and existing candidate ordering.
- Produces: `ResizeSnapRequest.centered?: boolean`; `ResizeSnapResult` remains `{ bounds: Rect; guides: SnapGuide[] }`.

- [ ] **Step 1: Write failing centered snapping tests**

Define these compact fixtures in `resize-snapping.test.ts` so every example is executable:

```ts
const centeredScene: SceneGraph = {
  slideId: 'slide-1',
  page: { w: 1000, h: 800 },
  nodes: [
    { id: 'selected', kind: 'shape', bounds: { x: 100, y: 100, w: 100, h: 60 }, path: [] },
    { id: 'guide', kind: 'shape', bounds: { x: 260, y: 400, w: 20, h: 20 }, path: [] },
  ],
}

const centeredAspectScene: SceneGraph = {
  ...centeredScene,
  nodes: [
    centeredScene.nodes[0]!,
    { id: 'aspect-guide', kind: 'shape', bounds: { x: 220, y: 400, w: 10, h: 10 }, path: [] },
  ],
}
```

Add assertions for:

```ts
it('snaps a centered east edge while retaining the source center', () => {
  expect(snapResizeBounds({
    scene: centeredScene,
    selectedElementIds: ['selected'],
    sourceBounds: { x: 100, y: 100, w: 100, h: 60 },
    proposedBounds: { x: 50, y: 100, w: 200, h: 60 },
    handle: 'e',
    centered: true,
    options: { enabled: true, threshold: 10, gridSize: 0 },
  })).toEqual({
    bounds: { x: 40, y: 100, w: 220, h: 60 },
    guides: [{ axis: 'x', position: 260, source: 'element', elementId: 'guide' }],
  })
})

it('uses one centered guide for a Shift corner resize', () => {
  const result = snapResizeBounds({
    scene: centeredAspectScene,
    selectedElementIds: ['selected'],
    sourceBounds: { x: 100, y: 100, w: 100, h: 50 },
    proposedBounds: { x: 80, y: 90, w: 140, h: 70 },
    handle: 'se',
    centered: true,
    aspectRatioLocked: true,
    options: { enabled: true, threshold: 5, gridSize: 0 },
  })
  expect(result.bounds.w / result.bounds.h).toBe(2)
  expect(result.bounds.x + result.bounds.w / 2).toBe(150)
  expect(result.bounds.y + result.bounds.h / 2).toBe(125)
  expect(result.guides).toEqual([
    { axis: 'x', position: 220, source: 'element', elementId: 'aspect-guide' },
  ])
})

it('keeps legacy fixed-edge snapping unchanged when centered is absent', () => {
  const result = snapResizeBounds({
    scene,
    selectedElementIds: ['selected'],
    sourceBounds: { x: 100, y: 100, w: 100, h: 100 },
    proposedBounds: { x: 100, y: 100, w: 195, h: 100 },
    handle: 'e',
    options: { enabled: true, threshold: 10 },
  })
  expect(result.bounds).toEqual({ x: 100, y: 100, w: 200, h: 100 })
})
```

- [ ] **Step 2: Run the focused snapping test and verify RED**

Run:

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src/resize-snapping.test.ts
```

Expected: FAIL because `centered` is not accepted and active deltas currently move only one edge.

- [ ] **Step 3: Implement centered candidate application**

Add `centered?: boolean` to `ResizeSnapRequest`. Keep candidate enumeration and tie-breaking unchanged. Add a centered delta helper that:

1. Reads the source center.
2. Applies the candidate to the proposed active edge.
3. Derives the new active half-size from that edge and mirrors it across the source center.
4. Leaves inactive axes untouched and rejects non-positive results.

In the aspect-locked corner branch, select the same normalized candidate axis used by the existing implementation, apply its centered delta, derive the other dimension from the source ratio, and center both axes. Return only the selected guide. Leave the current non-centered branches byte-for-byte equivalent in behavior.

- [ ] **Step 4: Rerun the focused snapping test and verify GREEN**

Run the same command. Expected: centered edge/corner assertions and all pre-existing snapping tests pass.

- [ ] **Step 5: Commit the snapping checkpoint**

```powershell
git add packages/editor/src/resize-snapping.ts packages/editor/src/resize-snapping.test.ts
git commit -m "feat: preserve center during resize snapping"
```

## Task 4: Atomic Engine Image Transform Commands

**Files:**
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/engine.test.ts`

**Interfaces:**
- Consumes: `ImageElement`, `ElementTransform`, `validateDocument`, and existing `commit`/history helpers.
- Produces:

```ts
export type ImageFlipAxis = 'horizontal' | 'vertical'
type EngineCommand =
  | { type: 'setImageRotation'; elementId: string; rotation: number }
  | { type: 'toggleImageFlip'; elementId: string; axis: ImageFlipAxis }
```

- [ ] **Step 1: Write failing engine tests**

Use the existing image fixture carrying rotation, both flip fields, crop, mask, and effects. Add these tests:

```ts
it('sets only image rotation and preserves every other appearance field', () => {
  const engine = new EditorEngine(makeImageDocument())
  engine.dispatch({ type: 'select', elementIds: ['img_1'] })
  const state = engine.dispatch({ type: 'setImageRotation', elementId: 'img_1', rotation: 2700000 })
  expect(state.document.elements.img_1).toMatchObject({
    transform: { rotation: 2700000, flipH: true },
    sourceCrop: { left: 1000, bottom: 2000 },
    maskPreset: 'roundRect',
    effects: [{ type: 'grayscl' }],
  })
  expect(state.history).toEqual({ undoDepth: 1, redoDepth: 0 })
  expect(state.selection).toEqual(['img_1'])
})

it('toggles one flip axis and removes an empty transform', () => {
  const engine = new EditorEngine(makeImageDocument())
  engine.dispatch({ type: 'toggleImageFlip', elementId: 'img_1', axis: 'horizontal' })
  expect(engine.getState().document.elements.img_1).toMatchObject({ transform: { rotation: 900000 } })
  engine.dispatch({ type: 'setImageRotation', elementId: 'img_1', rotation: 0 })
  engine.dispatch({ type: 'toggleImageFlip', elementId: 'img_1', axis: 'vertical' })
  expect(engine.getState().document.elements.img_1).toMatchObject({ transform: { flipV: true } })
})

it('rejects invalid image commands atomically and restores them with undo/redo', () => {
  const engine = new EditorEngine(makeImageDocument())
  const before = engine.getState()
  expect(() => engine.dispatch({ type: 'setImageRotation', elementId: 'el_a', rotation: 1 })).toThrow('element is not an image: el_a')
  expect(() => engine.dispatch({ type: 'setImageRotation', elementId: 'img_1', rotation: 1.5 })).toThrow('rotation must be an integer')
  expect(() => engine.dispatch({ type: 'toggleImageFlip', elementId: 'img_1', axis: 'diagonal' as never })).toThrow('unsupported image flip axis: diagonal')
  expect(engine.getState()).toEqual(before)
  engine.dispatch({ type: 'setImageRotation', elementId: 'img_1', rotation: 1800000 })
  engine.dispatch({ type: 'undo' })
  expect(engine.getState().document.elements.img_1).toEqual(before.document.elements.img_1)
  engine.dispatch({ type: 'redo' })
  expect(engine.getState().document.elements.img_1).toMatchObject({ transform: { rotation: 1800000 } })
  expect(structuredClone(engine.getState())).toEqual(engine.getState())
})
```

- [ ] **Step 2: Run the focused engine tests and verify RED**

Run:

```powershell
pnpm --filter @ppt4ai/engine exec vitest run src/engine.test.ts -t "image rotation|image flip|image commands"
```

Expected: FAIL because the command union and dispatch cases do not exist.

- [ ] **Step 3: Implement atomic command handlers**

Add the exported `ImageFlipAxis` type and both command variants. In `dispatch`, route to private methods. Each method must:

1. Find the element and throw `element does not exist: <id>` when absent.
2. Throw `element is not an image: <id>` for non-image targets.
3. Validate a finite integer rotation or one of the two exact axes before reading any mutable state.
4. Clone the current transform, change only the requested field, remove false flip fields and an empty transform object, and build a candidate document.
5. Run `validateDocument` on the candidate, then call one `commit` with the transform path.

Do not alter selection, guides, asset metadata, crop, mask, effects, or bounds. A semantic no-op must return without history.

- [ ] **Step 4: Rerun the focused engine tests and verify GREEN**

Run the same command, then run the existing engine transform tests:

```powershell
pnpm --filter @ppt4ai/engine exec vitest run src/engine.test.ts -t "resize|move|image"
```

Expected: new command tests and all existing movement/resize tests pass.

- [ ] **Step 5: Commit the engine checkpoint**

```powershell
git add packages/engine/src/index.ts packages/engine/src/engine.test.ts
git commit -m "feat: add atomic image transform commands"
```

## Task 5: Rotation Handle And Overlay Contract

**Files:**
- Modify: `packages/editor/src/SelectionOverlay.vue`
- Modify: `packages/editor/src/selection-overlay.ts`
- Modify: `packages/editor/src/index.ts`
- Test: `packages/editor/src/selection-overlay.test.ts`

**Interfaces:**
- Consumes: `Rect`, `Point`, `ResizePointerPayload`, and `rotationFromPointer`.
- Produces:

```ts
export interface RotatePointerPayload {
  point: Point
  shiftKey: boolean
}

SelectionOverlay props:
  rotation?: number
  showRotationHandle?: boolean

SelectionOverlay emits:
  rotate-start: RotatePointerPayload
  rotate: RotatePointerPayload
  rotate-end: RotatePointerPayload
  rotate-cancel: RotatePointerPayload
```

- [ ] **Step 1: Write failing overlay tests**

Mount the component with `rotation: 5400000` and `showRotationHandle: true`. Assert one `[data-selection-rotation-handle]`, one connector marker, and a root/frame style containing `transform: rotate(90deg)`. Mount again with the default prop and assert no rotation handle.

Dispatch a Shift `pointerdown` and a non-modified `pointermove` to the rotation handle and assert:

```ts
[
  { point: { x: 140, y: 20 }, shiftKey: true },
  { point: { x: 150, y: 30 }, shiftKey: false },
]
```

Dispatch `pointercancel` and assert its payload contains the current point and modifier state. Verify the handle calls `setPointerCapture` on start and `releasePointerCapture` on end/cancel using the existing DOM spies.

- [ ] **Step 2: Run the focused overlay tests and verify RED**

Run:

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src/selection-overlay.test.ts
```

Expected: FAIL because the component has no rotation props, handle, events, or rotation style.

- [ ] **Step 3: Implement the stateless rotation overlay**

Add the `RotatePointerPayload` type and typed emits. Render the existing border and resize handles inside a frame with `transform-origin: center center` and `rotate(rotation / 60000)`. Render a short connector and a button centered above the top edge only when `active && showRotationHandle`.

Use one pointer helper for rotation events: build `{ point: { clientX, clientY }, shiftKey: event.shiftKey }`, capture on `rotate-start`, and release on `rotate-end`/`rotate-cancel`. Keep the existing resize event implementation and all data markers intact. Use UnoCSS classes only; do not add a component dependency.

- [ ] **Step 4: Rerun the focused overlay tests and verify GREEN**

Run the same command. Expected: old resize rendering/payload tests and all new rotation handle tests pass.

- [ ] **Step 5: Commit the overlay checkpoint**

```powershell
git add packages/editor/src/SelectionOverlay.vue packages/editor/src/selection-overlay.ts packages/editor/src/index.ts packages/editor/src/selection-overlay.test.ts
git commit -m "feat: add image rotation handle"
```

## Task 6: PptEditor Image Gestures And Centered Preview

**Files:**
- Modify: `packages/editor/src/PptEditor.vue`
- Modify: `packages/editor/src/index.ts`
- Test: `packages/editor/src/PptEditor.test.ts`

**Interfaces:**
- Consumes: `rotationFromPointer`, `resizeBounds`, `resizeBoundsWithAspectRatio`, `snapResizeBounds`, `ResizePointerPayload`, and `RotatePointerPayload`.
- Produces:

```ts
'rotate-image': [payload: { elementId: string; rotation: number }]
'flip-image': [payload: { elementId: string; axis: ImageFlipAxis }]
```

- [ ] **Step 1: Write failing editor integration tests**

Add an image SceneGraph fixture with bounds `{ x: 914400, y: 914400, w: 1828800, h: 914400 }` and `transform: { rotation: 900000 }`. Mount a controlled `PptEditor` and assert:

1. Exactly one rotation handle appears for a single image.
2. A shape selection has no rotation handle.
3. A rotation pointer gesture from the handle emits `rotate-image` with the same final integer returned by `rotationFromPointer`; a Shift gesture emits a 15-degree multiple.
4. An Alt resize keeps the image center unchanged; an Alt+Shift corner resize keeps `w / h` equal to the starting ratio.
5. A scene or controlled selection change between pointerdown and pointerup emits no rotate/resize commit.

Use `getBoundingClientRect` and explicit `PointerEvent` coordinates; do not assert Vue internals. Assert the `data-selection-rotation-handle`, `data-snap-guide`, and existing selection markers.

- [ ] **Step 2: Run the focused editor tests and verify RED**

Run:

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src/PptEditor.test.ts -t "image|center|rotation"
```

Expected: FAIL because PptEditor currently has no image transform state, toolbar intents, rotation handlers, or centered modifier wiring.

- [ ] **Step 3: Implement controlled image gesture state**

In `PptEditor.vue`:

1. Add `selectedImageNode` and `imageTransformEnabled` computed values that require exactly one selected `SceneImageNode`.
2. Add `rotationPreview` and `rotationGesture` refs containing `elementId`, `startRotation`, `center`, `startPoint`, and `shiftKey`.
3. On rotate start, snapshot the selected image and initialize the preview with its current rotation.
4. On rotate/move, verify the gesture ID and selected ID are unchanged, call `rotationFromPointer`, and update only local preview.
5. On rotate end, recompute the exact final integer and emit `rotate-image`; clear local state.
6. On rotate cancel, scene/selection/zoom/scope change, or unmount, clear state without emitting.
7. Pass the preview/current image rotation and `showRotationHandle` to `SelectionOverlay`.

For resize events, convert the pointer into the unrotated local frame around the image center before applying `resizeBounds` or `resizeBoundsWithAspectRatio`. Pass `center: payload.altKey` and `centered: payload.altKey` into geometry/snapping. Use the same final calculation for preview and pointerup. Do not change the existing single/multi-selection event names or document-unit conversion.

- [ ] **Step 4: Rerun focused editor tests and verify GREEN**

Run the same command, then run all editor source tests:

```powershell
pnpm --filter @ppt4ai/editor test
```

Expected: new image gesture tests and all existing selection, group, table, text, canvas, and resize tests pass.

- [ ] **Step 5: Commit the editor checkpoint**

```powershell
git add packages/editor/src/PptEditor.vue packages/editor/src/index.ts packages/editor/src/PptEditor.test.ts
git commit -m "feat: connect image transform gestures"
```

## Task 7: Playground Commands, Toolbar Copy, And Host Wiring

**Files:**
- Modify: `packages/editor/src/PptEditor.vue`
- Modify: `packages/editor/src/locales/zh-CN.ts`
- Modify: `packages/editor/src/locales/en-US.ts`
- Modify: `apps/playground/src/asset-host.ts`
- Modify: `apps/playground/src/App.vue`
- Test: `apps/playground/src/asset-host.test.ts`
- Test: `apps/playground/src/App.test.ts`
- Test: `packages/editor/src/PptEditor.test.ts`

**Interfaces:**
- Consumes: editor `rotate-image` and `flip-image` payloads plus engine `setImageRotation` and `toggleImageFlip`.
- Produces:

```ts
rotateSelectedImage(elementId: string, rotation: number): PlaygroundAssetHostSnapshot
toggleSelectedImageFlip(elementId: string, axis: ImageFlipAxis): PlaygroundAssetHostSnapshot
```

- [ ] **Step 1: Write failing host and i18n tests**

Add host assertions that:

```ts
const inserted = host.insertAsset('asset_red')
const imageId = inserted.engineState.selection[0]!
const rotated = host.rotateSelectedImage(imageId, 5400000)
expect(rotated.engineState.document.elements[imageId]).toMatchObject({ transform: { rotation: 5400000 } })
expect(rotated.engineState.history.undoDepth).toBe(inserted.engineState.history.undoDepth + 1)

const flipped = host.toggleSelectedImageFlip(imageId, 'horizontal')
expect(flipped.engineState.document.elements[imageId]).toMatchObject({ transform: { rotation: 5400000, flipH: true } })
expect(flipped.status).toEqual({ kind: 'success', message: 'image-flipped' })
```

Add failures for a missing element, non-image element, and invalid angle; assert the document and history remain unchanged and status is `element-operation-failed`. Extend `PptEditor.test.ts` to assert four image transform buttons appear only for a single image, a shape selection has no transform buttons, and the buttons emit `rotate-image`/`flip-image` intents with stable `data-image-transform-button` values. Extend `App.test.ts` to mount the real editor, click the four transform buttons, and verify the host snapshot updates.

Assert both locales contain non-empty values for `toolbar.object.rotateLeft`, `toolbar.object.rotateRight`, `toolbar.object.flipHorizontal`, `toolbar.object.flipVertical`, `status.imageRotated`, and `status.imageFlipped`; no i18n missing-key warning may be emitted.

- [ ] **Step 2: Run focused host/UI tests and verify RED**

Run:

```powershell
pnpm --filter @ppt4ai/playground exec vitest run src/asset-host.test.ts src/App.test.ts
pnpm --filter @ppt4ai/editor exec vitest run src/PptEditor.test.ts -t "transform button"
```

Expected: FAIL because the host methods, event listeners, and locale keys do not exist.

- [ ] **Step 3: Implement host dispatch and localized controls**

Add four native buttons in the existing object toolbar with stable `data-image-transform-button` values: `rotate-left`, `rotate-right`, `flip-horizontal`, and `flip-vertical`. Render them only for a single image. Rotate buttons add/subtract `5400000` from the current absolute rotation and emit `rotate-image`; flip buttons emit `flip-image` with the corresponding axis. Use visible focus styles and no Element Plus controls.

Add the two methods to `PlaygroundAssetHost` and its returned object. Validate the ID exists and the element is an image before dispatch. Dispatch exactly one engine command inside `try/catch`; set `image-rotated` or `image-flipped` on success, and return `element-operation-failed` on command errors without changing selection or adding a second history entry.

Wire `@rotate-image` and `@flip-image` in `App.vue` to the host methods. Add the six locale keys with the exact success messages used by the tests. Keep all control labels and aria labels sourced from `t(...)`, and preserve existing group/ungroup behavior.

- [ ] **Step 4: Rerun focused host/UI tests and verify GREEN**

Run the same commands. Expected: host dispatch, status, locale, and real App wiring tests pass.

- [ ] **Step 5: Commit the Playground checkpoint**

```powershell
git add packages/editor/src/locales/zh-CN.ts packages/editor/src/locales/en-US.ts packages/editor/src/PptEditor.vue packages/editor/src/PptEditor.test.ts apps/playground/src/asset-host.ts apps/playground/src/asset-host.test.ts apps/playground/src/App.vue apps/playground/src/App.test.ts
git commit -m "feat: wire image transform controls"
```

## Task 8: Full Verification And Progress Record

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: completed image transform feature commits and their test results.
- Produces: a concise milestone entry and the next roadmap pointer without deleting deferred work.

- [ ] **Step 1: Run focused regression suites**

Run:

```powershell
pnpm --filter @ppt4ai/editor test
pnpm --filter @ppt4ai/engine test
pnpm --filter @ppt4ai/playground test
```

Expected: all three packages pass with no Vue or i18n warnings.

- [ ] **Step 2: Run repository validation**

Run:

```powershell
pnpm test
pnpm check:boundaries
pnpm typecheck
pnpm build
rg -n -i "element-plus" package.json pnpm-lock.yaml packages apps
git diff --check
```

Expected: full source tests, 12 package boundary checks, recursive typecheck, production build, and diff check pass; the Element Plus scan has no matches.

- [ ] **Step 3: Update the progress milestone**

Add a top-of-file entry recording image-only rotation/flip commands, rotation handle and 15-degree Shift snapping, Alt/Alt+Shift center resizing with centered guides, Playground wiring, atomic undo/redo, and the exact validation counts. Update `## 六、下次开工从这里继续` to the next independent roadmap item while retaining explicit deferrals for generic shape/text/table transforms, group rotation, source PPTX transform writeback, live content preview, and advanced crop editing.

- [ ] **Step 4: Recheck the documentation diff**

Run `git diff --check` and inspect that the new entry does not claim shape/text/table or group support. Confirm the worktree contains only the intended progress edit.

- [ ] **Step 5: Commit the progress checkpoint separately**

```powershell
git add -- 进度.md
git commit -m "docs: record image transform editing milestone"
```
