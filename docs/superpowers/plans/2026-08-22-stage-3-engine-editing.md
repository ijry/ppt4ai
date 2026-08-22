# Stage 3 Engine Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a headless command-driven editing engine for selection, bounds transforms, snapping, history, z-order, and flat groups.

**Architecture:** `@ppt4ai/engine` owns an immutable-facing document session, selection state, snap guides, and patch-based undo/redo. Commands are the only document write API. Groups remain flat model elements and render recursively through the existing SceneGraph converter.

**Tech Stack:** TypeScript 6 strict mode, Vitest, JSON-safe model values, EMU coordinates, no Vue or DOM globals.

## Global Constraints

- Do not add Element Plus or another component framework; UnoCSS remains the only UI styling framework.
- Headless packages cannot import Vue or use DOM globals.
- Document and engine state must remain JSON-safe and `structuredClone`-safe.
- Coordinates remain EMU and colors remain structured color objects.
- All document writes must enter through `EditorEngine.dispatch(command)`.
- Do not add export dependencies or alter unrelated packages.

---

### Task 1: Add flat group model and SceneGraph expansion

**Files:**
- Modify: `packages/model/src/index.ts`
- Modify: `packages/model/src/model.test.ts`
- Modify: `packages/render/src/scenegraph.ts`
- Modify: `packages/render/src/scene.test.ts`

**Interfaces:**
- Add `GroupElement` with `kind: 'group'`, positive `bounds`, and `childIds: string[]`.
- Extend `Element` and validation for group child references and duplicate child IDs.
- Recursively expand group children in `documentToSceneGraph` while preserving child order and preventing cycles.

- [x] **Step 1: Write the failing tests**

```ts
it('validates and renders a flat group in child order', () => {
  const document = makeDocumentWithGroup()
  expect(validateDocument(document)).toEqual({ valid: true })
  expect(documentToSceneGraph(document).nodes.map((node) => node.id)).toEqual(['el_a', 'el_b'])
})
```

- [x] **Step 2: Run the focused tests and verify they fail**

Run `pnpm exec vitest run packages/model/src/model.test.ts packages/render/src/scene.test.ts`. Expected: TypeScript/test failure because `group` is not yet an `Element` and SceneGraph only visits direct slide IDs.

- [x] **Step 3: Implement the model and recursive render expansion**

Add the group union member, validate each child reference and duplicate child ID, then recursively create nodes for group children with a visited set so malformed cycles are skipped deterministically.

- [x] **Step 4: Run the focused tests and verify they pass**

Run `pnpm exec vitest run packages/model/src/model.test.ts packages/render/src/scene.test.ts`.

### Task 2: Add JSON-safe patch history and command session

**Files:**
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/src/engine.test.ts`

**Interfaces:**
- `EditorEngine(document: Ppt4aiDocument, options?: EngineOptions)`.
- `dispatch(command: EngineCommand): EngineState`.
- `getState(): EngineState`.
- `EngineCommand` includes `select`, `undo`, and `redo` in this task.
- `Patch`, `PatchOperation`, and explicit `PatchValue` presence markers are exported.

- [x] **Step 1: Write failing command and history tests**

```ts
it('keeps selection separate from document history and clones state safely', () => {
  const engine = new EditorEngine(makeDocument())
  expect(engine.dispatch({ type: 'select', elementIds: ['el_a'] }).selection).toEqual(['el_a'])
  expect(engine.dispatch({ type: 'undo' }).selection).toEqual(['el_a'])
  expect(structuredClone(engine.getState())).toEqual(engine.getState())
})
```

- [x] **Step 2: Run the test and verify it fails**

Run `pnpm exec vitest run packages/engine/src/engine.test.ts`. Expected: failure because `EditorEngine` and command contracts do not exist.

- [x] **Step 3: Implement the session, patch primitives, and select/undo/redo**

Clone the input document at construction and on state reads. Implement path-based patch application with `{ present: false }` deletion, undo/redo stacks, and selection validation against existing element IDs. Selection commands do not enter history; undo and redo only apply document patches.

- [x] **Step 4: Run the test and verify it passes**

Run `pnpm exec vitest run packages/engine/src/engine.test.ts`.

### Task 3: Implement bounds transforms and deterministic snapping

**Files:**
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/src/engine.test.ts`

