# Stage 7 Text Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render pre-laid-out scene text inside the existing Worker/OffscreenCanvas thumbnail pipeline without changing text layout, the thumbnail protocol, or the image resource bridge.

**Architecture:** Add one editor-internal Canvas helper that validates and paints `SceneTextNode.layout` with an explicit page-to-thumbnail mapping. Update the thumbnail worker's existing ordered node loop to dispatch text, shapes, and images through their focused painters while preserving per-node diagnostics, cancellation, and asset-loading behavior.

**Tech Stack:** TypeScript 6, Canvas 2D/OffscreenCanvas, Vitest 4, pnpm workspace, existing `@ppt4ai/model`, `@ppt4ai/render`, and `@ppt4ai/text` contracts.

## Global Constraints

- The worker must consume `SceneTextNode.layout`; it must not measure, wrap, shape, or reflow text.
- Canvas font pixels must equal `fontSize * 12700 * layout.fontScale / 100000 * pageScale`.
- Missing font marks use 18 points and Arial; missing resolved text color uses opaque black.
- Horizontal runs, line markers, basic upright vertical runs, clockwise-rotated vertical runs, and single underline are in scope.
- Text outline, gradient, shadow, WordArt, browser font loading/embedding, hyperlink interaction, tables, charts, and groups remain out of scope.
- Shape, image, and text nodes must paint in `SceneGraph.nodes` order.
- Text nodes must never issue asset resource requests or enter the image cache.
- One text draw failure must produce `draw-failed` and must not prevent later nodes from rendering.
- Empty valid text nodes count as drawn without issuing a `fillText` call.
- The thumbnail message protocol and clone-safe result shape must not change.
- No runtime dependency may be added; editor UI dependencies remain Vue, Vue-I18n, and UnoCSS only.
- Commit each completed task separately.

---

## File Structure

- Create `packages/editor/src/text-painting.ts`: validate scene text layout, translate page coordinates and font points to Canvas pixels, and paint markers, runs, vertical orientation, color/alpha, and underline.
- Create `packages/editor/src/text-painting.test.ts`: record Canvas state and operations and cover horizontal/vertical text, style mapping, marker order, underline geometry, empty nodes, validation, and state restoration.
- Modify `packages/editor/src/thumbnail-worker.ts`: accept text nodes in the existing ordered loop and route them to the shared text painter without using the asset bridge.
- Modify `packages/editor/src/thumbnail-worker.test.ts`: extend the fake context and verify mixed-node order, text diagnostics, empty text success, and absence of text resource requests.
- Modify `进度.md`: record completion of text thumbnails while keeping table/chart/group thumbnails explicitly deferred.

---

### Task 1: Shared Text Canvas Painter

**Files:**
- Create: `packages/editor/src/text-painting.ts`
- Create: `packages/editor/src/text-painting.test.ts`

**Interfaces:**
- Consumes: `SceneTextNode`, `SceneTextLayoutLine`, and precomputed run/marker geometry from `@ppt4ai/render`.
- Consumes: `DEFAULT_FONT_FAMILY` and `DEFAULT_FONT_SIZE` from `@ppt4ai/text`; do not import internal text package files.
- Produces: `TextPageMapping` and `paintTextNode(context, node, mapping): void` for the thumbnail worker.

```ts
export interface TextPageMapping {
  scale: number
  offsetX: number
  offsetY: number
}

export function paintTextNode(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  node: SceneTextNode,
  mapping: TextPageMapping,
): void
```

- [ ] **Step 1: Write failing horizontal style and marker tests**

Create `packages/editor/src/text-painting.test.ts` with a recording Canvas context that exposes writable `font`, `textBaseline`, `textAlign`, `fillStyle`, `strokeStyle`, `globalAlpha`, and `lineWidth` fields. Record calls to `save`, `restore`, `fillText`, `beginPath`, `moveTo`, `lineTo`, `stroke`, `translate`, and `rotate` together with active paint state.

