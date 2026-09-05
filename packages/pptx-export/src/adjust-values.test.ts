import { importPptx } from '@ppt4ai/pptx-import'
import type { AdjustValue, Ppt4aiDocument, ShapeElement } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

const adjustValues: AdjustValue[] = [{ name: 'adj1', formula: 'val 25000' }, { name: 'adj2', formula: 'val 0' }]

function documentWith(values?: AdjustValue[]): Ppt4aiDocument {
  const shape: ShapeElement = {
    id: 'shape_1',
    kind: 'shape',
    preset: 'roundRect',
    bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
    ...(values ? { adjustValues: values } : {}),
  }
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_adjust',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1'] } },
    slideOrder: ['sld_1'],
    elements: { shape_1: shape },
  }
}

function sourcePackage(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Adjusted"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>'
    + '</p:spPr></p:sp></p:spTree></p:cSld></p:sld>'
  const encode = (value: string) => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
  ])
}

async function geometryOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const slide = new TextDecoder().decode(entries.get('ppt/slides/slide1.xml')!)
  return slide.slice(slide.indexOf('<a:prstGeom'), slide.indexOf('</a:prstGeom>') + 13)
}

describe('adjust values on standalone export', () => {
  /** The loss this slice fixes: the list was written empty, resetting the shape to its default form. */
  it('writes every adjust value the model holds', async () => {
    expect(await geometryOf(await createPptx(documentWith(adjustValues)))).toBe(
      '<a:prstGeom prst="roundRect"><a:avLst>'
      + '<a:gd name="adj1" fmla="val 25000"/><a:gd name="adj2" fmla="val 0"/>'
      + '</a:avLst></a:prstGeom>',
    )
  })

  /** The empty element is what Office writes for a shape on its defaults, and what this wrote before. */
  it('writes a self-closing empty list when the model holds none', async () => {
    expect(await geometryOf(await createPptx(documentWith())))
      .toBe('<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>')
  })

  it('brings the values back through import verbatim', async () => {
    const document = await importPptx(await createPptx(documentWith(adjustValues)))
    const shape = document.elements[document.slides.sld_1?.elementIds[0] ?? '']
    if (shape?.kind !== 'shape') throw new Error('the generated shape did not import as a shape')

    expect(shape.adjustValues).toEqual(adjustValues)
  })

  it('stays deterministic across repeated exports', async () => {
    const document = documentWith(adjustValues)

    expect(await createPptx(document)).toEqual(await createPptx(structuredClone(document)))
  })
})

describe('adjust values in source writeback', () => {
  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /** The writeback never rewrites `a:prstGeom` for a bounds change, and the model now agrees with it. */
  it('leaves the source list alone when only the bounds change', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    shape.bounds = { ...shape.bounds, x: 2222222 }

    expect(await geometryOf(await exportPptx(document, source)))
      .toBe('<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>')
  })
})
