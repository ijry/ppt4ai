# Stage 7 Basic Shape Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render basic scene shapes inside the existing Worker/OffscreenCanvas thumbnail pipeline without changing its message protocol or asset bridge.

**Architecture:** Add one editor-internal Canvas helper that validates and paints `SceneShapeNode.path` using an explicit page-to-viewport mapping. Update the thumbnail worker's existing ordered node loop to dispatch shape nodes to that helper and image nodes to the current resource-backed painter, preserving per-node diagnostics and cancellation behavior.

**Tech Stack:** TypeScript 6, Canvas 2D/OffscreenCanvas, Vitest 4, pnpm workspace, existing `@ppt4ai/model` and `@ppt4ai/render` contracts.

## Global Constraints

- Supported shapes are exactly `rect`, `roundRect`, `ellipse`, and `triangle` as represented by existing `PathCommand[]` values.
- Text, tables, charts, groups, gradients, pattern fills, configurable line widths/dashes, shape transforms, and shape-specific effects remain out of scope.
- The thumbnail message protocol and clone-safe result shape must not change.
- Shapes must never issue asset resource requests or enter the image cache.
- Shape and image nodes must paint in `SceneGraph.nodes` order.
- One shape draw failure must produce `draw-failed` and must not prevent later nodes from rendering.
- No runtime dependency may be added; editor UI dependencies remain Vue, Vue-I18n, and UnoCSS only.
- Commit each completed task separately.

---

## File Structure

- Create `packages/editor/src/shape-painting.ts`: validate shape paths and resolved colors, translate scene coordinates to viewport pixels, and paint Canvas fill/stroke operations.
- Create `packages/editor/src/shape-painting.test.ts`: record Canvas operations and cover mapping, path commands, colors, alpha, no-paint nodes, and state restoration.
- Modify `packages/editor/src/thumbnail-worker.ts`: compute one page mapping per request and dispatch shape/image nodes in scene order.
- Modify `packages/editor/src/thumbnail-worker.test.ts`: verify mixed-node order, absence of shape resource requests, and node-level failure isolation.
- Modify `进度.md`: record completion of basic shape thumbnails and retain explicit deferral of other non-image node kinds.

---

### Task 1: Shared Shape Canvas Painter

**Files:**
- Create: `packages/editor/src/shape-painting.ts`
- Create: `packages/editor/src/shape-painting.test.ts`

**Interfaces:**
- Consumes: `SceneShapeNode` from `@ppt4ai/render`; its `path` commands and optional `resolvedFillColor` / `resolvedStrokeColor` values.
- Produces: `ShapePageMapping` and `paintShapeNode(context, node, mapping): void` for the thumbnail worker.

```ts
export interface ShapePageMapping {
  scale: number
  offsetX: number
  offsetY: number
}

export function paintShapeNode(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  node: SceneShapeNode,
  mapping: ShapePageMapping,
): void
```

- [ ] **Step 1: Write the recording-context tests**

Create `packages/editor/src/shape-painting.test.ts` with a focused context that records `save`, `restore`, `beginPath`, `moveTo`, `lineTo`, `ellipse`, `closePath`, `fill`, and `stroke`. Implement writable `fillStyle`, `strokeStyle`, and `globalAlpha` fields so each paint event records the active color and alpha.

Use this representative shape to exercise every supported `PathCommand` variant and page mapping:

```ts
const node: SceneShapeNode = {
  id: 'shape-1',
  kind: 'shape',
  bounds: { x: 10, y: 20, w: 100, h: 50 },
  path: [
    { type: 'move', x: 10, y: 20 },
    { type: 'line', x: 110, y: 20 },
    { type: 'arc', cx: 85, cy: 45, rx: 25, ry: 25, start: -Math.PI / 2, end: 0 },
    { type: 'close' },
  ],
  resolvedFillColor: { rgb: '336699', alpha: 50000 },
  resolvedStrokeColor: { rgb: 'FF0000', alpha: 25000 },
}

paintShapeNode(context, node, { scale: 2, offsetX: 5, offsetY: 7 })
```

Assert the mapped operations include:

```ts
expect(events).toContainEqual(['moveTo', 25, 47])
expect(events).toContainEqual(['lineTo', 225, 47])
expect(events).toContainEqual(['ellipse', 175, 97, 50, 50, 0, -Math.PI / 2, 0])
expect(events).toContainEqual(['fill', '#336699', 0.5])
expect(events).toContainEqual(['stroke', '#FF0000', 0.25])
expect(events[0]).toEqual(['save'])
expect(events.at(-1)).toEqual(['restore'])
```

Also add tests that:

- generate each path with `createPresetPath('rect' | 'roundRect' | 'ellipse' | 'triangle', bounds)` and verify it paints without throwing;
- pass a node with no resolved fill/stroke and verify only `save`/`restore` occur;
- pass an invalid RGB string, alpha outside `0..100000`, and a non-finite path coordinate and verify each throws while still restoring context;
- make `fill()` throw and verify `restore()` remains the final event.

- [ ] **Step 2: Run the focused test to verify failure**

Run:

```powershell
pnpm exec vitest run packages/editor/src/shape-painting.test.ts
```

Expected: FAIL because `shape-painting.ts` and `paintShapeNode` do not exist.

- [ ] **Step 3: Implement validation and path mapping**

Create `packages/editor/src/shape-painting.ts` and import `SceneShapeNode` from `@ppt4ai/render`.

Implement these private rules:

```ts
function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`)
  return value
}

function colorStyle(color: ResolvedColor): { style: string; alpha: number } {
  if (!/^[0-9A-Fa-f]{6}$/.test(color.rgb)) throw new Error('shape color must be six hexadecimal digits')
  if (!Number.isFinite(color.alpha) || color.alpha < 0 || color.alpha > 100000) {
    throw new Error('shape alpha must be between 0 and 100000')
  }
  return { style: `#${color.rgb.toUpperCase()}`, alpha: color.alpha / 100000 }
}
```

Validate `mapping.scale` as finite and greater than zero, validate both offsets as finite, and validate every numeric path field even when the node has no paint. Map coordinates with:

```ts
const x = mapping.offsetX + sourceX * mapping.scale
const y = mapping.offsetY + sourceY * mapping.scale
```

Build a path by dispatching commands exactly as follows:

```ts
context.beginPath()
for (const command of node.path) {
  if (command.type === 'move') context.moveTo(mapX(command.x), mapY(command.y))
  else if (command.type === 'line') context.lineTo(mapX(command.x), mapY(command.y))
  else if (command.type === 'arc') {
    context.ellipse(
      mapX(command.cx),
      mapY(command.cy),
      finite(command.rx, 'shape arc rx') * mapping.scale,
      finite(command.ry, 'shape arc ry') * mapping.scale,
      0,
      finite(command.start, 'shape arc start'),
      finite(command.end, 'shape arc end'),
    )
  } else context.closePath()
}
```

Reject negative arc radii before calling `ellipse`. Save the context before validation and restore it in `finally`. Validate the path once, then rebuild it immediately before each requested fill/stroke operation. Set `fillStyle`/`strokeStyle` and `globalAlpha` independently so different fill and stroke alpha values remain correct. A node without resolved fill or stroke returns successfully after validation.

- [ ] **Step 4: Run painter tests and editor typecheck**

Run:

```powershell
pnpm exec vitest run packages/editor/src/shape-painting.test.ts
pnpm --filter @ppt4ai/editor typecheck
```

Expected: all painter tests pass and editor typecheck exits zero.

- [ ] **Step 5: Commit the shared painter**

```powershell
git add packages/editor/src/shape-painting.ts packages/editor/src/shape-painting.test.ts
git commit -m "feat: paint shapes on thumbnail canvas"
```

---

### Task 2: Ordered Worker Shape Integration

**Files:**
- Modify: `packages/editor/src/thumbnail-worker.ts`
- Modify: `packages/editor/src/thumbnail-worker.test.ts`

**Interfaces:**
- Consumes: `paintShapeNode` and `ShapePageMapping` from Task 1; existing `paintImageNode`, image resource cache, and thumbnail protocol.
- Produces: mixed shape/image thumbnail rendering in scene order with unchanged `ThumbnailRenderResult` and resource messages.

- [ ] **Step 1: Extend the fake Canvas context and write failing worker tests**

In `packages/editor/src/thumbnail-worker.test.ts`, extend `FakeContext` with writable `fillStyle` and `strokeStyle`, `ellipse`, `fill`, and `stroke` support plus a single ordered event list. Keep the existing `draws` array so image assertions remain intact.

Add a mixed scene fixture in this order:

```ts
nodes: [
  {
    id: 'shape-behind',
    kind: 'shape',
    bounds: { x: 0, y: 0, w: 1000, h: 500 },
    path: [
      { type: 'move', x: 0, y: 0 },
      { type: 'line', x: 1000, y: 0 },
      { type: 'line', x: 1000, y: 500 },
      { type: 'close' },
    ],
    resolvedFillColor: { rgb: '112233', alpha: 100000 },
  },
  {
    id: 'image-middle',
    kind: 'image',
    bounds: { x: 250, y: 0, w: 500, h: 500 },
    assetId: 'asset-a',
    metadata: { id: 'asset-a', mimeType: 'image/png' },
  },
  {
    id: 'shape-front',
    kind: 'shape',
    bounds: { x: 250, y: 125, w: 500, h: 250 },
    path: [
      { type: 'move', x: 250, y: 125 },
      { type: 'line', x: 750, y: 125 },
      { type: 'line', x: 500, y: 375 },
      { type: 'close' },
    ],
    resolvedStrokeColor: { rgb: 'AABBCC', alpha: 100000 },
  },
]
```

After resolving the one image resource, assert:

```ts
expect(result.result.drawnNodeIds).toEqual(['shape-behind', 'image-middle', 'shape-front'])
expect(events.filter(([type]) => type === 'fill' || type === 'drawImage' || type === 'stroke'))
  .toEqual([
    ['fill', '#112233', 1],
    ['drawImage'],
    ['stroke', '#AABBCC', 1],
  ])
