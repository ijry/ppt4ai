import { importPptx } from '@ppt4ai/pptx-import'
import type { DashSegment, Ppt4aiDocument, ShapeElement, StrokeStyle } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const navy = '<a:solidFill><a:srgbClr val="203864"/></a:solidFill>'

const custom = { custom: [{ dash: 400000, space: 300000 }, { dash: 100000, space: 300000 }] }
const customXml = '<a:custDash><a:ds d="400000" sp="300000"/><a:ds d="100000" sp="300000"/></a:custDash>'

function documentWith(style: StrokeStyle | { custom: DashSegment[] }): Ppt4aiDocument {
  const shape: ShapeElement = {
    id: 'shape_1',
    kind: 'shape',
    preset: 'rect',
    bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
    stroke: { color: { type: 'srgb', v: '203864' } },
    strokeWidth: 38100,
    strokeStyle: style,
  }
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_custom_dash',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1'] } },
    slideOrder: ['sld_1'],
    elements: { shape_1: shape },
  }
}

function sourcePackage(dash: string): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Dashed"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/><a:ln w="38100">${navy}${dash}</a:ln></p:spPr>`
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

async function editedTo(sourceDash: string, style: StrokeStyle | { custom: DashSegment[] } | undefined) {
  const source = sourcePackage(sourceDash)
  const document = await importPptx(source)
  const shape = document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  if (style === undefined) delete shape.strokeStyle
  else shape.strokeStyle = style
  return slideXmlOf(await exportPptx(document, source))
}

describe('custom dash on standalone export', () => {
  it('writes the segment list after the fill', async () => {
    expect(await slideXmlOf(await createPptx(documentWith(custom))))
      .toContain(`<a:ln w="38100">${navy}${customXml}</a:ln>`)
  })

  it('comes back through import verbatim', async () => {
    const document = await importPptx(await createPptx(documentWith(custom)))
    const shape = document.elements[document.slides.sld_1?.elementIds[0] ?? '']
    if (shape?.kind !== 'shape') throw new Error('the generated shape did not import as a shape')

    expect(shape.strokeStyle).toEqual(custom)
  })

  it('still writes a preset token as a:prstDash', async () => {
    expect(await slideXmlOf(await createPptx(documentWith('lgDash')))).toContain('<a:prstDash val="lgDash"/>')
  })
})

/**
 * The bug this half of the slice fixes: `lineDashReplacements` only looked for `prstDash`, so a source
 * `custDash` was invisible to it. Setting a preset style inserted `prstDash` and left `custDash` in
 * place — two halves of one `EG_LineDashProperties` choice in the same `a:ln`.
 */
describe('custom dash in source writeback', () => {
  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage(customXml)

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  it('replaces a source custom dash with a preset, leaving only one node', async () => {
    const slide = await editedTo(customXml, 'lgDash')

    expect(slide).toContain('<a:prstDash val="lgDash"/>')
    expect(slide).not.toContain('custDash')
  })

  it('replaces a source preset with a custom dash, leaving only one node', async () => {
    const slide = await editedTo('<a:prstDash val="dash"/>', custom)

    expect(slide).toContain(customXml)
    expect(slide).not.toContain('prstDash')
  })

  it('rewrites a custom dash whose segments changed', async () => {
    const slide = await editedTo(customXml, { custom: [{ dash: 50000, space: 20000 }] })

    expect(slide).toContain('<a:custDash><a:ds d="50000" sp="20000"/></a:custDash>')
    expect(slide).not.toContain('d="400000"')
  })

  it('removes the custom dash when the style goes back to solid', async () => {
    expect(await editedTo(customXml, undefined)).not.toContain('custDash')
  })

  /** A malformed source stating both leaves exactly the wanted half behind. */
  it('cleans up a malformed line that states both forms', async () => {
    const both = `<a:prstDash val="dash"/>${customXml}`

    const toPreset = await editedTo(both, 'sysDot')
    expect(toPreset).toContain('<a:prstDash val="sysDot"/>')
    expect(toPreset).not.toContain('custDash')

    const toCustom = await editedTo(both, custom)
    expect(toCustom).toContain('custDash')
    expect(toCustom).not.toContain('prstDash')
  })
})
