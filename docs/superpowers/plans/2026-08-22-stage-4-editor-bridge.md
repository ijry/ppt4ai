# Stage 4 ProseMirror and IME Editor Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a headless ProseMirror text editor adapter and a browser-side IME controller while preserving `TextBody` text, paragraph attributes, run marks, and `bodyPr`.

**Architecture:** `@ppt4ai/text` owns the ProseMirror schema, JSON-safe `TextBody` conversion, editor state plugin, selection, transactions, and composition lifecycle. `@ppt4ai/editor` owns a small DOM controller that connects the existing hidden `contenteditable` bridge to the headless editor state; it does not render text or implement pointer mapping in this slice.

**Tech Stack:** TypeScript 6, Vitest 4, pnpm workspaces, `prosemirror-model` 1.25.11, `prosemirror-state` 1.4.4, `prosemirror-commands` 1.7.2, existing Vue 3 + UnoCSS editor package, and the existing `@ppt4ai/text` IME bridge.

## Global Constraints

- `@ppt4ai/text` remains headless and cannot import Vue, access DOM globals, use Canvas, use `prosemirror-view`, or call browser APIs.
- `@ppt4ai/model` remains the canonical JSON-safe contract and must not depend on ProseMirror.
- Validate and deep-clone every public `TextBody`, ProseMirror JSON, and snapshot boundary; outputs must pass `structuredClone`.
- Preserve every `bodyPr`, `TextParagraph.attrs`, and `TextRun.marks` value; adjacent equivalent marks may be coalesced into one run.
- The schema contains only `doc`, `paragraph`, and `text` nodes plus the `pptText` mark; no custom node views or browser-specific schema values.
- Composition updates never write provisional text to the document; `composition-end` commits once and suppresses the immediately duplicated matching `text-input` event.
- Enter creates a paragraph split, not a literal newline inside a text node; Backspace follows ProseMirror selection semantics.
- Keep the existing `createImeInputBridge`, `ImeBridgeEvent`, and Stage 0 IME behavior compatible.
- Do not add formatting toolbar commands, caret painting, pointer mapping, bullets, vertical text, tables, shaping, or PPTX export in this slice.
- Do not create task-level commits; update the plan and progress record, then create one implementation commit for this slice.

---

### Task 1: Add ProseMirror Schema and TextBody Conversion

**Files:**
- Modify: `packages/text/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/text/src/editor/schema.ts`
- Create: `packages/text/src/editor/model.ts`
- Create: `packages/text/src/editor/editor-model.test.ts`
- Modify: `packages/text/src/index.ts`

**Interfaces:**
- Consumes: `TextBody`, `TextBodyProperties`, `TextParagraphAttrs`, `TextRun`, and `TextMarks` from `@ppt4ai/model`; existing `validateTextBody` and `normalizeTextElement` conventions.
- Produces: `textEditorSchema`, `textBodyToProseMirror(body: TextBody): PMNode`, `proseMirrorToTextBody(document: PMNode): TextBody`, and `TextEditorModelError`.

- [x] **Step 1: Add the pinned ProseMirror dependencies and failing conversion tests**

Add these exact runtime dependencies to `packages/text/package.json`:

```json
{
  "prosemirror-commands": "1.7.2",
  "prosemirror-model": "1.25.11",
  "prosemirror-state": "1.4.4"
}
```

Create `editor-model.test.ts` with a fixture containing `bodyPr`, two paragraphs, paragraph attrs, two differently marked runs, an unmarked run, and one empty paragraph. Assert that `textBodyToProseMirror(fixture).toJSON()` contains `doc > paragraph > text` nodes and a `pptText` mark whose `attrs.marks` equals the source marks. Assert that converting the result back equals the fixture and that mutating either returned value does not mutate the fixture.

Add failing tests for adjacent text nodes with deeply equal `pptText` marks coalescing into one `TextRun`, malformed body errors containing `TextEditorModelError`, and malformed ProseMirror JSON errors containing a stable path or reason.

- [x] **Step 2: Run the conversion tests and verify the expected RED state**

Run:

```bash
pnpm exec vitest run packages/text/src/editor/editor-model.test.ts
```

Expected result: FAIL because the editor schema and conversion exports do not exist yet. Fix only test setup or import typos if the command errors before reaching the missing implementation.

- [x] **Step 3: Implement the schema with JSON-safe attrs**

Create `packages/text/src/editor/schema.ts` with a `Schema` containing:

```ts
doc: { content: 'paragraph+', attrs: { bodyPr: { default: null } } }
paragraph: {
  content: 'inline*',
  group: 'block',
  attrs: {
    align: { default: null }, level: { default: null }, indent: { default: null },
    marginLeft: { default: null }, lineSpacing: { default: null },
    spaceBefore: { default: null }, spaceAfter: { default: null },
  },
}
text: { group: 'inline' }
pptText: { attrs: { marks: { default: null } } }
```

