# Stage 7 Image Editing and Asset Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add atomic image insertion and replacement commands plus an asynchronous editor controller that stores validated bitmap bytes before changing the document.

**Architecture:** Extract the existing browser-independent bitmap header parser into `@ppt4ai/model` so PPTX import and editor uploads share one implementation. Keep `EditorEngine.dispatch()` synchronous and clone-safe; an editor-layer controller owns `AssetAdapter.put()`, then dispatches one engine command only after storage succeeds. Document metadata uses reference cleanup while adapter bytes remain host-owned for explicit garbage collection.

**Tech Stack:** TypeScript, `Uint8Array`, existing patch-based `EditorEngine`, Vitest, pnpm workspace packages, structured clone.

## Global Constraints

- `EditorEngine.dispatch()` remains synchronous and never calls `AssetAdapter`.
- The document and all engine command payloads remain JSON-safe and `structuredClone`-safe.
- Adapter writes complete before document mutation; a rejected write creates no history entry.
- Adapter bytes are never automatically deleted by the engine or editor controller.
- Replacement preserves element ID, bounds, z-order, transform, crop, mask, and effects.
- Insert bounds are supplied by the caller in EMU; no viewport or pixel placement policy enters the engine.
- Asset and element IDs are unique within the current document; no content hash or byte deduplication is added.
- PPTX media/relationship/`p:pic` writeback and asset-management UI remain separate follow-up slices.
- Do not add Element Plus, DOM, Canvas, or any new runtime dependency to headless packages.
- Each completed task ends with focused verification and its own git commit.

---

### Task 1: Extract Shared Bitmap Metadata Parsing

**Files:**
- Create: `packages/model/src/bitmap-metadata.ts`
- Test: `packages/model/src/bitmap-metadata.test.ts`
- Modify: `packages/model/src/index.ts`
- Modify: `packages/pptx-import/src/importer.ts`
- Test: `packages/pptx-import/src/importer.test.ts`

**Interfaces:**
- Consumes: existing `ImageMimeType` from `@ppt4ai/model` and the PNG, JPEG, GIF, BMP, and WebP byte semantics already implemented in `packages/pptx-import/src/importer.ts`.
- Produces: `parseBitmapMetadata(data: Uint8Array): BitmapMetadata | undefined`, where `BitmapMetadata` is `{ mimeType: ImageMimeType; pixelWidth: number; pixelHeight: number }`.

- [ ] **Step 1: Write failing model tests for every supported header**

Create `bitmap-metadata.test.ts` with compact fixtures for PNG, JPEG, GIF,
BMP, WebP VP8X, WebP VP8, and WebP VP8L. Assert exact MIME and positive pixel
dimensions, malformed/truncated data returning `undefined`, and no mutation of
the input bytes:

```ts
import { describe, expect, it } from 'vitest'
import { parseBitmapMetadata } from './bitmap-metadata'

it('reads PNG dimensions without mutating bytes', () => {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0, 12, 0, 0, 0, 34,
  ])
  const before = bytes.slice()
  expect(parseBitmapMetadata(bytes)).toEqual({
    mimeType: 'image/png', pixelWidth: 12, pixelHeight: 34,
  })
  expect(bytes).toEqual(before)
})

it('rejects malformed bitmap data', () => {
  expect(parseBitmapMetadata(new Uint8Array([0x89, 0x50, 0x4e]))).toBeUndefined()
})
```

- [ ] **Step 2: Run the focused model test to verify failure**

Run: `pnpm exec vitest run packages/model/src/bitmap-metadata.test.ts`

Expected: FAIL because `bitmap-metadata.ts` and `parseBitmapMetadata` do not exist.

- [ ] **Step 3: Move the existing parser into the model package**

Create a pure module with no browser or package-import dependencies:

```ts
import type { ImageMimeType } from './index'

export interface BitmapMetadata {
  mimeType: ImageMimeType
  pixelWidth: number
  pixelHeight: number
}

export function parseBitmapMetadata(data: Uint8Array): BitmapMetadata | undefined
```

Implement the parser using the exact existing format rules:

