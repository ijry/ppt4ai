# 多选缩放、比例锁定与吸附实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为顶层多选增加联合框缩放、Shift 比例锁定、缩放吸附参考线和一次性 undo，并接通 Playground。

**Architecture:** 编辑器层负责 pointer 手势、联合框预览、比例几何和基于 SceneGraph 的缩放吸附；engine 层只接收最终联合 bounds，并以一个 resizeSelection command 对整个选择及其 group 后代生成单一 patch。Playground 负责同步选择、dispatch command 和刷新受控快照，不在宿主逐元素变换。

**Tech Stack:** Vue 3.5、TypeScript 6、Vue-I18n 11、UnoCSS 66、Vitest 4、现有 @ppt4ai/engine、@ppt4ai/model、@ppt4ai/render。

**Spec:** docs/superpowers/specs/2026-08-24-stage-7-multi-selection-resize-design.md

## Global Constraints

- Runtime UI dependencies remain Vue, Vue-I18n, and UnoCSS only; do not add Element Plus or another component framework.
- Multi-selection transforms operate only on non-overlapping top-level roots in the current group scope.
- Preserve the existing single-selection resize event and existing resize command.
- Every document mutation goes through EditorEngine.dispatch; one resize gesture creates at most one undo history entry.
- SelectionOverlay pointer payloads remain clone-safe and retain handle/point compatibility while adding shiftKey.
- Resize guides are transient UI state and never enter the document or engine history.
- Follow strict TDD: write a focused failing test, observe RED, implement the minimum behavior, then rerun GREEN.
- Keep implementation/tests in one feature commit and update 进度.md in a separate documentation commit.
- Do not modify unrelated behavior, dependencies, or generated dist artifacts manually.

---

### Task 1: Resize Geometry And Pointer Modifiers

**Files:**
- Modify: packages/editor/src/selection-overlay.ts
- Modify: packages/editor/src/SelectionOverlay.vue
- Test: packages/editor/src/selection-overlay.test.ts

**Interfaces:**
- Consumes: existing Rect, SelectionHandle, Point, resizeBounds, and SelectionOverlay pointer handlers.
- Produces: exported ResizePointerPayload and resizeBoundsWithAspectRatio(startBounds, handle, pointer, options?) used by PptEditor.

- [ ] **Step 1: Write the failing geometry and event tests**

Add these tests to selection-overlay.test.ts before production edits:

~~~ts
it('keeps the starting ratio for a corner resize with aspect locking', () => {
  expect(resizeBoundsWithAspectRatio(
    { x: 10, y: 20, w: 100, h: 60 },
    'se',
    { x: 150, y: 104 },
  )).toEqual({ x: 10, y: 20, w: 140, h: 84 })
})

it('keeps the opposite corner fixed while locking a north-west resize', () => {
  expect(resizeBoundsWithAspectRatio(
    { x: 10, y: 20, w: 100, h: 60 },
    'nw',
    { x: -20, y: 2 },
  )).toEqual({ x: -20, y: 2, w: 130, h: 78 })
})

it('does not force an aspect ratio for an edge handle', () => {
  expect(resizeBoundsWithAspectRatio(
    { x: 10, y: 20, w: 100, h: 60 },
    'e',
    { x: 160, y: 100 },
  )).toEqual({ x: 10, y: 20, w: 150, h: 60 })
})
~~~

Mount SelectionOverlay with an onResizeStart listener, dispatch a Shift pointerdown to the southeast handle, and assert the emitted payload is { handle: 'se', point: { x: 140, y: 80 }, shiftKey: true }. Dispatch a non-modified pointermove as a separate assertion to prove the flag is read from each PointerEvent.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

~~~powershell
pnpm --filter @ppt4ai/editor exec vitest run src/selection-overlay.test.ts
~~~

Expected: FAIL because resizeBoundsWithAspectRatio is missing and the emitted payload has no shiftKey.

- [ ] **Step 3: Implement the minimum geometry and payload**

In selection-overlay.ts:

