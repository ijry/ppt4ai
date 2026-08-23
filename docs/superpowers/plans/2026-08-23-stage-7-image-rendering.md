# Stage 7 Browser Image Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paint imported bitmap assets into a browser Canvas from clone-safe SceneGraph image nodes while preserving headless package boundaries.

**Architecture:** `@ppt4ai/editor` owns a dependency-injected Canvas image renderer because it already has the browser/UI boundary. The renderer loads and caches assets by `assetId`, keeps viewport scale independent from decoded resources, and exposes clone-safe diagnostics; a Vue `ImageCanvas` component manages canvas lifecycle and stale-render cancellation.

**Tech Stack:** TypeScript 6, Canvas 2D, Chromium `createImageBitmap`, Vue 3.5, UnoCSS, Vitest 4, happy-dom.

## Global Constraints

- Support modern Chromium desktop only: latest two Chrome/Edge versions.
- Keep `@ppt4ai/model`, `@ppt4ai/render`, and `@ppt4ai/pptx-import` free of DOM, Canvas, browser globals, Vue, and binary document embedding.
- Add no Element Plus and no new runtime dependency; UI styling uses UnoCSS only.
- Keep document, SceneGraph, and render diagnostics `structuredClone` safe.
- Preserve EMU in model and SceneGraph; convert to CSS/backing-store pixels only while painting.
- Invalid, missing, or undecodable images skip only their own node.
- Use RED → GREEN TDD and commit each independently verified task.

---

### Task 1: Add ordered Canvas image painting

**Files:**
- Create: `packages/editor/src/image-canvas-renderer.test.ts`
- Create: `packages/editor/src/image-canvas-renderer.ts`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- Consumes: `SceneGraph`, `SceneImageNode`, `AssetAdapter`, and `ImageMimeType` from existing workspace packages.
- Produces: `createImageCanvasRenderer(options)`, `ImageCanvasRenderer.render(scene, context, viewport?)`, `DecodedImage`, `ImageDecoder`, `ImageRenderResult`, and `ImageViewport`.

- [ ] **Step 1: Write a failing ordered-paint test**

Create a recording adapter, decoder, and minimal Canvas context. Use a graph whose nodes are `image-a`, a non-image shape, and `image-b`. Assert exact calls and result:

```ts
const result = await renderer.render(scene, context, { zoom: 1.5, devicePixelRatio: 2 })

expect(context.canvas.width).toBe(Math.round(960 * 1.5 * 2))
expect(context.canvas.height).toBe(Math.round(540 * 1.5 * 2))
expect(context.canvas.style).toEqual({ width: '1440px', height: '810px' })
expect(context.transforms.at(-1)).toEqual([2 * 96 / 914400 * 1.5, 0, 0, 2 * 96 / 914400 * 1.5, 0, 0])
expect(context.draws.map((draw) => draw.source.id)).toEqual(['decoded-a', 'decoded-b'])
expect(context.draws.map((draw) => draw.bounds)).toEqual([imageA.bounds, imageB.bounds])
expect(result).toEqual({ drawnNodeIds: ['image-a', 'image-b'], skippedNodeIds: [], issues: [] })
expect(structuredClone(result)).toEqual(result)
```

Use page dimensions `9144000 × 5143500`, which equal `960 × 540` CSS pixels at 96 DPI.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm exec vitest run packages/editor/src/image-canvas-renderer.test.ts`

Expected: FAIL because `createImageCanvasRenderer` and the renderer contracts do not exist.

- [ ] **Step 3: Implement the minimal renderer**

Define these exact public contracts:

```ts
export interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  close?: () => void
}

export type ImageDecoder = (data: Uint8Array, mimeType?: ImageMimeType) => Promise<DecodedImage>

export interface ImageViewport {
  zoom?: number
  devicePixelRatio?: number
  signal?: AbortSignal
}

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
  zoom?: number
  devicePixelRatio?: number
}

