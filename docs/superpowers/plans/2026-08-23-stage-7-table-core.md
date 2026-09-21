# Stage 7 Table Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with focused verification and one commit per task.

**Goal:** Add a JSON-safe table model, deterministic merged-cell layout, DrawingML table import, and SceneGraph table nodes while preserving existing shape and text behavior.

**Architecture:** Extend `@ppt4ai/model` with normalized table rows/cells and validation of occupied grid rectangles. Add `layoutTable` to the headless `@ppt4ai/layout` package, using EMU row/column dimensions and stable border ordering. Extend the importer to recognize `a:tbl` and normalize merge syntax, then let `@ppt4ai/render` expose table geometry as a structured-clone-safe SceneGraph node. Keep cell text as `TextBody` data; defer cell text layout, table editing UI, full table styles, and export XML.

**Tech Stack:** TypeScript, Vitest, existing workspace packages (`@ppt4ai/model`, `@ppt4ai/layout`, `@ppt4ai/pptx-import`, `@ppt4ai/render`); no new runtime dependencies and no Element Plus.

## Global Constraints

- Do not add Element Plus or any new runtime dependency; editor UI remains UnoCSS-only.
- `@ppt4ai/model`, `@ppt4ai/layout`, `@ppt4ai/render`, and `@ppt4ai/pptx-import` remain JSON-safe at their public boundaries.
- `@ppt4ai/layout` stays headless and uses EMU values only; it must not read DOM, Canvas, browser fonts, or Vue state.
- Existing shape and text model/layout/SceneGraph output remains unchanged.
- A malformed or unsupported table fragment is ignored or downgraded deterministically; it must not make an otherwise readable PPTX fail to import.
- Marker glyphs, merge metadata, and XML-only bookkeeping never enter cell text.
- Every completed task has focused tests and its own git commit.
- Use TDD for every behavior: failing focused test, verified red run, minimal implementation, green run, then refactor.

---

### Task 1: Add the table model contract and validation

**Files:**
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/src/model.test.ts`

**Interfaces:**
- Produces `TableBorder`, `TableCellBorders`, `TableCell`, `TableRow`, and `TableElement` exports.
- Extends `Element` with `kind: 'table'` and validates table-specific values inside `validateDocument`.
- Keeps `resolveInheritedElement` clone-safe and preserves existing shape/text/group behavior.

- [ ] **Step 1: Write the failing model tests**

Add tests with this minimal valid table:

```ts
const table = {
  id: 'tbl_1',
  kind: 'table' as const,
  bounds: { x: 100, y: 200, w: 3000, h: 2000 },
  columns: [1000, 2000],
  rows: [{
    height: 1000,
    cells: [{
      column: 0,
      body: { paragraphs: [{ runs: [{ text: 'A' }] }] },
      colSpan: 2,
    }],
  }, {
    height: 1000,
    cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'B' }] }] } }, { column: 1, body: { paragraphs: [{ runs: [{ text: 'C' }] }] } }],
  }],
}
```

Assert that it validates and survives `structuredClone`. Add focused invalid cases for an empty `columns` array, non-positive width/height, fractional `column`, zero `rowSpan`, out-of-range `colSpan`, row-span overlap, invalid border width/style/color, and invalid cell `TextBody`; assert stable `elements.tbl_1...` paths.

- [ ] **Step 2: Run the model tests to verify red**

Run: `pnpm --filter @ppt4ai/model test -- src/model.test.ts`

Expected: FAIL because the model has no table union or table validation.

- [ ] **Step 3: Implement the minimal model change**

Add the interfaces beside the existing shape/text interfaces. Add `kind: 'table'` to `Element`. Validate table bounds, column widths, row heights, cell bodies, integer positions/spans, span bounds, and occupied rectangles in row-major order. Validate border colors through the existing color rules, widths as non-negative finite values, and styles against `solid`, `dash`, `dot`, and `none`. Keep duplicate cell overlap errors deterministic and do not mutate input values.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @ppt4ai/model test -- src/model.test.ts; pnpm --filter @ppt4ai/model typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the model slice**

```text
git add packages/model/src/index.ts packages/model/src/model.test.ts
git commit -m "feat: add table model contract"
```

### Task 2: Implement deterministic merged-cell table layout

**Files:**
- Create or modify: `packages/layout/src/table.ts`
- Modify: `packages/layout/src/index.ts`
- Test: `packages/layout/src/table.test.ts`

**Interfaces:**
- Produces `TableLayoutCell`, `TableLayoutBorder`, `TableLayout`, and `layoutTable(element: TableElement): TableLayout`.
- Uses the model's `bounds`, `columns`, `rows`, and normalized cell spans without changing model values.

- [ ] **Step 1: Write the failing layout tests**

Add tests for a table at `{ x: 100, y: 200 }` with columns `[1000, 2000]` and rows `[500, 700]`. Assert the two non-merged cells have exact EMU bounds and row-major order. Add a `colSpan: 2` cell and a `rowSpan: 2` cell and assert their union bounds. Add an empty row/cell case and assert it remains in output. Add borders on all four sides of a cell and assert emitted sides are `left`, `right`, `top`, `bottom` in that exact order with stable coordinates. Assert `structuredClone(layout) === layout`.

- [ ] **Step 2: Run the layout tests to verify red**

Run: `pnpm --filter @ppt4ai/layout test -- src/table.test.ts`

Expected: FAIL because no table layout function or types exist.

- [ ] **Step 3: Implement the minimal layout function**

Compute cumulative x/y offsets from the element origin, sum the widths/heights covered by each span, and return cells in row-major order. Emit each supplied cell border in `left`, `right`, `top`, `bottom` order with coordinates derived from the cell bounds. Keep all numbers finite and clone-safe. Do not lay out cell text or add browser dependencies.

- [ ] **Step 4: Run focused layout tests and typecheck**

Run: `pnpm --filter @ppt4ai/layout test -- src/table.test.ts; pnpm --filter @ppt4ai/layout typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the layout slice**

