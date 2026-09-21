# Stage 7 Table Merge and Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add atomic headless engine commands for merging the current table-cell selection and splitting the focused merged cell without losing non-empty text.

**Architecture:** Extend the existing `EditorEngine` command union and reuse its source-cell rectangle, occupancy reconstruction, validation, patch, and selection helpers. Merge replaces fully contained source rectangles with one top-left rectangle; split replaces one merged rectangle with individual source rectangles. Both validate a complete candidate table before committing one replacement patch.

**Tech Stack:** TypeScript 6, Vitest, `@ppt4ai/model`, `@ppt4ai/engine`, pnpm workspace.

## Global Constraints

- `@ppt4ai/engine` remains headless and must not import Vue or use DOM, Canvas, or browser globals.
- UI remains Vue 3 plus UnoCSS only; do not add Element Plus or another component framework.
- Both commands consume current `tableCellSelection`; do not duplicate element IDs or coordinates in payloads.
- Merge preserves all non-empty text in deterministic row-major source order and uses top-left cell-level style.
- Split preserves content and explicit style only on the restored top-left cell.
- No-op and rejected commands must leave the document, selection, undo stack, and redo stack unchanged.
- Each successful command must create exactly one history entry.

---

## File map

- `packages/engine/src/engine.test.ts`: public behavior contract for merge, split, content/style preservation, selection, validation, and history.
- `packages/engine/src/index.ts`: command variants, rectangle/content helpers, merge/split transformations, validation, dispatch, and selection normalization.
- `进度.md`: completed slice, verification result, and remaining Stage 7 work.

No new package or production file is required. The feature shares the existing private `TableSourceRect`, `tableSourceRects`, `rebuildTableRows`, `sourceCellAt`, `validTableCellSelection`, `clone`, `validateDocument`, and `commit` boundaries.

### Task 1: Define merge and split behavior

**Files:**
- Test: `packages/engine/src/engine.test.ts`

**Interfaces:**
- Consumes: `EditorEngine.dispatch(command)` and existing `selectTableCell` source normalization.
- Produces: executable behavior contract for `{ type: 'mergeTableCells' }` and `{ type: 'splitTableCell' }`.

- [ ] **Step 1: Add a focused merge/split document fixture**

Add `makeMergeSplitDocument()` beside the existing table fixtures. Use a 3-by-3 table with fixed dimensions and source cells that allow tests to assign bodies and spans directly:

```ts
function makeMergeSplitDocument(): Ppt4aiDocument {
  const document = makeDocument()
  document.slides.sld_1!.elementIds.push('el_table')
  document.elements.el_table = {
    id: 'el_table',
    kind: 'table',
    bounds: { x: 1000, y: 2000, w: 600, h: 300 },
    columns: [100, 200, 300],
    rows: [
      { height: 50, cells: [0, 1, 2].map((column) => ({ column, body: { paragraphs: [{ runs: [{ text: `R0C${column}` }] }] } })) },
      { height: 100, cells: [0, 1, 2].map((column) => ({ column, body: { paragraphs: [{ runs: [{ text: `R1C${column}` }] }] } })) },
      { height: 150, cells: [0, 1, 2].map((column) => ({ column, body: { paragraphs: [{ runs: [{ text: `R2C${column}` }] }] } })) },
    ],
  }
  return document
}
```

- [ ] **Step 2: Test deterministic merge content and style**

Customize the four cells in rows 0-1 and columns 0-1 so the top-left cell has `bodyPr`, an empty paragraph, a marked paragraph, fill, and borders. Give the other sources a mix of empty and non-empty paragraphs with attributes. Select from bottom-right to top-left and dispatch merge.

Assert the resulting source has `rowSpan: 2`, `colSpan: 2`, keeps the top-left `bodyPr`, fill, and borders, retains all top-left paragraphs, appends only other non-empty paragraphs in `R0C1`, `R1C0`, `R1C1` order, and keeps copied paragraph attributes/run marks. Assert unrelated row/column dimensions and cells are unchanged, selection collapses to `(0, 0)`, and history is `{ undoDepth: 1, redoDepth: 0 }`.

- [ ] **Step 3: Test existing merged-cell boundaries**

