# Stage 7 Table Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render resolved table cell fills, borders, and precomputed text in the existing Worker/OffscreenCanvas thumbnail pipeline without changing the scene contract, thumbnail protocol, or runtime dependencies.

**Architecture:** Add a focused `table-painting.ts` Canvas painter that consumes `SceneTableNode.layout` and the existing page mapping. Extract a layout-level text painter from `text-painting.ts`, then dispatch tables through the worker's existing ordered per-node boundary so table failures remain isolated and later nodes continue.

**Tech Stack:** TypeScript 6, Canvas 2D/OffscreenCanvas, Vitest 4, pnpm workspace, `@ppt4ai/model`, `@ppt4ai/render`, `@ppt4ai/text`, Vue 3, Vue-I18n, and UnoCSS.

## Global Constraints

- Consume resolved cell data already present in `SceneTableLayoutCell`; do not resolve styles or theme colors in the editor painter.
- Consume each cell's absolute, precomputed `textLayout`; do not measure, shape, wrap, or reflow text in the worker.
- Paint fills first, then borders, then text, with cells and border sides processed in deterministic source order.
- Missing fill or border colors are omissions; missing border style means `solid`; `none` skips drawing; missing width defaults to `12700` EMU.
- Map border width as `Math.max(1, width * pageScale)` and use dash arrays `[]`, `[4w, 3w]`, and `[w, 2w]` for solid, dash, and dot.
- Use `lineCap = 'butt'`, paint shared duplicate edges in traversal order, and do not add a border-conflict resolver.
- A valid empty table or empty cell text counts as drawn and requests no resources.
- A table draw exception reports `draw-failed`, restores Canvas state, and does not prevent later scene nodes from rendering.
- Preserve `SceneGraph.nodes` order, cancellation, image resource handling, diagnostics, and the unchanged thumbnail protocol.
- Add no runtime dependency; the editor UI remains Vue, Vue-I18n, and UnoCSS only, with no Element Plus.
- Commit every completed task/stage separately.

## File Structure

- Create `packages/editor/src/table-painting.ts`: validate table mapping, cell geometry, resolved colors, border styles, and widths; paint fills, borders, and cell text.
- Create `packages/editor/src/table-painting.test.ts`: record Canvas operations and cover paint order, mapped geometry, border semantics, validation, empty tables, text reuse, and state restoration.
- Modify `packages/editor/src/text-painting.ts`: export a layout-level helper and make `paintTextNode` delegate to it without changing existing behavior.
- Modify `packages/editor/src/text-painting.test.ts`: verify the extracted layout entry point retains node-level behavior and context restoration.
- Modify `packages/editor/src/thumbnail-worker.ts`: include `table` in the node gate and dispatch it through `paintTableNode` in the existing ordered failure boundary.
- Modify `packages/editor/src/thumbnail-worker.test.ts`: add table nodes to order, isolation, empty-table, and zero-resource coverage.
- Modify `进度.md`: record the completed table thumbnail slice and retain deferred chart/group work.

---

### Task 1: Extract Layout-Level Text Painting

**Files:**
- Modify: `packages/editor/src/text-painting.ts:144`
- Modify: `packages/editor/src/text-painting.test.ts`

**Interfaces:**
- Consumes: `SceneTextLayout`, `TextPageMapping`, and the existing Canvas context union.
- Produces: `paintTextLayout(context, layout, mapping): void` for `table-painting.ts`; `paintTextNode` remains the existing public editor-internal entry point.

- [ ] **Step 1: Write the failing extraction test**

Import `paintTextLayout` and call it with `node().layout` from the existing text fixture. Assert that it emits the same `fillText` event and ends with `restore`. Keep the existing `paintTextNode` assertions unchanged so the test proves both entry points are supported.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm exec vitest run packages/editor/src/text-painting.test.ts
```

Expected: FAIL because `paintTextLayout` is not exported yet.

- [ ] **Step 3: Implement the minimal shared helper**

Move the current `fontScale` validation and line/marker/run traversal from `paintTextNode` into:

```ts
export function paintTextLayout(
  context: TextContext,
  layout: SceneTextLayout,
  mapping: TextPageMapping,
): void
```

The helper must own one `save()`/`finally { restore() }` guard, validate `layout.fontScale`, and preserve the current horizontal, vertical, marker, underline, color, alpha, and nested rotation behavior. Reduce `paintTextNode` to `paintTextLayout(context, node.layout, mapping)` so node calls retain exactly one state guard. Export only the helper and existing `paintTextNode`; keep context and internal style types private.

- [ ] **Step 4: Run text tests and typecheck**

Run:

```powershell
pnpm exec vitest run packages/editor/src/text-painting.test.ts
pnpm --filter @ppt4ai/editor typecheck
```

Expected: PASS with all existing text behavior and the new layout-level test passing.

- [ ] **Step 5: Commit the shared helper**

```powershell
git add -- packages/editor/src/text-painting.ts packages/editor/src/text-painting.test.ts
git commit -m "refactor: expose layout text painter"
```

### Task 2: Implement the Table Canvas Painter

**Files:**
- Create: `packages/editor/src/table-painting.ts`
- Create: `packages/editor/src/table-painting.test.ts`

**Interfaces:**
- Consumes: `SceneTableNode` from `@ppt4ai/render`, `TableCellBorders` and `ResolvedColor` from `@ppt4ai/model`, and `paintTextLayout` / `TextPageMapping` from `text-painting.ts`.
- Produces:

```ts
export interface TablePageMapping {
  scale: number
  offsetX: number
  offsetY: number
}

