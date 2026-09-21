# Stage 7 Asset Library Host Wiring Design

> Status: Approved for implementation
> Date: 2026-08-23

## Goal

Connect the reusable `AssetLibrary` surface to the Playground host so the
existing image asset lifecycle can be exercised end to end without moving
engine state or binary storage into the Vue asset library component.

## Scope

This slice adds a minimal, deterministic Playground host with:

- an `EditorEngine` initialized with one slide and no image assets;
- an in-memory `AssetAdapter` that stores cloned bytes and metadata;
- two synchronous engine commands used to insert and replace references to
  assets that already exist in the document;
- a host-owned asset selection and selected image element policy;
- `AssetLibrary` rendering from the current engine document and adapter;
- localised success/error diagnostics for insert and replace actions.

The demo image bytes, seeded metadata, and EMU bounds are fixed test fixtures.
The host wires
the library's `select`, `insert`, and `replace` events to host functions; the
library itself remains unaware of `EditorEngine` and never calls
`AssetAdapter.put()`.

## Non-goals

- File input, drag-and-drop, clipboard import, or upload protocol design.
- Binary deletion, adapter garbage collection, or persistent storage.
- Shape, text, table, chart, or group thumbnail painting.
- A global state store or a complete editor shell.
- Changing `ImageAssetController` or `EditorEngine` command semantics.

## Host Architecture

The engine adds two reference-only commands alongside the existing byte-
owning image commands:

```ts
type EngineCommand =
  | { type: 'insertImageReference'; slideId: string; element: ImageElement; assetId: string }
  | { type: 'replaceImageAssetReference'; elementId: string; assetId: string }
```

`insertImageReference` requires an existing document asset, requires the image
element's `assetId` to match, appends the element to the slide, selects it,
and records only the element/slide patch. `replaceImageAssetReference`
requires an existing, different document asset and an image target, changes
only the target reference, removes the old metadata when it has no remaining
image references, and records one atomic patch. Neither command calls an
adapter or creates asset metadata.

`apps/playground/src/App.vue` owns the following state:

```ts
const engine = new EditorEngine(initialDocument)
const assetAdapter = createMemoryAssetAdapter()
const engine = new EditorEngine(initialDocument)
```

The host keeps a Vue `engineState` ref. Every successful engine dispatch
replaces that ref with the returned clone-safe `EngineState`. The initial
document and adapter metadata are deterministic so browser smoke tests and
component tests can assert stable asset IDs and slide element order.

The adapter exposes `get` and `put` only. `put` clones the byte buffer and
metadata before storing them; `get` returns a fresh byte buffer. This mirrors
the host-owned binary boundary and prevents thumbnails from mutating stored
data through shared references.

## Event and Data Flow

1. `AssetLibrary` receives `engineState.document.assets`, `assetAdapter`, and
   the currently selected asset ID.
2. A library selection emits an asset ID. The host records it and selects the
   corresponding image element if one exists; otherwise it clears the image
   element target while preserving the asset selection.
3. Insert validates that the emitted asset ID exists in the current document,
   dispatches `insertImageReference` with the deterministic fixed bounds, then
   publishes the returned state and selects the new element.
4. Replace requires the current engine selection to contain exactly one image
   element. It dispatches `replaceImageAssetReference` with the emitted asset
   ID and publishes the returned state. If no image target exists, the host
   reports a localised error without dispatching.
5. Every invalid reference operation leaves the current engine state
   unchanged. The host displays a localised failure status and keeps the
   previous selection.

The demo uses the same two PNG fixtures already used by thumbnail smoke tests.
Seed metadata is created once in the host fixture. Real file import remains a
separate follow-up that will use `ImageAssetController`, so dimensions and
MIME parsing stay out of the UI.

## Presentation

The Playground remains a usable demo surface rather than a marketing page:
the asset library is shown beside the existing thumbnail smoke view using
UnoCSS grid/flex layout. A compact status region reports the selected asset,
selected image element, and the latest operation result. All controls have
semantic labels from the existing locale tree. No Element Plus or icon
package is added.

## Error Handling

- Missing selected image element: replace is rejected before engine dispatch.
- Missing asset reference: insert or replace is rejected atomically by the
  engine and the host surfaces the error.
- Thumbnail failure: existing `AssetLibrary` local failure isolation remains
  unchanged.

## Testing

- Add pure host helper tests for deterministic initial document, adapter clone
  isolation, selected-image resolution, and operation error normalization.
- Extend Playground tests to mount the host, select an asset, insert an image,
  and replace the selected image while asserting document metadata and
  element references.
- Assert a replace with no selected image reports an error and does not add a
  history entry.
- Keep editor focused tests, boundary checks, full tests, typechecks, builds,
  and the Element Plus zero-match scan as repository gates.

## Deferred Follow-up

The next independent work remains non-image thumbnail painting and real file
upload integration. Upload will use `ImageAssetController`; this host slice
uses reference-only engine commands and keeps adapter bytes outside Vue.