Create two cases from the fixture:

```ts
// Endpoint expansion: selecting physical (1, 1) normalizes to a source at
// (0, 1) with rowSpan 2; merging toward (0, 0) must include both rows.

// Partial middle overlap: a source at (0, 1) with rowSpan 2 lies between
// endpoints (0, 0) and (0, 2); merging must throw because row 1 is omitted.
```

For endpoint expansion, assert the output rectangle is rows 0-1 and columns 0-1. For partial middle overlap, assert `toThrow('table merge selection partially covers merged cell: el_table')` and exact pre/post engine state equality.

- [ ] **Step 4: Test splitting and atomic history**

Start with a source at `(0, 0)` using `rowSpan: 2`, `colSpan: 2`, body, fill, and borders. Select any covered coordinate and dispatch split. Assert four individual cells exist; only `(0, 0)` retains the body/fill/borders and the other three equal `emptyTableCell` shape. Assert selection collapses to `(0, 0)`, history increments once, undo restores the merged table, and redo restores the split table.

Also cover row-only and column-only spans using table-driven cases so both span dimensions are independently verified.

- [ ] **Step 5: Test no-op and validation failure behavior**

Assert all of these leave complete state unchanged:

```ts
new EditorEngine(makeMergeSplitDocument()).dispatch({ type: 'mergeTableCells' })
// select one ordinary cell, then merge
// select one ordinary cell, then split
```

For validation failure, create an engine from a fixture whose unselected cell has `{ body: { paragraphs: [] } }`, select two valid adjacent cells, and assert merge throws `table merge is invalid: el_table:` without changing state.

- [ ] **Step 6: Run focused tests and verify RED**

Run:

```text
pnpm exec vitest run packages/engine/src/engine.test.ts
```

Expected: FAIL at TypeScript/runtime command handling because `mergeTableCells` and `splitTableCell` are not implemented. Existing engine tests remain green.

- [ ] **Step 7: Commit the red behavior contract**

```text
git add packages/engine/src/engine.test.ts
git commit -m "test: define table merge and split behavior"
```

### Task 2: Implement source-cell merge and split

**Files:**
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/engine.test.ts`

**Interfaces:**
- Consumes: existing `TableCellSelection`, `TableSourceRect`, `tableSourceRects(table)`, `rebuildTableRows(...)`, `sourceCellAt(...)`, `validateDocument(...)`, and `EditorEngine.commit(...)`.
- Produces: `EngineCommand` variants `mergeTableCells` and `splitTableCell`, plus private engine methods with no browser dependencies.

- [ ] **Step 1: Add command variants and dispatch branches**

Extend `EngineCommand`:

```ts
  | { type: 'mergeTableCells' }
  | { type: 'splitTableCell' }