```text
git add packages/layout/src/table.ts packages/layout/src/index.ts packages/layout/src/table.test.ts
git commit -m "feat: add deterministic table layout"
```

### Task 3: Import DrawingML tables into the normalized model

**Files:**
- Modify: `packages/pptx-import/src/importer.ts`
- Modify: `packages/pptx-import/src/index.ts` only if parser helpers need public exports
- Test: `packages/pptx-import/src/importer.test.ts`

**Interfaces:**
- `importPptx` creates `TableElement` entries for valid `a:tbl` shapes and preserves slide element order.
- Cell text continues to use structured `TextBody`; merge syntax does not enter cell text or public model fields.

- [ ] **Step 1: Write failing table import fixtures and assertions**

Add a stored ZIP fixture whose slide contains `p:graphicFrame` with `a:graphicData` and `a:tbl`: two grid columns, two rows, one `gridSpan`, one `rowSpan`, one `hMerge`/`vMerge` continuation, cell text, `a:solidFill`, and `a:lnL/R/T/B`. Assert imported `kind`, bounds, widths, row heights, normalized cell count/columns/spans, text, fill, borders, slide order, source XML, and `structuredClone(imported)`. Add malformed width/span/color fixtures and assert valid neighboring content still imports.

- [ ] **Step 2: Run importer tests to verify red**

Run: `pnpm --filter @ppt4ai/pptx-import test -- src/importer.test.ts`

Expected: FAIL because the importer currently only scans `p:sp` shapes.

- [ ] **Step 3: Implement table parsing**

Add a direct `a:tbl` parser that reads `tblGrid`, rows, cells, text bodies, fills, and basic line nodes. Track occupied positions per row so explicit `gridSpan`/`rowSpan` and `hMerge`/`vMerge` continuation cells become one normalized origin cell. Use deterministic fallback row heights only when valid table bounds and row count exist. Return `undefined` for unusable tables and leave existing shape/text parsing unchanged. Add `graphicFrame` scanning to `importPptx` while avoiding duplicate descendant table parsing.

- [ ] **Step 4: Run importer tests and typecheck**

Run: `pnpm --filter @ppt4ai/pptx-import test -- src/importer.test.ts; pnpm --filter @ppt4ai/pptx-import typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the importer slice**

```text
git add packages/pptx-import/src/importer.ts packages/pptx-import/src/importer.test.ts
git commit -m "feat: import pptx tables"
```

### Task 4: Expose tables through SceneGraph

**Files:**
- Modify: `packages/render/src/scenegraph.ts`
- Modify: `packages/render/src/index.ts`
- Test: `packages/render/src/scene.test.ts`

**Interfaces:**
- Produces `SceneTableNode` with `id`, `kind: 'table'`, `bounds`, `layout`, optional `fill`, and optional `stroke`.
- `SceneNode` becomes `SceneShapeNode | SceneTextNode | SceneTableNode`.
- Existing shape/text snapshots remain unchanged.

- [ ] **Step 1: Write the failing SceneGraph tests**

Add a minimal document containing one table and assert `documentToSceneGraph(document).nodes[0]` has `kind: 'table'`, exact bounds, exact layout cells, and clone-safe output. Keep the existing shape/text snapshot assertions unchanged and add a mixed shape/text/table order assertion.

- [ ] **Step 2: Run SceneGraph tests to verify red**

Run: `pnpm --filter @ppt4ai/render test -- src/scene.test.ts`

Expected: FAIL because `SceneNode` does not include tables.

- [ ] **Step 3: Implement table SceneGraph creation**

Import `layoutTable`, define `SceneTableNode`, add a `createTableNode` helper, and route `kind: 'table'` through `createNode`. Preserve inherited fill/stroke and existing node ordering.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @ppt4ai/render test -- src/scene.test.ts; pnpm --filter @ppt4ai/render typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the SceneGraph slice**

```text
git add packages/render/src/scenegraph.ts packages/render/src/index.ts packages/render/src/scene.test.ts
git commit -m "feat: add table scene nodes"
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

Expected: all commands pass. Investigate failures with the narrowest package command and change only the table-core slice.

- [ ] **Step 2: Update progress**

Record the table model contract, merged-cell layout, DrawingML import, and SceneGraph node as complete. State that full `tableStyles.xml`, table editing UI, cell text layout integration, and PPTX export XML remain follow-up work. Keep the UnoCSS-only decision visible and record the exact final test count.

- [ ] **Step 3: Review boundaries and clone safety**

Run:

```text
git status --short
git diff --stat
rg -n "element-plus|ElementPlus" packages docs
```

Inspect changed exports and confirm table model/layout/import/SceneGraph values contain no functions, DOM nodes, Vue objects, or merge marker text.

- [ ] **Step 4: Commit the handoff update**

```text
git add 进度.md
git commit -m "docs: complete table core slice"
```

- [ ] **Step 5: Verify the committed worktree**

Run: `git status --short; git log -5 --oneline`

Expected: clean worktree and the table-core handoff commit at `HEAD`.

## Self-review

- Spec coverage: model contract, validation, merge normalization, deterministic layout, borders, importer syntax, SceneGraph output, clone safety, and non-goals each have explicit tasks.
- Type consistency: `TableElement`, `TableLayout`, `layoutTable`, and `SceneTableNode` names match the design contract.
- Placeholder scan: no unfinished marker, vague error-handling step, or unspecified verification command remains.
- Compatibility: existing shape/text branches are preserved and tested in the SceneGraph task.
