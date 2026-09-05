import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

const sourceGradient = '<a:gradFill rotWithShape="1"><a:gsLst>'
  + '<a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs>'
  + '<a:gs pos="100000"><a:srgbClr val="203864"><a:alpha val="60000"/></a:srgbClr></a:gs>'
  + '</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>'

function sourcePackage(fill = sourceGradient): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Graded"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${fill}</p:spPr>`
    + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Graded</a:t></a:r></a:p></p:txBody></p:sp>'
    + '</p:spTree></p:cSld></p:sld>'
  const encode = (value: string) => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
  ])
}

async function slideXmlOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const data = entries.get('ppt/slides/slide1.xml')
  if (!data) throw new Error('missing slide')
  return new TextDecoder().decode(data)
}

describe('gradient fill survives writeback', () => {
  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /**
   * The trap this slice exists to avoid: once import produces a fill, a comparison that only knows
   * solidFill would call the gradient "changed" and overwrite it with a flat colour.
   */
  it('keeps the source gradient verbatim when only the text changes', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    element.body = { paragraphs: [{ runs: [{ text: 'Edited' }] }] }

    const outputSlide = await slideXmlOf(await exportPptx(document, source))

    expect(outputSlide).toContain(sourceGradient)
    expect(outputSlide).not.toContain('<a:solidFill>')
    expect(outputSlide).toContain('Edited')
  })

  it('replaces the gradient with a solid fill when the model flattens it', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    element.fill = { color: { type: 'srgb', v: 'FF0000' } }

    const outputSlide = await slideXmlOf(await exportPptx(document, source))

    expect(outputSlide).toContain('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>')
    expect(outputSlide).not.toContain('<a:gradFill')
  })

  it('writes a gradient over a solid source fill', async () => {
    const source = sourcePackage('<a:solidFill><a:srgbClr val="112233"/></a:solidFill>')
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text') throw new Error('fixture did not import as text')
    element.fill = {
      color: { type: 'srgb', v: '4472C4' },
      gradient: {
        stops: [{ pos: 0, color: { type: 'srgb', v: '4472C4' } }, { pos: 100000, color: { type: 'scheme', v: 'accent1' } }],
        angle: 2700000,
        scaled: true,
      },
    }

    const outputSlide = await slideXmlOf(await exportPptx(document, source))

    expect(outputSlide).toContain('<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs>'
      + '<a:gs pos="100000"><a:schemeClr val="accent1"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill>')
    expect(outputSlide).not.toContain('val="112233"')
  })

  /** A stop colour edit is a real change, so the gradient is rewritten from the model. */
  /**
   * `rotWithShape` used to disappear here, because a stop edit rewrote the whole `a:gradFill`. Only the
   * `a:gsLst` is replaced now, so the attributes and children the model cannot express stay put.
   */
  it('replaces only the stop list when a stop colour changes', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'text' || !element.fill?.gradient) throw new Error('fixture did not import a gradient')
    element.fill.gradient.stops[1] = { pos: 100000, color: { type: 'srgb', v: '00FF00' } }

    const outputSlide = await slideXmlOf(await exportPptx(document, source))

    expect(outputSlide).toContain('<a:gs pos="100000"><a:srgbClr val="00FF00"/></a:gs>')
    expect(outputSlide).toContain('<a:gradFill rotWithShape="1">')
    expect(outputSlide).toContain('<a:lin ang="5400000" scaled="0"/>')
  })
})
