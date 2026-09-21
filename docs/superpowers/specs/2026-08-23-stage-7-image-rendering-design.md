# Stage 7 Image Rendering Design

> **Status:** Approved for implementation
> **Date:** 2026-08-23

## Goal

Render imported bitmap `SceneImageNode` instances in the browser without moving
DOM, Canvas, or binary data concerns into `@ppt4ai/model`, `@ppt4ai/render`, or
`@ppt4ai/pptx-import`.

## Scope

This slice adds a browser-side image renderer and a small Vue canvas host. The
renderer reads bytes through the existing asynchronous `AssetAdapter`, decodes
them with Chromium's `createImageBitmap`, and paints image nodes in SceneGraph
order. It supports PNG, JPEG, GIF, BMP, and WebP when the browser decoder does.

It does not add crop rectangles, masks, rotation, opacity/effects, image
insertion or replacement, PPTX export writeback, thumbnails, workers, or asset
management UI. Those remain separate slices with their own model and export
contracts.

## Architecture

`@ppt4ai/editor` owns the browser integration:

- `image-renderer.ts` provides a dependency-injected renderer core. Its public
  surface accepts a `SceneGraph`, a `CanvasRenderingContext2D`, an
  `AssetAdapter`, and an optional decoder. Dependency injection keeps tests
  deterministic and avoids mocking browser globals throughout the module.
- The default decoder creates a `Blob` from adapter bytes and calls
  `createImageBitmap`. Decoded bitmaps are closed on cache eviction or renderer
  disposal when the browser exposes `close()`.
- The cache is keyed by `assetId` and stores in-flight promises, so duplicate
  nodes and concurrent renders fetch/decode one asset only. Successful decoded
  images are reused; failed loads are reported per node and do not abort other
  images.
- Canvas coordinates use the document's EMU page units. The renderer sets the
  backing store to `round(page * 96 / 914400 * zoom * dpr)` and applies a
  `dpr * 96 / 914400 * zoom` transform before drawing. The CSS size remains the
  zoomed page size, preventing blurry output on high-DPI displays.
- `ImageCanvas.vue` owns canvas lifecycle, resize, device-pixel-ratio and
  redraw scheduling. It accepts a SceneGraph and adapter, emits a render result
  after each completed draw, and cancels stale redraws when props change or the
  component unmounts.

## Public Contracts

```ts
export interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  close?: () => void
}

export type ImageDecoder = (
  data: Uint8Array,
  mimeType?: ImageMimeType,
) => Promise<DecodedImage>

export interface ImageRenderIssue {
  nodeId: string
  assetId: string
  code: 'missing-asset' | 'decode-failed' | 'draw-failed'
  message: string
}

export interface ImageRenderResult {
  drawnNodeIds: string[]
  skippedNodeIds: string[]
  issues: ImageRenderIssue[]
}

export interface ImageCanvasRendererOptions {
  adapter: AssetAdapter
  decoder?: ImageDecoder
  devicePixelRatio?: number
  zoom?: number
}

export function createImageCanvasRenderer(
  options: ImageCanvasRendererOptions,
): ImageCanvasRenderer
```

`render(scene, context)` clears the full backing store, draws only image nodes,
and returns a clone-safe result. Non-image nodes are ignored by this slice so a
later general paint pipeline can compose shape/text/table painters without
changing the asset-loading contract.

## Failure and Lifecycle Rules

- An adapter returning `undefined` produces `missing-asset` for that node.
- Decoder rejection produces `decode-failed`; other nodes continue.
- A `drawImage` exception produces `draw-failed`; other nodes continue.
- Adapter and decoder errors are converted to stable string messages; no error
  object is exposed in the JSON-safe render result.
- `clearCache()` closes decoded resources and removes successful and failed
  entries. `dispose()` clears the cache and prevents later renders.
- A render always paints in graph order. A cached or newly decoded image does
  not change node ordering.

## Verification

Unit tests cover cache deduplication, concurrent loads, EMU-to-CSS/backing-store
scaling, node ordering, missing/decode/draw failures, resource closing, and
clone-safe diagnostics. Vue tests cover canvas creation, prop-driven redraw,
emitted results, and unmount disposal using injected renderer seams. Package
boundary checks must continue to pass, and no Element Plus or new runtime
dependency may be added.

