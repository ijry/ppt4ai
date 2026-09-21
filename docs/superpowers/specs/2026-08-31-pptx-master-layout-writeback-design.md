# PPTX Master and Layout Write-back Design

> **Status**: approved for implementation
>
> **Date**: 2026-08-31

## Goal

Preserve the source identity of imported slide masters and layouts so edits to
placeholder defaults and color-map overrides can be written back to their
original PPTX parts without rebuilding unrelated XML. Slide color-map
overrides use the same range-preserving path.

## Context

The model already stores sparse placeholder defaults on `SlideMaster` and
`SlideLayout`, and stores color-map data on masters, layouts, and slides. The
importer currently drops the source paths for the first two kinds of part, and
the exporter only knows how to patch slide elements and theme colors. Without
part identity an edited default cannot be associated with a source XML entry.

## Scope

- Add clone-safe `source.partPath` bindings to imported `SlideMaster` and
  `SlideLayout` records.
- Preserve source bindings through validation, JSON serialization,
  `structuredClone`, and document fingerprints.
- Write existing placeholder defaults on source master/layout parts for the
  model fields `bounds`, `rotation`, `preset`, `fill`, `stroke`, `text`, and
  `body`.
- Write defined keys of master `colorMap`, layout `colorMapOverride`, and
  slide `colorMapOverride` to their existing source mapping elements.
- Insert a missing mapping element or attribute when the current model
  explicitly defines it, while leaving omitted model keys and unknown source
  attributes untouched.
- Preserve the source part root, unknown siblings, element attributes,
  relationship parts, ZIP entry order, and all bytes outside deliberately
  replaced ranges.
- Reuse the existing namespace-aware serializers and XML range scanner; no
  runtime dependency on the importer is added.

## Model contract

```ts
export interface SlideMasterSource {
  partPath: string
}

export interface SlideLayoutSource {
  partPath: string
}

export interface SlideMaster {
  id: string
  defaults?: Record<string, ElementDefaults>
  themeId?: string
  colorMap?: Partial<ColorMap>
  source?: SlideMasterSource
}

export interface SlideLayout {
  id: string
  masterId: string
  defaults?: Record<string, ElementDefaults>
  colorMapOverride?: Partial<ColorMap>
  source?: SlideLayoutSource
}
```

The path must be a non-empty normalized ZIP part path. Validation reports
`masters.<id>.source must be an object`,
`masters.<id>.source.partPath must be a non-empty string`, and the equivalent
`layouts.<id>...` paths. The nested binding is part of the model fingerprint;
top-level `document.source` remains excluded as before.

## Import behavior

When a valid master or layout part is parsed, the caller passes its normalized
part path to the parser and the resulting record receives
`source: { partPath }`. The existing path caches continue to ensure that
shared XML parts produce one model record and one binding. Missing or
malformed optional parts retain the current tolerant behavior and do not
create a partial bound record.

## Placeholder default write-back

`rewritePlaceholderPartXml(source, defaults)` scans direct `p:sp` descendants,
matches a placeholder using the importer key (`type` or `type:idx`), and
patches only fields explicitly present in the supplied sparse default:

- `bounds` updates `a:off/@x,y` and `a:ext/@cx,cy`.
- `rotation` updates or removes `a:xfrm/@rot`.
- `preset` updates an existing `a:prstGeom/@prst`, or inserts a canonical
  preset geometry before shape fill/line content.
- `fill` and `stroke` update only their supported solid-color payload; a
  missing fill/line is inserted, and an explicit `undefined` field is not
  interpreted as deletion.
- `body` replaces the `p:txBody` range with the existing text serializer;
  `text` is converted to a one-paragraph body only when `body` is absent.

The source placeholder shape, `p:ph` attributes, unknown shape children, and
all non-placeholder shapes remain byte-for-byte unchanged. A missing model
placeholder does not create a new shape, and a source placeholder absent from
the model is retained. Equality is checked per field, so an unchanged default
part is returned exactly.

## Color-map write-back

`rewriteColorMapXml(source, kind, map)` supports these mappings:

- `master`: direct `p:clrMap` attributes.
- `layout` and `slide`: `p:clrMapOvr/a:overrideClrMapping` attributes.

For each defined supported model key, the writer compares the source target
and changes only that attribute value, preserving its original quote style and
the rest of the opening tag. A missing attribute is appended to the mapping
opening tag. For layout/slide parts without an override mapping, the writer
inserts `p:clrMapOvr` and `a:overrideClrMapping` while preserving an existing
`a:masterClrMapping` child. Existing unknown attributes and child order remain
unchanged. Omitted model keys are non-destructive; explicit mapping deletion
is deferred.

The serializer takes prefixes from the source mapping elements. Invalid model
targets fail with a stable `PPTX export ... color map ...` error rather than
writing malformed XML. Malformed bound source XML, a missing required source
part, or a mapping with an unusable structure fails before the corresponding
entry is committed.

## Export integration

After the source ZIP is materialized, export visits bound masters and layouts
in sorted model-ID order. It groups writes by source path, computes all
rewritten XML before mutating entry data, and rejects conflicting rewrites when
two model records bind one path with different content. It then applies slide
color-map writes against each current `reuse` or `clone` slide output path;
blank slides have no source override to patch. Existing slide element and theme
writers continue to run, and no relationship or content-type entry is added
for these edits.

The exact-byte unchanged fast path remains first. Source and document inputs,
including adapter-owned byte arrays, are never mutated.

## Non-goals

- Creating or deleting master/layout parts or placeholder shapes.
- Editing master/layout text styles, theme font/effect/format schemes, or
  theme color deletion.
- Rebuilding XML trees or normalizing whitespace.
- A master/layout editor UI, engine commands, or history integration.
- Full no-source package generation.

## Verification

- Model tests validate both source bindings, invalid paths, clone safety, and
  fingerprint participation.
- Import tests assert normalized master/layout paths and shared-path reuse.
- Range-writer tests cover default bounds/rotation/fill/stroke/preset/text,
  custom prefixes, unknown siblings, mapping replacement/insertion, and
  unchanged byte identity.
- Export tests edit imported master/layout/slide data, re-import the output,
  assert semantic values, and verify unrelated source entries and input bytes.
- Missing source parts and malformed bound XML produce stable errors without a
  partial output ZIP; repeated export is deterministic.
- Run focused tests, full tests, typecheck, build, boundaries, the Element
  Plus scan, and `git diff --check`.

## Follow-up slices

1. Explicit deletion and complete editing of inherited properties.
2. Engine history and a UnoCSS-only master/layout editor surface.
3. Reader-based validation with PowerPoint or LibreOffice when available.
