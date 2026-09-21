# Stage 7 Group Thumbnail Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that nested group content already renders correctly through the flat thumbnail leaf-node pipeline, without adding a group painter or changing the worker protocol.

**Architecture:** `SceneGraph.groups` remains clone-safe, non-drawable interaction metadata. The thumbnail worker continues to paint `SceneGraph.nodes` exactly once in array order; focused tests establish leaf-only result IDs, nested ordering, resource behavior, and node-level failure isolation.

**Tech Stack:** TypeScript 6.0.3, Vitest 4.1.11, `@ppt4ai/render` SceneGraph, existing OffscreenCanvas thumbnail worker.

## Global Constraints

- Do not add a dedicated group Canvas painter or recursive group traversal.
- Do not add `drawnGroupIds`, group issue records, or any thumbnail protocol field.
- Group bounds, child IDs, ancestor IDs, requests, responses, and results must remain compatible with `structuredClone`.
- Thumbnail paint order must continue to come only from `SceneGraph.nodes`.
- Group IDs must never appear in `drawnNodeIds`, `skippedNodeIds`, or issue `nodeId` values.
- Keep model, render, engine, protocol, and worker runtime headless; add no runtime dependency.
- UI dependencies remain Vue, Vue-I18n, and UnoCSS only; Element Plus remains forbidden.
- This is a characterization slice: if the focused tests pass against existing production code, do not manufacture a production change.

---

### Task 1: Clone-Safe Group Protocol Fixture

**Files:**
- Modify: `packages/editor/src/thumbnail-protocol.test.ts:4`

**Interfaces:**
- Consumes: `ThumbnailRenderRequest`, `isThumbnailMessage(value)`
- Produces: A clone-safe render request fixture containing outer and nested `SceneGroup` metadata

- [ ] **Step 1: Extend the render-request protocol test**

Add nested group metadata to the existing request and assert the cloned group payload is preserved:

```ts
const message: ThumbnailRenderRequest = {
  type: 'render',
  requestId: 1,
  scene: {
    slideId: 'slide-1',
    page: { w: 914400, h: 514350 },
    nodes: [{
      id: 'leaf-1',
      kind: 'shape',
      bounds: { x: 0, y: 0, w: 100, h: 100 },
      path: [],
    }],
    groups: [
      { id: 'outer', bounds: { x: 0, y: 0, w: 200, h: 200 }, childIds: ['inner'], ancestorIds: [], paintOrder: 0 },
      { id: 'inner', bounds: { x: 0, y: 0, w: 100, h: 100 }, childIds: ['leaf-1'], ancestorIds: ['outer'], paintOrder: 0 },
    ],
  },
  viewport: { width: 96, height: 54 },
}

const cloned = structuredClone(message)
expect(isThumbnailMessage(cloned)).toBe(true)
expect(cloned.scene.groups).toEqual(message.scene.groups)
```

- [ ] **Step 2: Run the focused protocol test**