1. Export ResizePointerPayload with handle, point, and boolean shiftKey.
2. Implement resizeBoundsWithAspectRatio by calling resizeBounds first, returning the raw result for non-corner handles, and for corners choosing the larger normalized width/height change as the driving axis.
3. Derive the other dimension from startBounds.w / startBounds.h, keep the opposite corner fixed, and apply the existing minimum dimension constraints without allowing zero or negative bounds.
4. Keep all calculations finite and return a fresh Rect.

In SelectionOverlay.vue:

- Type all four resize events as ResizePointerPayload.
- Build payload from clientX/clientY and event.shiftKey.
- Keep pointer capture, release behavior, DOM markers, and existing callers unchanged.

- [ ] **Step 4: Rerun the focused test to verify GREEN**

Run the same Vitest command. Expected: all selection-overlay tests pass, including the pre-existing engine resize and rendering assertions.

- [ ] **Step 5: Commit the task checkpoint**

Do not create a separate final feature commit here; leave the focused changes staged only at the final implementation checkpoint so the whole stage remains one implementation commit.

---

### Task 2: Atomic Engine Resize Of A Selection

**Files:**
- Modify: packages/engine/src/index.ts
- Test: packages/engine/src/engine.test.ts

**Interfaces:**
- Consumes: EngineCommand, validSelection, descendantElementIds, selectionBounds, and commit.
- Produces: EngineCommand variant { type: 'resizeSelection'; bounds: Rect } and one atomic document transaction.

- [ ] **Step 1: Write failing engine tests**

Add tests covering the following exact behaviors:

~~~ts
it('resizes two selected roots from one union coordinate system', () => {
  const engine = new EditorEngine(makeDocument())
  engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })

  const state = engine.dispatch({
    type: 'resizeSelection',
    bounds: { x: 0, y: 0, w: 8000000, h: 2000000 },
  })

  expect(state.document.elements.el_a?.bounds).toEqual({ x: 0, y: 0, w: 2000000, h: 2000000 })
  expect(state.document.elements.el_b?.bounds).toEqual({ x: 6000000, y: 0, w: 2000000, h: 2000000 })
  expect(state.selection).toEqual(['el_a', 'el_b'])
  expect(state.history).toEqual({ undoDepth: 1, redoDepth: 0 })
})
~~~

Use makeNestedGroupDocument to assert a selected outer group and a second root map all descendant bounds in one transaction. Add assertions for duplicate/invalid selection IDs, parent-plus-child selection filtering, unchanged target no-op, non-finite/non-positive target rejection, structuredClone safety, and complete undo/redo restoration.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

~~~powershell
pnpm --filter @ppt4ai/engine exec vitest run src/engine.test.ts -t "resizeSelection"
~~~

Expected: FAIL because EngineCommand does not accept resizeSelection and EditorEngine has no dispatch branch.

- [ ] **Step 3: Implement the atomic command**

In EngineCommand add:

~~~ts
| { type: 'resizeSelection'; bounds: Rect }
~~~

Add a private resizeSelection(bounds) method and dispatch case. The method must:

1. Validate finite x/y/w/h and positive w/h with the same error text used by resize.
2. Deduplicate and filter current selection with validSelection.
3. Remove any selected ID contained by another selected group, using descendantElementIds, to produce non-overlapping roots.
4. Compute the source union from root bounds; return without history for an empty selection.
5. Compute scaleX and scaleY from source to target.
6. Collect each root and all descendants once, preserving document IDs only for patch generation.
7. Map each descendant rectangle relative to source.x/source.y and write all changed bounds in one commit.
8. Leave selection and tableCellSelection unchanged; dispatch's existing guide reset remains effective.
9. Return a no-op for an identical target and never create a partial patch for an invalid target.

- [ ] **Step 4: Rerun the focused test to verify GREEN**

Run:

~~~powershell
pnpm --filter @ppt4ai/engine exec vitest run src/engine.test.ts -t "resizeSelection"
~~~

Then run the existing transform tests in the same file to ensure legacy resize and nested group behavior remain green.

- [ ] **Step 5: Record the engine API in the implementation diff**

Do not add a second command or alter the existing resize semantics. The only new public engine command in this task is resizeSelection.

