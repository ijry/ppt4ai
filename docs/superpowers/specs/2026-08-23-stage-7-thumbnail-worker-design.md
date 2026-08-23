# Stage 7 Thumbnail Worker Design

> **Status:** Approved for implementation
> **Date:** 2026-08-23

## Goal

Render image-only slide thumbnails off the editor's main thread with
`Worker` and `OffscreenCanvas`, while preserving the existing image appearance
semantics and keeping the public result clone-safe.

## Scope

This slice adds a browser-side thumbnail worker pipeline for `SceneImageNode`.
It renders image nodes in `SceneGraph.nodes` order and supports the appearance
fields already implemented by the editor image renderer:

- decoded bitmap loading through an asset ID resource bridge;
- source crop;
- `rect`, `roundRect`, `ellipse`, and `triangle` preset masks;
- OOXML rotation and horizontal/vertical flips;
- `alphaModFix` and `grayscl` effects;
- request cancellation, stale-result suppression, and structured diagnostics.

Shape, text, table, chart, and group-specific thumbnail painting are outside
this slice. Non-image nodes are ignored rather than treated as failures. This
slice does not add image insertion, asset management UI, PPTX writeback, or a
new runtime dependency.

The target is the project's supported environment: current Chromium desktop
releases. `OffscreenCanvas` initialization or drawing failure is reported as a
structured failure; the implementation does not silently fall back to a
second renderer in this slice.

## Architecture

`@ppt4ai/editor` owns the worker integration. The model and render packages
remain headless and continue to expose plain JSON values only.

The main-thread controller owns one worker instance, a monotonically increasing
request ID, and the pending request map. A render request contains a
`structuredClone`-safe scene graph, the thumbnail viewport dimensions, and a
request context. The worker creates and owns its internal `OffscreenCanvas`,
then returns an `ImageBitmap` plus clone-safe diagnostics. The controller
paints that bitmap into the visible canvas with a `bitmaprenderer` context.

The worker owns an `OffscreenCanvas` and a per-asset decoded image cache. It
receives image bytes through an explicit request/response resource bridge; an
`AssetAdapter` instance, Vue object, DOM node, `CanvasRenderingContext2D`, or
class instance never crosses the worker boundary. The bridge request includes
`assetId` and the caller's optional resource context. The main thread answers with
`Uint8Array` bytes and MIME metadata, or a stable missing-resource error.

The worker loads each asset once per worker lifetime, stores in-flight promises
to deduplicate concurrent nodes, and draws nodes in graph order after all
required images have been resolved. A later request cancels the earlier
request's logical work. Cancellation is cooperative: the worker checks the
request ID before resource waits and before each node draw. The controller also
rejects or ignores results that do not match the latest request ID, so delayed
messages cannot overwrite a newer thumbnail.

## Message Protocol

Messages are discriminated plain objects. The exact protocol is:

```ts
interface ThumbnailRenderRequest {
  type: 'render'
  requestId: number
  scene: SceneGraph
  viewport: {
    width: number
    height: number
    devicePixelRatio?: number
  }
  resourceContext?: string
}

interface ThumbnailCancelRequest {
  type: 'cancel'
  requestId: number
}

interface ThumbnailResourceRequest {
  type: 'resource-request'
  requestId: number
  resourceRequestId: number
  assetId: string
  mimeType?: ImageMimeType
  resourceContext?: string
}

interface ThumbnailResourceResponse {
  type: 'resource-response'
  requestId: number
  resourceRequestId: number
  assetId: string
  data?: Uint8Array
  mimeType?: ImageMimeType
  error?: {
    code: 'missing-asset' | 'resource-failed'
    message: string
  }
}

interface ThumbnailRenderResponse {
  type: 'render-result'
  requestId: number
  bitmap?: ImageBitmap
  result: ThumbnailRenderResult
}
```

`ThumbnailRenderResult` contains `drawnNodeIds`, `skippedNodeIds`, and
`issues`. Each issue has `nodeId`, optional `assetId`, a stable code, and a
string message. The result itself is safe to pass through `structuredClone`;
the optional `ImageBitmap` is transferred separately and must be closed by the
consumer after it is painted or replaced.

The main thread answers a resource request only for the active render request.
The worker rejects unknown resource request IDs, and the controller never
resolves a stale render with a newer bitmap.

## Rendering Rules

The worker uses the same EMU-to-pixel conversion and local-coordinate image
painting rules as `image-canvas-renderer.ts`:

