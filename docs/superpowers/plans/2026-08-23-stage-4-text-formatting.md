# Stage 4 Text Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Add basic character and paragraph formatting to the headless text editor and expose it through a controlled Vue + UnoCSS toolbar.

**Architecture:** Keep all formatting transactions and state derivation in `@ppt4ai/text`, using the existing `pptText` ProseMirror mark and paragraph attributes as the only source of truth. Extend the editor controller as the bridge for commands and snapshots, then make `TextFormattingToolbar.vue` a stateless semantic control surface that emits typed commands.

**Tech Stack:** TypeScript, ProseMirror state/model, Vitest, Vue 3, Vue Test Utils-free `createApp` tests, UnoCSS utility classes, existing `vue-i18n` locale setup.

## Global Constraints

- Do not add Element Plus or any new runtime dependency.
- `@ppt4ai/text` stays headless and does not depend on Vue, DOM, Canvas, or editor UI code.
- Public command inputs, formatting state, snapshots, and event payloads remain `structuredClone` safe.
- ProseMirror positions remain UTF-16 based; formatting must not change text content or selection direction.
- Existing `TextMarks` and paragraph alignment values are the source of truth; do not add a parallel UI-only formatting model.
- Exclude bullets, numbering, indentation controls, line spacing controls, vertical text, tables, rotated text, theme color resolution, undo integration, and PPTX export.
- Use TDD: each production behavior has a focused failing test observed before implementation.
- Complete the slice with one implementation commit: `feat: add stage 4 text formatting`.

---

### Task 1: Add headless character-formatting transactions

**Files:**
- Create: `packages/text/src/editor/formatting.ts`
- Create: `packages/text/src/editor/formatting.test.ts`
- Modify: `packages/text/src/index.ts`

**Interfaces:**
- Consumes: `EditorState`, `TextMarks`, `Fill`, and the existing `pptText` schema mark.
- Produces:
  ```ts
  export type TextMarksPatch = {
    [K in keyof TextMarks]?: TextMarks[K] | undefined
  }

  export type TextMarkName = 'bold' | 'italic' | 'underline'

  export function setTextMarks(state: EditorState, patch: TextMarksPatch): EditorState
  export function toggleTextMark(state: EditorState, name: TextMarkName): EditorState
  ```

- [ ] **Step 1: Write failing selection-formatting tests**

Add tests that create a body with multiple runs and select only the middle of a run. Assert that `setTextMarks(state, { bold: true })` splits the run at UTF-16 boundaries, changes only the selected characters, preserves unrelated marks such as `fontFamily` and `italic`, and leaves the reverse `{ anchor: 4, head: 1 }` selection direction unchanged. Add a case where setting a property to `undefined` removes it, adjacent equal marks coalesce, and an empty resulting mark set removes the `pptText` mark in the serialized body.

Use real `createTextEditorState`, `setTextEditorSelection`, and `getTextEditorSnapshot`; do not mock ProseMirror transactions.

- [ ] **Step 2: Run the focused tests and verify the expected red failure**

Run: `pnpm --filter @ppt4ai/text test -- src/editor/formatting.test.ts`

Expected: FAIL because `setTextMarks` and the formatting module exports do not exist yet. Fix only test setup errors if the test does not reach the missing API.

- [ ] **Step 3: Write failing collapsed-selection and validation tests**

Append tests that place a cursor inside existing text, call `setTextMarks(state, { bold: true, fontSize: 18 })`, then call `replaceText` and assert only inserted text inherits the stored marks while existing text is unchanged. Add toggle assertions for uniform `true` becoming `false`, uniform `false` becoming `true`, and mixed selection becoming `true`.

Add invalid-input cases for an empty or whitespace-only `fontFamily`, non-finite or non-positive `fontSize`, invalid underline values, and malformed color values. Assert each call throws and the original snapshot remains unchanged.

- [ ] **Step 4: Run the new tests and verify they fail for the missing implementation**

Run: `pnpm --filter @ppt4ai/text test -- src/editor/formatting.test.ts`

Expected: FAIL at the new API calls, not at unrelated existing editor behavior.

- [ ] **Step 5: Implement the minimal character-formatting commands**

In `formatting.ts`, validate the patch before creating a transaction. Validate `fontFamily` as a non-empty trimmed string, `fontSize` as finite and positive, `underline` as `none` or `single`, booleans as booleans, `baseline` as finite when present, and `color` using the existing model validation contract plus a structured clone. Reject unknown patch keys if the runtime object contains them.

