import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

async function partsOf(bytes: Uint8Array): Promise<Map<string, string>> {
  const decoder = new TextDecoder()
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, decoder.decode(entry.data)]))
}

function slide(id: string, layoutId: string | undefined, masterId: string) {
  return { id, elementIds: [`text_${id}`], ...(layoutId ? { layoutId } : {}), masterId }
}

function textElement(id: string) {
  return { id: `text_${id}`, kind: 'text' as const, bounds: { x: 0, y: 0, w: 1000000, h: 500000 }, body: { paragraphs: [{ runs: [{ text: id }] }] } }
}

/** Two masters, three layouts (two on the first master), three slides — one of which names no layout. */
function deck(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_multi',
    page: { w: 12192000, h: 6858000 },
    slides: {
      sld_1: slide('sld_1', 'lay_1', 'mst_a'),
      sld_2: slide('sld_2', 'lay_3', 'mst_b'),
      sld_3: slide('sld_3', undefined, 'mst_b'),
    },
    slideOrder: ['sld_1', 'sld_2', 'sld_3'],
    elements: {
      text_sld_1: textElement('sld_1'),
      text_sld_2: textElement('sld_2'),
      text_sld_3: textElement('sld_3'),
    },
    masters: {
      mst_a: { id: 'mst_a', themeId: 'theme_a', colorMap: { tx1: 'dk2' }, background: { fill: { color: { type: 'srgb', v: '111111' } } } },
      mst_b: { id: 'mst_b', themeId: 'theme_b', colorMap: { tx1: 'lt2' }, background: { fill: { color: { type: 'srgb', v: '222222' } } } },
    },
    layouts: {
      lay_1: { id: 'lay_1', masterId: 'mst_a', background: { fill: { color: { type: 'srgb', v: 'AAAAAA' } } } },
      lay_2: { id: 'lay_2', masterId: 'mst_a' },
      lay_3: { id: 'lay_3', masterId: 'mst_b', background: { fill: { color: { type: 'srgb', v: 'CCCCCC' } } } },
    },
    themes: {
      theme_a: { id: 'theme_a', colors: { accent1: { type: 'srgb', v: '4472C4' } } },
      theme_b: { id: 'theme_b', colors: { accent1: { type: 'srgb', v: 'ED7D31' } } },
    },
  }
}