Use `null` only as ProseMirror's internal representation for an omitted optional field. Do not put `undefined`, functions, or model instances into node or mark attrs. Export the schema and small helpers that strip null attrs back to optional model objects.

- [x] **Step 4: Implement validated, cloned conversion functions**

In `model.ts`, implement:

```ts
export class TextEditorModelError extends Error {
  readonly path?: string
  readonly errors: readonly string[]
}

export function textBodyToProseMirror(body: TextBody): PMNode
export function proseMirrorToTextBody(document: PMNode): TextBody
```

`textBodyToProseMirror` must call `validateTextBody`, clone the accepted body, map every run to a native text node, and attach one `pptText` mark when `run.marks` is defined. `proseMirrorToTextBody` must accept only the declared schema nodes/mark, restore optional attrs, group adjacent text nodes with deeply equal marks, validate the result, and return a fresh clone. Wrap ProseMirror parsing/creation failures in `TextEditorModelError` without leaking mutable ProseMirror objects.

- [x] **Step 5: Export the conversion API and run focused GREEN checks**

Export the schema, conversion functions, error class, and relevant ProseMirror types from `packages/text/src/index.ts`. Run:

```bash
pnpm exec vitest run packages/text/src/editor/editor-model.test.ts
pnpm --filter @ppt4ai/text typecheck
```

Expected result: all conversion tests pass, including empty paragraphs, marks, attrs, deep cloning, validation errors, and structured-clone safety.

---

### Task 2: Add ProseMirror Editor State and Editing Transactions

**Files:**
- Create: `packages/text/src/editor/editor-state.ts`
- Create: `packages/text/src/editor/editor-state.test.ts`
- Modify: `packages/text/src/index.ts`

**Interfaces:**
- Consumes: `textEditorSchema`, `textBodyToProseMirror`, `proseMirrorToTextBody`, and `ImeBridgeEvent`.
- Produces: `createTextEditorState`, `replaceText`, `insertParagraph`, `deleteBackward`, `applyImeEvent`, `getTextEditorSnapshot`, `TextEditorSnapshot`, and `TextEditorSelection`.

- [x] **Step 1: Write failing transaction and composition tests**

Create tests for these exact behaviors:

```ts
const state = createTextEditorState(body)
const replaced = replaceText(state, '新文本')
expect(getTextEditorSnapshot(replaced).body.paragraphs[0]?.runs[0]?.text).toBe('新文本')

const split = insertParagraph(state)
expect(split.doc.childCount).toBe(2)

const deleted = deleteBackward(replaced)
expect(getTextEditorSnapshot(deleted).selection.anchor).toBeLessThan(
  getTextEditorSnapshot(replaced).selection.anchor,
)
```

Add tests that `composition-start` and `composition-update` change only snapshot metadata, `composition-end` commits final text once, the following identical `text-input` is ignored, a different `text-input` is accepted, and an out-of-order `composition-end` commits deterministically. Assert Enter creates paragraphs and never inserts a `\n` character into a text node. Assert every snapshot body and selection object passes `structuredClone`.

- [x] **Step 2: Run the state tests and verify the expected RED state**

Run:

```bash
pnpm exec vitest run packages/text/src/editor/editor-state.test.ts
```

Expected result: FAIL because editor state creation, transaction helpers, and the composition plugin are not implemented.

- [x] **Step 3: Implement composition plugin state**

In `editor-state.ts`, define a private `PluginKey` whose state is:

```ts
interface CompositionState {
  composing: boolean
  compositionText: string
  suppressedTextInput?: string
}
```

Initialize it to `{ composing: false, compositionText: '' }`. Handle transaction metadata for `composition-start`, `composition-update`, `composition-end`, and `clear-suppressed-text-input`. Keep document and selection unchanged for metadata-only transactions.

- [x] **Step 4: Implement editor state creation and pure transaction helpers**

Implement:

```ts
export interface TextEditorSelection { readonly anchor: number; readonly head: number }
export interface TextEditorSnapshot {
  readonly body: TextBody
  readonly selection: TextEditorSelection
  readonly composing: boolean
  readonly compositionText: string
}
export function createTextEditorState(body: TextBody): EditorState
export function replaceText(state: EditorState, text: string): EditorState
export function insertParagraph(state: EditorState): EditorState
export function deleteBackward(state: EditorState): EditorState
export function applyImeEvent(state: EditorState, event: ImeBridgeEvent): EditorState
export function getTextEditorSnapshot(state: EditorState): TextEditorSnapshot
```

Use `state.tr.insertText(text)` for replacement, `splitBlock` from `prosemirror-commands` for Enter, and `deleteSelection` plus `delete`/`deleteCharBefore` semantics for Backspace. Each helper returns `state.apply(transaction)` and does not mutate the input state. `applyImeEvent` maps text input, line break, and backward deletion to those helpers; composition start/update/end use the plugin metadata, with end inserting its final text and setting `suppressedTextInput` in the same resulting state.

