# Stage 4 Text Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a JSON-safe, deterministic text model and headless layout engine with automatic wrapping, three Autofit modes, and SceneGraph line-box output.

**Architecture:** `@ppt4ai/model` owns text data contracts and validation only. `@ppt4ai/text` normalizes legacy text, measures characters with fixed metrics, breaks paragraphs into lines, and applies Autofit without DOM or browser font APIs. `@ppt4ai/render` resolves the text body, calls `layoutText`, and stores the resulting JSON-safe layout on each text node.

**Tech Stack:** TypeScript 6, Vitest 4, pnpm workspaces, existing `@ppt4ai/model` / `@ppt4ai/render` packages, and Node.js-compatible pure functions. No Element Plus or new UI framework dependencies.

## Global Constraints

- `@ppt4ai/model` only declares text structures and validation; it must not contain font measurement or line-breaking algorithms.
- `@ppt4ai/text` is a headless pure-function package and cannot import Vue, access DOM globals, call Canvas, or call `measureText`.
- `@ppt4ai/render` consumes completed JSON line boxes and must not measure or reflow text itself.
- Every public model and layout value must be safe for `structuredClone` and contain only JSON-safe values.
- Keep `TextElement.text` as a compatibility field; when both `text` and `body` exist, `body` is authoritative.
- Normalize legacy `\n` into paragraph boundaries; an empty string becomes one empty paragraph.
- Use the fixed character metrics and EMU/point rules from `docs/superpowers/specs/2026-08-22-stage-4-text-layout-design.md`.
- Support `square` and `none` wrapping, left/center/right alignment, basic indent/margins/spacing, and `none` / `shrink` / `resize` Autofit exactly as specified.
- Do not add ProseMirror, browser editing transactions, IME write-back, vertical text, shaping, bullets, tables, or new UI framework code in this stage.
- Run `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, and `pnpm build` before the single Stage 4 commit.
- Update `进度.md` and check off this plan before creating the one Stage 4 commit; do not create intermediate Stage 4 commits.

---

### Task 1: Add Text Model Contracts and Validation

**Files:**
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/src/model.test.ts`

**Interfaces:**
- Consumes: existing `Rect`, `Fill`, `TextElement`, `ElementDefaults`, and `validateDocument` contracts.
- Produces: exported `TextMarks`, `TextRun`, `TextParagraphAttrs`, `TextParagraph`, `TextBodyProperties`, `TextAutofit`, `TextBody`, `TextModelValidation`, and `validateTextBody(value: unknown): TextModelValidation`.

- [ ] **Step 1: Write failing model tests**

Add tests for a valid body, body-only text, an empty run, negative level/insets/spacing, non-positive font size, invalid Autofit values, and a legacy text element. Assert path-bearing errors, for example `paragraphs[0].runs[0].text must be non-empty`.

- [ ] **Step 2: Run the focused model tests**

Run: `pnpm exec vitest run packages/model/src/model.test.ts`; expected result: FAIL because the text contracts and validator do not exist.

- [ ] **Step 3: Implement the JSON-safe contracts**

Add `TextMarks`, `TextRun`, `TextParagraphAttrs`, `TextParagraph`, `TextBodyProperties`, `TextAutofit`, and `TextBody` exactly as specified in `docs/superpowers/specs/2026-08-22-stage-4-text-layout-design.md`. Change `TextElement.text` to optional, add `body?: TextBody`, and add `body?: TextBody` to `ElementDefaults`.

- [ ] **Step 4: Implement validation and run it**

Implement `validateTextBody(value: unknown)` as a pure recursive validator returning deterministic path-bearing errors. Require non-empty paragraphs, non-empty runs, finite positive font sizes, finite baselines, valid enums, non-negative levels/insets/spacing, positive line spacing, `minFontScale` in `1..100000`, and finite positive `maxHeight`. Run `pnpm exec vitest run packages/model/src/model.test.ts` and `pnpm --filter @ppt4ai/model typecheck`; expected result: PASS.

---

### Task 2: Normalize Text and Add Deterministic Measurement

**Files:**
- Modify: `packages/text/package.json`
- Modify: `packages/text/src/index.ts`
- Create: `packages/text/src/normalize.ts`
- Create: `packages/text/src/measure.ts`
- Create: `packages/text/src/text-layout.test.ts`

