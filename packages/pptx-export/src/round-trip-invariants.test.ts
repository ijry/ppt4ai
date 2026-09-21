import { importPptx } from '@ppt4ai/pptx-import'
import type { AssetAdapter, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x10,
  0x08, 0x06, 0x00, 0x00, 0x00,
])

const adapter: AssetAdapter = { get: async (): Promise<Uint8Array> => pngBytes, put: async (): Promise<void> => {} }

/**
 * Everything this project models on a shape, a text box, a table and a slide background, in one document.
 * The point is not any single field but the *symmetry*: `createPptx` writes the model and `importPptx`
 * reads it back, and a value that only one of the two knows about is exactly the bug shape this repo has
 * hit six times (a narrowed enum on the way in, a verbatim write on the way out).
 *
 * Asset ids are the one expected difference: the importer derives them from the media part path it
 * generated, so they are compared through the fill's presence rather than by value.
 */
function kitchenSink(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_round_trip',
    page: { w: 12192000, h: 6858000 },
    slides: {
      sld_1: {
        id: 'sld_1',
        elementIds: ['shape_1', 'text_1', 'table_1'],
        background: { fill: { color: { type: 'srgb', v: '1F3864' } } },
      },
    },
    slideOrder: ['sld_1'],
    elements: {
      shape_1: {
        id: 'shape_1',
        kind: 'shape',
        preset: 'chevron',
        bounds: { x: 100000, y: 100000, w: 2000000, h: 1000000 },
        rotation: 2700000,
        flipH: true,
        fill: {
          color: { type: 'srgb', v: '4472C4', transforms: [{ type: 'lumMod', value: 75000 }, { type: 'satMod', value: 160000 }, { type: 'comp' }] },
        },
        stroke: { color: { type: 'srgb', v: '203864' } },
        strokeWidth: 76200,
        strokeStyle: 'lgDashDot',
        strokeCap: 'rnd',
        strokeJoin: 'bevel',
        shadow: { color: { type: 'srgb', v: '000000' }, blurRadius: 50800, distance: 38100, direction: 2700000 },
      },
      text_1: {
        id: 'text_1',
        kind: 'text',
        bounds: { x: 100000, y: 1500000, w: 3000000, h: 1000000 },
        customGeometry: {
          paths: [{
            width: 100,
            height: 100,
            commands: [
              { type: 'move', x: 0, y: 100 },
              { type: 'cubic', x1: 20, y1: 40, x2: 60, y2: 10, x: 100, y: 100 },
              { type: 'close' },
            ],
          }],
        },
        stroke: { color: { type: 'srgb', v: '203864' } },
        body: {
          paragraphs: [{
            attrs: { bullet: { type: 'autoNum', scheme: 'romanUcParenR', startAt: 3 } },
            runs: [{ text: 'Numbered', marks: { underline: 'dbl', fontSize: 18 } }],
          }],
        },
      },
      table_1: {
        id: 'table_1',
        kind: 'table',
        bounds: { x: 4000000, y: 100000, w: 2000000, h: 1000000 },
        columns: [2000000],
        rows: [{
          height: 1000000,
          cells: [{
            column: 0,
            body: { paragraphs: [{ runs: [{ text: 'Cell' }] }] },
            pictureFill: { assetId: 'asset_photo', sourceCrop: { left: 10000 } },
            borders: { left: { color: { type: 'srgb', v: 'FF0000' }, width: 12700, style: 'sysDashDot' } },
          }],
        }],
      },
    },
    assets: { asset_photo: { id: 'asset_photo', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 } },
  }
}

async function roundTrip(document: Ppt4aiDocument) {
  const imported = await importPptx(await createPptx(document, { assetAdapter: adapter }))
  const ids = imported.slides.sld_1?.elementIds ?? []
  const shape = imported.elements[ids[0] ?? '']
  const text = imported.elements[ids[1] ?? '']
  const table = imported.elements[ids[2] ?? '']
  if (shape?.kind !== 'shape') throw new Error('the shape did not come back as a shape')
  if (text?.kind !== 'text') throw new Error('the text did not come back as text')
  if (table?.kind !== 'table') throw new Error('the table did not come back as a table')
  return { imported, shape, text, table }
}

