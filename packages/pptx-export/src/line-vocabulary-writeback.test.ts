import { importPptx } from '@ppt4ai/pptx-import'
import type { ShapeElement } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

/**
 * One `a:ln` and one `a:prstGeom` carrying every word the recent slices taught the model, plus an
 * `a:extLst` inside the pattern fill that nothing re-emits — that element is the discriminator for "the
 * node was rewritten", the way the pattern fill slice established.
 */
const geometryXml = '<a:prstGeom prst="roundRect">'
  + '<a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst>'
  + '</a:prstGeom>'

const fillXml = '<a:pattFill prst="dkUpDiag">'
  + '<a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>'
  + '<a:bgClr><a:srgbClr val="00FF00"/></a:bgClr>'
  + '<a:extLst><a:ext uri="{6F2A4D11-0000-0000-0000-000000000000}"/></a:extLst>'
  + '</a:pattFill>'

const lineXml = '<a:ln w="76200" cap="sq" cmpd="thickThin" algn="in">'
  + '<a:solidFill><a:srgbClr val="203864"/></a:solidFill>'
  + '<a:custDash><a:ds d="400000" sp="300000"/><a:ds d="100000" sp="300000"/></a:custDash>'
  + '<a:miter lim="800000"/>'
  + '</a:ln>'

function sourcePackage(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Everything"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `${geometryXml}${fillXml}${lineXml}</p:spPr>`
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

async function edited(change: (shape: ShapeElement) => void): Promise<string> {
  const source = sourcePackage()
  const document = await importPptx(source)
  const shape = document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  change(shape)
  return slideXmlOf(await exportPptx(document, source))
}

describe('the line and fill vocabulary survives source writeback together', () => {
  it('imports every word the source states', async () => {
    const document = await importPptx(sourcePackage())
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')

    expect(shape).toMatchObject({
      preset: 'roundRect',
      adjustValues: [{ name: 'adj', formula: 'val 25000' }],
      strokeWidth: 76200,
      strokeCap: 'sq',
      strokeCompound: 'thickThin',
      strokeAlign: 'in',
      strokeJoin: 'miter',
      strokeMiterLimit: 800000,
      strokeStyle: { custom: [{ dash: 400000, space: 300000 }, { dash: 100000, space: 300000 }] },
    })
    expect(shape.fill?.pattern?.preset).toBe('dkUpDiag')
  })

  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /**
   * The regression every one of these slices could have caused: the model now holds a value the
   * comparison has to recognise, and a comparison that cannot see it calls the node edited and rewrites
   * it. Moving the shape must touch the transform and nothing else.
   */
  it('leaves the geometry, fill and line untouched when only the bounds change', async () => {
    const slide = await edited((shape) => { shape.bounds = { ...shape.bounds, x: 2222222 } })

    expect(slide).toContain('x="2222222"')
    expect(slide).toContain(geometryXml)
    expect(slide).toContain(fillXml)
    expect(slide).toContain(lineXml)
  })

  it('writes a changed compound word without disturbing its neighbours', async () => {
    const slide = await edited((shape) => { shape.strokeCompound = 'tri' })

    expect(slide).toContain('cmpd="tri"')
    expect(slide).toContain('algn="in"')
    expect(slide).toContain('cap="sq"')
    expect(slide).toContain('<a:miter lim="800000"/>')
    expect(slide).toContain('<a:custDash><a:ds d="400000" sp="300000"/><a:ds d="100000" sp="300000"/></a:custDash>')
  })

  it('replaces a custom dash with a preset without disturbing its neighbours', async () => {
    const slide = await edited((shape) => { shape.strokeStyle = 'lgDash' })

    expect(slide).toContain('<a:prstDash val="lgDash"/>')
    expect(slide).not.toContain('custDash')
    expect(slide).toContain('cmpd="thickThin"')
    expect(slide).toContain('<a:miter lim="800000"/>')
  })

  it('keeps the pattern fill when the outline is edited', async () => {
    const slide = await edited((shape) => { shape.strokeWidth = 12700 })

    expect(slide).toContain('w="12700"')
    expect(slide).toContain(fillXml)
  })

  /**
   * Both of these were gaps when this file was written: the corner element was only rewritten when the
   * corner word changed, and the adjust list had no comparison at all. A program driving the model is
   * the caller that makes these edits, which is this project's whole use case, so they are written now.
   */
  it('writes a changed miter limit while the corner word stays', async () => {
    const slide = await edited((shape) => { shape.strokeMiterLimit = 200000 })

    expect(slide).toContain('<a:miter lim="200000"/>')
    expect(slide).not.toContain('800000')
  })

  it('drops the limit when the model no longer carries one', async () => {
    const slide = await edited((shape) => { delete shape.strokeMiterLimit })

    expect(slide).toContain('<a:miter/>')
    expect(slide).not.toContain('lim=')
  })

  it('writes a changed adjust value without touching the preset word', async () => {
    const slide = await edited((shape) => { shape.adjustValues = [{ name: 'adj', formula: 'val 40000' }] })

    expect(slide).toContain('<a:prstGeom prst="roundRect">')
    expect(slide).toContain('<a:gd name="adj" fmla="val 40000"/>')
    expect(slide).not.toContain('val 25000')
  })

  it('empties the adjust list when the model no longer carries one', async () => {
    const slide = await edited((shape) => { delete shape.adjustValues })

    expect(slide).toContain('<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>')
  })

  /** Changing both at once must not have the two replacements fight over the same range. */
  it('writes a new preset word and new adjust values together', async () => {
    const slide = await edited((shape) => {
      shape.preset = 'hexagon'
      shape.adjustValues = [{ name: 'adj1', formula: 'val 10000' }]
    })

    expect(slide).toContain('prst="hexagon"')
    expect(slide).toContain('<a:gd name="adj1" fmla="val 10000"/>')
    expect(slide).not.toContain('val 25000')
  })
})
