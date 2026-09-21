# Stage 7 Table Export XML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serialize normalized PPTX table models into deterministic DrawingML table XML.

**Architecture:** Keep `@ppt4ai/pptx-export` headless and independent of ZIP, DOM, and browser APIs. Expose one pure serializer that writes the `a:tbl` payload from `TableElement`, preserving structured colors and source model immutability.

**Tech Stack:** TypeScript 6, Vitest 4, existing `@ppt4ai/model` contracts and pnpm workspace.

## Global Constraints

- Keep `@ppt4ai/model`, `@ppt4ai/pptx-import`, and `@ppt4ai/render` headless.
- Do not add Vue, DOM, Canvas, browser globals, Element Plus, or CSS runtime dependencies.
- Preserve structured source colors; do not resolve theme colors during export.
- Support only table grid, merge metadata, text, fill, four outer border sides, table-style flags, and supported structured color transforms.
- Do not implement ZIP packaging, relationships, slide replacement, diagonal borders, or theme editing in this slice.
- Every independently completed task ends with focused tests and its own commit.

---

### Task 1: Add the table XML serializer

**Files:**
- Create: `packages/pptx-export/src/table.ts`
- Modify: `packages/pptx-export/src/index.ts`
- Test: `packages/pptx-export/src/table.test.ts`

**Interfaces:**
- Consumes: `TableElement`, `TableCell`, `TableCellBorders`, `Color`, `Fill`, and text model types from `@ppt4ai/model`.
- Produces: `serializeTableXml(table: TableElement): string` from `@ppt4ai/pptx-export`.

- [ ] **Step 1: Write the failing serializer tests**

Cover one table containing two columns, one merged origin, a horizontal and vertical continuation, escaped text, explicit run marks, cell fill, four borders, and table flags. Assert exact XML child order and attributes. Add a second test for every structured color kind and ordered transforms. Add a clone-safety assertion by comparing the source table with `structuredClone(table)` after serialization.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `pnpm exec vitest run packages/pptx-export/src/table.test.ts`

Expected: FAIL because `serializeTableXml` is not exported yet.

- [ ] **Step 3: Implement the minimal serializer**

Implement XML escaping, color element serialization, fill/border serialization, text body/run serialization, table properties, grid columns, and normalized merge continuation emission. Preserve source order and omit unsupported optional fields.

- [ ] **Step 4: Run focused tests, typecheck, and build**

Run: `pnpm exec vitest run packages/pptx-export/src/table.test.ts; pnpm --filter @ppt4ai/pptx-export typecheck; pnpm --filter @ppt4ai/pptx-export build; git diff --check`

Expected: all checks pass.

- [ ] **Step 5: Commit the serializer slice**

```bash
git add packages/pptx-export/src/table.ts packages/pptx-export/src/table.test.ts packages/pptx-export/src/index.ts
git commit -m "feat: serialize pptx table xml"
```

### Task 2: Record and verify the export XML slice

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: `serializeTableXml` and the Task 1 focused test results.
- Produces: progress record stating that table XML serialization is complete while full PPTX ZIP export remains pending.

- [ ] **Step 1: Update the progress record**

Mark the table XML serializer complete and leave the full PPTX package/write-back item pending.

- [ ] **Step 2: Run repository verification**

Run: `pnpm test; pnpm check:boundaries; pnpm typecheck; pnpm build; git diff --check`

- [ ] **Step 3: Commit the progress record**

```bash
git add 进度.md
git commit -m "docs: record table xml export slice"
```