describe('standalone round-trip invariants', () => {
  it('keeps every modeled shape property', async () => {
    const { shape } = await roundTrip(kitchenSink())

    expect(shape.preset).toBe('chevron')
    expect(shape.strokeStyle).toBe('lgDashDot')
    expect(shape.strokeCap).toBe('rnd')
    expect(shape.strokeJoin).toBe('bevel')
    expect(shape.strokeWidth).toBe(76200)
    expect(shape.rotation).toBe(2700000)
    expect(shape.flipH).toBe(true)
    expect(shape.fill?.color.transforms).toEqual([
      { type: 'lumMod', value: 75000 },
      { type: 'satMod', value: 160000 },
      { type: 'comp' },
    ])
    expect(shape.shadow).toEqual({ color: { type: 'srgb', v: '000000' }, blurRadius: 50800, distance: 38100, direction: 2700000 })
  })

  it('keeps the text tokens and the custom geometry', async () => {
    const { text } = await roundTrip(kitchenSink())

    expect(text.body?.paragraphs[0]?.attrs?.bullet).toEqual({ type: 'autoNum', scheme: 'romanUcParenR', startAt: 3 })
    expect(text.body?.paragraphs[0]?.runs[0]?.marks?.underline).toBe('dbl')
    expect(text.customGeometry?.paths[0]?.commands).toEqual([
      { type: 'move', x: 0, y: 100 },
      { type: 'cubic', x1: 20, y1: 40, x2: 60, y2: 10, x: 100, y: 100 },
      { type: 'close' },
    ])
  })

  it('keeps the table cell picture and its border token', async () => {
    const { table } = await roundTrip(kitchenSink())
    const cell = table.rows[0]?.cells[0]

    expect(cell?.pictureFill?.sourceCrop).toEqual({ left: 10000 })
    expect(cell?.borders?.left).toEqual({ color: { type: 'srgb', v: 'FF0000' }, width: 12700, style: 'sysDashDot' })
  })

  it('keeps the slide background', async () => {
    const { imported } = await roundTrip(kitchenSink())

    expect(imported.slides.sld_1?.background).toEqual({ fill: { color: { type: 'srgb', v: '1F3864' } } })
  })

  /** Exporting twice from the same model must produce the same bytes, or nothing above is trustworthy. */
  it('is deterministic', async () => {
    const first = await createPptx(kitchenSink(), { assetAdapter: adapter })
    const second = await createPptx(kitchenSink(), { assetAdapter: adapter })

    expect(first).toEqual(second)
  })
})

