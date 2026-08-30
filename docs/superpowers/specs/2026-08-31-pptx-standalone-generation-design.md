# Standalone PPTX Generation Design

> **Status**: approved for implementation
>
> **Date**: 2026-08-31

## Goal

Generate a deterministic, standards-shaped PPTX package from a `Ppt4aiDocument` that has no source ZIP, while keeping the existing source-preserving write-back API unchanged.

## Scope

Add a second headless export path:

```ts
export interface CreatePptxOptions {
  assetAdapter?: AssetAdapter
}

export async function createPptx(
  document: Ppt4aiDocument,
  options?: CreatePptxOptions,
): Promise<Uint8Array>
```

`createPptx` is exported from `@ppt4ai/pptx-export`. `exportPptx(document, source, options?)` remains the source-package write-back entry point and keeps its current signature and behavior.

The first standalone slice writes the model kinds already supported by the editor's basic document flow: `shape`, `text`, `table`, and `image`. It emits one generated theme, one blank slide master, and one blank slide layout shared by every generated slide. The generated package is intended to be imported again by `importPptx` and opened by common OOXML readers.

## Design Decisions

### Separate API and package ownership

The two export paths have different preservation guarantees. `exportPptx` starts from source ZIP entries and preserves parts it does not own; `createPptx` owns every generated XML part and has no source bytes to preserve. Keeping separate functions makes those guarantees visible to callers and prevents an optional `source` argument from hiding a materially different failure mode.

`createPptx` does not inspect or mutate `document.source`. It reads model data and, for images, calls only `AssetAdapter.get`. It never calls `put`.

### Determinism

For the same document and asset bytes, repeated calls produce byte-identical output:

- ZIP entries use the existing stored ZIP writer and a fixed entry order.
- XML uses UTF-8, fixed namespace declarations, stable attribute ordering, and no runtime timestamps.
- Slides follow `document.slideOrder`.
- Elements follow each slide's `elementIds`.
- Generated slide IDs are `256`, `257`, ... in slide order.
- Presentation slide relationships are `rId3`, `rId4`, ... after the master and theme relationships.
- Each slide uses `rId1` for its layout relationship and `rId2`, `rId3`, ... for distinct image assets in first-use order.
- Shape `cNvPr` IDs start at `2` on each slide; `1` is reserved for the group root.
- Media parts are `ppt/media/image1.<ext>`, `image2.<ext>`, ... in first asset use across the complete slide order. Repeated asset IDs share one media part, including occurrences on different slides.

The adapter is read at most once per asset ID. The returned bytes are copied before they are placed into the ZIP, so later adapter mutation cannot alter the generated package.

### Generated package topology

The entry order is fixed. Entries marked conditional are emitted only when their condition is true.

```text
[Content_Types].xml
_rels/.rels
docProps/core.xml
docProps/app.xml
ppt/presentation.xml
ppt/_rels/presentation.xml.rels
ppt/presProps.xml
ppt/viewProps.xml
ppt/theme/theme1.xml
ppt/slideMasters/slideMaster1.xml
ppt/slideMasters/_rels/slideMaster1.xml.rels
ppt/slideLayouts/slideLayout1.xml
ppt/slideLayouts/_rels/slideLayout1.xml.rels
ppt/slides/slideN.xml
ppt/slides/_rels/slideN.xml.rels
ppt/media/imageN.<ext>       (conditional)
```

`[Content_Types].xml` contains explicit overrides for presentation, core/app properties, presProps, viewProps, theme, master, layout, and every slide. It contains image defaults only for extensions used by the document. `_rels/.rels` points to `ppt/presentation.xml`. Presentation relationships point to the generated master, theme, and slides. The presentation contains the page size, one `p:sldMasterId`, and a `p:sldIdLst` in document order.

The generated master references the generated theme and layout. The generated layout references the generated master. Every slide references the generated layout, regardless of an optional model `layoutId` or `masterId`; custom layout/master defaults are not serialized in this slice. The XML uses the standard PresentationML, DrawingML, Relationships, Content Types, and Core Properties namespaces. Static core/app properties use fixed values and contain no current time.

The theme is a fixed Office-compatible theme with a complete basic color scheme and Latin/east-Asian/complex-script font slots. Model theme inheritance is not resolved into this generated theme in this slice; model colors are serialized as explicit colors wherever a shape, text run, table, or image needs a visual property.

### Shape and text serialization

Each top-level `shape` or `text` becomes a `p:sp` in slide element order. Each shape contains `p:nvSpPr`, `p:spPr`, and, for text, `p:txBody`. Bounds map directly to `a:xfrm/a:off` and `a:xfrm/a:ext` in EMU. Preset geometry maps to `a:prstGeom`; `rect` is the fallback for text. Fill and stroke map to `a:solidFill` and `a:ln` with deterministic child order. Placeholder type, when present, maps to `p:ph/@type`.