---

### Task 3: Pure Resize Snapping

**Files:**
- Create: packages/editor/src/resize-snapping.ts
- Test: packages/editor/src/resize-snapping.test.ts
- Modify: packages/editor/src/index.ts

**Interfaces:**
- Consumes: SceneGraph, Rect, SelectionHandle, SnapOptions and SnapGuide types.
- Produces:
  - ResizeSnapRequest { scene, selectedElementIds, sourceBounds, proposedBounds, handle, options?, aspectRatioLocked? }
  - ResizeSnapResult { bounds: Rect; guides: SnapGuide[] }
  - snapResizeBounds(request): ResizeSnapResult

- [ ] **Step 1: Write failing pure-function tests**

Create resize-snapping.test.ts with a small SceneGraph containing two top-level shapes, one top-level group with a leaf, and a nested leaf. Assert:

1. An east edge within threshold snaps to an unselected object left edge and returns one x element guide.
2. A south edge outside threshold remains unchanged and returns no guide.
3. A configured grid line is used when no object candidate is closer.
4. Selected roots and every descendant of a selected group are excluded from candidates.
5. Equal-distance candidates prefer element over grid, then preserve scene order and fixed edge order.
6. A Shift-locked corner applies one chosen axis guide and preserves sourceBounds.w / sourceBounds.h exactly.

Use options such as { enabled: true, gridSize: 1000, threshold: 50 } and assert clone safety with structuredClone.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

~~~powershell
pnpm --filter @ppt4ai/editor exec vitest run src/resize-snapping.test.ts
~~~

Expected: FAIL because the module and snapResizeBounds do not exist.

- [ ] **Step 3: Implement deterministic candidate collection and snapping**

Implement pure helpers in resize-snapping.ts:

- Build candidate bounds from top-level groups plus ungrouped top-level nodes. Never add a group descendant separately when its top-level group is present.
- Recursively collect selected group descendants and exclude them, as well as selected leaf roots.
- For each active west/east or north/south edge, generate candidate lines at left/center/right or top/center/bottom.
- Add the nearest grid line only when gridSize is finite and positive.
- Reject candidates whose absolute delta exceeds threshold; sort by absolute delta, element before grid, scene order, then fixed line order.
- Apply a selected delta to the moving edge while preserving the opposite edge and positive dimensions.
- For aspectRatioLocked corner gestures, choose the better normalized axis candidate, apply only that guide, and derive the other dimension from source aspect ratio using the geometry helper.
- Return fresh plain objects and no mutation of scene or request inputs. Treat absent options, disabled options, non-positive threshold, and invalid geometry as no-snap results.

Export the request/result types and function from editor index.ts for stable package typing; use type-only imports for engine snap types.

- [ ] **Step 4: Rerun the focused test to verify GREEN**

Run the same command and verify all six candidate/priority cases pass.

- [ ] **Step 5: Check the package boundary**

Run:

~~~powershell
pnpm --filter @ppt4ai/editor typecheck
~~~

Expected: no new dependency or headless boundary violation.

---

### Task 4: PptEditor Multi-Selection Resize And Guides

**Files:**
- Modify: packages/editor/src/PptEditor.vue
- Test: packages/editor/src/PptEditor.test.ts

**Interfaces:**
- Consumes: selectedElementIds normalization, SelectionOverlay ResizePointerPayload, resizeBoundsWithAspectRatio, snapResizeBounds, and SceneGraph bounds.
- Produces:
  - prop snapOptions?: SnapOptions
  - event resize-selection { elementIds: string[]; bounds: Rect }
  - transient data-snap-guide elements during preview.

- [ ] **Step 1: Write failing editor tests**

Add tests that:

1. Mount a two-root controlled selection and expect eight handles rather than zero.
2. Dispatch pointerdown/move/up on the southeast handle and assert one resize-selection payload with the gesture-start IDs and final EMU bounds.
3. Repeat with Shift on a corner and assert the emitted bounds preserve the starting aspect ratio.
4. Pass snapOptions and move an edge near a peer line; assert preview border moves to the snapped location and one data-snap-guide has axis x.
5. Dispatch pointercancel and assert preview returns to the controlled bounds and guides disappear.
6. Change selectedElementIds while a gesture is active and assert no resize-selection event is emitted.