For a non-empty selection, iterate text descendants intersecting `state.selection.from` to `state.selection.to`, calculate each intersection, and use one transaction to remove the old `pptText` mark and add a cloned merged mark only to the intersection. Preserve all non-ppt marks, text content, and the transaction selection. Delete properties whose patch value is `undefined`; omit the mark when no properties remain. ProseMirror will split and coalesce adjacent text nodes when the transaction is applied.

For a collapsed selection, merge the patch with `state.storedMarks` when present, otherwise with the marks at the cursor, and call `tr.setStoredMarks`. Do not rewrite existing document text. Implement `toggleTextMark` by reading the current boolean state and applying `true` for `false`/`mixed`, or `false` for uniform `true`; underline toggles between `none` and `single`.

Export the new types and functions from `packages/text/src/index.ts`.

- [ ] **Step 6: Run focused tests and refactor only after green**

Run: `pnpm --filter @ppt4ai/text test -- src/editor/formatting.test.ts src/editor/editor-state.test.ts`

Expected: PASS with no warnings. Refactor duplicated mark extraction or validation helpers only after the tests pass, then rerun the same command.

### Task 2: Add formatting-state queries and paragraph alignment

**Files:**
- Modify: `packages/text/src/editor/formatting.ts`
- Modify: `packages/text/src/editor/formatting.test.ts`
- Modify: `packages/text/src/index.ts`

**Interfaces:**
- Consumes: `EditorState`, current text selection, stored marks, paragraph `align` attributes, and Task 1 mark helpers.
- Produces:
  ```ts
  export type TextToggleState = boolean | 'mixed'

  export interface TextFormattingState {
    readonly bold: TextToggleState
    readonly italic: TextToggleState
    readonly underline: TextToggleState
    readonly fontFamily?: string
    readonly fontSize?: number
    readonly color?: Fill
    readonly align?: 'left' | 'center' | 'right'
  }

  export function setTextAlignment(
    state: EditorState,
    align: 'left' | 'center' | 'right',
  ): EditorState

  export function getTextFormattingState(state: EditorState): TextFormattingState
  ```

- [ ] **Step 1: Write failing formatting-state tests**

Add tests for a collapsed cursor with stored marks, a collapsed cursor without stored marks, a uniform non-empty selection, and a mixed selection. Assert missing `bold`, `italic`, and underline resolve to `false`; differing boolean values resolve to `'mixed'`; differing scalar marks resolve to `undefined`; and a uniform color is returned as a clone that can be structured-cloned without sharing references.

Add tests that verify collapsed state reads stored marks first, then cursor marks using ProseMirror's inclusive behavior. Assert alignment is uniform only when every intersecting paragraph has the same value; otherwise it is `undefined`.

- [ ] **Step 2: Run the focused tests and verify the expected red failure**

Run: `pnpm --filter @ppt4ai/text test -- src/editor/formatting.test.ts`

Expected: FAIL because the query and alignment exports are not implemented.

- [ ] **Step 3: Write failing multi-paragraph alignment tests**

Create three paragraphs with existing unrelated attributes (`level`, `indent`, and `lineSpacing`), select from the first paragraph into the third in both forward and reverse directions, and assert `setTextAlignment` updates every intersecting paragraph, preserves all unrelated attributes, preserves the selection anchor/head, and rejects an invalid alignment before changing state. Include the collapsed-cursor case that updates only its paragraph.

- [ ] **Step 4: Run the alignment tests and verify they fail correctly**

Run: `pnpm --filter @ppt4ai/text test -- src/editor/formatting.test.ts -t alignment`

Expected: FAIL at the missing command or query behavior, with existing model tests still loading.

- [ ] **Step 5: Implement query and alignment behavior**

Implement a helper that collects text mark values over the selected text range, treating an empty paragraph as having no marks. For collapsed selections, use `state.storedMarks` first and otherwise read the marks at `$cursor`/`$from`. Reduce booleans to `true`, `false`, or `'mixed'`; reduce scalar values to a cloned uniform value or `undefined`; map underline `single` to `true` and missing/`none` to `false`.

Collect paragraph nodes whose ranges intersect the selection, with the cursor paragraph included for an empty selection. Use `tr.setNodeMarkup` for each paragraph, copying all existing attributes and replacing only `align`. Keep the original selection and return the unchanged state when the requested value is already applied everywhere. Validate alignment before building the transaction.

- [ ] **Step 6: Run text-package regression verification**

Run: `pnpm --filter @ppt4ai/text test`

Expected: PASS for all text package tests, including model conversion, IME, selection, formatting, and alignment cases.

### Task 3: Bridge formatting through the controller and text-box host

