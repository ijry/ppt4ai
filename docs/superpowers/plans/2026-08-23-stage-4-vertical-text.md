# Stage 4 Basic Vertical Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with focused verification and one commit per task.

**Goal:** Add deterministic, body-level vertical text layout, editing geometry, and PPTX import while preserving the existing horizontal text contract.

**Architecture:** Keep `TextBodyProperties.vertical` as the only model switch. `@ppt4ai/text` dispatches to a vertical column layout path that reuses existing tokenization, measurement, numbering, and autofit semantics; vertical layout adds cell coordinates and orientation metadata only on vertical output. Position mapping consumes those columns through the same document-position accounting used by horizontal text. The importer maps `a:bodyPr/@vert` into the structured body and keeps the legacy text field.

**Tech Stack:** TypeScript, Vitest, existing `@ppt4ai/model`, `@ppt4ai/text`, and `@ppt4ai/pptx-import` packages; no new runtime dependencies and no Element Plus.

## Global Constraints

- `@ppt4ai/text` stays headless: no Vue, DOM, Canvas, browser font measurement, or editor UI imports.
- Omitted `bodyPr.vertical` means horizontal; horizontal layout object shapes and snapshots remain unchanged.
- Marker glyphs never enter `TextRun.text`; all public values remain `structuredClone` safe.
- Vertical columns progress right-to-left, while characters inside a column progress top-to-bottom.
- CJK/full-width cells are `upright`; Latin, digits, and punctuation cells are `rotated` metadata only.
- Use TDD for every behavior: failing focused test, verified red run, minimal implementation, green run, then refactor.
- Commit each completed task separately; do not commit unrelated files or modify Element Plus dependencies.

---

### Task 1: Add the vertical text model contract

**Files:**
- Modify: `packages/model/src/index.ts: TextBodyProperties and validateTextBody`
- Test: `packages/model/src/model.test.ts`

**Interfaces:**
- Produces `TextBodyProperties.vertical?: 'horizontal' | 'vertical'`.
- Validation rejects any present non-string or non-`horizontal`/`vertical` value with `bodyPr.vertical must be horizontal or vertical`.

- [ ] **Step 1: Write the failing model tests**

Add tests that validate `{ bodyPr: { vertical: 'vertical' }, paragraphs: [{ runs: [{ text: '中文' }] }] }`, accept explicit `horizontal`, reject `diagonal` and numeric values with the exact path-bearing error, and prove a vertical body survives `structuredClone`.

- [ ] **Step 2: Run the model test to verify red**

Run: `pnpm --filter @ppt4ai/model test -- src/model.test.ts`

Expected: FAIL because `TextBodyProperties` validation currently ignores `vertical` and the type does not expose the property.

- [ ] **Step 3: Implement the minimal model change**

Add the union property beside `verticalAlign`, add a `writingModes` set, and validate the property only when present. Do not normalize or mutate the body in the model validator.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @ppt4ai/model test -- src/model.test.ts; pnpm --filter @ppt4ai/model typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the model slice**

Run:
```text
git add packages/model/src/index.ts packages/model/src/model.test.ts
git commit -m "feat: add vertical text model contract"
```

### Task 2: Add deterministic vertical column layout

**Files:**
- Modify: `packages/text/src/layout.ts`
- Modify: `packages/text/src/index.ts` only if vertical layout types need public exports
- Test: `packages/text/src/text-layout.test.ts`

**Interfaces:**
- Horizontal `TextLayout`, `TextLayoutLine`, `TextLayoutRun`, and `TextLayoutMarker` output remains compatible with existing callers.
- Vertical `TextLayout` includes `vertical: 'vertical'` and vertical lines/runs/markers expose `y`, `height`, and `orientation: 'upright' | 'rotated'` as specified by `docs/superpowers/specs/2026-08-23-stage-4-vertical-text-design.md`.
- `layoutText` continues to accept `TextLayoutInput` and returns clone-safe geometry.

- [ ] **Step 1: Write failing vertical layout tests**

Add one focused test for a vertical body containing `中文A1，` and assert one column starts at the right content edge, moves left for additional columns, CJK/full-width cells are upright, Latin/digits/punctuation are rotated, and text order remains unchanged. Add separate tests for height wrapping into right-to-left columns, explicit paragraph breaks and empty paragraphs, cross-axis alignment, bullet/number marker placement, vertical alignment, and shrink/resize overflow behavior.

- [ ] **Step 2: Run the layout tests to verify red**

Run: `pnpm --filter @ppt4ai/text test -- src/text-layout.test.ts`

Expected: FAIL because layout currently emits only horizontal lines and no vertical metadata.

- [ ] **Step 3: Implement the minimal vertical layout path**

Refactor only the shared token/cell positioning needed to add a `layoutVerticalAtScale` path. Reuse `paragraphTokens`, `resolveMarker`, `lineHeight`, and existing numbering state. Pack tokens top-to-bottom by available height, emit at least one column for every paragraph, position columns from right to left, apply paragraph alignment on the cross-axis, preserve marker-only paragraphs, and compute deterministic `contentBounds`/`overflow`. Keep the existing horizontal branch untouched where practical, and make `layoutText` route autofit candidates through the active orientation.

- [ ] **Step 4: Run focused tests and package checks**

Run:
```text
pnpm --filter @ppt4ai/text test -- src/text-layout.test.ts
pnpm --filter @ppt4ai/text typecheck
```

Expected: PASS, including all existing horizontal layout tests.

- [ ] **Step 5: Commit the layout slice**

Run:
```text
git add packages/text/src/layout.ts packages/text/src/index.ts packages/text/src/text-layout.test.ts
git commit -m "feat: add vertical text columns"
```

