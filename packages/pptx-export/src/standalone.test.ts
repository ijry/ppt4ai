import { importPptx } from '@ppt4ai/pptx-import'
import type { AssetAdapter, ImageElement, Ppt4aiDocument, ShapeElement, TableElement, TextElement } from '@ppt4ai/model'
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

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x10,
  0x08, 0x06, 0x00, 0x00, 0x00,
])

const jpegBytes = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x18, 0x00, 0x28,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
])

const pngImageOne: ImageElement = {
  id: 'image_1',
  kind: 'image',
  bounds: { x: 500000, y: 500000, w: 2500000, h: 1500000 },
  assetId: 'asset_png',
  transform: { rotation: 60000, flipH: true },
  sourceCrop: { left: 1000, right: 2000 },
  maskPreset: 'ellipse',
  effects: [{ type: 'grayscl' }],
}

const pngImageTwo: ImageElement = {
  ...structuredClone(pngImageOne),
  id: 'image_2',
  bounds: { x: 3500000, y: 500000, w: 2500000, h: 1500000 },
}

const jpegImage: ImageElement = {
  id: 'image_3',
  kind: 'image',
  bounds: { x: 6500000, y: 500000, w: 2500000, h: 1500000 },
  assetId: 'asset_jpeg',
}

const imageDocument: Ppt4aiDocument = {
  ...emptyDocument,
  slides: {
    sld_1: { id: 'sld_1', elementIds: [pngImageOne.id, jpegImage.id] },
    sld_2: { id: 'sld_2', elementIds: [pngImageTwo.id] },
  },
  elements: { [pngImageOne.id]: pngImageOne, [pngImageTwo.id]: pngImageTwo, [jpegImage.id]: jpegImage },
  assets: {
    asset_png: { id: 'asset_png', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 },
    asset_jpeg: { id: 'asset_jpeg', mimeType: 'image/jpeg', pixelWidth: 40, pixelHeight: 24 },
  },
  slideOrder: ['sld_1', 'sld_2'],
}

class RecordingStandaloneAssetAdapter implements AssetAdapter {
  readonly requests: string[] = []

  constructor(readonly assets: Map<string, Uint8Array>) {}

  async get(assetId: string): Promise<Uint8Array | undefined> {
    this.requests.push(assetId)
    return this.assets.get(assetId)
  }

  async put(): Promise<void> {}
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

  it('serializes the selected document theme in standalone output', async () => {
    const themedDocument = structuredClone(emptyDocument)
    themedDocument.themes = {
      theme_custom: {
        id: 'theme_custom',
        colors: {
          dk1: { type: 'system', v: '010203' },
          accent1: { type: 'srgb', v: '123456' },
          accent2: { type: 'scrgb', v: '100000,0,50000', transforms: [{ type: 'alpha', value: 75000 }] },
        },
      },
    }
    themedDocument.masters = {
      master_custom: { id: 'master_custom', themeId: 'theme_custom' },
    }
    const before = structuredClone(themedDocument)

    const first = await createPptx(themedDocument)
    const second = await createPptx(structuredClone(themedDocument))
    const entries = await packageEntries(first)
    const themeBytes = entries.get('ppt/theme/theme1.xml')
    if (!themeBytes) throw new Error('generated theme entry missing')
    const themeXml = new TextDecoder().decode(themeBytes)
    const imported = await importPptx(first)
    const importedThemeId = imported.masters?.mst_1?.themeId

    expect(first).toEqual(second)
    expect(themeXml).toContain('<a:dk1><a:sysClr val="windowText" lastClr="010203"/></a:dk1>')
    expect(themeXml).toContain('<a:accent1><a:srgbClr val="123456"/></a:accent1>')
    expect(themeXml).toContain('<a:accent2><a:scrgbClr r="100000" g="0" b="50000"><a:alpha val="75000"/></a:scrgbClr></a:accent2>')
    expect(themeXml).toContain('<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>')
    expect(imported.themes?.[importedThemeId ?? '']?.colors).toMatchObject({
      dk1: { type: 'system', v: '010203' },
      accent1: { type: 'srgb', v: '123456' },
      accent2: { type: 'scrgb', v: '100000,0,50000', transforms: [{ type: 'alpha', value: 75000 }] },
    })
    expect(themedDocument).toEqual(before)
  })

