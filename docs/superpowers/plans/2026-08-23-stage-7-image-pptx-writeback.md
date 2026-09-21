# Stage 7 PPTX Image Writeback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write inserted and replaced image assets into source PPTX media parts, slide relationships, and `p:pic` XML while preserving unrelated package data.

**Architecture:** Keep `exportPptx(document, source)` backward compatible and add optional `ExportPptxOptions.assetAdapter`. Isolate MIME-to-extension, relationship/media allocation, XML generation, and source-image mapping in a focused image writeback module; the existing writeback coordinator applies its returned XML and ZIP entry mutations only after all asset bytes and validations succeed.

**Tech Stack:** TypeScript, existing XML scanner, stored ZIP reader/writer, `Uint8Array`, Vitest, `@ppt4ai/model`.

## Global Constraints

- Keep the document JSON-safe and never store image bytes in `Ppt4aiDocument`.
- Preserve `exportPptx(document, source)` and add only an optional third options argument.
- Read new/replacement bytes through `AssetAdapter.get()`; never mutate adapter storage.
- Preserve unrelated ZIP entries, source XML, existing media, and existing relationships.
- Use deterministic first-free `imageN.<ext>` media names and first-free `rIdN` relationship IDs.
- Existing source elements must remain an ordered prefix; only trailing inserted image elements are supported.
- Existing image appearance XML is preserved except for its `r:embed` attribute.
- Do not add Element Plus, DOM, Canvas, or runtime dependencies.
- Each completed task ends with focused verification and its own git commit.

---

### Task 1: Define Image XML and Allocation Helpers

**Files:**
- Create: `packages/pptx-export/src/image-writeback.ts`
- Create: `packages/pptx-export/src/image-writeback.test.ts`
- Modify: `packages/pptx-export/src/index.ts`

**Interfaces:**
- Consumes: `ImageElement`, `AssetMetadata`, `AssetAdapter`, `ZipEntry` and the existing XML scanner helpers' behavior.
- Produces: internal pure helpers for MIME extension selection, stable asset IDs, first-free media/relationship allocation, relationship XML, `p:pic` XML, and source `r:embed` replacement.

- [ ] **Step 1: Write failing tests for pure image writeback helpers**

Cover these exact behaviors:

```ts
it('maps supported MIME types to deterministic media extensions', () => {
  expect(imageExtension('image/png')).toBe('png')
  expect(imageExtension('image/jpeg')).toBe('jpg')
  expect(imageExtension('image/gif')).toBe('gif')
  expect(imageExtension('image/bmp')).toBe('bmp')
  expect(imageExtension('image/webp')).toBe('webp')
})

it('allocates first-free media names and relationship IDs', () => {
  const entries = new Set(['ppt/media/image1.png', 'ppt/media/image3.jpg'])
  expect(allocateMediaPath(entries, 'image/png')).toBe('ppt/media/image2.png')
  expect(allocateRelationshipId(new Set(['rId1', 'rId3']))).toBe('rId2')
})

it('generates clone-safe picture XML from image appearance', () => {
  expect(serializePictureXml(image, 'rId7', 42)).toContain(
    '<a:off x="10" y="20"/><a:ext cx="300" cy="400"/>',
  )
  expect(serializePictureXml(image, 'rId7', 42)).toContain('<a:blip r:embed="rId7"/>')
})

it('replaces only the embedded relationship in existing picture XML', () => {
  const xml = '<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>'
  expect(replacePictureRelationship(xml, 'rId8')).toBe(
    '<p:pic><p:blipFill><a:blip r:embed="rId8"/></p:blipFill></p:pic>',
  )
})
```

Assert unsupported MIME and missing `a:blip` reject with deterministic errors; assert helpers do not mutate image objects or entry sets.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `pnpm exec vitest run packages/pptx-export/src/image-writeback.test.ts`

Expected: FAIL because the new module and exports do not exist.

- [ ] **Step 3: Implement the pure helpers**

Implement exported testable functions with exact signatures:

```ts
export function imageExtension(mimeType: ImageMimeType): string
export function stableAssetId(mediaPath: string): string
export function allocateMediaPath(entryNames: Set<string>, mimeType: ImageMimeType): string
export function allocateRelationshipId(ids: Set<string>): string
export function serializePictureXml(element: ImageElement, relationshipId: string, shapeId: number): string
export function serializeImageRelationship(id: string, target: string): string
export function replacePictureRelationship(xml: string, relationshipId: string): string
```

Use integer EMU attributes, escaped XML attributes, supported transforms/crops/masks/effects, and no byte or DOM dependency. Preserve effect order from `element.effects`.

- [ ] **Step 4: Run helper tests and package typecheck**

Run: `pnpm exec vitest run packages/pptx-export/src/image-writeback.test.ts && pnpm --filter @ppt4ai/pptx-export typecheck`

Expected: all helper tests PASS and typecheck exits successfully.

- [ ] **Step 5: Commit the helper slice**

```powershell
git add packages/pptx-export/src/image-writeback.ts packages/pptx-export/src/image-writeback.test.ts packages/pptx-export/src/index.ts
git commit -m "feat: add pptx image xml helpers"
```

