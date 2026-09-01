# Standalone PPTX Generation Implementation Plan

> **状态：已实现（2026-09-01 核实）。** 下方复选框未回填，勿据此判断为待办 —— `createPptx` 已在 `packages/pptx-export/src/standalone.ts` 落地，里程碑见 `进度.md`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic `createPptx` generator for source-less `Ppt4aiDocument` values while preserving the existing source-package write-back API.

**Architecture:** Keep standalone generation in `@ppt4ai/pptx-export`. Build a fixed OPC package from pure XML serializers and the existing stored ZIP writer, with one generated theme/master/layout and one slide part per `slideOrder` item. Materialize image assets once before assembly, then connect each slide-local picture relationship to the shared media part.

**Tech Stack:** TypeScript 6, Vitest 4, browser-compatible `Uint8Array`, existing ZIP writer, `@ppt4ai/model` validation and bitmap metadata parser, existing table and image serializers.

**Spec:** `docs/superpowers/specs/2026-08-31-pptx-standalone-generation-design.md`

## Global Constraints

- Keep `@ppt4ai/pptx-export` headless; do not add Vue, DOM, Canvas, Element Plus, runtime CSS, or runtime dependencies.
- Add `createPptx(document: Ppt4aiDocument, options?: CreatePptxOptions): Promise<Uint8Array>` and leave `exportPptx(document, source, options?)` unchanged.
- Validate the document before any asset adapter read; do not mutate the document or call `AssetAdapter.put`.
- Use fixed XML namespace/attribute order, stable IDs, stable entry order, and no runtime timestamps.
- Generate one shared theme/master/layout and support top-level `shape`, `text`, `table`, and `image` elements in document order.
- Reject `group` and unsupported XML control characters with the specified `PPTX generation ...` error prefix.
- Read each asset ID at most once, copy returned bytes, validate metadata/MIME, and deduplicate its media part.
- Every task ends with focused verification and its own commit; the progress document is a separate final documentation commit.
- Follow strict TDD: write and observe a failing test before each production behavior.

---

### Task 1: Add the standalone package skeleton

**Files:**
- Create: `packages/pptx-export/src/standalone.ts`
- Create: `packages/pptx-export/src/standalone-xml.ts`
- Create: `packages/pptx-export/src/standalone.test.ts`
- Modify: `packages/pptx-export/src/index.ts`

**Interfaces:**
- Consumes: `Ppt4aiDocument`, `AssetAdapter`, `ZipEntry`, `writeStoredZip`, and the existing model validator.
- Produces: `CreatePptxOptions` and `createPptx(document, options?)` from `@ppt4ai/pptx-export`.

- [ ] **Step 1: Write the failing skeleton test**

Add a local empty-document fixture and assert that generation is deterministic, structurally complete, and importable:

```ts
const emptyDocument: Ppt4aiDocument = {
  format: 'ppt4ai',
  version: 1,
  id: 'dck_standalone',
  page: { w: 12192000, h: 6858000 },
  slides: { sld_1: { id: 'sld_1', elementIds: [] } },
  elements: {},
  slideOrder: ['sld_1'],
}

it('creates a deterministic importable OPC skeleton without source bytes', async () => {
  const first = await createPptx(emptyDocument)
  const second = await createPptx(structuredClone(emptyDocument))
  const entries = await packageEntries(first)
  const imported = await importPptx(first)

  expect(first).toEqual(second)
  expect([...entries.keys()]).toEqual([
    '[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'docProps/app.xml',
    'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', 'ppt/presProps.xml',
    'ppt/viewProps.xml', 'ppt/theme/theme1.xml', 'ppt/slideMasters/slideMaster1.xml',
    'ppt/slideMasters/_rels/slideMaster1.xml.rels', 'ppt/slideLayouts/slideLayout1.xml',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels', 'ppt/slides/slide1.xml',
    'ppt/slides/_rels/slide1.xml.rels',
  ])
  expect(imported.page).toEqual(emptyDocument.page)
  expect(imported.slideOrder).toEqual(['sld_1'])
  expect(imported.slides.sld_1?.elementIds).toEqual([])
})
```

