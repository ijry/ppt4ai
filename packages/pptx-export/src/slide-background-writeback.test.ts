import { importPptx } from '@ppt4ai/pptx-import'
import type { SlideBackground } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
/** The effect list and the unknown sibling are what a fill-only change has to leave alone. */
const colourBackground = '<p:bg><p:bgPr data-keep="yes"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:effectLst/><a:customBackground keep="yes"/></p:bgPr></p:bg>'
const referenceBackground = '<p:bg><p:bgRef idx="1001"><a:schemeClr val="lt1"/></p:bgRef></p:bg>'

function packageWith(background: string): Uint8Array {
  const slide = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld>${background}<p:spTree>`
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Box"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:sp>'
    + '</p:spTree></p:cSld></p:sld>'
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
  ])
}

async function slideOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slides/slide1.xml')!)
}

async function exported(source: Uint8Array, background: SlideBackground | null): Promise<string> {
  const document = await importPptx(source)
  const slide = document.slides.sld_1
  if (!slide) throw new Error('fixture produced no slide')
  if (background === null) delete slide.background
  else slide.background = background
  return slideOf(await exportPptx(document, source))
}

const red: SlideBackground = { fill: { color: { type: 'srgb', v: 'FF0000' } } }

/**
 * The background editing slice added a command on the strength of "all four layers are ready" — which was
 * true of standalone generation and false of the source writeback: `p:bg` was never written, so every
 * background edit was dropped on the way out.
 */
describe('slide background writeback', () => {
  it('replaces only the fill node, keeping the effect list and unknown siblings', async () => {
    const xml = await exported(packageWith(colourBackground), red)

    expect(xml).toContain('<p:bgPr data-keep="yes"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:effectLst/><a:customBackground keep="yes"/></p:bgPr>')
  })

  it('inserts a background the source did not have, before the shape tree', async () => {
    const xml = await exported(packageWith(''), red)

    expect(xml).toContain('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>')
  })

  it('round-trips an inserted background through the importer', async () => {
    const source = packageWith('')
    const document = await importPptx(source)
    document.slides.sld_1!.background = red

    const reimported = await importPptx(await exportPptx(document, source))

    expect(reimported.slides.sld_1?.background).toEqual(red)
  })

  /** Clearing means "inherit from the layout", which in OOXML is the absence of `p:bg`. */
  it('deletes the node when the background is cleared', async () => {
    const xml = await exported(packageWith(colourBackground), null)

    expect(xml).not.toContain('p:bg')
  })

  it('replaces the whole node when a style reference becomes a colour', async () => {
    const xml = await exported(packageWith(referenceBackground), red)

    expect(xml).toContain('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>')
    expect(xml).not.toContain('bgRef')
  })

  it('replaces the whole node when a colour becomes a style reference', async () => {
    const xml = await exported(packageWith(colourBackground), { styleRef: { idx: 1002 } })

    expect(xml).toContain('<p:bg><p:bgRef idx="1002"></p:bgRef></p:bg>')
    expect(xml).not.toContain('solidFill')
  })

  it('writes a gradient background and reads it back', async () => {
    const ramp: SlideBackground = {
      fill: {
        color: { type: 'srgb', v: '1F3864' },
        gradient: {
          stops: [{ pos: 0, color: { type: 'srgb', v: '1F3864' } }, { pos: 100000, color: { type: 'srgb', v: 'FFFFFF' } }],
          angle: 5400000,
        },
      },
    }
    const source = packageWith(colourBackground)
    const document = await importPptx(source)
    document.slides.sld_1!.background = ramp

    const output = await exportPptx(document, source)

    expect(await slideOf(output)).toContain('<a:gradFill>')
    expect((await importPptx(output)).slides.sld_1?.background).toEqual(ramp)
  })

  it('stays byte-identical when the background is untouched', async () => {
    for (const background of [colourBackground, referenceBackground, '']) {
      const source = packageWith(background)

      expect(await exportPptx(await importPptx(source), source)).toEqual(source)
    }
  })
})
