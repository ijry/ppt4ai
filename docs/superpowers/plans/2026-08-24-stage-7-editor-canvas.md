# Stage 7 Editor Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing SceneGraph and node painters to a real single-slide Canvas in the editor, with high-DPI rendering, topmost-node click selection, and the existing selection border/handles.

**Architecture:** A pure `createSlideCanvasRenderer` coordinates shape, text, table, and image painting on one Canvas using one EMU-to-CSS mapping. `SlideCanvas.vue` owns the DOM Canvas, cancellation, and pointer-to-page conversion; `PptEditor.vue` remains a controlled Vue shell and emits selection intent without importing engine APIs. Playground derives a SceneGraph from its current engine document and applies selection commands in the host.

**Tech Stack:** TypeScript, Vue 3, Vitest, happy-dom, UnoCSS, existing `@ppt4ai/model`, `@ppt4ai/render`, `@ppt4ai/engine`, and editor painters.

## Global Constraints

- Keep runtime UI dependencies limited to Vue, Vue-I18n, and UnoCSS; do not add Element Plus or another component framework.
- Keep model, render, and engine headless; only editor and Playground may reference DOM, Canvas, or Vue.
- Preserve `scene.nodes` order for painting and check nodes in reverse order for hit testing.
- Keep Canvas coordinates in EMU until the final CSS mapping; use `devicePixelRatio` only for backing pixels.
- Keep image bytes behind `AssetAdapter`; do not copy adapter bytes into SceneGraph or engine state.
- Keep all emitted render results and issues JSON/`structuredClone` safe.
- Do not implement move, resize, text editing, table editing, group recursion, chart painting, or multi-page navigation in this plan.
- Commit each independently verified task separately.

---

### Task 1: Add the unified slide canvas renderer

**Files:**
- Create: `packages/editor/src/slide-canvas-renderer.ts`
- Create: `packages/editor/src/slide-canvas-renderer.test.ts`
- Modify: `packages/editor/src/image-canvas-renderer.ts`
- Modify: `packages/editor/src/image-canvas-renderer.test.ts`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- Consumes: `SceneGraph`, `AssetAdapter`, `CanvasRenderingContext2D`, existing `paintShapeNode`, `paintTextNode`, `paintTableNode`, and image decode/paint helpers.
- Produces:

```ts
export interface SlideCanvasViewport {
  zoom?: number
  devicePixelRatio?: number
  signal?: AbortSignal
}

export interface SlideCanvasRenderIssue {
  nodeId: string
  kind: SceneNode['kind']
  code: 'draw-failed' | 'missing-asset' | 'decode-failed'
  message: string
}

export interface SlideCanvasRenderResult {
  drawnNodeIds: string[]
  skippedNodeIds: string[]
  issues: SlideCanvasRenderIssue[]
  cssWidth: number
  cssHeight: number
}

export interface SlideCanvasRenderer {
  render(scene: SceneGraph, context: CanvasRenderingContext2D, viewport?: SlideCanvasViewport): Promise<SlideCanvasRenderResult>
  clearCache(): void
  dispose(): void
}

export function createSlideCanvasRenderer(options: {
  adapter: AssetAdapter
  decoder?: ImageDecoder
}): SlideCanvasRenderer
```

- [ ] **Step 1: Write the failing renderer tests**

Build a recording 2D context and minimal SceneGraph fixtures. Assert that a shape, text, table, and image produce events in original node order, the Canvas receives page CSS/backing dimensions and one page transform, an invalid middle node yields `draw-failed` while later nodes still draw, and image adapter requests are made only for image nodes. Assert `structuredClone(result)` succeeds.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run packages/editor/src/slide-canvas-renderer.test.ts`

Expected: FAIL because `slide-canvas-renderer.ts` and its exported factory do not exist.

- [ ] **Step 3: Extract reusable image node loading/painting**

Refactor only the internal image cache path in `image-canvas-renderer.ts` so the new coordinator can load one `SceneImageNode` and call `paintImageNode` without resetting Canvas dimensions or clearing the page. Keep `createImageCanvasRenderer` behavior and public result unchanged; add a focused regression test proving its existing standalone render still sets dimensions and draws correctly.

- [ ] **Step 4: Implement the minimal unified render loop**

Set `cssWidth = scene.page.w / (914400 / 96) * zoom`, `cssHeight` similarly, set backing dimensions to rounded CSS dimensions times DPR, clear once, and set transform to `DPR * 96 / 914400 * zoom`. For each node call the matching painter with `{ scale: 96 / 914400 * zoom, offsetX: 0, offsetY: 0 }`; use the shared image path for image nodes. Catch each node independently, map image failures to the existing image codes, and stop only when the supplied signal is aborted.

- [ ] **Step 5: Run focused renderer verification**

Run:

```powershell
pnpm exec vitest run packages/editor/src/slide-canvas-renderer.test.ts packages/editor/src/image-canvas-renderer.test.ts
pnpm --filter @ppt4ai/editor typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the renderer**

