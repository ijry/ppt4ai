# PPTX Master and Layout Write-back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve imported master/layout source parts and selectively write placeholder defaults and color-map edits back into an imported PPTX.

**Architecture:** Add JSON-safe source bindings to the model and populate them during relationship traversal. A focused exporter range writer patches existing placeholder shapes and mapping attributes in place, while `exportPptx` coordinates deterministic master/layout/theme/slide updates over the existing ZIP entry map.

**Tech Stack:** TypeScript 6, Vitest 4, pnpm workspace, existing XML range scanner and browser-safe stored/deflate ZIP utilities.

**Spec:** `docs/superpowers/specs/2026-08-31-pptx-master-layout-writeback-design.md`

## Global Constraints

- Keep all model/source metadata JSON-safe and `structuredClone`-safe.
- Preserve unknown XML, attributes, child order, unrelated ZIP entries, and source entry order outside deliberate replacements.
- Do not import `@ppt4ai/pptx-import` from exporter runtime code.
- Do not add Element Plus, Vue, DOM, Canvas, or any new runtime dependency to headless packages.
- Omitted sparse fields and map keys are non-destructive; creation/deletion of placeholder shapes and explicit map deletion are out of scope.
- Every production behavior starts with an observed failing test and ends with focused green verification.
- Commit each independently verified task, then commit the progress record separately.

---

### Task 1: Bind Master and Layout Source Parts

**Files:**
- Modify: `packages/model/src/index.ts`
- Modify: `packages/pptx-import/src/importer.ts`
- Test: `packages/model/src/model.test.ts`
- Test: `packages/pptx-import/src/importer.test.ts`

**Interfaces:**
- Produces `SlideMasterSource` and `SlideLayoutSource`, each with `partPath: string`.
- Adds optional `source` to `SlideMaster` and `SlideLayout`.
- `importPptx` attaches normalized source paths to each valid parsed master/layout.

- [x] **Step 1: Write the failing model and importer tests**

Add type imports and assertions for a source-bound model:

```ts
it('keeps master and layout source bindings clone-safe and fingerprinted', () => {
  const document = structuredClone(minimalDocument)
  document.masters = { master_1: { id: 'master_1', source: { partPath: 'ppt/slideMasters/custom.xml' } } }
  document.layouts = { layout_1: { id: 'layout_1', masterId: 'master_1', source: { partPath: 'ppt/slideLayouts/custom.xml' } } }
  expect(validateDocument(document)).toEqual({ valid: true })
  expect(structuredClone(document)).toEqual(document)
  expect(fingerprintDocument(document)).not.toBe(fingerprintDocument(minimalDocument))
})

it('rejects empty master and layout source paths', () => {
  const document = {
    ...minimalDocument,
    masters: { master_1: { id: 'master_1', source: { partPath: '' } } },
    layouts: { layout_1: { id: 'layout_1', masterId: 'master_1', source: { partPath: '' } } },
  }
  expect(validateDocument(document as Ppt4aiDocument)).toEqual({
    valid: false,
    errors: [
      'masters.master_1.source.partPath must be a non-empty string',
      'layouts.layout_1.source.partPath must be a non-empty string',
    ],
  })
})
```

Extend the existing relationship-chain importer fixture and assert:

```ts
expect(imported.masters?.mst_1?.source).toEqual({ partPath: 'ppt/slideMasters/slideMaster1.xml' })
expect(imported.layouts?.lyt_1?.source).toEqual({ partPath: 'ppt/slideLayouts/slideLayout1.xml' })
```

Add a second slide using the same layout/master and assert only one model
record exists for each path and both records retain the same normalized path.

- [x] **Step 2: Run the focused tests and verify RED**

Run:
`pnpm exec vitest run packages/model/src/model.test.ts packages/pptx-import/src/importer.test.ts`

Expected: failure because the source fields and validation/import population
do not exist.

- [x] **Step 3: Implement the smallest source contract**

Add the two interfaces and optional fields beside `ThemeSource`, then add the
same object/path validation branches used for themes under the master and
layout loops. Extend `parseMaster(xml, id, themeId, partPath)` and
`parseLayout(xml, id, masterId, partPath)` to return the binding. Pass the
already normalized `masterPath` and `layoutPath` at their call sites; do not
change the existing path caches or tolerant missing-part branches.

- [x] **Step 4: Verify and commit the binding task**

Run the focused tests and:
`pnpm --filter @ppt4ai/model typecheck && pnpm --filter @ppt4ai/pptx-import typecheck`