| Format | Required signature | Dimension source |
|---|---|---|
| PNG | 8-byte PNG signature and at least 24 bytes | big-endian 32-bit width/height at offsets 16/20 |
| GIF | `GIF87a` or `GIF89a` and at least 10 bytes | little-endian 16-bit width/height at offsets 6/8 |
| BMP | `BM`, at least 26 bytes, DIB size at least 12 | signed little-endian width/height at offsets 18/22; absolute height |
| WebP VP8X | `RIFF....WEBPVP8X` and at least 30 bytes | 24-bit little-endian minus-one values at offsets 24/27 |
| WebP VP8 | `RIFF....WEBPVP8 ` plus frame marker `9d 01 2a` | masked little-endian 16-bit values at offsets 26/28 |
| WebP VP8L | `RIFF....WEBPVP8L`, signature byte `2f` | packed 14-bit minus-one width/height at offsets 21-24 |
| JPEG | `ff d8 ff` | walk length-prefixed markers to the first supported SOF marker and read big-endian height/width |

Export the function and type from `packages/model/src/index.ts`. Reuse the
existing endian helpers and JPEG SOF marker set exactly. Keep all byte reads
bounds-checked and return `undefined` for zero dimensions, malformed marker
lengths, unsupported bytes, or truncated headers.

- [ ] **Step 4: Refactor importer to consume the shared parser**

Replace the local `bitmapMetadata()` and byte-reader helpers in
`packages/pptx-import/src/importer.ts` with the model export. Keep importer-only
filename and stable-ID assembly local:

```ts
function parseImportedBitmapMetadata(path: string, bytes: Uint8Array, assetId: string): AssetMetadata | undefined {
  const metadata = parseBitmapMetadata(bytes)
  return metadata
    ? { id: assetId, ...metadata, originalFilename: path.slice(path.lastIndexOf('/') + 1) }
    : undefined
}
```

Do not change imported IDs, metadata, adapter writes, or invalid-picture
fallback behavior.

- [ ] **Step 5: Run model and importer tests**

Run: `pnpm exec vitest run packages/model/src/bitmap-metadata.test.ts packages/pptx-import/src/importer.test.ts`

Expected: PASS with all existing picture fixtures retaining their current MIME,
dimensions, IDs, filenames, and exact adapter bytes.

- [ ] **Step 6: Commit the shared parser slice**

```bash
git add packages/model/src/bitmap-metadata.ts packages/model/src/bitmap-metadata.test.ts packages/model/src/index.ts packages/pptx-import/src/importer.ts packages/pptx-import/src/importer.test.ts
git commit -m "refactor: share bitmap metadata parsing"
```

---

### Task 2: Add Atomic Engine Image Commands

