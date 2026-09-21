# Table Formatting Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an UnoCSS table fill/border toolbar and route its model-safe actions through the existing table editor controller to `EditorEngine`.

**Architecture:** Extend the headless controller with direct fill and border command methods, then add a pure Vue toolbar that receives display state and emits model payloads. The component never imports the engine, while the engine continues to own validation, selected-cell enumeration, atomic history, and cloning.

**Tech Stack:** TypeScript, Vue 3, vue-i18n, UnoCSS, `@ppt4ai/model`, `@ppt4ai/engine`, Vitest, happy-dom.

## Global Constraints

- UI dependencies remain Vue 3 plus UnoCSS; do not add Element Plus, another component framework, or an icon package.
- `@ppt4ai/engine` remains headless and must not import Vue, DOM, Canvas, or browser globals.
- The toolbar does not import or retain `EditorEngine`.
- Public payloads remain model-safe and `structuredClone`-compatible.
- Each completed implementation slice receives its own git commit.

---

### Task 1: Extend the Table Editor Controller

**Files:**
- Modify: `packages/editor/src/table-editor-controller.test.ts`
- Modify: `packages/editor/src/table-editor-controller.ts`

**Interfaces:**
- Consumes: `Fill`, `TableBorder`, and existing `EditorEngine` commands.
- Produces: `TableBorderSide`, `TableBorderPatch`, `TableEditorController.setFill`, and `TableEditorController.setBorders`.

- [ ] **Step 1: Write failing controller tests**

Add tests that select the full table range through the controller, then call:

```ts
controller.setFill({ color: { type: 'srgb', v: '00FF00' } })
controller.setBorders({
  left: { color: { type: 'srgb', v: '0000FF' }, width: 1000, style: 'solid' },
  bottom: { color: { type: 'srgb', v: '0000FF' }, width: 1000, style: 'solid' },
})
```

Assert all selected source cells update atomically, history depth increases once per method, `null` clears explicit fill/borders, and invalid model payloads propagate engine errors without increasing history.

- [ ] **Step 2: Run the focused controller test to verify failure**

Run: `pnpm exec vitest run packages/editor/src/table-editor-controller.test.ts`

Expected: FAIL because `setFill` and `setBorders` do not exist.

- [ ] **Step 3: Implement minimal controller methods**

Import model types only. Define:

```ts
export type TableBorderSide = 'left' | 'right' | 'top' | 'bottom'
export type TableBorderPatch = Partial<Record<TableBorderSide, TableBorder | null>>
```

Dispatch `{ type: 'setTableCellFill', fill }` and `{ type: 'setTableCellBorders', borders }` directly and return the resulting `EngineState`.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run packages/editor/src/table-editor-controller.test.ts`

Expected: PASS for selection and formatting controller tests.

- [ ] **Step 5: Commit the controller formatting slice**

```bash
git add packages/editor/src/table-editor-controller.ts packages/editor/src/table-editor-controller.test.ts
git commit -m "feat: edit table fill and borders from controller"
```

### Task 2: Add the UnoCSS Table Formatting Toolbar

**Files:**
- Create: `packages/editor/src/table-formatting-toolbar.ts`
- Create: `packages/editor/src/TableFormattingToolbar.vue`
- Create: `packages/editor/src/TableFormattingToolbar.test.ts`
- Modify: `packages/editor/src/locales/en-US.ts`
- Modify: `packages/editor/src/locales/zh-CN.ts`

**Interfaces:**
- Consumes: `Fill`, `TableBorder`, and `TableBorderPatch` model-safe types.
- Produces: `TableFormattingToolbarProps`, `TableFormattingToolbarEmit`, and the default Vue component.

- [ ] **Step 1: Write failing component tests**

Mount the component with all four sides available and assert:

- inactive props disable every input, select, and button;
- four side buttons expose localized `aria-label` and `aria-pressed`;
- changing fill to `#00ff00` emits `{ color: { type: 'srgb', v: '00FF00' } }`;
- clear fill emits `null`;
- enabling left and bottom then applying emits identical border values for those two sides only;
- clear emits `{ left: null, bottom: null }`;
- applying with no enabled side emits nothing.

- [ ] **Step 2: Run the component test to verify failure**

Run: `pnpm exec vitest run packages/editor/src/TableFormattingToolbar.test.ts`

Expected: FAIL because the toolbar component and contracts do not exist.

- [ ] **Step 3: Define typed props and emits**

Add exact prop defaults through Vue `withDefaults`: fill `#FFFFFF`, border `#000000`, width `12700`, style `solid`, and no enabled sides. Normalize colors to uppercase six-digit sRGB before creating model payloads.

- [ ] **Step 4: Implement semantic native controls**

Render a horizontal UnoCSS toolbar with native color inputs/selects and buttons. Use visible `focus-visible:ring-2 focus-visible:ring-blue-500`, stable hover colors, disabled opacity/cursors, `aria-pressed` side toggles, and semantic localized labels. Emit nothing when no side is enabled.

- [ ] **Step 5: Add locale strings**

Add matching `toolbar.tableFormatting` labels in `en-US.ts` and `zh-CN.ts` for fill, border sides, width, style, apply, clear, and style option names.

- [ ] **Step 6: Run component and editor tests**

Run:

```bash
pnpm exec vitest run packages/editor/src/TableFormattingToolbar.test.ts
pnpm --filter @ppt4ai/editor test
```

Expected: PASS with no Vue warnings.

- [ ] **Step 7: Commit the toolbar slice**

```bash
git add packages/editor/src/table-formatting-toolbar.ts packages/editor/src/TableFormattingToolbar.vue packages/editor/src/TableFormattingToolbar.test.ts packages/editor/src/locales/en-US.ts packages/editor/src/locales/zh-CN.ts
git commit -m "feat: add table formatting toolbar"
```

### Task 3: Export and Validate the Formatting Slice

**Files:**
- Modify: `packages/editor/src/index.ts`
- Modify: `进度.md`

**Interfaces:**
- Consumes: controller formatting types and toolbar component/contracts.
- Produces: public `@ppt4ai/editor` exports and an updated Stage 7 handoff record.

- [ ] **Step 1: Export public APIs**

Export `TableFormattingToolbar`, `TableFormattingToolbarProps`, `TableFormattingToolbarEmit`, `TableBorderSide`, and `TableBorderPatch` from the editor entrypoint.

- [ ] **Step 2: Update progress**

Record the UnoCSS fill/border toolbar and controller command mapping as complete. Keep mixed style derivation, Vue host composition, row/column operations, merge/split, text editing, style inheritance, and PPTX export pending.

- [ ] **Step 3: Run all validation gates**

Run:

```bash
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all workspace checks pass without boundary violations, type errors, Vue warnings, or formatting errors.

- [ ] **Step 4: Commit public integration**

```bash
git add packages/editor/src/index.ts 进度.md
git commit -m "docs: record table formatting toolbar slice"
```

## Completion Criteria

- Selected table cells can receive fill and per-side border commands through the headless controller.
- The toolbar uses only Vue, vue-i18n, native controls, and UnoCSS.
- Inactive, keyboard, accessible-label, color normalization, apply, and clear behaviors are covered by tests.
- Engine history remains atomic and validation errors propagate unchanged.
- All focused and workspace gates pass.
