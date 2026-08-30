import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument, ShapeElement, TableElement, TextElement } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

const emptyDocument: Ppt4aiDocument = {
  format: 'ppt4ai',
  version: 1,
  id: 'dck_standalone',
  page: { w: 12192000, h: 6858000 },
  slides: { sld_1: { id: 'sld_1', elementIds: [] } },
  elements: {},
  slideOrder: ['sld_1'],
}

async function packageEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
}

async function slideXml(bytes: Uint8Array, slideNumber = 1): Promise<string> {
  const entries = await packageEntries(bytes)
  const data = entries.get(`ppt/slides/slide${slideNumber}.xml`)
  if (!data) throw new Error(`missing generated slide ${slideNumber}`)
  return new TextDecoder().decode(data)
}

const shape: ShapeElement = {
  id: 'shape_1',
  kind: 'shape',
  preset: 'roundRect',
  bounds: { x: 1000000, y: 500000, w: 3000000, h: 1500000 },
  fill: { color: { type: 'srgb', v: '112233' } },
  stroke: { color: { type: 'system', v: '445566' } },
  placeholder: 'title:2',
}

const text: TextElement = {
  id: 'text_1',
  kind: 'text',
  bounds: { x: 4500000, y: 500000, w: 5000000, h: 2500000 },
  fill: { color: { type: 'scheme', v: 'accent1' } },
  stroke: { color: { type: 'preset', v: 'blue' } },
  placeholder: 'body',
  body: {
    bodyPr: {
      insets: { left: 100000, top: 200000, right: 300000, bottom: 400000 },
      verticalAlign: 'middle',
      vertical: 'vertical',
      wrap: 'none',
      autofit: { type: 'shrink', minFontScale: 50000 },
    },
    paragraphs: [
      {
        attrs: {
          align: 'center',
          level: 2,
          marginLeft: 25000,
          indent: 50000,
          lineSpacing: 120000,
          spaceBefore: 30000,
          spaceAfter: 40000,
          bullet: { type: 'char', char: String.fromCodePoint(0x2022) },
        },
        runs: [
          {
            text: 'Hello & \nWorld',
            marks: {
              fontFamily: 'Aptos',
              fontSize: 18,
              bold: true,
              italic: true,
              underline: 'single',
              baseline: 25000,
              color: { color: { type: 'srgb', v: 'FF0000' } },
            },
          },
          { text: ' tail ', marks: { fontFamily: 'Arial' } },
        ],
      },
      {
        attrs: { bullet: { type: 'autoNum', scheme: 'alphaUpper', startAt: 3 } },
        runs: [{ text: 'Next' }],
      },
    ],
  },
}

const shapeTextDocument: Ppt4aiDocument = {
  ...emptyDocument,
  slides: { sld_1: { id: 'sld_1', elementIds: [shape.id, text.id] } },
  elements: { [shape.id]: shape, [text.id]: text },
}

const table: TableElement = {
  id: 'table_1',
  kind: 'table',
  bounds: { x: 1000000, y: 3500000, w: 6000000, h: 2400000 },
  columns: [1500000, 2000000, 2500000],
  fill: { color: { type: 'srgb', v: 'F2F2F2' } },
  rows: [
    {
      height: 1000000,
      cells: [
        {
          column: 0,
          rowSpan: 2,
          body: { paragraphs: [{ runs: [{ text: 'Vertical' }] }] },
          borders: { left: { color: { type: 'srgb', v: 'FF0000' }, width: 12700, style: 'solid' } },
        },
        {
          column: 1,
          colSpan: 2,
          body: { paragraphs: [{ runs: [{ text: 'Header' }] }] },
          fill: { color: { type: 'srgb', v: 'FFF2CC' } },
        },
      ],
    },
    {
      height: 1100000,
      cells: [
        { column: 1, body: { paragraphs: [{ runs: [{ text: 'Left' }] }] } },
        { column: 2, body: { paragraphs: [{ runs: [{ text: 'Right' }] }] } },
      ],
    },
  ],
}

const tableDocument: Ppt4aiDocument = {
  ...emptyDocument,
  slides: { sld_1: { id: 'sld_1', elementIds: [table.id] } },
  elements: { [table.id]: table },
}

