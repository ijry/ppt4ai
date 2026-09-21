# PPTX Custom Theme Color Write-back Design

> **Status**: approved for implementation
>
> **Date**: 2026-08-31

## Goal

Make imported custom theme color schemes editable without discarding the
source theme XML. A changed theme color must affect the model's resolved
colors and be written back to the original theme part while unknown XML,
attributes, relationships, and unrelated package entries remain intact.

The same color model must be honored by the standalone `createPptx` path,
which currently emits a fixed Office theme regardless of `document.themes`.

## Context and current gap

`@ppt4ai/model` already represents the twelve DrawingML color slots and
`@ppt4ai/pptx-import` already parses a theme reached through a master
relationship. The imported `Theme` has no source-part identity, so
`@ppt4ai/pptx-export` cannot know which source XML to patch. The exporter
also only edits slide parts; theme parts are copied unchanged whenever a
document is exported from a source package. `createPptx` always serializes
the hard-coded Office color scheme.

The existing source-package fast path remains the first line of defense for
an unchanged import. This design only changes the normal fallback path after
the model or package has changed.

## Scope

- Add clone-safe source provenance to imported themes:

  ```ts
  export interface ThemeSource {
    partPath: string
  }

  export interface Theme {
    id: string
    colors: Partial<Record<ThemeColorSlot, Color>>
    source?: ThemeSource
  }
  ```

- Populate `Theme.source.partPath` from the resolved master-to-theme
  relationship. Shared theme parts continue to map to one model theme.
- Add source-package write-back for the twelve supported `clrScheme` slots:
  `dk1`, `lt1`, `dk2`, `lt2`, `accent1` through `accent6`, `hlink`, and
  `folHlink`.
- Preserve the theme root, `clrScheme` attributes, slot attributes, unknown
  sibling children outside a changed color node, quote style outside
  replaced ranges, and all unrelated ZIP entries. A changed color node is a
  deliberate replacement of that node's supported payload, so unknown
  descendants inside that one replaced node are outside this slice.
- Replace an existing supported color child or insert a missing slot/color
  when the current model defines that slot.
- Make an omitted model slot non-destructive in this slice: the source
  color is retained. Explicit theme-color deletion requires a later design
  because a valid OOXML `clrScheme` requires one color child per slot.
- Make standalone generation serialize the effective document theme's
  supported colors, falling back to the current Office defaults for omitted
  slots. Standalone output still contains one generated theme part.
- Keep all APIs browser-safe, JSON-safe, and free of new runtime
  dependencies.

## Non-goals

- Theme font schemes, format schemes, effect schemes, or background fill
  schemes.
- Editing master or layout shapes, color-map attributes, or theme names.
- Theme creation/deletion, multiple-theme topology changes, or explicit
  deletion of a color slot.
- A theme editor UI, engine commands, or presentation-level theme history.
- Rebuilding an entire theme XML document or normalizing unrelated source
  markup.
- Changing the existing opaque-part dependency lifecycle or content-type
  algorithm; this slice must continue to preserve those parts unchanged.

## Model and fingerprint contract

`ThemeSource` contains only a non-empty source ZIP part path and therefore
survives `structuredClone` and JSON serialization. `validateDocument` checks
the optional object and path using the same provenance rules as
`SlideSource`.

The provenance field is part of the nested model and remains visible to the
canonical document fingerprint. The existing top-level `document.source`
metadata continues to be excluded from the fingerprint. An imported document
therefore retains the exact theme identity, while an old hand-authored
document without `Theme.source` remains valid and simply receives no theme
write-back.

## Import behavior

`parseTheme(xml, id, partPath)` returns the current color map plus
`source: { partPath }`. The caller already resolves the theme relationship
from the master part; it passes that normalized target path into the parser.

Rules:

1. A valid theme with a readable `clrScheme` receives source provenance.
2. A missing theme part, malformed XML, or theme without a readable color
   scheme keeps the current local fallback behavior and does not create a
   partially bound theme.
3. Theme sharing remains path-based: two masters pointing at one path reuse
   one theme ID and one source binding.
4. Existing color parsing, transforms, color maps, and scene resolution do
   not change.

## Source XML write-back

Add a focused browser-safe range writer in
`packages/pptx-export/src/theme-writeback.ts`. It may reuse the exporter's
existing XML range scanner through a small shared internal utility, but it
must not import `@ppt4ai/pptx-import` at runtime.

The writer accepts the source theme XML and the current `Theme`, and returns
the original XML when no supported slot changed. It performs these steps:

1. Locate the first `clrScheme` element and its direct slot children using
   local names, while retaining absolute source ranges.
2. For every supported slot present in `theme.colors`, parse the source color
   child using the same semantic rules as the importer and compare the full
   color plus transform list.