Run:

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src/thumbnail-protocol.test.ts
```

Expected: PASS. This is an existing protocol capability; a failure indicates a real clone-safety or message-validation regression and must be fixed minimally before continuing.

- [ ] **Step 3: Keep production protocol unchanged when green**

Do not modify `packages/editor/src/thumbnail-protocol.ts` when Step 2 passes. If it fails, only relax or correct validation for the existing optional `scene.groups` field; do not introduce new message or result fields.

---

### Task 2: Nested Group Leaf Ordering

**Files:**
- Modify: `packages/editor/src/thumbnail-worker.test.ts:145`
- Modify only if RED: `packages/editor/src/thumbnail-worker.ts:154`

**Interfaces:**
- Consumes: `createThumbnailWorkerRuntime(deps)`, `ThumbnailRenderRequest.scene.groups`, the existing single `scene.nodes` loop
- Produces: Worker characterization tests proving that groups are ignored as draw targets and leaves retain flat scene order

- [ ] **Step 1: Add the nested mixed-leaf worker test**

Add a test with outer and nested group metadata while keeping the drawable nodes flat:

```ts
it('paints nested group leaves once in scene order without reporting group ids', async () => {
  const harness = createHarness()
  harness.runtime.handleMessage({
    type: 'render',
    requestId: 13,
    scene: {
      slideId: 'slide-1',
      page: { w: 1000, h: 500 },
      nodes: [
        {
          id: 'shape-leaf',
          kind: 'shape',
          bounds: { x: 0, y: 0, w: 200, h: 100 },
          path: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: 200, y: 0 }, { type: 'close' }],
          resolvedFillColor: { rgb: '112233', alpha: 100000 },
        },
        tableNode('table-leaf'),
        {
          id: 'text-leaf',
          kind: 'text',
          bounds: { x: 400, y: 0, w: 200, h: 100 },
          text: 'Grouped',
          layout: {
            bounds: { x: 400, y: 0, w: 200, h: 100 },
            fontScale: 100000,
            overflow: false,
            contentBounds: { x: 400, y: 0, w: 200, h: 100 },
            lines: [{ paragraphIndex: 0, x: 400, y: 0, width: 200, height: 20, runs: [{ text: 'Grouped', x: 400, width: 200, marks: { fontSize: 1 } }] }],
          },
        },
      ],
      groups: [
        { id: 'outer', bounds: { x: 0, y: 0, w: 600, h: 100 }, childIds: ['shape-leaf', 'inner'], ancestorIds: [], paintOrder: 2 },
        { id: 'inner', bounds: { x: 200, y: 0, w: 400, h: 100 }, childIds: ['table-leaf', 'text-leaf'], ancestorIds: ['outer'], paintOrder: 2 },
      ],
    },
    viewport: { width: 200, height: 100 },
  })
  await vi.waitFor(() => expect(harness.messages.some((message) => message.type === 'render-result')).toBe(true))

  const result = harness.messages.find((message): message is ThumbnailRenderResponse => message.type === 'render-result')!
  expect(result.result.drawnNodeIds).toEqual(['shape-leaf', 'table-leaf', 'text-leaf'])
  expect(result.result.skippedNodeIds).toEqual([])
  expect(result.result.issues).toEqual([])
  expect(result.result.drawnNodeIds).not.toContain('outer')
  expect(result.result.drawnNodeIds).not.toContain('inner')
  expect(harness.messages.filter((message) => message.type === 'resource-request')).toHaveLength(0)
})
```

- [ ] **Step 2: Add the metadata-only scene test**

```ts
it('treats group metadata without drawable leaves as a successful empty thumbnail', async () => {
  const harness = createHarness()
  harness.runtime.handleMessage({
    type: 'render',
    requestId: 14,
    scene: {
      slideId: 'slide-1',
      page: { w: 1000, h: 500 },
      nodes: [],
      groups: [{ id: 'empty-group', bounds: { x: 0, y: 0, w: 100, h: 100 }, childIds: [], ancestorIds: [], paintOrder: -1 }],
    },
    viewport: { width: 200, height: 100 },
  })
  await vi.waitFor(() => expect(harness.messages.some((message) => message.type === 'render-result')).toBe(true))

  const result = harness.messages.find((message): message is ThumbnailRenderResponse => message.type === 'render-result')!
  expect(result.result).toEqual({ drawnNodeIds: [], skippedNodeIds: [], issues: [] })
  expect(harness.canvas.context.events).toEqual([])
  expect(harness.messages.filter((message) => message.type === 'resource-request')).toHaveLength(0)
})
```

- [ ] **Step 3: Run both focused group tests**

Run:

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src/thumbnail-worker.test.ts -t "group"
```

Expected: PASS. If the tests fail because the worker traverses `scene.groups` or reports group IDs, remove only that group-specific behavior and retain the existing leaf loop.

- [ ] **Step 4: Preserve the single leaf-node loop**

When Step 3 passes, make no production change. If a correction is required, the final worker loop must remain equivalent to:

```ts
for (const node of request.scene.nodes) {
  // existing per-leaf cancellation, paint dispatch, diagnostics, and result tracking
}
```

Do not add a second loop over `request.scene.groups`.

---

### Task 3: Grouped Image and Failure Isolation

**Files:**
- Modify: `packages/editor/src/thumbnail-worker.test.ts:360`
- Modify only if RED: `packages/editor/src/thumbnail-worker.ts:154`

**Interfaces:**
- Consumes: Existing per-node `try/catch`, image resource bridge, asset cache, and `resolveResource` test helper
- Produces: Coverage proving grouped leaves retain ordinary resource and failure behavior

- [ ] **Step 1: Add grouped failure and image-resource coverage**