Commit:
`git add packages/model/src/index.ts packages/model/src/model.test.ts packages/pptx-import/src/importer.ts packages/pptx-import/src/importer.test.ts && git commit -m "feat: bind pptx master and layout source parts"`

---

### Task 2: Add Placeholder and Color-map Range Writers

**Files:**
- Create: `packages/pptx-export/src/master-layout-writeback.ts`
- Test: `packages/pptx-export/src/master-layout-writeback.test.ts`
- Modify: `packages/pptx-export/src/index.ts`

**Interfaces:**
- Exports `rewriteMasterXml(source: string, defaults: Record<string, ElementDefaults>, colorMap?: Partial<ColorMap>, id?: string): string`.
- Exports `rewriteLayoutXml(source: string, defaults: Record<string, ElementDefaults>, colorMap?: Partial<ColorMap>, id?: string): string`.
- Exports `rewriteSlideColorMapXml(source: string, colorMap: Partial<ColorMap>, id?: string): string`.

- [x] **Step 1: Write failing range-writer tests**

Use a source master with a custom `p`/`d` prefix, one `title` placeholder,
unknown shape and mapping attributes, and a layout/slide with an existing
`masterClrMapping`. Assert these behaviors independently:

```ts
it('patches placeholder geometry, rotation, fill, stroke, preset, and text', () => {
  const rewritten = rewriteMasterXml(sourceMaster, {
    title: {
      bounds: { x: 11, y: 22, w: 33, h: 44 },
      rotation: 60000,
      preset: 'ellipse',
      fill: { color: { type: 'srgb', v: 'FF0000' } },
      stroke: { color: { type: 'srgb', v: '00FF00' } },
      text: 'Changed',
    },
  }, undefined, 'master_1')
  expect(rewritten).toContain('data-shape="keep"')
  expect(rewritten).toContain('rot="60000"')
  expect(rewritten).toContain('prst="ellipse"')
  expect(rewritten).toContain('Changed')
  expect(rewritten).toContain('data-unknown="keep"')
})

it('writes only defined map keys and inserts a missing layout override', () => {
  const rewritten = rewriteLayoutXml(sourceLayout, {}, { accent1: 'accent3' }, 'layout_1')
  expect(rewritten).toContain('overrideClrMapping')
  expect(rewritten).toContain('accent1="accent3"')
  expect(rewritten).toContain('masterClrMapping')
})

it('returns exact source when defaults and maps are unchanged', () => {
  expect(rewriteMasterXml(sourceMaster, {}, undefined, 'master_1')).toBe(sourceMaster)
})
```

Also test custom quote preservation, missing source mapping insertion, invalid
XML, and invalid map targets with stable `PPTX export` errors.

- [x] **Step 2: Run the range-writer tests and verify RED**

Run:
`pnpm exec vitest run packages/pptx-export/src/master-layout-writeback.test.ts`

Expected: failure because the module and exports do not exist.

- [x] **Step 3: Implement source scanning and sparse default patches**

In the new module, scan XML with `scanXml` and match direct `sp` descendants
by the first `ph` type/index pair. Reuse the existing attribute/range pattern
for bounds and rotation, and implement local prefix helpers for generated
geometry, fill, stroke, and text body fragments. Compare source values before
adding a replacement. Apply non-overlapping replacements through
`replaceRanges`; never rewrite a complete placeholder shape.

- [x] **Step 4: Implement map attribute patches and insertion**

Find direct `clrMap` or `clrMapOvr` mapping children. For every defined model
key, replace its existing local-name attribute value or append a new attribute
using the mapping element prefix. For layout/slide parts, insert
`clrMapOvr`/`overrideClrMapping` before the root close when needed and retain
all existing `masterClrMapping` children. Validate map keys/targets at the
writer boundary and use the part ID in deterministic errors.

- [x] **Step 5: Run focused writer tests and commit**

Run the writer suite plus the exporter typecheck/build. Commit:
`git add packages/pptx-export/src/master-layout-writeback.ts packages/pptx-export/src/master-layout-writeback.test.ts packages/pptx-export/src/index.ts && git commit -m "feat: add master layout range writers"`

---

### Task 3: Integrate Source-part Write-back

**Files:**
- Modify: `packages/pptx-export/src/writeback.ts`
- Modify: `packages/pptx-export/src/writeback.test.ts`