Use a node whose layout has `fontScale: 50000`, line `y: 200`, line `height: 100`, marker `x: 50`, and one run at `x: 100`, `width: 300`:

```ts
const node: SceneTextNode = {
  id: 'text-1',
  kind: 'text',
  bounds: { x: 0, y: 0, w: 1000, h: 500 },
  text: 'Title',
  layout: {
    bounds: { x: 0, y: 0, w: 1000, h: 500 },
    fontScale: 50000,
    overflow: false,
    contentBounds: { x: 50, y: 200, w: 350, h: 100 },
    lines: [{
      paragraphIndex: 0,
      x: 100,
      y: 200,
      width: 300,
      height: 100,
      marker: { text: '1.', x: 50, width: 40, marks: { fontSize: 10 } },
      runs: [{
        text: 'Title',
        x: 100,
        width: 300,
        marks: {
          fontFamily: 'Aptos Display',
          fontSize: 20,
          bold: true,
          italic: true,
          underline: 'single',
        },
        resolvedColor: { rgb: '336699', alpha: 50000 },
      }],
    }],
  },
}

paintTextNode(context, node, { scale: 0.001, offsetX: 5, offsetY: 7 })
```

Assert:

```ts
expect(fillTextEvents.map((event) => event.slice(0, 4))).toEqual([
  ['fillText', '1.', 5.05, 7.2],
  ['fillText', 'Title', 5.1, 7.2],
])
expect(runEvent).toMatchObject({
  font: 'italic bold 127px "Aptos Display"',
  fillStyle: '#336699',
  globalAlpha: 0.5,
  textAlign: 'left',
  textBaseline: 'top',
})
expect(events).toContainEqual(['moveTo', 5.1, 7.29])
expect(events).toContainEqual(['lineTo', 5.4, 7.29])
expect(underlineStroke).toMatchObject({
  strokeStyle: '#336699',
  globalAlpha: 0.5,
  lineWidth: 6.35,
})
expect(events[0]).toEqual(['save'])
expect(events.at(-1)).toEqual(['restore'])
```

The marker must be opaque black and use its own calculated font size. Add a second horizontal test with no marks or resolved color and assert `18 * 12700 * 0.001 = 228.6px`, Arial, regular weight/style, and opaque black.

- [ ] **Step 2: Run the horizontal tests and verify RED**

Run:

```powershell
pnpm exec vitest run packages/editor/src/text-painting.test.ts
```

Expected: FAIL because `./text-painting` does not exist.

- [ ] **Step 3: Implement mapping, font, color, horizontal marker, run, and underline helpers**

Create `packages/editor/src/text-painting.ts` with these constants and validation rules:

```ts
const EMU_PER_POINT = 12700
const DEFAULT_FONT_SCALE = 100000

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`)
  return value
}