```powershell
git add packages/editor/src/slide-canvas-renderer.ts packages/editor/src/slide-canvas-renderer.test.ts packages/editor/src/image-canvas-renderer.ts packages/editor/src/image-canvas-renderer.test.ts packages/editor/src/index.ts
git commit -m "feat: render scene graph on editor canvas"
```

### Task 2: Add the Vue Canvas host and hit testing

**Files:**
- Create: `packages/editor/src/slide-canvas.ts`
- Create: `packages/editor/src/slide-canvas.test.ts`
- Create: `packages/editor/src/SlideCanvas.vue`
- Create: `packages/editor/src/SlideCanvas.test.ts`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- Consumes: `SceneGraph`, `AssetAdapter`, `createSlideCanvasRenderer`, and the DOM Canvas event/rect APIs.
- Produces:

```ts
export interface SlideCanvasPoint {
  x: number
  y: number
}

export function pagePointFromClientPoint(
  event: { clientX: number; clientY: number },
  rect: { left: number; top: number },
  zoom: number,
): SlideCanvasPoint

export function hitTestScene(scene: SceneGraph, point: SlideCanvasPoint): string | undefined
```

`SlideCanvas.vue` accepts `scene`, `adapter`, optional `decoder`, `zoom`, and `devicePixelRatio`; emits `render(result)` and `select(elementId: string | undefined)`.

- [ ] **Step 1: Write failing hit-test and host tests**

Assert client coordinates account for the Canvas rect and zoom, overlapping nodes select the last node in SceneGraph order, boundary points count as hits, and blank points return `undefined`. Mount `SlideCanvas` with a fake renderer/Canvas, assert high-DPI rendering is triggered, old renders are aborted when `scene` changes, click emits the expected ID, and unmount aborts without emitting a late result.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run packages/editor/src/slide-canvas.test.ts packages/editor/src/SlideCanvas.test.ts`

Expected: FAIL because the hit-test helpers and component do not exist.

- [ ] **Step 3: Implement pure coordinate and hit-test helpers**

Convert `(clientX - rect.left) / (zoom * 96 / 914400)` and the matching Y expression into EMU. Iterate `scene.nodes` from the final node toward the first and return the first bounds rectangle containing the point; return `undefined` for no hit.

- [ ] **Step 4: Implement the Canvas host lifecycle**

Create a renderer for the current adapter/decoder, abort the previous controller before every draw, wait until the Canvas is mounted, call `render`, and emit only when the request is still current. On pointer click, call `hitTestScene` using `getBoundingClientRect()` and emit `select`. Abort and dispose in `onBeforeUnmount`; render failures become a structured `render` result rather than an unhandled Vue error.

- [ ] **Step 5: Run focused host verification**

Run:

```powershell
pnpm exec vitest run packages/editor/src/slide-canvas.test.ts packages/editor/src/SlideCanvas.test.ts
pnpm --filter @ppt4ai/editor typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the Canvas host**

```powershell
git add packages/editor/src/slide-canvas.ts packages/editor/src/slide-canvas.test.ts packages/editor/src/SlideCanvas.vue packages/editor/src/SlideCanvas.test.ts packages/editor/src/index.ts
git commit -m "feat: add slide canvas host"
```

### Task 3: Make `PptEditor` controlled and render selection overlay

**Files:**
- Modify: `packages/editor/src/PptEditor.vue`
- Create: `packages/editor/src/PptEditor.test.ts`
- Modify: `packages/editor/src/locales/zh-CN.ts`
- Modify: `packages/editor/src/locales/en-US.ts`

**Interfaces:**
- Consumes: `scene`, `adapter`, `selection`, `zoom`, optional `devicePixelRatio`, `SlideCanvas`, and `SelectionOverlay`.
- Produces `PptEditor` props:

```ts
scene: SceneGraph
adapter: AssetAdapter
selection?: string[]
zoom?: number
devicePixelRatio?: number
```

and `select: [elementId: string | undefined]`, `render: [result: SlideCanvasRenderResult]` emits.

- [ ] **Step 1: Write failing component tests**

