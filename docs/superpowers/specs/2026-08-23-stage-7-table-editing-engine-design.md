# Stage 7 Table Editing Engine Design

## Goal

Add a JSON-safe, headless table-cell editing contract to `@ppt4ai/engine` so later UnoCSS editor controls can select cells and update cell text, fill, and borders through the existing deterministic history system.

## Scope and boundaries

- `@ppt4ai/engine` owns table-cell selection state and document-editing commands.
- `@ppt4ai/model` remains the canonical table, text, fill, and border contract.
- The slice does not add Vue components, DOM access, Canvas access, browser globals, Element Plus, or runtime dependencies.
- Table UI, pointer hit-testing, row/column insertion or deletion, merge/split, complete PowerPoint style inheritance, and PPTX export remain deferred.

## Selection state

`EngineState` gains optional `tableCellSelection`:

```ts
interface TableCellSelection {
  elementId: string
  anchorRow: number
  anchorColumn: number
  row: number
  column: number
}
```

The existing `selection: string[]` continues to contain element IDs only. Selecting a table cell selects its table element and sets a cell anchor/focus range. A non-additive element `select` command clears cell selection so stale cell focus cannot leak to another element.

`selectTableCell` accepts a grid coordinate. A coordinate covered by a merged cell resolves to that cell's source coordinate. With `extend: true`, the existing anchor is retained only when it belongs to the same table; otherwise the resolved coordinate becomes both anchor and focus. Missing elements, non-table elements, non-integer coordinates, and coordinates outside the table grid throw stable errors.

The selection is cloned by `getState()` and is not part of document history. Undo and redo retain it while the referenced table and cell still exist, and clear it if history removes or invalidates the target.

## Selected source cells

The rectangular grid range between anchor and focus is inclusive. Editing commands enumerate table source cells whose occupied row/column span intersects that range, then deduplicate them by source row and source cell index. This makes a merged cell one editing target even when multiple covered grid coordinates are selected.

## Editing commands

The engine adds these commands:

```ts
{ type: 'selectTableCell'; elementId: string; row: number; column: number; extend?: boolean }
{ type: 'setTableCellText'; body: TextBody }
{ type: 'setTableCellFill'; fill: Fill | null }
{ type: 'setTableCellBorders'; borders: Partial<Record<'left' | 'right' | 'top' | 'bottom', TableBorder | null>> }
```

`setTableCellText` updates only the focus cell, because one text editor owns one caret and `TextBody`. It validates the body with `validateTextBody`, clones accepted input, and throws `table cell body is invalid: ...` without changing history on invalid input.

`setTableCellFill` applies one cloned fill to every selected source cell. `null` removes the explicit fill so resolved table style can show through.

`setTableCellBorders` applies only supplied sides to every selected source cell. A border value sets that explicit side; `null` removes that side. Unmentioned sides stay unchanged. Empty border objects and commands that reproduce current values are no-ops.

Fill and border values are validated by applying the proposed changes to a cloned document and calling the existing document validator before commit. Invalid values throw a deterministic engine error and leave document, undo, and redo state unchanged.

## History and clone safety

All text, fill, and border changes use the existing patch-based `commit` path. One command creates at most one history entry even when it updates multiple cells. Undo and redo restore all cells atomically. No-op commands do not add history, and successful edits clear redo exactly like existing element commands.

Public command payloads and `EngineState` remain `structuredClone`-compatible. The engine never retains caller-owned `TextBody`, `Fill`, or `TableBorder` objects.

## Deferred work

- UnoCSS table overlays, cell selection painting, pointer hit-testing, and formatting controls;
- integration of the existing text editor controller with table-cell `TextBody`;
- row and column insertion, deletion, and resizing;
- merge and split commands;
- table style flag editing and complete PowerPoint theme/style inheritance;
- PPTX table export XML.