**Files:**
- Modify: `packages/editor/src/text-editor-controller.ts`
- Modify: `packages/editor/src/text-editor-controller.test.ts`
- Modify: `packages/editor/src/TextBoxEditor.vue`
- Modify: `packages/editor/src/TextBoxEditor.test.ts`
- Modify: `packages/editor/src/index.ts`
- Modify: `packages/editor/src/text-box-editor.ts`

**Interfaces:**
- Consumes: Task 1/2 exports from `@ppt4ai/text`.
- Produces:
  ```ts
  export interface TextEditorController {
    getFormattingState(): TextFormattingState
    setMarks(patch: TextMarksPatch): void
    toggleMark(name: TextMarkName): void
    setAlignment(align: 'left' | 'center' | 'right'): void
  }
  ```
  and a `TextBoxEditor` emit `(event: 'update:formatting', state: TextFormattingState)`.

- [ ] **Step 1: Write failing controller publication tests**

Extend the controller harness to start with a body containing marked text. Assert each successful `setMarks`, `toggleMark`, and `setAlignment` call publishes exactly one cloned snapshot, updates `getSnapshot()` and `getFormattingState()`, and does not publish when the command produces no state change. After `destroy`, assert all commands are inert and `getFormattingState()` remains readable without notifying listeners.

- [ ] **Step 2: Run the focused controller tests and verify red**

Run: `pnpm --filter @ppt4ai/editor test -- src/text-editor-controller.test.ts`

Expected: FAIL because the controller methods and formatting-state event do not exist.

- [ ] **Step 3: Implement controller commands and one-publication semantics**

Import the headless commands and state query. Add a private `applyFormatting` path that ignores destroyed controllers, applies one command, compares the resulting editor state by identity, assigns it, and calls the existing cloned `publish()` exactly once. Expose the four methods in the interface; `getFormattingState()` reads the current state directly and returns a structured clone. Preserve existing IME, selection, caret, bridge, and destroy behavior.

- [ ] **Step 4: Write failing host formatting-event tests**

Mount `TextBoxEditor` with the existing bridge factory, listen for `update:formatting`, dispatch a formatting command through the harness, and assert the event contains the current JSON-safe state alongside the body/selection events. Assert the host still renders no DOM text mirror and does not emit formatting while inactive.

- [ ] **Step 5: Run host tests and verify the expected red failure**

Run: `pnpm --filter @ppt4ai/editor test -- src/TextBoxEditor.test.ts -t formatting`

Expected: FAIL because the formatting emit and controller subscription path are not wired.

- [ ] **Step 6: Implement host formatting synchronization and exports**

Add the typed `update:formatting` emit to `TextBoxEditor.vue`. In the existing snapshot subscription, emit cloned body, selection, and `getFormattingState()` updates only for active controller snapshots. Add the formatting types to `text-box-editor.ts` and export them from `packages/editor/src/index.ts`; do not add formatting state to the DOM or duplicate it in Vue refs.

- [ ] **Step 7: Run editor regression tests**

Run: `pnpm --filter @ppt4ai/editor test -- src/text-editor-controller.test.ts src/TextBoxEditor.test.ts`

Expected: PASS, including lifecycle, IME preview, selection overlay, resize, controller, and new formatting cases.

### Task 4: Add the controlled UnoCSS formatting toolbar

**Files:**
- Create: `packages/editor/src/TextFormattingToolbar.vue`
- Create: `packages/editor/src/TextFormattingToolbar.test.ts`
- Modify: `packages/editor/src/locales/zh-CN.ts`
- Modify: `packages/editor/src/locales/en-US.ts`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- Consumes:
  ```ts
  interface TextFormattingToolbarProps {
    readonly active: boolean
    readonly state: TextFormattingState
    readonly fontFamilies: readonly string[]
    readonly fontSizes: readonly number[]
  }
  ```
- Produces typed events:
  ```ts
  (event: 'set-marks', patch: TextMarksPatch): void
  (event: 'toggle-mark', name: TextMarkName): void
  (event: 'set-alignment', align: 'left' | 'center' | 'right'): void
  ```

- [ ] **Step 1: Write failing toolbar rendering and interaction tests**

Using Vue `createApp` and `h`, mount the toolbar with active uniform, mixed, and inactive states. Assert semantic `button`, `select`, and `input[type=color]` controls exist, controls have UnoCSS utility classes, active toggles expose `aria-pressed="true"`, mixed toggles expose `aria-pressed="mixed"`, and inactive controls are disabled. Assert the component has no text mirror or ProseMirror import.