Mount `PptEditor` with a real minimal SceneGraph and fake adapter. Assert the Canvas is present, its `select` event is forwarded, a selected node renders `data-selection-overlay`, `data-selection-border`, and exactly eight handles positioned in CSS page coordinates, and an empty selection renders none. Assert locale keys remain exactly symmetric.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run packages/editor/src/PptEditor.test.ts`

Expected: FAIL because `PptEditor` does not accept scene/selection props or render a Canvas/overlay.

- [ ] **Step 3: Implement controlled PptEditor composition**

Resolve only the first selected ID that exists in `scene.nodes`, map its EMU bounds to CSS using `zoom * 96 / 914400`, and place `SelectionOverlay` in a relative page wrapper over `SlideCanvas`. Keep the existing toolbar and slot for compatibility, add an accessible canvas label, and forward `select` and `render` events.

- [ ] **Step 4: Add localized canvas labels**

Add the page canvas label and any selection status label to both locale files with identical key structure; do not add visible instructional text.

- [ ] **Step 5: Run focused editor verification**

Run:

```powershell
pnpm exec vitest run packages/editor/src/PptEditor.test.ts apps/playground/src/editor-shell.test.ts
pnpm --filter @ppt4ai/editor typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the controlled editor shell**

```powershell
git add packages/editor/src/PptEditor.vue packages/editor/src/PptEditor.test.ts packages/editor/src/locales/zh-CN.ts packages/editor/src/locales/en-US.ts
git commit -m "feat: connect editor selection canvas"
```

### Task 4: Connect the Playground to a real demo SceneGraph

**Files:**
- Modify: `apps/playground/src/App.vue`
- Modify: `apps/playground/src/App.test.ts`
- Modify: `apps/playground/src/asset-host.ts`
- Modify: `apps/playground/src/asset-host.test.ts`

**Interfaces:**
- Consumes: `documentToSceneGraph`, `PptEditor` controlled props/events, and the existing `PlaygroundAssetHost` engine snapshot.
- Produces: a computed `SceneGraph` from the current host document, click-to-select wiring, and a visible first slide in the existing Playground layout.

- [ ] **Step 1: Write failing Playground integration tests**

Assert the Playground passes a non-empty SceneGraph into `PptEditor`, the page Canvas is present, clicking a known node emits selection and updates `selected-element`, selection does not add an undo entry, and existing upload/asset-library assertions still pass.

- [ ] **Step 2: Run focused integration tests and verify RED**

Run: `pnpm exec vitest run apps/playground/src/App.test.ts`

Expected: FAIL because Playground still renders a `Slide 1` slot placeholder and has no scene-to-engine selection wiring.

- [ ] **Step 3: Extend the Playground host with a demo document**

Keep the current asset upload APIs unchanged. Ensure the host snapshot exposes a clone-safe document suitable for `documentToSceneGraph`, and add a deterministic demo shape/text/table fixture without mutating adapter bytes during selection.

- [ ] **Step 4: Replace the placeholder slot with controlled PptEditor**

Compute the scene from the current snapshot document, pass `assetHost.adapter`, pass the one selected element ID, and on `select` dispatch the engine selection command through the host then refresh `assetSnapshot`. Preserve the thumbnail smoke and asset panel.

- [ ] **Step 5: Run focused Playground verification**

Run:

```powershell
pnpm exec vitest run apps/playground/src/App.test.ts apps/playground/src/asset-host.test.ts
pnpm --filter @ppt4ai/playground typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the Playground integration**

```powershell
git add apps/playground/src/App.vue apps/playground/src/App.test.ts apps/playground/src/asset-host.ts apps/playground/src/asset-host.test.ts
git commit -m "feat: show editable slide in playground"
```

### Task 5: Record and verify the canvas milestone

**Files:**
- Modify: `进度.md`

- [ ] **Step 1: Update the handoff record**

Record the single-slide Canvas, high-DPI mapping, node-order painting, reverse-order bounds hit testing, selection overlay, and explicit deferrals for move/resize, text/table editing, groups/charts, and multi-page navigation. Set the next slice to pointer capture plus engine move/resize.

- [ ] **Step 2: Run repository gates**

Run:

```powershell
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
rg -n "element-plus|ElementPlus|@element-plus" package.json pnpm-lock.yaml packages apps
```

Expected: all checks pass, the Element Plus scan returns no matches, and the Playground dev server remains HTTP 200 on its existing port.

- [ ] **Step 3: Commit the milestone**

```powershell
git add 进度.md
git commit -m "docs: record editor canvas milestone"
```