**Interfaces:**
- `exportPptx` public signature remains unchanged.
- Bound masters/layouts are rewritten in deterministic model-ID order.
- Current source-backed slide plans receive slide color-map patches at their
  output path, including cloned source slides.

- [x] **Step 1: Write failing package integration tests**

Build a source package containing one master placeholder, one layout
placeholder, master/layout/slide maps, unknown XML siblings, and an unrelated
binary entry. Import it, edit the three maps and master/layout defaults, export,
and assert:

```ts
expect(outputMaster).toContain('Changed master text')
expect(outputLayout).toContain('accent1="accent2"')
expect(outputSlide).toContain('accent1="accent3"')
expect(await importPptx(output)).toMatchObject({
  masters: { mst_1: { defaults: { title: { text: 'Changed master text' } } } },
  layouts: { lyt_1: { colorMapOverride: { accent1: 'accent2' } } },
  slides: { sld_1: { colorMapOverride: { accent1: 'accent3' } } },
})
expect(entries.get('custom/unknown.bin')).toEqual(new Uint8Array([7, 3, 1, 4]))
```

Add tests for a shared bound part, unchanged source-byte identity, missing
bound master/layout parts, malformed source XML, and deterministic repeated
exports. Assert the source ZIP and document snapshots remain unchanged.

- [x] **Step 2: Run integration tests and verify RED**

Run:
`pnpm exec vitest run packages/pptx-export/src/writeback.test.ts`

Expected: failure because only theme and slide-element writes are integrated.

- [x] **Step 3: Add deterministic master/layout rewrite coordination**

Collect bound model records by sorted ID, resolve each `source.partPath` in
`entriesByName`, compute `rewriteMasterXml`/`rewriteLayoutXml` results in local
maps, reject conflicting results for one source path, and commit entry data
only after all calls succeed. Preserve the existing theme rewrite ordering and
error behavior.

- [x] **Step 4: Add slide color-map rewriting to each output plan**

After a plan's source XML is materialized and before final entry assignment,
call `rewriteSlideColorMapXml` for a source-backed current slide with a defined
override. Use the plan output path, so cloned pages are patched without
changing the original source page. Leave blank plans untouched and preserve
the existing element range replacements.

- [x] **Step 5: Verify integration and commit**

Run focused importer/model/exporter tests, exporter typecheck, and exporter
build. Commit:
`git add packages/pptx-export/src/writeback.ts packages/pptx-export/src/writeback.test.ts && git commit -m "feat: write back pptx master layout and color maps"`

---

### Task 4: Record the Milestone and Run Repository Gates

**Files:**
- Modify: `进度.md`
- Modify: `docs/superpowers/plans/2026-08-31-pptx-master-layout-writeback.md`

- [x] **Step 1: Mark the plan and progress record**

Mark completed checkboxes in this plan. Add a dated progress entry stating
that imported master/layout source bindings, placeholder default patches, and
master/layout/slide color-map write-back are complete. Keep explicit theme
deletion, master/layout UI/history, and real reader validation as follow-ups.

- [x] **Step 2: Run all repository gates**

Run from the repository root:

```bash
pnpm test -- --pool=threads --maxWorkers=1
pnpm typecheck
pnpm --workspace-concurrency=1 build
pnpm check:boundaries
pnpm exec vitest run packages/model/src/model.test.ts packages/pptx-import/src/importer.test.ts packages/pptx-export/src/master-layout-writeback.test.ts packages/pptx-export/src/writeback.test.ts
rg -n "element-plus|Element Plus" packages apps package.json pnpm-lock.yaml
git diff --check
```

The Element Plus search must remain empty. PowerPoint/LibreOffice manual
opening remains environment-gated and must not be claimed without a reader.

- [x] **Step 3: Review scope and commit the progress record**

Confirm no package manifest or runtime dependency changed, no input bytes were
mutated, and only intended model/import/export/docs files changed. Then run:

```bash
git add 进度.md docs/superpowers/plans/2026-08-31-pptx-master-layout-writeback.md
git commit -m "docs: record master layout writeback milestone"
```

## Completion Criteria

- [x] Imported masters and layouts retain normalized source paths.
- [x] Existing placeholder defaults patch selectively and re-import semantically.
- [x] Master, layout, and slide color-map edits patch or insert only defined attributes.
- [x] Unknown XML, unrelated entries, source bytes, and document state remain unchanged.
- [x] Missing/malformed bound parts fail deterministically without partial output.
- [x] Focused and repository gates pass.