Text serialization covers the existing JSON-safe text contract:

- body insets, horizontal/vertical mode, wrapping, vertical anchor, and `none`/`shrink`/`resize` autofit map to `a:bodyPr` attributes and child autofit elements;
- paragraph alignment, level, left margin, indent, line spacing, and paragraph spacing map to `a:pPr`;
- character bullets map to `a:buChar`; Arabic and lower/upper alpha numbering map to the corresponding `a:buAutoNum` type;
- runs preserve text, font family, size, bold, italic, underline, baseline, and explicit fill color;
- XML text is escaped and preserves leading/trailing spaces with `xml:space="preserve"`;
- a newline inside a run splits the run into text fragments and `a:br` sibling nodes under `a:p`, preserving the surrounding run order.

Empty text bodies still contain one empty `a:p`, because a text shape without a paragraph is not reliably accepted by all readers.

### Table serialization

Each `table` becomes a `p:graphicFrame` with its bounds and a table `a:graphicData` payload. The payload is produced by the existing pure `serializeTableXml` function, so grid widths, row heights, spans, merges, cell fills, borders, text bodies, and basic table flags use one canonical serializer.

Custom `document.tableStyles` definitions and full theme-based table style inheritance are outside this slice. A table's existing style reference is serialized in `a:tblPr`; the standalone package does not claim to materialize custom style definitions.

### Image serialization and assets

Each `image` becomes a `p:pic` using the existing `serializePictureXml` function. The image's slide relationship targets the shared media part with a relative `../media/...` target. Crop, mask, rotation, flips, and supported effects use the existing image serializer.

Before ZIP construction, the generator walks image elements in deterministic order, validates each referenced `AssetMetadata`, reads its bytes once through `assetAdapter.get`, verifies the shared bitmap MIME parser agrees with metadata, and assigns its media path. A document containing an image without an adapter, metadata, or matching bytes is rejected before returning output. Unsupported image MIME types use the existing stable error prefix.

### Unsupported structures

The generator rejects a `group` element with `PPTX generation unsupported element kind: group`. There is no silent flattening because flattening changes z-order and group coordinate semantics. Charts, animations, notes, hyperlinks, custom master/layout content, and advanced effects are not represented by the current model and are not generated by this slice.

## Validation and errors

`createPptx` calls `validateDocument` before reading any asset. Invalid documents reject with:

```text
PPTX generation document invalid: <path> <message>
```

The generator additionally rejects a missing slide in `slideOrder`, an unsupported element kind, an image asset lookup/metadata/MIME failure, and a malformed internal serialization result. Errors use the `PPTX generation ...` prefix and identify the slide or asset. No output bytes are returned after an error, and the input document is unchanged.

## File boundaries

The implementation stays inside `packages/pptx-export`:

- `src/standalone.ts` owns the public `createPptx` flow, deterministic ID allocation, asset materialization, and package assembly.
- `src/standalone-xml.ts` owns generated presentation, relationship, theme, master, layout, slide, shape, text, and property XML serializers.
- `src/index.ts` exports the new function and option type without changing existing exports.
- `src/standalone.test.ts` covers package topology, shape/text/table/image output, re-import behavior, deterministic output, adapter read deduplication, clone safety, and stable rejection cases.

Small shared XML or asset helpers may be extracted only when both standalone and existing write-back paths use the same exact serialization contract. Existing source write-back behavior remains covered by its current tests.

## Verification

Focused tests must:

1. Create a minimal document with one shape and one text element, generate it twice, assert byte equality, assert all required structural entries, and re-import it.
2. Add a table and assert the re-imported grid, text, and merge fields match the source model.
3. Add repeated PNG/JPEG assets, assert one adapter read and one media part per asset ID, inspect each slide relationship, and verify re-imported image metadata.
4. Assert a missing adapter, missing metadata, MIME mismatch, group element, invalid slide mapping, and unsupported XML control characters reject with the specified prefix without mutating the document or adapter-owned bytes.
5. Run package typecheck/build, the focused importer/model/export tests, full workspace tests, boundary checks, recursive typecheck, serial build, the Element Plus scan, and `git diff --check`.

PowerPoint/LibreOffice manual-open validation remains a separate follow-up because the repository cannot automate reader repair dialogs.

## Non-goals

- Changing or overloading `exportPptx(document, source, options?)`.
- Preserving source ZIP bytes or unknown source parts; there is no source package.
- Cloning dependent parts, custom masters/layouts, notes, comments, charts, animations, transitions, hyperlinks, or fonts.
- Group serialization, chart serialization, or arbitrary XML passthrough.
- Adding Vue, DOM, Canvas, Element Plus, runtime CSS, or a new runtime dependency.