Reuse a small `packageEntries` helper in this test file that maps `readZipEntries(bytes)` to a `Map<string, Uint8Array>`, matching the existing write-back tests.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
pnpm exec vitest run packages/pptx-export/src/standalone.test.ts
```

Expected result: the suite fails because `createPptx` is not exported yet.

- [ ] **Step 3: Implement the minimal skeleton**

In `standalone-xml.ts`, add pure serializers with these exact responsibilities:

- `serializeContentTypesXml(slideCount: number, imageExtensions: Set<string>): string`
- `serializeRootRelationshipsXml(): string`
- `serializePresentationXml(page: Pick<Rect, 'w' | 'h'>, slideCount: number): string`
- `serializePresentationRelationshipsXml(slideCount: number): string`
- `serializeCorePropertiesXml(): string`
- `serializeAppPropertiesXml(): string`
- `serializePresentationSupportXml(): { presProps: string; viewProps: string }`
- `serializeThemeXml(): string`
- `serializeMasterXml(): string`
- `serializeMasterRelationshipsXml(): string`
- `serializeLayoutXml(): string`
- `serializeLayoutRelationshipsXml(): string`
- `serializeEmptySlideXml(): string`
- `serializeLayoutSlideRelationshipsXml(): string`

Use the standard PresentationML/DrawingML/Relationships/Content Types namespaces, fixed XML strings for core/app/support/theme parts, `256 + index` for slide IDs, `rId1` for the master relationship, `rId2` for the theme relationship, and `rId3 + index` for slide relationships. The generated presentation must include `p:sldSz`, one `p:sldMasterId`, and a non-empty `p:sldIdLst`.

In `standalone.ts`, call `validateDocument`, reject with `PPTX generation document invalid: ...` on failure, serialize one empty slide per `slideOrder` item, and pass the fixed entry list to `writeStoredZip`. Keep `sld_1`, `sld_2`, ... as the generated model/test convention after re-import; write numeric `p:sldId/@id` values `256`, `257`, ... to XML, and do not modify the input object.

Export `CreatePptxOptions` and `createPptx` from `src/index.ts` while retaining all existing exports.

- [ ] **Step 4: Run the focused test and package checks**

Run:

```bash
pnpm exec vitest run packages/pptx-export/src/standalone.test.ts
pnpm --filter @ppt4ai/pptx-export typecheck
pnpm --filter @ppt4ai/pptx-export build
```

Expected result: the skeleton test and package checks pass with no warnings.

- [ ] **Step 5: Commit the skeleton**

```bash
git add packages/pptx-export/src/standalone.ts packages/pptx-export/src/standalone-xml.ts packages/pptx-export/src/standalone.test.ts packages/pptx-export/src/index.ts
git commit -m "feat: add standalone pptx package skeleton"
```

### Task 2: Serialize shapes and text

**Files:**
- Modify: `packages/pptx-export/src/standalone-xml.ts`
- Modify: `packages/pptx-export/src/standalone.ts`
- Modify: `packages/pptx-export/src/standalone.test.ts`

**Interfaces:**
- Consumes: the Task 1 package skeleton and `ShapeElement`/`TextElement`/`TextBody` model values.
- Produces: deterministic `p:sp` serialization for top-level shape and text elements, including text layout fields.

- [ ] **Step 1: Write the failing shape/text tests**

Extend the fixture with one filled/stroked shape and one text element containing escaped text, a newline, marks, alignment, and a character bullet. Assert the generated XML contains the expected `a:xfrm`, geometry, fill, line, `a:bodyPr`, `a:pPr`, `a:buChar`, escaped text, and `a:br`; re-import and assert bounds and normalized text; assert repeated generation remains byte-identical.

Use assertions of this form so the test observes behavior rather than helper internals:

```ts
expect(slideXml).toContain('<a:off x="1000000" y="500000"/>')
expect(slideXml).toContain('<a:prstGeom prst="roundRect">')
expect(slideXml).toContain('<a:t xml:space="preserve">Hello &amp; </a:t>')
expect(slideXml).toContain('<a:br/>')
expect(slideXml).toContain('<a:buChar char="\u2022"/>')
const importedIds = imported.slides.sld_1?.elementIds ?? []
expect(imported.elements[importedIds[0] ?? '']).toMatchObject({ kind: 'shape', bounds: shape.bounds })
expect(imported.elements[importedIds[1] ?? '']).toMatchObject({ kind: 'text', text: 'Hello & World' })
```

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
pnpm exec vitest run packages/pptx-export/src/standalone.test.ts
```

Expected result: the new assertions fail because the generated slide still contains only an empty shape tree.

- [ ] **Step 3: Implement shape and text XML serializers**

Add these pure functions to `standalone-xml.ts`:

- `serializeColorXml(color: Color): string` and `serializeFillXml(fill?: Fill): string` with ordered transforms and explicit system-color fallback;
- `serializeShapeXml(element: ShapeElement | TextElement, shapeId: number): string` with `p:nvSpPr`, optional `p:ph`, `p:spPr`, `a:xfrm`, preset geometry, fill, and `a:ln`;
- `serializeTextBodyXml(body: TextBody): string` with body properties, paragraphs, bullets, runs, marks, and XML-safe text;
- `serializeSlideXml(elements: string[]): string` that places serialized elements after the required group properties.

