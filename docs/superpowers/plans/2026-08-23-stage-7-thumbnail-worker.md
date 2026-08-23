# Stage 7 Thumbnail Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render image-only slide thumbnails in a Chromium `Worker` with
`OffscreenCanvas`, including existing image transforms and stale-request
protection, without adding runtime dependencies.

**Architecture:** Keep `@ppt4ai/model` and `@ppt4ai/render` headless. Extract
the existing image paint operation into a shared editor helper, run that helper
inside a dedicated module worker, and use a main-thread controller as the only
owner of `AssetAdapter` and the visible canvas. Worker messages contain only
structured-clone-safe scene data, resource bytes, diagnostics, and transferred
`ImageBitmap` values.

**Tech Stack:** TypeScript, Vite module workers, Canvas2D,
`OffscreenCanvas`, `ImageBitmap`, Vue 3, Vitest, Playwright Chromium, UnoCSS.

## Global Constraints

- Target client is **modern Chromium desktop**; do not add a compatibility
  fallback for Firefox, Safari, or mobile editing.
- `@ppt4ai/model`, `@ppt4ai/render`, and `@ppt4ai/pptx-import` remain free of
  DOM, Canvas, Vue, and worker imports.
- The only supported worker painting scope is `SceneImageNode`; shape, text,
  table, chart, and group thumbnail painting remain non-goals.
- The main thread owns `AssetAdapter`; no adapter instance or class instance
  crosses the worker boundary.
- Results and diagnostics remain `structuredClone`-safe; `ImageBitmap` is
  transferred and closed by its owner after presentation or disposal.
- Do not add Element Plus or any new runtime dependency; the editor UI uses
  UnoCSS and existing Vue dependencies only.
- Each completed task ends with focused verification and its own git commit.

---

### Task 1: Extract Shared Image Paint Semantics and Define Protocol

**Files:**
- Create: `packages/editor/src/image-painting.ts`
- Create: `packages/editor/src/thumbnail-protocol.ts`
- Modify: `packages/editor/src/image-canvas-renderer.ts`
- Modify: `packages/editor/src/image-canvas-renderer.test.ts`
- Test: `packages/editor/src/thumbnail-protocol.test.ts`

**Interfaces:**
- Consumes: existing `SceneImageNode`, `DecodedImage`, `ImageCrop`,
  `ImageEffect`, and `PresetGeometry` types.
- Produces: `paintImageNode(context, node, image, bounds)` for both the current
  editor renderer and the Worker; discriminated thumbnail message/result types
  and stable issue codes for later tasks.

- [ ] **Step 1: Write failing protocol tests**

Add tests that construct every message variant and assert they survive
`structuredClone`. Reject a message with an unknown `type`, missing positive
`requestId`, malformed viewport dimensions, or a resource response containing
  neither `data` nor `error`:

```ts
expect(isThumbnailMessage(structuredClone({
  type: 'render', requestId: 1, scene, viewport: { width: 96, height: 54 },
}))).toBe(true)
expect(isThumbnailMessage({ type: 'render', requestId: 0 })).toBe(false)
expect(isThumbnailMessage({ type: 'unknown' })).toBe(false)
```

Extend the existing renderer recording context test fixture so it can assert
that a shared painter receives local bounds and always pairs `save`/`restore`.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm exec vitest run packages/editor/src/thumbnail-protocol.test.ts packages/editor/src/image-canvas-renderer.test.ts`

Expected: FAIL because the protocol guards and shared painter do not exist.

- [ ] **Step 3: Implement the clone-safe protocol and shared painter**

Define these types in `thumbnail-protocol.ts`:

```ts
export type ThumbnailIssueCode =
  | 'missing-asset' | 'resource-failed' | 'decode-failed'
  | 'draw-failed' | 'worker-failed'

