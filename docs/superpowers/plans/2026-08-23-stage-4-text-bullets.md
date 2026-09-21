# Stage 4 Text Bullets and Numbering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add semantic paragraph bullets and Arabic/alphabetic numbering to the headless text model, editor, layout engine, and common PPTX import paths without inserting marker text into editable runs.

**Architecture:** Store a validated `TextBullet` on paragraph attributes. Keep ProseMirror positions and text content unchanged while mapping the attribute into paragraph nodes and applying selection-aware bullet commands. Resolve numbering state during layout, expose a clone-safe marker on the first visual line, and parse common DrawingML paragraph properties into the same model contract.

**Tech Stack:** TypeScript, Vitest, ProseMirror, `@ppt4ai/model`, `@ppt4ai/text`, `@ppt4ai/pptx-import`, pnpm workspace.

## Global Constraints

- Do not add Element Plus or any new runtime dependency.
- `@ppt4ai/text` remains headless and does not depend on Vue, DOM, Canvas, or editor UI code.
- Public model values, commands, layout output, snapshots, and event payloads remain safe for `structuredClone`.
- Marker glyphs are not inserted into `TextRun.text`; UTF-16 text positions and IME behavior remain unchanged.
- Existing `level`, `indent`, and `marginLeft` values continue to control paragraph hierarchy and content position.
- Exclude vertical text, tables, custom numbering formats, Roman numerals, arbitrary numbering templates, cross-gap list IDs, Tab shortcuts, theme-font resolution, and PPTX export XML.
- Write failing tests before production code for each behavior change.
- Complete `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check` before the implementation commit.
- Update `进度.md` and create one implementation commit for the completed slice.

---

### Task 1: Add the model bullet contract and validation

**Files:**
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/src/model.test.ts`

**Interfaces:**
- Produces `TextBullet` and `TextBulletScheme` exports and `TextParagraphAttrs.bullet?: TextBullet`.
- Produces validator acceptance for `{ type: 'char', char, fontFamily? }` and `{ type: 'autoNum', scheme, startAt? }`.

- [ ] **Step 1: Write failing model tests**

Add tests that construct bodies with a one-code-point character bullet, a bullet font, Arabic numbering, lower/upper alphabetic numbering, and a positive integer `startAt`. Assert `validateTextBody` returns `{ valid: true }` and `structuredClone(body)` equals the original. Add invalid cases and assert deterministic paths for empty/multi-code-point `char`, empty `fontFamily`, unknown type/scheme, non-integer/zero `startAt`, and negative/non-integer `level`.

- [ ] **Step 2: Run model tests to verify red**

Run: `pnpm --filter @ppt4ai/model test -- src/model.test.ts`

Expected: FAIL because `bullet` is not yet part of the type/validator contract.

- [ ] **Step 3: Implement the minimal model contract**

Add:

```ts
export type TextBulletScheme = 'arabic' | 'alphaLower' | 'alphaUpper'
export type TextBullet =
  | { type: 'char'; char: string; fontFamily?: string }
  | { type: 'autoNum'; scheme: TextBulletScheme; startAt?: number }
