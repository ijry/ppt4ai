# Stage 7 Table Style Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with focused verification and one commit per task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JSON-safe table style semantics, import custom DrawingML table styles and table flags, and expose deterministic resolved cell styles in SceneGraph.

**Architecture:** Keep style definitions and references in `@ppt4ai/model`, with a pure resolver that applies whole-table, enabled band, edge-region, and explicit cell layers. Extend the existing PPTX importer to read `ppt/tableStyles.xml` and `tblPr` attributes, then let `@ppt4ai/render` attach resolved styles while preserving source cell properties. No UI or export XML is included in this slice.

**Tech Stack:** TypeScript, Vitest, existing workspace packages (`@ppt4ai/model`, `@ppt4ai/pptx-import`, `@ppt4ai/render`); no new runtime dependencies and no Element Plus.

## Global Constraints

- Do not add Element Plus or any new runtime dependency; editor UI remains UnoCSS-only.
- Public model, importer, and render data stays JSON-safe and `structuredClone`-compatible.
- Keep resolution pure and headless; do not read DOM, Canvas, browser fonts, or Vue state.
- Preserve existing shape/text/table geometry behavior and source XML entries.
- Malformed or unsupported style fragments are ignored deterministically and do not abort otherwise readable slide import.
- Use TDD: write each focused failing test, run it red, implement the minimum behavior, run it green, then refactor.
- Commit each task independently.

---

### Task 1: Add table style model and pure resolution

**Files:**
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/src/model.test.ts`

**Interfaces:**
- Produces `TableStyleRegionName`, `TableStyleRegion`, `TableStyle`, `TableStyleReference`, and `ResolvedTableCellStyle` exports.
- Adds optional `TableElement.style` and `Ppt4aiDocument.tableStyles`.
- Produces `resolveTableCellStyle(table, cell, row, column, tableStyles?)`.

- [ ] **Step 1: Write the failing model tests**

Add tests using one 2x2 table and a custom style:

```ts
const style = {
  id: 'style-1',
  regions: {
    wholeTable: { fill: { color: { type: 'srgb', v: 'FFFFFF' } }, borders: { bottom: { color: { type: 'srgb', v: '111111' }, width: 1000, style: 'solid' } } },
    band1H: { fill: { color: { type: 'srgb', v: 'EEEEEE' } } },
    firstRow: { fill: { color: { type: 'srgb', v: 'FF0000' } } },
    firstCol: { borders: { left: { color: { type: 'srgb', v: '0000FF' }, width: 2000, style: 'dash' } } },
  },
}
const table: TableElement = {
  id: 'tbl_1', kind: 'table', bounds: { x: 0, y: 0, w: 2000, h: 2000 }, columns: [1000, 1000],
  rows: [{ height: 1000, cells: [{ column: 0, body: emptyBody() }, { column: 1, body: emptyBody() }] },
    { height: 1000, cells: [{ column: 0, body: emptyBody() }, { column: 1, body: emptyBody(), fill: { color: { type: 'srgb', v: '00FF00' } } }] }],
  style: { styleId: 'style-1', bandRow: true, firstRow: true, firstColumn: true },
}
```

Assert that the document validates, style data survives `structuredClone`, the first-row cell gets `FF0000`, the second-row first cell gets `EEEEEE` plus the first-column left border, and the explicit green cell fill overrides all style fills while retaining inherited borders. Assert missing style IDs return empty borders and no fill. Assert invalid region names and non-boolean flags report stable `elements.tbl_1.style...` paths.

- [ ] **Step 2: Run model tests to verify red**

Run: `pnpm --filter @ppt4ai/model test -- src/model.test.ts`

Expected: FAIL because style fields and `resolveTableCellStyle` do not exist.

- [ ] **Step 3: Implement the minimal model change**

Add the interfaces and fields beside the table interfaces. Extend `Ppt4aiDocument` with `tableStyles?: Record<string, TableStyle>`. Validate IDs, known region names, booleans, and all nested fills/borders using existing validators. Resolve by cloning and merging in this exact order: `wholeTable`, enabled `band1H`/`band2H` or `band1V`/`band2V`, enabled edge regions in `firstRow`, `lastRow`, `firstCol`, `lastCol` order, then explicit cell fill and border sides. Apply a later value only when that field or border side exists; return `{ borders: {} }` when no style is available. Do not mutate inputs.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @ppt4ai/model test -- src/model.test.ts; pnpm --filter @ppt4ai/model typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the model slice**

```bash
git add packages/model/src/index.ts packages/model/src/model.test.ts
git commit -m "feat: add table style model and resolution"
```

---

### Task 2: Import table style definitions and table flags

**Files:**
- Modify: `packages/pptx-import/src/importer.ts`
- Test: `packages/pptx-import/src/importer.test.ts`

**Interfaces:**
- Consumes `TableStyle` and `TableStyleReference` from `@ppt4ai/model`.
- Extends `importPptx` output with `tableStyles` when `ppt/tableStyles.xml` contains valid definitions.
- Extends imported table elements with `style` from `tblPr`.

- [ ] **Step 1: Write the failing importer tests**

Add a stored ZIP fixture containing `ppt/presentation.xml`, one slide and relationships, and `ppt/tableStyles.xml` with:

```xml
<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:tblStyle styleId="style-1" name="Accent">
    <a:wholeTbl><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:lnB w="1000"><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:lnB></a:wholeTbl>
    <a:band1H><a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill></a:band1H>
    <a:firstRow><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:firstRow>
  </a:tblStyle>