export interface ImageCanvasRenderer {
  render(scene: SceneGraph, context: CanvasRenderingContext2D, viewport?: ImageViewport): Promise<ImageRenderResult>
  clearCache(): void
  dispose(): void
}
```

Implement `EMU_PER_CSS_PIXEL = 914400 / 96`. On every render, set the backing width/height to rounded CSS size times DPR, set HTML canvas CSS width/height to the unrounded zoomed page size, clear with the identity transform, then apply `dpr * zoom / EMU_PER_CSS_PIXEL`. Preload all image nodes with `Promise.all`, then call `drawImage(source, x, y, w, h)` in graph order. Ignore non-image nodes.

- [ ] **Step 4: Run focused GREEN checks**

Run: `pnpm exec vitest run packages/editor/src/image-canvas-renderer.test.ts; pnpm --filter @ppt4ai/editor typecheck`

Expected: PASS with exact ordered draw calls, high-DPI backing dimensions, CSS dimensions, and clone-safe result.

- [ ] **Step 5: Commit ordered painting**

```bash
git add packages/editor/src/image-canvas-renderer.ts packages/editor/src/image-canvas-renderer.test.ts packages/editor/src/index.ts
git commit -m "feat: paint image scene nodes"
```

### Task 2: Add cache, failures, cancellation, and disposal

**Files:**
- Modify: `packages/editor/src/image-canvas-renderer.test.ts`
- Modify: `packages/editor/src/image-canvas-renderer.ts`

**Interfaces:**
- Consumes: Task 1 renderer contracts.
- Produces: in-flight/success/failure cache deduplication, stable diagnostics, `AbortSignal` cancellation, and decoded-resource lifecycle.

- [ ] **Step 1: Add failing lifecycle tests**

Add independent tests that assert:

```ts
expect(adapter.getCalls).toEqual(['asset-shared'])
expect(decoder.calls).toHaveLength(1)
expect(result.drawnNodeIds).toEqual(['image-a', 'image-b'])
```

for duplicate nodes and concurrent `render` calls; then cover missing bytes, decoder rejection, and `drawImage` rejection:

```ts
expect(result.issues).toEqual([
  { nodeId: 'image-missing', assetId: 'asset-missing', code: 'missing-asset', message: 'asset not found' },
  { nodeId: 'image-bad', assetId: 'asset-bad', code: 'decode-failed', message: 'bad bitmap' },
  { nodeId: 'image-draw', assetId: 'asset-draw', code: 'draw-failed', message: 'draw rejected' },
])
expect(result.skippedNodeIds).toEqual(['image-missing', 'image-bad', 'image-draw'])
```

Assert `clearCache()` invokes each successful decoded image's `close` once, failed entries are retried after clearing, `dispose()` closes resources and rejects later renders with `renderer is disposed`, and an already-aborted signal returns no draw calls or diagnostics.

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run: `pnpm exec vitest run packages/editor/src/image-canvas-renderer.test.ts`

Expected: FAIL because Task 1 has no shared in-flight/failure cache or complete lifecycle behavior.

- [ ] **Step 3: Implement cached load outcomes**

Store `Map<string, Promise<LoadOutcome>>`, where `LoadOutcome` is either `{ status: 'ready'; image: DecodedImage }` or `{ status: 'failed'; code: 'missing-asset' | 'decode-failed'; message: string }`. Insert the promise before awaiting the adapter so duplicate/concurrent requests deduplicate. Convert unknown errors with:

```ts
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
```

Check `signal?.aborted` before loading and immediately before clearing/drawing. Aborted renders return `{ drawnNodeIds: [], skippedNodeIds: [], issues: [] }`. Catch each draw separately. `clearCache()` closes each distinct ready image once after its promise settles; `dispose()` marks the renderer disposed and delegates to `clearCache()`.

- [ ] **Step 4: Run focused lifecycle checks**

Run: `pnpm exec vitest run packages/editor/src/image-canvas-renderer.test.ts; pnpm --filter @ppt4ai/editor typecheck; git diff --check`

Expected: PASS with one adapter/decode operation per unique cached asset and stable per-node degradation.

- [ ] **Step 5: Commit lifecycle behavior**

```bash
git add packages/editor/src/image-canvas-renderer.ts packages/editor/src/image-canvas-renderer.test.ts
git commit -m "feat: cache decoded image assets"
```

### Task 3: Add the default Chromium bitmap decoder

**Files:**
- Create: `packages/editor/src/browser-image-decoder.test.ts`
- Create: `packages/editor/src/browser-image-decoder.ts`
- Modify: `packages/editor/src/image-canvas-renderer.ts`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- Consumes: Task 1 `DecodedImage` and `ImageDecoder` contracts.
- Produces: exported `decodeBrowserImage(data, mimeType?)`, used by default when no decoder is supplied.

- [ ] **Step 1: Write failing browser-decoder tests**

Stub only the unavoidable browser primitive `globalThis.createImageBitmap`. Capture its Blob argument and return a fake bitmap with width, height, and `close`. Assert:

```ts
const decoded = await decodeBrowserImage(new Uint8Array([1, 2, 3]), 'image/png')
expect(capturedBlob.type).toBe('image/png')
expect([...new Uint8Array(await capturedBlob.arrayBuffer())]).toEqual([1, 2, 3])
expect(decoded).toMatchObject({ source: bitmap, width: 320, height: 180 })
decoded.close?.()
expect(bitmap.close).toHaveBeenCalledOnce()
```

Also delete `createImageBitmap` and assert rejection with `createImageBitmap is unavailable`.

- [ ] **Step 2: Run decoder tests and verify RED**

Run: `pnpm exec vitest run packages/editor/src/browser-image-decoder.test.ts`

Expected: FAIL because `decodeBrowserImage` does not exist.

- [ ] **Step 3: Implement the default decoder**

Copy input bytes with `new Uint8Array(data)` before creating the Blob. Throw the exact unavailable message when `globalThis.createImageBitmap` is not a function. Return the bitmap as `source`, copy numeric width/height, and bind `close` to the bitmap. Make `createImageCanvasRenderer` use `decodeBrowserImage` when `options.decoder` is absent.

- [ ] **Step 4: Run decoder and renderer checks**

Run: `pnpm exec vitest run packages/editor/src/browser-image-decoder.test.ts packages/editor/src/image-canvas-renderer.test.ts; pnpm --filter @ppt4ai/editor typecheck`

Expected: PASS with exact Blob bytes/type and unchanged injected-decoder behavior.

- [ ] **Step 5: Commit the browser decoder**

```bash
git add packages/editor/src/browser-image-decoder.ts packages/editor/src/browser-image-decoder.test.ts packages/editor/src/image-canvas-renderer.ts packages/editor/src/index.ts
git commit -m "feat: decode browser image assets"
```

### Task 4: Add the Vue image canvas host

**Files:**
- Create: `packages/editor/src/ImageCanvas.vue`
- Create: `packages/editor/src/ImageCanvas.test.ts`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- Consumes: `SceneGraph`, `AssetAdapter`, Task 1 renderer, Task 3 default decoder.
- Produces: exported `ImageCanvas` Vue component with `scene`, `adapter`, optional `decoder`, `zoom`, and `devicePixelRatio` props plus a `render` event carrying `ImageRenderResult`.

- [ ] **Step 1: Write failing component tests**

In happy-dom, replace `HTMLCanvasElement.prototype.getContext` with a recording context and mount the component. Assert one canvas with UnoCSS-only classes and a completed event:

```ts
expect(host.querySelectorAll('canvas[data-image-canvas]')).toHaveLength(1)
expect(renderEvents.at(-1)).toEqual({ drawnNodeIds: ['image-a'], skippedNodeIds: [], issues: [] })
```

Update the `scene` prop before the first decoder promise settles, resolve both requests, and assert only the newest scene emits/draws. Change `zoom` and assert backing/CSS size changes without another adapter read. Unmount and assert the decoded image closes once.

- [ ] **Step 2: Run component tests and verify RED**

Run: `pnpm exec vitest run packages/editor/src/ImageCanvas.test.ts`

Expected: FAIL because `ImageCanvas.vue` does not exist.

- [ ] **Step 3: Implement canvas lifecycle**

Define props with these defaults:

```ts
const props = withDefaults(defineProps<{
  scene: SceneGraph
  adapter: AssetAdapter
  decoder?: ImageDecoder
  zoom?: number
  devicePixelRatio?: number
}>(), { zoom: 1 })
```

Create one renderer per `(adapter, decoder)` pair. Watch scene, zoom, devicePixelRatio, adapter, and decoder with `flush: 'post'`. Abort the previous controller before every draw, pass the signal and current viewport, and emit only if that controller remains current and un-aborted. Use `props.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1`. Dispose the renderer and abort on unmount. Render:

```vue
<canvas ref="canvas" class="block max-w-full" data-image-canvas />
```

- [ ] **Step 4: Run component and package checks**

Run: `pnpm exec vitest run packages/editor/src/ImageCanvas.test.ts packages/editor/src/browser-image-decoder.test.ts packages/editor/src/image-canvas-renderer.test.ts; pnpm --filter @ppt4ai/editor typecheck; pnpm --filter @ppt4ai/editor build; git diff --check`

Expected: PASS with stale draw suppression, cache reuse across zoom, and deterministic unmount cleanup.

- [ ] **Step 5: Commit the Vue host**

```bash
git add packages/editor/src/ImageCanvas.vue packages/editor/src/ImageCanvas.test.ts packages/editor/src/index.ts
git commit -m "feat: add image canvas component"
```

### Task 5: Record and verify the rendering milestone

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: Tasks 1 through 4 and the Stage 7 progress section.
- Produces: current cross-session handoff and complete repository verification.

- [ ] **Step 1: Update progress and deferred scope**

Record the browser Canvas renderer, stable diagnostics, decoded-resource cache, default Chromium decoder, Vue canvas host, and UnoCSS-only dependency boundary. Keep crop/mask/rotation/effects, thumbnails/workers, image editing, and PPTX image writeback explicitly deferred.

- [ ] **Step 2: Run focused and repository verification**

Run:

```bash
pnpm exec vitest run packages/editor/src/image-canvas-renderer.test.ts packages/editor/src/browser-image-decoder.test.ts packages/editor/src/ImageCanvas.test.ts packages/render/src/scene.test.ts packages/pptx-import/src/importer.test.ts packages/model/src/model.test.ts
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all focused and repository checks pass without a new runtime dependency or package-boundary violation.

- [ ] **Step 3: Commit the milestone record**

```bash
git add 进度.md
git commit -m "docs: record browser image rendering"
```

## Self-Review Checklist

- [x] Every requirement in `docs/superpowers/specs/2026-08-23-stage-7-image-rendering-design.md` maps to Tasks 1 through 5.
- [x] Browser globals and Canvas types remain confined to `@ppt4ai/editor`.
- [x] Cache keys, render result fields, issue codes, and component props use consistent names throughout.
- [x] Missing, decode, draw, cancellation, cache cleanup, and component unmount paths each have explicit tests.
- [x] No crop, transform, editing, export, thumbnail, worker, Element Plus, or new dependency work leaks into this slice.

