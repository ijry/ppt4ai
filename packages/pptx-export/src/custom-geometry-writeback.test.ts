import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { sourceCustomGeometry } from './geometry-source.js'
import { scanXml, descendants } from './xml-range.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

/** `a:avLst`, `a:gdLst` and `a:rect` are the siblings the model does not express. */
const siblings = '<a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst>'
  + '<a:gdLst><a:gd name="w1" fmla="pin 0 adj 50000"/></a:gdLst>'
  + '<a:rect l="0" t="0" r="r" b="b"/>'

const sourcePathList = '<a:pathLst><a:path w="100" h="100">'
  + '<a:moveTo><a:pt x="0" y="0"/></a:moveTo>'
  + '<a:cubicBezTo><a:pt x="10" y="20"/><a:pt x="30" y="40"/><a:pt x="50" y="60"/></a:cubicBezTo>'
  + '<a:close/></a:path></a:pathLst>'

const custGeom = `<a:custGeom>${siblings}${sourcePathList}</a:custGeom>`

function sourcePackage(geometry = custGeom): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Pathed"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `${geometry}<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></p:spPr>`
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

async function edited(change: (shape: { customGeometry?: unknown; preset?: string; bounds: { x: number; y: number; w: number; h: number } }) => void, geometry = custGeom) {
  const source = sourcePackage(geometry)
  const document = await importPptx(source)
  const shape = document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  change(shape as never)
  return slideXmlOf(await exportPptx(document, source))
}

const newPaths = {
  paths: [{ width: 200, height: 200, commands: [{ type: 'move' as const, x: 5, y: 5 }, { type: 'line' as const, x: 100, y: 100 }, { type: 'close' as const }] }],
}

describe('custom geometry source writeback', () => {
  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /** The loss: a path edit reached nothing, so the caller's new path silently vanished on save. */
  it('writes a changed path list', async () => {
    const slide = await edited((shape) => { shape.customGeometry = newPaths })

    expect(slide).toContain('<a:path w="200" h="200">')
    expect(slide).not.toContain('w="100" h="100"')
  })

  /** The point of replacing only `a:pathLst`: the model cannot express these and must not disturb them. */
  it('leaves the unmodeled siblings byte-identical', async () => {
    const slide = await edited((shape) => { shape.customGeometry = newPaths })

    expect(slide).toContain(siblings)
  })

  it('leaves the whole custom geometry alone when only the bounds change', async () => {
    const slide = await edited((shape) => { shape.bounds = { ...shape.bounds, x: 2222222 } })

    expect(slide).toContain('x="2222222"')
    expect(slide).toContain(custGeom)
  })

  /** Existing behaviour, kept: asking for a preset replaces the geometry node wholesale. */
  it('still swaps the whole node when the preset changes', async () => {
    const slide = await edited((shape) => { shape.preset = 'hexagon' })

    expect(slide).toContain('<a:prstGeom prst="hexagon">')
    expect(slide).not.toContain('custGeom')
  })

  /** Dropping the model path cannot be expressed — an empty `a:custGeom` is invalid — so nothing moves. */
  it('leaves the source alone when the model has no custom geometry', async () => {
    const slide = await edited((shape) => { delete shape.customGeometry })

    expect(slide).toContain(custGeom)
  })

  /**
   * The guard the older mirrors in this package lack. `sourceCustomGeometry` duplicates
   * `parseCustomGeometry` against a different XML representation, and a drift between them is quiet:
   * either an untouched path gets rewritten or an edit is swallowed.
   */
  it('agrees with the importer on the same XML', async () => {
    const imported = await importPptx(sourcePackage())
    const shape = imported.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    const geometry = descendants(scanXml(await slideXmlOf(sourcePackage())), 'custGeom')[0]

    expect(sourceCustomGeometry(geometry)).toEqual(shape.customGeometry)
  })

  it('agrees with the importer on an arc and a quadratic too', async () => {
    const geometryXml = '<a:custGeom><a:avLst/><a:pathLst><a:path>'
      + '<a:moveTo><a:pt x="1" y="2"/></a:moveTo>'
      + '<a:quadBezTo><a:pt x="3" y="4"/><a:pt x="5" y="6"/></a:quadBezTo>'
      + '<a:arcTo wR="7" hR="8" stAng="900000" swAng="1800000"/>'
      + '<a:close/></a:path></a:pathLst></a:custGeom>'
    const imported = await importPptx(sourcePackage(geometryXml))
    const shape = imported.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    const geometry = descendants(scanXml(await slideXmlOf(sourcePackage(geometryXml))), 'custGeom')[0]

    expect(sourceCustomGeometry(geometry)).toEqual(shape.customGeometry)
  })
})
