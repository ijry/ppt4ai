# Stage 4 Text Editor Host Implementation Plan

For agentic workers: use executing-plans to implement this plan task by task. Steps use checkbox syntax for tracking.

Goal: Combine text-box pointer interaction, ProseMirror selection, IME provisional layout, and existing overlays into a reusable Vue text editor host.

Architecture: The editor controller owns editor state and exposes selection transactions and subscriptions. TextBoxEditor.vue owns lifecycle, pointer hit testing, layout, and overlay props. The text package remains headless; composition preview uses a temporary JSON-safe TextBody.

Tech Stack: TypeScript, ProseMirror state/model, Vue 3, UnoCSS, Vitest, and happy-dom.

## Global Constraints

- Do not add Element Plus; UI uses Vue and UnoCSS only.
- The text, model, and render packages stay headless.
- Public output must be structuredClone safe and must not expose ProseMirror objects or DOMRect.
- PM positions use UTF-16 offsets; Enter remains paragraph splitting.
- Composition provisional text never enters the body; each stage produces one implementation commit.

---

### Task 1: Extend controller selection transactions

Files:
- Modify: packages/editor/src/text-editor-controller.ts
- Test: packages/editor/src/text-editor-controller.test.ts
- Modify: packages/editor/src/index.ts

Interfaces:
- TextEditorController.setSelection(selection: TextEditorSelection): void
- TextEditorController.subscribe(listener: (snapshot: TextEditorSnapshot) => void): () => void
- setSelection clamps through ProseMirror TextSelection and publishes a cloned snapshot.

- [x] Step 1: Write the failing test

```ts
it('publishes pointer selection transactions and stops them after destroy', () => {
  const snapshots: TextEditorSnapshot[] = []
  const controller = createTextEditorController({ host: document.createElement('div'), body })
  const unsubscribe = controller.subscribe((snapshot) => snapshots.push(snapshot))
  controller.setSelection({ anchor: 1, head: 3 })
  expect(snapshots.at(-1)?.selection).toEqual({ anchor: 1, head: 3 })
  controller.destroy()
  controller.setSelection({ anchor: 1, head: 1 })
  unsubscribe()
  expect(snapshots).toHaveLength(1)
})
```

- [x] Step 2: Run the focused test and verify it fails

Run: pnpm --filter @ppt4ai/editor test -- src/text-editor-controller.test.ts
Expected: FAIL because the controller lacks subscribe and setSelection.

- [x] Step 3: Implement the minimal controller API

Apply TextSelection.create(state.doc, anchor, head) in the controller, publish only when the resulting selection changes, clone snapshots for listeners, and clear listeners on destroy. Preserve existing IME and caret lifecycle behavior.

- [x] Step 4: Run the focused test and verify it passes

Run: pnpm --filter @ppt4ai/editor test -- src/text-editor-controller.test.ts
Expected: PASS, including existing IME and destroy tests.

### Task 2: Add text host interaction tests

Files:
- Create: packages/editor/src/TextBoxEditor.test.ts
- Create: packages/editor/src/TextBoxEditor.vue

Interfaces:
- Props: body, bounds, transform, active, and optional bridgeFactory.
- Emits: update:body with JSON-safe TextBody and update:selection with anchor/head.

- [x] Step 1: Write failing lifecycle and pointer tests

Cover inactive rendering, activation creating one controller, click caret placement, pointer drag producing anchor/head, reverse selection, viewport transform, and unmount cleanup using Vue createApp and synthetic pointer events in happy-dom.

- [x] Step 2: Run the focused tests and verify they fail

Run: pnpm --filter @ppt4ai/editor test -- src/TextBoxEditor.test.ts
Expected: FAIL because the host component does not exist.

- [x] Step 3: Implement the minimal host

Create a positioned pointer surface with UnoCSS classes, create/destroy the controller with active, derive layout and screen interaction from the snapshot, and route click/drag to textPositionAtScreenPoint and setSelection.

- [x] Step 4: Run the focused tests and verify they pass

Run: pnpm --filter @ppt4ai/editor test -- src/TextBoxEditor.test.ts
Expected: PASS with no DOM text mirror.

### Task 3: Add composition provisional preview

Files:
- Modify: packages/editor/src/TextBoxEditor.vue
- Modify: packages/editor/src/TextBoxEditor.test.ts
- Modify: packages/editor/src/index.ts

Interfaces:
- The component keeps compositionText out of emitted update:body until controller composition end.
- Composition preview uses the same TextEditorOverlay geometry path and is removed after commit.

- [x] Step 1: Write the failing composition test

Drive bridge composition-start, composition-update, composition-end, and duplicate text-input; assert preview is visible, emitted body remains unchanged during update, and exactly one committed body is emitted at end.

- [x] Step 2: Run the focused tests and verify they fail

Run: pnpm --filter @ppt4ai/editor test -- src/TextBoxEditor.test.ts -t composition
Expected: FAIL because the host lacks composition preview and body emission.

- [x] Step 3: Implement preview and body synchronization

Subscribe to snapshots, create a temporary cloned body with composition text inserted at the current PM head, layout it with the same bounds, and emit only the committed snapshot body after composition end. Preserve selection and caret synchronization for both layouts.

- [x] Step 4: Run the focused tests and verify they pass

Run: pnpm --filter @ppt4ai/editor test -- src/TextBoxEditor.test.ts -t composition
Expected: PASS with no duplicate text.

### Task 4: Export host and complete validation

Files:
- Modify: packages/editor/src/index.ts
- Modify: 进度.md

- [x] Step 1: Export the host and update the stage handoff

Export TextBoxEditor and its public prop/emit types. Mark the text host slice complete in 进度.md and record validation commands and the next planned slice (formatting commands).

- [x] Step 2: Run focused and full verification

Run:

```text
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands pass.

- [x] Step 3: Commit the complete stage slice

```text
git add docs/superpowers/specs/2026-08-23-stage-4-text-editor-host-design.md docs/superpowers/plans/2026-08-23-stage-4-text-editor-host.md packages/editor/src/TextBoxEditor.vue packages/editor/src/TextBoxEditor.test.ts packages/editor/src/text-editor-controller.ts packages/editor/src/text-editor-controller.test.ts packages/editor/src/index.ts 进度.md
git commit -m "feat: add stage 4 text editor host"
```