/** The second half of the modeled surface: pictures everywhere, a theme, an image, and rich text. */
function richDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_round_trip_rich',
    page: { w: 12192000, h: 6858000 },
    slides: {
      sld_1: {
        id: 'sld_1',
        elementIds: ['shape_1', 'text_1', 'image_1'],
        background: { pictureFill: { assetId: 'asset_photo', tile: { align: 'ctr', scaleX: 50000 } } },
        masterId: 'mst_1',
      },
    },
    slideOrder: ['sld_1'],
    elements: {
      shape_1: {
        id: 'shape_1',
        kind: 'shape',
        preset: 'rect',
        bounds: { x: 0, y: 0, w: 2000000, h: 1000000 },
        pictureFill: {
          assetId: 'asset_photo',
          sourceCrop: { left: 10000, bottom: 20000 },
          stretch: { left: -5000, right: -5000 },
          effects: [{ type: 'alphaModFix', amount: 40000 }, { type: 'grayscl' }],
        },
      },
      text_1: {
        id: 'text_1',
        kind: 'text',
        bounds: { x: 0, y: 1500000, w: 4000000, h: 2000000 },
        body: {
          bodyPr: {
            insets: { left: 100000, top: 200000, right: 300000, bottom: 400000 },
            verticalAlign: 'middle',
            wrap: 'none',
            vertical: 'vertical',
            autofit: { type: 'shrink', minFontScale: 50000 },
          },
          paragraphs: [{
            attrs: { align: 'center', level: 2, marginLeft: 457200, indent: -228600, lineSpacing: 120000, spaceBefore: 63500 },
            runs: [{
              text: 'Rich',
              marks: {
                fontFamily: 'Georgia',
                fontFamilyEa: '微软雅黑',
                fontFamilyCs: 'Arial',
                fontSize: 24,
                bold: true,
                italic: true,
                underline: 'dotted',
                baseline: 30000,
                color: { color: { type: 'srgb', v: 'FF0000', transforms: [{ type: 'alpha', value: 60000 }] } },
              },
            }],
          }],
        },
      },
      image_1: {
        id: 'image_1',
        kind: 'image',
        bounds: { x: 5000000, y: 0, w: 1000000, h: 500000 },
        assetId: 'asset_photo',
        transform: { rotation: 5400000, flipV: true },
        sourceCrop: { top: 5000, right: 15000 },
        maskPreset: 'star5',
        effects: [{ type: 'grayscl' }],
      },
    },
    masters: { mst_1: { id: 'mst_1', themeId: 'theme_1' } },
    themes: {
      theme_1: {
        id: 'theme_1',
        colors: { accent1: { type: 'srgb', v: '4472C4', transforms: [{ type: 'lumMod', value: 60000 }] }, dk1: null },
        fonts: { major: { latin: 'Georgia' }, minor: { latin: 'Verdana', ea: '微软雅黑' } },
        formatScheme: {
          fillStyles: [{ color: { type: 'scheme', v: 'phClr' } }],
          lineStyles: [{ color: { type: 'scheme', v: 'phClr' }, width: 12700, style: 'sysDash' }],
          effectStyles: [{ color: { type: 'srgb', v: '000000' }, blurRadius: 57150, distance: 19050 }],
        },
      },
    },
    assets: { asset_photo: { id: 'asset_photo', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 } },
  }
}

async function richRoundTrip() {
  const imported = await importPptx(await createPptx(richDocument(), { assetAdapter: adapter }))
  const ids = imported.slides.sld_1?.elementIds ?? []
  const shape = imported.elements[ids[0] ?? '']
  const text = imported.elements[ids[1] ?? '']
  const image = imported.elements[ids[2] ?? '']
  if (shape?.kind !== 'shape') throw new Error('the shape did not come back as a shape')
  if (text?.kind !== 'text') throw new Error('the text did not come back as text')
  if (image?.kind !== 'image') throw new Error('the image did not come back as an image')
  return { imported, shape, text, image }
}