```ts
it('isolates a failing grouped leaf and loads a later grouped image normally', async () => {
  const harness = createHarness()
  harness.runtime.handleMessage({
    type: 'render',
    requestId: 15,
    scene: {
      slideId: 'slide-1',
      page: { w: 1000, h: 500 },
      nodes: [
        {
          id: 'bad-shape',
          kind: 'shape',
          bounds: { x: 0, y: 0, w: 200, h: 100 },
          path: [{ type: 'move', x: 0, y: 0 }, { type: 'close' }],
          resolvedFillColor: { rgb: 'broken', alpha: 100000 },
        },
        {
          id: 'grouped-image',
          kind: 'image',
          bounds: { x: 200, y: 0, w: 200, h: 100 },
          assetId: 'asset-grouped',
          metadata: { id: 'asset-grouped', mimeType: 'image/png' },
        },
      ],
      groups: [
        { id: 'outer', bounds: { x: 0, y: 0, w: 400, h: 100 }, childIds: ['bad-shape', 'grouped-image'], ancestorIds: [], paintOrder: 1 },
      ],
    },
    viewport: { width: 200, height: 100 },
  })
  await vi.waitFor(() => expect(harness.messages.some((message) => message.type === 'resource-request')).toBe(true))
  await resolveResource(harness.runtime, harness.messages)
  await vi.waitFor(() => expect(harness.messages.some((message) => message.type === 'render-result')).toBe(true))

  const result = harness.messages.find((message): message is ThumbnailRenderResponse => message.type === 'render-result')!
  expect(result.result.drawnNodeIds).toEqual(['grouped-image'])
  expect(result.result.skippedNodeIds).toEqual(['bad-shape'])
  expect(result.result.issues).toMatchObject([{ nodeId: 'bad-shape', code: 'draw-failed' }])
  expect(result.result.issues.every((entry) => entry.nodeId !== 'outer')).toBe(true)
  expect(harness.messages.filter((message) => message.type === 'resource-request')).toHaveLength(1)
  expect(structuredClone(result.result)).toEqual(result.result)
})
```

- [ ] **Step 2: Run the focused failure/resource test**

Run:

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src/thumbnail-worker.test.ts -t "failing grouped leaf"
```

Expected: PASS. A failure must be corrected only at the existing leaf resource or node-level diagnostic boundary.

- [ ] **Step 3: Run all thumbnail source tests**

Run:

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src/thumbnail-protocol.test.ts src/thumbnail-worker.test.ts src/thumbnail-renderer.test.ts src/ThumbnailCanvas.test.ts
```

Expected: PASS with no new warnings or resource requests from group metadata.

- [ ] **Step 4: Commit the semantics tests**

```powershell
git add packages/editor/src/thumbnail-protocol.test.ts packages/editor/src/thumbnail-worker.test.ts
git commit -m "test: verify group thumbnail semantics"
```

---

### Task 4: Repository Verification and Progress

**Files:**
- Modify: `进度.md:1`

**Interfaces:**
- Consumes: Completed focused group thumbnail semantics tests
- Produces: Updated cross-session milestone and a clean branch

- [ ] **Step 1: Run editor and repository verification**

```powershell
pnpm --filter @ppt4ai/editor exec vitest run src
pnpm typecheck
pnpm test -- --exclude "**/dist/**"
pnpm build
pnpm check:boundaries
$matches = rg -n "element-plus|ElementPlus|el-(button|input|select|dialog|dropdown|menu|tooltip|popover)" package.json pnpm-lock.yaml packages apps; if ($LASTEXITCODE -eq 1) { Write-Output 'No Element Plus references found.' } else { $matches; exit $LASTEXITCODE }
git diff --check
```

Expected: all editor source tests, all repository source tests, typecheck, build, 12-package boundary validation, dependency scan, and diff check pass.

- [ ] **Step 2: Update progress documentation**

Record that group thumbnail semantics are validated through flat leaf rendering; nested groups preserve leaf order, group metadata is non-drawable, result IDs remain leaf-only, grouped image resources and failure isolation reuse existing worker behavior, and no dedicated painter or protocol change was added. Replace the next-step reference to group thumbnail painter with the next approved Stage 7 slice.

- [ ] **Step 3: Commit progress separately**

```powershell
git add 进度.md
git commit -m "docs: record group thumbnail semantics"
```

- [ ] **Step 4: Confirm final branch state**

```powershell
git status --short --branch
git log -6 --oneline
```

Expected: clean working tree with the design, plan, test, and progress commits visible.