describe('createPptx', () => {
  it('creates a deterministic importable OPC skeleton without source bytes', async () => {
    const first = await createPptx(emptyDocument)
    const second = await createPptx(structuredClone(emptyDocument))
    const entries = await packageEntries(first)
    const imported = await importPptx(first)

    expect(first).toEqual(second)
    expect([...entries.keys()]).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'docProps/app.xml',
      'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', 'ppt/presProps.xml',
      'ppt/viewProps.xml', 'ppt/theme/theme1.xml', 'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels', 'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels', 'ppt/slides/slide1.xml',
      'ppt/slides/_rels/slide1.xml.rels',
    ])
    expect(imported.page).toEqual(emptyDocument.page)
    expect(imported.slideOrder).toEqual(['sld_1'])
    expect(imported.slides.sld_1?.elementIds).toEqual([])
  })

  it('serializes top-level shapes and text bodies in document order', async () => {
    const before = structuredClone(shapeTextDocument)
    const first = await createPptx(shapeTextDocument)
    const second = await createPptx(structuredClone(shapeTextDocument))
    const xml = await slideXml(first)
    const imported = await importPptx(first)
    const importedIds = imported.slides.sld_1?.elementIds ?? []
    const importedShape = imported.elements[importedIds[0] ?? '']
    const importedText = imported.elements[importedIds[1] ?? '']

    expect(first).toEqual(second)
    expect(xml).toContain('<a:off x="1000000" y="500000"/>')
    expect(xml).toContain('<a:ext cx="3000000" cy="1500000"/>')
    expect(xml).toContain('<a:prstGeom prst="roundRect">')
    expect(xml).toContain('<a:solidFill><a:srgbClr val="112233"/></a:solidFill>')
    expect(xml).toContain('<a:ln><a:solidFill><a:sysClr val="windowText" lastClr="445566"/></a:solidFill></a:ln>')
    expect(xml).toContain('<p:ph type="title" idx="2"/>')
    expect(xml).toContain('<a:prstGeom prst="rect">')
    expect(xml).toContain('<a:bodyPr lIns="100000" tIns="200000" rIns="300000" bIns="400000" wrap="none" anchor="ctr" vert="vert">')
    expect(xml).toContain('<a:normAutofit fontScale="50000"/>')
    expect(xml).toContain('<a:pPr algn="ctr" lvl="2" marL="25000" indent="50000"')
    expect(xml).toContain('<a:buChar char="\u2022"/>')
    expect(xml).toContain('<a:buAutoNum type="alphaUcPeriod" startAt="3"/>')
    expect(xml).toContain('<a:rPr sz="1800" b="1" i="1" u="sng" baseline="25000">')
    expect(xml).toContain('<a:t xml:space="preserve">Hello &amp; </a:t>')
    expect(xml).toContain('<a:br/>')
    expect(xml).toContain('<a:t xml:space="preserve"> tail </a:t>')
    expect(importedShape).toMatchObject({ kind: 'shape', bounds: shape.bounds, preset: shape.preset })
    expect(importedText).toMatchObject({ kind: 'text', bounds: text.bounds, text: 'Hello & World tail Next\n' })
    expect(shapeTextDocument).toEqual(before)
  })

  it('serializes table elements as graphic frames and round-trips their grid', async () => {
    const before = structuredClone(tableDocument)
    const output = await createPptx(tableDocument)
    const xml = await slideXml(output)
    const imported = await importPptx(output)
    const importedTableId = imported.slides.sld_1?.elementIds[0] ?? ''

    expect(xml).toContain('uri="http://schemas.openxmlformats.org/drawingml/2006/table"')
    expect(xml).toContain('gridSpan="2"')
    expect(xml).toContain('vMerge="1"')
    expect(xml).toContain('<a:off x="1000000" y="3500000"/>')
    expect(xml).toContain('<a:ext cx="6000000" cy="2400000"/>')
    expect(imported.elements[importedTableId]).toMatchObject({
      kind: 'table',
      columns: table.columns,
      rows: [
        { height: 1000000, cells: [{ column: 0, rowSpan: 2 }, { column: 1, colSpan: 2, body: { paragraphs: [{ runs: [{ text: 'Header' }] }] } }] },
        { height: 1100000, cells: [{ column: 1, body: { paragraphs: [{ runs: [{ text: 'Left' }] }] } }, { column: 2, body: { paragraphs: [{ runs: [{ text: 'Right' }] }] } }] },
      ],
    })
    expect(tableDocument).toEqual(before)
  })
})
