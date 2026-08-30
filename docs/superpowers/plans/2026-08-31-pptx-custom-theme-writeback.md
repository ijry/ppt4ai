# PPTX Custom Theme Color Write-back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve imported custom theme color provenance, write supported color edits back into the original theme XML, and make standalone PPTX generation honor the document's effective theme.

**Architecture:** Extend the JSON-safe `Theme` model with a source-part binding. The importer records the normalized theme part path; a browser-safe exporter range writer patches only supported `clrScheme` color nodes while retaining the surrounding source XML. The existing source ZIP lifecycle remains responsible for all opaque entries and relationships, and the standalone serializer receives one selected theme without changing its one-theme package topology.

**Tech Stack:** TypeScript 6, pnpm workspace, Vitest, browser-safe `Uint8Array` ZIP/XML utilities, Vue/UnoCSS unchanged.

**Spec:** `docs/superpowers/specs/2026-08-31-pptx-custom-theme-writeback-design.md`

## Global Constraints

- Keep all model and source metadata JSON-safe and `structuredClone`-safe.
- Keep model units and OOXML values unchanged; theme colors retain their structured type and transform order.
- Do not import `@ppt4ai/pptx-import` from exporter runtime code.
- Do not add Element Plus or any new runtime dependency.
- Preserve unknown source XML outside a deliberately replaced color node, source entry order, unrelated ZIP entries, and adapter-owned bytes.
- Keep omitted theme slots non-destructive; explicit color deletion is out of scope.
- Every production behavior starts with a focused failing test and ends with a focused green test.
- Commit each independently verified task, then commit the progress record separately.

---

### Task 1: Add Theme Source Provenance to the Model

**Files:**
- Modify: `packages/model/src/index.ts:25-33, 920-1010`
- Test: `packages/model/src/model.test.ts:1-90, 704-760`

**Interfaces:**
- Produces `ThemeSource` with `partPath: string`.
- Extends `Theme` with optional `source?: ThemeSource`.
- `validateDocument` reports `themes.<id>.source must be an object` or `themes.<id>.source.partPath must be a non-empty string`.

- [x] **Step 1: Write the failing model tests**

Add `type ThemeSource` to the test imports, use it for the provenance
literal, and add these assertions to the model suite:

```ts
it('keeps theme source provenance clone-safe and part of the model fingerprint', () => {
  const source: ThemeSource = { partPath: 'ppt/theme/custom.xml' }
  const withSource: Ppt4aiDocument = {
    ...minimalDocument,
    themes: {
      theme_1: {
        id: 'theme_1',
        colors: { accent1: { type: 'srgb', v: '336699' } },
        source,
      },
    },
  }

  expect(validateDocument(withSource)).toEqual({ valid: true })
  expect(structuredClone(withSource)).toEqual(withSource)
  expect(fingerprintDocument(withSource)).not.toBe(fingerprintDocument(minimalDocument))
})

it('rejects invalid theme source provenance', () => {
  const document = {
    ...minimalDocument,
    themes: {
      theme_1: {
        id: 'theme_1',
        colors: {},
        source: { partPath: '' },
      },
    },
  }
  expect(validateDocument(document as Ppt4aiDocument)).toEqual({
    valid: false,
    errors: ['themes.theme_1.source.partPath must be a non-empty string'],
  })
})
```

- [x] **Step 2: Run the model tests and verify RED**

Run: `pnpm exec vitest run packages/model/src/model.test.ts`

Expected: FAIL because `Theme.source` is not yet part of the type and the
theme validation path does not report the new error.

- [x] **Step 3: Implement the minimal model contract**

Add the interfaces directly beside `Theme`:

```ts
export interface ThemeSource {
  partPath: string
}

export interface Theme {
  id: string
  colors: Partial<Record<ThemeColorSlot, Color>>
  source?: ThemeSource
}
```

Inside the existing `value.themes` validation loop, after the theme ID check,
validate the optional source exactly as follows:

```ts
if ('source' in theme && theme.source !== undefined) {
  if (!theme.source || typeof theme.source !== 'object' || Array.isArray(theme.source)) {
    errors.push(`${themePath}.source must be an object`)
  } else if (typeof (theme.source as Record<string, unknown>).partPath !== 'string'
    || (theme.source as Record<string, unknown>).partPath.length === 0) {
    errors.push(`${themePath}.source.partPath must be a non-empty string`)
  }
}
```

Do not alter the canonical serializer: nested theme provenance is model data,
while only the top-level `document.source` remains excluded.

- [x] **Step 4: Run focused tests and typecheck**

Run: `pnpm exec vitest run packages/model/src/model.test.ts && pnpm --filter @ppt4ai/model typecheck`

Expected: PASS with no new warnings.

- [x] **Step 5: Commit the model slice**

```bash
git add packages/model/src/index.ts packages/model/src/model.test.ts
git commit -m "feat: bind pptx theme source parts"
```

### Task 2: Bind Imported Themes to Their Source Parts

**Files:**
- Modify: `packages/pptx-import/src/importer.ts:147-164, 810-830`
- Test: `packages/pptx-import/src/importer.test.ts:188-195, 360-390`

**Interfaces:**
- Changes the private parser signature to `parseTheme(xml: string, id: string, partPath: string): Theme | undefined`.
- `importPptx` emits `themes.<id>.source.partPath` for every valid parsed theme.
- Missing or malformed theme parts remain unbound and do not remove the slide.

- [x] **Step 1: Write the failing importer tests**

Extend the existing custom `themeFiles` test coverage with:

```ts
it('records the normalized source path for a custom theme', async () => {
  const imported = await importPptx(createStoredZip(themeFiles))
  const themeId = imported.masters?.mst_1?.themeId
  expect(themeId).toBeDefined()
  expect(imported.themes?.[themeId ?? '']?.source).toEqual({ partPath: 'ppt/theme/custom.xml' })
})

it('reuses one source-bound theme for shared theme paths', async () => {
  const imported = await importPptx(createStoredZip({
    ...themeFiles,
    'ppt/presentation.xml': themeFiles['ppt/presentation.xml']
      .replace('</p:sldIdLst>', '<p:sldId id="257" r:id="rId2"/></p:sldIdLst>'),
    'ppt/_rels/presentation.xml.rels': themeFiles['ppt/_rels/presentation.xml.rels']
      .replace('</Relationships>', '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>'),
    'ppt/slides/slide2.xml': themeFiles['ppt/slides/slide1.xml'],
    'ppt/slides/_rels/slide2.xml.rels': themeFiles['ppt/slides/_rels/slide1.xml.rels'],
  }))
  expect(Object.keys(imported.themes ?? {})).toHaveLength(1)
  expect(Object.values(imported.themes ?? {})[0]?.source).toEqual({ partPath: 'ppt/theme/custom.xml' })
})

it('leaves a malformed custom theme unbound without dropping the slide', async () => {
  const imported = await importPptx(createStoredZip({
    ...themeFiles,
    'ppt/theme/custom.xml': '<a:theme><a:themeElements>',
  }))
  expect(imported.slideOrder).toEqual(['sld_1'])
  expect(imported.masters?.mst_1?.themeId).toBeUndefined()
  expect(imported.themes).toEqual({})
})
```

- [x] **Step 2: Run importer tests and verify RED**

Run: `pnpm exec vitest run packages/pptx-import/src/importer.test.ts`

Expected: FAIL because parsed themes do not expose `source` and the new
assertions cannot observe source provenance.

- [x] **Step 3: Pass the resolved theme path into `parseTheme`**

Return the same colors as today plus the source binding:

```ts
function parseTheme(xml: string, id: string, partPath: string): Theme | undefined {
  // Keep the existing parseXml, clrScheme, and color parsing logic.
  // Return undefined before constructing the object when parsing fails or
  // when the scheme has no readable colors.
  return Object.keys(colors).length > 0 ? { id, colors, source: { partPath } } : undefined
}
```

At the master relationship call site, invoke
`parseTheme(new TextDecoder().decode(themeBytes), candidateId, themePath)`.
Keep `themeIdsByPath` keyed by the normalized `themePath`, and retain the
existing behavior for missing bytes or parser failures.

- [x] **Step 4: Run focused importer tests and typecheck**

Run: `pnpm exec vitest run packages/pptx-import/src/importer.test.ts && pnpm --filter @ppt4ai/pptx-import typecheck`

Expected: PASS; existing color, inheritance, and clone-safety assertions stay
green.

- [x] **Step 5: Commit the importer slice**

```bash
git add packages/pptx-import/src/importer.ts packages/pptx-import/src/importer.test.ts
git commit -m "feat: preserve pptx theme provenance"
```

### Task 3: Implement the Range-Preserving Theme XML Writer

**Files:**
- Create: `packages/pptx-export/src/xml-range.ts`
- Create: `packages/pptx-export/src/theme-writeback.ts`
- Test: `packages/pptx-export/src/theme-writeback.test.ts`
- Modify: `packages/pptx-export/src/writeback.ts:1-210, 807-813`
- Modify: `packages/pptx-export/src/standalone-xml.ts:1-35, 170-190`
- Modify: `packages/pptx-export/src/index.ts`

**Interfaces:**
- `xml-range.ts` exports `XmlElement`, `Replacement`, `scanXml`, `descendants`, and `replaceRanges` for exporter-only source range work.
- `theme-writeback.ts` exports `rewriteThemeXml(source: string, theme: Theme): string`.
- `serializeColorXml(color: Color, prefix?: string): string` keeps the existing default `a:` prefix and accepts a source namespace prefix for theme patches.

- [x] **Step 1: Write failing range-writer tests**

Create a fixture with a custom prefix, unknown attributes, unknown siblings,
an existing transformed color, and a missing supported slot. Add these tests:

```ts
const sourceTheme = `<a:theme xmlns:a="a" data-theme="keep"><a:themeElements><a:clrScheme name="Custom" data-scheme="keep"><a:accent1 data-slot="keep"><a:srgbClr val="336699"><a:lumMod val="80000"/><a:customTransform keep="yes"/></a:srgbClr><a:extLst data-ext="keep"/></a:accent1><a:accent2><a:customSlot keep="yes"/></a:accent2></a:clrScheme><a:fontScheme data-font="keep"/></a:themeElements></a:theme>`

it('patches a changed color while preserving the surrounding theme XML', () => {
  const rewritten = rewriteThemeXml(sourceTheme, {
    id: 'theme_1',
    colors: {
      accent1: { type: 'srgb', v: 'FF0000', transforms: [{ type: 'alpha', value: 50000 }] },
    },
  })
  expect(rewritten).toContain('<a:theme xmlns:a="a" data-theme="keep">')
  expect(rewritten).toContain('<a:accent1 data-slot="keep"><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr><a:extLst data-ext="keep"/></a:accent1>')
  expect(rewritten).toContain('<a:accent2><a:customSlot keep="yes"/></a:accent2>')
  expect(rewritten).toContain('<a:fontScheme data-font="keep"/>')
})

it('inserts a missing slot with the clrScheme namespace prefix', () => {
  const rewritten = rewriteThemeXml(sourceTheme, {
    id: 'theme_1',
    colors: { accent3: { type: 'scheme', v: 'accent1' } },
  })
  expect(rewritten).toContain('<a:accent3><a:schemeClr val="accent1"/></a:accent3>')
})

it('returns the exact source when defined colors are unchanged', () => {
  expect(rewriteThemeXml(sourceTheme, {
    id: 'theme_1',
    colors: { accent1: { type: 'srgb', v: '336699', transforms: [{ type: 'lumMod', value: 80000 }] } },
  })).toBe(sourceTheme)
})

it('rejects malformed theme source with a stable error', () => {
  expect(() => rewriteThemeXml('<a:theme>', {
    id: 'theme_1',
    colors: { accent1: { type: 'srgb', v: 'FF0000' } },
  })).toThrow('PPTX export theme')
})
```