Use `element.body` when present and otherwise convert legacy `TextElement.text` to one paragraph with one run. Serialize a text shape with `rect` geometry. Map `verticalAlign`, `vertical`, `wrap`, and autofit exactly as specified in the design. Map paragraph alignment, level, margins, indentation, line spacing, and paragraph spacing to `a:pPr`. Map `char`, `arabic`, `alphaLower`, and `alphaUpper` bullets to `a:buChar` or `a:buAutoNum`.

Split run text on `\n`, emit text fragments and `a:br` as ordered siblings under `a:p`, and add `xml:space="preserve"` when a fragment begins or ends with XML whitespace. Reject XML 1.0 control characters other than tab, newline, and carriage return with `PPTX generation unsupported XML control character`.

Update `standalone.ts` to map each slide's `elementIds` in order, assign per-slide shape IDs beginning at `2`, and insert the resulting XML into the skeleton slide. Reject a missing element mapping with `PPTX generation element mapping missing for slide <id>`.

- [ ] **Step 4: Run focused tests and checks**

Run:

```bash
pnpm exec vitest run packages/pptx-export/src/standalone.test.ts
pnpm --filter @ppt4ai/pptx-export typecheck
```

Expected result: all standalone tests pass and the package typechecks.

- [ ] **Step 5: Commit shape/text support**

```bash
git add packages/pptx-export/src/standalone.ts packages/pptx-export/src/standalone-xml.ts packages/pptx-export/src/standalone.test.ts
git commit -m "feat: serialize standalone pptx shapes and text"
```

### Task 3: Add standalone table frames

**Files:**
- Modify: `packages/pptx-export/src/standalone-xml.ts`
- Modify: `packages/pptx-export/src/standalone.ts`
- Modify: `packages/pptx-export/src/standalone.test.ts`

**Interfaces:**
- Consumes: `TableElement` values and the existing `serializeTableXml(table)` function.
- Produces: a deterministic `p:graphicFrame` containing a valid table payload in the generated slide shape tree.

- [ ] **Step 1: Write the failing table round-trip test**

Add a two-column, two-row table with a `colSpan`, a vertical continuation, cell text, fill, and borders to the standalone fixture. Generate and assert the slide contains the table graphic-data URI and serialized grid/merge attributes; re-import and assert columns, row count, cell text, and spans match the source table.

```ts
expect(slideXml).toContain('uri="http://schemas.openxmlformats.org/drawingml/2006/table"')
expect(slideXml).toContain('gridSpan="2"')
expect(slideXml).toContain('vMerge="1"')
const importedTableId = imported.slides.sld_1?.elementIds[0] ?? ''
expect(imported.elements[importedTableId]).toMatchObject({ kind: 'table', columns: table.columns })
```

- [ ] **Step 2: Run the focused test to verify RED**

Run `pnpm exec vitest run packages/pptx-export/src/standalone.test.ts`. Expected result: the table assertions fail because table elements are not yet serialized.

- [ ] **Step 3: Implement the table frame wrapper**

Add `serializeTableFrameXml(table: TableElement, shapeId: number): string` to `standalone-xml.ts`. Emit `p:nvGraphicFramePr`, `p:xfrm` using table bounds, and `a:graphic/a:graphicData` with the exact table URI and `serializeTableXml(table)` payload. Update slide element dispatch to call this function for `kind === 'table'`; keep shape IDs sequential across shape, text, and table elements.

- [ ] **Step 4: Run focused tests and checks**

Run:

```bash
pnpm exec vitest run packages/pptx-export/src/standalone.test.ts packages/pptx-export/src/table.test.ts
pnpm --filter @ppt4ai/pptx-export typecheck
pnpm --filter @ppt4ai/pptx-export build
```

Expected result: standalone and existing table tests pass.

- [ ] **Step 5: Commit table support**

```bash
git add packages/pptx-export/src/standalone.ts packages/pptx-export/src/standalone-xml.ts packages/pptx-export/src/standalone.test.ts
git commit -m "feat: serialize standalone pptx tables"
```

### Task 4: Materialize images and finalize standalone validation

**Files:**
- Modify: `packages/pptx-export/src/standalone.ts`
- Modify: `packages/pptx-export/src/standalone-xml.ts`
- Modify: `packages/pptx-export/src/standalone.test.ts`

**Interfaces:**
- Consumes: `CreatePptxOptions.assetAdapter`, `AssetMetadata`, `ImageElement`, `parseBitmapMetadata`, `allocateMediaPath`, `serializePictureXml`, and `serializeImageRelationship`.
- Produces: shared media entries, per-slide image relationships, image content-type defaults, adapter deduplication, and stable standalone errors.

