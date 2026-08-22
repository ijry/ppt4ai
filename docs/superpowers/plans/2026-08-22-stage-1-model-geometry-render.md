# Stage 1 Model Geometry Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the first pure JSON document, geometry, and SceneGraph contracts so a slide can be normalized into deterministic render data.

**Architecture:** `@ppt4ai/model` owns JSON-safe document types and structural validation. `@ppt4ai/geometry` converts a small, explicit preset-shape set into deterministic SVG-like path strings without DOM or Canvas APIs. `@ppt4ai/render` converts a validated document into a JSON-only SceneGraph and does not paint pixels.

**Tech Stack:** TypeScript 6.0.3, Vitest 4.1.11, workspace packages, JSON snapshots.

## Global Constraints

- The document model is pure JSON and can be passed through `structuredClone`.
- EMU is the document coordinate unit; SceneGraph coordinates are numeric and deterministic.
- Headless packages cannot import Vue or use DOM globals.
- SceneGraph is a pure JSON intermediate representation suitable for snapshot tests and workers.
- No Canvas painter, editor interaction, inheritance resolver, or PPTX importer is added in this stage.
- Every completed stage ends with a focused test run, full verification, and one git commit.

---

### Task 1: Define the Minimal Document Model

**Files:**
- Modify: `packages/model/src/index.ts`
- Create: `packages/model/src/model.test.ts`

**Interfaces:**
- Produces `Ppt4aiDocument`, `Slide`, `Element`, `ShapeElement`, `TextElement`, `Rect`, and `validateDocument(document)`.
- `validateDocument` returns `{ valid: true }` or `{ valid: false, errors: string[] }` and never mutates input.

- [ ] **Step 1: Write the failing model tests**

```ts
it('accepts a minimal JSON document and rejects broken slide order', () => {
  expect(validateDocument(minimalDocument).valid).toBe(true)
  expect(validateDocument({ ...minimalDocument, slideOrder: ['missing'] }).valid).toBe(false)
})

it('keeps the contract structured-clone safe', () => {
  expect(structuredClone(minimalDocument)).toEqual(minimalDocument)
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec vitest run packages/model/src/model.test.ts`

Expected: FAIL because the model exports and fixture do not exist.

- [ ] **Step 3: Implement JSON-safe model types and validation**

Implement `Ppt4aiDocument` with `format: 'ppt4ai'`, `version: 1`, `page`, flat `slides`, flat `elements`, and `slideOrder`. Use discriminated `Element` unions for `shape` and `text`; shape geometry uses `preset` and `bounds`; validate duplicate/missing ids, slide references, element references, and positive page dimensions.

- [ ] **Step 4: Run the model tests**

Run: `pnpm exec vitest run packages/model/src/model.test.ts`

Expected: PASS.

### Task 2: Add Deterministic Preset Geometry

**Files:**
- Modify: `packages/geometry/src/index.ts`
- Create: `packages/geometry/src/geometry.test.ts`

**Interfaces:**
- Produces `PresetGeometry = 'rect' | 'roundRect' | 'ellipse' | 'triangle'`, `GeometryBounds`, and `createPresetPath(preset, bounds): PathCommand[]`.
- `PathCommand` is a JSON union of `{ type: 'move' | 'line'; x; y }`, `{ type: 'arc'; cx; cy; rx; ry; start; end }`, and `{ type: 'close' }`.

- [ ] **Step 1: Write the failing geometry tests**

```ts
it('creates a closed rectangle path in document coordinates', () => {
  expect(createPresetPath('rect', { x: 10, y: 20, w: 100, h: 50 })).toEqual([
    { type: 'move', x: 10, y: 20 },
    { type: 'line', x: 110, y: 20 },
    { type: 'line', x: 110, y: 70 },
    { type: 'line', x: 10, y: 70 },
    { type: 'close' },
  ])
})

it('keeps all preset outputs finite and closed', () => {
  for (const preset of ['rect', 'roundRect', 'ellipse', 'triangle'] as const) {
    const path = createPresetPath(preset, { x: 0, y: 0, w: 120, h: 80 })
    expect(path.at(-1)).toEqual({ type: 'close' })
    expect(JSON.stringify(path)).not.toContain('null')
  }
})
```