  it('serializes null theme colors as Office defaults in standalone output', async () => {
    const themedDocument = structuredClone(emptyDocument)
    themedDocument.themes = {
      theme_reset: {
        id: 'theme_reset',
        colors: { accent1: null },
      },
    }
    themedDocument.masters = {
      master_reset: { id: 'master_reset', themeId: 'theme_reset' },
    }
    const before = structuredClone(themedDocument)

    const first = await createPptx(themedDocument)
    const second = await createPptx(themedDocument)
    const entries = await packageEntries(first)
    const themeXml = new TextDecoder().decode(entries.get('ppt/theme/theme1.xml'))
    const imported = await importPptx(first)
    const themeId = imported.masters?.mst_1?.themeId

    expect(first).toEqual(second)
    expect(themeXml).toContain('<a:accent1><a:srgbClr val="4472C4"/></a:accent1>')
    expect(imported.themes?.[themeId ?? '']?.colors.accent1).toEqual({ type: 'srgb', v: '4472C4' })
    expect(themedDocument).toEqual(before)
  })

  it('serializes theme fonts and reads them back', async () => {
    const themedDocument = structuredClone(emptyDocument)
    themedDocument.themes = {
      theme_fonts: {
        id: 'theme_fonts',
        colors: {},
        fonts: {
          major: { latin: 'Cambria "Display" & Co', ea: '宋体' },
          minor: { latin: null },
        },
      },
    }
    themedDocument.masters = {
      master_fonts: { id: 'master_fonts', themeId: 'theme_fonts' },
    }
    const before = structuredClone(themedDocument)

    const output = await createPptx(themedDocument)
    const entries = await packageEntries(output)
    const themeXml = new TextDecoder().decode(entries.get('ppt/theme/theme1.xml'))
    const imported = await importPptx(output)
    const themeId = imported.masters?.mst_1?.themeId

    expect(themeXml).toContain('<a:majorFont><a:latin typeface="Cambria &quot;Display&quot; &amp; Co"/><a:ea typeface="宋体"/><a:cs typeface=""/></a:majorFont>')
    // A null slot writes the built-in default, matching what the renderer resolves `+mn-lt` to.
    expect(themeXml).toContain('<a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>')
    expect(imported.themes?.[themeId ?? '']?.fonts).toEqual({
      major: { latin: 'Cambria "Display" & Co', ea: '宋体' },
      minor: { latin: 'Aptos' },
    })
    expect(themedDocument).toEqual(before)
  })

  it('falls back to the built-in theme fonts when the model carries none', async () => {
    const output = await createPptx(structuredClone(emptyDocument))
    const entries = await packageEntries(output)
    const themeXml = new TextDecoder().decode(entries.get('ppt/theme/theme1.xml'))

    expect(themeXml).toContain('<a:fontScheme name="Office">'
      + '<a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
      + '<a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>'
      + '</a:fontScheme>')
  })

  it('selects the first referenced theme by deterministic master key order', async () => {
    const themedDocument = structuredClone(emptyDocument)
    themedDocument.masters = {
      master_z: { id: 'master_z', themeId: 'theme_z' },
      master_a: { id: 'master_a', themeId: 'theme_a' },
    }
    themedDocument.themes = {
      theme_z: { id: 'theme_z', colors: { accent1: { type: 'srgb', v: '222222' } } },
      theme_a: { id: 'theme_a', colors: { accent1: { type: 'srgb', v: '111111' } } },
    }

    const output = await createPptx(themedDocument)
    const entries = await packageEntries(output)
    const themeBytes = entries.get('ppt/theme/theme1.xml')
    if (!themeBytes) throw new Error('generated theme entry missing')

    expect(new TextDecoder().decode(themeBytes)).toContain('<a:accent1><a:srgbClr val="111111"/></a:accent1>')
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
    // The break inside the first run round-trips in place now, and the paragraph split shows up as
    // its own newline. The old value put every newline at the end, which no source could produce.
    expect(importedText).toMatchObject({ kind: 'text', bounds: text.bounds, text: 'Hello & \nWorld tail \nNext' })
    expect(shapeTextDocument).toEqual(before)
  })