**Interfaces:**
- Consumes: `TextElement`, `TextBody`, and `TextMarks` from `@ppt4ai/model`.
- Produces: `TextModelError`, `normalizeTextElement(element: TextElement): TextBody`, `DEFAULT_FONT_SIZE`, `DEFAULT_FONT_FAMILY`, and `measureText(text: string, marks?: TextMarks, fontScale?: number): number`.

- [ ] **Step 1: Add dependency and failing normalization tests**

Add `@ppt4ai/model: workspace:*` to `packages/text/package.json`. Test that legacy `text: 'A\n中文'` creates two paragraphs, `body` wins when both fields exist, empty legacy text creates one empty paragraph, outputs clone safely, and invalid bodies throw `TextModelError` with the first path and complete error list.

- [ ] **Step 2: Add failing measurement tests**

Assert exact integer EMU advances for uppercase/digits, lowercase, spaces, ASCII punctuation, CJK/full-width, emoji, and other BMP characters at 18pt and at a non-default `fontScale`.

- [ ] **Step 3: Verify the tests fail**

Run: `pnpm exec vitest run packages/text/src/text-layout.test.ts`; expected result: FAIL because normalization and measurement exports are absent.

- [ ] **Step 4: Implement normalization**

Validate `body` with `validateTextBody`, deep-clone accepted plain values, and split legacy `text` on `\n`. Each non-empty segment becomes one run; each empty segment becomes `runs: []`. Reject an element with neither `text` nor `body`.

- [ ] **Step 5: Implement fixed EMU measurement**

Use 914400 EMU/inch, 72 points/inch, default 18pt, and these exact factors: CJK/full-width/emoji `1.00em`, uppercase/digits `0.62em`, lowercase `0.54em`, space `0.28em`, ASCII punctuation `0.38em`, and other BMP `0.60em`. Iterate Unicode code points, apply the ten-thousandths scale, and round each character advance to integer EMU.

- [ ] **Step 6: Run model and text checks**

Run `pnpm exec vitest run packages/model/src/model.test.ts packages/text/src/text-layout.test.ts` and `pnpm --filter @ppt4ai/text typecheck`; expected result: PASS.

---

### Task 3: Implement Wrapping, Alignment, and Base Line Boxes

**Files:**
- Modify: `packages/text/src/index.ts`
- Create: `packages/text/src/layout.ts`
- Modify: `packages/text/src/text-layout.test.ts`

**Interfaces:**
- Consumes: `measureText`, model `Rect` / `TextBody` / `TextMarks` contracts, and normalized text bodies.
- Produces: `TextLayoutRun`, `TextLayoutLine`, `TextLayout`, `TextLayoutInput`, and `layoutText(input: TextLayoutInput): TextLayout`.

- [ ] **Step 1: Write failing wrapping tests**

Test explicit paragraph lines, CJK character wrapping, English word-first wrapping, mixed CJK/Latin wrapping, long-word character splitting, leading-space trimming, and `wrap: 'none'`. Assert termination when available width is zero or narrower than one glyph.

- [ ] **Step 2: Write failing geometry tests**

Test run fragmentation with marks, left/center/right x positions, insets, paragraph margin/indent, line spacing, space-before/after, top/middle/bottom vertical alignment, zero-width empty-paragraph lines, `contentBounds`, and `structuredClone` equality.

- [ ] **Step 3: Verify layout tests fail**

Run: `pnpm exec vitest run packages/text/src/text-layout.test.ts`; expected result: FAIL because `layoutText` does not exist.

- [ ] **Step 4: Implement tokens and line breaking**

Flatten runs into code-point tokens retaining paragraph index and original marks. For `none`, emit one line per paragraph. For `square`, permit breaks between CJK/full-width characters, prefer spaces between Latin/digit words, remove line-leading spaces, and split an over-wide word by code point. Compute width as `bounds.w - leftInset - rightInset - marginLeft - indent` and clamp it at zero.

- [ ] **Step 5: Implement deterministic line geometry**

Build adjacent tokens with equal marks into line runs. Derive line height from the largest effective font size and `lineSpacing / 100000`; add paragraph spaces; position lines and runs from alignment; calculate `contentBounds`; then offset all y positions for vertical alignment. Keep every geometry value as integer EMU.

- [ ] **Step 6: Run focused layout checks**

Run `pnpm exec vitest run packages/text/src/text-layout.test.ts`; expected result: PASS with stable line/run snapshots.

---

### Task 4: Add `none`, `shrink`, and `resize` Autofit

**Files:**
- Modify: `packages/text/src/layout.ts`
- Modify: `packages/text/src/text-layout.test.ts`