function validateMapping(mapping: TextPageMapping): void {
  finite(mapping.scale, 'text mapping scale')
  if (mapping.scale <= 0) throw new Error('text mapping scale must be positive')
  finite(mapping.offsetX, 'text mapping offsetX')
  finite(mapping.offsetY, 'text mapping offsetY')
}
```

Build the font from the run/marker marks and the layout autofit scale:

```ts
function fontState(marks: TextMarks | undefined, fontScale: number, pageScale: number) {
  const fontSize = finite(marks?.fontSize ?? DEFAULT_FONT_SIZE, 'text font size')
  if (fontSize <= 0) throw new Error('text font size must be positive')
  const pixels = fontSize * EMU_PER_POINT * fontScale / DEFAULT_FONT_SCALE * pageScale
  const family = JSON.stringify(marks?.fontFamily ?? DEFAULT_FONT_FAMILY)
  const prefix = [marks?.italic ? 'italic' : '', marks?.bold ? 'bold' : ''].filter(Boolean).join(' ')
  return { pixels, font: `${prefix ? `${prefix} ` : ''}${pixels}px ${family}` }
}
```

Convert a run's resolved color with the same six-hex-digit and `0..100000` alpha validation used by shape painting. Use `{ style: '#000000', alpha: 1 }` when no resolved color exists. Markers always use that black fallback because the current marker contract has no resolved color.

For each horizontal line:

1. Validate line `x`, `y`, `width`, and `height` as finite, with non-negative width/height.
2. Paint `line.marker` first at mapped `marker.x` and `line.y`.
3. Paint each non-empty run at mapped `run.x` and `line.y`.
4. Set `textAlign = 'left'` and `textBaseline = 'top'` explicitly before `fillText`.
5. When `marks.underline === 'single'`, draw from mapped `run.x` to mapped `run.x + run.width` at `line.y + line.height * 0.9`.
6. Set underline width to `Math.max(1, fontPixels * 0.05)` and reuse the run's color and alpha.

Wrap the whole node in `context.save()` and `try/finally { context.restore() }`. Do not call `measureText` or any other layout function.

- [ ] **Step 4: Run horizontal tests and verify GREEN**

Run:

```powershell
pnpm exec vitest run packages/editor/src/text-painting.test.ts
```

Expected: PASS for marker order, default font/color, explicit precomputed positions, calculated font size, resolved color/alpha, underline geometry, and outer context restoration.

- [ ] **Step 5: Write failing vertical, empty, and validation tests**

Add a vertical layout fixture with one upright CJK run and one rotated Latin run:

```ts
layout: {
  bounds: { x: 0, y: 0, w: 500, h: 1000 },
  fontScale: 100000,
  overflow: false,
  vertical: 'vertical',
  contentBounds: { x: 200, y: 100, w: 100, h: 500 },
  lines: [{
    paragraphIndex: 0,
    x: 200,
    y: 100,
    width: 100,
    height: 500,
    marker: { text: '*', x: 200, y: 100, width: 100, height: 80, orientation: 'rotated' },
    runs: [
      { text: '中', x: 200, y: 180, width: 100, height: 100, orientation: 'upright' },
      { text: 'A', x: 200, y: 280, width: 100, height: 80, orientation: 'rotated' },
    ],
  }],
}
```

With `{ scale: 0.01, offsetX: 1, offsetY: 2 }`, assert the marker and Latin run each execute `translate(mappedX + mappedWidth, mappedY)`, then `rotate(Math.PI / 2)`, then `fillText(text, 0, 0)` inside a nested save/restore. Assert the CJK run paints directly at mapped `(x, y)` without a rotation.

Also add tests that:

- paint `lines: []` and empty run strings without any `fillText`, but still save and restore;
- reject non-finite mapping, line, run, and marker coordinates;
- reject negative dimensions, zero/non-finite font size, non-finite `fontScale`, invalid RGB, and alpha outside `0..100000`;
- reject `orientation: 'diagonal' as 'upright'` in vertical layout;
- make `fillText()` throw and verify both nested and outer context state are restored.

- [ ] **Step 6: Run the expanded tests and verify RED**

Run:

```powershell
pnpm exec vitest run packages/editor/src/text-painting.test.ts
```

Expected: FAIL because vertical orientation and the new validation cases are not implemented.

- [ ] **Step 7: Implement vertical painting and complete validation**

Validate `layout.fontScale` as finite and positive before processing lines. For vertical layout, require every painted marker/run to have finite `y`, non-negative `width`/`height`, and orientation exactly `upright` or `rotated`.

Implement one focused cell painter:

```ts
function paintVerticalCell(
  context: TextContext,
  item: SceneTextLayoutRun | TextLayoutMarker,
  style: TextPaintStyle,
  mapping: TextPageMapping,
): void {
  if (item.text.length === 0) return
  if (item.orientation === 'upright') {
    applyTextStyle(context, style)
    context.fillText(item.text, mapX(item.x), mapY(item.y!))
    return
  }
  if (item.orientation !== 'rotated') throw new Error('text orientation must be upright or rotated')
  context.save()
  try {
    context.translate(mapX(item.x + item.width), mapY(item.y!))
    context.rotate(Math.PI / 2)
    applyTextStyle(context, style)
    context.fillText(item.text, 0, 0)
  } finally {
    context.restore()
  }
}
```

The real implementation may keep the mapping functions outside the helper, but it must preserve this top-right anchor, clockwise rotation, and nested restoration behavior. Process a vertical marker before its runs. Do not draw text for empty strings.

- [ ] **Step 8: Run focused editor painting tests**

Run:

```powershell
pnpm exec vitest run packages/editor/src/text-painting.test.ts packages/editor/src/shape-painting.test.ts
```

Expected: both test files PASS; the text tests demonstrate no use of Canvas `measureText` or `@ppt4ai/text` layout functions.

- [ ] **Step 9: Commit the shared text painter**

```powershell
git add -- packages/editor/src/text-painting.ts packages/editor/src/text-painting.test.ts
git commit -m "feat: paint text on thumbnail canvas"
```

---

### Task 2: Thumbnail Worker Text Dispatch

**Files:**
- Modify: `packages/editor/src/thumbnail-worker.ts:1`
- Modify: `packages/editor/src/thumbnail-worker.test.ts:1`

**Interfaces:**
- Consumes: `paintTextNode(context, node, mapping): void` and `TextPageMapping` from Task 1.
- Preserves: `ThumbnailWorkerRequest`, `ThumbnailWorkerResponse`, `ThumbnailRenderResponse`, resource requests, cache behavior, cancellation, and bitmap transfer.
- Produces: text node IDs in existing `drawnNodeIds` / `skippedNodeIds` arrays and existing `draw-failed` diagnostics.

- [ ] **Step 1: Extend the fake Canvas context and write failing mixed-order tests**

In `packages/editor/src/thumbnail-worker.test.ts`, add the Canvas text fields and methods required by `paintTextNode`:

```ts
font = ''
textAlign: CanvasTextAlign = 'start'
textBaseline: CanvasTextBaseline = 'alphabetic'
lineWidth = 1
translate(...args: unknown[]): void { this.events.push(['translate', ...args]) }
rotate(...args: unknown[]): void { this.events.push(['rotate', ...args]) }
fillText(...args: unknown[]): void { this.events.push(['fillText', ...args]) }
drawImage(...args: unknown[]): void {
  this.draws.push(args)
  this.events.push(['drawImage'])
}
```

Add a request whose nodes are:

1. a filled shape `shape-behind`;
2. a horizontal text node `text-middle` with one run and resolved color;
3. one image `image-front`.

Resolve the one image resource and assert:

```ts
expect(result.result.drawnNodeIds).toEqual([
  'shape-behind',
  'text-middle',
  'image-front',
])
expect(harness.canvas.context.events
  .filter(([type]) => type === 'fill' || type === 'fillText' || type === 'drawImage')
  .map(([type]) => type)).toEqual(['fill', 'fillText', 'drawImage'])