- [x] **Step 2: Run the range-writer tests and verify RED**

Run: `pnpm exec vitest run packages/pptx-export/src/theme-writeback.test.ts`

Expected: FAIL because the new writer module and optional color-prefix API do
not exist.

- [x] **Step 3: Extract the existing exporter range primitives**

Move the current `XmlElement`, `Replacement`, `tagEnd`, `decodeXml`, XML
attribute parser, `scanXml`, `descendants`, and `replaceRanges` implementations from
`writeback.ts` into `xml-range.ts` without changing their tokenization rules.
Import the exported types/functions back into `writeback.ts`. Run the
existing writeback tests immediately after this mechanical change so the
refactor cannot alter slide behavior.

- [x] **Step 4: Implement `rewriteThemeXml` minimally**

Implement a local color parser matching importer semantics for `srgbClr`,
`schemeClr`, `prstClr`, `sysClr`, `scrgbClr`, and the seven supported
transforms. Compare type, value, and transform order. Locate only direct
`clrScheme` slot children by local name.

For a changed defined slot, replace its first recognized color child with a
prefix-aware `serializeColorXml` result. For a slot with no recognized color,
insert before its closing tag. For an absent slot, insert a new slot before
the closing `clrScheme` tag. Skip model slots that are `undefined`, and
apply replacements from right to left with `replaceRanges`.

Use deterministic errors with these exact prefixes:

```ts
throw new Error(`PPTX export theme source malformed: ${theme.id}`)
throw new Error(`PPTX export theme color unsupported: ${theme.id}.${slot}`)
```

Validate serialized `srgbClr` hex values, `scrgbClr` integer channels, and
transform ranges before emitting XML. Preserve all source bytes outside the
selected color-node ranges. Keep the existing `serializeColorXml` default
behavior for slide fills and strokes while adding its optional namespace
prefix.

- [x] **Step 5: Run writer and regression tests**

Run: `pnpm exec vitest run packages/pptx-export/src/theme-writeback.test.ts packages/pptx-export/src/writeback.test.ts packages/pptx-export/src/standalone.test.ts`

Expected: PASS, including all pre-existing slide fill, stroke, geometry,
rotation, image, and ZIP assertions.

- [x] **Step 6: Commit the range writer**

```bash
git add packages/pptx-export/src/xml-range.ts packages/pptx-export/src/theme-writeback.ts packages/pptx-export/src/theme-writeback.test.ts packages/pptx-export/src/writeback.ts packages/pptx-export/src/standalone-xml.ts packages/pptx-export/src/index.ts
git commit -m "feat: add range-preserving pptx theme writer"
```

### Task 4: Integrate Theme Write-back into Source Export

**Files:**
- Modify: `packages/pptx-export/src/writeback.ts:1098-1280`
- Modify: `packages/pptx-export/src/index.ts`
- Test: `packages/pptx-export/src/writeback.test.ts:208-870`

**Interfaces:**
- Adds an internal `rewriteSourceThemes(document, entriesByName)` pass.
- Exports `rewriteThemeXml` from the package entry point for direct headless coverage.
- Theme source conflicts on one part path fail with `PPTX export theme source conflict: <path>`.

- [x] **Step 1: Write failing source-export tests**

Define a local `themeSourcePackage()` helper in
`packages/pptx-export/src/writeback.test.ts` with the following deterministic
entries (the helper is intentionally local so the exporter tests do not import
test data from the importer package):

