# Stage 7 Basic Shape Thumbnail Design

> **Status:** Approved for implementation
> **Date:** 2026-08-23

## Goal

Extend the existing Worker/OffscreenCanvas thumbnail pipeline so basic
`SceneShapeNode` objects appear in thumbnails, while preserving scene order,
clone-safe results, and the existing image resource bridge.

## Scope

This slice renders the four preset geometries currently represented by the
render package:

- `rect`;
- `roundRect`;
- `ellipse`;
- `triangle`.

The scene graph already contains deterministic `PathCommand[]` coordinates and
resolved fill/stroke colors. The thumbnail worker consumes those values without
re-resolving theme colors or requesting an asset. Shape and image nodes are
painted in their original `SceneGraph.nodes` order so overlapping content keeps
the same stacking order as the scene graph.

Text, tables, charts, groups, gradients, pattern fills, line widths, dash
styles, and shape-specific effects remain outside this slice. Unsupported node
kinds continue to be ignored as before. No new runtime dependency is added;
the editor runtime remains Vue, Vue-I18n, and UnoCSS based.

## Architecture

`packages/editor/src/shape-painting.ts` owns the Canvas translation of the
shared geometry protocol. It accepts a `SceneShapeNode` plus an explicit page
mapping and emits Canvas path operations for `move`, `line`, `arc`, and `close`.
The helper saves and restores the context for every node, converts resolved
RGB/alpha values into Canvas paint state, and paints fill and stroke only when
the corresponding resolved color exists.

`packages/editor/src/thumbnail-worker.ts` remains responsible for request
lifecycle, page-to-viewport mapping, diagnostics, and ordering. During its
single node loop it dispatches shapes to `paintShapeNode`, images to the
existing image loader/painter, and other node kinds to the existing skip path.
Shape drawing is isolated in the same per-node `try/catch` as image drawing:
one malformed path or Canvas failure produces a `draw-failed` issue for that
node and does not prevent later nodes from being painted.

The existing thumbnail protocol needs no new message or result fields. Shape
IDs are included in `drawnNodeIds` when successfully painted and in
`skippedNodeIds` with a structured issue when painting fails. Shape failures do
not create resource requests or affect the asset cache.

## Rendering Semantics

1. The worker keeps its existing viewport normalization and aspect-preserving
   page mapping.
2. For each shape, it saves the context and applies the page mapping to every
   path coordinate. The path commands are interpreted in scene/page EMU-like
   coordinates; arcs use the stored center, radii, start angle, and end angle.
3. A resolved color with `rgb: 'RRGGBB'` is painted as `#RRGGBB`. Its alpha is
   normalized from the model's `0..100000` range to Canvas `globalAlpha`.
   Invalid or out-of-range values produce a node-level draw failure rather
   than silently painting an unexpected color.
4. If a fill color exists, the completed path is filled. If a stroke color
   exists, the completed path is stroked. The path is rebuilt before the second
   operation because Canvas fill/stroke do not consume the current path, and
   this keeps the helper deterministic for recording contexts.
5. Context state is restored in `finally`, including failures during path
   construction, fill, or stroke.
6. A shape with neither resolved fill nor resolved stroke is considered
   successfully processed but performs no paint operation; it is still listed
   in `drawnNodeIds` because the node itself was valid and did not fail.

## Error Handling

- Invalid path commands, non-finite coordinates, invalid RGB strings, and
  invalid alpha values throw from the shape helper.
- The worker catches those errors at node scope and records `draw-failed` with
  the shape ID and message.
- Cancellation and stale-request checks remain at the same boundaries as the
  image path: before each node and before publishing the final bitmap.
- A shape never invokes the resource bridge, even when adjacent image nodes
  do need assets.

## Testing

Focused unit coverage will verify:

- all four supported path command families reach the corresponding Canvas
  operations;
- page coordinates are mapped into explicit thumbnail pixel bounds;
- fill/stroke colors and normalized alpha are applied and context state is
  restored;
- transparent/no-paint shapes remain successful without drawing;
- shape and image nodes are painted in graph order;
- a shape draw failure is isolated and later nodes still render;
- shape rendering emits no resource request.

Existing image-only worker, protocol, renderer, and Vue host tests remain
unchanged except where their node-order fixtures need to include a shape. The
repository's focused tests, boundary checks, typecheck, build, and
Element-Plus scan remain the final verification gates.

## Non-Goals and Follow-Up

This slice deliberately does not implement text or table thumbnail painting,
gradient/pattern fills, configurable stroke widths/dashes, shape transforms,
or a second main-thread renderer. Those capabilities should receive separate
designs once basic shape painting is verified in the worker pipeline.