expect(harness.messages.filter((message) => message.type === 'resource-request')).toHaveLength(1)
```

Add a text-only request and assert zero `resource-request` messages.

- [ ] **Step 2: Write failing text success and isolation tests**

Add a request containing:

- `empty-text` with valid `lines: []`;
- `bad-text` with an invalid resolved RGB value on its run;
- `good-text` with a valid run after the failure.

After the render result, assert:

```ts
expect(result.result.drawnNodeIds).toEqual(['empty-text', 'good-text'])
expect(result.result.skippedNodeIds).toEqual(['bad-text'])
expect(result.result.issues).toMatchObject([
  { nodeId: 'bad-text', code: 'draw-failed' },
])
expect(harness.messages.filter((message) => message.type === 'resource-request')).toHaveLength(0)
```

- [ ] **Step 3: Run Worker tests and verify RED**

Run:

```powershell
pnpm exec vitest run packages/editor/src/thumbnail-worker.test.ts
```

Expected: FAIL because the worker currently skips every `text` node.

- [ ] **Step 4: Dispatch text nodes inside the existing ordered loop**

In `packages/editor/src/thumbnail-worker.ts`:

1. Import `SceneTextNode` and `paintTextNode`.
2. Extend `issue()` to accept `SceneImageNode | SceneShapeNode | SceneTextNode`; only image issues include `assetId`.
3. Allow `text` in the current node-kind gate.
4. Dispatch shape, text, and image without creating a second traversal:

```ts
if (node.kind === 'shape') {
  paintShapeNode(context, node, mapping)
} else if (node.kind === 'text') {
  paintTextNode(context, node, mapping)
} else {
  const image = await loadAsset(request, node)
  if (isCancelled(request.requestId)) return
  paintImageNode(context, node, image, mapBounds(node.bounds, mapping))
}
```

Keep `drawnNodeIds.push(node.id)` after successful dispatch. Keep all text errors on the existing non-image `draw-failed` path. Do not modify the thumbnail protocol or resource cache.

- [ ] **Step 5: Run focused Worker and painter tests**

Run:

```powershell
pnpm exec vitest run packages/editor/src/thumbnail-worker.test.ts packages/editor/src/text-painting.test.ts packages/editor/src/shape-painting.test.ts
```

Expected: PASS for mixed scene order, text-only rendering without assets, empty text success, node-level failure isolation, existing shape behavior, and existing image resource/cancellation behavior.

- [ ] **Step 6: Run editor package typecheck**

Run:

```powershell
pnpm --filter @ppt4ai/editor typecheck
```

Expected: PASS with `SceneTextNode`, Canvas text state, and mapping types remaining compatible.

- [ ] **Step 7: Commit Worker text rendering**

```powershell
git add -- packages/editor/src/thumbnail-worker.ts packages/editor/src/thumbnail-worker.test.ts
git commit -m "feat: render text in thumbnail worker"
```

---

### Task 3: Progress Record and Repository Verification

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: completed shared text painter and Worker dispatch from Tasks 1-2.
- Produces: an accurate stage record and a clean, fully verified repository state.

- [ ] **Step 1: Run package boundary and full test gates**

Run:

```powershell
pnpm check:boundaries
pnpm test
```

Expected: all 12 package boundaries pass and every Vitest test passes. Do not update a hard-coded test count until the command reports the actual total.

- [ ] **Step 2: Run recursive typecheck and build gates**

Run:

```powershell
pnpm typecheck
pnpm build
```

Expected: all workspace packages typecheck and build successfully.

- [ ] **Step 3: Run whitespace and dependency gates**

Run:

```powershell
git diff --check
rg -n "element-plus|ElementPlus|@element-plus" package.json pnpm-lock.yaml packages apps
```

Expected: `git diff --check` exits 0. The `rg` command exits 1 with no matches, confirming that Element Plus remains absent.

- [ ] **Step 4: Record the completed slice**

Update `进度.md` in the Stage 7 current-status paragraph and checklist to state:

- Worker/OffscreenCanvas thumbnails now paint precomputed horizontal text runs, markers, basic upright/rotated vertical text, resolved color/alpha, font marks, and underline;
- shape/image/text scene order and per-node failure isolation are preserved;
- text issues no asset resource requests and the thumbnail protocol is unchanged;
- table/chart/group thumbnails, browser font embedding, and advanced text effects remain deferred;
- include the actual test file/test totals reported by Step 1.

Do not claim support for text reflow, Canvas measurement, gradients, shadows, WordArt, or font loading.

- [ ] **Step 5: Re-run documentation and clean-tree checks**

Run:

```powershell
git diff --check
git status --short
```

Expected: only `进度.md` is modified and the diff has no whitespace errors.

- [ ] **Step 6: Commit the stage record**

```powershell
git add -- 进度.md
git commit -m "docs: record text thumbnail support"
```

- [ ] **Step 7: Confirm final history and cleanliness**

Run:

```powershell
git status --short
git log -4 --oneline
```

Expected: the worktree is clean and history ends with separate commits for the plan, Canvas text painter, Worker integration, and progress record.
