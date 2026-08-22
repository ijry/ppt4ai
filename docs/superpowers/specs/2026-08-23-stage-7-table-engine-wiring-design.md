# Stage 7 Table Editor Engine Wiring Design

## Goal

Connect the existing Vue table editor overlay to the headless `EditorEngine` through a reusable controller, without making the overlay depend on engine state or browser APIs beyond its existing Vue rendering contract.

## Scope and boundaries

- `@ppt4ai/editor` owns the adapter/controller that translates overlay selection events into engine commands.
- `@ppt4ai/engine` remains the owner of table-cell selection normalization and session state.
- `TableEditorOverlay.vue` remains engine-agnostic and continues to emit JSON-safe selection payloads.
- This slice does not modify `PptEditor.vue`, add a table formatting toolbar, edit cell text, add row/column operations, or add a replacement UI framework.
- The controller is headless TypeScript and has no DOM, Vue runtime, Canvas, or browser-global dependency.

## Controller contract

The editor package adds:

```ts
interface TableEditorControllerOptions {
  engine: EditorEngine
  elementId: string
}

interface TableEditorController {
  getState(): EngineState
  select(selection: TableCellSelection): EngineState
  selectEnd(selection: TableCellSelection): EngineState
}
```

`createTableEditorController` validates the element ID and keeps references to the supplied engine and table ID. Each returned state is the engine's clone-safe `getState()` result.

## Event mapping

`select` dispatches one command for the selection anchor with `extend: false`:

```ts
{
  type: 'selectTableCell',
  elementId,
  row: selection.anchor.row,
  column: selection.anchor.column,
  extend: false,
}
```

`selectEnd` first resets the anchor to the supplied selection anchor, then dispatches a focus command with `extend: true` only when anchor and focus differ. This makes a click a single engine command while a drag produces an inclusive engine range. The engine remains responsible for merged-cell coordinate normalization.

The controller does not mutate document history itself. Selection commands are already session-only engine operations, so selecting cells does not change undo or redo depth.

## Validation and failure behavior

- The controller rejects non-finite or non-integer row and column values before dispatching, using stable coordinate errors.
- It rejects an empty `elementId` during construction.
- Engine validation errors propagate without being wrapped, so callers receive the existing deterministic errors.
- A failed selection dispatch does not issue a second command.

## Testing

Focused tests cover:

- click mapping and collapsed selection command count;
- drag mapping, including reverse ranges;
- merged-cell coordinates being delegated to engine normalization;
- clone-safe returned state and unchanged history depth;
- invalid controller input failing before engine dispatch.

Boundary checks, editor tests, typecheck, build, and the full workspace test suite remain the validation gates.

## Deferred work

- A Vue host component that composes the overlay and controller;
- table text editing and IME caret ownership;
- fill, border, row/column, merge/split, and table-style controls;
- direct document/scene-state integration in `PptEditor.vue`.
