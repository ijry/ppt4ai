# Stage 7 Table Text Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direct merged-aware table-cell text editing with local IME drafts and one engine history entry on commit.

**Architecture:** Keep the headless engine responsible only for selection normalization and the existing `setTableCellText` command. Add a small engine-facing table text controller, a Vue `TableCellTextEditor` host that composes `TextBoxEditor`, and an edit event on `TableEditorOverlay`. Extend `TextBoxEditor` with a backward-compatible selection-frame option so table text sessions reuse caret, selection, composition, wrapping, and pointer behavior without resize handles.

**Tech Stack:** Vue 3.5, TypeScript 6, Vitest 4, happy-dom, `@ppt4ai/engine`, `@ppt4ai/render`, `@ppt4ai/text`, UnoCSS utility classes.

## Global Constraints

- `@ppt4ai/engine` remains headless and imports no Vue, DOM, Canvas, or browser globals.
- UI remains Vue 3 plus UnoCSS only; do not add Element Plus or another component framework.
- Draft changes never dispatch to the engine; commit dispatches one `setTableCellText` command.
- `Escape` cancels; `Ctrl+Enter` and blur commit; ordinary Enter inserts text.
- Merged cells always edit their normalized source body and complete source bounds.
- No-op, cancel, validation failure, and stale-target failure create no document history entry.
- Every manual edit uses `apply_patch`; do not revert unrelated worktree changes.

---

## File Map

- Modify: `packages/editor/src/text-box-editor.ts` — add `TextBoxEditorSelectionFrame` and optional `selectionFrame` prop.
- Modify: `packages/editor/src/TextBoxEditor.vue` — conditionally render `SelectionOverlay` while preserving current default behavior.
- Modify: `packages/editor/src/TextBoxEditor.test.ts` — lock default frame and disabled-frame behavior.
- Create: `packages/editor/src/table-cell-text-editing-controller.ts` — engine-facing commit/cancel session boundary.
- Create: `packages/editor/src/table-cell-text-editing-controller.test.ts` — test one-write commit, normalization, no-op, cancel, and stale safety.
- Create: `packages/editor/src/TableCellTextEditor.vue` — local-draft Vue host composed from `TextBoxEditor`.
- Create: `packages/editor/src/table-cell-text-editor.ts` — props/event and session helper contracts.
- Create: `packages/editor/src/TableCellTextEditor.test.ts` — component lifecycle, keyboard, blur, IME, geometry, and frame tests.
- Modify: `packages/editor/src/TableEditorOverlay.vue` — double-click/Enter edit event and inactive hit surface while editing is owned by parent.
- Modify: `packages/editor/src/TableEditorOverlay.test.ts` — edit activation and Space regression tests.
- Modify: `packages/editor/src/index.ts` — export the table text component, contract, and controller types.
- Modify: `进度.md` — record the completed table text editing slice.

## Task 1: Extend TextBoxEditor’s Selection Frame

**Files:**
- Modify: `packages/editor/src/text-box-editor.ts`
- Modify: `packages/editor/src/TextBoxEditor.vue`
- Test: `packages/editor/src/TextBoxEditor.test.ts`

**Interfaces:**
- Consumes: existing `TextBoxEditorProps`, `SelectionOverlay`, and controller snapshots.
- Produces: `selectionFrame?: 'resize' | 'none'`, defaulting to `'resize'`, plus `update:composing(boolean)`.

- [ ] **Step 1: Write the failing tests**

Add one test that mounts the current default and asserts one `data-selection-border` plus eight `data-selection-handle` nodes. Add a second test that passes `selectionFrame: 'none'` and asserts the text surface/caret host remains active while both border and handles are absent. Extend the composition test to assert `update:composing` emits `true` on composition start and `false` on composition end.

- [ ] **Step 2: Run the focused tests and verify RED**

Run `pnpm exec vitest run packages/editor/src/TextBoxEditor.test.ts`. Expected: TypeScript/template failure because `selectionFrame` is not yet part of the props contract and the disabled-frame assertion fails.

- [ ] **Step 3: Implement the smallest shared-component change**

Add:

```ts
export type TextBoxEditorSelectionFrame = 'resize' | 'none'
readonly selectionFrame?: TextBoxEditorSelectionFrame
```

In the template, render `SelectionOverlay` only when `props.active && props.selectionFrame !== 'none'`; keep all resize emits unchanged. In the controller subscription, emit `update:composing` only when `nextSnapshot.composing` changes, and emit `false` during controller teardown if the last snapshot was composing.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run `pnpm exec vitest run packages/editor/src/TextBoxEditor.test.ts`. Expected: all existing tests and the new frame tests pass.

