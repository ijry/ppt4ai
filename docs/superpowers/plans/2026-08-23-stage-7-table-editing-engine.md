# Table Editing Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with focused verification and one commit per task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add headless, JSON-safe table-cell selection and editing commands to `@ppt4ai/engine` using the existing patch-based history system.

**Architecture:** Keep element selection and table-cell selection as separate engine state. Resolve grid coordinates to source cells, enumerate inclusive rectangular ranges for style edits, and route all document mutations through the existing patch/undo/redo implementation. Do not add UI or browser dependencies in this slice.

**Tech Stack:** TypeScript, Vitest, `@ppt4ai/model`, existing `@ppt4ai/engine` patch history; no new runtime dependencies and no Element Plus.

## Global Constraints

- Public engine state and command payloads remain JSON-safe and `structuredClone`-compatible.
- `@ppt4ai/engine` stays headless and cannot import Vue, DOM, Canvas, or browser globals.
- Reuse existing model validators and patch history; do not duplicate document storage.
- Invalid table coordinates and invalid model payloads fail deterministically without partial mutation.
- One command produces at most one history entry; no-op edits do not enter history.
- Use TDD: write each focused failing test, run it red, implement the smallest behavior, run it green, then refactor.
- Commit each task independently.

---

### Task 1: Add table-cell selection state and coordinate resolution

**Files:**
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/engine.test.ts`

**Interfaces:**
- Adds `TableCellSelection` with `elementId`, `anchorRow`, `anchorColumn`, `row`, and `column`.
- Adds `EngineState.tableCellSelection?: TableCellSelection`.
- Adds `EngineCommand` variant `{ type: 'selectTableCell'; elementId: string; row: number; column: number; extend?: boolean }`.

- [ ] **Step 1: Write the failing selection tests**

Extend the engine fixture with a 2x2 table whose first row contains one `colSpan: 2` source cell. Assert:

```ts
expect(engine.dispatch({ type: 'selectTableCell', elementId: 'el_table', row: 0, column: 1 }).tableCellSelection)
  .toEqual({ elementId: 'el_table', anchorRow: 0, anchorColumn: 0, row: 0, column: 1 })
```

Also assert that `extend: true` retains the anchor for a rectangular range, a new table resets the anchor, the table element becomes the sole element selection, merged coordinates resolve to the source cell, invalid coordinates throw stable errors, a normal `select` clears table-cell selection, and `structuredClone(engine.getState())` equals the state.

- [ ] **Step 2: Run the selection tests red**

Run: `pnpm exec vitest run packages/engine/src/engine.test.ts`

Expected: FAIL because `selectTableCell`, `tableCellSelection`, and the table fixture behavior do not exist.

- [ ] **Step 3: Implement coordinate resolution and selection state**

Add the interfaces and command branch. Implement private helpers that:

1. Validate the element exists and is a table.
2. Require finite integer row/column coordinates inside `table.rows.length` and `table.columns.length`.
3. Find the source cell whose `column <= column < column + (colSpan ?? 1)` and whose occupied row range contains the requested row, including `rowSpan`.
4. Throw `table cell coordinate is outside table: ${elementId}[${row},${column}]` when no source cell covers the coordinate.
5. Retain the existing anchor only for `extend: true` on the same table; otherwise use the resolved source coordinate.
6. Set `selection` to `[elementId]` and clear `tableCellSelection` for ordinary `select` commands.

Return cloned state and clear invalid cell selection during history replay when the table disappears or no longer covers its range.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm exec vitest run packages/engine/src/engine.test.ts; pnpm --filter @ppt4ai/engine typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the selection slice**

```bash
git add packages/engine/src/index.ts packages/engine/src/engine.test.ts
git commit -m "feat: add table cell selection state"
```

---

### Task 2: Add selected-cell text editing

**Files:**
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/engine.test.ts`

**Interfaces:**
- Adds `EngineCommand` variant `{ type: 'setTableCellText'; body: TextBody }`.

- [ ] **Step 1: Write the failing text-edit tests**

Select a table cell and dispatch a valid `TextBody`. Assert the source cell body is replaced with a clone, exactly one history entry is added, undo restores the old body, redo restores the new body, and mutating the caller body after dispatch does not affect the engine. Assert no selected cell is a no-op and invalid/empty bodies throw a stable `table cell body is invalid:` error without changing history or document.

- [ ] **Step 2: Run the text tests red**

Run: `pnpm exec vitest run packages/engine/src/engine.test.ts`

Expected: FAIL because the text command is not defined.

- [ ] **Step 3: Implement validated focus-cell text replacement**

Import `TextBody`, `TableElement`, and `validateTextBody` from `@ppt4ai/model`. Require a current table-cell selection, validate the body before making a patch, and commit one operation at `elements.<elementId>.rows.<row>.cells.<cellIndex>.body`. Use the source cell index resolved from the selected source coordinate, not a layout-cell index.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm exec vitest run packages/engine/src/engine.test.ts; pnpm --filter @ppt4ai/engine typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the text slice**

```bash
git add packages/engine/src/index.ts packages/engine/src/engine.test.ts
git commit -m "feat: edit selected table cell text"
```

---

### Task 3: Add selected-cell fill and border editing

**Files:**
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/engine.test.ts`

**Interfaces:**
- Adds `EngineCommand` variant `{ type: 'setTableCellFill'; fill: Fill | null }`.
- Adds `EngineCommand` variant `{ type: 'setTableCellBorders'; borders: Partial<Record<'left' | 'right' | 'top' | 'bottom', TableBorder | null>> }`.

- [ ] **Step 1: Write the failing style-edit tests**

Select a rectangular range containing two normal cells and one merged source cell. Assert fill applies to each deduplicated source cell, `null` removes explicit fill, border updates change only supplied sides, `null` removes a supplied side, and unmentioned sides remain unchanged. Assert one command creates one history entry, undo/redo is atomic, invalid fill/border input throws without partial changes, and no-op updates do not increase history.

- [ ] **Step 2: Run the style tests red**

Run: `pnpm exec vitest run packages/engine/src/engine.test.ts`

Expected: FAIL because the style commands are not defined.

- [ ] **Step 3: Implement range enumeration and style patches**

Add source-cell helpers that enumerate rows and cells intersecting the inclusive anchor/focus rectangle, deduplicate by row and cell index, and produce patch paths for `fill` and individual `borders.<side>` fields. Validate proposed values with the existing model validation contract before committing; use `{ value: undefined }` for removals. Do not mutate caller-owned payloads.

- [ ] **Step 4: Run focused tests and package verification**

Run: `pnpm exec vitest run packages/engine/src/engine.test.ts; pnpm --filter @ppt4ai/engine typecheck; pnpm --filter @ppt4ai/engine build`

Expected: PASS.

- [ ] **Step 5: Commit the style slice**

```bash
git add packages/engine/src/index.ts packages/engine/src/engine.test.ts
git commit -m "feat: edit selected table cell styles"
```

---

### Task 4: Verify and record the engine editing slice

**Files:**
- Modify: `进度.md`

- [ ] **Step 1: Update progress**

Record the headless table-cell selection, text, fill, and border commands as complete. Keep UnoCSS UI, row/column operations, merge/split, full theme inheritance, and PPTX export pending.

- [ ] **Step 2: Run repository verification**

Run: `pnpm check:boundaries; pnpm test; pnpm typecheck; pnpm build; git diff --check`

Expected: all commands pass and only the progress update remains uncommitted.

- [ ] **Step 3: Commit the progress slice**

```bash
git add 进度.md
git commit -m "docs: record table editing engine slice"
```