**Interfaces:**
- Consumes: base line generation and `TextBodyProperties.autofit`.
- Produces: `TextLayout` values whose `fontScale`, `bounds`, `contentBounds`, and `overflow` obey Autofit while line run marks retain original font sizes.

- [ ] **Step 1: Write failing Autofit tests**

Assert that `none` keeps bounds and scale `100000` while marking vertical overflow; `shrink` keeps bounds and selects a deterministic largest fitting integer scale; and `resize` keeps x/y/w, expands h, honors `maxHeight`, and marks overflow when capped.

- [ ] **Step 2: Verify Autofit tests fail**

Run: `pnpm exec vitest run packages/text/src/text-layout.test.ts -t Autofit`; expected result: FAIL because the base layout does not search or resize.

- [ ] **Step 3: Implement Autofit orchestration**

Layout once at `100000`. For `none`, compare content height with the inset-constrained height. For `shrink`, binary-search integer scales in `[minFontScale ?? 60000, 100000]`, retaining the largest candidate that fits and keeping overflow when the minimum still fails. For `resize`, preserve x/y/w and scale, set h to required content height plus insets, cap at `maxHeight`, and recompute overflow.

- [ ] **Step 4: Verify scale and JSON safety**

Assert original run marks remain unchanged while geometry reflects the selected scale. Run `pnpm exec vitest run packages/text/src/text-layout.test.ts`, `pnpm --filter @ppt4ai/text typecheck`, and `pnpm --filter @ppt4ai/text build`; expected result: PASS.

---

### Task 5: Attach Text Layouts to SceneGraph

**Files:**
- Modify: `packages/render/package.json`
- Modify: `packages/render/src/scenegraph.ts`
- Modify: `packages/render/src/scene.test.ts`

**Interfaces:**
- Consumes: `normalizeTextElement` and `layoutText` from `@ppt4ai/text`, plus inherited `TextElement` values.
- Produces: `SceneTextNode.layout: TextLayout`, while retaining `SceneTextNode.text` as a flattened compatibility field.

- [ ] **Step 1: Add dependency and failing SceneGraph tests**

Add `@ppt4ai/text: workspace:*` to `packages/render/package.json`. Extend tests to assert paragraph/run order, marks, line geometry, overflow, resized bounds, and the retained compatibility `text` value for legacy and body-only text elements.

- [ ] **Step 2: Verify render tests fail**

Run: `pnpm exec vitest run packages/render/src/scene.test.ts`; expected result: FAIL because text nodes have no `layout`.

- [ ] **Step 3: Integrate headless layout**

In `createTextNode`, call `normalizeTextElement(element)` and `layoutText({ bounds: element.bounds, body })`. Store the result on `layout`; use `element.text` when present, otherwise flatten body paragraphs with `\n`. Do not alter shape/group traversal and do not measure text in render.

- [ ] **Step 4: Run render and boundary checks**

Run `pnpm exec vitest run packages/render/src/scene.test.ts`, `pnpm check:boundaries`, and `pnpm --filter @ppt4ai/render typecheck`; expected result: PASS with no DOM, Canvas, Vue, or Element Plus dependencies in headless packages.

---

### Task 6: Complete Verification and the Single Stage Commit

**Files:**
- Modify: `docs/superpowers/plans/2026-08-22-stage-4-text-layout.md`
- Modify: `进度.md`

**Interfaces:**
- Consumes: all Stage 4 model, text, render, and test changes.
- Produces: a checked plan, progress record, clean verification gate, and one Stage 4 commit.

- [ ] **Step 1: Run the complete verification gate**

Run in order: `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, and `pnpm build`. Expected result: every command exits successfully, including existing IME, engine, import, and SceneGraph regressions.

- [ ] **Step 2: Inspect and document the completed stage**

Run `git diff --check` and `git status --short`. Check every completed box in this plan. Update `进度.md` with the JSON-safe model, deterministic wrapping, Autofit, and SceneGraph line boxes, while leaving ProseMirror and IME transaction integration as the next slice.

- [ ] **Step 3: Create the only Stage 4 commit**

Run:

```bash
git add packages/model packages/text packages/render docs/superpowers/plans/2026-08-22-stage-4-text-layout.md 进度.md pnpm-lock.yaml
git commit -m "feat: add stage 4 deterministic text layout"
git status --short
```

Expected result: the commit succeeds, the worktree is clean, and the handoff records the commit hash. Do not create per-task commits; the user requested one commit per completed stage.