- [ ] **Step 5: Commit the shared contract**

Run `git add packages/editor/src/text-box-editor.ts packages/editor/src/TextBoxEditor.vue packages/editor/src/TextBoxEditor.test.ts; git commit -m "feat: make text editor selection frame configurable"`.

## Task 2: Add Engine-Facing Table Text Commit Controller

**Files:**
- Create: `packages/editor/src/table-cell-text-editing-controller.ts`
- Test: `packages/editor/src/table-cell-text-editing-controller.test.ts`

**Interfaces:**
- Consumes: `EditorEngine.dispatch`, `TableCellPoint`, existing `selectTableCell` and `setTableCellText` commands.
- Produces:

```ts
interface TableCellTextEditingControllerOptions {
  engine: EditorEngine
  elementId: string
}

interface TableCellTextEditingController {
  getState(): EngineState
  commitText(point: TableCellPoint, body: TextBody): EngineState
  cancelText(): EngineState
}
```

- [ ] **Step 1: Write failing controller tests**

Add a source-table fixture with a merged cell at `(0, 0)` spanning `(0, 1)`. Test that `commitText({ row: 0, column: 1 }, body)` reselects source `(0, 0)`, replaces only its body, and yields history depth 1. Test undo/redo, unchanged commit depth 0, cancel depth 0, clone safety, and invalid/missing targets producing no text write.

- [ ] **Step 2: Run controller tests and verify RED**

Run `pnpm exec vitest run packages/editor/src/table-cell-text-editing-controller.test.ts`. Expected: module-not-found or missing-export failure.

- [ ] **Step 3: Implement commit/cancel with explicit target normalization**

Create `createTableCellTextEditingController(options)` with private finite-integer point validation and non-empty element ID validation. Implement:

```ts
commitText(point, body) {
  assertPoint(point, 'text')
  options.engine.dispatch({
    type: 'selectTableCell',
    elementId: options.elementId,
    row: point.row,
    column: point.column,
    extend: false,
  })
  return options.engine.dispatch({ type: 'setTableCellText', body: structuredClone(body) })
}
cancelText() {
  return options.engine.getState()
}
```

The engine selection dispatch is non-history; the body dispatch performs the single atomic history entry. Do not catch stale-target errors and do not dispatch the body after selection failure.

- [ ] **Step 4: Run controller tests and verify GREEN**

Run `pnpm exec vitest run packages/editor/src/table-cell-text-editing-controller.test.ts`. Expected: all table text controller tests pass.

- [ ] **Step 5: Commit the controller**

Run `git add packages/editor/src/table-cell-text-editing-controller.ts packages/editor/src/table-cell-text-editing-controller.test.ts; git commit -m "feat: add table text commit controller"`.

## Task 3: Build the Local-Draft TableCellTextEditor

**Files:**
- Create: `packages/editor/src/table-cell-text-editor.ts`
- Create: `packages/editor/src/TableCellTextEditor.vue`
- Test: `packages/editor/src/TableCellTextEditor.test.ts`

**Interfaces:**
- Consumes: `SceneTableLayoutCell`, `TextViewportTransform`, `TextBoxEditor`, `ImeInputBridgeOptions`.
- Produces:

```ts
interface TableCellTextEditorProps {
  active: boolean
  cell: SceneTableLayoutCell
  transform: TextViewportTransform
  bridgeFactory?: (options: ImeInputBridgeOptions) => ImeInputBridge
}
```

Events are `update:draft(body)`, `commit(body)`, and `cancel()`.

- [ ] **Step 1: Write failing component tests**

Mount an active editor with a merged source cell and fake bridge. Assert it uses `cell.body`, complete source bounds, and `selectionFrame: 'none'`. Send text and composition events through the bridge and assert only draft events occur. Dispatch ordinary Enter on the hidden input and assert the draft gains a paragraph without commit. Dispatch `Ctrl+Enter` and `Escape` and assert capture-phase session handling prevents text insertion and emits exactly one close event. Trigger focusout and repeated close requests to assert at-most-once behavior. During composition, request blur/commit, end composition, and assert the final committed body is emitted once. Assert no selection-frame border or handles.

- [ ] **Step 2: Run the component tests and verify RED**

Run `pnpm exec vitest run packages/editor/src/TableCellTextEditor.test.ts`. Expected: module-not-found or missing-contract failures.

- [ ] **Step 3: Implement the local-draft host**

Create the type contract and render:

```vue
<TextBoxEditor
  :body="draft"
  :bounds="props.cell.bounds"
  :transform="props.transform"
  :active="props.active"
  selection-frame="none"
  :bridge-factory="props.bridgeFactory"
  @update:body="updateDraft"
  @update:selection="emit('update:selection', $event)"
/>
```

Keep the draft as a cloned `ref`. On `update:body`, replace the clone and emit `update:draft`; on commit, emit a clone once and mark the session closed; on cancel, emit once and mark it closed. Track `update:composing`. Attach `@keydown.capture` to intercept only `Ctrl+Enter` and `Escape` before the hidden input listener; defer either request while composing. Attach `focusout` to request commit after a microtask when focus is outside the root; defer it while composing. Process a deferred request after `update:composing(false)`, after the final synchronous `update:body` callback. Ordinary Enter remains owned by the hidden IME bridge. Expose no imperative public API and add no engine dependency.

- [ ] **Step 4: Run component tests and verify GREEN**

Run `pnpm exec vitest run packages/editor/src/TableCellTextEditor.test.ts packages/editor/src/TextBoxEditor.test.ts`. Expected: pass with no resize frame in the table host and preserved default frame in text boxes.

- [ ] **Step 5: Commit the local-draft editor**

Run `git add packages/editor/src/table-cell-text-editor.ts packages/editor/src/TableCellTextEditor.vue packages/editor/src/TableCellTextEditor.test.ts; git commit -m "feat: add table cell text editor"`.

## Task 4: Connect Table Overlay Editing and Public Exports

**Files:**
- Modify: `packages/editor/src/TableEditorOverlay.vue`
- Modify: `packages/editor/src/TableEditorOverlay.test.ts`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- Consumes: `TableCellTextEditor` edit event contract and existing source-cell hit testing.
- Produces: `edit: [point: TableCellPoint]` event and public editor exports.

- [ ] **Step 1: Write failing overlay/export tests**

Assert Enter emits one `edit` event with the normalized source point, Space emits no edit event, and double-clicking a source cell emits one edit event. Assert the entry point exports `TableCellTextEditor`, `createTableCellTextEditingController`, and the related runtime factories/components; typecheck covers type-only exports.

- [ ] **Step 2: Run overlay tests and verify RED**

Run `pnpm exec vitest run packages/editor/src/TableEditorOverlay.test.ts`. Expected: missing `edit` event behavior/export assertions fail.

- [ ] **Step 3: Implement edit activation without changing selection semantics**

Add `edit` to `defineEmits`, add `@dblclick` to each source-cell surface, and emit a cloned point after collapsed selection is established. Change keyboard activation so Enter emits `edit` while Space keeps selection-only behavior. Keep pointer drag and selection-end events unchanged. The parent must be able to stop rendering the overlay during an active text session; no overlay-local engine imports are allowed.

- [ ] **Step 4: Run overlay/editor tests and verify GREEN**

Run `pnpm exec vitest run packages/editor/src/TableEditorOverlay.test.ts packages/editor/src/TableCellTextEditor.test.ts`. Expected: all activation, merged-source, and frame tests pass.

- [ ] **Step 5: Commit the integration surface**

Run `git add packages/editor/src/TableEditorOverlay.vue packages/editor/src/TableEditorOverlay.test.ts packages/editor/src/index.ts; git commit -m "feat: expose table text editing activation"`.

## Task 5: Record Progress and Run Full Validation

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: committed editor implementation and all focused tests.
- Produces: Stage 7 handoff with table text editing checked off and theme inheritance/export XML explicitly remaining.

- [ ] **Step 1: Update progress**

Add checked entries for merged-aware source-cell text editing, local IME draft/commit/cancel semantics, automatic wrapping, and no-resize table text sessions. Change the Stage 7 remaining line to list only complete theme colors/style inheritance and PPTX table export XML.

- [ ] **Step 2: Run all workspace gates**

Run `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check`. Expected: every command exits zero; engine boundary scan reports no browser imports.

- [ ] **Step 3: Commit the progress record**

Run `git add 进度.md; git commit -m "docs: record table text editing slice"`.

## Completion Criteria

- Text-box defaults retain border and eight resize handles; table-cell sessions hide them.
- Merged source cells use complete source bounds and normalized body.
- IME composition remains provisional/local until commit.
- Ordinary Enter inserts a paragraph/line break; `Ctrl+Enter` and blur commit; `Escape` cancels.
- Commit reselects the source target and adds at most one history entry; unchanged commits and cancels add none.
- All focused and workspace validation commands pass with no Element Plus dependency.
