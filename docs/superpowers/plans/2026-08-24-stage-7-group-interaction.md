# Stage 7 Group Canvas Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make top-level groups selectable, movable, and resizable as one canvas object while preserving flat leaf-node rendering.

**Architecture:** `@ppt4ai/render` adds clone-safe group interaction metadata alongside existing flat `nodes`. `@ppt4ai/editor` resolves hit targets and selection bounds from either metadata or nodes, while `@ppt4ai/engine` recursively transforms group descendants in one patch. Playground keeps its existing controlled event flow and proves the complete host integration.

**Tech Stack:** TypeScript 6, Vue 3, Vitest, pnpm workspace, UnoCSS, structured-clone-safe headless packages.

## Global Constraints

- UI depends only on Vue, Vue-I18n, and UnoCSS; do not add Element Plus or another component framework.
- `model`, `render`, and `engine` remain headless and browser-DOM independent.
- SceneGraph, engine state, commands, events, and test fixtures remain compatible with `structuredClone`.
- Keep `SceneGraph.nodes` flat and preserve existing thumbnail and painter protocols.
- Do not implement enter-group, child selection, group text editing, rotation, snapping, or group toolbar commands.
- Every production behavior follows RED → GREEN → REFACTOR and each task ends with focused passing tests.

---

### Task 1: Render Group Interaction Metadata

**Files:**
- Modify: `packages/render/src/scenegraph.ts`
- Test: `packages/render/src/scene.test.ts`

**Interfaces:**
- Produces: `SceneGroup { id, bounds, childIds, ancestorIds, paintOrder }`
- Produces: `SceneGraph.groups?: SceneGroup[]`
- Preserves: existing `SceneGraph.nodes: SceneNode[]` order and content

- [ ] **Step 1: Write the failing metadata tests**

Add a nested-group fixture with a sibling leaf after it. Assert exact flat node order, exact outer/inner group metadata, ancestor order, paint order, and `structuredClone(graph) === graph`. The test catches missing group metadata, wrong nesting, and accidental insertion of group nodes into the painter list.

- [ ] **Step 2: Run the focused render test and verify RED**

Run: `pnpm --filter @ppt4ai/render test -- --run packages/render/src/scene.test.ts`

Expected: FAIL because `SceneGraph` has no `groups` metadata.

- [ ] **Step 3: Implement minimal traversal metadata**

Extend group recursion to carry `ancestorIds`, capture the starting and ending leaf-node indexes, and append a plain `SceneGroup` record. Use the last emitted descendant node index as `paintOrder`; keep groups with no drawable descendants deterministic by using the traversal position immediately before the next leaf.

- [ ] **Step 4: Run focused tests and refactor**

Run the command from Step 2. Expected: PASS with existing scene conversion snapshots unchanged except for the optional metadata field where groups exist.

### Task 2: Editor Group Hit Testing and Selection Bounds

**Files:**
- Modify: `packages/editor/src/slide-canvas.ts`
- Modify: `packages/editor/src/PptEditor.vue`
- Test: `packages/editor/src/slide-canvas.test.ts`
- Test: `packages/editor/src/PptEditor.test.ts`
- Test: `packages/editor/src/SlideCanvas.test.ts`

**Interfaces:**
- Consumes: `SceneGraph.groups`
- Produces: `hitTestScene(scene, point)` returning a top-level group ID before a contained leaf ID
- Produces: selection overlay bounds resolved from group metadata or leaf nodes
- Preserves: `SlideCanvas` select/move event payloads and text-only double-click activation

- [ ] **Step 1: Write failing pure hit-test cases**

Assert that a point in nested group content returns the outer group, a point in an ungrouped overlapping node respects paint order, and a point outside group bounds still reaches an eligible ungrouped node. The test catches child penetration and a global “groups always win” z-order bug.

- [ ] **Step 2: Run the focused hit-test test and verify RED**

Run: `pnpm --filter @ppt4ai/editor test -- --run packages/editor/src/slide-canvas.test.ts`

Expected: FAIL because hit testing ignores group metadata.

- [ ] **Step 3: Implement a unified ordered hit target list**

Create clone-free transient hit targets from top-level groups and ungrouped nodes, sort by paint order plus stable source order, and scan from top to bottom. Exclude every node whose ancestor is a group so grouped leaves cannot be selected directly.

- [ ] **Step 4: Write failing Vue selection tests**

Mount `PptEditor` with one group metadata record and assert selecting its ID renders one border and eight handles at group bounds. Mount `SlideCanvas`, click a grouped leaf, and assert select/move-start payloads carry the group ID. The tests catch bounds lookup limited to `scene.nodes` and component-level event drift.

- [ ] **Step 5: Run Vue tests and verify RED**

Run: `pnpm --filter @ppt4ai/editor test -- --run packages/editor/src/PptEditor.test.ts packages/editor/src/SlideCanvas.test.ts`

Expected: at least the group selection overlay assertion FAILS.

- [ ] **Step 6: Implement group-aware bounds lookup**

Resolve selected bounds from `scene.groups` first and `scene.nodes` second. Leave text activation lookup node-only so double-clicking a group cannot enter a child editor.

- [ ] **Step 7: Run all focused editor tests**

Run: `pnpm --filter @ppt4ai/editor test -- --run packages/editor/src/slide-canvas.test.ts packages/editor/src/PptEditor.test.ts packages/editor/src/SlideCanvas.test.ts`

Expected: PASS with ordinary node selection, drag, resize, text activation, and group interaction covered.

