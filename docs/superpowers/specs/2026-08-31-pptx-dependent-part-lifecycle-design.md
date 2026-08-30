# PPTX Dependent Part Cloning and Lifecycle Design

> **Status**: approved for implementation
>
> **Date**: 2026-08-31

## Goal

Make source-backed slide duplication self-contained for slide-owned Open Packaging Convention (OPC) dependencies, and remove only dependency parts that become unreachable after page deletion. The existing `exportPptx(document, source, options?)` API remains unchanged.

## Scope

- A cloned source slide receives a fresh slide part and a fresh relationship part.
- Internal relationships from a cloned slide are followed recursively.
- Package-global dependencies remain shared:
  - relationship types `slideLayout`, `slideMaster`, `theme`, `notesMaster`, and `handoutMaster`;
  - package parts `ppt/presentation.xml`, `ppt/tableStyles.xml`, `ppt/presProps.xml`, and `ppt/viewProps.xml`.
- Every other existing internal relationship target is cloned into the same directory with a deterministic, collision-free name. A target already visited within one clone closure is cloned once and reused by that closure.
- External relationships, including their target text and `TargetMode`, remain unchanged and are never traversed.
- Cloned relationship XML changes only internal `Target` attribute values that point to cloned paths. Relationship IDs, ordering, unknown attributes, whitespace, and unrelated XML remain unchanged.
- A cloned dependency keeps the source part bytes. Its relationship sidecar, when present, is cloned and rewritten using the same path map.
- `[Content_Types].xml` receives a matching `Override` for a cloned source part when the source part had an override. Parts covered by an existing extension default do not receive redundant overrides.
- When source slides are deleted, their slide part, relationship sidecar, and non-global dependency closure are removed only when no retained source slide, generated blank slide, or cloned dependency still reaches the path. Unrelated and unreferenced ZIP entries remain untouched.
- Existing table and image element write-back runs after dependency materialization for both reused and cloned slides. Adapter bytes remain host-owned; this slice does not alter undo/redo or asset APIs.

## Ownership and reachability

The exporter builds the current slide plan first. It then uses two views of the source package:

1. A clone view starts at each `clone` slide part and recursively copies non-global internal targets. The source root is mapped to the already allocated output slide path before recursion, so cycles and repeated targets terminate deterministically.
2. A cleanup view starts at every source slide that is removed, includes its relationship sidecar and all internal targets, and subtracts paths reachable from the presentation part, retained source slides, blank-slide relationships, and newly cloned parts. Only paths in that cleanup view and absent from the protected set are removed.

Relationship targets are resolved against the owning part path, normalized within the package root, and rewritten relative to the cloned owner path. URI fragments after a target path are preserved. A missing internal target or malformed relationship XML needed by a clone is a stable `PPTX export dependency ...` error; external targets do not cause an error merely because they cannot be resolved locally.

## Determinism and safety

- Clone allocation follows current `slideOrder`, then relationship document order, and preserves the source directory and extension.
- Numeric suffixes increment from the highest occupied sibling; names without a numeric suffix use `-copyN`.
- Existing source entry order is retained. New dependency entries append in clone discovery order, with each part immediately followed by its relationship sidecar when one exists.
- The input document, source bytes, and adapter-owned byte arrays are never mutated. No adapter `put` call is made.
- Planning and dependency validation happen before the ZIP writer is called. A failed export returns no partial package.

## Error behavior

Reject with the existing `PPTX export ...` prefix for:

- missing source part or relationship sidecar required by a clone;
- malformed relationship XML or an internal relationship target that is absent;
- an allocated dependency path collision that cannot be resolved;
- missing or malformed `[Content_Types].xml` when a cloned or removed override must be synchronized.

Existing errors for invalid slide mappings and unsupported element write-back remain unchanged.

## Non-goals

- Editing or interpreting chart, SmartArt, animation, notes, comments, or embedded workbook semantics.
- Cloning package-global master/layout/theme parts into new presentation master registrations.
- Rewriting arbitrary path-like strings inside opaque XML or binary data.
- Automatic media deduplication beyond the existing image write-back behavior.
- PowerPoint/LibreOffice installation or automated replacement for manual reader validation.

## Verification

- Unit tests cover recursive target resolution, external relationship preservation, cycle/repeated-target handling, deterministic path allocation, and target XML rewriting.
- Export tests cover cloned notes/media-like dependencies, nested dependencies, shared dependency retention, deleted-slide orphan cleanup, content-type synchronization, repeated byte-identical export, re-imported slide order, and source/document clone safety.
- Existing source write-back and standalone generation tests remain green.
- Focused tests, package typecheck/build, repository tests, boundaries, recursive typecheck, production build, Element Plus scan, and `git diff --check` are required.
