# 阶段 4 光标与文本选区实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 headless ProseMirror selection 映射为画布光标/选区，并同步 IME 候选框位置。

**Architecture:** `@ppt4ai/text` 通过确定性行盒与 run 几何提供 PM 位置映射和 hit-test。`@ppt4ai/editor` 负责 EMU 与屏幕 px 转换、UnoCSS overlay 和 controller 到 IME bridge 的同步；核心层不依赖 DOM。

**Tech Stack:** TypeScript、ProseMirror model/state、Vue 3、UnoCSS、Vitest、happy-dom。

## Global Constraints

- 不引入 Element Plus；UI 只依赖 Vue 与 UnoCSS。
- `@ppt4ai/text`、`@ppt4ai/model`、`@ppt4ai/render` 必须保持 headless。
- 公共输出必须支持 `structuredClone`，不得返回 ProseMirror 对象或 DOMRect。
- PM position 使用 UTF-16 文档位置；Enter 仍为段落拆分。
- 每个阶段完成只创建一个实现提交。

---

### Task 1: Add headless text position mapping

**Files:**
- Create: `packages/text/src/position-mapping.ts`
- Modify: `packages/text/src/index.ts`
- Test: `packages/text/src/position-mapping.test.ts`

**Interfaces:**
- `TextCaretRect`: `{ x: number; y: number; width: number; height: number }` in layout coordinates.
- `TextSelectionRect`: `{ x: number; y: number; width: number; height: number; from: number; to: number }`.
- `mapTextPosition(layout, document, position): TextCaretRect`.
- `mapTextSelection(layout, document, anchor, head): TextSelectionRect[]`.
- `textPositionAtPoint(layout, document, point): number`.

- [x] **Step 1: Write failing tests**

Cover `A中B` on one line, a soft-wrapped line, two explicit paragraphs, an empty paragraph, paragraph start/end positions, reverse selections, and hit-test points before/after a glyph. Assert all returned values are plain cloneable objects.

- [x] **Step 2: Run focused tests and verify RED**

Run `pnpm exec vitest run packages/text/src/position-mapping.test.ts`. Expected failure is missing `position-mapping.ts` exports.

- [x] **Step 3: Implement minimal mapping**

Derive paragraph content starts from `document.child(i).nodeSize`, match each layout line to the next occurrence of its rendered run text, measure character advances with the run marks and `layout.fontScale`, and clamp positions to valid text boundaries. Use nearest line and nearest character midpoint for hit testing. Return fresh plain objects.

- [x] **Step 4: Run text tests**

Run `pnpm exec vitest run packages/text/src/position-mapping.test.ts packages/text/src/text-layout.test.ts packages/text/src/editor/editor-state.test.ts`; expected result is PASS.

### Task 2: Add editor coordinate conversion and overlay

**Files:**
- Create: `packages/editor/src/text-editor-interaction.ts`
- Create: `packages/editor/src/TextEditorOverlay.vue`
- Create: `packages/editor/src/text-editor-interaction.test.ts`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- `TextViewportTransform`: `{ originX: number; originY: number; scale: number }`.
- `layoutRectToScreen(rect, transform): ScreenRect`.
- `createTextInteraction(layout, document, selection, transform): { caret: ScreenRect; selection: ScreenRect[] }`.

- [x] **Step 1: Write failing geometry and Vue tests**

Assert EMU-to-screen conversion at 100% and 125%, reverse selection rendering, one caret, selection rectangles, and inactive overlay rendering. Mount the component through `createApp`; assert no Element Plus dependency and stable `data-text-caret`/`data-text-selection` attributes.

- [x] **Step 2: Run focused tests and verify RED**

Run `pnpm exec vitest run packages/editor/src/text-editor-interaction.test.ts`; expected failure is missing module/component exports.

- [x] **Step 3: Implement UnoCSS-only overlay**

Render absolute rects using inline `left/top/width/height`, a 1px caret with `aria-hidden`, and selection highlights with pointer-events disabled. Keep the component presentational and avoid nested cards or CSS viewport scaling.

- [x] **Step 4: Run focused editor tests**

Run `pnpm exec vitest run packages/editor/src/text-editor-interaction.test.ts packages/editor/src/selection-overlay.test.ts`; expected result is PASS.

### Task 3: Synchronize controller and IME caret

**Files:**
- Modify: `packages/editor/src/text-editor-controller.ts`
- Modify: `packages/editor/src/text-editor-controller.test.ts`

**Interfaces:**
- Add `syncCaret(rect: ScreenRect): void` to `TextEditorController`.
- `focus()` calls the last `syncCaret` rect after bridge focus when one exists.

- [x] **Step 1: Add failing bridge synchronization tests**

Record bridge `setCaretRect` calls, verify `syncCaret` forwards a cloned screen rect, `focus` repeats the latest rect, and calls after destroy are ignored.

- [x] **Step 2: Run focused test and verify RED**

Run `pnpm exec vitest run packages/editor/src/text-editor-controller.test.ts`; expected failure is the absent method/forwarding.

- [x] **Step 3: Implement sync lifecycle**

Store the latest finite rect, forward it to `bridge.setCaretRect`, and keep the existing single-state dispatch and idempotent destroy behavior.

- [x] **Step 4: Run controller and bridge tests**

Run `pnpm exec vitest run packages/editor/src/text-editor-controller.test.ts packages/text/src/ime/create-ime-input-bridge.test.ts`; expected result is PASS.

### Task 4: Validate and record the slice

**Files:**
- Modify: `进度.md`
- Modify: `docs/superpowers/specs/2026-08-23-stage-4-caret-selection-design.md`
- Modify: `docs/superpowers/plans/2026-08-23-stage-4-caret-selection.md`

- [x] **Step 1: Mark completed behavior**

Record PM position mapping, hit-testing, screen conversion, overlay rendering, and bridge caret synchronization. Leave formatting, bullets, vertical text, tables, and export as later work.

- [x] **Step 2: Run repository validation**

Run `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check`; all must pass.

- [ ] **Step 3: Create the only implementation commit**

Run `git add packages/text packages/editor docs/superpowers/specs/2026-08-23-stage-4-caret-selection-design.md docs/superpowers/plans/2026-08-23-stage-4-caret-selection.md 进度.md; git commit -m "feat: add stage 4 text caret selection"; git status --short`.
