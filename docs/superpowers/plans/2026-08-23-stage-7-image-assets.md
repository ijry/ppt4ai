# Stage 7 Image Asset Foundation Implementation Plan

> **Goal:** Add headless bitmap asset references, PPTX picture import, and deterministic SceneGraph image nodes without placing binary data in document JSON.

## Constraints

- Keep `@ppt4ai/model`, `@ppt4ai/pptx-import`, and `@ppt4ai/render` free of Vue, DOM, Canvas, browser globals, Element Plus, and new runtime dependencies.
- Keep `Ppt4aiDocument` and SceneGraph `structuredClone` safe; image bytes live only behind `AssetAdapter`.
- Preserve existing `importPptx(input)` callers by making importer options optional.
- Preserve source-package writeback and deterministic element ordering.
- Skip only an invalid picture when its bounds, relationship, media entry, or bitmap header is unusable.
- Use test-driven development and commit every independently verified task.

## Task 1: Add the model and adapter contracts

**Files:**
- Modify: `packages/model/src/model.test.ts`
- Modify: `packages/model/src/index.ts`

1. Add failing tests for valid image elements and asset metadata.
2. Add failing validation tests for mismatched IDs, unsupported MIME types, invalid dimensions, missing assets, and invalid image bounds.
3. Run `pnpm --filter @ppt4ai/model test` and confirm the focused tests fail for missing contracts.
4. Add `ImageMimeType`, `AssetMetadata`, `AssetAdapter`, and `ImageElement`.
5. Extend `Element` and add optional `Ppt4aiDocument.assets`.
6. Validate asset-map keys, MIME types, optional dimensions and filenames, plus image-to-asset references.
7. Run model tests and `pnpm --filter @ppt4ai/model typecheck`.
8. Commit as `feat: add image asset model`.

## Task 2: Import bitmap picture assets

**Files:**
- Modify: `packages/pptx-import/src/importer.test.ts`
- Modify: `packages/pptx-import/src/importer.ts`
- Modify: `packages/pptx-import/src/index.ts`

1. Add failing PPTX fixture tests for `p:pic`, element ordering, stable asset IDs, metadata, exact adapter bytes, and duplicate media references.
2. Add failing resilience tests for missing relationships, missing media, unsupported media, malformed headers, and missing bounds while preserving neighboring elements.
3. Run `pnpm --filter @ppt4ai/pptx-import test` and confirm the new tests fail.
4. Add optional `ImportPptxOptions` with `assetAdapter`.
5. Discover ordinary `p:pic` nodes in slide element order and resolve `a:blip r:embed` through slide relationships.
6. Normalize relationship targets and derive deterministic asset IDs such as `asset_ppt_media_image1_png`.
7. Detect PNG, JPEG, GIF, BMP, and WebP by media bytes; parse pixel dimensions from their standard headers.
8. Store copied original bytes once per unique asset through the adapter and omit `assets` when none import successfully.
9. Run importer tests and `pnpm --filter @ppt4ai/pptx-import typecheck`.
10. Commit as `feat: import pptx bitmap assets`.

## Task 3: Emit image SceneGraph nodes

**Files:**
- Modify: `packages/render/src/scene.test.ts`
- Modify: `packages/render/src/scenegraph.ts`
- Modify: `packages/render/src/index.ts`

1. Add failing tests for image node bounds, asset references, metadata lookup, node ordering, and clone safety.
2. Run `pnpm --filter @ppt4ai/render test` and confirm the new tests fail.
3. Add exported `SceneImageNode` with `id`, `kind`, `bounds`, `assetId`, and optional metadata.
4. Extend `SceneNode` and emit image nodes without fetching or decoding bytes.
5. Run render tests and `pnpm --filter @ppt4ai/render typecheck`.
6. Commit as `feat: add image scene nodes`.

## Task 4: Record and verify the milestone

**Files:**
- Modify: `进度.md`

1. Record the completed image asset foundation and explicitly deferred image features.
2. Run focused tests for model, importer, and render.
3. Run `pnpm check:boundaries`, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.
4. Commit as `docs: record image asset foundation`.

## Acceptance Checks

- A valid ordinary bitmap imports as an image element with a stable asset reference.
- The optional adapter receives an exact copied `Uint8Array` once per unique media part.
- Invalid or unsupported pictures do not remove neighboring slide elements.
- Image document data and SceneGraph output survive `structuredClone`.
- Existing import, table writeback, text, engine, and render behavior remains green.
