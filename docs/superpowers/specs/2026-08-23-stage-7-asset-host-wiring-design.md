# Stage 7 Asset Library Host Wiring Design

> Status: Proposed for implementation
> Date: 2026-08-23

## Goal

Connect the reusable `AssetLibrary` surface to the Playground host so the
existing image asset lifecycle can be exercised end to end without moving
engine state or binary storage into the Vue asset library component.

## Scope

This slice adds a minimal, deterministic Playground host with:

- an `EditorEngine` initialized with one slide and no image assets;
- an in-memory `AssetAdapter` that stores cloned bytes and metadata;
- an `ImageAssetController` used for image insertion and replacement;
- a host-owned asset selection and selected image element policy;
- `AssetLibrary` rendering from the current engine document and adapter;
- localised success/error diagnostics for insert and replace actions.

The demo image bytes and EMU bounds are fixed test fixtures. The host wires
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

`apps/playground/src/App.vue` owns the following state:

```ts
const engine = new EditorEngine(initialDocument)
const assetAdapter = createMemoryAssetAdapter()
const controller = createImageAssetController({
  engine,
  assetAdapter,
  assetIdFactory,
})
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
3. Insert uses the deterministic demo PNG and fixed bounds, calls
   `controller.insert`, then publishes the returned state and selects the new
   element.
4. Replace requires the current engine selection to contain exactly one image
   element. It calls `controller.replace` with the selected asset's demo bytes
   and publishes the returned state. If no image target exists, the host
   reports a localised error without dispatching.
5. Every controller failure leaves the current engine state unchanged. The
   host displays a localised failure status and keeps the previous selection.
   Orphan IDs from a post-write dispatch failure are included in diagnostics
   but are not deleted automatically.

The demo uses the same two PNG fixtures already used by thumbnail smoke tests.
The host creates metadata through the controller, so dimensions and MIME are
parsed by the shared bitmap parser rather than duplicated in the UI.

## Presentation

The Playground remains a usable demo surface rather than a marketing page:
the asset library is shown beside the existing thumbnail smoke view using
UnoCSS grid/flex layout. A compact status region reports the selected asset,
selected image element, and the latest operation result. All controls have
semantic labels from the existing locale tree. No Element Plus or icon
package is added.

## Error Handling

- Missing selected image element: replace is rejected before controller call.
- Unsupported or malformed demo bytes: controller error is surfaced and state
  is unchanged.
- Adapter failure: controller error is surfaced and state is unchanged.
- Dispatch failure after adapter write: the orphan asset ID is included in the
  status message; no automatic deletion is attempted.
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

The next independent work remains non-image thumbnail painting and any real
file upload integration. Those features must preserve this host/library
boundary and continue to keep adapter bytes outside the Vue component.