export interface ThumbnailRenderResult {
  drawnNodeIds: string[]
  skippedNodeIds: string[]
  issues: Array<{ nodeId: string; assetId?: string; code: ThumbnailIssueCode; message: string }>
}
```

Add discriminated request/response unions matching the design spec and an
`isThumbnailMessage(value: unknown): boolean` guard. Keep the guard structural
and JSON-safe. In `image-painting.ts`, move crop validation, mask construction,
effect application, and the centered transform draw from
`image-canvas-renderer.ts`; accept an explicit pixel `Rect` so the worker can
map EMU bounds to thumbnail pixels. Preserve the existing invalid-crop
full-source fallback and `finally` restore behavior.

- [ ] **Step 4: Run focused tests to verify success**

Run: `pnpm exec vitest run packages/editor/src/thumbnail-protocol.test.ts packages/editor/src/image-canvas-renderer.test.ts`

Expected: PASS, with all existing image transform tests unchanged in behavior.

- [ ] **Step 5: Commit the shared contract slice**

```bash
git add packages/editor/src/image-painting.ts packages/editor/src/thumbnail-protocol.ts packages/editor/src/image-canvas-renderer.ts packages/editor/src/image-canvas-renderer.test.ts packages/editor/src/thumbnail-protocol.test.ts
git commit -m "refactor: share image painting semantics with thumbnails"
```

### Task 2: Implement the Image Thumbnail Worker Runtime

**Files:**
- Create: `packages/editor/src/thumbnail-worker.ts`
- Create: `packages/editor/src/thumbnail-worker.test.ts`
- Modify: `packages/editor/src/thumbnail-protocol.ts`

**Interfaces:**
- Consumes: protocol unions and `paintImageNode` from Task 1.
- Produces: `createThumbnailWorkerRuntime(deps)` and a module-worker entry
  whose `onmessage` handles render, cancel, and resource-response messages.

- [ ] **Step 1: Write failing worker runtime tests**

Use fake `OffscreenCanvas`, context, `createImageBitmap`, and `postMessage`
dependencies. Assert that a render request emits a resource request, decodes
the returned bytes with the supplied MIME type, draws image nodes in graph
order, and emits a transferred bitmap. Include a repeated `assetId` test that
expects one resource request and one decode.

Add failure-isolation assertions:

```ts
expect(result.skippedNodeIds).toEqual(['missing'])
expect(result.drawnNodeIds).toEqual(['good'])
expect(result.issues[0]).toMatchObject({ code: 'missing-asset' })
```

Add cancellation tests where `cancel` arrives while a resource promise is
pending; no render result or bitmap may be posted for that request.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm exec vitest run packages/editor/src/thumbnail-worker.test.ts`

Expected: FAIL because the runtime and worker entry do not exist.

- [ ] **Step 3: Implement worker runtime and cache**

Implement dependency injection with these minimum dependencies:

```ts
interface ThumbnailWorkerRuntimeDeps {
  createCanvas(width: number, height: number): OffscreenCanvas
  decode(data: Uint8Array, mimeType?: ImageMimeType): Promise<DecodedImage>
  post(message: ThumbnailWorkerResponse, transfer?: Transferable[]): void
}
```

The runtime must create one canvas per runtime, size it to positive integer
viewport pixels, clear it, and preserve page aspect ratio with a uniform
scale and centered letterbox. Resolve assets by posting a
`resource-request`, keeping in-flight promises keyed by `assetId`, then call
`paintImageNode` with mapped pixel bounds. Check the active request ID before
and after each asynchronous wait and before each draw. Convert all caught
errors to bounded strings and continue after node-local failures.

On success call `transferToImageBitmap()` and post the bitmap in the transfer
list. Add a `dispose`/`clearCache` path that calls `close()` on decoded sources.
Export a `createThumbnailWorkerEntry()` adapter that binds the runtime to
`self.onmessage`; keep the entry's worker-global setup in this file so Vite can
bundle it as `new Worker(new URL('./thumbnail-worker.ts', import.meta.url))`.

- [ ] **Step 4: Run focused tests to verify success**

Run: `pnpm exec vitest run packages/editor/src/thumbnail-worker.test.ts`

Expected: PASS, including clone-safe diagnostics, resource deduplication,
appearance painting, cancellation, and bitmap transfer assertions.