```

Add dispatch cases that call `this.mergeTableCells()` and `this.splitTableCell()` before the structure command cases.

- [ ] **Step 2: Add rectangle predicates and source lookup**

Add private module helpers near `tableSourceRects`:

```ts
interface TableGridRect {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

function sourceRect(table: TableElement, source: TableSourceCell): TableSourceRect
function intersectsTableRect(source: TableSourceRect, target: TableGridRect): boolean
function containsTableRect(target: TableGridRect, source: TableSourceRect): boolean
function mergeSelectionRect(table: TableElement, selection: TableCellSelection): TableGridRect
```

`mergeSelectionRect` resolves both endpoints through `sourceCellAt`, converts both sources to full rectangles, and returns their smallest containing rectangle. This is required because selection stores normalized source coordinates, not the physical covered endpoint coordinate.

- [ ] **Step 3: Add deterministic text-body combination**

Add:

```ts
function mergeTableCellBodies(sources: TableSourceRect[], topLeft: TableSourceRect): TextBody
```

Sort sources by `row`, then `column`. Clone the top-left body, retain all its paragraphs, and append only paragraphs from other cells satisfying:

```ts
paragraph.runs.some((run) => run.text.length > 0)
```

Keep the top-left `bodyPr`; do not copy `bodyPr` from other cells. If the final paragraph array is empty, return one `{ runs: [] }` paragraph. Clone the result so later caller mutation cannot affect engine state.

- [ ] **Step 4: Build pure merge and split table transformations**

Add these pure functions:

```ts
function mergeTableSelection(table: TableElement, selection: TableCellSelection): TableElement | undefined
function splitTableSource(table: TableElement, source: TableSourceCell): TableElement | undefined
```

For merge:

1. derive `TableGridRect` from complete endpoint source rectangles;
2. select all source rectangles intersecting it;
3. return `undefined` when only one source rectangle is selected;
4. throw `table merge selection partially covers merged cell` from the engine method when any selected source is not fully contained;
5. create one merged cell from the top-left source, combined body, top-left fill/borders, and normalized spans;
6. remove contained sources, append the merged rectangle, and call `rebuildTableRows` with unchanged row heights and dimensions.

Use a discriminated result so partial overlap is not confused with no-op:

```ts
type TableMergeResult =
  | { status: 'noop' }
  | { status: 'partial-overlap' }
  | { status: 'merged'; table: TableElement; row: number; column: number }
```

For split, return `undefined` when both spans are one. Otherwise remove the focused source rectangle, add one-cell rectangles for every covered coordinate, clone the original payload only for the top-left rectangle with spans removed, and use `emptyTableCell(column)` elsewhere.

- [ ] **Step 5: Validate, commit once, and normalize selection**

Implement engine methods:

```ts
private mergeTableCells(): void
private splitTableCell(): void
private commitTableReplacement(elementId: string, table: TableElement, action: 'merge' | 'split'): void
```

Each command begins with `validTableCellSelection`; invalid or absent selection returns. Resolve the selected table and transformation result without mutation. For a partial merge, throw:

```ts
new Error(`table merge selection partially covers merged cell: ${elementId}`)
```

`commitTableReplacement` clones the document, assigns the candidate table, runs `validateDocument`, throws `table ${action} is invalid: ${elementId}: ${errors}` on failure, and calls one complete-table `commit` only after validation succeeds. After commit, set anchor and focus to the resulting top-left source coordinate.

- [ ] **Step 6: Run focused tests and reach GREEN**

Run:

```text
pnpm exec vitest run packages/engine/src/engine.test.ts
```

Expected: all engine tests pass, including merge/split content, style, overlap, no-op, validation, selection, undo, and redo cases.

- [ ] **Step 7: Run engine package type checking through workspace typecheck**

Run:

```text
pnpm typecheck
```

Expected: PASS with the new command union exhaustively accepted and no DOM/browser type dependency introduced into the engine.

- [ ] **Step 8: Commit the implementation**

```text
git add packages/engine/src/index.ts packages/engine/src/engine.test.ts
git commit -m "feat: add table cell merge and split"
```

### Task 3: Validate and record the completed slice

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: passing merge/split behavior and workspace gates.
- Produces: Stage 7 handoff with merge/split complete and remaining table text editing, inheritance, controls, and export work explicit.

- [ ] **Step 1: Update Stage 7 progress**

Add checked entries recording:

- headless rectangular merge with full existing-span containment;
- deterministic non-empty paragraph preservation and top-left style policy;
- split restoration, selection normalization, validation, and atomic undo/redo.

Change the remaining Stage 7 line so it no longer lists merge/split as pending. Keep table text editing, structure/merge toolbar controls, complete theme inheritance, and PPTX table XML export pending.

- [ ] **Step 2: Run complete workspace validation**

Run:

```text
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all package boundaries pass; all tests pass; typecheck and build pass; no whitespace errors are reported.

- [ ] **Step 3: Commit the progress record**

```text
git add 进度.md
git commit -m "docs: record table merge and split slice"
```

## Completion criteria

- Both commands are public through `EditorEngine.dispatch` and remain selection-driven.
- Existing merged endpoint spans expand the requested rectangle; intermediate partial merged-cell overlap is rejected atomically.
- Merge preserves top-left body properties and cell style while retaining every non-empty paragraph in deterministic order.
- Split restores individual valid source cells and retains content/style only at the top-left coordinate.
- Successful operations create one history entry; no-op and invalid operations create none.
- Focused tests, package boundaries, full tests, typecheck, build, and diff checks pass.