export function paintTableNode(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  node: SceneTableNode,
  mapping: TablePageMapping,
): void
```

- [ ] **Step 1: Add recording-context fixtures and a valid table factory**

Create a test-local context implementing `save`, `restore`, `beginPath`, `rect`, `fill`, `moveTo`, `lineTo`, `stroke`, `setLineDash`, and `fillText`, recording property values at paint time. Build a `SceneTableNode` with two cells, one resolved fill, four resolved border colors/styles, and minimal valid `textLayout` runs. Set the mapping to `{ scale: 2, offsetX: 5, offsetY: 7 }` so coordinate conversion is observable.

- [ ] **Step 2: Write failing paint-order and geometry tests**

Assert the event sequence has all cell `rect`/`fill` operations before any border path/stroke, and all border operations before `fillText`. Assert the first cell maps `bounds: { x: 10, y: 20, w: 30, h: 40 }` to `rect(25, 47, 60, 80)`. Assert text events use the supplied absolute layout coordinates and are not translated by the table or cell bounds.

- [ ] **Step 3: Run the painter tests and verify RED**

Run:

```powershell
pnpm exec vitest run packages/editor/src/table-painting.test.ts
```

Expected: FAIL because the table painter does not exist.

- [ ] **Step 4: Implement fill painting and validation**

In `table-painting.ts`, define private helpers for finite numbers, non-negative dimensions, mapping validation, RGB/alpha validation, and mapped rectangles. Wrap the whole operation in `save()` and `finally { restore() }`. For each `layout.cells` entry, validate `bounds`, then if `resolvedFillColor` exists set `fillStyle` to `#${rgb.toUpperCase()}`, `globalAlpha` to `alpha / 100000`, call `beginPath`, `rect(mappedX, mappedY, mappedW, mappedH)`, and `fill`. Missing fill colors perform no Canvas paint.

- [ ] **Step 5: Implement border painting with explicit side semantics**

Traverse cells in array order and sides using:

```ts
const sides = ['left', 'right', 'top', 'bottom'] as const
```

For each present border, validate its style and explicit width before deciding whether it is drawable. Treat an absent style as `solid`, default width to `12700`, reject non-finite or negative explicit widths, and reject unsupported styles rather than silently guessing. Then skip if the valid style is `none` or the matching `resolvedBorderColors[side]` is absent. For drawable borders, calculate `lineWidth = Math.max(1, width * mapping.scale)`. Set `strokeStyle`, `globalAlpha`, `lineWidth`, `lineCap = 'butt'`, and `setLineDash` to `[]`, `[4 * lineWidth, 3 * lineWidth]`, or `[lineWidth, 2 * lineWidth]`. Draw exact mapped cell edges with one `beginPath`, `moveTo`, `lineTo`, and `stroke` per side. Reset the dash pattern for each side.

- [ ] **Step 6: Delegate each cell's precomputed text layout**

After all fills and all borders, call:

```ts
paintTextLayout(context, cell.textLayout, mapping)
```

for every cell in source order. Do not add a translation, clipping region, measurement call, or style resolution. Empty tables and cells with empty text still complete successfully.

- [ ] **Step 7: Add edge-case and restoration tests**

Cover all of the following with focused tests:

- missing fill or border colors emit no corresponding paint;
- default solid style and `12700` width;
- solid, dash, dot, and none styles;
- one-pixel minimum for an explicit zero width and for a positive width that maps below one pixel;
- duplicate shared edges are emitted in cell/side traversal order;
- merged-cell bounds are used exactly as supplied;
- empty table and empty cell text are successful;
- invalid mapping, geometry, RGB, alpha, style, or width throws and the final event is `restore`;
- a Canvas `fill`, `stroke`, or text failure still restores the outer context.

- [ ] **Step 8: Run focused painter and editor checks**

Run:

```powershell
pnpm exec vitest run packages/editor/src/table-painting.test.ts packages/editor/src/text-painting.test.ts
pnpm --filter @ppt4ai/editor typecheck
```

Expected: PASS for table semantics, existing text behavior, and package typing.

- [ ] **Step 9: Commit the table painter**

```powershell
git add -- packages/editor/src/table-painting.ts packages/editor/src/table-painting.test.ts
git commit -m "feat: paint tables on thumbnail canvas"
```

### Task 3: Integrate Tables Into the Thumbnail Worker

**Files:**
- Modify: `packages/editor/src/thumbnail-worker.ts:2`
- Modify: `packages/editor/src/thumbnail-worker.ts:45`
- Modify: `packages/editor/src/thumbnail-worker.ts:156`
- Modify: `packages/editor/src/thumbnail-worker.test.ts`

