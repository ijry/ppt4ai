# Stage 7 Image Transform and Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import and browser-render OOXML image rotation, flips, source crop, basic preset masks, alpha modulation, and grayscale effects.

**Architecture:** `@ppt4ai/model` owns JSON-safe transform, crop, mask, and effect contracts. `@ppt4ai/pptx-import` maps optional OOXML picture fragments into that contract, while `@ppt4ai/render` copies the data unchanged into `SceneImageNode`. `@ppt4ai/editor` remains the browser-only consumer and applies transforms and effects around its existing decoded-image cache.

**Tech Stack:** TypeScript 6, Vitest 4, Vue 3, Canvas 2D, UnoCSS; no new runtime dependencies.

## Global Constraints

- Keep `@ppt4ai/model`, `@ppt4ai/render`, and `@ppt4ai/pptx-import` headless: no DOM, Canvas, Vue, or browser globals.
- Keep transform and render result data JSON-safe and `structuredClone`-safe.
- Use EMU bounds unchanged; rotation uses OOXML 1/60000 degree units.
- Only support `rect`, `roundRect`, `ellipse`, and `triangle` image mask presets.
- Only support `alphaModFix` and `grayscl` effects in this slice.
- Ignore malformed optional picture fragments without dropping an otherwise valid image.
- Do not add Element Plus or any new runtime dependency.
- Commit each completed task independently.

---

## File Structure

- Modify: `packages/model/src/index.ts` - image transform/crop/effect types and validation.
- Modify: `packages/model/src/model.test.ts` - model validation and clone-safe contract tests.
- Modify: `packages/pptx-import/src/importer.ts` - optional OOXML picture transform parsing.
- Modify: `packages/pptx-import/src/importer.test.ts` - picture fixture assertions and malformed-fragment tests.
- Modify: `packages/render/src/scenegraph.ts` - copy image appearance data to SceneGraph nodes.
- Modify: `packages/render/src/scene.test.ts` - SceneGraph preservation tests.
- Modify: `packages/editor/src/image-canvas-renderer.ts` - Canvas transform, crop, mask, and effect painter.
- Modify: `packages/editor/src/image-canvas-renderer.test.ts` - deterministic Canvas operation and failure-isolation tests.
- Modify: `进度.md` - record the completed transform/effects slice and its verification.

### Task 1: Define Image Appearance Contract

**Files:**
- Modify: `packages/model/src/index.ts:221-240, 894-906`
- Test: `packages/model/src/model.test.ts:501-545`

**Interfaces:**
- Produces `ElementTransform`, `ImageCrop`, and `ImageEffect` for importer, SceneGraph, and browser renderer.
- Extends `ImageElement` with optional `transform`, `sourceCrop`, `maskPreset`, and `effects` fields.

- [ ] **Step 1: Write the failing model tests**

Add a valid image document that uses all optional image appearance fields and
asserts both validation and cloning:

```ts
const image = {
  id: 'img_1', kind: 'image' as const, bounds: { x: 0, y: 0, w: 100, h: 100 },
  assetId: 'asset_1',
  transform: { rotation: 5400000, flipH: true, flipV: false },
  sourceCrop: { left: 1000, top: 2000, right: 3000, bottom: 4000 },
  maskPreset: 'ellipse' as const,
  effects: [{ type: 'alphaModFix' as const, amount: 50000 }, { type: 'grayscl' as const }],
}
expect(validateDocument(document)).toEqual({ valid: true })
expect(structuredClone(document)).toEqual(document)
```

Add one invalid document and assert exact diagnostics for a fractional rotation,
invalid flip value, crop outside `0..100000`, unsupported mask, invalid alpha
amount, and unsupported effect type.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `pnpm exec vitest run packages/model/src/model.test.ts`

Expected: FAIL because `ImageElement` does not yet accept appearance fields and
the validator does not reject invalid appearance values.

- [ ] **Step 3: Implement the model types and validation**

Add the public types beside the existing image asset types:

```ts
export interface ElementTransform {
  rotation?: number
  flipH?: boolean
  flipV?: boolean
}

export interface ImageCrop { left?: number; top?: number; right?: number; bottom?: number }
export type ImageEffect = { type: 'alphaModFix'; amount: number } | { type: 'grayscl' }
```

