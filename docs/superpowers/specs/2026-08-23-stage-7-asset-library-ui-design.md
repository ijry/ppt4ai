# Stage 7 Asset Library UI Design

## Context

The image asset model, browser rendering pipeline, editor asset controller, and
PPTX image writeback are complete. The next slice needs a reusable asset
library surface that can be embedded by a host editor without moving binary
storage or engine state into the Vue component.

## Goals

- Present document image assets in a deterministic, compact grid.
- Reuse the existing Worker/OffscreenCanvas thumbnail pipeline.
- Expose selection and insert/replace intents as typed Vue events.
- Show useful metadata and recoverable thumbnail failures.
- Keep the component clone-safe and independent from the editor engine.
- Use only Vue, Vue-I18n, and UnoCSS at runtime; Element Plus and icon
  packages remain prohibited.

## Non-goals

- Uploading files or implementing asset storage in the component.
- Calling `EditorEngine` or `AssetAdapter.put()` from the component.
- Deleting assets, deduplicating bytes, or garbage collecting adapter data.
- Painting shape, text, table, chart, or group thumbnails.
- Building the complete editor shell or a global state store.

## Component Contract

`AssetLibrary.vue` accepts:

- `assets?: Record<string, AssetMetadata>`
- `adapter: AssetAdapter`
- `selectedAssetId?: string`
- `thumbnailWidth?: number` and `thumbnailHeight?: number`
- `resourceContext?: string`
- `workerFactory?: ThumbnailWorkerFactory`

It emits `select(assetId)`, `insert(assetId)`, and `replace(assetId)`.
Clicking an item selects it. The item action buttons emit an intent only; the
host decides how to call the image asset controller. An invalid selected ID is
normalized to no selection.

## Pure View Model

`createAssetLibraryModel(assets, selectedAssetId)` returns a new object with a
stable list of `AssetLibraryItem` values. Items sort by case-insensitive
filename when present and then by asset ID. Each item contains the original
metadata, a display name, a MIME format label, and a dimension label. Missing
dimensions use a stable `unknown` marker so localization stays in the Vue
layer.

## Visual and Interaction Design

The panel uses a neutral Swiss-style editor surface: a restrained border,
compact spacing, high-contrast text, and a two-column minimum responsive grid
that expands with available width. Each asset is an individual framed item,
not a card nested inside another card. The selected item has a visible accent
border and focus ring. Buttons use familiar text commands because insert and
replace are explicit actions, while no decorative icon dependency is added.

The grid is keyboard reachable in visual order. Each asset item is a `li` with
a selectable button and separate action buttons. Thumbnail failures render a
local error state with `role="status"`; the panel empty state is announced as
well. Async thumbnail rendering remains cancellable through `ThumbnailCanvas`.

## Data Flow and Failure Handling

The host owns `Ppt4aiDocument.assets` and an `AssetAdapter`. The component
derives view items, requests each image thumbnail through `ThumbnailCanvas`,
and emits only user intent. Missing or corrupt adapter data is isolated to its
asset tile by the existing thumbnail result event; it must not remove sibling
items or throw from the panel.

## Testing

- Pure model tests cover deterministic sorting, labels, unknown dimensions,
  cloning, and selection normalization.
- Component tests cover empty state, metadata rendering, selection and action
  events, keyboard activation, selected styling, locale key parity, and local
  thumbnail failure status.
- Package typecheck plus the repository boundary, test, build, and
  Element-Plus scans remain required gates.