describe('standalone round-trip invariants for pictures, themes and rich text', () => {
  it('keeps a picture fill with all four modifiers', async () => {
    const { shape } = await richRoundTrip()

    expect(shape.pictureFill?.sourceCrop).toEqual({ left: 10000, bottom: 20000 })
    expect(shape.pictureFill?.stretch).toEqual({ left: -5000, right: -5000 })
    expect(shape.pictureFill?.effects).toEqual([{ type: 'alphaModFix', amount: 40000 }, { type: 'grayscl' }])
  })

  it('keeps a tiled photo background', async () => {
    const { imported } = await richRoundTrip()

    expect(imported.slides.sld_1?.background?.pictureFill?.tile).toEqual({ align: 'ctr', scaleX: 50000 })
  })

  it('keeps the image appearance', async () => {
    const { image } = await richRoundTrip()

    expect(image.transform).toEqual({ rotation: 5400000, flipV: true })
    expect(image.sourceCrop).toEqual({ top: 5000, right: 15000 })
    expect(image.maskPreset).toBe('star5')
    expect(image.effects).toEqual([{ type: 'grayscl' }])
  })

  it('keeps the body properties, paragraph attributes and run marks', async () => {
    const { text } = await richRoundTrip()
    const paragraph = text.body?.paragraphs[0]

    expect(text.body?.bodyPr).toEqual({
      insets: { left: 100000, top: 200000, right: 300000, bottom: 400000 },
      verticalAlign: 'middle',
      wrap: 'none',
      vertical: 'vertical',
      autofit: { type: 'shrink', minFontScale: 50000 },
    })
    expect(paragraph?.attrs).toMatchObject({ align: 'center', level: 2, marginLeft: 457200, indent: -228600, lineSpacing: 120000, spaceBefore: 63500 })
    expect(paragraph?.runs[0]?.marks).toEqual({
      fontFamily: 'Georgia',
      fontFamilyEa: '微软雅黑',
      fontFamilyCs: 'Arial',
      fontSize: 24,
      bold: true,
      italic: true,
      underline: 'dotted',
      baseline: 30000,
      color: { color: { type: 'srgb', v: 'FF0000', transforms: [{ type: 'alpha', value: 60000 }] } },
    })
  })

  it('keeps the theme colours, fonts and format scheme', async () => {
    const { imported } = await richRoundTrip()
    const theme = Object.values(imported.themes ?? {})[0]

    expect(theme?.colors.accent1).toEqual({ type: 'srgb', v: '4472C4', transforms: [{ type: 'lumMod', value: 60000 }] })
    expect(theme?.fonts?.minor).toMatchObject({ latin: 'Verdana', ea: '微软雅黑' })
    expect(theme?.formatScheme?.lineStyles?.[0]).toMatchObject({ width: 12700, style: 'sysDash' })
    expect(theme?.formatScheme?.effectStyles?.[0]).toMatchObject({ blurRadius: 57150, distance: 19050 })
  })
})

/**
 * The line and fill vocabulary added after the two fixtures above: a pattern fill, a custom dash, the
 * compound and alignment words, a miter limit and a preset's adjust values — on the element and, where
 * the schema allows it, on the theme entry too.
 *
 * Each of these shipped as its own slice with its own test file. They are gathered here for the reason
 * this file exists: the per-slice tests prove one feature survives alone, and this proves they survive
 * together, which is where a positional list or a shared serializer would break them.
 */
function lineAndFillDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_round_trip_lines',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1', 'shape_2'], masterId: 'mst_1' } },
    slideOrder: ['sld_1'],
    elements: {
      shape_1: {
        id: 'shape_1',
        kind: 'shape',
        preset: 'roundRect',
        bounds: { x: 100000, y: 100000, w: 2000000, h: 1000000 },
        adjustValues: [{ name: 'adj', formula: 'val 25000' }],
        fill: {
          color: { type: 'srgb', v: 'FF0000' },
          pattern: {
            preset: 'dkUpDiag',
            foreground: { type: 'srgb', v: 'FF0000' },
            background: { type: 'srgb', v: '00FF00' },
          },
        },
        stroke: { color: { type: 'srgb', v: '203864' } },
        strokeWidth: 76200,
        strokeStyle: { custom: [{ dash: 400000, space: 300000 }, { dash: 100000, space: 300000 }] },
        strokeCap: 'sq',
        strokeJoin: 'miter',
        strokeMiterLimit: 800000,
        strokeCompound: 'thickThin',
        strokeAlign: 'in',
      },
      shape_2: {
        id: 'shape_2',
        kind: 'shape',
        preset: 'hexagon',
        bounds: { x: 100000, y: 1500000, w: 1000000, h: 1000000 },
        adjustValues: [{ name: 'adj1', formula: 'val 16667' }, { name: 'adj2', formula: 'pin 0 adj 50000' }],
        stroke: { color: { type: 'srgb', v: '000000' } },
        strokeWidth: 12700,
        strokeCompound: 'tri',
      },
    },
    masters: { mst_1: { id: 'mst_1', themeId: 'thm_1' } },
    themes: {
      thm_1: {
        id: 'thm_1',
        colors: { accent1: { type: 'srgb', v: '4472C4' } },
        formatScheme: {
          fillStyles: [{
            color: { type: 'scheme', v: 'phClr' },
            pattern: {
              preset: 'ltHorz',
              foreground: { type: 'scheme', v: 'phClr' },
              background: { type: 'srgb', v: 'FFFFFF' },
            },
          }],
          lineStyles: [{
            color: { type: 'scheme', v: 'phClr' },
            width: 6350,
            style: 'lgDashDotDot',
            cap: 'flat',
            join: 'miter',
            miterLimit: 500000,
            compound: 'dbl',
            align: 'ctr',
          }],
        },
      },
    },
  }
}

