# Stage 7 Table Style Semantics Design

## Context

The table core now has JSON-safe table elements, deterministic geometry, DrawingML table import, and SceneGraph cell text layout. The next slice gives tables a stable style semantic layer that can be reused by the editor and future PPTX export without coupling headless packages to Vue, DOM, Canvas, browser fonts, Element Plus, or UnoCSS runtime state.

## Goal

Represent table style references and region semantics in the document model, import custom `tableStyles.xml` definitions and table-level style flags, and resolve deterministic effective cell styles for SceneGraph consumers.

## Scope

- Add clone-safe table style definitions and table style references to `@ppt4ai/model`.
- Preserve explicit cell fill/border overrides while resolving style-derived defaults.
- Import `tableStyleId` and first/last row/column and banding flags from DrawingML `tblPr`.
- Import custom table styles from `ppt/tableStyles.xml` when present and resolve style region definitions by style ID.
- Support `wholeTable`, `band1H`, `band2H`, `band1V`, `band2V`, `firstRow`, `lastRow`, `firstCol`, and `lastCol` regions.
- Produce deterministic resolved fill/borders for table cells in `@ppt4ai/render`.
- Ignore unsupported or malformed style entries deterministically without failing otherwise readable presentation content.
- Keep raw XML preservation and structured cloning intact.

## Non-goals

- Table editing UI, selection, keyboard navigation, resize handles, merge/split commands, or UnoCSS component work.
- PPTX table export XML or byte-for-byte round trips.
- Theme color resolution, gradients, images, cell text mark inheritance, arbitrary XML extensions, or nested tables.
- Changes to existing shape/text inheritance behavior.

## Model Contract

Add these JSON-safe interfaces:

```ts
export type TableStyleRegionName =
  | 'wholeTable'
  | 'band1H'
  | 'band2H'
  | 'band1V'
  | 'band2V'
  | 'firstRow'
  | 'lastRow'
  | 'firstCol'
  | 'lastCol'

export interface TableStyleRegion {
  fill?: Fill
  borders?: TableCellBorders
}

export interface TableStyle {
  id: string
  regions?: Partial<Record<TableStyleRegionName, TableStyleRegion>>
}

export interface TableStyleReference {
  styleId?: string
  firstRow?: boolean
  lastRow?: boolean
  firstColumn?: boolean
  lastColumn?: boolean
  bandRow?: boolean
  bandColumn?: boolean
}
```

`TableElement.style` is optional and contains `TableStyleReference`. `Ppt4aiDocument.tableStyles` is an optional record keyed by style ID. `ElementDefaults` does not synthesize table internals; existing inheritance still only merges top-level element properties.

Validation requires style IDs to be non-empty strings, region keys to be known names, and region fill/borders to pass existing fill/border validation. Boolean style flags must be booleans. A table style reference may point to a missing style because importers can preserve a source reference while resolving it as no style.

## Resolution Contract

`@ppt4ai/model` exports:

```ts
export interface ResolvedTableCellStyle {
  fill?: Fill
  borders: TableCellBorders
}

export function resolveTableCellStyle(
  table: TableElement,
  cell: TableCell,
  row: number,
  column: number,
  tableStyles?: Record<string, TableStyle>,
): ResolvedTableCellStyle
```

Resolution starts with the referenced style's `wholeTable`, applies enabled region layers in deterministic order `band1H/band2H`, `band1V/band2V`, `firstRow`, `lastRow`, `firstCol`, `lastCol`, then applies explicit cell fill and border values. Later region values override only fields they define; border sides merge independently. Banding uses logical grid row/column indices and is disabled unless the corresponding reference flag is true. For a merged cell, `row` and `column` are its starting grid coordinates.

## Import Contract

The importer discovers `ppt/tableStyles.xml` directly from ZIP entries. It parses `a:tblStyleLst/a:tblStyle` IDs and region children (`a:wholeTbl`, `a:band1H`, etc.), importing direct solid fills and basic `lnL`, `lnR`, `lnT`, `lnB` borders. Unsupported child content is ignored. `tblPr` reads `tableStyleId`, `firstRow`, `lastRow`, `firstCol`, `lastCol`, `bandRow`, and `bandCol` attributes. The existing source XML map remains unchanged.

Malformed style XML or invalid color/width/style values yields no corresponding style/region, while table geometry and other slide elements continue importing. Style IDs are normalized only by trimming surrounding whitespace; duplicate IDs use first-definition-wins order.

## SceneGraph Contract

`SceneTableLayoutCell` gains `resolvedStyle: ResolvedTableCellStyle`. Existing `fill` and `borders` fields remain source cell values for compatibility. SceneGraph calls `resolveTableCellStyle` with document styles and cell grid coordinates, producing clone-safe deterministic output.

## Testing and Acceptance

- Model tests cover valid style references, clone safety, invalid region/flag paths, field-level resolution precedence, banding, and missing style fallback.
- Import tests cover custom style XML, table flags, region fill/borders, malformed style tolerance, duplicate IDs, and raw XML preservation.
- Render tests cover resolved style output for whole table, banding, edge regions, explicit cell overrides, and structured cloning.
- Focused tests pass before each task commit; boundary checks, full tests, typecheck, build, and `git diff --check` pass at slice completion.

## Decisions

- Keep style definitions in the model document rather than render-only state so editor and exporter can share the contract.
- Keep resolution pure and headless; the UI may map resolved colors and borders to UnoCSS or canvas rendering later.
- Preserve source cell properties and expose resolved values separately to avoid breaking existing consumers.