</a:tblStyleLst>
```

Set table `tblPr tableStyleId="style-1" firstRow="1" bandRow="1" firstCol="1"`. Assert imported `tableStyles.style-1` has region fills/bottom border, imported table flags are booleans, source XML still includes the style part, duplicate style IDs retain the first definition, and malformed style entries do not remove the table or sibling shape.

- [ ] **Step 2: Run focused importer tests to verify red**

Run: `pnpm --filter @ppt4ai/pptx-import test -- src/importer.test.ts`

Expected: FAIL because `tableStyles.xml` is not parsed and table style references are not imported.

- [ ] **Step 3: Implement the minimal importer change**

Add helpers near existing fill/border parsers: parse a style region from direct `solidFill` and `lnL/R/T/B`, parse all recognized `tblStyle` children in document order, trim IDs, and first-definition-wins. Update `parseTable` to read `tblPr` style attributes. In `importPptx`, parse `ppt/tableStyles.xml` once before slide traversal and attach `tableStyles` only when non-empty. Treat malformed colors, widths, and unknown region children as absent region fields; never throw for style parsing.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @ppt4ai/pptx-import test -- src/importer.test.ts; pnpm --filter @ppt4ai/pptx-import typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the importer slice**

```bash
git add packages/pptx-import/src/importer.ts packages/pptx-import/src/importer.test.ts
git commit -m "feat: import pptx table styles"
```

---

### Task 3: Expose resolved table styles in SceneGraph

**Files:**
- Modify: `packages/render/src/scenegraph.ts`
- Test: `packages/render/src/scene.test.ts`

**Interfaces:**
- Consumes `resolveTableCellStyle` and `Ppt4aiDocument.tableStyles`.
- Adds `resolvedStyle: ResolvedTableCellStyle` to `SceneTableLayoutCell`.
- Keeps existing source `fill` and `borders` fields unchanged.

- [ ] **Step 1: Write the failing render test**

Extend the existing table SceneGraph fixture with `document.tableStyles` and table style flags. Assert the first cell's `resolvedStyle.fill` is the first-row fill, a banded body cell receives the band fill, first-column cells receive the left border, explicit cell fill remains present in `resolvedStyle`, and `structuredClone(graph)` equals `graph`.

- [ ] **Step 2: Run focused render tests to verify red**

Run: `pnpm --filter @ppt4ai/render test -- src/scene.test.ts`

Expected: FAIL because SceneGraph cells have no `resolvedStyle` field.

- [ ] **Step 3: Implement the minimal render change**

Add the field to the public scene types and call `resolveTableCellStyle(element, cell, layoutCell.row, layoutCell.column, value.tableStyles)` while building each table node. Preserve `fill` and `borders` from the existing layout cell, and attach the returned clone-safe resolved object.

- [ ] **Step 4: Run focused tests and package verification**

Run: `pnpm --filter @ppt4ai/render test -- src/scene.test.ts; pnpm --filter @ppt4ai/render typecheck; pnpm --filter @ppt4ai/render build`

Expected: PASS.

- [ ] **Step 5: Commit the render slice**

```bash
git add packages/render/src/scenegraph.ts packages/render/src/scene.test.ts
 git commit -m "feat: resolve table styles in scene graph"
```

---

### Task 4: Complete slice verification and progress record

**Files:**
- Modify: `进度.md`

- [ ] **Step 1: Update progress**

Mark table style semantics, import, and SceneGraph resolution complete under Stage 7, and leave table editing UI and PPTX export XML as pending.

- [ ] **Step 2: Run repository verification**

Run: `pnpm check:boundaries; pnpm test; pnpm typecheck; pnpm build; git diff --check`

Expected: all commands pass and only the progress update remains uncommitted.

- [ ] **Step 3: Commit the progress slice**

```bash
git add 进度.md
git commit -m "docs: record table style semantics slice"
```