async function lineRoundTrip() {
  const imported = await importPptx(await createPptx(lineAndFillDocument()))
  const ids = imported.slides.sld_1?.elementIds ?? []
  const patterned = imported.elements[ids[0] ?? '']
  const polygon = imported.elements[ids[1] ?? '']
  if (patterned?.kind !== 'shape') throw new Error('the patterned shape did not come back as a shape')
  if (polygon?.kind !== 'shape') throw new Error('the polygon did not come back as a shape')
  return { imported, patterned, polygon }
}

describe('standalone round-trip invariants for the line and fill vocabulary', () => {
  it('keeps a pattern fill with both colours', async () => {
    const { patterned } = await lineRoundTrip()

    expect(patterned.fill?.pattern).toEqual({
      preset: 'dkUpDiag',
      foreground: { type: 'srgb', v: 'FF0000' },
      background: { type: 'srgb', v: '00FF00' },
    })
  })

  it('keeps a custom dash segment for segment', async () => {
    const { patterned } = await lineRoundTrip()

    expect(patterned.strokeStyle).toEqual({ custom: [{ dash: 400000, space: 300000 }, { dash: 100000, space: 300000 }] })
  })

  /** Four attributes and one child element on the same `a:ln`, which is where an order bug would show. */
  it('keeps the cap, corner, limit, compound and alignment together', async () => {
    const { patterned } = await lineRoundTrip()

    expect(patterned.strokeCap).toBe('sq')
    expect(patterned.strokeJoin).toBe('miter')
    expect(patterned.strokeMiterLimit).toBe(800000)
    expect(patterned.strokeCompound).toBe('thickThin')
    expect(patterned.strokeAlign).toBe('in')
  })

  it('keeps the adjust values of both presets, formulas verbatim', async () => {
    const { patterned, polygon } = await lineRoundTrip()

    expect(patterned.adjustValues).toEqual([{ name: 'adj', formula: 'val 25000' }])
    expect(polygon.adjustValues).toEqual([
      { name: 'adj1', formula: 'val 16667' },
      { name: 'adj2', formula: 'pin 0 adj 50000' },
    ])
    expect(polygon.preset).toBe('hexagon')
  })

  it('keeps the theme pattern entry and every word on the theme line entry', async () => {
    const { imported } = await lineRoundTrip()
    const scheme = Object.values(imported.themes ?? {})[0]?.formatScheme

    expect(scheme?.fillStyles?.[0]?.pattern).toEqual({
      preset: 'ltHorz',
      foreground: { type: 'scheme', v: 'phClr' },
      background: { type: 'srgb', v: 'FFFFFF' },
    })
    expect(scheme?.lineStyles?.[0]).toMatchObject({
      width: 6350,
      style: 'lgDashDotDot',
      cap: 'flat',
      join: 'miter',
      miterLimit: 500000,
      compound: 'dbl',
      align: 'ctr',
    })
  })

  it('is deterministic', async () => {
    expect(await createPptx(lineAndFillDocument())).toEqual(await createPptx(lineAndFillDocument()))
  })
})