**Files:**
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/engine.test.ts`

**Interfaces:**
- Consumes: existing `ImageElement`, `AssetMetadata`, `Ppt4aiDocument`, `validateDocument()`, patch history, and synchronous `EditorEngine.dispatch()`.
- Produces these `EngineCommand` variants:

```ts
| { type: 'insertImage'; slideId: string; element: ImageElement; asset: AssetMetadata }
| { type: 'replaceImageAsset'; elementId: string; asset: AssetMetadata }
```

- [ ] **Step 1: Add failing insertion tests**

Extend `engine.test.ts` with a document containing one slide and no assets.
Dispatch a clone-safe image and matching metadata, then assert element and asset
registration, append-at-front z-order semantics, single selection, cleared
table-cell selection, one history entry, and payload isolation:

```ts
const element: ImageElement = {
  id: 'img_new', kind: 'image',
  bounds: { x: 100, y: 200, w: 300, h: 400 },
  assetId: 'asset_new',
}
const asset: AssetMetadata = {
  id: 'asset_new', mimeType: 'image/png', pixelWidth: 12, pixelHeight: 34,
}
const state = engine.dispatch({ type: 'insertImage', slideId: 'sld_1', element, asset })
expect(state.document.slides.sld_1?.elementIds.at(-1)).toBe('img_new')
expect(state.document.assets?.asset_new).toEqual(asset)
expect(state.selection).toEqual(['img_new'])
expect(state.history).toEqual({ undoDepth: 1, redoDepth: 0 })
```

Add table-driven rejection cases for missing slide, duplicate element ID,
duplicate asset ID, mismatched `element.assetId`/`asset.id`, invalid bounds, and
invalid metadata. Snapshot `engine.getState()` before each rejection and assert
the complete state is unchanged afterward.

- [ ] **Step 2: Add failing replacement and history tests**

Use two image elements that initially share `asset_old`. Replace the first and
assert `asset_old` remains while referenced. Replace the second in a separate
engine fixture and assert zero-reference `asset_old` is removed. Verify that
element ID, bounds, slide order, transform, crop, mask, and effects remain
identical except for `assetId`:

```ts
const before = engine.getState().document.elements.img_1 as ImageElement
const replaced = engine.dispatch({
  type: 'replaceImageAsset', elementId: 'img_1',
  asset: { id: 'asset_new', mimeType: 'image/jpeg', pixelWidth: 80, pixelHeight: 60 },
})
expect(replaced.document.elements.img_1).toEqual({ ...before, assetId: 'asset_new' })
```

Assert one undo restores the old reference and old metadata while removing the
new metadata; redo reapplies the replacement and reference cleanup. Add
rejections for missing element, non-image element, existing replacement asset
ID, and invalid metadata, with complete state unchanged.

- [ ] **Step 3: Run focused engine tests to verify failure**

Run: `pnpm exec vitest run packages/engine/src/engine.test.ts`

Expected: FAIL because the two image command variants are not accepted or dispatched.

- [ ] **Step 4: Implement validated image transactions**

Import `AssetMetadata` and `ImageElement`. Add the command variants and switch
cases, then implement focused private methods:

```ts
private insertImage(slideId: string, element: ImageElement, asset: AssetMetadata): void
private replaceImageAsset(elementId: string, asset: AssetMetadata): void
```

For insertion, reject duplicate element/asset IDs and mismatched IDs, construct
the candidate document, validate it, then call one `commit()` containing:

```ts
[
  { path: ['assets'], value: nextAssets },
  { path: ['elements', element.id], value: structuredClone(element) },
  { path: ['slides', slideId, 'elementIds'], value: [...slide.elementIds, element.id] },
]
```

After the commit, set selection to `[element.id]` and clear table-cell
selection. For replacement, require a fresh asset ID, clone the target with
only `assetId` changed, remove the old metadata only when no other image refers
to it, validate the candidate document, and commit both the full assets map and
the replacement element in one history entry. Do not access an adapter.

- [ ] **Step 5: Run focused engine verification**

Run: `pnpm exec vitest run packages/engine/src/engine.test.ts`

Expected: PASS for insertion, replacement, reference cleanup, rejection
atomicity, and undo/redo while all existing engine commands remain green.

- [ ] **Step 6: Commit the engine transaction slice**

```bash
git add packages/engine/src/index.ts packages/engine/src/engine.test.ts
git commit -m "feat: add image editing commands"
```

---

### Task 3: Add the Asynchronous Image Asset Controller

**Files:**
- Create: `packages/editor/src/image-asset-controller.ts`
- Test: `packages/editor/src/image-asset-controller.test.ts`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- Consumes: `EditorEngine`, `EngineState`, `AssetAdapter`, `ImageMimeType`, `Rect`, and `parseBitmapMetadata()`.
- Produces:

```ts
export interface ImageAssetControllerOptions {
  engine: EditorEngine
  assetAdapter: AssetAdapter
  assetIdFactory: () => string
}

export interface InsertImageAssetInput {
  slideId: string
  elementId: string
  bounds: Rect
  data: Uint8Array
  mimeType?: ImageMimeType
  originalFilename?: string
}

export interface ReplaceImageAssetInput {
  elementId: string
  data: Uint8Array
  mimeType?: ImageMimeType
  originalFilename?: string
}

export interface ImageAssetController {
  insert(input: InsertImageAssetInput): Promise<EngineState>
  replace(input: ReplaceImageAssetInput): Promise<EngineState>
}

export class ImageAssetControllerError extends Error {
  readonly orphanAssetIds: string[]
  constructor(message: string, options?: { cause?: unknown; orphanAssetIds?: string[] })
}

