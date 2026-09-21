# Stage 7 Table Structure Editing Design

> Date: 2026-08-23
>
> Scope: insert and delete table rows and columns. Merge/split commands, structure UI, full theme inheritance, and PPTX export XML remain later slices.

## Goal

Add undoable, atomic row and column structure commands to the headless `@ppt4ai/engine`, while keeping the existing table-cell selection useful after structure changes. The implementation uses only JSON-safe `@ppt4ai/model` contracts and introduces no Vue, DOM, Canvas, or browser globals.

## API and transaction model

The engine exposes four commands:

```ts
type EngineCommand =
  | { type: 'insertTableRow'; elementId: string; index: number; count?: number }
  | { type: 'deleteTableRow'; elementId: string; index: number; count?: number }
  | { type: 'insertTableColumn'; elementId: string; index: number; count?: number }
  | { type: 'deleteTableColumn'; elementId: string; index: number; count?: number }
```

`count` defaults to 1 and must be positive. `index` must be an integer in the valid insertion or deletion range. Invalid arguments, missing elements, non-table elements, and deletions that would leave an empty table throw stable errors containing the element ID. A structure command can run without a valid cell selection; ordinary element selection remains unchanged.

Each command constructs a complete next `TableElement` in memory, validates it with the existing document validator, and changes `elements[elementId]` with one patch. One dispatch therefore creates one history entry, and undo/redo restores the complete table and revalidates selection.

## Grid transformations

### Insert rows

- Insert `count` rows at `index`.
- Copy the row height at the insertion point; for an append, copy the last row height.
- Source cells whose source row is at or after the insertion point move with the row array.
- A source cell covering the insertion point expands `rowSpan` by `count`, preserving its original covered content.
- For each newly inserted row, create empty source cells for grid positions not covered by an existing rowspan. New cells use `{ paragraphs: [{ runs: [] }] }` and have no explicit fill or borders.

### Delete rows

- Delete `[index, index + count)`, but never all rows.
- Source rows before the range keep their positions; later source rows move with the row array.
- A source cell intersecting the deleted range shrinks `rowSpan` to preserve its remaining contiguous coverage.
- If the source cell itself is in the deleted range and part of its covered area remains, move its body, fill, borders, and remaining span to the first surviving row in that area. If the entire source area is deleted, the source cell is deleted with it.
- Rebuild source cells by scanning the resulting grid so columns, spans, non-overlap, and bounds remain valid.

### Insert columns

- Insert `count` column widths at `index`.
- Copy the width at the insertion point; for an append, copy the last column width.
- Source cells with `column >= index` shift right by `count`.
- A source cell covering the insertion point expands `colSpan` by `count`.
- In each row, create empty source cells for newly inserted positions not covered by an existing rowspan or colspan. New cells contain only a valid empty body.

### Delete columns

- Delete `[index, index + count)`, but never all columns.
- Source cells after the range shift left by `count`; earlier cells remain in place.
- A source cell intersecting the range shrinks `colSpan` to preserve its remaining coverage.
- If the source cell starts in the deleted range and part of its area remains, move the remaining source to the first surviving column from left to right.
- Rebuild each row's source-cell list by scanning the resulting grid, keeping columns ordered and merged cells valid.

Row and column changes also update `bounds.w` or `bounds.h` so the table frame remains equal to the sum of column widths or row heights. Existing dimensions are not redistributed.

## Selection migration

Map `tableCellSelection` anchor and focus through the grid transformation, then normalize each endpoint through the existing `sourceCellAt` helper:

- Coordinates at or after an insertion point shift right or down; an endpoint inside a merged cell that crosses the insertion point continues to identify that source cell.
- Coordinates after a deletion range subtract the deleted count; coordinates inside the deleted range clamp to the nearest surviving grid boundary.
- If the table or either endpoint is invalid after mapping, clear the table-cell selection.
- Ordinary `selection` retains the table element ID.

## Validation and errors

- `index` and `count` must be finite integers; `count >= 1`.
- Row insertion indexes are `0..rowCount`; column insertion indexes are `0..columnCount`.
- Delete ranges must be within the current range and leave at least one row and one column.
- Validate every transformed table with `validateDocument`; validation failure leaves the document and history unchanged.
- Existing body, fill, and borders remain unchanged except when a source cell must migrate because its source row or column was deleted. New cells have no explicit style.

## Testing strategy

Engine tests cover:

1. Insert position, copied dimensions, empty cells, merged spans crossing insertion points, and bounds.
2. Delete reordering, span shrinking, source content/style migration, and minimum-table rejection.
3. Invalid arguments, non-table elements, and no-side-effect validation failures.
4. Cell-selection migration, clamping, and merged-cell normalization after each structure operation.
5. One-command undo/redo restoring the document, history depth, and selection.

This slice adds no structure-editing UI; later controller and toolbar slices will consume the engine commands.
