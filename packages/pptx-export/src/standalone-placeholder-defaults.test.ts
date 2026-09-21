import { importPptx } from '@ppt4ai/pptx-import'
import type { ElementDefaults, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

async function partsOf(bytes: Uint8Array): Promise<Map<string, string>> {
  const decoder = new TextDecoder()
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, decoder.decode(entry.data)]))
}

const titleDefaults: ElementDefaults = {
  bounds: { x: 838200, y: 365125, w: 10515600, h: 1325563 },
  rotation: 300000,
  preset: 'roundRect',
  fill: { color: { type: 'srgb', v: 'FFF2CC' } },
  stroke: { color: { type: 'scheme', v: 'accent1' } },
  body: { bodyPr: { verticalAlign: 'middle' }, paragraphs: [{ attrs: { align: 'center' }, runs: [{ text: 'Click to edit' }] }] },
  listStyle: [{ level: 0, attrs: { marginLeft: 228600 }, marks: { fontSize: 32 } }],
}

const bodyDefaults: ElementDefaults = {
  bounds: { x: 838200, y: 1825625, w: 10515600, h: 4351338 },
  preset: 'rect',
}

function inheritedDocument(defaults: Record<string, ElementDefaults> = { 'title': titleDefaults, 'body:2': bodyDefaults }): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_placeholders',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['text_1'], masterId: 'mst_1', layoutId: 'lay_1' } },
    slideOrder: ['sld_1'],
    elements: {
      text_1: {
        id: 'text_1',
        kind: 'text',
        placeholder: 'title',
        bounds: { x: 100000, y: 100000, w: 3000000, h: 1000000 },
        body: { paragraphs: [{ runs: [{ text: 'Title' }] }] },
      },
    },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme_1', defaults } },
    layouts: { lay_1: { id: 'lay_1', masterId: 'mst_1', defaults: { 'title': titleDefaults } } },
    themes: { theme_1: { id: 'theme_1', colors: { accent1: { type: 'srgb', v: '4472C4' } } } },
  }
}

describe('standalone placeholder defaults', () => {
  it('writes one placeholder shape per defaults entry, in key order', async () => {
    const parts = await partsOf(await createPptx(inheritedDocument()))
    const master = parts.get('ppt/slideMasters/slideMaster1.xml') ?? ''
    const placeholders = [...master.matchAll(/<p:ph([^/]*)\/>/g)].map((match) => match[1]?.trim())

    expect(placeholders).toEqual(['type="body" idx="2"', 'type="title"'])
    expect(master).toContain('<p:sp><p:nvSpPr><p:cNvPr id="2" name="body:2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="2"/></p:nvPr></p:nvSpPr>')
    expect(master).toContain('<p:cNvPr id="3" name="title"/>')
  })

  it('writes the transform, geometry, fill and stroke a defaults entry states', async () => {
    const parts = await partsOf(await createPptx(inheritedDocument()))
    const master = parts.get('ppt/slideMasters/slideMaster1.xml') ?? ''

    expect(master).toContain('<p:spPr><a:xfrm rot="300000"><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm>'
      + '<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>'
      + '<a:solidFill><a:srgbClr val="FFF2CC"/></a:solidFill>'
      + '<a:ln><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln></p:spPr>')
  })

  it('fills the placeholder a:lstStyle with the level defaults', async () => {
    const parts = await partsOf(await createPptx(inheritedDocument()))
    const master = parts.get('ppt/slideMasters/slideMaster1.xml') ?? ''

    expect(master).toContain('<a:lstStyle><a:lvl1pPr marL="228600"><a:defRPr sz="3200"></a:defRPr></a:lvl1pPr></a:lstStyle>'
      + '<a:p><a:pPr algn="ctr"/><a:r><a:t>Click to edit</a:t></a:r></a:p>')
  })

  /** A layout with placeholders is not blank, and the model has no layout type to name instead. */
  it('marks a layout that carries placeholders as custom, and one without as blank', async () => {
    const withPlaceholders = await partsOf(await createPptx(inheritedDocument()))
    const bare = inheritedDocument()
    delete bare.layouts?.lay_1?.defaults
    const withoutPlaceholders = await partsOf(await createPptx(bare))

    expect(withPlaceholders.get('ppt/slideLayouts/slideLayout1.xml')).toContain('type="cust" preserve="1"')
    expect(withPlaceholders.get('ppt/slideLayouts/slideLayout1.xml')).toContain('<p:ph type="title"/>')
    expect(withoutPlaceholders.get('ppt/slideLayouts/slideLayout1.xml')).toContain('type="blank" preserve="1"')
    expect(withoutPlaceholders.get('ppt/slideLayouts/slideLayout1.xml')).toContain('<p:grpSpPr/></p:spTree>')
  })

  it('writes the same bytes whatever order the defaults keys arrive in', async () => {
    const first = await createPptx(inheritedDocument({ 'title': titleDefaults, 'body:2': bodyDefaults }))
    const second = await createPptx(inheritedDocument({ 'body:2': bodyDefaults, 'title': titleDefaults }))

    expect(first).toEqual(second)
  })

  it('brings both levels of defaults back through importPptx', async () => {
    const imported = await importPptx(await createPptx(inheritedDocument()))
    const master = Object.values(imported.masters ?? {})[0]
    const layout = Object.values(imported.layouts ?? {})[0]

    expect(Object.keys(master?.defaults ?? {}).sort()).toEqual(['body:2', 'title'])
    expect(master?.defaults?.title).toMatchObject({
      bounds: { x: 838200, y: 365125, w: 10515600, h: 1325563 },
      rotation: 300000,
      preset: 'roundRect',
      fill: { color: { type: 'srgb', v: 'FFF2CC' } },
      stroke: { color: { type: 'scheme', v: 'accent1' } },
      listStyle: [{ level: 0, attrs: { marginLeft: 228600 }, marks: { fontSize: 32 } }],
    })
    expect(master?.defaults?.title?.body?.paragraphs[0]).toMatchObject({ attrs: { align: 'center' }, runs: [{ text: 'Click to edit' }] })
    // The flat legacy field comes back derived from the body, which is what the writeback path compares.
    expect(master?.defaults?.title?.text).toBe('Click to edit')
    expect(layout?.defaults?.title).toMatchObject({ preset: 'roundRect', bounds: { x: 838200, y: 365125, w: 10515600, h: 1325563 } })
  })
})