### Task 3: Extend caret, selection, and hit-testing geometry

**Files:**
- Modify: `packages/text/src/position-mapping.ts`
- Test: `packages/text/src/position-mapping.test.ts`

**Interfaces:**
- `mapTextPosition(layout, document, position)` returns the existing horizontal caret shape and vertical caret rectangles with one-pixel flow-axis width and cell-advance cross-axis height.
- `mapTextSelection` returns clone-safe rectangles ordered by document position; vertical rectangles span selected cells within a column.
- `textPositionAtPoint` chooses nearest vertical column and nearest top-to-bottom cell boundary without changing horizontal behavior.

- [ ] **Step 1: Write failing position-mapping tests**

Create a ProseMirror document matching a vertical body with two wrapped columns and an empty paragraph. Assert caret positions have the expected column x/y, selection rectangles have non-negative dimensions and correct `from`/`to`, points near the rightmost column map there before the left column, and an empty paragraph remains addressable.

- [ ] **Step 2: Run mapping tests to verify red**

Run: `pnpm --filter @ppt4ai/text test -- src/position-mapping.test.ts`

Expected: FAIL because mapping currently treats every line as a horizontal x-axis line.

- [ ] **Step 3: Implement orientation-aware mapping**

Extend internal character boundaries to carry the active axis. For vertical lines, advance boundaries by measured cell height from `line.y`, map carets to the column's x and cell y, compute selection rectangles from the min/max cell extents, and select the nearest column by x before comparing cell centers by y. Keep paragraph offsets UTF-16 based and retain existing space-skipping and clamping behavior.

- [ ] **Step 4: Run focused tests and all text tests**

Run:
```text
pnpm --filter @ppt4ai/text test -- src/position-mapping.test.ts src/text-layout.test.ts
pnpm --filter @ppt4ai/text typecheck
```

Expected: PASS with horizontal and vertical mapping coverage.

- [ ] **Step 5: Commit the mapping slice**

Run:
```text
git add packages/text/src/position-mapping.ts packages/text/src/position-mapping.test.ts
git commit -m "feat: map vertical text positions"
```

### Task 4: Import DrawingML vertical writing mode

**Files:**
- Modify: `packages/pptx-import/src/importer.ts`
- Test: `packages/pptx-import/src/importer.test.ts`

**Interfaces:**
- `parseTextBody` continues to produce structured `TextBody` paragraphs and legacy `TextElement.text`.
- `a:bodyPr/@vert` maps `vert270`, `vert`, and `wordArtVert` to `bodyPr.vertical: 'vertical'`; `horz`, `eaVert`, `mongolianVert`, missing, unknown, or malformed values produce no vertical property.

- [ ] **Step 1: Write failing importer fixtures and assertions**

Add fixtures with each supported and ignored `vert` value on `a:bodyPr`, then assert structured body output, preserved run text, legacy text fallback, and `structuredClone(imported)` equality. Include a body without `bodyPr` and an unknown value.

- [ ] **Step 2: Run importer tests to verify red**

Run: `pnpm --filter @ppt4ai/pptx-import test -- src/importer.test.ts`

Expected: FAIL because `parseTextBody` currently ignores `a:bodyPr/@vert`.

- [ ] **Step 3: Implement the importer mapping**

Read the direct `bodyPr` child of `txBody`, map only the enumerated values, and merge `vertical` into `bodyPr` without synthesizing a property for horizontal/unknown values. Preserve every existing paragraph/bullet parsing path and ignore invalid attribute values without throwing.

- [ ] **Step 4: Run importer tests and typecheck**

Run:
```text
pnpm --filter @ppt4ai/pptx-import test -- src/importer.test.ts
pnpm --filter @ppt4ai/pptx-import typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the importer slice**

Run:
```text
git add packages/pptx-import/src/importer.ts packages/pptx-import/src/importer.test.ts
git commit -m "feat: import pptx vertical text"
```

### Task 5: Validate and update the handoff

**Files:**
- Modify: `进度.md`

- [ ] **Step 1: Run the integrated verification suite**

Run:
```text
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands pass. Investigate failures with the narrowest package command and change only the vertical-text slice.

- [ ] **Step 2: Update progress**

Record the vertical text contract, deterministic column layout, position mapping, and PPTX import as complete; include the exact test/typecheck/build result and state that tables and PPTX export remain next work. Keep the UnoCSS-only UI decision visible and do not claim horizontal snapshots changed.

- [ ] **Step 3: Review boundaries and clone safety**

Run:
```text
git status --short
git diff --stat
rg -n "element-plus|ElementPlus" packages docs
```

Inspect changed exports and confirm vertical layout/import values contain no functions, DOM nodes, Vue objects, or marker text mutations.

- [ ] **Step 4: Commit the handoff update**

Run:
```text
git add 进度.md
git commit -m "docs: complete vertical text slice"
```

- [ ] **Step 5: Verify the committed worktree**

Run: `git status --short; git log -5 --oneline`

Expected: clean worktree and the vertical text handoff commit at `HEAD`.

## Self-review

- Spec coverage: model validation, layout orientation/cells, bullets/numbering, wrapping/empty paragraphs, alignment/autofit, position mapping, and all PPTX mapping values each have a task.
- Type consistency: all tasks use the existing `layoutText`, `mapTextPosition`, `mapTextSelection`, `textPositionAtPoint`, `TextBody`, and `TextLayout` entry points.
- Horizontal compatibility: task 2 explicitly preserves existing horizontal output; task 3 retains the horizontal mapping branch.
- Placeholder scan: no TODO, TBD, vague edge-case instruction, or unspecified test command remains.