- [x] **Step 5: Implement cloned snapshots and run focused GREEN checks**

`getTextEditorSnapshot` must convert the current document through `proseMirrorToTextBody`, read `state.selection.anchor/head`, read plugin composition state, and return fresh JSON-safe values. Run:

```bash
pnpm exec vitest run packages/text/src/editor/editor-state.test.ts
pnpm exec vitest run packages/text/src/editor/editor-model.test.ts packages/text/src/editor/editor-state.test.ts
pnpm --filter @ppt4ai/text typecheck
```

Expected result: all model, transaction, selection, composition, duplicate-suppression, and clone-safety tests pass.

---

### Task 3: Connect the Existing IME Bridge in the Editor Package

**Files:**
- Create: `packages/editor/src/text-editor-controller.ts`
- Create: `packages/editor/src/text-editor-controller.test.ts`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**
- Consumes: `TextBody`, `ImeBridgeEvent`, `ImeInputBridge`, `ImeInputBridgeOptions`, `createImeInputBridge`, `applyImeEvent`, `createTextEditorState`, and `getTextEditorSnapshot`.
- Produces: `createTextEditorController(options: TextEditorControllerOptions): TextEditorController` and exported controller/snapshot types.

- [x] **Step 1: Write failing controller tests with a real host and bridge spy**

Create a `happy-dom` host element and a fake bridge factory that records `focus`, `destroy`, and the callback supplied in `ImeInputBridgeOptions`. Assert that the controller snapshot starts from a cloned body, dispatching `{ type: 'text-input', text: 'A' }` updates body text, bridge callback events follow the same path, `focus()` delegates, and `destroy()` delegates exactly once.

Add a composition test proving update text appears in `snapshot.compositionText` but not in `snapshot.body`, then end commits once and a duplicate bridge `text-input` does not add a second copy. Add a test that events after destroy are ignored.

- [x] **Step 2: Run controller tests and verify the expected RED state**

Run:

```bash
pnpm exec vitest run packages/editor/src/text-editor-controller.test.ts
```

Expected result: FAIL because the controller module and exported factory do not exist.

- [x] **Step 3: Implement the controller without duplicating document state**

Define:

```ts
export interface TextEditorControllerOptions {
  readonly host: HTMLElement
  readonly body: TextBody
  readonly bridgeFactory?: (options: ImeInputBridgeOptions) => ImeInputBridge
}

export interface TextEditorController {
  getSnapshot(): TextEditorSnapshot
  focus(): void
  dispatch(event: ImeBridgeEvent): void
  destroy(): void
}
```

Create one `EditorState`, pass a callback to `createImeInputBridge`, update that state only through `applyImeEvent`, and expose cloned snapshots through `getTextEditorSnapshot`. Guard callbacks and public methods after destruction. Do not import Vue or add a `prosemirror-view` dependency.

- [x] **Step 4: Export the controller and run editor GREEN checks**

Export the factory and types from `packages/editor/src/index.ts`. Run:

```bash
pnpm exec vitest run packages/editor/src/text-editor-controller.test.ts
pnpm --filter @ppt4ai/editor typecheck
```

Expected result: controller tests pass and the existing Vue editor shell still typechecks.

---

### Task 4: Complete Slice Verification and Single Commit

**Files:**
- Modify: `docs/superpowers/plans/2026-08-22-stage-4-editor-bridge.md`
- Modify: `进度.md`

**Interfaces:**
- Consumes: all schema, conversion, editor-state, controller, dependency, and test changes from Tasks 1-3.
- Produces: a checked plan, progress handoff, full verification gate, and one implementation commit for the editor bridge slice.

- [x] **Step 1: Run the complete verification gate**

Run in order:

```bash
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
```

Expected result: all existing Stage 0 IME, Stage 1-4, engine, import, render, and new editor bridge tests pass. `check:boundaries` must confirm no Vue/DOM globals entered `@ppt4ai/text`.

- [x] **Step 2: Update the plan and progress handoff**

Change every completed checkbox in this plan to `[x]`. Update `进度.md` to record the second Stage 4 slice: ProseMirror schema/conversion, transaction helpers, composition duplicate suppression, and editor controller. Keep Stage 4 marked `🚧 进行中`; explicitly list visual caret/selection mapping, formatting commands, and PPTX export as later work. Record the final test count from the verification run.

- [x] **Step 3: Run final diff checks**

Run:

```bash
git diff --check
git status --short
```

Confirm only the planned model, text, editor, lockfile, plan, and progress files are present.

- [x] **Step 4: Create the only implementation commit for this slice**

Run:

```bash
git add packages/text packages/editor docs/superpowers/plans/2026-08-22-stage-4-editor-bridge.md 进度.md pnpm-lock.yaml
git commit -m "feat: add stage 4 ProseMirror editor bridge"
git status --short
git log -1 --oneline
```

The commit must leave the worktree clean. Do not create task-level commits; this is the single commit for the completed implementation slice.