**Interfaces:**
- `EngineOptions.snap?: { gridSize?: number; threshold: number; enabled?: boolean }`.
- Commands `{ type: 'move'; dx: number; dy: number }` and `{ type: 'resize'; elementId: string; bounds: Rect }`.
- `SnapGuide` exposes `axis`, `position`, `source`, and optional `elementId`.

- [x] **Step 1: Write failing move, resize, and snapping tests**

```ts
it('moves selected bounds and snaps to another element edge', () => {
  const engine = new EditorEngine(makeDocument(), { snap: { threshold: 100000 } })
  engine.dispatch({ type: 'select', elementIds: ['el_a'] })
  const state = engine.dispatch({ type: 'move', dx: 1900000, dy: 0 })
  expect(state.document.elements.el_a?.bounds.x).toBe(3000000)
  expect(state.guides).toEqual([{ axis: 'x', position: 3000000, source: 'element', elementId: 'el_b' }])
})
```

- [x] **Step 2: Run focused tests and verify they fail**

Run `pnpm exec vitest run packages/engine/src/engine.test.ts`. Expected: failure because transform commands and snap calculation are missing.

- [x] **Step 3: Implement transform patches and snapping**

Compute the selection union, derive edge/center candidates from unselected elements and the configured grid, choose the nearest candidate per axis within threshold, emit guides, and patch every affected bounds in one transaction. Reject non-positive resize bounds without changing the document.

- [x] **Step 4: Run focused tests and verify they pass**

Run `pnpm exec vitest run packages/engine/src/engine.test.ts`.

### Task 4: Implement z-order and group commands

**Files:**
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/engine/src/engine.test.ts`

**Interfaces:**
- `{ type: 'zOrder'; action: 'front' | 'back' | 'forward' | 'backward' }`.
- `{ type: 'group' }` and `{ type: 'ungroup'; groupId: string }`.

- [x] **Step 1: Write failing z-order and group tests**

```ts
it('groups selected elements and restores order on undo and ungroup', () => {
  const engine = new EditorEngine(makeDocument(), { idFactory: () => 'grp_1' })
  engine.dispatch({ type: 'select', elementIds: ['el_a', 'el_b'] })
  engine.dispatch({ type: 'group' })
  expect(engine.getState().document.slides.sld_1?.elementIds).toEqual(['grp_1'])
  engine.dispatch({ type: 'ungroup', groupId: 'grp_1' })
  expect(engine.getState().document.slides.sld_1?.elementIds).toEqual(['el_a', 'el_b'])
})
```

- [x] **Step 2: Run focused tests and verify they fail**

Run `pnpm exec vitest run packages/engine/src/engine.test.ts`. Expected: failure because z-order and group commands are missing.

- [x] **Step 3: Implement z-order, group, ungroup, and recursive group bounds**

Use slide array order as z-order, preserve selected relative order during z-order operations, create a group patch that inserts one group ID at the first selected position, retain children in the flat element map, and ungroup by restoring child IDs at the group position. Group and child bounds updates must remain positive and cycle-free.

- [x] **Step 4: Run focused tests and verify they pass**

Run `pnpm exec vitest run packages/engine/src/engine.test.ts packages/model/src/model.test.ts packages/render/src/scene.test.ts`.

### Task 5: Run Stage 3 gates, update progress, and commit

**Files:**
- Modify: `进度.md`
- Modify: `docs/superpowers/plans/2026-08-22-stage-3-engine-editing.md`

- [x] **Step 1: Run the full verification gates**

Run `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, and `pnpm build`; all must pass.

- [x] **Step 2: Update progress and mark this plan complete**

Mark Stage 3 complete, Stage 4 as the next target, record the test count and gate results, and check every completed plan item.

- [x] **Step 3: Review and commit once**

Run `git diff --check`, verify no generated `dist` files are staged, then run exactly `git add packages/model packages/render packages/engine 进度.md docs/superpowers/plans/2026-08-22-stage-3-engine-editing.md && git commit -m "feat: add stage 3 editing engine"`.