Keep existing single-selection resize tests and event payloads unchanged.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

~~~powershell
pnpm --filter @ppt4ai/editor exec vitest run src/PptEditor.test.ts -t "multi-selection resize|snap guide"
~~~

Expected: FAIL because multi-selection currently hides handles, PptEditor has no resize-selection event, and no snapOptions or guide overlay exists.

- [ ] **Step 3: Implement the minimal editor integration**

In PptEditor.vue:

1. Add snapOptions to props and resize-selection to emits.
2. Extend resize gesture state with gesture-start elementIds, start bounds, handle, start point, and current shift state.
3. On resize-start, snapshot the normalized IDs and bounds; reject an empty/invalid selection.
4. On resize/move, verify the current normalized IDs still equal the gesture IDs. Convert pointer geometry to EMU, apply aspect locking, pass the proposed bounds through snapResizeBounds, save preview bounds and guides, and render the preview without changing selection props.
5. On resize-end, repeat the same pure calculation; emit legacy resize for one ID and resize-selection for multiple IDs, then clear preview and guides.
6. On cancel, selection change, scene invalidation, or unmount, clear gesture, preview, and guides without emitting a document mutation.
7. Render handles whenever at least one valid selection is active; keep group-entry and entered-group single-selection behavior intact.
8. Render x guides as absolute vertical divs and y guides as horizontal divs inside the existing relative canvas wrapper, using the same EMU-to-CSS zoom conversion, pointer-events-none, UnoCSS blue line classes, data-snap-guide, and data-snap-axis markers.

Use a stable selection key for gesture invalidation and do not keep authoritative selection state in PptEditor.

- [ ] **Step 4: Rerun the focused editor tests to verify GREEN**

Run:

~~~powershell
pnpm --filter @ppt4ai/editor exec vitest run src/selection-overlay.test.ts src/resize-snapping.test.ts src/PptEditor.test.ts
~~~

Expected: all new and existing editor tests pass without Vue warnings.

- [ ] **Step 5: Run editor source regression**

Run:

~~~powershell
pnpm --filter @ppt4ai/editor exec vitest run src
~~~

Expected: all editor source tests remain green.

---

### Task 5: Playground Resize Wiring And Status Locales

**Files:**
- Modify: apps/playground/src/asset-host.ts
- Test: apps/playground/src/asset-host.test.ts
- Modify: apps/playground/src/App.vue
- Test: apps/playground/src/App.test.ts
- Modify: packages/editor/src/locales/en-US.ts
- Modify: packages/editor/src/locales/zh-CN.ts

**Interfaces:**
- Consumes: EngineCommand resizeSelection and PptEditor resize-selection payload.
- Produces: PlaygroundAssetHost.snapOptions and resizeSelected(elementIds, bounds).

- [ ] **Step 1: Write failing host and integration tests**

In asset-host.test.ts:

~~~ts
it('resizes the selected roots atomically and preserves selection order', () => {
  const host = createPlaygroundAssetHost()
  const result = host.resizeSelected(
    ['group_demo', 'table_demo'],
    { x: 914400, y: 685800, w: 5486400, h: 5943600 },
  )

  expect(result.engineState.selection).toEqual(['group_demo', 'table_demo'])
  expect(result.engineState.history).toEqual({ undoDepth: 1, redoDepth: 0 })
  expect(result.engineState.document.elements.group_demo?.bounds.w).toBe(5486400)
  expect(result.engineState.document.elements.table_demo?.bounds.w).toBe(5486400)
  expect(structuredClone(result)).toEqual(result)
})
~~~

In App.test.ts, modifier-select group_demo and table_demo, drag the southeast selection handle once, and assert the rendered selection still contains both IDs, undo depth is 1, and the two element bounds changed proportionally. Assert undo restores the original bounds through the host-facing workflow.

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