  it('serializes shape and text rotations in OOXML units', async () => {
    const rotatedDocument = structuredClone(shapeTextDocument)
    const rotatedShape = rotatedDocument.elements[shape.id]
    const rotatedText = rotatedDocument.elements[text.id]
    if (!rotatedShape || rotatedShape.kind !== 'shape' || !rotatedText || rotatedText.kind !== 'text') throw new Error('rotation fixtures are missing')
    rotatedShape.rotation = -5400000
    rotatedText.rotation = 2700000
    const before = structuredClone(rotatedDocument)

    const output = await createPptx(rotatedDocument)
    const xml = await slideXml(output)
    const imported = await importPptx(output)
    const importedIds = imported.slides.sld_1?.elementIds ?? []
    const importedShape = imported.elements[importedIds[0] ?? '']
    const importedText = imported.elements[importedIds[1] ?? '']

    expect(xml).toContain('<a:xfrm rot="-5400000"><a:off x="1000000" y="500000"/><a:ext cx="3000000" cy="1500000"/></a:xfrm>')
    expect(xml).toContain('<a:xfrm rot="2700000"><a:off x="4500000" y="500000"/><a:ext cx="5000000" cy="2500000"/></a:xfrm>')
    expect(importedShape).toMatchObject({ kind: 'shape', rotation: -5400000 })
    expect(importedText).toMatchObject({ kind: 'text', rotation: 2700000 })
    expect(rotatedDocument).toEqual(before)
  })

  it('round-trips a table rotation through the graphic frame transform', async () => {
    const rotatedTable: TableElement = { ...table, rotation: 1200000 }
    const document: Ppt4aiDocument = {
      ...emptyDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: [rotatedTable.id] } },
      elements: { [rotatedTable.id]: rotatedTable },
    }
    const before = structuredClone(document)

    const output = await createPptx(document)
    const xml = await slideXml(output)
    const imported = await importPptx(output)
    const importedTableId = imported.slides.sld_1?.elementIds[0] ?? ''