```ts
function themeSourcePackage(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr><p:txBody><a:p><a:r><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
  const slideRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'
  const theme = '<a:theme xmlns:a="a" data-theme="keep"><a:themeElements><a:clrScheme name="Custom" data-scheme="keep"><a:dk1><a:srgbClr val="202020"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="336699"><a:lumMod val="80000"/></a:srgbClr><a:extLst data-ext="keep"/></a:accent1></a:clrScheme><a:fontScheme data-font="keep"/></a:themeElements></a:theme>'
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>') },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode('<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>') },
    { name: '[Content_Types].xml', data: new TextEncoder().encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/> </Types>') },
    { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(slide) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: new TextEncoder().encode(slideRels) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: new TextEncoder().encode('<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree/></p:cSld></p:sldLayout>') },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: new TextEncoder().encode('<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>') },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: new TextEncoder().encode('<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree/></p:cSld></p:sldMaster>') },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: new TextEncoder().encode('<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/custom.xml"/></Relationships>') },
    { name: 'ppt/theme/custom.xml', data: new TextEncoder().encode(theme) },
    { name: 'custom/unknown.bin', data: new Uint8Array([7, 3, 1, 4]) },
  ])
}
```

Then add source-package tests that import this helper, mutate a cloned model,
and inspect the output ZIP:

```ts
it('writes an edited imported theme color without rebuilding the theme part', async () => {
  const source = themeSourcePackage()
  const document = await importPptx(source)
  const themeId = document.masters?.mst_1?.themeId
  if (!themeId) throw new Error('custom theme was not imported')
  const edited = structuredClone(document)
  edited.themes![themeId]!.colors.accent1 = { type: 'srgb', v: 'FF0000' }

  const output = await exportPptx(edited, source)
  const entries = new Map((await readZipEntries(output)).map((entry) => [entry.name, entry.data]))
  const themeBytes = entries.get('ppt/theme/custom.xml')
  if (!themeBytes) throw new Error('theme entry was not written')
  const themeXml = new TextDecoder().decode(themeBytes)
  expect(themeXml).toContain('<a:accent1>')
  expect(themeXml).toContain('<a:srgbClr val="FF0000"/>')
  expect(themeXml).toContain('name="Custom"')
  expect(themeXml).toContain('data-theme="keep"')
  expect(entries.get('custom/unknown.bin')).toEqual(new Uint8Array([7, 3, 1, 4]))
  const sourceNames = (await readZipEntries(source)).map((entry) => entry.name)
  expect((await readZipEntries(output)).map((entry) => entry.name)).toEqual(sourceNames)
  expect(await importPptx(output)).toMatchObject({ themes: { [themeId]: { colors: { accent1: { type: 'srgb', v: 'FF0000' } } } } })
})

it('leaves the theme entry byte-identical when only a slide changes', async () => {
  const source = themeSourcePackage()
  const document = await importPptx(source)
  const edited = structuredClone(document)
  edited.elements.el_1!.bounds.x += 100
  const output = await exportPptx(edited, source)
  const before = new Map((await readZipEntries(source)).map((entry) => [entry.name, entry.data]))
  const after = new Map((await readZipEntries(output)).map((entry) => [entry.name, entry.data]))
  expect(after.get('ppt/theme/custom.xml')).toEqual(before.get('ppt/theme/custom.xml'))
})

it('rejects a bound theme whose source part is missing', async () => {
  const source = themeSourcePackage()
  const document = await importPptx(source)
  const themeId = document.masters?.mst_1?.themeId
  if (!themeId) throw new Error('custom theme was not imported')
  document.themes![themeId]!.source!.partPath = 'ppt/theme/missing.xml'
  await expect(exportPptx(document, source)).rejects.toThrow('PPTX export theme source missing')
})
```

Use `structuredClone` for every mutation and compare source bytes afterward;
the tests must prove that exporter preparation does not mutate caller data.

- [x] **Step 2: Run source-export tests and verify RED**