~~~powershell
pnpm exec vitest run apps/playground/src/asset-host.test.ts apps/playground/src/App.test.ts -t "resiz"
~~~

Expected: FAIL because the host method, snapOptions property, editor binding, and resize-selection listener do not exist.

- [ ] **Step 3: Implement host and App wiring**

In asset-host.ts:

- Define and export a readonly playground SnapOptions value with enabled true, gridSize 914400, and threshold 91440.
- Construct EditorEngine with that snap configuration so existing move snapping and resize preview use the same settings.
- Add readonly snapOptions to the host interface and add resizeSelected(elementIds, bounds).
- In resizeSelected, deduplicate/filter IDs through the existing selection helper, dispatch a non-history select command, dispatch resizeSelection once, set element-resized status on success, and map command errors to element-operation-failed without partial history.

In App.vue:

- Bind assetHost.snapOptions to PptEditor's snap-options prop.
- Listen to resize-selection and call resizeSelected.
- Leave single resize, move, text, asset, and group handlers unchanged.

Add the missing status translations used by existing and new resize paths to both locale files: element-moved, element-resized, text-updated, element-missing, element-operation-failed, and asset-operation-failed.

- [ ] **Step 4: Rerun focused Playground tests to verify GREEN**

Run:

~~~powershell
pnpm exec vitest run apps/playground/src/asset-host.test.ts apps/playground/src/App.test.ts
~~~

Expected: all Playground tests pass with no missing-i18n warnings.

---

### Task 6: Full Verification, Implementation Commit, And Milestone

**Files:**
- Modify: 进度.md after implementation verification

- [ ] **Step 1: Run focused cross-layer tests**

~~~powershell
pnpm --filter @ppt4ai/editor exec vitest run src/selection-overlay.test.ts src/resize-snapping.test.ts src/PptEditor.test.ts
pnpm --filter @ppt4ai/engine exec vitest run src/engine.test.ts -t "resizeSelection"
pnpm exec vitest run apps/playground/src/asset-host.test.ts apps/playground/src/App.test.ts
~~~

- [ ] **Step 2: Run complete source tests and static checks**

~~~powershell
pnpm --filter @ppt4ai/editor exec vitest run src
pnpm test -- --exclude "**/dist/**"
pnpm typecheck
pnpm build
pnpm check:boundaries
~~~

- [ ] **Step 3: Scan dependencies and patch hygiene**

~~~powershell
rg -n -i "element-plus|element plus" package.json pnpm-lock.yaml packages apps
git diff --check
git status --short
~~~

Expected: no Element Plus matches, clean diff, and only intended source/test files before the implementation commit.

- [ ] **Step 4: Commit implementation and tests**

~~~powershell
git add -- packages/engine/src/index.ts packages/engine/src/engine.test.ts packages/editor/src/selection-overlay.ts packages/editor/src/selection-overlay.test.ts packages/editor/src/SelectionOverlay.vue packages/editor/src/resize-snapping.ts packages/editor/src/resize-snapping.test.ts packages/editor/src/index.ts packages/editor/src/PptEditor.vue packages/editor/src/PptEditor.test.ts packages/editor/src/locales/en-US.ts packages/editor/src/locales/zh-CN.ts apps/playground/src/asset-host.ts apps/playground/src/asset-host.test.ts apps/playground/src/App.vue apps/playground/src/App.test.ts
git commit -m "feat: add multi-selection resize snapping"
~~~

- [ ] **Step 5: Update and separately commit 进度.md**

Add a concise milestone entry recording multi-selection handles, Shift ratio locking, deterministic resize snapping/guides, atomic resizeSelection mapping including group descendants, Playground wiring, missing status locales, and exact validation counts. Update the “下次开工” section to the next roadmap item without deleting existing deferred work.

Run:

~~~powershell
git diff --check
git diff -- 进度.md
git add -- 进度.md
git commit -m "docs: record multi-selection resize milestone"
~~~

- [ ] **Step 6: Confirm clean handoff**

~~~powershell
git status --short --branch
git log -6 --oneline
~~~

Expected: clean worktree with separate design, plan, implementation, and milestone commits.
