# Stage 4 Basic Vertical Text Design

## Context

Stage 4 already has a JSON-safe text body model, deterministic headless layout, ProseMirror conversion and editing transactions, caret and selection mapping, pointer hit-testing, paragraph formatting, bullets, numbering, and structured PPTX text import. This slice adds a basic body-level vertical writing mode while preserving the existing horizontal default and the headless package boundary.

## Scope

- Add `bodyPr.vertical?: 'horizontal' | 'vertical'`; omitted means horizontal.
- Lay out vertical text in columns that progress from right to left.
- Keep CJK and full-width characters upright. Render Latin, digits, and punctuation as single-character cells with a deterministic quarter-turn orientation represented by layout metadata.
- Support automatic wrapping, explicit paragraph breaks, empty paragraphs, alignment, indentation, paragraph spacing, bullets, numbering, vertical alignment, and existing `none` / `shrink` / `resize` autofit semantics in vertical mode.
- Provide caret, selection rectangles, and point-to-position hit-testing for vertical columns.
- Import DrawingML `a:bodyPr/@vert` values into the structured text body.

This slice excludes arbitrary text rotation, per-run writing modes, complex font shaping, ruby, vertical punctuation substitution, tables, and PPTX export XML.

## Constraints

- Do not add Element Plus or any new runtime dependency; UI styling continues to rely on UnoCSS.
- `@ppt4ai/text` remains headless and cannot depend on Vue, DOM, Canvas, browser font measurement, or editor UI code.
- Public model values, layout output, commands, snapshots, and importer results remain safe for `structuredClone`.
- Existing horizontal layout output must remain byte-for-byte compatible for horizontal bodies.
- Text content and UTF-16 ProseMirror positions remain unchanged; orientation is layout metadata, never marker text or run text.
- Vertical columns use the existing deterministic `measureText` values. A cell's advance is the measured character width and the column advance is the measured line height, so geometry stays reproducible without system fonts.

## Model Contract

Extend `TextBodyProperties` with:

```ts
vertical?: 'horizontal' | 'vertical'
```

The validator accepts only these two values and reports `bodyPr.vertical must be horizontal or vertical` for any other value. Omission is equivalent to `horizontal`. Existing body, paragraph, run, bullet, indentation, autofit, and clone-safety rules remain unchanged.

## Layout Contract

Horizontal `TextLayout` output remains unchanged. In vertical mode, `TextLayout` includes `vertical: 'vertical'`, and each `TextLayoutLine` represents one visual column:

```ts
interface TextLayoutRun {
  text: string
  x: number
  y: number
  width: number
  height: number
  orientation: 'upright' | 'rotated'
  marks?: TextMarks
}

interface TextLayoutMarker {
  text: string
  x: number
  y: number
  width: number
  height: number
  orientation: 'upright' | 'rotated'
  marks?: TextMarks
}
```

These additional run and marker fields exist only in vertical output. A vertical column's `x` is its left edge, `width` is its column advance, `y` is its top edge, and `height` is its occupied cell extent. A vertical run or marker's `x`/`y`/`width`/`height` is its cell bounding box; `orientation` is `upright` for CJK/full-width characters and `rotated` for Latin, digits, and punctuation. Columns start at the right content edge and move left by column advance. Within a column, characters run top to bottom.

Paragraphs consume columns in document order. A paragraph wraps into as many columns as needed to fit the available content height. A hard paragraph break starts the next paragraph at the next column. An empty paragraph produces one empty column with the paragraph's line advance. Latin, digits, and punctuation each occupy one cell and are marked `rotated`; CJK and full-width characters are marked `upright`. Runs retain their original marks and text grouping as far as the cell model permits.

Horizontal paragraph alignment maps to the cross-axis: left aligns cells at the top content edge, center centers them, and right aligns them at the bottom edge. `marginLeft` and `indent` consume cross-axis space; bullet markers occupy a leading cell area in the same column and appear only on the first visual column of their paragraph. Numbering continuation and marker generation reuse the existing paragraph semantics.

`verticalAlign` maps to the column axis: top, middle, and bottom offset the complete column sequence inside the available height. `wrap: 'none'` keeps one column per paragraph and marks overflow when its content exceeds the available height. `shrink` scales cell advances and text metrics until columns fit; `resize` expands the width required by the column sequence, subject to `maxHeight` remaining a cap on the text flow height. The implementation must keep overflow and `contentBounds` deterministic.

## Position Mapping Contract

`mapTextPosition` returns a one-pixel caret at a vertical boundary: caret height is the cell advance on the cross-axis and caret width is one pixel on the flow axis. `mapTextSelection` returns rectangles spanning selected cells within each column, with rectangles ordered by document order. `textPositionAtPoint` first chooses the nearest column, then the nearest cell boundary from top to bottom, clamping to the document's valid UTF-16 positions. Empty paragraphs and positions at column edges remain selectable. Horizontal mapping behavior is unchanged.

## PPTX Import

`parseTextBody` reads the nearest `a:bodyPr` under the text body and maps its `vert` attribute as follows:

| `vert` value | Model value |
|---|---|
| `vert270`, `vert`, `wordArtVert` | `vertical` |
| `horz`, `eaVert`, `mongolianVert`, missing | `horizontal` / omitted |

Unknown or malformed values are ignored rather than causing import failure. The importer continues to preserve legacy `TextElement.text`, structured paragraphs, bullets, and all existing shape metadata.

## Components and Data Flow

1. `@ppt4ai/model` validates and exposes the writing-mode contract.
2. `@ppt4ai/text` normalizes the body, selects horizontal or vertical layout, and emits JSON-safe column/cell geometry.
3. `@ppt4ai/text` position mapping consumes the same layout metadata for caret, selection, and hit-testing.
4. `@ppt4ai/render` consumes the layout without adding browser dependencies; vertical orientation is represented by layout data for the existing renderer boundary.
5. `@ppt4ai/pptx-import` maps `bodyPr/@vert` while retaining the structured body and legacy fallback.

## Testing

- Model tests cover accepted values, default normalization at layout time, rejected values, and `structuredClone`.
- Text layout tests cover upright/rotated cell metadata, right-to-left columns, wrapping, hard breaks, empty paragraphs, alignment, bullets/numbering, vertical alignment, and autofit.
- Position tests cover caret boundaries, multi-column selection, nearest-column hit-testing, empty paragraphs, and UTF-16 positions.
- Import tests cover every supported `vert` mapping, omitted/unknown values, and preservation of structured text and legacy text.
- Run focused tests after each task, then `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.

## Non-goals and Follow-up

Per-run writing mode, true OpenType vertical glyph shaping, vertical punctuation substitutions, arbitrary rotation, table layout, and PPTX export XML require separate design slices. This implementation exposes enough deterministic metadata for a later renderer/UI slice to draw rotated cells without changing the document model.
