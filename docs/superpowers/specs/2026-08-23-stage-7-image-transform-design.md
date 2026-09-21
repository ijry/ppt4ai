# Stage 7 Image Transform and Effects Design

> Status: Approved for implementation
> Date: 2026-08-23

## Goal

Preserve the first useful subset of OOXML picture transforms in the headless document model and render that subset deterministically in the browser Canvas renderer. This extends the existing image asset pipeline without moving browser concerns into `@ppt4ai/model`, `@ppt4ai/render`, or `@ppt4ai/pptx-import`.

## Scope

This slice covers:

- a reusable `ElementTransform` contract with rotation and horizontal/vertical flips;
- image `sourceCrop` percentages, preset geometry masks, and ordered basic effects;
- import of `a:xfrm`, `a:srcRect`, `a:prstGeom`, `a:alphaModFix`, and `a:grayscl`;
- clone-safe transform/crop/effect data on image SceneGraph nodes;
- Canvas rotation, flips, clipping, source cropping, opacity, and grayscale drawing.

This slice does not cover image editing commands, crop/rotation handles, insertion or replacement UI, thumbnails, worker rendering, or PPTX media writeback. Existing source-package writeback continues to preserve untouched image parts and relationships.

## Model Contract

`ElementTransform` is reusable by future element kinds while each element keeps its existing EMU `bounds`:

```ts
export interface ElementTransform {
  rotation?: number // OOXML 1/60000 degree units, clockwise
  flipH?: boolean
  flipV?: boolean
}

export interface ImageCrop {
  left?: number
  top?: number
  right?: number
  bottom?: number
}

export type ImageEffect =
  | { type: 'alphaModFix'; amount: number }
  | { type: 'grayscl' }

export interface ImageElement {
  id: string
  kind: 'image'
  bounds: Rect
  assetId: string
  transform?: ElementTransform
  sourceCrop?: ImageCrop
  maskPreset?: PresetGeometry
  effects?: ImageEffect[]
  placeholder?: string
}
```

Crop and effect numeric values are normalized percentages in the inclusive range `0..100000`; invalid optional values are ignored. The model remains JSON-safe and must pass `structuredClone` without binary data or browser objects.

## Import Contract

The PPTX importer reads picture-local `a:xfrm` attributes `rot`, `flipH`, and `flipV`, converting only valid integer rotation values and explicit boolean flags. It reads `a:srcRect` attributes `l`, `t`, `r`, and `b` as percentages and keeps only valid values. It reads `a:prstGeom/@prst` and maps the existing `rect`, `roundRect`, `ellipse`, and `triangle` presets; unknown presets fall back to no mask while retaining the image.

The first effects are intentionally narrow. `alphaModFix/@amt` becomes an `alphaModFix` effect and `grayscl` becomes a `grayscl` effect. Optional or malformed effect fragments do not discard the picture, and source order for supported effects is preserved. Unsupported effects are ignored.

## SceneGraph Contract

`SceneImageNode` carries structured clones of the image transform, crop, mask, and effects. `documentToSceneGraph` does not resolve or execute effects and does not access DOM, Canvas, or browser globals. A missing asset metadata entry still produces a node with its transform data.

## Canvas Paint Order

Each image is painted inside its own `save()`/`restore()` scope:

1. translate to the image center and apply clockwise rotation;
2. apply horizontal and vertical flips around the image center;
3. clip to the supported preset mask path, if present;
4. apply source crop by converting normalized crop percentages to source pixels;
5. apply cumulative alpha modulation and grayscale effect state;
6. draw the cropped source into the image bounds.

The image renderer keeps graph order and isolates failures per node. A malformed crop is ignored, a missing/unsupported mask is skipped, and a Canvas operation failure produces the existing `draw-failed` diagnostic without aborting other images. The render result remains clone-safe.

## Verification

Tests cover model validation/clone safety, importer parsing and malformed optional fragments, SceneGraph preservation, Canvas transform operation order, source crop coordinates, masks, effects, failure isolation, and resource lifecycle. Existing boundary checks, type checks, build, full tests, and Element Plus dependency checks remain required. No new runtime dependency is introduced.
