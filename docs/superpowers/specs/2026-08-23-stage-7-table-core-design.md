# Stage 7 Table Core Design

## Context

The document model already supports JSON-safe shapes, text bodies, deterministic text layout, SceneGraph generation, and minimal DrawingML import. The next planned area is table support. This slice establishes the table contract and deterministic import/layout foundation without coupling the headless packages to Vue, DOM, Canvas, Element Plus, or a browser font implementation.

## Scope

- Add a JSON-safe `TableElement` to the document model.
- Represent explicit row heights, column widths, cell positions, spans, cell fills, borders, and structured `TextBody` content.
- Validate positive dimensions, integer positions/spans, bounds, and overlapping merged regions with deterministic path errors.
- Normalize a table into a rectangular occupied grid and calculate deterministic EMU cell bounds.
- Preserve the required border edge order `L→R→T→B` when producing table layout output.
- Import DrawingML `a:tbl` from slide shapes, including grid columns, rows, cells, spans, text, fills, and basic borders.
- Expose table nodes through the existing render SceneGraph boundary.
- Preserve raw XML source entries and `structuredClone` safety.

## Non-goals

This slice does not implement:

- Full `tableStyles.xml` inheritance, banding, first/last row or column style semantics.
- Table editing UI, cell selection, keyboard navigation, resize handles, or merge/split commands.
- PPTX export XML or byte-for-byte table round trips.
- Images, charts, SmartArt, or unrelated importer refactors.
- Arbitrary nested tables or unsupported DrawingML effects.

## Constraints

- Do not add Element Plus or any new runtime dependency; editor UI remains UnoCSS-only.
- `@ppt4ai/model`, `@ppt4ai/layout`, `@ppt4ai/render`, and `@ppt4ai/pptx-import` remain JSON-safe at their public boundaries.
- `@ppt4ai/layout` stays headless and uses EMU values only; it must not read DOM, Canvas, browser fonts, or Vue state.
- Existing shape and text model/layout/SceneGraph output remains unchanged.
- A malformed or unsupported table fragment is ignored or downgraded deterministically; it must not make an otherwise readable PPTX fail to import.
- Marker glyphs, merge metadata, and XML-only bookkeeping never enter cell text.
- Every completed task has focused tests and its own git commit.

## Model Contract

The model adds the following clone-safe value types:

```ts
export interface TableBorder {
  color: Color
  width?: number
  style?: 'solid' | 'dash' | 'dot' | 'none'
}

export interface TableCellBorders {
  left?: TableBorder
  right?: TableBorder
  top?: TableBorder
  bottom?: TableBorder
}

export interface TableCell {
  column: number
  rowSpan?: number
  colSpan?: number
  body: TextBody
  fill?: Fill
  borders?: TableCellBorders
}

export interface TableRow {
  height: number
  cells: TableCell[]
}

export interface TableElement {
  id: string
  kind: 'table'
  bounds: Rect
  columns: number[]
  rows: TableRow[]
  fill?: Fill
  stroke?: Fill
  placeholder?: string
}
```

`column` is the zero-based starting grid column for a cell. Omitted `rowSpan` and `colSpan` mean `1`. A cell body is always present after normalization and contains at least one paragraph; an empty cell uses a paragraph with zero runs. The model does not retain `hMerge` or `vMerge` flags because those are importer syntax, not document semantics.

Validation rules:

- `columns` and `rows` are non-empty arrays.
- Every column width and row height is finite and positive.
- Cell `column`, `rowSpan`, and `colSpan` are positive integers where applicable; `column` is zero-based and may not exceed the final grid.
- Each cell rectangle stays within the row/column grid after spans are applied.
- Occupied rectangles may not overlap, including overlaps caused by row spans.
- Every body is validated by the existing `validateTextBody` rules.
- Invalid values report stable paths such as `elements.tbl_1.rows[1].cells[0].column` and `elements.tbl_1.rows[1].cells[0] overlaps another cell`.

`Element` becomes `ShapeElement | TextElement | TableElement`. Inherited defaults do not synthesize table rows or cells; table elements resolve only shared element properties already supported by the model.

## Table Layout Contract

