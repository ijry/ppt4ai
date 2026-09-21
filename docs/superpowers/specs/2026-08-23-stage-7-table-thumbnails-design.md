# Stage 7 Table Thumbnail Design

> **Status:** Approved for implementation planning
> **Date:** 2026-08-23

## Goal and Scope

Extend the Worker/OffscreenCanvas thumbnail pipeline so `SceneTableNode`
objects render resolved cell fills, four-side borders, and precomputed cell
text while preserving scene order and node-level failure isolation.

The painter consumes the data already present in each
`SceneTableLayoutCell`: full source-cell bounds (including merged spans),
`resolvedFillColor`, `resolvedStyle.borders`, `resolvedBorderColors`, and
`textLayout`. It does not derive a grid, resolve styles or theme colors,
measure or wrap text, or recalculate merged-cell geometry.

Tables remain one node relative to surrounding shapes, images, and text. The
thumbnail protocol is unchanged, tables never request assets, and no runtime
dependency is added. The editor remains Vue, Vue-I18n, and UnoCSS based, with
no Element Plus dependency.

## Architecture

`packages/editor/src/table-painting.ts` owns Canvas translation for a
`SceneTableNode`. It receives the existing structural page mapping, validates
table geometry and styles, guards Canvas state, and paints three passes.

`packages/editor/src/text-painting.ts` exposes a layout-level helper.
`paintTextNode` delegates to it, while the table painter passes each cell's
existing `textLayout`. This avoids fake scene nodes and keeps fonts, markers,
underlines, vertical text, colors, alpha, and validation in one implementation.

`packages/editor/src/thumbnail-worker.ts` adds `table` to its existing node
gate and dispatches to `paintTableNode` inside the current per-node failure
boundary. Request lifecycle, viewport mapping, image resources, cancellation,
diagnostics, and scene ordering remain unchanged. No change is required in
model, layout, render, or the thumbnail protocol.

## Rendering Semantics

### Fills

The first pass walks `layout.cells` in source order. A cell with
`resolvedFillColor` paints its mapped rectangle using the resolved RGB and
alpha. A missing resolved fill produces no operation. The painter does not
fall back to table-level unresolved `fill` or `stroke`; per-cell resolved scene
data is authoritative. Completing all fills first prevents a later cell fill
from covering an earlier border or text.

### Borders

The second pass walks cells in source order and sides in `left`, `right`,
`top`, `bottom` order. A border from `resolvedStyle.borders` is paired with the
same side's `resolvedBorderColors` value.

- `none` skips the side; a missing style means `solid`.
- A missing resolved color skips the side rather than guessing a color.
- A missing width uses `12700` EMU, matching the editor's 1 pt default.
- Width maps as `width * pageScale`, with a one-pixel visible minimum.
- `lineCap` is `butt`, and the dash pattern resets for every side.
- `solid` maps to `[]`, `dash` to `[4w, 3w]`, and `dot` to `[w, 2w]`, where
  `w` is the mapped Canvas line width.

Borders follow exact mapped cell edges. Canvas centers strokes on each path.
If adjacent cells both define a shared edge, both are painted deterministically
and the later edge wins visually. This slice does not invent a PowerPoint
border-conflict resolver absent from the model.

### Text

The third pass walks cells in source order and sends each absolute,
precomputed `textLayout` to the shared layout-level text painter. Because cell
text coordinates already derive from full source-cell bounds, no table-local
translation is applied. Existing text behavior remains authoritative; the
worker performs no measurement, shaping, wrapping, or reflow.

An empty table, a table without drawable styles, or a cell with empty text is
successful. It adds the table ID to `drawnNodeIds` and requests no resources.

## Scene Order and Errors

The worker preserves `SceneGraph.nodes` order and completely processes the
table at its place in that sequence. A successful table enters
`drawnNodeIds`. Any fill, border, validation, or text exception puts its ID in
`skippedNodeIds`, reports the existing `draw-failed` issue, restores Canvas
state, and allows later nodes to continue. Already-painted pixels are not
rolled back, matching existing shape and text behavior.

The painter rejects non-finite mapping or geometry values, non-positive page
scale, negative cell dimensions, malformed RGB, alpha outside `0..100000`,
non-finite or negative explicit widths, and unsupported border styles that
arrive through unsafe data. Zero dimensions and zero-width non-`none` borders
are valid; the latter use the one-pixel minimum. Missing resolved colors are
omissions, not errors.

The complete table operation uses `save()` and `restore()` in `finally`. The
shared text-layout helper keeps its own state guard, so failures cannot leak
fill, alpha, dash, line, transform, or font state into later nodes.

## Testing

Focused painter tests cover:

- all fills before borders and all borders before text;
- absolute mapped bounds and supplied merged-cell bounds;
- fill RGB and alpha;
- side coordinates and left/right/top/bottom ordering;
- 1 pt width fallback and one-pixel minimum;
- solid, dash, dot, none, and deterministic duplicate shared edges;
- reuse of precomputed text layout;
- empty tables and empty cell text;
- validation failures and context restoration.

Text tests cover the extracted layout-level entry and unchanged node-level
behavior. Worker tests cover shape/image/text/table order, drawn and skipped
IDs, `draw-failed` isolation, empty tables, and zero table resource requests.

Final gates are focused and full tests, package boundaries, recursive
typecheck, recursive build, `git diff --check`, and the Element Plus scan.

## Non-Goals

This slice excludes table-level fallback painting, diagonal borders, compound
or custom line styles, shared-border conflict resolution, rounded cells,
shadows, gradients, patterns, cell clipping, font embedding, chart thumbnails,
and group thumbnail composition. Those require separate scene contracts or
designs rather than thumbnail-only inference.