- [ ] **Step 2: Run the focused geometry test and verify it fails**

Run: `pnpm exec vitest run packages/geometry/src/geometry.test.ts`

Expected: FAIL because `createPresetPath` does not exist.

- [ ] **Step 3: Implement the four pure preset path generators**

Use only arithmetic on `GeometryBounds`; clamp round-rectangle radius to half the shorter side; use four quarter arcs for ellipse and a three-point polygon for triangle. Keep path output serializable and deterministic.

- [ ] **Step 4: Run the geometry tests**

Run: `pnpm exec vitest run packages/geometry/src/geometry.test.ts`

Expected: PASS.

### Task 3: Build the JSON SceneGraph

**Files:**
- Modify: `packages/render/src/index.ts`
- Create: `packages/render/src/scene.test.ts`
- Create: `packages/render/src/scenegraph.ts`

**Interfaces:**
- Produces `SceneGraph`, `SceneNode`, `SceneShapeNode`, `SceneTextNode`, and `documentToSceneGraph(document): SceneGraph`.
- `SceneGraph` contains `page: { w; h }` and ordered `nodes`; shape nodes contain `path: PathCommand[]`, fill/stroke; text nodes contain plain text and bounds.

- [x] **Step 1: Write the failing SceneGraph snapshot test**

```ts
it('converts a minimal slide into deterministic ordered nodes', () => {
  expect(documentToSceneGraph(minimalDocument)).toMatchInlineSnapshot(`
    {
      "nodes": [
        {
          "bounds": { "h": 2000000, "w": 4000000, "x": 1000000, "y": 1000000 },
          "fill": { "color": { "type": "srgb", "v": "4472C4" } },
          "id": "el_shape",
          "kind": "shape",
          "path": [
            { "type": "move", "x": 1000000, "y": 1000000 },
            { "type": "line", "x": 5000000, "y": 1000000 },
            { "type": "line", "x": 5000000, "y": 3000000 },
            { "type": "line", "x": 1000000, "y": 3000000 },
            { "type": "close" },
          ],
        },
      ],
      "page": { "h": 6858000, "w": 12192000 },
      "slideId": "sld_1",
    }
  `)
})
```

- [x] **Step 2: Run the snapshot test and verify it fails**

Run: `pnpm exec vitest run packages/render/src/scene.test.ts`

Expected: FAIL because `documentToSceneGraph` does not exist.

- [x] **Step 3: Implement deterministic model-to-scene conversion**

Select the first id in `slideOrder`, walk its `elementIds` in order, skip unsupported element kinds with no node, convert shape presets through `createPresetPath`, and preserve shape fill data as JSON. Convert text elements to `SceneTextNode` without performing text layout yet.

- [x] **Step 4: Run render tests and inspect the snapshot**

Run: `pnpm exec vitest run packages/render/src/scene.test.ts -u`

Expected: PASS with the stable inline snapshot matching the fixture.

### Task 4: Integrate, Verify, and Commit Stage 1

**Files:**
- Modify: `packages/model/src/index.ts`
- Modify: `packages/geometry/src/index.ts`
- Modify: `packages/render/src/index.ts`
- Modify: `进度.md`

- [x] **Step 1: Export the public contracts from package indexes**
- [x] **Step 2: Run focused model, geometry, and render tests**
- [x] **Step 3: Run `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, and `pnpm build`**
- [x] **Step 4: Update `进度.md` to mark Stage 1 complete and record evidence**
- [x] **Step 5: Commit the completed stage**

```bash
git add packages/model packages/geometry packages/render 进度.md docs/superpowers/plans/2026-08-22-stage-1-model-geometry-render.md
git commit -m "feat: add stage 1 model geometry and scene graph"
```