1. Set the backing store to the requested pixel dimensions and clear it.
2. Map each node's EMU bounds into the thumbnail viewport while preserving the
   page aspect ratio.
3. Save state per image node, translate to the node center, apply rotation and
   flips, apply the supported mask and effects, then draw the valid source crop.
4. Restore state in `finally`, including when clipping or `drawImage` fails.
5. Continue with later image nodes after a node-local load, decode, or draw
   failure.

Invalid or empty source crops use the full source image, matching the existing
browser image renderer. Alpha effects multiply the current alpha and
`grayscl` sets the Canvas2D filter to grayscale. Unsupported node kinds do not
produce diagnostics in this image-only slice.

## Resource and Cache Lifecycle

The main thread remains the source of truth for asset bytes. It calls the
existing `AssetAdapter.get(assetId)` contract and uses the optional resource
context to select the host-side asset namespace when the host adapter needs
one. Adapter errors are converted to stable strings before responding to the
worker.

The worker cache is keyed by `assetId` and stores successful decoded images and
in-flight promises. Failed loads are not retained after the request completes,
so a later retry can recover from a transient resource failure. `clear-cache`
closes decoded resources when `close()` is available. Worker termination also
closes cached resources where possible.

The controller transfers a current `ImageBitmap` into the visible canvas
immediately. It closes stale or unpaintable bitmaps, including results that
arrive after cancellation or disposal. Resource bridge messages are ignored
after disposal. No adapter or bitmap is leaked across a worker restart.

## Failure Semantics

- Missing adapter data produces `missing-asset` for each affected node.
- Adapter rejection produces `resource-failed`.
- Bitmap decode rejection produces `decode-failed`.
- Canvas creation or worker draw failure produces `worker-failed` or
  `draw-failed` at the request level as appropriate.
- A cancelled or stale request produces no visible result and does not count as
  a rendering failure.
- One failed image never prevents later image nodes from being attempted.

All exposed messages are bounded, deterministic strings. Raw `Error` objects,
DOM objects, and adapter instances are never included in result data.

## Public API

The editor package exposes a dependency-injected factory so unit tests do not
need to construct a real browser worker:

```ts
export interface ThumbnailWorkerFactory {
  create(): ThumbnailWorkerPort
}

export interface ThumbnailWorkerPort {
  postMessage(message: unknown, transfer?: Transferable[]): void
  terminate(): void
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

export interface ThumbnailRendererOptions {
  adapter: AssetAdapter
  workerFactory?: ThumbnailWorkerFactory
  resourceContext?: string
}

export interface ThumbnailViewport {
  width: number
  height: number
  devicePixelRatio?: number
}

export interface ThumbnailRenderer {
  render(scene: SceneGraph, canvas: HTMLCanvasElement, viewport: ThumbnailViewport): Promise<ThumbnailRenderResult>
  cancel(): void
  dispose(): void
}
```

The default factory creates the bundled worker and requires worker-side
`OffscreenCanvas`, `transferToImageBitmap()`, and a visible-canvas
`bitmaprenderer` context. The Vue thumbnail host is a thin lifecycle wrapper:
it observes scene and viewport changes, cancels stale requests, delegates
bitmap presentation to the controller, emits the result, and disposes the
renderer on unmount. It owns no painting logic.

## Verification

Tests cover:

- clone-safe request construction and message discrimination;
- resource bridge lookup, MIME propagation, and adapter failure conversion;
- asset decode deduplication and worker cache reuse;
- crop, masks, rotation, flips, alpha, grayscale, and node ordering;
- per-node failure isolation and stable diagnostics;
- cancellation and stale-result suppression;
- bitmap transfer, closing replaced results, disposal, and worker errors;
- package boundary checks, type checking, build, and the existing UnoCSS-only
  dependency scan.

The first implementation slice may use a fake worker and fake canvas in unit
tests. A Chromium smoke test must additionally verify that a real
`OffscreenCanvas` produces a non-empty `ImageBitmap` and that a second request
supersedes the first one.

## Explicit Non-Goals

- Rendering non-image scene nodes in the worker.
- Reusing the main-thread `AssetAdapter` object inside the worker.
- Automatic fallback to main-thread Canvas2D when OffscreenCanvas is absent.
- Thumbnail virtualization, priority queues, or LRU eviction policy beyond the
  worker's per-asset cache; those can be added after the protocol is stable.
- UI changes outside the thumbnail host required to consume this API.
