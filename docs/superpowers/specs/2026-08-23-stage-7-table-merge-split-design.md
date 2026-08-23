# Stage 7 Table Merge and Split Design

> Date: 2026-08-23
>
> Scope: merge the current rectangular table-cell selection and split the focused merged cell in the headless engine. Toolbar controls, row/column UI, direct table text editing, complete theme inheritance, and PPTX export XML remain later slices.

## Goal

Add deterministic, undoable table merge and split commands to `@ppt4ai/engine`. The commands preserve all non-empty text during merge, keep a predictable source-cell style, maintain a valid table grid and selection, and introduce no Vue, DOM, Canvas, or browser globals.

## Public commands

The engine adds two commands that consume the current `tableCellSelection`:

```ts
type EngineCommand =
  | { type: 'mergeTableCells' }
  | { type: 'splitTableCell' }
```

The command payload does not repeat an element ID or cell coordinates. This follows the existing table fill, border, and text editing commands and prevents stale UI coordinates from disagreeing with engine state.

If no valid table-cell selection exists, either command is a no-op and creates no history entry. A merge of one effective grid cell and a split of an unmerged source cell are also no-ops.

## Merge eligibility

The engine resolves the selection anchor and focus to their source-cell rectangles, then derives the smallest inclusive rectangle containing both complete endpoint rectangles. This preserves the user's endpoint intent even though table selection coordinates are normalized to source cells. A merge is allowed only when:

- the rectangle covers at least two grid positions;
- every grid position resolves to a source cell;
- every source cell intersecting the rectangle is fully contained by it.

The full-containment rule permits merging a rectangle that includes existing merged cells, but rejects a selection that cuts through an existing `rowSpan` or `colSpan`. Rejection throws a stable error containing the table element ID and leaves the document, selection, and history unchanged.

## Merge result

The merged source is placed at the rectangle's top-left coordinate. Its `rowSpan` and `colSpan` cover the complete selected rectangle; span values equal to one are omitted. All other source cells fully contained in the rectangle are removed, while cells outside the rectangle remain unchanged.

### Content preservation

Source cells are visited by source row and source column. Their non-empty paragraphs are appended to the merged body in that order:

- the top-left source body supplies the merged `bodyPr`;
- a paragraph is non-empty when at least one run contains non-empty text;
- all paragraphs from the top-left source are retained, including empty paragraphs, so its internal spacing and initial empty state are not silently rewritten;
- from every other source, only non-empty paragraphs are appended;
- paragraph attributes and run marks are cloned unchanged;
- if the resulting paragraph list would be empty, use one legal empty paragraph: `{ runs: [] }`.

This policy prevents silent text loss without attempting to merge incompatible cell-level text-body properties. It also makes the output independent of drag direction.

### Style preservation

The merged source keeps the top-left source cell's explicit `fill` and `borders`. Styles from other cells are not blended. Table-level style references and flags remain unchanged and continue to resolve against the new source coordinate and span.

## Split behavior

`splitTableCell` resolves the selection focus through `sourceCellAt`. If that source has neither `rowSpan > 1` nor `colSpan > 1`, the command is a no-op.

For a merged source:

- replace its covered rectangle with individual one-by-one source cells;
- the top-left restored cell keeps the original body, fill, and borders;
- every other restored cell receives `{ paragraphs: [{ runs: [] }] }` and no explicit fill or borders;
- row heights, column widths, table bounds, table style references, and unrelated cells remain unchanged.

The split operation does not duplicate content or explicit style across restored cells. This gives a reversible grid shape without inventing data that did not exist in the merged model.

## Grid reconstruction

Both operations reuse the structure-editing representation of source-cell rectangles and occupancy-based row reconstruction:

1. enumerate each existing source cell with its row, column, row span, column span, and cloned payload;
2. replace the selected rectangles with one merged rectangle or one-cell rectangles;
3. scan the unchanged table dimensions in row-major order;
4. emit each source exactly once, keep row cells sorted by column, and verify every grid coordinate is occupied once;
5. build a candidate document with the complete replacement `TableElement` and run `validateDocument` before mutation.

Any reconstruction or model validation failure throws `table merge is invalid: <elementId>: ...` or `table split is invalid: <elementId>: ...`. Validation happens before commit, so failure has no side effects.

## Selection and history

After a successful merge, the table-cell anchor and focus both become the new merged source coordinate. After a successful split, both become the original merged source's top-left coordinate. Ordinary element selection is unchanged.

Each successful command commits one complete `TableElement` replacement patch and therefore creates exactly one undo entry. Undo and redo restore the previous or next table atomically; existing selection revalidation keeps endpoints normalized to source cells. No-op and rejected commands do not change undo or redo depth.

## Testing

Focused engine tests cover:

- merging a plain rectangular selection with reverse drag direction;
- preserving top-left `bodyPr`, fill, borders, paragraphs, paragraph attributes, and run marks;
- appending other non-empty paragraphs in row-major source order while ignoring their empty paragraphs;
- fully containing an existing merged cell;
- rejecting partial overlap with an existing merged cell without side effects;
- splitting row-only, column-only, and two-dimensional spans;
- retaining source content/style only at the restored top-left cell;
- selection normalization, one-entry undo/redo, no-selection no-op, single-cell merge no-op, and unmerged split no-op;
- candidate model validation failure without document or history mutation.

Workspace validation remains:

```text
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

## Completion criteria

- `mergeTableCells` and `splitTableCell` are available through `EditorEngine.dispatch`.
- Merge accepts only complete rectangular source-cell coverage and never silently loses non-empty text.
- Split restores valid individual cells without duplicating source content or style.
- Selection, validation, undo, and redo behavior is deterministic and atomic.
- `@ppt4ai/engine` remains browser- and framework-independent.
- Focused tests and all workspace gates pass.
