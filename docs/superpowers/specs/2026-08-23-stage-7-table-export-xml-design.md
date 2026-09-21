# Stage 7 Table Export XML Design

## Goal

Add a deterministic, headless DrawingML serializer for the normalized `TableElement` model. This slice writes the table XML payload and does not claim to write a complete PPTX ZIP.

## Scope

- Export `TableElement` to one namespace-qualified `a:tbl` fragment.
- Preserve column widths, row heights, `rowSpan`, `colSpan`, cell text, fills, and the four outer cell-border sides.
- Emit `tblPr` table-style flags when the model has them.
- Serialize structured colors (`srgb`, `scheme`, `preset`, `system`, `scrgb`) and ordered transforms without resolving theme colors.
- Escape XML text and attributes deterministically.
- Never mutate the source model; output must be `structuredClone`-independent.

## Non-goals

- ZIP creation, relationship files, slide XML replacement, and preservation of unrelated source ZIP entries.
- Theme editing or concrete RGB resolution during export.
- Diagonal borders, effects, font/effect/format schemes, images, charts, and unsupported DrawingML extensions.

## API

`serializeTableXml(table: TableElement): string`

The result uses the `a` prefix and declares the DrawingML namespace on the root. XML child order is stable: `tblPr`, `tblGrid`, then rows and cells. A merged origin emits `gridSpan`/`rowSpan`; occupied continuation cells emit `hMerge="1"` or `vMerge="1"` according to the normalized model geometry.

## Determinism and safety

All model arrays are traversed in source order. Optional attributes are omitted rather than guessed. Structured color transforms retain their source order. Text and attribute values are XML-escaped. The serializer only reads the model and builds fresh strings.