**Interfaces:**
- Consumes: `paintTableNode(context, node, mapping)` and the existing `SceneGraph` union.
- Produces: ordered Worker table rendering with existing `drawnNodeIds`, `skippedNodeIds`, `draw-failed`, cancellation, and resource behavior.

- [ ] **Step 1: Add table fixtures and failing Worker order test**

Import `SceneTableNode` as a type in the test and create a minimal table with one cell, resolved fill, a resolved solid border, and a precomputed text run. Insert it between a shape and a text node. Assert paint events identify `fill`, `stroke`, and the cell text in the table's position, and assert `drawnNodeIds` preserves scene order. Assert no `resource-request` is emitted for the table.

- [ ] **Step 2: Add failing Worker isolation test**

Create a scene with an invalid table cell color followed by a valid shape and valid empty table. Assert the invalid table is skipped with `{ code: 'draw-failed' }`, the later nodes are drawn, and no table resource request exists.

- [ ] **Step 3: Run Worker tests and verify RED**

Run:

```powershell
pnpm exec vitest run packages/editor/src/thumbnail-worker.test.ts
```

Expected: FAIL because the Worker currently skips `table` nodes.

- [ ] **Step 4: Dispatch tables through the existing node loop**

In `thumbnail-worker.ts`, import `SceneTableNode` and `paintTableNode`. Extend `issue()`'s node union to include tables; continue adding `assetId` only for images. Change the gate to allow `table`. Dispatch table before the image fallback:

```ts
if (node.kind === 'shape') {
  paintShapeNode(context, node, mapping)
} else if (node.kind === 'text') {
  paintTextNode(context, node, mapping)
} else if (node.kind === 'table') {
  paintTableNode(context, node, mapping)
} else {
  const image = await loadAsset(request, node)
  if (isCancelled(request.requestId)) return
  paintImageNode(context, node, image, mapBounds(node.bounds, mapping))
}
```

Keep the success push after dispatch and preserve the existing image-only resource/decode issue classification. Do not alter protocol types or resource cache code.

- [ ] **Step 5: Run focused Worker and painter tests**

Run:

```powershell
pnpm exec vitest run packages/editor/src/thumbnail-worker.test.ts packages/editor/src/table-painting.test.ts packages/editor/src/text-painting.test.ts
```

Expected: PASS for table order, table failure isolation, empty tables, zero resource requests, text rendering, and existing image behavior.

- [ ] **Step 6: Run editor package build**

Run:

```powershell
pnpm --filter @ppt4ai/editor build
```

Expected: PASS with the worker and new painter included in the editor build.

- [ ] **Step 7: Commit Worker integration**

```powershell
git add -- packages/editor/src/thumbnail-worker.ts packages/editor/src/thumbnail-worker.test.ts
git commit -m "feat: render tables in thumbnail worker"
```

### Task 4: Record the Slice and Run Repository Gates

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: completed table painter, shared layout text helper, and Worker table dispatch.
- Produces: an accurate progress record and verified committed stage.

- [ ] **Step 1: Run focused tests and package boundary checks**

Run:

```powershell
pnpm exec vitest run packages/editor/src/table-painting.test.ts packages/editor/src/text-painting.test.ts packages/editor/src/thumbnail-worker.test.ts
pnpm check:boundaries
```

Expected: all focused tests pass and all package boundary checks pass.

- [ ] **Step 2: Run recursive typecheck and build**

Run:

```powershell
pnpm typecheck
pnpm build
```

Expected: every workspace package typechecks and builds successfully.

- [ ] **Step 3: Run the full test suite**

Run:

```powershell
pnpm test
```

Expected: every Vitest file and test passes. Record the reported totals for the progress update.

- [ ] **Step 4: Update the progress record**

Change the Stage 7 current-status paragraph in `进度.md` from text-only thumbnail completion to table thumbnail completion. State that the Worker paints resolved cell fills, four-side borders, and precomputed cell text; preserves node order and per-node failure isolation; requests no table resources; and leaves the thumbnail protocol unchanged. Keep chart/group thumbnails, advanced border effects, and other non-goals explicitly deferred. Update the checklist and the reported test total only with numbers from the preceding full test command.

- [ ] **Step 5: Run final hygiene and dependency scans**

Run:

```powershell
git diff --check
rg -n "element-plus|ElementPlus|@element-plus" package.json pnpm-lock.yaml packages apps
git status --short
```

Expected: `git diff --check` exits 0, the Element Plus scan returns no matches, and only `进度.md` remains modified before its commit.

- [ ] **Step 6: Commit the progress record**

```powershell
git add -- 进度.md
git commit -m "docs: record table thumbnail support"
```

- [ ] **Step 7: Confirm final history and cleanliness**

Run:

```powershell
git status --short
git log -6 --oneline
```

Expected: the worktree is clean and history contains separate commits for the design, implementation plan, text helper, table painter, Worker integration, and progress record.
