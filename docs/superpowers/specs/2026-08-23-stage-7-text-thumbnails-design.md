# Stage 7 Text Thumbnail Design

> **Status:** Approved for implementation
> **Date:** 2026-08-23

## Goal

Extend the existing Worker/OffscreenCanvas thumbnail pipeline so
`SceneTextNode` objects appear in thumbnails using the deterministic layout
already produced by `@ppt4ai/text`, while preserving scene order, clone-safe
results, and the existing image resource bridge.

## Scope

This slice paints the text information already present in
`SceneTextNode.layout`:

- horizontal text runs;
- line markers;
- basic vertical text runs with `upright` and `rotated` orientation;
- run font family, size, bold, italic, underline, resolved color, and alpha.

The worker does not measure, wrap, shape, or reflow text. Line breaks, run
coordinates, content bounds, marker placement, and vertical orientation come
from the scene graph's precomputed layout. This keeps the worker deterministic
and avoids a second browser-font-dependent layout implementation.

Shapes, images, and text are painted in their original `SceneGraph.nodes`
order. Text never requests an asset. Tables, charts, groups, text outlines,
gradients, shadows, WordArt, and hyperlink interaction remain outside this
slice. No protocol field or runtime dependency is added; the editor runtime
remains Vue, Vue-I18n, and UnoCSS based.

## Architecture

`packages/editor/src/text-painting.ts` owns the Canvas translation of the
shared text layout protocol. It accepts a `SceneTextNode` plus the explicit
page-to-thumbnail mapping used by the worker. The helper validates layout and
style values, saves and restores context state, constructs Canvas font state,
maps page coordinates to thumbnail pixels, and paints markers and runs.

`packages/editor/src/thumbnail-worker.ts` remains responsible for request
lifecycle, page-to-viewport mapping, diagnostics, resource loading, and scene
order. Its existing node loop dispatches text to `paintTextNode`, shapes to
`paintShapeNode`, and images to the asset-backed image painter. Each dispatch
stays inside the existing per-node failure boundary so one invalid text node
does not prevent later nodes from rendering.

The thumbnail protocol remains unchanged. A successfully processed text node
is included in `drawnNodeIds`. A text failure adds the node to
`skippedNodeIds` and reports the existing `draw-failed` issue. Empty but valid
text layouts are successful even when they produce no `fillText` operation.

## Rendering Semantics

1. The worker keeps its existing aspect-preserving page mapping. Text layout
   coordinates are multiplied by the uniform page scale; viewport offsets are
   added only to positions. Canvas font pixels are calculated as
   `fontSize * 12700 * layout.fontScale / 100000 * pageScale`, matching the
   point-to-EMU and autofit scale already used by text layout.
2. Each run builds its Canvas `font` from `italic`, `bold`, the calculated
   pixel size, and `fontFamily`. Missing mark values use the layout contract's
   defaults of 18 points and Arial. Font family names are quoted and escaped so
   punctuation or spaces cannot corrupt the Canvas font string.
3. Canvas uses `textBaseline = 'top'` and `textAlign = 'left'`. Horizontal
   runs paint at their precomputed page `x` and line `y`; the worker does not
   infer baselines or recompute line height.
4. Run `resolvedColor` is converted from `RRGGBB` to `#RRGGBB`. Alpha is
   normalized from `0..100000` to Canvas `globalAlpha`. A run without a
   resolved color uses opaque black, matching the text model's default visual
   fallback rather than inheriting state from a prior node.
5. A line marker is painted before its runs. A horizontal marker uses its
   stored `x` and the containing line's `y`. A vertical marker uses its stored
   `x`, `y`, and orientation with the same upright/rotated rules as a run. Its
   own marks control font attributes. Because the current scene marker
   contract has no resolved color, the marker uses opaque black.
6. Underline is drawn as a Canvas line after the corresponding text. Its
   start and length use the run's precomputed `x` and `width`; its vertical
   position is the containing line's bottom minus 10% of its stored height.
   Its Canvas line width is the greater of one device pixel and 5% of the
   calculated font pixel size. Underline inherits the run color and alpha and
   never uses Canvas text measurement.
7. In vertical layout, an `upright` run paints at its stored `x` and `y`.
   A `rotated` run translates to the mapped top-right of its stored cell,
   rotates clockwise by 90 degrees, paints the text once at the transformed
   origin, and restores the context before the next run. Stored `width`,
   `height`, and orientation remain authoritative.
8. Empty strings and valid layouts with no lines perform no Canvas text calls
   but still count as successfully processed nodes.

## Validation and Error Handling

The text helper rejects non-finite positions, dimensions, font sizes, or page
mapping values. It also rejects invalid RGB strings, alpha values outside
`0..100000`, and unknown vertical orientations. Text content itself remains an
opaque string and is passed directly to Canvas.

The helper restores context state in `finally`, including failures during
font setup, transforms, `fillText`, or underline drawing. The worker catches
the error at node scope, reports `draw-failed` with the text node ID and error
message, then continues to the next scene node. Cancellation and stale-request
checks remain at the existing node and publication boundaries.

Text painting never invokes the resource bridge and never changes the asset
cache. Adjacent image nodes continue to request and reuse assets normally.

## Testing

Focused helper tests will verify:

- horizontal runs use precomputed positions without calling a measurement API;
- font family, scaled size, bold, italic, default values, color, and alpha map
  to Canvas state;
- line markers paint before their runs;
- underline placement uses stored run and line-box geometry;
- upright and rotated vertical runs use the expected local transforms;
- empty valid text nodes succeed without `fillText`;
- invalid coordinates, colors, alpha, or orientation restore context and fail
  deterministically.

Worker tests will verify:

- shape, image, and text nodes retain scene order;
- successful text nodes appear in `drawnNodeIds`;
- a text draw failure is isolated and later nodes still render;
- text rendering emits no resource request.

The final verification gates are focused tests, the full workspace test suite,
package boundary checks, recursive typecheck, recursive build,
`git diff --check`, and the Element Plus dependency scan.

## Non-Goals and Follow-Up

This slice deliberately does not add browser font loading or font embedding,
Canvas text measurement, alternate line breaking, text outline/gradient,
shadow, WordArt, advanced OpenType shaping, editable hyperlink behavior, or
table/chart/group thumbnail rendering. Font availability can affect glyph
appearance, but it must not affect layout coordinates because the scene layout
remains authoritative. Any future font-loading strategy or advanced text
effects require separate designs.
