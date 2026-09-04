import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument, ShapeElement, StrokeStyle } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const navy = '<a:solidFill><a:srgbClr val="203864"/></a:solidFill>'

const tokens: StrokeStyle[] = [
  'dot', 'sysDot', 'dash', 'lgDash', 'sysDash',
  'dashDot', 'lgDashDot', 'sysDashDot', 'lgDashDotDot', 'sysDashDotDot',
]

function packageWith(dash: string): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Dashed"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/><a:ln w="76200">${navy}<a:prstDash val="${dash}"/></a:ln></p:spPr></p:sp>`
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

function documentWith(style: StrokeStyle): Ppt4aiDocument {
  const shape: ShapeElement = {
    id: 'shape_1',
    kind: 'shape',
    preset: 'rect',
    bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
    stroke: { color: { type: 'srgb', v: '203864' } },
    strokeWidth: 76200,
    strokeStyle: style,
  }
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_preset_dash',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1'] } },
    slideOrder: ['sld_1'],
    elements: { shape_1: shape },
  }
}

async function reimportedStyle(bytes: Uint8Array): Promise<StrokeStyle | undefined> {
  const document = await importPptx(bytes)
  const shape = document.elements[document.slides.sld_1?.elementIds[0] ?? '']
  if (shape?.kind !== 'shape') throw new Error('the generated shape did not import as a shape')
  return shape.strokeStyle
}

/**
 * The loss this slice fixes: every token except `dot` and `dash` used to reach the model collapsed,
 * so standalone generation wrote the collapsed word into the file — an edit nobody asked for.
 */
describe('preset dash tokens survive standalone generation', () => {
  it('writes and re-reads every token verbatim', async () => {
    for (const token of tokens) {
      const output = await createPptx(documentWith(token))

      expect(await slideOf(output)).toContain(`<a:prstDash val="${token}"/>`)
      expect(await reimportedStyle(output)).toBe(token)
    }
  })

  it('leaves solid implicit', async () => {
    const output = await createPptx(documentWith('solid'))

    expect(await slideOf(output)).not.toContain('prstDash')
    expect(await reimportedStyle(output)).toBeUndefined()
  })
})

describe('preset dash tokens in source writeback', () => {
  it('stays byte-identical when nothing is edited', async () => {
    for (const token of tokens) {
      const source = packageWith(token)

      expect(await exportPptx(await importPptx(source), source)).toEqual(source)
    }
  })

  /** Before the tokens were modeled this comparison could not tell `dash` from `lgDash`. */
  it('writes a change between two tokens that used to collapse together', async () => {
    const source = packageWith('dash')
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    shape.strokeStyle = 'lgDash'

    const slide = await slideOf(await exportPptx(document, source))

    expect(slide).toContain('<a:prstDash val="lgDash"/>')
  })

  it('removes the node when the style goes back to solid', async () => {
    const source = packageWith('lgDashDotDot')
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    shape.strokeStyle = 'solid'

    expect(await slideOf(await exportPptx(document, source))).not.toContain('prstDash')
  })
})
