import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument, ShapeElement, StrokeAlign, StrokeCompound } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const navy = '<a:solidFill><a:srgbClr val="203864"/></a:solidFill>'

const compounds: StrokeCompound[] = ['sng', 'dbl', 'thickThin', 'thinThick', 'tri']

function documentWith(compound?: StrokeCompound, align?: StrokeAlign): Ppt4aiDocument {
  const shape: ShapeElement = {
    id: 'shape_1',
    kind: 'shape',
    preset: 'rect',
    bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
    stroke: { color: { type: 'srgb', v: '203864' } },
    strokeWidth: 76200,
    ...(compound ? { strokeCompound: compound } : {}),
    ...(align ? { strokeAlign: align } : {}),
  }
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_compound',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1'] } },
    slideOrder: ['sld_1'],
    elements: { shape_1: shape },
  }
}

function sourcePackage(lineAttrs: string): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Bordered"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/><a:ln w="76200"${lineAttrs}>${navy}</a:ln></p:spPr>`
    + '</p:sp></p:spTree></p:cSld></p:sld>'
  const encode = (value: string) => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
  ])
}

async function lineOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const slide = new TextDecoder().decode(entries.get('ppt/slides/slide1.xml')!)
  return slide.slice(slide.indexOf('<a:ln'), slide.indexOf('</a:ln>') + 7)
}

async function editedTo(lineAttrs: string, change: (shape: ShapeElement) => void) {
  const source = sourcePackage(lineAttrs)
  const document = await importPptx(source)
  const shape = document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  change(shape)
  return lineOf(await exportPptx(document, source))
}

describe('compound line on standalone export', () => {
  /** The loss this slice fixes: both attributes were dropped, so dbl was written back as a single line. */
  it('writes both attributes', async () => {
    expect(await lineOf(await createPptx(documentWith('dbl', 'ctr'))))
      .toBe(`<a:ln w="76200" cmpd="dbl" algn="ctr">${navy}</a:ln>`)
  })

  it('writes neither when the model carries neither', async () => {
    expect(await lineOf(await createPptx(documentWith()))).toBe(`<a:ln w="76200">${navy}</a:ln>`)
  })

  it('brings every compound token back through import', async () => {
    for (const token of compounds) {
      const document = await importPptx(await createPptx(documentWith(token)))
      const shape = document.elements[document.slides.sld_1?.elementIds[0] ?? '']
      if (shape?.kind !== 'shape') throw new Error('the generated shape did not import as a shape')

      expect(shape.strokeCompound, token).toBe(token)
    }
  })
})

describe('compound line in source writeback', () => {
  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage(' cmpd="dbl" algn="in"')

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /** The trap the pattern fill slice hit: a modeled value the comparison cannot see gets rewritten. */
  it('leaves an untouched compound line alone when only the bounds change', async () => {
    const line = await editedTo(' cmpd="dbl" algn="in"', (shape) => {
      shape.bounds = { ...shape.bounds, x: 2222222 }
    })

    expect(line).toBe(`<a:ln w="76200" cmpd="dbl" algn="in">${navy}</a:ln>`)
  })

  it('writes a changed compound token in place', async () => {
    const line = await editedTo(' cmpd="dbl"', (shape) => { shape.strokeCompound = 'tri' })

    expect(line).toContain('cmpd="tri"')
    expect(line).not.toContain('dbl')
  })

  it('adds the attributes to a line that had none', async () => {
    const line = await editedTo('', (shape) => {
      shape.strokeCompound = 'thickThin'
      shape.strokeAlign = 'in'
    })

    expect(line).toContain('cmpd="thickThin"')
    expect(line).toContain('algn="in"')
  })

  it('removes an attribute the model no longer carries', async () => {
    const line = await editedTo(' cmpd="dbl" algn="in"', (shape) => {
      delete shape.strokeCompound
      delete shape.strokeAlign
    })

    expect(line).not.toContain('cmpd=')
    expect(line).not.toContain('algn=')
    expect(line).toContain('w="76200"')
  })
})