export function createImageAssetController(options: ImageAssetControllerOptions): ImageAssetController
```

- [ ] **Step 1: Write failing success-path controller tests**

Use a real `EditorEngine`, a recording `AssetAdapter`, deterministic asset IDs,
and the PNG fixture from Task 1. Assert that insertion derives actual MIME and
dimensions, copies optional filename, writes exact bytes before dispatch, and
returns the inserted engine state. Mutate the caller's input bytes after the
operation and assert the adapter's recorded bytes are unchanged.

For replacement, start with an image carrying transform/crop/mask/effects,
replace it with JPEG bytes, and assert the returned state preserves appearance
while changing only asset reference and metadata.

- [ ] **Step 2: Write failing validation and failure-order tests**

Cover these exact cases:

```ts
await expect(controller.insert({ ...input, data: malformed })).rejects.toMatchObject({
  orphanAssetIds: [],
})
await expect(controller.insert({ ...input, mimeType: 'image/jpeg' })).rejects.toThrow(
  'declared image MIME does not match bitmap data: image/jpeg != image/png',
)
```

Assert malformed bytes and MIME mismatch do not call `assetIdFactory`, adapter,
or engine. Assert adapter rejection leaves the engine state unchanged and
reports no orphan. Force dispatch failure after a successful adapter write by
using a duplicate element ID; assert `ImageAssetControllerError.orphanAssetIds`
contains the generated ID and engine state remains unchanged.

- [ ] **Step 3: Run focused controller tests to verify failure**

Run: `pnpm exec vitest run packages/editor/src/image-asset-controller.test.ts`

Expected: FAIL because the controller module and exports do not exist.

- [ ] **Step 4: Implement metadata preparation and operation ordering**

Implement one private operation helper that:

1. calls `parseBitmapMetadata(input.data)`;
2. rejects malformed data or optional MIME mismatch;
3. calls `assetIdFactory()` and rejects an empty ID;
4. constructs clone-safe `AssetMetadata` from actual header metadata;
5. copies bytes with `input.data.slice()` and awaits `assetAdapter.put()`;
6. dispatches `insertImage` or `replaceImageAsset` only after `put` resolves.

Wrap adapter failures in `ImageAssetControllerError` with an empty orphan list.
Wrap post-write dispatch failures with `[asset.id]`. Preserve the original
error as `cause`, but do not call a nonexistent adapter delete method.

- [ ] **Step 5: Export and verify the public API**

Export the factory, error class, and all controller/input/options types from
`packages/editor/src/index.ts`. Add a dynamic entry-point import assertion:

```ts
const editor = await import('./index')
expect(editor.createImageAssetController).toBe(createImageAssetController)
expect(editor.ImageAssetControllerError).toBe(ImageAssetControllerError)
```

Run: `pnpm exec vitest run packages/editor/src/image-asset-controller.test.ts`

Expected: PASS with exact adapter ordering, state atomicity, and orphan reporting.

- [ ] **Step 6: Commit the editor controller slice**

```bash
git add packages/editor/src/image-asset-controller.ts packages/editor/src/image-asset-controller.test.ts packages/editor/src/index.ts
git commit -m "feat: add image asset controller"
```

---

### Task 4: Verify and Record the Image Editing Milestone

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: the shared bitmap parser, synchronous image commands, and asynchronous controller completed in Tasks 1-3.
- Produces: a verified stage record and the handoff to PPTX image package writeback.

- [ ] **Step 1: Record the completed slice**

Update the stage 7 status and checklist in `进度.md` to state that image
insertion/replacement and metadata lifecycle are complete. Record these
boundaries explicitly:

- adapter bytes remain host-owned and are not automatically deleted;
- undo/redo restores document metadata and references synchronously;
- PPTX media/relationship/`p:pic` writeback is the next slice;
- UnoCSS asset-management UI follows writeback;
- shape/text/table/chart/group thumbnail painting remains deferred.

- [ ] **Step 2: Run focused package verification**

Run:

```bash
pnpm exec vitest run packages/model/src/bitmap-metadata.test.ts packages/pptx-import/src/importer.test.ts packages/engine/src/engine.test.ts packages/editor/src/image-asset-controller.test.ts
pnpm --filter @ppt4ai/model typecheck
pnpm --filter @ppt4ai/pptx-import typecheck
pnpm --filter @ppt4ai/engine typecheck
pnpm --filter @ppt4ai/editor typecheck
```

Expected: all focused tests and package typechecks PASS.

- [ ] **Step 3: Run repository verification**

Run:

```bash
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
rg -n "element-plus|ElementPlus|@element-plus" package.json pnpm-lock.yaml packages apps
```

Expected: boundary checks, all tests, typecheck, build, and diff checks PASS;
the Element Plus scan prints no matches.

- [ ] **Step 4: Commit the verified milestone record**

```bash
git add 进度.md
git commit -m "docs: record image asset editing"
```

## Plan Self-Review

- Task 1 covers the single shared PNG/JPEG/GIF/BMP/WebP metadata parser and
  preserves importer behavior without adding a package dependency.
- Task 2 covers synchronous clone-safe engine commands, atomic validation,
  selection, ordering, reference cleanup, and complete undo/redo restoration.
- Task 3 covers pre-dispatch validation, injected asset identity, adapter write
  ordering, byte isolation, adapter failure, post-write orphan reporting, and
  the public editor API.
- Task 4 covers progress bookkeeping, package verification, repository-wide
  regression checks, dependency boundaries, and the Element Plus prohibition.
- No task adds adapter deletion, content-addressed deduplication, viewport
  placement, PPTX package writeback, asset UI, or another deferred feature.
- All neighboring interfaces use the same names and payloads; no task contains
  a placeholder or an undefined follow-up contract.