Extend `ImageElement`, then add dedicated validation helpers that require an
integer rotation, boolean flips, crop/effect percentage integers in
`0..100000`, supported `PresetGeometry` masks, and only the two declared effect
variants. Call these helpers from the existing `element.kind === 'image'`
validation branch.

- [ ] **Step 4: Run the focused test to verify success**

Run: `pnpm exec vitest run packages/model/src/model.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the model contract**

```bash
git add packages/model/src/index.ts packages/model/src/model.test.ts
git commit -m "feat: model image transforms and effects"
```

### Task 2: Import Optional OOXML Picture Appearance

**Files:**
- Modify: `packages/pptx-import/src/importer.ts:545-562`
- Test: `packages/pptx-import/src/importer.test.ts:125-280`

**Interfaces:**
- Consumes `ElementTransform`, `ImageCrop`, `ImageEffect`, and `ImageElement` from `@ppt4ai/model`.
- Produces image elements with optional `transform`, `sourceCrop`, `maskPreset`, and `effects` fields.

- [ ] **Step 1: Write failing importer tests**

Create a slide picture fixture containing:

```xml
<a:xfrm rot="5400000" flipH="1" flipV="0"/>
<a:blipFill><a:blip r:embed="rId2"><a:alphaModFix amt="50000"/><a:grayscl/></a:blip><a:srcRect l="1000" t="2000" r="3000" b="4000"/></a:blipFill>
<a:spPr><a:prstGeom prst="ellipse"/></a:spPr>
```

Assert the imported element exactly contains the expected transform, crop, mask,
and source-ordered effects. Add a second fixture with invalid `rot`, `flipH`,
crop percentages, mask preset, and alpha amount; assert the image still imports
with no corresponding invalid optional properties.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `pnpm exec vitest run packages/pptx-import/src/importer.test.ts`

Expected: FAIL because `parsePicture` only returns bounds and `assetId`.

- [ ] **Step 3: Implement tolerant picture parsers**

Add helper functions beside `parsePicture`:

```ts
function parsePictureTransform(picture: XmlNode): ElementTransform | undefined
function parseImageCrop(picture: XmlNode): ImageCrop | undefined
function parseImageMaskPreset(picture: XmlNode): PresetGeometry | undefined
function parseImageEffects(picture: XmlNode): ImageEffect[] | undefined
```

Read only the picture-local nodes, accept explicit `1`/`true` and `0`/`false`
flip values, use the existing percentage parser for crop/effect values, and
return `undefined` when a whole optional fragment has no valid content. Build
the image element with conditional properties so default imports remain stable.

- [ ] **Step 4: Run the focused test to verify success**

Run: `pnpm exec vitest run packages/pptx-import/src/importer.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit importer support**

```bash
git add packages/pptx-import/src/importer.ts packages/pptx-import/src/importer.test.ts
git commit -m "feat: import image transforms and effects"
```

### Task 3: Preserve Image Appearance in SceneGraph

**Files:**
- Modify: `packages/render/src/scenegraph.ts:59-65, 236-246`
- Test: `packages/render/src/scene.test.ts:117-158`

**Interfaces:**
- Consumes extended model `ImageElement` properties.
- Produces `SceneImageNode` properties `transform?: ElementTransform`, `sourceCrop?: ImageCrop`, `maskPreset?: PresetGeometry`, and `effects?: ImageEffect[]`.

- [ ] **Step 1: Write the failing SceneGraph test**

Extend the existing image document test with all four optional fields and assert
the produced image node has a deep-equal copy:

```ts
expect(graph.nodes[1]).toMatchObject({
  transform: { rotation: 5400000, flipH: true },
  sourceCrop: { left: 1000, right: 3000 },
  maskPreset: 'ellipse',
  effects: [{ type: 'alphaModFix', amount: 50000 }, { type: 'grayscl' }],
})
expect(structuredClone(graph)).toEqual(graph)
```

Mutate the source element after graph creation and assert the node appearance
data remains unchanged.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `pnpm exec vitest run packages/render/src/scene.test.ts`

Expected: FAIL because `SceneImageNode` only exposes bounds, asset ID, and metadata.

- [ ] **Step 3: Copy appearance fields into image nodes**

