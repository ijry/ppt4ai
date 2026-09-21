import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument, ShapeElement } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const navy = '<a:solidFill><a:srgbClr val="203864"/></a:solidFill>'

function documentWith(limit?: number, join: 'miter' | 'round' = 'miter'): Ppt4aiDocument {
  const shape: ShapeElement = {
    id: 'shape_1',
    kind: 'shape',
    preset: 'rect',
    bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
    stroke: { color: { type: 'srgb', v: '203864' } },
    strokeWidth: 76200,
    strokeJoin: join,
    ...(limit === undefined ? {} : { strokeMiterLimit: limit }),
  }
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_miter',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1'] } },
    slideOrder: ['sld_1'],
    elements: { shape_1: shape },
  }
}

function sourcePackage(joinXml: string): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Mitred"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/><a:ln w="76200">${navy}${joinXml}</a:ln></p:spPr>`
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

describe('miter limit on standalone export', () => {
  /** The loss this slice fixes: the limit was dropped and a bare <a:miter/> written in its place. */
  it('writes the limit on the corner element', async () => {
    expect(await lineOf(await createPptx(documentWith(800000))))
      .toBe(`<a:ln w="76200">${navy}<a:miter lim="800000"/></a:ln>`)
  })

  it('writes a bare corner when the model states no limit', async () => {
    expect(await lineOf(await createPptx(documentWith()))).toContain('<a:miter/>')
  })

  /** Only `a:miter` takes the attribute, so a limit on another corner has nowhere to go. */
  it('drops a limit that sits on a rounded corner', async () => {
    const line = await lineOf(await createPptx(documentWith(800000, 'round')))

    expect(line).toContain('<a:round/>')
    expect(line).not.toContain('lim')
  })

  it('brings the limit back through import', async () => {
    const document = await importPptx(await createPptx(documentWith(800000)))
    const shape = document.elements[document.slides.sld_1?.elementIds[0] ?? '']
    if (shape?.kind !== 'shape') throw new Error('the generated shape did not import as a shape')

    expect(shape.strokeMiterLimit).toBe(800000)
  })
})

describe('miter limit in source writeback', () => {
  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage('<a:miter lim="800000"/>')

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /** The corner element is only rewritten when the corner itself changes, and the model agrees with it. */
  it('leaves the source limit alone when only the bounds change', async () => {
    const source = sourcePackage('<a:miter lim="800000"/>')
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    shape.bounds = { ...shape.bounds, x: 2222222 }

    expect(await lineOf(await exportPptx(document, source))).toContain('<a:miter lim="800000"/>')
  })
})
