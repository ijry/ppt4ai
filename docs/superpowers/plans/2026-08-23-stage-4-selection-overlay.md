# Stage 4 Selection Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic selection-border and eight-handle resize geometry plus a reusable UnoCSS Vue overlay that feeds the existing engine resize command.

**Architecture:** `@ppt4ai/editor` owns a headless geometry module and a thin Vue component. The geometry module never touches DOM or engine state; the component renders the supplied model and emits pointer intent. Hosts convert coordinates and dispatch the existing `EditorEngine` `{ type: 'resize' }` command.

**Tech Stack:** TypeScript, Vue 3, UnoCSS, Vitest, existing `@ppt4ai/model` `Rect` and `@ppt4ai/engine` command contracts.

## Global Constraints

- Do not add Element Plus or another component framework.
- Keep model, text, geometry, and rendering packages headless and JSON-safe.
- Keep all public geometry values structured-clone-safe.
- Support positive finite rectangles only; never allow resize to create negative dimensions.
- Create one implementation commit for this completed slice.

---

### Task 1: Add failing selection geometry tests

**Files:**
- Create: `packages/editor/src/selection-overlay.test.ts`
- Create: `packages/editor/src/selection-overlay.ts`

**Interfaces:**
- `SelectionHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'`
- `createSelectionOverlay(bounds: Rect, options?: { handleSize?: number }): SelectionOverlayModel`
- `resizeBounds(startBounds: Rect, handle: SelectionHandle, pointer: Point, options?: { minWidth?: number; minHeight?: number }): Rect`

- [x] **Step 1: Write tests for handle placement and resize behavior**

Cover these exact behaviors:

```ts
const bounds = { x: 10, y: 20, w: 100, h: 60 }
const overlay = createSelectionOverlay(bounds, { handleSize: 8 })
expect(overlay.border).toEqual(bounds)
expect(overlay.handles.map(({ name }) => name)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'])
expect(overlay.handles.find(({ name }) => name === 'nw')?.rect).toEqual({ x: 6, y: 16, w: 8, h: 8 })
expect(overlay.handles.find(({ name }) => name === 'e')?.rect).toEqual({ x: 106, y: 46, w: 8, h: 8 })
expect(resizeBounds(bounds, 'se', { x: 140, y: 100 })).toEqual({ x: 10, y: 20, w: 130, h: 80 })
expect(resizeBounds(bounds, 'w', { x: 40, y: 0 })).toEqual({ x: 40, y: 20, w: 70, h: 60 })
expect(resizeBounds(bounds, 'nw', { x: 200, y: 200 }, { minWidth: 30, minHeight: 25 })).toEqual({ x: 80, y: 55, w: 30, h: 25 })
expect(() => resizeBounds(bounds, 'n', { x: Number.NaN, y: 0 })).toThrow('pointer must be finite')
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `pnpm vitest run packages/editor/src/selection-overlay.test.ts`

Expected: FAIL because `selection-overlay.ts` does not exist yet.

### Task 2: Implement deterministic geometry

**Files:**
- Modify: `packages/editor/src/selection-overlay.ts`

**Interfaces:**
- `Point` contains finite `x` and `y`.
- `SelectionHandleRect` contains `name` and a positive `rect`.
- `SelectionOverlayModel` contains `border` and exactly eight handles in clockwise order starting at `nw`.

- [x] **Step 1: Implement validation and cloned overlay output**

Validate finite coordinates, positive bounds, and positive handle size. Compute each handle rectangle from its center and return fresh objects.

- [x] **Step 2: Implement clamped edge and corner resizing**

Keep the opposite edge fixed, clamp dimensions to `minWidth` and `minHeight`, and preserve the untouched axis for edge handles. Validate options and return a fresh `Rect`.

- [x] **Step 3: Run focused tests and refactor only after green**

Run: `pnpm vitest run packages/editor/src/selection-overlay.test.ts`

Expected: PASS with all geometry assertions green.

### Task 3: Export and render the Vue overlay

**Files:**
- Create: `packages/editor/src/SelectionOverlay.vue`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- Props: `active: boolean`, `bounds: Rect`, optional `handleSize: number`.
- Emits: `resize-start`, `resize`, `resize-end`, each with `{ handle: SelectionHandle; point: Point }`.

- [x] **Step 1: Add component render tests**

Extend `packages/editor/src/selection-overlay.test.ts` with Vue app mounting through `createApp` and a DOM host. Assert inactive renders no `.ppt-selection-overlay`, while active renders one border and eight `[data-selection-handle]` elements.

- [x] **Step 2: Run the component test and verify it fails**

Run: `pnpm vitest run packages/editor/src/selection-overlay.test.ts`

Expected: FAIL because `SelectionOverlay.vue` is not defined/exported.

- [x] **Step 3: Implement the UnoCSS-only component**

Render absolute-positioned border and handle buttons from `createSelectionOverlay`. Use stable data attributes and directional cursor utility classes. Keep the component presentational; do not import Element Plus or mutate engine state.

- [x] **Step 4: Export component and types**

Export `SelectionOverlay`, `createSelectionOverlay`, `resizeBounds`, and their public types from `packages/editor/src/index.ts`.

- [x] **Step 5: Run focused editor tests**

Run: `pnpm vitest run packages/editor/src/selection-overlay.test.ts packages/editor/src/text-editor-controller.test.ts`

Expected: PASS.

### Task 4: Record the slice and validate the repository

**Files:**
- Modify: `进度.md`
- Modify: `docs/superpowers/specs/2026-08-23-stage-4-selection-overlay-design.md`
- Modify: `docs/superpowers/plans/2026-08-23-stage-4-selection-overlay.md`
- Modify: `package.json`
- Create: `vitest.config.mts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Mark implementation tasks complete**

Record the selection border, eight handles, clamped resize geometry, and UnoCSS component. Keep visual caret/selection mapping listed as the next slice.

- [x] **Step 2: Run repository validation**

Run:

```bash
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands pass and no unrelated files change.

- [x] **Step 3: Create the only implementation commit**

Run:

```bash
git add packages/editor docs/superpowers/specs/2026-08-23-stage-4-selection-overlay-design.md docs/superpowers/plans/2026-08-23-stage-4-selection-overlay.md 进度.md
git commit -m "feat: add stage 4 selection overlay"
git status --short
```

Expected: one commit for this slice and a clean worktree.
