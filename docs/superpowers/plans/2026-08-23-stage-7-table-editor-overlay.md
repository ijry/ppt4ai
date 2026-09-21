# Table Editor Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable Vue 3 + UnoCSS table-cell selection overlay that maps rendered table cells to clone-safe source-cell selections without coupling the UI to `@ppt4ai/engine`.

**Architecture:** Keep table geometry and hit testing in a pure TypeScript module. It consumes `SceneTableNode.layout.cells` and the existing `layoutRectToScreen` transform, then returns screen-space source-cell rectangles and inclusive range previews. `TableEditorOverlay.vue` owns only transient pointer/focus state, renders one accessible hit surface per source cell, and emits `select`/`selectEnd` payloads for a host to translate into engine commands.

**Tech Stack:** Vue 3.5, TypeScript, Vitest, happy-dom, existing `@ppt4ai/render` scene graph types, existing `TextViewportTransform`/`layoutRectToScreen`, UnoCSS utilities.

## Global Constraints

- The editor UI uses only Vue 3 and existing UnoCSS conventions; do not add Element Plus or another component framework.
- `@ppt4ai/engine` remains headless and is not imported, mutated, or dispatched from the overlay.
- `SceneTableNode.layout.cells` is the only source of cell geometry; do not measure or infer cell dimensions from the DOM.
- Emitted selection coordinates are source-cell `{ row, column }` values and must remain JSON-safe and `structuredClone`-safe.
- A merged cell is represented by one source cell rectangle spanning its full `rowSpan`/`colSpan`; occupied coordinates never produce synthetic cells.
- Pointer dragging uses pointer capture on the overlay surface and does not install window-level listeners.
- The active outline uses `border-2 border-blue-500`; focused cells expose a visible `focus:ring-2 focus:ring-blue-500` indicator.
- Every production behavior is developed test-first: write a failing test, run it red, implement the minimum, run it green, then commit the task.

---

### Task 1: Table Interaction Geometry

**Files:**
- Create: `packages/editor/src/table-editor-overlay.ts`
- Test: `packages/editor/src/table-editor-overlay.test.ts`

**Interfaces:**
- Consumes: `SceneTableNode` from `@ppt4ai/render` and `TextViewportTransform`/`layoutRectToScreen` from `./text-editor-interaction`.
- Produces:

```ts
export interface TableCellPoint {
  row: number
  column: number
}

export interface TableCellSelection {
  anchor: TableCellPoint
  focus: TableCellPoint
}

export interface TableEditorCell {
  point: TableCellPoint
  rowSpan: number
  colSpan: number
  rect: { x: number; y: number; width: number; height: number }
}

export interface TableEditorOverlayModel {
  bounds: { x: number; y: number; width: number; height: number }
  cells: TableEditorCell[]
}

export function createTableEditorOverlay(
  table: SceneTableNode,
  transform: TextViewportTransform,
): TableEditorOverlayModel

export function tableCellAtPoint(
  model: TableEditorOverlayModel,
  point: { x: number; y: number },
): TableEditorCell | undefined

export function selectedTableCells(
  cells: TableEditorCell[],
  selection: TableCellSelection,
): TableEditorCell[]
```

- [ ] **Step 1: Write the failing geometry tests**

Add tests that construct a two-by-two `SceneTableNode` fixture with one merged source cell and assert the desired API. Cover: bounds/cell viewport mapping, preservation of one rectangle per source cell, merged rectangle span, hit testing anywhere inside the merged rectangle, inclusive forward and reverse selections, and de-duplication of selected source cells. Add a `structuredClone` assertion for a returned selection object.

```ts
it('maps table bounds and source cell rectangles through the viewport transform', () => {
  const model = createTableEditorOverlay(table, { originX: 10, originY: 20, scale: 2 })
  expect(model.bounds).toEqual({ x: 10, y: 20, width: 200, height: 160 })
  expect(model.cells[0]).toMatchObject({ point: { row: 0, column: 0 }, rect: { x: 10, y: 20, width: 100, height: 40 } })
})

it('returns the merged source cell for every occupied point', () => {
  const model = createTableEditorOverlay(table, { originX: 0, originY: 0, scale: 1 })
  expect(tableCellAtPoint(model, { x: 75, y: 25 })?.point).toEqual({ row: 0, column: 0 })
})

it('selects source cells whose occupied spans intersect an inclusive reverse range', () => {
  const model = createTableEditorOverlay(table, { originX: 0, originY: 0, scale: 1 })
  const selected = selectedTableCells(model.cells, {
    anchor: { row: 1, column: 1 },
    focus: { row: 0, column: 0 },
  })
  expect(selected.map((cell) => cell.point)).toEqual([{ row: 0, column: 0 }, { row: 1, column: 1 }])
})
```