Run: `pnpm exec vitest run packages/pptx-export/src/writeback.test.ts`

Expected: FAIL because `exportPptx` currently leaves `ppt/theme/custom.xml`
unchanged and has no bound-theme error path.

- [x] **Step 3: Implement deterministic theme integration**

After `readZipEntries(source)` builds `entriesByName`, iterate
`Object.keys(document.themes ?? {}).sort()`. For every theme with
`source.partPath`:

1. Resolve the exact entry by path; throw
   `PPTX export theme source missing: ${path}` when absent.
2. Decode each original source entry once and call
   `rewriteThemeXml(originalXml, theme)`, so multiple model themes never
   compare against an already-mutated result.
3. Store a fresh encoded `Uint8Array` in the existing `ZipEntry.data` only
   when the returned string differs from the original.
4. Track each source path and reject a second theme that would produce a
   different rewritten XML with
   `PPTX export theme source conflict: ${path}`.

Run this pass before slide/dependency mutations. It must not add content-type
overrides or relationships. Leave the exact-byte fingerprint fast path before
ZIP parsing and leave unbound themes untouched.

- [x] **Step 4: Run focused integration and full exporter tests**

Run: `pnpm exec vitest run packages/pptx-export/src/theme-writeback.test.ts packages/pptx-export/src/writeback.test.ts packages/pptx-import/src/importer.test.ts`

Expected: PASS; imported edited theme colors re-import correctly, unrelated
source entries remain unchanged, and old documents without provenance still
use the existing fallback.

- [x] **Step 5: Commit source integration**

```bash
git add packages/pptx-export/src/writeback.ts packages/pptx-export/src/index.ts packages/pptx-export/src/writeback.test.ts
git commit -m "feat: write back imported pptx theme colors"
```

### Task 5: Honor Themes in Standalone PPTX Generation

**Files:**
- Modify: `packages/pptx-export/src/standalone-xml.ts:170-190`
- Modify: `packages/pptx-export/src/standalone.ts:1-20, 140-190`
- Test: `packages/pptx-export/src/standalone.test.ts`

**Interfaces:**
- Changes `serializeThemeXml()` to `serializeThemeXml(theme?: Theme)` while preserving the no-argument Office output.
- Adds an internal deterministic `effectiveTheme(document): Theme | undefined` selector.

- [x] **Step 1: Write failing standalone tests**

Add a document with a master pointing at a custom theme and assert generated
XML and semantic re-import:

```ts
it('serializes the effective document theme in standalone output', async () => {
  const document = structuredClone(emptyDocument)
  document.masters = { master_1: { id: 'master_1', themeId: 'theme_custom' } }
  document.themes = {
    theme_custom: {
      id: 'theme_custom',
      colors: {
        accent1: { type: 'srgb', v: '123456' },
        dk1: { type: 'srgb', v: '202020', transforms: [{ type: 'tint', value: 10000 }] },
      },
    },
  }
  const before = structuredClone(document)
  const output = await createPptx(document)
  const entries = new Map((await readZipEntries(output)).map((entry) => [entry.name, entry.data]))
  const themeXml = new TextDecoder().decode(entries.get('ppt/theme/theme1.xml'))
  expect(themeXml).toContain('<a:accent1><a:srgbClr val="123456"/></a:accent1>')
  expect(themeXml).toContain('<a:dk1><a:srgbClr val="202020"><a:tint val="10000"/></a:srgbClr></a:dk1>')
  expect(await importPptx(output)).toMatchObject({ themes: { theme_1: { colors: { accent1: { type: 'srgb', v: '123456' } } } } })
  expect(document).toEqual(before)
  expect(await createPptx(document)).toEqual(output)
})
```

- [x] **Step 2: Run standalone tests and verify RED**

Run: `pnpm exec vitest run packages/pptx-export/src/standalone.test.ts`

Expected: FAIL because standalone generation currently emits `4472C4` for
`accent1` and ignores `document.themes`.