```

Add `bullet?: TextBullet` to `TextParagraphAttrs`. Extend paragraph validation with object/type/scheme checks, `Array.from(char).length === 1`, non-empty font checks, finite positive integer `startAt`, and non-negative integer `level`. Preserve existing error ordering and path style.

- [ ] **Step 4: Run model tests to verify green**

Run: `pnpm --filter @ppt4ai/model test -- src/model.test.ts`

Expected: PASS with the new valid and invalid cases.

- [ ] **Step 5: Commit the model contract**

Run:
```text
git add packages/model/src/index.ts packages/model/src/model.test.ts
git commit -m "feat: add text bullet model contract"
```

### Task 2: Map bullets into ProseMirror and add selection-aware commands

**Files:**
- Modify: `packages/text/src/editor/schema.ts`
- Modify: `packages/text/src/editor/model.ts`
- Modify: `packages/text/src/editor/editor-state.ts`
- Modify: `packages/text/src/editor/formatting.ts` only if a shared paragraph-target helper is needed
- Modify: `packages/text/src/index.ts`
- Test: `packages/text/src/editor/editor-model.test.ts`
- Test: `packages/text/src/editor/editor-state.test.ts`

**Interfaces:**
- Consumes `TextBullet` from `@ppt4ai/model`.
- Produces `setTextBullet(state: EditorState, bullet: TextBullet): EditorState` and `clearTextBullet(state: EditorState): EditorState`.
- Produces `bullet` on ProseMirror paragraph attrs and restores it through `proseMirrorToTextBody`.

- [ ] **Step 1: Write failing conversion and command tests**

Add a round-trip body with bullet plus `level`, `indent`, and alignment; assert the returned body is equal and the ProseMirror document contains no marker prefix. Add command tests for a non-empty selection covering multiple paragraphs, a collapsed cursor, reverse selection direction, clear, preserving unrelated attrs, invalid bullet inputs, and no state mutation on failed validation.

- [ ] **Step 2: Run focused text tests to verify red**

Run: `pnpm --filter @ppt4ai/text test -- src/editor/editor-model.test.ts src/editor/editor-state.test.ts`

Expected: FAIL because the schema, mapping, exports, and commands do not exist.

- [ ] **Step 3: Add the schema and model mapping**

Add `bullet: { default: null }` to the paragraph node. Include `bullet` in the ordered paragraph attribute list, deep-clone it on body-to-document conversion, and restore it only when non-null on document-to-body conversion. Keep marker data outside text nodes and run marks.

- [ ] **Step 4: Implement selection-aware bullet commands**

Implement `setTextBullet` and `clearTextBullet` with `state.doc.descendants`. Target paragraphs intersecting the selection, including the cursor paragraph, use `transaction.setNodeMarkup(position, undefined, { ...node.attrs, bullet })`, and preserve all other attrs. Validate the bullet through `validateTextBody` using a minimal body or a shared bullet validator before creating a transaction. Return the original state for inert clear/set operations and preserve anchor/head direction.

- [ ] **Step 5: Export and run focused tests**

Export both commands from `packages/text/src/index.ts`. Run:
```text
pnpm --filter @ppt4ai/text test -- src/editor/editor-model.test.ts src/editor/editor-state.test.ts
pnpm --filter @ppt4ai/text typecheck
```
Expected: PASS with no new type errors.

- [ ] **Step 6: Commit the editor bullet behavior**

Run:
```text
git add packages/text/src/editor/schema.ts packages/text/src/editor/model.ts packages/text/src/editor/editor-state.ts packages/text/src/index.ts packages/text/src/editor/editor-model.test.ts packages/text/src/editor/editor-state.test.ts
git commit -m "feat: add text bullet editing semantics"
```

### Task 3: Add deterministic numbering utilities and layout markers

**Files:**
- Modify: `packages/text/src/layout.ts`
- Modify: `packages/text/src/index.ts`
- Test: `packages/text/src/text-layout.test.ts`

**Interfaces:**
- Produces `TextLayoutMarker { text: string; x: number; width: number; marks?: TextMarks }`.
- Produces `TextLayoutLine.marker?: TextLayoutMarker` on the first visual line of a bulleted paragraph.
- Consumes `TextParagraphAttrs.bullet`, `level`, `indent`, and `marginLeft` without changing source text positions.

- [ ] **Step 1: Write failing layout tests**

Add tests for a character marker, Arabic continuation and reset, lower/upper alphabetic values including `z -> aa`, independent nested levels, explicit `startAt`, a marker-only empty paragraph, and a wrapped paragraph. Assert marker text/width, first-line-only marker presence, continuation-line x equality, and that run text remains unchanged. Add left/center/right and `none`/`shrink`/`resize` autofit assertions that marker geometry scales or participates in overflow.

- [ ] **Step 2: Run layout tests to verify red**

Run: `pnpm --filter @ppt4ai/text test -- src/text-layout.test.ts`

Expected: FAIL because layout lines have no marker and numbering is not resolved.

- [ ] **Step 3: Implement pure numbering and marker helpers**

Keep helpers local to `layout.ts` unless tests require a public utility. Track previous numbered paragraph state by level and scheme while scanning paragraphs. Reset on non-numbered paragraphs, level/scheme changes, or character bullets; honor explicit `startAt`; default to 1. Render Arabic decimal and spreadsheet-style alpha sequences. Build marker marks from the bullet font or first run marks, using the current font scale and a trailing separator.

- [ ] **Step 4: Integrate marker width with wrapping and alignment**

Extend pending lines with an optional first-line marker and a content base. Measure marker using `measureText`, reduce available paragraph width by marker width on the first line, keep the same body x for all wrapped lines, and apply paragraph alignment to the body box. Position marker in the hanging area and expose it only on the first visual line. Include marker extents in content bounds and overflow while leaving token text untouched.

- [ ] **Step 5: Run layout tests and typecheck**

Run:
```text
pnpm --filter @ppt4ai/text test -- src/text-layout.test.ts
pnpm --filter @ppt4ai/text typecheck
```
Expected: PASS, including empty marker-only paragraphs and autofit behavior.

- [ ] **Step 6: Commit the layout slice**

Run:
```text
git add packages/text/src/layout.ts packages/text/src/index.ts packages/text/src/text-layout.test.ts
git commit -m "feat: render text bullet markers"
```

### Task 4: Parse structured PPTX bullets and numbering

**Files:**
- Modify: `packages/pptx-import/src/importer.ts`
- Modify: `packages/pptx-import/src/index.ts` only if new public parser types are exported
- Test: `packages/pptx-import/src/importer.test.ts`

**Interfaces:**
- Consumes parsed `XmlNode` paragraph children and produces structured `TextBody` paragraphs with `attrs.bullet`.
- Maps `buChar` to `TextBullet` char and common `buAutoNum` schemes to `arabic`, `alphaLower`, or `alphaUpper`.

- [ ] **Step 1: Write failing importer fixtures and assertions**

Add a minimal PPTX fixture whose `txBody` contains `a:pPr` with `buChar`, a second paragraph with `buAutoNum type="arabicPeriod" startAt="3"`, and a third with an upper alphabetic scheme. Assert imported text remains only run text, bullets are structured attrs, `startAt` is preserved, and unsupported schemes fall back to Arabic without throwing.

- [ ] **Step 2: Run importer tests to verify red**

Run: `pnpm --filter @ppt4ai/pptx-import test -- src/importer.test.ts`

Expected: FAIL because the importer currently flattens all `txBody` text into legacy `TextElement.text`.

- [ ] **Step 3: Implement structured text-body parsing**

Parse each `a:p`, `a:r`, `a:t`, and paragraph property node into a `TextBody` while preserving the existing legacy text fallback when no structured body is needed. Read `buChar` character and nested `rPr` typeface, map supported auto-number names, parse positive `startAt`, and omit malformed marker values. Keep all values JSON-safe and preserve existing shape fills/bounds/placeholders.

- [ ] **Step 4: Run importer tests and package typecheck**

Run:
```text
pnpm --filter @ppt4ai/pptx-import test -- src/importer.test.ts
pnpm --filter @ppt4ai/pptx-import typecheck
```
Expected: PASS with no regression in shared layout/master relationship tests.

- [ ] **Step 5: Commit the import slice**

Run:
```text
git add packages/pptx-import/src/importer.ts packages/pptx-import/src/index.ts packages/pptx-import/src/importer.test.ts
git commit -m "feat: import pptx text bullets"
```

### Task 5: Validate the integrated slice, update progress, and commit

**Files:**
- Modify: `进度.md`
- Modify: `docs/superpowers/specs/2026-08-23-stage-4-text-bullets-design.md` only if verification finds a real contract error

- [ ] **Step 1: Run all required verification commands**

Run:
```text
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
```
Expected: all commands pass. Reproduce failures with the narrowest package/test command and fix only this slice.

- [ ] **Step 2: Update the stage handoff**

Mark the project-bullet/numbering slice complete in `进度.md`, record the exact validation result, keep Element Plus absent, and identify vertical text as the next Stage 4 text slice. Do not mark tables or PPTX export complete.

- [ ] **Step 3: Review the final diff and public boundaries**

Run `git status --short`, `git diff --stat`, and `rg -n "element-plus|ElementPlus" packages docs`. Inspect changed exports and assert all public bullet/layout/import values remain `structuredClone` safe with no DOM/Vue dependency in `@ppt4ai/text`.

- [ ] **Step 4: Commit the completed implementation slice**

Run:
```text
git add packages/model/src/index.ts packages/model/src/model.test.ts packages/text/src/editor/schema.ts packages/text/src/editor/model.ts packages/text/src/editor/editor-state.ts packages/text/src/editor/editor-state.test.ts packages/text/src/editor/editor-model.test.ts packages/text/src/layout.ts packages/text/src/text-layout.test.ts packages/text/src/index.ts packages/pptx-import/src/importer.ts packages/pptx-import/src/importer.test.ts packages/pptx-import/src/index.ts 进度.md
git commit -m "feat: add stage 4 text bullets and numbering"
```

- [ ] **Step 5: Verify the committed worktree**

Run: `git status --short; git log -1 --oneline`

Expected: clean worktree and a new implementation commit with subject `feat: add stage 4 text bullets and numbering`.

## Self-review

- Scope check: this plan covers one semantic feature across the already established model, editor, layout, and import boundaries; vertical text, tables, and export remain excluded.
- File ownership: model validation, editor conversion/commands, layout marker geometry, importer parsing, and progress handoff have disjoint primary responsibilities.
- TDD check: every behavior task starts with explicit failing tests and a focused red run before production edits.
- Contract check: marker glyphs never enter `TextRun.text`; `TextBullet`, paragraph attrs, ProseMirror attrs, layout markers, and imported document values are JSON-safe.
- Placeholder scan: no unfinished marker, vague edge-case instruction, or unspecified test command remains.