    expect(xml).toContain('<p:xfrm rot="1200000">')
    expect(imported.elements[importedTableId]).toMatchObject({ kind: 'table', rotation: 1200000 })
    expect(document).toEqual(before)
  })

  it('omits the graphic frame rot attribute for an unrotated table', async () => {
    const output = await createPptx(tableDocument)
    const xml = await slideXml(output)

    expect(xml).toContain('<p:xfrm>')
    expect(xml).not.toContain('rot=')
  })

  it('round-trips shape and text flips', async () => {
    const flippedDocument = structuredClone(shapeTextDocument)
    const flippedShape = flippedDocument.elements[shape.id]
    const flippedText = flippedDocument.elements[text.id]
    if (!flippedShape || flippedShape.kind !== 'shape' || !flippedText || flippedText.kind !== 'text') throw new Error('flip fixtures are missing')
    flippedShape.flipH = true
    flippedShape.flipV = true
    flippedText.flipV = true

    const output = await createPptx(flippedDocument)
    const xml = await slideXml(output)
    const imported = await importPptx(output)
    const importedIds = imported.slides.sld_1?.elementIds ?? []

    expect(xml).toContain('<a:xfrm flipH="1" flipV="1">')
    expect(xml).toContain('<a:xfrm flipV="1">')
    expect(imported.elements[importedIds[0] ?? '']).toMatchObject({ kind: 'shape', flipH: true, flipV: true })
    expect(imported.elements[importedIds[1] ?? '']).toMatchObject({ kind: 'text', flipV: true })
  })

  it('keeps a flip alongside a rotation on one transform', async () => {
    const document = structuredClone(shapeTextDocument)
    const rotatedShape = document.elements[shape.id]
    if (!rotatedShape || rotatedShape.kind !== 'shape') throw new Error('flip fixtures are missing')
    rotatedShape.rotation = 2700000
    rotatedShape.flipH = true

    const xml = await slideXml(await createPptx(document))

    expect(xml).toContain('<a:xfrm rot="2700000" flipH="1">')
  })

  it('round-trips a table flip through the graphic frame transform', async () => {
    const flippedTable: TableElement = { ...table, flipV: true }
    const document: Ppt4aiDocument = {
      ...emptyDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: [flippedTable.id] } },
      elements: { [flippedTable.id]: flippedTable },
    }

    const output = await createPptx(document)
    const imported = await importPptx(output)

    expect(await slideXml(output)).toContain('<p:xfrm flipV="1">')
    expect(imported.elements[imported.slides.sld_1?.elementIds[0] ?? '']).toMatchObject({ kind: 'table', flipV: true })
  })

  it('omits flip attributes entirely when neither axis is set', async () => {
    const xml = await slideXml(await createPptx(shapeTextDocument))

    expect(xml).not.toContain('flipH=')
    expect(xml).not.toContain('flipV=')
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

  it('materializes deduplicated image assets and writes slide-local relationships', async () => {
    const beforeDocument = structuredClone(imageDocument)
    const beforePng = pngBytes.slice()
    const beforeJpeg = jpegBytes.slice()
    const adapter = new RecordingStandaloneAssetAdapter(new Map([
      ['asset_png', pngBytes],
      ['asset_jpeg', jpegBytes],
    ]))
    const output = await createPptx(imageDocument, { assetAdapter: adapter })
    const repeated = await createPptx(structuredClone(imageDocument), {
      assetAdapter: new RecordingStandaloneAssetAdapter(new Map([
        ['asset_png', pngBytes],
        ['asset_jpeg', jpegBytes],
      ])),
    })
    const entries = await packageEntries(output)
    const firstRelationships = new TextDecoder().decode(entries.get('ppt/slides/_rels/slide1.xml.rels'))
    const secondRelationships = new TextDecoder().decode(entries.get('ppt/slides/_rels/slide2.xml.rels'))
    const imported = await importPptx(output)
    const importedFirst = imported.elements[imported.slides.sld_1?.elementIds[0] ?? '']
    const importedSecond = imported.elements[imported.slides.sld_2?.elementIds[0] ?? '']

    expect(output).toEqual(repeated)
    expect(adapter.requests).toEqual(['asset_png', 'asset_jpeg'])
    expect([...entries.keys()].slice(-2)).toEqual(['ppt/media/image1.png', 'ppt/media/image2.jpg'])
    expect(entries.get('ppt/media/image1.png')).toEqual(pngBytes)
    expect(entries.get('ppt/media/image2.jpg')).toEqual(jpegBytes)
    expect(firstRelationships).toContain('Id="rId2"')
    expect(firstRelationships).toContain('Target="../media/image1.png"')
    expect(firstRelationships).toContain('Id="rId3"')
    expect(firstRelationships).toContain('Target="../media/image2.jpg"')
    expect(secondRelationships).toContain('Id="rId2"')
    expect(secondRelationships).toContain('Target="../media/image1.png"')
    expect(secondRelationships).not.toContain('rId3')
    expect(importedFirst).toMatchObject({ kind: 'image', assetId: 'asset_ppt_media_image1_png', bounds: pngImageOne.bounds })
    expect(importedSecond).toMatchObject({ kind: 'image', assetId: 'asset_ppt_media_image1_png', bounds: pngImageTwo.bounds })
    expect(imported.assets?.asset_ppt_media_image1_png).toMatchObject({ mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 })
    expect(imported.assets?.asset_ppt_media_image2_jpg).toMatchObject({ mimeType: 'image/jpeg', pixelWidth: 40, pixelHeight: 24 })
    expect(imageDocument).toEqual(beforeDocument)
    expect(pngBytes).toEqual(beforePng)
    expect(jpegBytes).toEqual(beforeJpeg)
  })

  it('rejects an image without an asset adapter before writing a package', async () => {
    const before = structuredClone(imageDocument)
    await expect(createPptx(imageDocument)).rejects.toThrow('PPTX generation asset adapter missing: asset_png')
    expect(imageDocument).toEqual(before)
  })

  it('rejects missing image bytes and MIME mismatches with stable asset errors', async () => {
    const missingAdapter = new RecordingStandaloneAssetAdapter(new Map())
    const before = structuredClone(imageDocument)
    await expect(createPptx(imageDocument, { assetAdapter: missingAdapter })).rejects.toThrow('PPTX generation asset bytes missing: asset_png')
    expect(missingAdapter.requests).toEqual(['asset_png'])
    expect(imageDocument).toEqual(before)

    const missingMetadataDocument = structuredClone(imageDocument)
    delete missingMetadataDocument.assets!.asset_png
    const metadataAdapter = new RecordingStandaloneAssetAdapter(new Map([['asset_png', pngBytes]]))
    await expect(createPptx(missingMetadataDocument, { assetAdapter: metadataAdapter })).rejects.toThrow('asset_png')
    expect(metadataAdapter.requests).toEqual([])

    const mismatchDocument = structuredClone(imageDocument)
    mismatchDocument.assets!.asset_png!.mimeType = 'image/jpeg'
    const mismatchBefore = structuredClone(mismatchDocument)
    const mismatchAdapter = new RecordingStandaloneAssetAdapter(new Map([['asset_png', pngBytes]]))
    await expect(createPptx(mismatchDocument, { assetAdapter: mismatchAdapter })).rejects.toThrow('PPTX generation asset bytes MIME mismatch: asset_png')
    expect(mismatchAdapter.requests).toEqual(['asset_png'])
    expect(mismatchDocument).toEqual(mismatchBefore)
  })

  it('rejects unsupported groups and validates slide mappings before asset reads', async () => {
    const groupDocument: Ppt4aiDocument = {
      ...emptyDocument,
      slides: { sld_1: { id: 'sld_1', elementIds: ['group_1'] } },
      elements: { group_1: { id: 'group_1', kind: 'group', bounds: { x: 0, y: 0, w: 100, h: 100 }, childIds: [] } },
    }
    await expect(createPptx(groupDocument)).rejects.toThrow('PPTX generation unsupported element kind: group')

    const invalidDocument = structuredClone(imageDocument)
    invalidDocument.slideOrder = ['missing_slide']
    const adapter = new RecordingStandaloneAssetAdapter(new Map([['asset_png', pngBytes]]))
    await expect(createPptx(invalidDocument, { assetAdapter: adapter })).rejects.toThrow('PPTX generation document invalid:')
    expect(adapter.requests).toEqual([])
  })

  it('rejects unsupported XML control characters without mutating the document', async () => {
    const invalidDocument = structuredClone(shapeTextDocument)
    const invalidText = invalidDocument.elements[text.id]
    if (!invalidText || invalidText.kind !== 'text' || !invalidText.body) throw new Error('fixture text body missing')
    invalidText.body.paragraphs[0]!.runs[0]!.text = `bad${String.fromCodePoint(1)}`
    const before = structuredClone(invalidDocument)
    await expect(createPptx(invalidDocument)).rejects.toThrow('PPTX generation unsupported XML control character')
    expect(invalidDocument).toEqual(before)
  })
})
