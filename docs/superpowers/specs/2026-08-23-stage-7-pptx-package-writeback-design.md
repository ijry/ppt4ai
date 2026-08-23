# Stage 7 PPTX Package Write-back Design

## Goal

Write an edited imported `Ppt4aiDocument` back to a browser-compatible PPTX `Uint8Array` while preserving every source package entry that this slice does not edit. The first package-level edit is table replacement on existing slide parts.

## Scope

- Add a pure, headless export API in `@ppt4ai/pptx-export`:

  ```ts
  exportPptx(document: Ppt4aiDocument, source: Uint8Array): Promise<Uint8Array>
  ```

- Read the source ZIP, retain all file entry bytes, and write a deterministic stored-entry ZIP.
- Resolve slide part paths from `ppt/presentation.xml`, its relationships, and `document.slideOrder`.
- Match source slide shape order with `slide.elementIds`; replace each existing table's `a:tbl` payload with `serializeTableXml` output.
- Preserve slide XML outside replaced `a:tbl` ranges byte-for-byte in the uncompressed entry content.
- Preserve all non-slide entries, relationships, unknown XML, binary media, and compression-independent file contents.
- Reject documents without source bytes, missing required package parts, invalid slide mappings, or table counts that cannot be matched deterministically.

## Non-goals

- Full generation of a PPTX package for new documents without a source.
- Shape, text, chart, image, theme, layout, or master XML editing.
- Relationship creation/deletion, resource deduplication, or ZIP comment/encryption support.
- DOM, browser UI, Vue, Element Plus, Canvas, or runtime CSS dependencies.

## Source matching

The importer assigns `elementIds` in the same order as `findSlideElements` traverses direct slide shape nodes. Export repeats that direct child traversal using a namespace-agnostic XML scanner. A table model is matched to the corresponding `p:graphicFrame` by element position, then its first `a:tbl` descendant is replaced. Non-table elements are left untouched. A mismatch is an error rather than a silent partial export.

## ZIP strategy

The exporter parses the source central directory and local headers, supports stored and raw-deflate entries, and materializes each entry's uncompressed bytes. It emits all entries in source central-directory order with method 0, UTF-8 names, fresh local headers, fresh central-directory records, CRC-32, sizes, and a zero-comment end record. This changes container bytes but preserves each unmodified entry's content exactly.

## Determinism and safety

XML replacement uses byte offsets from a small namespace-agnostic tag scanner, not parse-and-serialize. The source `Uint8Array` and JSON document are never mutated. All output is freshly allocated and `structuredClone(document)` remains equal before and after export.

## Verification

- Focused tests cover a stored/deflated source package, binary entry preservation, table replacement, byte preservation outside the table, deterministic repeated output, and clone safety.
- Package typecheck/build, repository tests, boundary checks, and full build must pass.