Extend `SceneImageNode` with the optional model types. In `createImageNode`,
conditionally add `structuredClone(element.transform)`,
`structuredClone(element.sourceCrop)`, `element.maskPreset`, and
`structuredClone(element.effects)`.

- [ ] **Step 4: Run the focused test to verify success**

Run: `pnpm exec vitest run packages/render/src/scene.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit SceneGraph propagation**

```bash
git add packages/render/src/scenegraph.ts packages/render/src/scene.test.ts
git commit -m "feat: preserve image appearance in scene graph"
```

### Task 4: Paint Image Transforms, Masks, Crops, and Effects

**Files:**
- Modify: `packages/editor/src/image-canvas-renderer.ts:1-171`
- Test: `packages/editor/src/image-canvas-renderer.test.ts:24-67, 90-215`

**Interfaces:**
- Consumes the extended `SceneImageNode` and existing `DecodedImage` dimensions.
- Preserves `ImageCanvasRenderer.render(scene, context, viewport)` and `ImageRenderResult`.

- [ ] **Step 1: Write failing renderer tests**

Extend the recording context to capture `save`, `restore`, `translate`, `rotate`,
`scale`, `beginPath`, `ellipse`, `rect`, `moveTo`, `lineTo`, `closePath`, `clip`,
`filter`, `globalAlpha`, and nine-argument `drawImage` calls. Add tests that
assert:

```ts
// A 200x100 source with left=10000, top=20000, right=30000, bottom=10000.
expect(draw.args).toEqual([source, 20, 20, 120, 70, -150, -200, 300, 400])
expect(context.rotations).toEqual([Math.PI / 2])
expect(context.scales).toContainEqual([-1, 1])
expect(context.ellipses).toContainEqual([0, 0, 150, 200, 0, 0, Math.PI * 2])
expect(context.globalAlpha).toBe(0.5)
expect(context.filter).toBe('grayscale(1)')
```

Also assert per-node `save`/`restore` pairing and that an effect/clip/draw
exception still reports `draw-failed` while a following image is painted.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `pnpm exec vitest run packages/editor/src/image-canvas-renderer.test.ts`

Expected: FAIL because the renderer only calls the five-argument `drawImage`.

- [ ] **Step 3: Implement deterministic image painting helpers**

Add helpers in `image-canvas-renderer.ts`:

```ts
function cropSource(image: DecodedImage, crop: ImageCrop | undefined): [number, number, number, number] | undefined
function applyMask(context: CanvasRenderingContext2D, preset: PresetGeometry, width: number, height: number): void
function applyEffects(context: CanvasRenderingContext2D, effects: ImageEffect[] | undefined): void
function drawImageNode(context: CanvasRenderingContext2D, node: SceneImageNode, image: DecodedImage): void
```

`drawImageNode` must save state, translate to the bounds center, rotate
`rotation * Math.PI / 10_800_000`, scale flips, clip the supported mask in local
bounds coordinates, multiply `alphaModFix` amounts into `globalAlpha`, set
`filter` to `grayscale(1)` when needed, draw from the valid crop source, and
restore state in `finally`. It must draw in local coordinates `-w/2`, `-h/2` so
rotation and flips stay centered. Invalid or empty crop rectangles fall back to
the full source. Leave cache, cancellation, and diagnostic contracts unchanged.

- [ ] **Step 4: Run focused renderer tests to verify success**

Run: `pnpm exec vitest run packages/editor/src/image-canvas-renderer.test.ts`

Expected: PASS.

- [ ] **Step 5: Run integration verification and record progress**

Update `进度.md` to mark image transforms/effects complete and list crop,
mask, rotation, flip, alpha, and grayscale support. Then run:

```bash
pnpm test
pnpm check:boundaries
pnpm typecheck
pnpm build
git diff --check
rg -n "element-plus" package.json pnpm-lock.yaml packages apps
```

Expected: all tests, boundaries, type checks, build, diff check, and dependency
scan pass with no Element Plus match.

- [ ] **Step 6: Commit the browser renderer slice**

```bash
git add packages/editor/src/image-canvas-renderer.ts packages/editor/src/image-canvas-renderer.test.ts 进度.md
git commit -m "feat: render image transforms and effects"
```