- [ ] **Step 5: Commit the worker runtime slice**

```bash
git add packages/editor/src/thumbnail-worker.ts packages/editor/src/thumbnail-worker.test.ts packages/editor/src/thumbnail-protocol.ts
git commit -m "feat: add image thumbnail worker runtime"
```

### Task 3: Add Main-Thread Controller and Resource Bridge

**Files:**
- Create: `packages/editor/src/thumbnail-renderer.ts`
- Create: `packages/editor/src/thumbnail-renderer.test.ts`
- Modify: `packages/editor/src/thumbnail-protocol.ts`

**Interfaces:**
- Consumes: `ThumbnailWorkerPort`, protocol messages, `AssetAdapter`, and
  `SceneGraph` from Tasks 1-2.
- Produces: `createThumbnailRenderer(options)` with `render`, `cancel`, and
  `dispose`; the controller owns worker creation, request IDs, bridge replies,
  visible-canvas bitmap presentation, and stale-result suppression.

- [ ] **Step 1: Write failing controller tests**

Create a fake worker that records messages and can deliver responses manually.
Assert `render` posts a structured-cloned scene, a positive request ID, and a
viewport; the controller responds to a worker `resource-request` by calling
`adapter.get(assetId)` and posting the bytes with MIME metadata from the
document asset metadata when available.

Test that a second render posts `cancel` for the first request, that a late
first response is ignored and its bitmap is closed, and that only the latest
result is drawn through `bitmaprenderer.transferFromImageBitmap`.

Test adapter missing/rejection conversion, worker errors, render rejection,
and disposal. No bridge request may be answered after `dispose()`.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm exec vitest run packages/editor/src/thumbnail-renderer.test.ts`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement controller lifecycle**

Use the public shape from the design spec:

```ts
createThumbnailRenderer({ adapter, workerFactory, resourceContext })
renderer.render(scene, canvas, { width, height, devicePixelRatio })
renderer.cancel()
renderer.dispose()
```

Require `canvas.getContext('bitmaprenderer')`; reject with a stable
`worker-failed` error if the Chromium target cannot present an `ImageBitmap`.
Transfer only the scene clone and response byte buffers. Track the active
request and pending resource requests; reject stale promises, close stale
bitmaps, and terminate the worker exactly once on disposal. Normalize adapter
errors without exposing raw error objects. Do not import Vue or touch model
validation in this module.

- [ ] **Step 4: Run focused tests to verify success**

Run: `pnpm exec vitest run packages/editor/src/thumbnail-renderer.test.ts`

Expected: PASS, including request cancellation, resource bridge behavior,
bitmap presentation, errors, and disposal.

- [ ] **Step 5: Commit the controller slice**

```bash
git add packages/editor/src/thumbnail-renderer.ts packages/editor/src/thumbnail-renderer.test.ts packages/editor/src/thumbnail-protocol.ts
git commit -m "feat: add thumbnail worker controller"
```

### Task 4: Wire the Vue Thumbnail Host and Public Exports

**Files:**
- Create: `packages/editor/src/ThumbnailCanvas.vue`
- Create: `packages/editor/src/ThumbnailCanvas.test.ts`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- Consumes: `createThumbnailRenderer` from Task 3 and `AssetAdapter`/
  `SceneGraph` props.
- Produces: `<ThumbnailCanvas :scene="scene" :adapter="adapter" />` with
  UnoCSS-only presentation, render diagnostics emission, stale update
  cancellation, and unmount disposal.

- [ ] **Step 1: Write failing Vue host tests**

Inject a fake renderer factory or worker factory and mount the component with
Vue Test Utils-compatible existing test helpers. Assert it renders a canvas,
starts one request, rerenders when scene or viewport props change, calls
`cancel` before the next request, emits the clone-safe result, and calls
`dispose` on unmount. Assert the component has no Element Plus classes or
  imports and keeps stable canvas dimensions.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm exec vitest run packages/editor/src/ThumbnailCanvas.test.ts`

