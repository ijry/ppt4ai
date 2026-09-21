# Stage 7 PPTX Image Writeback Design

> Status: Approved for implementation
> Date: 2026-08-23

## Goal

Write imported, inserted, and replaced image elements back into a source PPTX
package while preserving unrelated package entries and the existing headless
asset-storage boundary.

## Public API

Keep the existing call valid:

```ts
exportPptx(document: Ppt4aiDocument, source: Uint8Array): Promise<Uint8Array>
```

Add an optional third argument for assets that are not already present in the
source package:

```ts
export interface ExportPptxOptions {
  assetAdapter?: AssetAdapter
}

exportPptx(
  document: Ppt4aiDocument,
  source: Uint8Array,
  options?: ExportPptxOptions,
): Promise<Uint8Array>
```

The exporter reads bytes with `assetAdapter.get(assetId)` only when a document
image does not resolve to an existing source media part. It never mutates the
document, source bytes, or adapter storage.

## Package Strategy

The source ZIP is decoded into the existing `ZipEntry[]` representation and
written back with the existing stored ZIP writer. Entry order and unrelated
XML/binary data remain unchanged. Existing source media and relationships are
not removed, even when an edit makes them unused.

For each source slide, the exporter scans importable slide elements in the
same order as the importer: bounded `p:sp`, importable table `p:graphicFrame`,
and `p:pic`. The document's existing element IDs must match this source prefix
in order. New elements are supported only as trailing image elements appended
by the engine. Deletions, reordering, or inserting an element before a source
element fail with a deterministic mapping error.

An existing image keeps its `p:pic` XML and appearance fields. If its current
asset ID resolves to another media part, only the `r:embed` value is replaced
and a relationship to the new media part is added. Unchanged source images
reuse their existing relationship and media bytes.

Trailing inserted images receive generated `p:pic` XML using their EMU bounds,
optional transform/crop/mask/effect fields, and a relationship in the slide
relationship part. The generated picture uses the existing `p`, `a`, and `r`
prefixes used by ordinary OOXML slides.

## Media and Relationships

The exporter derives a source asset ID from an image relationship target using
the same stable path normalization as the importer. This allows imported
assets to reuse their existing media without reading the adapter. New media
uses `imageN.<extension>`, where `N` is the first positive integer not already
used in the package and extension is determined by the asset MIME type:
`png`, `jpg`, `gif`, `bmp`, or `webp`. The chosen target is reused for every
image element sharing the same newly written asset ID.

Each slide relationship part gets a new `rIdN` with the first positive integer
not already used in that part. Existing relationships and their formatting are
preserved; new `<Relationship>` entries are appended before the closing root
tag. If a slide has no relationship part, one is created at the standard
`<slide-directory>/_rels/<slide-name>.rels` path with the OOXML relationships
namespace.

If adapter bytes are missing, the MIME is unsupported, the source relationship
is malformed, or a generated target/relationship would collide, export rejects
without returning a package. No partial output is exposed to callers.

## XML and Appearance

Existing image appearance XML is preserved byte-for-byte except for the
relationship attribute. New pictures serialize:

- `a:xfrm` offset/extent from `bounds`, rotation in OOXML 1/60000 degree units,
  and valid flip attributes;
- `a:srcRect` crop percentages;
- preset geometry for the supported image masks;
- `a:alphaModFix` and `a:grayscl` in source order;
- a stretch fill and valid non-empty picture property tree.

XML attribute and text values are escaped with the existing exporter helpers.

## Errors and Compatibility

The current table writeback behavior remains unchanged. Slides containing
images are included in the shared element mapping instead of being rejected as
count mismatches. Non-image source elements may not be replaced by image
elements, and non-image trailing additions are rejected. The source document
model remains JSON-safe and `structuredClone`-safe because bytes stay in the
adapter or source ZIP.

## Verification

Focused tests cover unchanged image preservation, image replacement, trailing
image insertion, shared new media deduplication, deterministic media and
relationship naming, missing adapter bytes, malformed relationships, mapping
mismatch, and document/source immutability. Existing table writeback tests and
the repository boundary, test, typecheck, build, and Element Plus scans remain
required gates.

## Out of Scope

This slice does not generate a new PPTX from an empty document, remove unused
source media, content-hash assets, serialize shape/text/table changes beyond
existing table support, or add an asset-management UI. The UI remains Vue plus
UnoCSS with no Element Plus dependency.