`@ppt4ai/layout` exports a pure function:

```ts
export interface TableLayoutCell {
  row: number
  column: number
  rowSpan: number
  colSpan: number
  bounds: Rect
  body: TextBody
  fill?: Fill
  borders: TableCellBorders
}

export interface TableLayout {
  bounds: Rect
  columns: number[]
  rows: number[]
  cells: TableLayoutCell[]
  borders: Array<{ side: 'left' | 'right' | 'top' | 'bottom'; from: number; to: number; border: TableBorder }>
}

export function layoutTable(element: TableElement): TableLayout
```

The function uses the element bounds only as the table origin and sums the model's EMU column widths and row heights. A cell's bounds are the union of its spanned columns and rows. Layout cells are returned in row-major document order. Border output is emitted per cell in `left`, `right`, `top`, `bottom` order, then sorted stably by row, column, and side; duplicate shared edges are retained as source edges so a later style resolver can decide precedence.

The layout layer does not lay out cell text yet. It passes each cell's normalized `TextBody` through unchanged for the existing text/layout integration to consume in a later slice. Empty rows/cells remain addressable in the output.

## PPTX Import

The importer recognizes `a:tbl` descendants of slide shapes and creates one `TableElement` with the enclosing shape transform as `bounds`.

- `a:tblGrid/a:gridCol/@w` becomes `columns` in source order.
- Each `a:tr/@h` becomes a row height; malformed or missing dimensions use a deterministic positive fallback derived from the table height and row count.
- `a:tc` cells are assigned the next unoccupied grid column in the current row.
- `a:tc/@gridSpan` becomes `colSpan`; `a:tc/@rowSpan` becomes `rowSpan` when positive.
- `a:tcPr/a:hMerge` and `a:tcPr/a:vMerge` are resolved into the normalized occupied grid. Continuation cells are not duplicated in the model.
- `a:txBody` is converted to the existing structured `TextBody`; empty cells receive one empty paragraph.
- `a:solidFill` maps to cell `fill`; `a:lnL`, `a:lnR`, `a:lnT`, and `a:lnB` map to basic cell borders when their width/color is valid.
- Unsupported style references, effects, and malformed optional attributes are ignored without discarding valid neighboring cells.

The importer continues to keep the slide XML in `source.entries`. A table with no valid grid or no valid rows is skipped as an element rather than producing an invalid document.

## SceneGraph Contract

`@ppt4ai/render` adds:

```ts
export interface SceneTableNode {
  id: string
  kind: 'table'
  bounds: Rect
  layout: TableLayout
  fill?: Fill
  stroke?: Fill
}
```

`SceneNode` includes `SceneTableNode`. `documentToSceneGraph` preserves slide order and creates a table node through `layoutTable`; existing shape/text nodes remain byte-for-byte compatible. The node contains only structured-clone-safe values.

## Data Flow

1. `@ppt4ai/model` validates the table element and its cell bodies.
2. `@ppt4ai/pptx-import` parses DrawingML table syntax into normalized model spans and preserves XML source.
3. `@ppt4ai/layout` converts model rows/columns/spans into deterministic cell and border geometry.
4. `@ppt4ai/render` exposes the layout as a SceneGraph table node.
5. Future editor and exporter slices consume the same normalized table contract without re-parsing merge flags.

## Testing

- Model tests cover valid tables, empty cell bodies, invalid dimensions, out-of-range spans, row-span overlap, border validation, and `structuredClone`.
- Layout tests cover origin offsets, cumulative EMU bounds, row-major cell order, merged cell bounds, empty rows, and exact `L→R→T→B` border ordering.
- Import tests cover a minimal table fixture, grid widths, row heights, text, fills, borders, `gridSpan`, `rowSpan`, `hMerge`, `vMerge`, malformed optional values, missing table parts, and source/clone safety.
- SceneGraph tests cover table node creation and compatibility of existing node kinds.
- Focused tests run after each task; final verification runs `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.

## Follow-up

The next table slice can add style resolution from `tableStyles.xml`, richer line/fill semantics, text layout inside cell insets, and table editor interactions. PPTX export remains a separate phase after the normalized model and importer have stable coverage.