describe('standalone multi master and layout', () => {
  it('writes a part per master, layout and referenced theme', async () => {
    const parts = await partsOf(await createPptx(deck()))

    expect([...parts.keys()].filter((name) => name.startsWith('ppt/slideMasters/slideMaster')).sort())
      .toEqual(['ppt/slideMasters/slideMaster1.xml', 'ppt/slideMasters/slideMaster2.xml'])
    expect([...parts.keys()].filter((name) => name.startsWith('ppt/slideLayouts/slideLayout')).sort())
      .toEqual(['ppt/slideLayouts/slideLayout1.xml', 'ppt/slideLayouts/slideLayout2.xml', 'ppt/slideLayouts/slideLayout3.xml'])
    expect([...parts.keys()].filter((name) => name.startsWith('ppt/theme/')).sort()).toEqual(['ppt/theme/theme1.xml', 'ppt/theme/theme2.xml'])
    expect(parts.get('[Content_Types].xml')).toContain('<Override PartName="/ppt/slideLayouts/slideLayout3.xml"')
    expect(parts.get('[Content_Types].xml')).toContain('<Override PartName="/ppt/theme/theme2.xml"')
  })

  /** `ST_SlideMasterId` and `ST_SlideLayoutId` both start at 2147483648; the skeleton used to write 1. */
  it('lists both masters with ids the schema allows, and shifts the slide relationship ids past them', async () => {
    const parts = await partsOf(await createPptx(deck()))

    expect(parts.get('ppt/presentation.xml')).toContain('<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/><p:sldMasterId id="2147483649" r:id="rId2"/></p:sldMasterIdLst>')
    expect(parts.get('ppt/presentation.xml')).toContain('<p:sldIdLst><p:sldId id="256" r:id="rId4"/><p:sldId id="257" r:id="rId5"/><p:sldId id="258" r:id="rId6"/></p:sldIdLst>')
    expect(parts.get('ppt/_rels/presentation.xml.rels')).toContain('<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster2.xml"/>')
    expect(parts.get('ppt/_rels/presentation.xml.rels')).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"')
    expect(parts.get('ppt/_rels/presentation.xml.rels')).toContain('Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"')
  })

  it('gives each master only its own layouts, and each layout its own master', async () => {
    const parts = await partsOf(await createPptx(deck()))

    expect(parts.get('ppt/slideMasters/slideMaster1.xml'))
      .toContain('<p:sldLayoutIdLst><p:sldLayoutId id="2147483651" r:id="rId1"/><p:sldLayoutId id="2147483652" r:id="rId2"/></p:sldLayoutIdLst>')
    expect(parts.get('ppt/slideMasters/slideMaster2.xml')).toContain('<p:sldLayoutIdLst><p:sldLayoutId id="2147483653" r:id="rId1"/></p:sldLayoutIdLst>')
    expect(parts.get('ppt/slideMasters/_rels/slideMaster1.xml.rels')).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout2.xml"')
    expect(parts.get('ppt/slideMasters/_rels/slideMaster1.xml.rels')).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"')
    expect(parts.get('ppt/slideMasters/_rels/slideMaster2.xml.rels')).toContain('Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout3.xml"')
    expect(parts.get('ppt/slideMasters/_rels/slideMaster2.xml.rels')).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme2.xml"')
    expect(parts.get('ppt/slideLayouts/_rels/slideLayout3.xml.rels')).toContain('Target="../slideMasters/slideMaster2.xml"')
  })

  it('points each slide at the layout it names, and a slide that names none at its master\'s first', async () => {
    const parts = await partsOf(await createPptx(deck()))

    expect(parts.get('ppt/slides/_rels/slide1.xml.rels')).toContain('Target="../slideLayouts/slideLayout1.xml"')
    expect(parts.get('ppt/slides/_rels/slide2.xml.rels')).toContain('Target="../slideLayouts/slideLayout3.xml"')
    expect(parts.get('ppt/slides/_rels/slide3.xml.rels')).toContain('Target="../slideLayouts/slideLayout3.xml"')
  })

  it('writes the same bytes whatever order the master and layout keys arrive in', async () => {
    const forward = deck()
    const reversed = deck()
    reversed.masters = { mst_b: forward.masters!.mst_b!, mst_a: forward.masters!.mst_a! }
    reversed.layouts = { lay_3: forward.layouts!.lay_3!, lay_1: forward.layouts!.lay_1!, lay_2: forward.layouts!.lay_2! }

    expect(await createPptx(forward)).toEqual(await createPptx(reversed))
  })

  it('brings both masters, their themes and each slide\'s own layout back through importPptx', async () => {
    const imported = await importPptx(await createPptx(deck()))
    const masters = Object.values(imported.masters ?? {})
    const themes = Object.values(imported.themes ?? {})

    expect(masters.map((master) => master.background)).toEqual([
      { fill: { color: { type: 'srgb', v: '111111' } } },
      { fill: { color: { type: 'srgb', v: '222222' } } },
    ])
    expect(masters.map((master) => master.colorMap?.tx1)).toEqual(['dk2', 'lt2'])
    expect(themes.map((theme) => theme.colors.accent1)).toEqual([{ type: 'srgb', v: '4472C4' }, { type: 'srgb', v: 'ED7D31' }])
    expect(masters.map((master) => master.themeId)).toEqual([themes[0]?.id, themes[1]?.id])
    // Slide 2 and slide 3 share layout3, slide 1 has its own, and the layout no slide reaches is not
    // imported at all — the importer discovers parts through the slide relationship chain.
    expect(imported.slides.sld_2?.layoutId).toBe(imported.slides.sld_3?.layoutId)
    expect(imported.slides.sld_1?.layoutId).not.toBe(imported.slides.sld_2?.layoutId)
    expect(Object.keys(imported.layouts ?? {})).toHaveLength(2)
    expect(Object.values(imported.layouts ?? {}).map((layout) => layout.background)).toEqual([
      { fill: { color: { type: 'srgb', v: 'AAAAAA' } } },
      { fill: { color: { type: 'srgb', v: 'CCCCCC' } } },
    ])
  })
})