expect(messages.filter((message) => message.type === 'resource-request')).toHaveLength(1)
```

Add a shape-only test and assert it reaches `render-result` without any
`resource-request`. Add a failure-isolation test with one malformed shape color
followed by a valid shape and assert:

```ts
expect(result.result.skippedNodeIds).toEqual(['bad-shape'])
expect(result.result.drawnNodeIds).toEqual(['good-shape'])
expect(result.result.issues).toMatchObject([
  { nodeId: 'bad-shape', code: 'draw-failed' },
])
```

- [ ] **Step 2: Run the worker tests to verify failure**

Run:

```powershell
pnpm exec vitest run packages/editor/src/thumbnail-worker.test.ts
```

Expected: FAIL because the worker currently ignores every non-image node.

- [ ] **Step 3: Add one mapping and ordered node dispatch**

In `packages/editor/src/thumbnail-worker.ts`:

1. Import `SceneNode` and `SceneShapeNode` alongside the existing render types.
2. Import `paintShapeNode` and `ShapePageMapping` from `./shape-painting`.
3. Replace the image-only `mapBounds` calculation with one request-level mapping:

```ts
function pageMapping(scene: SceneGraph, width: number, height: number): ShapePageMapping {
  const scale = Math.min(width / scene.page.w, height / scene.page.h)
  return {
    scale,
    offsetX: (width - scene.page.w * scale) / 2,
    offsetY: (height - scene.page.h * scale) / 2,
  }
}

