# Table Editor Engine Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate table overlay selection events into deterministic `EditorEngine` table-cell selection commands through a reusable headless editor controller.

**Architecture:** Add `createTableEditorController` in `@ppt4ai/editor` as a thin adapter around an injected `EditorEngine` and table element ID. The controller validates overlay coordinates, dispatches anchor/focus commands, and returns the engine's clone-safe state; the Vue overlay and `PptEditor.vue` remain unchanged.

**Tech Stack:** TypeScript, `@ppt4ai/engine`, Vitest, pnpm workspace.

## Global Constraints

- UI dependencies remain Vue 3 plus UnoCSS; do not add Element Plus or another component framework.
- `@ppt4ai/engine` remains headless and must not import Vue, DOM, Canvas, or browser globals.
- Controller inputs and outputs remain `structuredClone`-compatible.
- Use existing `EditorEngine.dispatch` and do not mutate engine internals or document history directly.
- Each completed implementation slice receives its own git commit.

---

### Task 1: Define Controller Tests

**Files:**
- Create: `packages/editor/src/table-editor-controller.test.ts`

**Interfaces:**
- Consumes: `EditorEngine`, `TableCellSelection`, and the existing table fixture patterns from `packages/engine/src/engine.test.ts`.
- Produces: executable expectations for `createTableEditorController` and its public controller methods.

- [ ] **Step 1: Write the failing tests**

Add tests that construct a real `EditorEngine` with a table document and assert:

```ts
const controller = createTableEditorController({ engine, elementId: 'el_table' })
const state = controller.select({ anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } })
expect(state.tableCellSelection).toEqual({
  elementId: 'el_table',
  anchorRow: 1,
  anchorColumn: 1,
  row: 1,
  column: 1,
})
expect(state.history).toEqual({ undoDepth: 0, redoDepth: 0 })
```

Cover reverse drag selection through `selectEnd`, merged-cell coordinate normalization delegated to engine, clone-safe returned state, invalid non-integer/non-finite points rejected before dispatch, and empty element ID rejected during construction.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `pnpm exec vitest run packages/editor/src/table-editor-controller.test.ts`

Expected: FAIL because `table-editor-controller.ts` and its exported factory do not exist.

- [ ] **Step 3: Commit the red tests**

```bash
git add packages/editor/src/table-editor-controller.test.ts
git commit -m "test: specify table editor engine wiring"
```

### Task 2: Implement the Headless Controller

**Files:**
- Create: `packages/editor/src/table-editor-controller.ts`

**Interfaces:**
- Consumes: `EditorEngine`, `EngineState` from `@ppt4ai/engine`, and `TableCellSelection` from `./table-editor-overlay`.
- Produces: `TableEditorControllerOptions`, `TableEditorController`, and `createTableEditorController(options)`.

- [ ] **Step 1: Implement coordinate validation**

Require a non-empty string `elementId`. Validate every `anchor` and `focus` row/column with `Number.isFinite` and `Number.isInteger`; throw stable errors such as `table cell coordinate must use finite integers: anchor[0,1]` before calling the engine.

- [ ] **Step 2: Implement command mapping**

Dispatch the anchor with `extend: false`. For `selectEnd`, dispatch the anchor first and dispatch the focus with `extend: true` only when the coordinates differ. Return the final `EngineState` from `engine.dispatch`; return `engine.getState()` from `getState`.

- [ ] **Step 3: Run focused tests**

Run: `pnpm exec vitest run packages/editor/src/table-editor-controller.test.ts`

Expected: PASS for all controller mapping, validation, history, and clone-safety tests.

- [ ] **Step 4: Commit the controller slice**

```bash
git add packages/editor/src/table-editor-controller.ts packages/editor/src/table-editor-controller.test.ts
git commit -m "feat: wire table overlay selection to engine"
```

### Task 3: Export the Controller and Validate the Package

**Files:**
- Modify: `packages/editor/src/index.ts`
- Modify: `进度.md`

**Interfaces:**
- Consumes: the controller factory and types from `table-editor-controller.ts`.
- Produces: public `@ppt4ai/editor` exports and a recorded completed Stage 7 wiring slice.

- [ ] **Step 1: Export the controller**

Export `createTableEditorController` and the `TableEditorController` and `TableEditorControllerOptions` types from the editor package entrypoint. Do not export engine implementation details through a new wrapper.

- [ ] **Step 2: Update progress**

Mark the Stage 7 item for table selection to engine command wiring as complete in `进度.md`, while leaving formatting controls, row/column operations, merge/split, text editing, style inheritance, and PPTX export pending.

- [ ] **Step 3: Run package and workspace gates**

Run:

```bash
pnpm exec vitest run packages/editor/src/table-editor-controller.test.ts
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all focused and workspace checks pass, with no boundary violation or formatting error.

- [ ] **Step 4: Commit the public integration slice**

```bash
git add packages/editor/src/index.ts 进度.md
git commit -m "docs: record table engine wiring slice"
```

## Completion Criteria

- Overlay selection payloads can be translated to engine selection state without coupling the Vue component to engine imports.
- Clicks dispatch one command; drags dispatch anchor then focus and preserve reverse ranges.
- Merged-cell normalization remains centralized in the engine.
- Selection does not create history entries and returned state is clone-safe.
- All focused and workspace validation commands pass.