- [ ] **Step 2: Run the geometry tests and verify the expected red failure**

Run: `pnpm exec vitest run packages/editor/src/table-editor-overlay.test.ts`

Expected: FAIL because `./table-editor-overlay` does not exist and the requested exports cannot be imported.

- [ ] **Step 3: Implement the pure geometry model**

Convert `table.bounds` and each `cell.bounds` with `layoutRectToScreen`, preserving source row/column and spans. Implement point-in-rectangle hit testing in source-cell order, using half-open right/bottom edges except for the outermost edge so adjacent cells do not overlap. Implement `selectedTableCells` by normalizing the minimum/maximum anchor and focus row/column, retaining cells whose occupied `[row, row + rowSpan - 1]` and `[column, column + colSpan - 1]` ranges intersect the inclusive selection, and returning each input source cell at most once. Validate finite positive table/cell geometry and finite non-negative integer coordinates/spans before returning a model.

- [ ] **Step 4: Run focused and package tests to verify green**

Run: `pnpm exec vitest run packages/editor/src/table-editor-overlay.test.ts` and `pnpm --filter @ppt4ai/editor typecheck`

Expected: all focused geometry tests pass and editor typecheck exits successfully.

- [ ] **Step 5: Commit the geometry slice**

```bash
git add packages/editor/src/table-editor-overlay.ts packages/editor/src/table-editor-overlay.test.ts
git commit -m "feat: add table editor interaction geometry"
```

### Task 2: Vue Table Editor Overlay

**Files:**
- Create: `packages/editor/src/TableEditorOverlay.vue`
- Test: `packages/editor/src/TableEditorOverlay.test.ts`

**Interfaces:**
- Consumes: `active: boolean`, `table: SceneTableNode`, and `transform: TextViewportTransform` props; geometry functions and `TableCellSelection` from `./table-editor-overlay`.
- Produces Vue events `select(selection: TableCellSelection)` and `selectEnd(selection: TableCellSelection)`.

- [ ] **Step 1: Write failing component tests**

Mount the component with Vue `createApp` and `h` in a `happy-dom` environment, matching the existing editor component tests. Assert inactive rendering has no grid or cell surfaces; active rendering has one `role="grid"`, one `data-table-border`, and one `data-table-cell` per source cell. Dispatch primary pointer events and assert a collapsed `select`, pointer capture, changed-focus `select` events only, exactly one `selectEnd`, and capture release. Assert secondary-button pointerdown does nothing. Assert clicking the merged area emits the source point. Assert Enter and Space on the roving focused cell emit collapsed `select` and `selectEnd`, and clone the emitted payload with `structuredClone`.

```ts
it('emits a collapsed source selection and ends exactly once on click', async () => {
  const events: TableCellSelection[] = []
  const ends: TableCellSelection[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(TableEditorOverlay, {
      active: true,
      table,
      transform: { originX: 0, originY: 0, scale: 1 },
      onSelect: (value: TableCellSelection) => events.push(value),
      onSelectEnd: (value: TableCellSelection) => ends.push(value),
    }),
  })
  app.mount(host)
  const grid = host.querySelector('[data-table-editor-overlay]') as HTMLElement
  grid.setPointerCapture = vi.fn()
  grid.releasePointerCapture = vi.fn()
  grid.dispatchEvent(pointer('pointerdown', 75, 75, 7))
  grid.dispatchEvent(pointer('pointerup', 75, 75, 7))
  expect(events).toEqual([{ anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } }])
  expect(ends).toHaveLength(1)
  expect(structuredClone(ends[0])).toEqual(ends[0])
})
```

- [ ] **Step 2: Run component tests and verify the expected red failure**

Run: `pnpm exec vitest run packages/editor/src/TableEditorOverlay.test.ts`

Expected: FAIL because `./TableEditorOverlay.vue` does not exist.

- [ ] **Step 3: Implement the minimal Vue overlay**