function mapBounds(bounds: Rect, mapping: ShapePageMapping): Rect {
  return {
    x: mapping.offsetX + bounds.x * mapping.scale,
    y: mapping.offsetY + bounds.y * mapping.scale,
    w: bounds.w * mapping.scale,
    h: bounds.h * mapping.scale,
  }
}
```

4. Generalize the issue helper without changing protocol fields:

```ts
function issue(
  node: SceneImageNode | SceneShapeNode,
  code: 'missing-asset' | 'resource-failed' | 'decode-failed' | 'draw-failed',
  error: unknown,
) {
  return {
    nodeId: node.id,
    ...(node.kind === 'image' ? { assetId: node.assetId } : {}),
    code,
    message: errorMessage(error),
  }
}
```

5. Compute `const mapping = pageMapping(request.scene, width, height)` once after clearing the canvas.
6. Replace the image-only early continue with one ordered per-node dispatch:

```ts
for (const node of request.scene.nodes) {
  if (isCancelled(request.requestId)) return
  if (node.kind !== 'shape' && node.kind !== 'image') continue
  try {
    if (node.kind === 'shape') {
      paintShapeNode(context, node, mapping)
    } else {
      const image = await loadAsset(request, node)
      if (isCancelled(request.requestId)) return
      paintImageNode(context, node, image, mapBounds(node.bounds, mapping))
    }
    drawnNodeIds.push(node.id)
  } catch (error) {
    if (isCancelled(request.requestId)) return
    const code = node.kind === 'image'
      ? (error as { thumbnailCode?: string }).thumbnailCode
      : undefined
    const issueCode = code === 'missing-asset' || code === 'resource-failed'
      ? code
      : node.kind === 'image' && error instanceof Error && error.message.includes('decode')
        ? 'decode-failed'
        : 'draw-failed'
    skippedNodeIds.push(node.id)
    issues.push(issue(node, issueCode, error))
  }
}
```

Remove any unused imports after TypeScript narrows the node union. Do not modify `thumbnail-protocol.ts`, `thumbnail-renderer.ts`, the asset cache, cancellation state, or worker entry point.

- [ ] **Step 4: Run focused thumbnail tests**

Run:

```powershell
pnpm exec vitest run packages/editor/src/shape-painting.test.ts packages/editor/src/thumbnail-worker.test.ts packages/editor/src/thumbnail-renderer.test.ts packages/editor/src/ThumbnailCanvas.test.ts
pnpm --filter @ppt4ai/editor typecheck
```

Expected: all focused tests pass, existing image resource deduplication and cancellation tests remain green, and editor typecheck exits zero.

- [ ] **Step 5: Commit the Worker integration**

```powershell
git add packages/editor/src/thumbnail-worker.ts packages/editor/src/thumbnail-worker.test.ts
git commit -m "feat: render shapes in thumbnail worker"
```

---

### Task 3: Progress Record and Repository Verification

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: the completed shared painter and Worker integration from Tasks 1-2.
- Produces: an updated project checkpoint and verified repository state.

- [ ] **Step 1: Update the Stage 7 progress checklist**

In `进度.md`, add a completed Stage 7 item stating that Worker thumbnails now render basic `rect`, `roundRect`, `ellipse`, and `triangle` shapes with resolved fill/stroke colors, alpha, original scene ordering, and per-node failure isolation.

Replace the outdated next-work entry with:

```md
1. 继续阶段 7：规划真实文件上传或文字缩略图绘制的下一独立切片
2. 保持 adapter 二进制由宿主管理，undo/redo 只恢复文档元数据与引用
3. table/chart/group 缩略图绘制及高级形状样式继续延期
```

- [ ] **Step 2: Run package-focused verification**

Run:

```powershell
pnpm exec vitest run packages/editor/src/shape-painting.test.ts packages/editor/src/thumbnail-worker.test.ts packages/editor/src/thumbnail-renderer.test.ts packages/editor/src/ThumbnailCanvas.test.ts
pnpm --filter @ppt4ai/editor typecheck
pnpm --filter @ppt4ai/editor build
```

Expected: focused tests, typecheck, and editor build all pass.

- [ ] **Step 3: Run repository-wide verification**

Run:

```powershell
pnpm test
pnpm check:boundaries
pnpm typecheck
pnpm build
git diff --check
```

Expected: all tests, package-boundary checks, recursive typechecks, recursive builds, and whitespace checks pass.

- [ ] **Step 4: Verify the dependency constraint**

Run:

```powershell
rg -n "element-plus|ElementPlus|@element-plus" package.json pnpm-lock.yaml packages apps
```

Expected: exit code 1 with no matches. This is the successful no-Element-Plus result.

- [ ] **Step 5: Commit the progress checkpoint**

```powershell
git add 进度.md
git commit -m "docs: record shape thumbnail support"
```

## Plan Self-Review

- Task 1 covers every shape path command, deterministic page mapping, resolved
  fill/stroke color conversion, alpha normalization, validation, no-paint
  behavior, and context restoration.
- Task 2 covers unchanged protocol semantics, no-resource shape rendering,
  mixed shape/image scene ordering, existing image behavior, and per-node
  failure isolation.
- Task 3 covers the progress checkpoint, focused verification, repository-wide
  tests, package boundaries, typechecking, builds, whitespace checks, and the
  no-Element-Plus constraint.
- The plan defines every new interface before use and does not require changes
  to model, render, geometry, thumbnail protocol, or runtime dependencies.
- Deferred text/table/chart/group rendering and advanced shape styles remain
  explicit non-goals rather than hidden follow-up work.
