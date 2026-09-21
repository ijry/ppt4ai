import { importPptx } from '@ppt4ai/pptx-import'
import type { Fill, ShapeElement } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

/** `flip`, `rotWithShape` and `a:tileRect` are unmodeled; an edit to the stops must not disturb them. */
const gradientXml = '<a:gradFill flip="none" rotWithShape="1">'
  + '<a:gsLst><a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs>'
  + '<a:gs pos="100000"><a:srgbClr val="203864"/></a:gs></a:gsLst>'
  + '<a:lin ang="5400000" scaled="0"/>'
  + '<a:tileRect l="10000" t="20000"/>'
  + '</a:gradFill>'

/** The `a:extLst` plays the same role for a pattern that `a:tileRect` plays for a gradient. */
const patternXml = '<a:pattFill prst="dkUpDiag">'
  + '<a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>'
  + '<a:bgClr><a:srgbClr val="00FF00"/></a:bgClr>'
  + '<a:extLst><a:ext uri="{5A1C2E00-0000-0000-0000-000000000000}"/></a:extLst>'
  + '</a:pattFill>'

const solidXml = '<a:solidFill data-keep="yes"><a:srgbClr val="4472C4"/></a:solidFill>'

function sourcePackage(fillXml: string): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Filled"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${fillXml}</p:spPr>`
    + '</p:sp></p:spTree></p:cSld></p:sld>'
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

async function edited(fillXml: string, change: (shape: ShapeElement) => void): Promise<string> {
  const source = sourcePackage(fillXml)
  const document = await importPptx(source)
  const shape = document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  change(shape)
  return slideXmlOf(await exportPptx(document, source))
}

const redToGreen: Fill = {
  color: { type: 'srgb', v: 'FF0000' },
  gradient: {
    stops: [{ pos: 0, color: { type: 'srgb', v: 'FF0000' } }, { pos: 100000, color: { type: 'srgb', v: '00FF00' } }],
    angle: 5400000,
    scaled: false,
  },
}

describe('a gradient is patched rather than replaced', () => {
  it('keeps the attributes and the tile rect when the stops change', async () => {
    const slide = await edited(gradientXml, (shape) => { shape.fill = redToGreen })

    expect(slide).toContain('<a:gradFill flip="none" rotWithShape="1">')
    expect(slide).toContain('<a:tileRect l="10000" t="20000"/>')
    expect(slide).toContain('<a:gs pos="100000"><a:srgbClr val="00FF00"/></a:gs>')
  })

  it('leaves the axis alone when only the stops change', async () => {
    expect(await edited(gradientXml, (shape) => { shape.fill = redToGreen }))
      .toContain('<a:lin ang="5400000" scaled="0"/>')
  })

  it('replaces the axis when only the angle changes', async () => {
    const slide = await edited(gradientXml, (shape) => {
      shape.fill = { ...shape.fill!, gradient: { ...shape.fill!.gradient!, angle: 0 } }
    })

    expect(slide).toContain('<a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs>')
    expect(slide).toContain('<a:lin ang="0"')
    expect(slide).not.toContain('ang="5400000"')
  })

  /** `a:lin` and `a:path` are a choice, so exactly one may survive the swap. */
  it('swaps a linear axis for a radial path', async () => {
    const slide = await edited(gradientXml, (shape) => {
      shape.fill = { ...shape.fill!, gradient: { stops: shape.fill!.gradient!.stops, path: 'circle' } }
    })

    expect(slide).toContain('<a:path path="circle">')
    expect(slide).not.toContain('<a:lin')
  })
})

describe('a pattern is patched rather than replaced', () => {
  it('keeps the extLst and the background when the foreground changes', async () => {
    const slide = await edited(patternXml, (shape) => {
      shape.fill = { ...shape.fill!, color: { type: 'srgb', v: '0000FF' }, pattern: { ...shape.fill!.pattern!, foreground: { type: 'srgb', v: '0000FF' } } }
    })

    expect(slide).toContain('<a:fgClr><a:srgbClr val="0000FF"/></a:fgClr>')
    expect(slide).toContain('<a:bgClr><a:srgbClr val="00FF00"/></a:bgClr>')
    expect(slide).toContain('{5A1C2E00-0000-0000-0000-000000000000}')
  })

  it('keeps both colours and the extLst when only the preset changes', async () => {
    const slide = await edited(patternXml, (shape) => {
      shape.fill = { ...shape.fill!, pattern: { ...shape.fill!.pattern!, preset: 'ltHorz' } }
    })

    expect(slide).toContain('prst="ltHorz"')
    expect(slide).toContain('<a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>')
    expect(slide).toContain('{5A1C2E00-0000-0000-0000-000000000000}')
  })
})

describe('a solid fill is patched rather than replaced', () => {
  it('keeps the fill node attributes when the colour changes', async () => {
    const slide = await edited(solidXml, (shape) => { shape.fill = { color: { type: 'srgb', v: '00FF00' } } })

    expect(slide).toContain('<a:solidFill data-keep="yes"><a:srgbClr val="00FF00"/></a:solidFill>')
  })
})

describe('changing the kind of fill still swaps the node', () => {
  /** `EG_FillProperties` is a choice, so there is no correspondence to preserve across kinds. */
  it('replaces a solid fill with a gradient', async () => {
    const slide = await edited(solidXml, (shape) => { shape.fill = redToGreen })

    expect(slide).toContain('<a:gradFill>')
    expect(slide).not.toContain('solidFill')
  })

  it('leaves every fixture byte-identical when nothing is edited', async () => {
    for (const fillXml of [gradientXml, patternXml, solidXml]) {
      const source = sourcePackage(fillXml)

      expect(await exportPptx(await importPptx(source), source)).toEqual(source)
    }
  })
})

/** A stroke's fill sits inside `a:ln`, and it used to be replaced whole exactly as the shape's was. */
describe("a stroke's fill is patched rather than replaced", () => {
  const strokedSource = (): Uint8Array => {
    const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Stroked"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
      + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
      + '<a:prstGeom prst="rect"/>'
      + '<a:ln w="76200" cap="sq"><a:solidFill data-keep="yes"><a:srgbClr val="203864"/></a:solidFill>'
      + '<a:prstDash val="dash"/></a:ln></p:spPr>'
      + '</p:sp></p:spTree></p:cSld></p:sld>'
    const encode = (value: string) => new TextEncoder().encode(value)
    return writeStoredZip([
      { name: 'ppt/presentation.xml', data: encode(presentation) },
      { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
      { name: 'ppt/slides/slide1.xml', data: encode(slide) },
    ])
  }

  it('keeps the fill node attributes when the stroke colour changes', async () => {
    const source = strokedSource()
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    shape.stroke = { color: { type: 'srgb', v: 'FF0000' } }

    const slide = await slideXmlOf(await exportPptx(document, source))

    expect(slide).toContain('<a:solidFill data-keep="yes"><a:srgbClr val="FF0000"/></a:solidFill>')
    expect(slide).toContain('cap="sq"')
    expect(slide).toContain('<a:prstDash val="dash"/>')
  })

  it('leaves the stroke alone when nothing is edited', async () => {
    const source = strokedSource()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })
})