### Task 3: Recursive Engine Group Transforms

**Files:**
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/engine.test.ts`

**Interfaces:**
- Consumes: existing `GroupElement.childIds` and validated positive bounds
- Preserves: `EngineCommand` shapes for `move` and `resize`
- Produces: one patch containing group and descendant bounds changes

- [ ] **Step 1: Write failing recursive move tests**

Create outer and nested groups containing two leaves. Select the outer group, dispatch one move, and assert every group and leaf moves exactly once, undo depth becomes one, undo restores all bounds, and redo reapplies all bounds.

- [ ] **Step 2: Run focused engine move test and verify RED**

Run: `pnpm --filter @ppt4ai/engine test -- --run packages/engine/src/engine.test.ts -t "moves nested groups"`

Expected: FAIL because only the selected group bounds move.

- [ ] **Step 3: Implement recursive move collection**

Collect selected IDs and every descendant with a visited set, then emit one bounds change per unique element. Preserve multi-selection behavior and existing snapping calculations for the selected roots.

- [ ] **Step 4: Run focused move test and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Write failing non-uniform resize tests**

Resize an outer group to a translated, non-uniformly scaled rectangle. Assert exact mapped bounds for direct leaves, nested group, and nested leaves; assert one undo entry and full undo/redo restoration. Include a mutation-sensitive assertion for both position and size on each axis.

- [ ] **Step 6: Run focused engine resize test and verify RED**

Run: `pnpm --filter @ppt4ai/engine test -- --run packages/engine/src/engine.test.ts -t "resizes nested groups"`

Expected: FAIL because descendants remain unchanged.

- [ ] **Step 7: Implement recursive affine bounds mapping**

Map every descendant rectangle from the previous outer bounds into the requested outer bounds. Set the root group to the exact requested bounds, include nested groups in the same patch, and retain ordinary element resize behavior.

- [ ] **Step 8: Run complete engine tests**

Run: `pnpm --filter @ppt4ai/engine test -- --run packages/engine/src/engine.test.ts`

Expected: PASS with no history or snap regressions.

### Task 4: Playground Group Integration

**Files:**
- Modify: `apps/playground/src/asset-host.ts`
- Modify: `apps/playground/src/App.vue`
- Test: `apps/playground/src/asset-host.test.ts`
- Test: `apps/playground/src/App.test.ts`

**Interfaces:**
- Consumes: unchanged `selectElement`, `moveSelected`, and `resizeElement` host API
- Produces: seeded group SceneGraph metadata and group-capable controlled editor flow

- [ ] **Step 1: Write failing host integration test**

Seed a group containing the existing demo shape and text, select the group, move it, then resize it. Assert selected ID, exact descendant bounds, rebuilt SceneGraph group bounds, and one undo entry per committed gesture.

- [ ] **Step 2: Run focused playground host test and verify RED**

Run: `pnpm --filter @ppt4ai/playground test -- --run apps/playground/src/asset-host.test.ts -t "group"`

Expected: FAIL because the seeded document has no interactive group fixture or recursive transforms.

- [ ] **Step 3: Add the minimal demo group fixture**

Wrap existing shape and text in `group_demo`, update slide ordering, and leave table/image flows ungrouped. Reuse the existing host methods without adding group-specific APIs.

- [ ] **Step 4: Write failing App interaction assertion**

Mount the real Playground app, click within grouped content, and assert the selected-element output reports `group_demo`. Keep Canvas context as the only browser rendering double.

- [ ] **Step 5: Run focused App test and verify RED or integration gap**

Run: `pnpm --filter @ppt4ai/playground test -- --run apps/playground/src/App.test.ts -t "group"`

Expected: FAIL until the fixture and SceneGraph/editor chain are connected; if the prior step already connects it, record that the integration test passes because production behavior was completed by earlier TDD cycles rather than adding duplicate implementation.

- [ ] **Step 6: Complete minimal wiring and run playground tests**

Run: `pnpm --filter @ppt4ai/playground test -- --run apps/playground/src/asset-host.test.ts apps/playground/src/App.test.ts`

Expected: PASS with asset selection, upload, text edit, and existing canvas interactions unchanged.

### Task 5: Full Validation and Milestone Commits

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Documents: completed group interaction scope, validation counts, and next original-plan slice

- [ ] **Step 1: Run focused package suites**

Run render, editor, engine, and Playground test files touched above. Expected: PASS with pristine output.

- [ ] **Step 2: Run workspace validation serially**

Run in order:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm check:boundaries
rg -n "element-plus|ElementPlus|el-(button|input|select|dialog|dropdown|menu|tooltip|popover)" package.json pnpm-lock.yaml packages apps
git diff --check
```

Expected: all commands PASS; the Element Plus scan returns no matches.

- [ ] **Step 3: Commit implementation**

Stage only source and test files for this slice and commit:

```powershell
git commit -m "feat: add group canvas interactions"
```

- [ ] **Step 4: Update progress documentation**

Record group selection, recursive move/resize, single-transaction undo, explicit deferred scope, exact validation totals, and the next item from the architecture plan.

- [ ] **Step 5: Validate docs and commit milestone**

Run `git diff --check`, stage `进度.md`, and commit:

```powershell
git commit -m "docs: record group interaction milestone"
```

- [ ] **Step 6: Confirm clean handoff**

Run `git status --short --branch` and `git log -5 --oneline`. Expected: clean branch with separate design, implementation, and progress commits.
