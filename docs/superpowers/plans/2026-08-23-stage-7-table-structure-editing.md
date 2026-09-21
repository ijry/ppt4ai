# Stage 7 Table Structure Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add atomic, undoable row and column insertion/deletion commands to the headless table engine with merged-cell preservation and cell-selection migration.

**Architecture:** Keep structure transformations inside `@ppt4ai/engine` as pure table builders around the existing patch/history mechanism. Each command validates a complete next table before committing one replacement patch; selection migration happens after the same transformed grid is available and never enters history.

**Tech Stack:** TypeScript, Vitest, `@ppt4ai/model`, `@ppt4ai/engine`, structured-clone-safe JSON data.

## Global Constraints

- `@ppt4ai/engine` remains headless and must not import Vue, DOM, Canvas, or browser globals.
- The editor UI continues to depend only on Vue 3, vue-i18n, native controls, and UnoCSS; this slice adds no UI.
- Every structure command is one patch-based history entry and must preserve undo/redo behavior.
- Every new behavior is test-first: write the failing engine test, run it red, implement minimally, then run it green.
- Use existing model validation and `TextBody` shape `{ paragraphs: [{ runs: [] }] }` for generated cells.

---

### Task 1: Add the command contract and failing structure tests

**Files:**
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/src/engine.test.ts`

**Interfaces:**
- Consumes: existing `EngineCommand`, `EditorEngine.dispatch`, `TableElement`, `TableCellSelection`, and `validateDocument`.
- Produces: four command variants: `insertTableRow`, `deleteTableRow`, `insertTableColumn`, and `deleteTableColumn`; each has `elementId`, `index`, and optional positive `count`.

- [ ] **Step 1: Write failing tests for row insertion**

Add tests using the existing table fixture that dispatch:

```ts
engine.dispatch({ type: 'insertTableRow', elementId: 'el_table', index: 1 })
```

and assert the resulting table has three rows, the inserted row copied height `1500000`, the original merged header still has `rowSpan: 1`, the existing second-row cells moved to row index 2, and the table height increased by `1500000`.

- [ ] **Step 2: Write failing tests for column insertion and merged spans**

Assert inserting two columns at index 1 copies the width `2000000` twice, increases table width by `4000000`, shifts the right source cell from column 2 to column 4, and expands a source cell covering the insertion point by two columns.

- [ ] **Step 3: Write failing tests for row and column deletion**

Use a literal four-row/four-column fixture with a merged cell whose source is inside the deleted range. Assert deletion rehomes surviving body/style data, shrinks surviving spans, reorders source columns, and rejects deleting all rows or all columns.

- [ ] **Step 4: Write failing tests for selection migration and history**

Select a cell before each operation, insert before it, delete around it, and assert anchor/focus are shifted or clamped to a valid source cell. Assert one operation increments `undoDepth` once, undo restores the exact fixture and selection-validity, and redo reapplies the structure.

- [ ] **Step 5: Run focused tests and verify the expected red failure**

Run: `pnpm exec vitest run packages/engine/src/engine.test.ts`

Expected: FAIL because the new command types and dispatch handlers do not exist; existing tests must remain green.

- [ ] **Step 6: Commit the red test contract**

```bash
git add packages/engine/src/engine.test.ts
git commit -m "test: define table structure editing behavior"
```

### Task 2: Implement validated table transformation helpers

**Files:**
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: the four command payloads from Task 1 and existing `TableSourceCell`/`sourceCellAt` behavior.
- Produces: internal `transformTableStructure(table, operation)` result containing the transformed `TableElement` plus endpoint coordinate mapping for selection migration.

- [ ] **Step 1: Add command dispatch branches and argument validation**

Add the four union variants and dispatch cases. Validate element existence, table kind, finite integer `index`, default `count` to 1, positive integer count, insertion bounds, deletion bounds, and the invariant that at least one row and one column remain. Throw before changing document or history.

- [ ] **Step 2: Add pure empty-cell and grid occupancy helpers**

Implement internal helpers with explicit types:

```ts
type TableStructureOperation =
  | { axis: 'row'; mode: 'insert' | 'delete'; index: number; count: number }
  | { axis: 'column'; mode: 'insert' | 'delete'; index: number; count: number }

interface TableStructureResult {
  table: TableElement
  mapPoint(point: { row: number; column: number }): { row: number; column: number } | undefined
}
```

Create empty cells with `{ paragraphs: [{ runs: [] }] }`, preserve explicit styles only for existing/migrated source cells, and use occupancy maps to represent every covered grid coordinate.

- [ ] **Step 3: Implement row insertion and deletion**

Transform source-cell rectangles into surviving grid rectangles, shift or expand them according to the design, migrate the source payload from deleted source rows to the first surviving row when needed, then rebuild sorted row cell arrays from the transformed rectangles. Copy the selected neighboring row height for inserted rows and update `bounds.h` by the inserted/deleted heights.

- [ ] **Step 4: Implement column insertion and deletion**

Apply the same rectangle transformation to columns, preserving source payloads and rebuilding each row's sorted cells. Copy the neighboring column width for inserted columns and update `bounds.w` by the inserted/deleted widths.

- [ ] **Step 5: Validate before commit and migrate selection**

Build a cloned document containing the candidate table, call `validateDocument`, and throw `table structure is invalid: ...` without side effects on failure. Map current anchor/focus through the operation, clamp deleted coordinates to the nearest remaining grid coordinate, normalize through `sourceCellAt`, then call one existing `commit` with the complete table replacement.

- [ ] **Step 6: Run focused engine tests and verify green**

Run: `pnpm exec vitest run packages/engine/src/engine.test.ts`

Expected: all existing engine tests plus the new structure tests pass with no warnings.

- [ ] **Step 7: Commit the engine implementation**

```bash
git add packages/engine/src/index.ts packages/engine/src/engine.test.ts
git commit -m "feat: add table row and column editing"
```

### Task 3: Validate the completed structure slice and record progress

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: public `EngineCommand` structure variants and passing engine tests.
- Produces: stage handoff documenting row/column editing completion and remaining merge/split, text editing, inheritance, and export work.

- [ ] **Step 1: Add progress entry**

Record that headless engine row/column insert/delete is complete, including merged-span adjustment, selection migration, atomic history, validation, and undo/redo. Keep merge/split UI, table text editing, complete theme inheritance, and PPTX table XML export pending.

- [ ] **Step 2: Run workspace validation**

Run:

```bash
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands pass, with no package-boundary, test, type, build, or whitespace errors.

- [ ] **Step 3: Commit the progress record**

```bash
git add 进度.md
git commit -m "docs: record table structure editing slice"
```

## Completion Criteria

- All four structure commands are exported through `EditorEngine.dispatch` and remain headless.
- Insertions copy dimensions, preserve/expand merged coverage, create valid empty cells, and update table bounds.
- Deletions shrink or migrate merged source cells without producing overlap or out-of-bounds cells.
- Cell selection shifts, clamps, or clears deterministically after structure changes.
- Each operation is one undoable/redoable history entry.
- Focused and workspace validation gates pass.