Dispatch click/change events and assert exact typed emits: bold/italic/underline toggle names, left/center/right alignment, `{ fontFamily }`, `{ fontSize }`, and an sRGB `{ color: { color: { type: 'srgb', v } } }` patch from the color input. Assert a mixed select renders an empty option value.

- [ ] **Step 2: Run the focused toolbar tests and verify red**

Run: `pnpm --filter @ppt4ai/editor test -- src/TextFormattingToolbar.test.ts`

Expected: FAIL because the component and locale labels do not exist.

- [ ] **Step 3: Implement the presentational toolbar**

Create `TextFormattingToolbar.vue` with `script setup` typed props/emits. Use native `button` elements for bold, italic, underline, and alignment, native `select` elements for font family and font size, and a native color input. Apply concise UnoCSS classes, use locale keys for accessible labels/tooltips, set `aria-pressed="mixed"` for mixed booleans, render an empty select value for mixed scalar state, and disable every control when `active` is false. The component emits commands only; it never imports ProseMirror, accesses the DOM outside event handling, or mutates `TextBody`.

Add matching `toolbar.textFormatting.*` labels in `zh-CN.ts` and `en-US.ts`, preserving the existing locale object shape and inferred `EditorLocale` types. Export the component and its prop/event types from `packages/editor/src/index.ts`.

- [ ] **Step 4: Run toolbar tests and typecheck the editor package**

Run: `pnpm --filter @ppt4ai/editor test -- src/TextFormattingToolbar.test.ts`

Expected: PASS with no warnings. Then run `pnpm --filter @ppt4ai/editor typecheck` and fix only formatting-slice type errors.

### Task 5: Validate, update progress, and commit the slice

**Files:**
- Modify: `进度.md`
- Modify: `docs/superpowers/specs/2026-08-23-stage-4-text-formatting-design.md` only if the self-review finds an actual contract correction

- [ ] **Step 1: Run the complete required verification**

Run:
```text
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands pass. If a command fails, reproduce it with the narrowest package/test command, fix only this slice, and rerun the complete sequence.

- [ ] **Step 2: Update the stage handoff**

In `进度.md`, mark basic text formatting complete, record the exact validation commands, note that Element Plus remains absent and the toolbar uses Vue + UnoCSS, and identify the next stage-4 slice without inventing work outside the accepted scope.

- [ ] **Step 3: Review the final diff and check public contracts**

Run `git status --short` and `git diff --stat`; inspect all changed files for accidental dependencies, non-JSON-safe event payloads, duplicate state ownership, missing exports, and unrelated edits. Confirm `rg -n "element-plus|ElementPlus" packages docs` returns no new match.

- [ ] **Step 4: Create the single implementation commit**

Run:
```text
git add docs/superpowers/specs/2026-08-23-stage-4-text-formatting-design.md docs/superpowers/plans/2026-08-23-stage-4-text-formatting.md packages/text/src/editor/formatting.ts packages/text/src/editor/formatting.test.ts packages/text/src/index.ts packages/editor/src/text-editor-controller.ts packages/editor/src/text-editor-controller.test.ts packages/editor/src/TextBoxEditor.vue packages/editor/src/TextBoxEditor.test.ts packages/editor/src/text-box-editor.ts packages/editor/src/TextFormattingToolbar.vue packages/editor/src/TextFormattingToolbar.test.ts packages/editor/src/locales/zh-CN.ts packages/editor/src/locales/en-US.ts packages/editor/src/index.ts 进度.md
git commit -m "feat: add stage 4 text formatting"
```

- [ ] **Step 5: Verify the committed worktree**

Run: `git status --short; git log -1 --oneline`

Expected: a clean worktree and one new commit whose subject is `feat: add stage 4 text formatting`.

---

## Self-review

- Spec coverage: character patching and toggles are Task 1; alignment and mixed/uniform queries are Task 2; controller and host publication are Task 3; controlled Vue + UnoCSS controls and locale labels are Task 4; acceptance validation and progress handoff are Task 5.
- Placeholder scan: every implementation step names concrete files, signatures, commands, expected outcomes, and exact behavior; no `TODO`, `TBD`, or unspecified edge-case instruction remains.
- Type consistency: `TextMarksPatch`, `TextMarkName`, `TextToggleState`, and `TextFormattingState` originate in `@ppt4ai/text`; controller and toolbar consume those exact exported types; host emits the same `TextFormattingState` contract.
- Scope check: no Element Plus, new runtime dependency, undo integration, PPTX export, or excluded paragraph feature is introduced.
