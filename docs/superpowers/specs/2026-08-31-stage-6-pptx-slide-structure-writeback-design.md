# PPTX Slide Structure Write-back Design

> **Status**: approved for implementation
>
> **Date**: 2026-08-31

## Goal

Write page additions, deletions, duplications, and reordering from an edited imported `Ppt4aiDocument` back into its original PPTX package. Existing table and image element write-back remains available, and package entries that this slice does not own remain byte-identical after decompression.

## Scope

- Extend the JSON-safe `Slide` contract with optional source provenance:

  ```ts
  export interface SlideSource {
    originId: string
    partPath: string
    relationshipId: string
    presentationId: string
  }

  export interface Slide {
    id: string
    elementIds: string[]
    source?: SlideSource
    // existing fields remain unchanged
  }
  ```

- Make `importPptx` populate `slide.source` for every imported slide.
- Keep `exportPptx(document, source, options?)` as the public export entry point.
- Resolve current page order from `document.slideOrder`, not from source order.
- Reuse the original slide part for an unchanged source page, clone the original part for a duplicated page, and generate a minimal valid slide part for a page without provenance.
- Synchronize `ppt/presentation.xml`, `ppt/_rels/presentation.xml.rels`, and `[Content_Types].xml`.
- Preserve slide relationship XML when cloning a slide. Relationship targets remain shared; dependent notes, comments, media, and unknown parts are not deleted automatically.
- Continue applying existing table/image element write-back to every source-backed page whose element mapping is supported.

## Provenance and compatibility

`originId` is the model slide ID assigned at import. A caller that duplicates a slide by cloning its `Slide` object naturally retains the origin binding while changing `id`; the exporter treats the second binding as a clone. A newly created slide has no `source` and is emitted as a blank slide using the first available source slide's layout relationship.

Documents serialized before this field existed may still export unchanged source pages when their IDs match the importer's legacy `sld_N` convention. Structural edits involving an unbound page fail with a stable error instead of guessing a source part. Manually created documents without source bytes remain outside this slice.

## Package algorithm

1. Materialize the source ZIP with the existing browser-compatible ZIP reader and retain central-directory order.
2. Parse the presentation slide references and relationship entries with the existing namespace-agnostic range scanner.
3. Build a current page plan. Each plan item is one of:
   - `reuse`: original part path, original `p:sldId`, and original presentation relationship;
   - `clone`: a fresh slide part path, fresh presentation ID and relationship ID, copied slide XML and slide relationship XML;
   - `blank`: a fresh slide part path, fresh IDs, a minimal slide XML part, and one slide-layout relationship.
4. Remove source slide references and presentation relationships that are not used by a `reuse` plan item. Remove their slide XML and slide relationship entries when no retained plan item refers to those paths. Dependent parts remain untouched.
5. Replace the `p:sldIdLst` children in current `slideOrder`, append new presentation relationships, and add/remove slide content-type overrides.
6. Run the existing element write-back against each `reuse` or `clone` slide part. A blank slide has no editable source elements.
7. Emit a fresh deterministic stored ZIP. The source `Uint8Array` and document are never mutated.

Fresh IDs are allocated deterministically: the next unused numeric `p:sldId` is greater than every existing numeric ID, the next relationship ID is the first unused `rIdN`, and the next slide part is `ppt/slides/slideN.xml` after the greatest existing numeric suffix. New part entries are appended as slide XML followed by its relationship part.

## Error behavior

Export rejects malformed or ambiguous inputs before returning bytes:

- missing presentation, presentation relationships, or content-types parts;
- a current slide with no source binding when the caller expects a non-blank source clone marker;
- duplicate use of one source binding by two current pages without a cloneable source part;
- missing source slide or slide relationship part;
- invalid `slideOrder`/`slides` mapping;
- unsupported element mapping or malformed source XML;
- ZIP entry name collisions for allocated parts.

Errors use the existing `PPTX export ...` prefix and identify the slide or part involved. No partial output is returned and no adapter write occurs as a side effect of structural planning.

## Non-goals

- Full package generation for a document without source bytes.
- Editing layout, master, theme, notes, comments, chart, animation, or non-table/non-image element XML.
- Cloning dependent package parts or deduplicating media.
- Browser UI, download controls, Element Plus, or runtime CSS dependencies.

## Verification

- Import tests assert clone-safe provenance and stable source mapping.
- Export tests cover unchanged source equality at entry-content level, reorder, deletion, blank insertion, source duplication, content-type and relationship synchronization, retained unknown/binary entries, deterministic repeated output, and document/source clone safety.
- Re-imported output must expose the intended slide count and order.
- Package typecheck/build, focused tests, repository tests, boundaries, recursive typecheck, production build, Element Plus scan, and `git diff --check` must pass.