Expected: FAIL because the SFC and export do not exist.

- [ ] **Step 3: Implement the thin lifecycle wrapper**

Use props `scene`, `adapter`, `width`, `height`, `devicePixelRatio`, and
`resourceContext`; use a `data-thumbnail-canvas` marker and `class="block
max-w-full"`. Keep renderer creation injectable for tests, watch the scene and
viewport tuple with `flush: 'post'`, cancel the previous request before each
draw, emit `render`, and dispose on unmount. The component must not implement
resource loading or image painting.

Export the component, factory, and public types from `packages/editor/src/index.ts`.

- [ ] **Step 4: Run focused package tests**

Run: `pnpm exec vitest run packages/editor/src/ThumbnailCanvas.test.ts packages/editor/src/thumbnail-renderer.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the Vue integration slice**

```bash
git add packages/editor/src/ThumbnailCanvas.vue packages/editor/src/ThumbnailCanvas.test.ts packages/editor/src/index.ts
git commit -m "feat: expose thumbnail canvas host"
```

### Task 5: Chromium Smoke Test, Progress Record, and Full Verification

**Files:**
- Create: `apps/playground/src/thumbnail-smoke.ts`
- Modify: `apps/playground/src/App.vue`
- Modify: `进度.md`
- Modify: `playwright.config.ts`
- Create: `apps/playground/e2e/thumbnail.spec.ts`

**Interfaces:**
- Consumes: exported `ThumbnailCanvas` and the real worker/controller from
  Task 4.
- Produces: a deterministic Chromium smoke path proving a non-empty bitmap,
  resource bridge use, and latest-request-wins behavior.

- [ ] **Step 1: Add a minimal playground smoke fixture**

Create one valid `SceneGraph` with two image nodes backed by deterministic
data-URL or byte assets already supported by the browser decoder. Expose test
IDs for the thumbnail canvas and a render-result snapshot; keep the fixture
isolated from unrelated editor UI.

- [ ] **Step 2: Add the Playwright smoke assertions**

Start the playground server through the existing Playwright configuration and
assert the canvas has positive dimensions, the render result reports a drawn
node, and a second scene update leaves only the latest request visible. Read a
small pixel sample from the visible canvas and assert at least one non-zero
RGBA channel. Do not add a second browser project.

- [ ] **Step 3: Run the focused browser test**

Run: `pnpm exec playwright test apps/playground/e2e/thumbnail.spec.ts --project=chromium`

Expected: PASS in a current Chromium environment; if the browser binary is
unavailable, record that environment limitation without weakening unit tests.

- [ ] **Step 4: Update progress and run repository verification**

Mark the thumbnail Worker/OffscreenCanvas image-only slice complete in
`进度.md`, record supported transforms and cancellation semantics, and leave
non-image thumbnail painting explicitly deferred. Run:

```bash
pnpm test
pnpm check:boundaries
pnpm typecheck
pnpm build
git diff --check
rg -n "element-plus" package.json pnpm-lock.yaml packages apps
```

Expected: all tests, boundaries, type checks, build, and diff checks pass; the
dependency scan returns no matches.

- [ ] **Step 5: Commit the completed thumbnail slice**

```bash
git add apps/playground/src/thumbnail-smoke.ts apps/playground/src/App.vue apps/playground/e2e/thumbnail.spec.ts playwright.config.ts 进度.md
git commit -m "test: verify thumbnail worker in chromium"
```

## Plan Self-Review

- The design's protocol, resource bridge, cache, cancellation, diagnostics,
  bitmap ownership, and image-only scope are covered by Tasks 1-3.
- The Vue lifecycle and public package surface are covered by Task 4.
- Real Chromium validation and progress bookkeeping are covered by Task 5.
- No task requires Element Plus, a new runtime package, or a headless-package
  boundary violation.
- No task contains a placeholder, unnamed function, or undefined neighboring
  interface; `ThumbnailViewport`, `ThumbnailRenderResult`, and worker port
  types are defined in the preceding design and protocol tasks.