3. If the values are equal, emit no replacement for that slot.
4. If the slot exists and has a recognized color child, replace only that
   child range with a serializer using the source namespace prefix. The slot
   opening tag, slot attributes, unknown sibling children, and closing tag
   remain byte-for-byte unchanged.
5. If the slot exists but has no recognized color child, insert the serialized
   color before the slot's closing tag, preserving all existing children.
6. If the slot is absent, insert a serialized slot immediately before the
   `clrScheme` closing tag. The inserted slot uses the `clrScheme` prefix and
   the canonical slot order only for the newly inserted node; existing child
   order is untouched.
7. Apply non-overlapping replacements from the end of the XML toward the
   beginning. Do not rewrite the theme root, font scheme, format scheme, or
   unrelated XML.

The serializer supports `srgbClr`, `schemeClr`, `prstClr`, `sysClr`, and
`scrgbClr`, plus the model's supported transforms in their existing order.
It escapes XML values and rejects unsupported XML control characters using a
stable `PPTX export theme ...` error prefix.

If a bound source part is missing, malformed, lacks `clrScheme`, or contains
an invalid source color, export fails with a stable theme-specific error
instead of silently replacing or dropping the whole part. A well-formed
bound theme whose supported values are equal to the model is returned
unchanged.

## Export integration

After the existing source ZIP is read and before the final ZIP is written,
`exportPptx` visits themes with `Theme.source` in deterministic theme-ID
order:

1. Resolve `theme.source.partPath` in the source entry map.
2. Compare and rewrite only changed supported slots using the theme writer.
3. Replace that entry's data in place, preserving source entry order and all
   bytes outside the returned XML ranges.

The integration runs alongside the current slide, dependency, image, and
content-type logic. It does not add or remove a relationship or content-type
entry because a theme edit changes an existing part only. A source document
without theme provenance, or a document with a hand-authored theme, keeps the
current behavior.

The exact-byte fast path remains unchanged and runs before ZIP parsing. A
theme edit changes the model fingerprint and therefore cannot use that path.

## Standalone generation

Change `serializeThemeXml` to accept an optional `Theme`. `createPptx` picks
the theme referenced by the first master in `document.masters`, then the
first theme in deterministic key order, then the current built-in Office
defaults. The generated theme uses the existing skeleton and namespace
layout; only supported color values are substituted. Missing slots use the
same defaults currently emitted by the serializer.

The generated package continues to have one master, one layout, and one
theme. Multiple master/theme relationships remain out of scope until the
custom master/layout slice.

## Error behavior

- Invalid `Theme.source` metadata is rejected by normal document validation.
- Missing source theme parts, malformed theme XML, and unsupported changed
  color values use deterministic `PPTX export theme ...` errors. A bound
  theme is validated even when the current export change is on a slide, so a
  corrupt provenance binding is never silently accepted.
- No partial theme entry is committed if the writer fails; the export
  promise rejects before ZIP serialization completes.
- Existing document, source `Uint8Array`, and adapter-owned bytes are never
  mutated.
- Older documents without `Theme.source` remain exportable and do not gain
  guessed bindings.

## Verification

### Model

- Validate a non-empty `Theme.source.partPath`.
- Reject an empty or non-object source binding with the expected path error.
- Preserve the binding through `structuredClone` and document
  fingerprinting.

### Import

- Import a custom theme reached through a master relationship and assert its
  normalized source path.
- Assert shared theme paths reuse one source-bound theme.
- Assert malformed or missing theme parts remain unbound without dropping
  the slide.

### Export

- Change an existing `accent1` color and assert only its color child changes;
  unknown theme attributes, siblings, transforms, and unrelated entries stay
  intact.
- Add a supported slot to a source theme missing that slot and assert the
  inserted node uses the source prefix and re-imports to the new color.
- Edit a transformed color and assert the full transform list round-trips.
- Edit a slide while leaving theme values equal and assert the theme entry is
  byte-identical.
- Assert a missing or malformed bound theme produces the stable error and
  does not produce a partially written ZIP.
- Assert multiple bound themes are rewritten deterministically and only the
  changed part is touched.

### Standalone

- Generate a document referencing a custom theme, inspect the generated
  `ppt/theme/theme1.xml`, and re-import it to verify supported colors.
- Assert repeated generation is byte-identical and does not mutate the
  document.

Run focused model/import/export tests first, then `pnpm test`,
`pnpm typecheck`, `pnpm build`, `pnpm check:boundaries`, the repository's
Element Plus scan, and `git diff --check`.

## Follow-up slices

1. Bind and write back master/layout placeholder defaults and color-map
   overrides using the same range-preserving strategy.
2. Define explicit theme color deletion and complete theme scheme editing.
3. Add engine history and a UnoCSS-only theme/master editor surface.
4. Audit real-world opaque parts and mixed content-type declarations with
   reader-based validation when PowerPoint or LibreOffice is available.