---

### Task 2: Integrate Image Media, Relationships, and Slide Writeback

**Files:**
- Modify: `packages/pptx-export/src/writeback.ts`
- Modify: `packages/pptx-export/src/index.ts`
- Modify: `packages/pptx-export/src/writeback.test.ts`

**Interfaces:**
- Consumes: `exportPptx(document, source, options?)`, Task 1 helpers, existing table replacement, and `AssetAdapter.get()`.
- Produces: deterministic image replacement/insertion in source PPTX packages with atomic validation and unchanged legacy table behavior.

- [ ] **Step 1: Add failing writeback tests**

Extend a source fixture with one valid `p:pic`, its slide relationship, and a PNG media entry. Add tests that assert:

```ts
it('preserves an unchanged source image and its bytes', async () => {
  const output = await exportPptx(imported, source)
  expect(output).toEqual(source)
})

it('writes a replaced image through the adapter and updates only its embed', async () => {
  const output = await exportPptx(documentWithReplacement, source, { assetAdapter })
  expect(adapter.requests).toEqual(['asset_new'])
  expect(media(output, 'ppt/media/image2.jpg')).toEqual(jpegBytes)
  expect(slideXml(output)).toContain('<a:blip r:embed="rId3"/>')
})

it('appends a trailing inserted image and reuses one new media part', async () => {
  const output = await exportPptx(documentWithTwoInsertedReferences, source, { assetAdapter })
  expect(mediaNames(output)).toContain('ppt/media/image2.png')
  expect(slideXml(output)).toContain('<p:pic>')
  expect(adapter.requests).toEqual(['asset_new'])
})
```

Also assert missing adapter bytes, unsupported source relationships, element prefix/reordering mismatch, and non-image trailing additions reject while `document`, `source`, and adapter state remain unchanged.

- [ ] **Step 2: Run writeback tests to verify failure**

Run: `pnpm exec vitest run packages/pptx-export/src/writeback.test.ts`

Expected: new image tests FAIL while existing table tests remain green.

- [ ] **Step 3: Implement source image mapping and relationship updates**

Refactor the shared slide scanner to include only source elements the importer would keep: bounded `p:sp`, valid table `graphicFrame`, and `p:pic` with a resolvable image relationship and source media. Validate the document element IDs as an ordered source prefix, then classify trailing elements.

For each existing image, resolve its current asset ID to the source media target. Reuse that target when unchanged; otherwise fetch bytes, allocate one media target per asset ID, append one relationship, and replace the source picture's `r:embed`. For trailing images, fetch/deduplicate bytes by asset ID, allocate media and `rId`, append relationship XML, and append generated `p:pic` before `</p:spTree>`. Keep all changes in local `ZipEntry[]` and XML strings until validation and all adapter reads succeed.

- [ ] **Step 4: Implement optional relationship-part creation and ZIP media insertion**

When a slide relationship part is absent, create its standard path and XML root; otherwise append new relationships before the root close. Add new media entries after existing entries in deterministic first-use order. Reject an existing target collision whose bytes differ from the requested bytes.

- [ ] **Step 5: Run focused writeback, import, and export regression tests**

Run: `pnpm exec vitest run packages/pptx-export/src/writeback.test.ts packages/pptx-export/src/image-writeback.test.ts packages/pptx-import/src/importer.test.ts`

Expected: all image and existing table/import tests PASS, including deterministic repeated export and clone-safe document assertions.

- [ ] **Step 6: Typecheck and commit integration**

Run: `pnpm --filter @ppt4ai/pptx-export typecheck && git diff --check`

```powershell
git add packages/pptx-export/src/writeback.ts packages/pptx-export/src/writeback.test.ts packages/pptx-export/src/index.ts
git commit -m "feat: write images into pptx packages"
```

---

### Task 3: Record and Verify the Image Writeback Milestone

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: the image XML helper and package writeback integration.
- Produces: a verified handoff to the UnoCSS-only asset management UI.

- [ ] **Step 1: Update the stage record**

Record image media, relationship, replacement, insertion, adapter lookup, and source package preservation as complete. Keep asset-management UI and deferred thumbnail painting explicitly unchecked.

- [ ] **Step 2: Run repository gates**

Run:

```powershell
pnpm check:boundaries
pnpm test
pnpm typecheck
pnpm build
git diff --check
rg -n "element-plus|ElementPlus|@element-plus" package.json pnpm-lock.yaml packages apps
```

Expected: all commands pass and the Element Plus scan reports no matches.

- [ ] **Step 3: Commit the milestone record**

```powershell
git add 进度.md
git commit -m "docs: record image pptx writeback"
```

## Plan Self-Review

- The public API is backward compatible and uses the existing `AssetAdapter.get` contract.
- Existing source entries are preserved and all new bytes remain outside the document model.
- Existing image appearance, table XML writeback, and unrelated ZIP data are covered.
- Mapping limitations are explicit: source elements are an ordered prefix and only trailing image additions are supported.
- Missing media, relationship, adapter, MIME, and mapping failures occur before an output package is returned.
- No step introduces Element Plus, DOM, Canvas, or an undefined dependency.