- [ ] **Step 1: Write failing image and rejection tests**

Create two slides that reference the same PNG asset and one JPEG asset. Use a recording adapter and assert generation reads each asset ID once, emits one media entry per asset, puts each slide picture relationship at the expected relative target, and re-imports image metadata. Also add tests for:

- an image without `assetAdapter`, expecting `PPTX generation asset adapter missing: <id>`;
- missing metadata, missing bytes, and MIME mismatch, each with the asset ID in the error;
- a `group` element, expecting `PPTX generation unsupported element kind: group`;
- an invalid `slideOrder` mapping, expecting validation failure before any adapter request;
- a control character in a text run, expecting the XML-control-character error;
- document and adapter byte snapshots remaining unchanged after success and rejection.

Run the new tests before production changes so they fail for the absent media and validation behavior.

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

```bash
pnpm exec vitest run packages/pptx-export/src/standalone.test.ts
```

Expected result: image package assertions and new rejection assertions fail for the unimplemented paths.

- [ ] **Step 3: Implement deterministic asset materialization and validation**

In `standalone.ts`, validate the document first, then walk `slideOrder` and `elementIds`. For every image, require metadata at `document.assets[assetId]`, call `assetAdapter.get(assetId)` once per distinct ID, copy the returned bytes, verify `parseBitmapMetadata(bytes)?.mimeType === metadata.mimeType`, and allocate `ppt/media/imageN.<ext>` with `allocateMediaPath`. Keep a map from asset ID to `{ path, bytes }` and a per-slide map from media path to its slide-local relationship ID.

For each slide, emit `rId1` for the generated layout and allocate image relationship IDs from `rId2` upward. Use `serializePictureXml(element, relationshipId, shapeId)` and `serializeImageRelationship(relationshipId, "../media/" + filename)`. Append media entries after all slide relationship entries. Pass the used image extensions to `serializeContentTypesXml` so each extension has one matching `Default`.

Add standalone dispatch for `kind === 'image'`; throw the exact group error for `kind === 'group'` and a stable unsupported-kind error for any future kind. Ensure all validation and asset reads happen before calling `writeStoredZip`, and never mutate model or adapter-owned arrays.

- [ ] **Step 4: Run focused tests and package checks**

Run:

```bash
pnpm exec vitest run packages/pptx-export/src/standalone.test.ts packages/pptx-export/src/image-writeback.test.ts packages/pptx-export/src/table.test.ts
pnpm --filter @ppt4ai/pptx-export typecheck
pnpm --filter @ppt4ai/pptx-export build
git diff --check
```

Expected result: all focused tests and checks pass.

- [ ] **Step 5: Commit image and validation support**

```bash
git add packages/pptx-export/src/standalone.ts packages/pptx-export/src/standalone-xml.ts packages/pptx-export/src/standalone.test.ts
git commit -m "feat: generate standalone pptx images"
```

### Task 5: Run repository verification and record the milestone

**Files:**
- Modify: `进度.md`

**Interfaces:**
- Consumes: the completed standalone generator and its focused tests.
- Produces: a dated progress entry and an updated next-work section; no runtime code changes.

- [ ] **Step 1: Run focused package verification**

Run:

```bash
pnpm exec vitest run packages/pptx-export/src packages/pptx-import/src/importer.test.ts packages/model/src/model.test.ts
```

Confirm the standalone topology, shape/text/table/image round trips, error cases, source write-back tests, importer provenance tests, and model validation tests all pass.

- [ ] **Step 2: Run repository verification**

Run:

```bash
pnpm test -- --pool=threads --maxWorkers=1
pnpm check:boundaries
pnpm typecheck
pnpm --workspace-concurrency=1 build
rg -n "element-plus|Element Plus" packages apps package.json pnpm-lock.yaml
git diff --check
```

The Element Plus search must return no matches. If the host system's temporary directory is out of space, set `TEMP` and `TMP` to an explicitly created directory on a volume with free space for the verification commands; do not alter source files or dependencies to work around that environment issue.

- [ ] **Step 3: Update the progress record**

Add a dated entry stating that source-less deterministic PPTX package generation now covers the fixed OPC skeleton, shared theme/master/layout, shape/text/table/image serialization, asset deduplication, re-import validation, and stable errors. Record the focused and full test counts and the implementation commit IDs. Keep PowerPoint/LibreOffice manual-open validation, custom master/layout serialization, group/chart/animation support, and source-dependent package preservation explicitly pending. Update the next-work section to the next highest-value export or reader-validation slice.

- [ ] **Step 4: Commit the progress record**

```bash
git add 进度.md
git commit -m "docs: record standalone pptx generation milestone"
```