Use `<script setup lang="ts">` with the props and emits above. Build the model with `createTableEditorOverlay`. Render nothing while inactive; while active render an absolute `role="grid"` container with `data-table-editor-overlay`, `data-table-border`, and one absolutely positioned `role="gridcell"` surface per source cell. Assign `tabindex="0"` to the first source cell and `-1` to the rest, move the roving `0` value to the pointer/keyboard-activated source cell, preserve focus on pointer selection, and include an `aria-label` containing row, column, row span, and column span. Handle primary pointer events on the single grid container: on `pointerdown`, hit `clientX`/`clientY` against the model, prevent default, set anchor/focus, emit collapsed `select`, mark dragging, and call `event.currentTarget.setPointerCapture`. On captured `pointermove`, update focus and emit `select` only when it changes. On `pointerup` or `pointercancel`, emit one `selectEnd`, release capture when held, and clear drag state. Handle Enter/Space on the focused source cell by emitting collapsed `select` and `selectEnd`. Render `selectedTableCells` with translucent blue background and inset border, and use `focus:ring-2 focus:ring-blue-500` on surfaces.

- [ ] **Step 4: Run component and package tests to verify green**

Run: `pnpm exec vitest run packages/editor/src/TableEditorOverlay.test.ts packages/editor/src/table-editor-overlay.test.ts`, `pnpm --filter @ppt4ai/editor typecheck`, and `pnpm --filter @ppt4ai/editor build`

Expected: all overlay tests pass, Vue/TypeScript checks pass, and the editor package builds.

- [ ] **Step 5: Commit the Vue component slice**

```bash
git add packages/editor/src/TableEditorOverlay.vue packages/editor/src/TableEditorOverlay.test.ts
git commit -m "feat: add table editor overlay"
```

### Task 3: Public Export and Progress Record

**Files:**
- Modify: `packages/editor/src/index.ts`
- Modify: `进度.md`

**Interfaces:**
- Consumes: `TableEditorOverlay.vue`, `table-editor-overlay.ts`, `TableCellPoint`, `TableCellSelection`, `TableEditorCell`, and `TableEditorOverlayModel` from Tasks 1 and 2.
- Produces public editor exports for the component and all clone-safe geometry types/functions.

- [ ] **Step 1: Write the failing export test**

Add a small package-level assertion to `packages/editor/src/table-editor-overlay.test.ts` that imports the public names from `./index` and verifies the geometry function is the same callable export and the component export is defined.

```ts
it('exports the table overlay through the editor entry point', async () => {
  const entry = await import('./index')
  expect(entry.TableEditorOverlay).toBeDefined()
  expect(entry.createTableEditorOverlay).toBe(createTableEditorOverlay)
})
```

- [ ] **Step 2: Run the export test and verify the expected red failure**

Run: `pnpm exec vitest run packages/editor/src/table-editor-overlay.test.ts -t "exports the table overlay"`

Expected: FAIL because the editor entry point does not yet export `TableEditorOverlay` or the table geometry functions.

- [ ] **Step 3: Add exports and record the completed slice**

Append the following exports to `packages/editor/src/index.ts`:

```ts
export { default as TableEditorOverlay } from './TableEditorOverlay.vue'
export {
  createTableEditorOverlay,
  selectedTableCells,
  tableCellAtPoint,
} from './table-editor-overlay'
export type {
  TableCellPoint,
  TableCellSelection,
  TableEditorCell,
  TableEditorOverlayModel,
} from './table-editor-overlay'
```

Update the Stage 7 checklist in `进度.md` to mark the UnoCSS table editor UI complete and explicitly leave engine wiring, fill/border toolbar, row/column operations, merge/split, table text editing, complete theme/style inheritance, and PPTX table export pending.

- [ ] **Step 4: Run full validation**

Run: `pnpm exec vitest run packages/editor/src/table-editor-overlay.test.ts packages/editor/src/TableEditorOverlay.test.ts`, `pnpm --filter @ppt4ai/editor typecheck`, `pnpm --filter @ppt4ai/editor build`, `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.

Expected: focused tests, all package checks, all workspace tests, typechecks, builds, and whitespace validation pass.

- [ ] **Step 5: Commit the export and progress slice**

```bash
git add packages/editor/src/index.ts 进度.md packages/editor/src/table-editor-overlay.test.ts
git commit -m "docs: record table editor overlay slice"
```

## Self-Review Checklist

- Spec coverage: geometry mapping, merged-cell source hit testing, inclusive/reverse selection, pointer capture, active/inactive rendering, keyboard activation, focus visibility, UnoCSS-only styling, clone-safe events, and explicit non-goals each map to Tasks 1-3.
- Placeholder scan: no implementation placeholder or vague implementation step appears in this plan.
- Type consistency: `TableCellSelection` and `TableEditorOverlayModel` are defined in Task 1 and consumed unchanged by Tasks 2-3; public export names match the implementation names.
- Repository hygiene: no Element Plus dependency, DOM/browser code in headless packages, or direct engine import is introduced.
