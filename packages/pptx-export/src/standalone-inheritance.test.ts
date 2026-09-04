import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

async function partsOf(bytes: Uint8Array): Promise<Map<string, string>> {
  const decoder = new TextDecoder()
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, decoder.decode(entry.data)]))
}

/** A master, a layout and all three levels of colour map, the layer the standalone export used to write blank. */
function inheritedDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_inheritance',
    page: { w: 12192000, h: 6858000 },
    slides: {
      sld_1: {
        id: 'sld_1',
        elementIds: ['text_1'],
        masterId: 'mst_1',
        layoutId: 'lay_1',
        colorMapOverride: { tx1: 'accent1', bg1: 'accent2' },
      },
    },
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
    masters: {
      mst_1: {
        id: 'mst_1',
        themeId: 'theme_1',
        colorMap: { tx1: 'dk2', bg1: 'lt2' },
        background: { fill: { color: { type: 'srgb', v: '1F3864' } } },
        textStyles: {
          title: [{ level: 0, attrs: { align: 'center' }, marks: { fontSize: 44, bold: true } }],
          body: [{ level: 0, marks: { fontSize: 28 } }, { level: 1, attrs: { marginLeft: 457200 }, marks: { fontSize: 24 } }],
        },
      },
    },
    layouts: {
      lay_1: {
        id: 'lay_1',
        masterId: 'mst_1',
        background: { fill: { color: { type: 'srgb', v: '2F5597' } } },
        colorMapOverride: { tx2: 'accent3' },
      },
    },
    themes: { theme_1: { id: 'theme_1', colors: { accent1: { type: 'srgb', v: '4472C4' } } } },
  }
}

const mergedMasterMap = 'bg1="lt2" tx1="dk2" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"'

describe('standalone master and layout', () => {
  it('writes the master colour map, background and text styles', async () => {
    const parts = await partsOf(await createPptx(inheritedDocument()))
    const master = parts.get('ppt/slideMasters/slideMaster1.xml') ?? ''

    expect(master).toContain(`<p:clrMap ${mergedMasterMap}/>`)
    expect(master).toContain('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>')
    // `a:defRPr` writes an open/close pair for the same reason `a:rPr` does: it can carry a colour fill
    // and typefaces, so the run serializer never emits the empty-element form.
    expect(master).toContain('<p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400" b="1"></a:defRPr></a:lvl1pPr></p:titleStyle>'
      + '<p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"></a:defRPr></a:lvl1pPr><a:lvl2pPr marL="457200"><a:defRPr sz="2400"></a:defRPr></a:lvl2pPr></p:bodyStyle></p:txStyles>')
  })

  it('writes the layout background and its colour map override merged onto the master map', async () => {
    const parts = await partsOf(await createPptx(inheritedDocument()))
    const layout = parts.get('ppt/slideLayouts/slideLayout1.xml') ?? ''

    expect(layout).toContain('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="2F5597"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>')
    expect(layout).toContain('<p:clrMapOvr><a:overrideClrMapping bg1="lt2" tx1="dk2" bg2="lt2" tx2="accent3"')
  })

  it('writes the slide colour map override after p:cSld, merged through all three levels', async () => {
    const parts = await partsOf(await createPptx(inheritedDocument()))
    const slide = parts.get('ppt/slides/slide1.xml') ?? ''

    expect(slide).toContain('</p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="accent2" tx1="accent1" bg2="lt2" tx2="accent3"')
  })

  it('keeps inheriting when the model states no override', async () => {
    const document = inheritedDocument()
    delete document.slides.sld_1?.colorMapOverride
    delete document.layouts?.lay_1?.colorMapOverride
    const parts = await partsOf(await createPptx(document))

    expect(parts.get('ppt/slides/slide1.xml')).toContain('<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>')
    expect(parts.get('ppt/slideLayouts/slideLayout1.xml')).toContain('<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>')
  })

  it('writes nothing above the slide that the model does not state', async () => {
    const document = inheritedDocument()
    delete document.masters
    delete document.layouts
    const parts = await partsOf(await createPptx(document))

    expect(parts.get('ppt/slideMasters/slideMaster1.xml')).not.toContain('<p:bg>')
    expect(parts.get('ppt/slideMasters/slideMaster1.xml')).not.toContain('<p:txStyles>')
    expect(parts.get('ppt/slideMasters/slideMaster1.xml')).toContain('<p:clrMap bg1="lt1" tx1="dk1"')
  })

  it('brings the whole inherited layer back through importPptx', async () => {
    const imported = await importPptx(await createPptx(inheritedDocument()))
    const master = Object.values(imported.masters ?? {})[0]
    const layout = Object.values(imported.layouts ?? {})[0]

    expect(master?.colorMap).toMatchObject({ tx1: 'dk2', bg1: 'lt2' })
    expect(master?.background).toEqual({ fill: { color: { type: 'srgb', v: '1F3864' } } })
    expect(master?.textStyles).toEqual({
      title: [{ level: 0, attrs: { align: 'center' }, marks: { fontSize: 44, bold: true } }],
      body: [{ level: 0, marks: { fontSize: 28 } }, { level: 1, attrs: { marginLeft: 457200 }, marks: { fontSize: 24 } }],
    })
    expect(layout?.background).toEqual({ fill: { color: { type: 'srgb', v: '2F5597' } } })
    // The written override is complete, because `CT_ColorMapping` requires all twelve attributes. The
    // effective map is unchanged — `mergeColorMaps` gives the same answer for a partial and a full
    // overlay — so this is the one difference the round trip has, asserted rather than hidden.
    expect(layout?.colorMapOverride).toMatchObject({ tx2: 'accent3', tx1: 'dk2' })
    expect(imported.slides.sld_1?.colorMapOverride).toMatchObject({ tx1: 'accent1', bg1: 'accent2', tx2: 'accent3' })
  })
})