- [x] **Step 3: Implement effective-theme selection and serialization**

Use this deterministic selection order:

```ts
function effectiveTheme(document: Ppt4aiDocument): Theme | undefined {
  const masterIds = Object.keys(document.masters ?? {}).sort()
  const referenced = masterIds.map((id) => document.masters?.[id]?.themeId)
    .map((id) => id ? document.themes?.[id] : undefined)
    .find((theme): theme is Theme => theme !== undefined)
  if (referenced) return referenced
  return Object.keys(document.themes ?? {}).sort()
    .map((id) => document.themes?.[id])
    .find((theme): theme is Theme => theme !== undefined)
}
```

Pass the result into `serializeThemeXml` from `skeletonEntries`. Keep the
existing Office values as defaults and replace only slots defined by the
selected theme. Use the already prefix-aware `serializeColorXml` for all
supported color types and transforms.

- [x] **Step 4: Run standalone and package focused tests**

Run: `pnpm exec vitest run packages/pptx-export/src/standalone.test.ts packages/pptx-export/src/theme-writeback.test.ts packages/pptx-export/src/writeback.test.ts`

Expected: PASS, including byte-identical repeated generation and all legacy
default-theme assertions.

- [x] **Step 5: Commit standalone theme support**

```bash
git add packages/pptx-export/src/standalone.ts packages/pptx-export/src/standalone-xml.ts packages/pptx-export/src/standalone.test.ts
git commit -m "feat: serialize custom themes in standalone pptx"
```

### Task 6: Record the Milestone and Run Repository Gates

**Files:**
- Modify: `进度.md:1-20, 120-230`
- Modify: `docs/superpowers/plans/2026-08-31-pptx-custom-theme-writeback.md`

- [x] **Step 1: Mark completed plan tasks and update the progress record**

Mark the completed checkboxes in this plan. At the top of `进度.md`, add a
milestone stating that imported custom theme color source bindings, selective
XML write-back, standalone effective-theme serialization, malformed-source
errors, and re-import tests are complete. Record the focused test count and
keep the remaining master/layout defaults, theme deletion, theme UI, and
reader validation as explicit follow-ups.

- [x] **Step 2: Run all repository gates**

Run each command from the repository root:

```bash
pnpm test -- --pool=threads --maxWorkers=1
pnpm typecheck
pnpm --workspace-concurrency=1 build
pnpm check:boundaries
pnpm exec vitest run packages/pptx-export/src/theme-writeback.test.ts packages/pptx-export/src/writeback.test.ts packages/pptx-import/src/importer.test.ts packages/model/src/model.test.ts
rg -n "element-plus|Element Plus" packages apps package.json pnpm-lock.yaml
git diff --check
```

The Element Plus search must return no runtime dependency or import matches.
PowerPoint/LibreOffice opening remains an environment-gated check, not a
claimed automated pass.

- [x] **Step 3: Review the final diff for scope and immutability**

Confirm that only model/import/export/docs files changed, no package manifest
adds a runtime dependency, no input `Uint8Array` or document is mutated, and
the source ZIP entry order is unchanged for a theme edit.

- [x] **Step 4: Commit the progress record**

```bash
git add 进度.md docs/superpowers/plans/2026-08-31-pptx-custom-theme-writeback.md
git commit -m "docs: record custom pptx theme writeback milestone"
```

## Completion Criteria

- [x] `Theme.source.partPath` validates, clones, and fingerprints correctly.
- [x] Imported custom themes retain normalized source paths and shared-path identity.
- [x] Changed supported theme colors patch only their source color nodes and re-import semantically.
- [x] Unchanged theme XML remains byte-identical during unrelated slide edits.
- [x] Missing or malformed bound theme parts fail with stable errors.
- [x] Standalone output serializes the selected theme and remains deterministic.
- [x] Full repository tests, typecheck, build, boundaries, Element Plus scan, and diff checks pass.
