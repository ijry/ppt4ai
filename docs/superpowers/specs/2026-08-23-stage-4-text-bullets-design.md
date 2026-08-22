# Stage 4 Text Bullets and Numbering Design

## Context

Stage 4 already has a JSON-safe text model, paragraph layout with automatic wrapping and autofit, ProseMirror editing conversion, IME transactions, pointer selection, caret geometry, a text-box editor host, and character/paragraph formatting. The next slice adds semantic paragraph bullets and numbering without putting marker characters into the editable text.

## Scope

- Unordered character bullets with an optional bullet font family.
- Automatic numbering using Arabic digits, lower-case letters, or upper-case letters.
- Paragraph levels and existing indentation attributes remain the source of layout position.
- Deterministic marker geometry in headless text layout, including wrapped-line hanging alignment.
- ProseMirror paragraph-attribute conversion and headless list commands.
- Import of common DrawingML `buChar` and `buAutoNum` paragraph properties.
- Tests for validation, conversion, editing commands, numbering continuation/reset, wrapping, and autofit.

This slice excludes vertical text, tables, custom numbering formats, Roman numerals, arbitrary numbering templates, list IDs spanning non-adjacent paragraphs, Tab-based list shortcuts, theme-font resolution, and PPTX export XML. Export consumes the same semantic model in a later slice.

## Constraints

- Do not add Element Plus or any new runtime dependency.
- `@ppt4ai/text` remains headless and does not depend on Vue, DOM, Canvas, or editor UI code.
- Public model values, commands, layout output, snapshots, and event payloads remain safe for `structuredClone`.
- Marker glyphs are not inserted into `TextRun.text`; UTF-16 text positions and IME behavior therefore remain unchanged.
- Existing `level`, `indent`, and `marginLeft` values continue to control paragraph hierarchy and content position.
- The completed slice produces one implementation commit after all verification commands pass.

## Model Contract

Add a JSON-safe `TextBullet` union:

```ts
type TextBullet =
  | { type: 'char'; char: string; fontFamily?: string }
  | { type: 'autoNum'; scheme: 'arabic' | 'alphaLower' | 'alphaUpper'; startAt?: number }
```

Add `bullet?: TextBullet` to `TextParagraphAttrs`. The marker applies to the paragraph containing it; it is not a run mark and does not alter paragraph text. `char` must contain exactly one Unicode code point. `fontFamily`, when present, is a non-empty string. `startAt` must be a finite integer greater than zero. Paragraph `level`, when present, is a non-negative integer. Existing numeric indentation values retain their current finite-number and non-negative/positive constraints.

The validator reports deterministic paths such as `paragraphs[0].attrs.bullet.char` and rejects unknown bullet types, invalid schemes, empty characters, invalid numbering starts, and non-object bullet values. A valid body remains clone-safe.

## ProseMirror Conversion and Commands

Add a nullable `bullet` paragraph attribute to `textEditorSchema`. `textBodyToProseMirror` deep-clones the validated bullet value and `proseMirrorToTextBody` restores it while preserving all unrelated paragraph attributes. Conversion must not synthesize marker text or change document positions.

Add headless commands for setting and clearing paragraph bullets across the paragraphs intersecting the current selection. A collapsed selection targets its current paragraph. Commands preserve selection direction and all other paragraph attributes. A bullet patch is validated before dispatch; invalid input leaves the editor state unchanged. The command API supports:

- `setTextBullet(state, bullet)` for a shared bullet value.
- `clearTextBullet(state)` for removing bullets from the targeted paragraphs.

The command does not attempt to infer or mutate `level`, `indent`, or `marginLeft`. UI controls may choose a level separately in a later slice.

## Numbering Semantics

For `autoNum`, adjacent paragraphs at the same `level` with the same numbering scheme and no intervening non-numbered paragraph continue from the previous marker. A paragraph with `startAt` explicitly starts at that value. A non-list paragraph, a level change, a scheme change, or a character bullet resets the sequence for the following numbered paragraph. Nested levels maintain independent sequences. The default first value is 1.

Arabic markers render as `1`, `2`, and so on. Lower- and upper-case alphabetic markers render as `a`, `b` and `A`, `B`; values after `z`/`Z` use spreadsheet-style sequences (`aa`, `ab`/`AA`, `AB`). Values are never silently clamped; invalid starts fail model validation and commands.

## Layout Contract

Extend `TextLayoutLine` with an optional marker:

```ts
interface TextLayoutMarker {
  text: string
  x: number
  width: number
  marks?: TextMarks
}
```

`TextLayoutLine.marker` is present only on the first visual line generated for a bulleted paragraph. Marker x/width are expressed in the same EMU-like coordinate system as line runs. Marker text uses the bullet font when provided, otherwise the paragraph's first run font, and uses the paragraph's effective font size and current autofit scale. Auto-number marker text includes a trailing space for visual separation; character bullets use the configured character followed by the same separator.

The paragraph's content box is reduced by the marker/hanging-indent width. All wrapped lines use the same content x, so continuation lines align with the first line's text rather than with the marker. Existing left/center/right alignment is applied to the content box; the marker remains in the paragraph's hanging area. Marker width is included in `contentBounds` and overflow calculations but never in the source text length.

Empty bulleted paragraphs still produce a marker-only line. A zero-width or unavailable marker measurement uses the deterministic fallback measurement already used by text layout. `none`, `shrink`, and `resize` autofit apply to marker and body together; shrink scales both, and resize reports overflow using the complete paragraph line height.

## PPTX Import

When a paragraph contains `a:pPr/a:buChar`, import its `char` and optional `a:buChar/a:rPr` typeface into `bullet.type = 'char'`. When it contains `a:buAutoNum`, map `arabicPeriod` and equivalent Arabic decimal schemes to `arabic`, `alphaLcParenRight`/`alphaLcPeriod` to `alphaLower`, and their upper-case variants to `alphaUpper`. Read `startAt` when present. Unsupported schemes fall back to `arabic` while preserving the paragraph as a list; malformed marker values are omitted rather than inserted into text.

The importer keeps its existing legacy `text` fallback for shapes that do not expose a structured body. Structured paragraph parsing must preserve run text and existing marks while adding bullet attributes. Layout/master inherited text remains JSON-safe.

## Testing

- Model tests cover valid bullet variants, structured cloning, invalid paths, one-code-point character validation, and numbering starts.
- ProseMirror model tests cover bullet round trips, preservation of unrelated attributes, and no marker text in the document.
- Editor command tests cover shared selection targets, collapsed selections, reverse selections, clear operations, invalid inputs, and unchanged state on failure.
- Layout tests cover character markers, Arabic/alphabetic continuation and reset, nested levels, wrapped continuation alignment, marker-only empty paragraphs, alignment, and all autofit modes.
- PPTX importer tests cover `buChar`, supported `buAutoNum` schemes, `startAt`, and unsupported-scheme fallback.
- Run `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check` before the implementation commit.

## Acceptance

- Bullet and numbering semantics survive model validation and ProseMirror round trips without changing editable text positions.
- Consecutive numbering is deterministic across levels, styles, explicit starts, and reset boundaries.
- Marker geometry is clone-safe, deterministic, and correctly aligns wrapped lines and autofit output.
- Imported common PPTX bullets render as semantic markers instead of text prefixes.
- No Element Plus or new runtime dependency is introduced, and all repository verification commands pass.
