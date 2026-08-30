# PPTX Exact No-op Byte Round-trip Design

> **Status**: approved for implementation
>
> **Date**: 2026-08-31

## Goal

Make exporting an imported document with no model changes return an exact copy of the original source ZIP bytes, including compression, central-directory order, trailing data, and opaque package entries. Any source or model change must continue through the existing deterministic write-back path.

## Scope

- Extend the optional document source metadata with two internal, JSON-safe fingerprints:
  - `packageFingerprint`: fingerprint of the exact source `Uint8Array` supplied to `importPptx`;
  - `modelFingerprint`: fingerprint of the imported document's model fields, excluding the `source` metadata itself.
- Add pure, browser-safe fingerprint helpers in `@ppt4ai/model`:
  - `fingerprintBytes(bytes: Uint8Array): string`;
  - `fingerprintDocument(document: Ppt4aiDocument): string`.
- `importPptx` records both fingerprints. It continues to preserve all existing XML source entries and slide provenance.
- `exportPptx` checks both fingerprints before reading the ZIP. On an exact match it returns `new Uint8Array(source)` and never calls the asset adapter.
- Documents imported by older versions without either fingerprint use the current write-back algorithm; no metadata is guessed.
- The fast path is conservative: a changed source byte, changed model field, changed slide order, page lifecycle operation, element edit, asset reference, or transform falls back to normal export.

## Fingerprint contract

The fingerprint is an equality optimization, not a cryptographic security boundary. It is deterministic across browser and Node runtimes and uses a fixed 64-bit FNV-1a calculation over UTF-8 bytes.

`fingerprintDocument` canonicalizes object keys recursively, preserves array order, omits only the top-level `source` field, and serializes the remaining JSON-safe model. Optional `undefined` properties follow normal JSON semantics. `fingerprintBytes` hashes every byte in order.

The source metadata remains optional and validation accepts old documents. When present, each fingerprint must be a non-empty string. The helpers do not mutate their inputs.

## Export flow

1. `exportPptx` checks `document.source.packageFingerprint` and `document.source.modelFingerprint`.
2. It compares the package fingerprint with the supplied source bytes and the model fingerprint with the current document.
3. If both match, it returns a copied `Uint8Array` immediately.
4. Otherwise it executes the existing source package planner, dependency lifecycle handling, table/image write-back, and deterministic ZIP writer unchanged.

The check intentionally occurs before ZIP parsing so exact source bytes do not get normalized by the stored ZIP writer. It does not bypass validation for a changed document, and it does not trust a fingerprint when the supplied source bytes differ.

## Error and compatibility behavior

- No new export error is introduced for a missing fingerprint; the existing write-back path remains the fallback.
- Malformed or altered source bytes cannot use the fast path unless their exact bytes match the recorded package fingerprint.
- Adapter-owned binary data is never read on the exact no-op path and is never mutated.
- `structuredClone` and JSON serialization retain the optional metadata.

## Non-goals

- Detecting semantic equivalence between differently serialized source packages.
- Replacing the existing element-level dirty tracking or source dependency graph.
- Cryptographic authenticity, collision resistance, or cross-version migration of unrelated source metadata.
- Changes to standalone `createPptx` output.

## Verification

- Model tests cover deterministic byte/document fingerprints, recursive key order canonicalization, source metadata exclusion, and input immutability.
- Import tests assert both fingerprints are recorded and survive `structuredClone`.
- Export tests use a source with non-canonical trailing bytes, assert exact no-op equality and zero adapter reads, and assert changed source/model values use normal write-back instead.
- Focused and full repository tests, boundaries, typecheck, build, Element Plus scan, and `git diff --check` remain required.
