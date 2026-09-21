import { importPptx } from '@ppt4ai/pptx-import'
import type { AssetAdapter, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x10,
  0x08, 0x06, 0x00, 0x00, 0x00,
])

const adapter: AssetAdapter = { get: async (): Promise<Uint8Array> => pngBytes, put: async (): Promise<void> => {} }

/**
 * Every capability the standalone export gained this round, in one document: two masters and layouts
 * with placeholder defaults and picture backgrounds, a group holding a picture-filled shape and a
 * placeholder text, a styled table with an interior grid and a photo in a cell, an image, three levels
 * of colour map, two themes, and one photo shared by all of them.
 *
 * The per-feature round trips already pass individually. What only this can catch is the interaction:
 * relationship numbering when a package has several masters *and* table styles, media shared between a
 * master background and a cell fill, a placeholder nested inside a group.
 */
function wholeStack(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_whole_stack',
    page: { w: 12192000, h: 6858000 },
    slides: {
      sld_1: {
        id: 'sld_1',
        elementIds: ['grp_1', 'tbl_1'],
        masterId: 'mst_a',
        layoutId: 'lay_a',
        colorMapOverride: { tx1: 'accent2' },
      },
      sld_2: {
        id: 'sld_2',
        elementIds: ['img_1'],
        masterId: 'mst_b',
        layoutId: 'lay_b',
        background: { pictureFill: { assetId: 'asset_photo', tile: { align: 'ctr' } } },
      },
    },
    slideOrder: ['sld_1', 'sld_2'],
    elements: {
      grp_1: {
        id: 'grp_1',
        kind: 'group',
        bounds: { x: 500000, y: 500000, w: 4000000, h: 2000000 },
        childIds: ['shp_1', 'txt_1'],
        rotation: 900000,
      },
      shp_1: {
        id: 'shp_1',
        kind: 'shape',
        preset: 'roundRect',
        bounds: { x: 500000, y: 500000, w: 2000000, h: 2000000 },
        pictureFill: { assetId: 'asset_photo', sourceCrop: { left: 5000 } },
      },
      txt_1: {
        id: 'txt_1',
        kind: 'text',
        placeholder: 'title',
        bounds: { x: 2500000, y: 500000, w: 2000000, h: 2000000 },
        body: { paragraphs: [{ runs: [{ text: 'Grouped title' }] }] },
      },
      tbl_1: {
        id: 'tbl_1',
        kind: 'table',
        bounds: { x: 500000, y: 3000000, w: 3000000, h: 2000000 },
        columns: [1500000, 1500000],
        rows: [
          { height: 1000000, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'A' }] }] } }, { column: 1, body: { paragraphs: [{ runs: [{ text: 'B' }] }] } }] },
          { height: 1000000, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'C' }] }] }, pictureFill: { assetId: 'asset_photo' } }, { column: 1, body: { paragraphs: [{ runs: [{ text: 'D' }] }] } }] },
        ],
        style: { styleId: 'style-1', firstRow: true, bandRow: true },
      },
      img_1: { id: 'img_1', kind: 'image', bounds: { x: 6000000, y: 500000, w: 1000000, h: 500000 }, assetId: 'asset_photo', maskPreset: 'ellipse' },
    },
    masters: {
      mst_a: {
        id: 'mst_a',
        themeId: 'theme_a',
        colorMap: { tx1: 'dk2' },
        background: { pictureFill: { assetId: 'asset_photo', sourceCrop: { top: 1000 } } },
        textStyles: { title: [{ level: 0, marks: { fontSize: 44, bold: true } }] },
        defaults: { title: { bounds: { x: 100000, y: 100000, w: 5000000, h: 1000000 }, preset: 'rect', listStyle: [{ level: 0, marks: { fontSize: 40 } }] } },
      },
      mst_b: { id: 'mst_b', themeId: 'theme_b', background: { fill: { color: { type: 'srgb', v: '203864' } } } },
    },
    layouts: {
      lay_a: {
        id: 'lay_a',
        masterId: 'mst_a',
        colorMapOverride: { tx2: 'accent3' },
        defaults: { title: { fill: { color: { type: 'srgb', v: 'FFF2CC' } } } },
      },
      lay_b: { id: 'lay_b', masterId: 'mst_b', background: { pictureFill: { assetId: 'asset_photo', stretch: { left: -2000 } } } },
    },
    themes: {
      theme_a: { id: 'theme_a', colors: { accent1: { type: 'srgb', v: '4472C4' } }, fonts: { minor: { latin: 'Verdana' } } },
      theme_b: { id: 'theme_b', colors: { accent1: { type: 'srgb', v: 'ED7D31' } } },
    },
    tableStyles: {
      'style-1': {
        id: 'style-1',
        regions: {
          wholeTable: { borders: { insideH: { color: { type: 'srgb', v: 'AAAAAA' }, width: 6350, style: 'solid' }, insideV: { color: { type: 'srgb', v: 'AAAAAA' }, width: 6350, style: 'solid' } } },
          firstRow: { fill: { color: { type: 'srgb', v: '2F5597' } }, text: { bold: true } },
        },
      },
    },
    assets: { asset_photo: { id: 'asset_photo', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 } },
  }
}

async function roundTripStack() {
  const bytes = await createPptx(wholeStack(), { assetAdapter: adapter })
  const entries = await readZipEntries(bytes)
  const decoder = new TextDecoder()
  return {
    imported: await importPptx(bytes),
    entries: entries.map((entry) => entry.name),
    parts: new Map(entries.map((entry) => [entry.name, decoder.decode(entry.data)])),
  }
}

describe('whole-stack round trip', () => {
  it('shares one media part across the master, the layout, a slide, a shape, a cell and an image', async () => {
    const { imported, entries } = await roundTripStack()

    expect(entries.filter((name) => name.startsWith('ppt/media/'))).toEqual(['ppt/media/image1.png'])
    expect(Object.keys(imported.assets ?? {})).toHaveLength(1)
  })

  /**
   * The numbering formula is shared between the masters, the slides and the table styles, and until this
   * document existed no test had all three at once: two masters take rId1 and rId2, the presentation's
   * theme rId3, the slides rId4 and rId5, and the table styles the one after them.
   */
  it('numbers the presentation relationships with two masters and a table styles part', async () => {
    const { entries, parts } = await roundTripStack()
    const relationships = parts.get('ppt/_rels/presentation.xml.rels') ?? ''

    expect(entries).toContain('ppt/tableStyles.xml')
    expect(entries).toContain('ppt/slideMasters/slideMaster2.xml')
    expect(entries).toContain('ppt/slideLayouts/slideLayout2.xml')
    expect(entries).toContain('ppt/theme/theme2.xml')
    expect(relationships).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster2.xml"')
    expect(relationships).toContain('Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"')
    expect(relationships).toContain('Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"')
    expect(parts.get('ppt/presentation.xml')).toContain('<p:sldId id="257" r:id="rId5"/>')
  })

  it('keeps the group, its rotation and the placeholder nested inside it', async () => {
    const { imported } = await roundTripStack()
    const group = Object.values(imported.elements).find((element) => element.kind === 'group')
    if (group?.kind !== 'group') throw new Error('the group did not come back')
    const child = imported.elements[group.childIds[1] ?? '']

    expect(group.rotation).toBe(900000)
    expect(group.childIds).toHaveLength(2)
    expect(child?.kind === 'text' ? child.placeholder : undefined).toBe('title')
  })

  it('keeps both masters, their backgrounds and the first master\'s defaults', async () => {
    const { imported } = await roundTripStack()
    const masters = Object.values(imported.masters ?? {})
    const assetId = Object.keys(imported.assets ?? {})[0]

    expect(masters).toHaveLength(2)
    expect(masters[0]?.background?.pictureFill).toEqual({ assetId, sourceCrop: { top: 1000 } })
    expect(masters[1]?.background).toEqual({ fill: { color: { type: 'srgb', v: '203864' } } })
    expect(masters[0]?.textStyles?.title).toEqual([{ level: 0, marks: { fontSize: 44, bold: true } }])
    expect(masters[0]?.defaults?.title).toMatchObject({ preset: 'rect', listStyle: [{ level: 0, marks: { fontSize: 40 } }] })
  })

  it('keeps both layouts, one with a picture background and one with a placeholder fill', async () => {
    const { imported } = await roundTripStack()
    const layouts = Object.values(imported.layouts ?? {})
    const assetId = Object.keys(imported.assets ?? {})[0]

    expect(layouts).toHaveLength(2)
    expect(layouts[0]?.defaults?.title?.fill).toEqual({ color: { type: 'srgb', v: 'FFF2CC' } })
    expect(layouts[1]?.background?.pictureFill).toEqual({ assetId, stretch: { left: -2000 } })
  })

  it('keeps the table style, its interior grid and the photo in a cell', async () => {
    const { imported } = await roundTripStack()
    const table = Object.values(imported.elements).find((element) => element.kind === 'table')
    if (table?.kind !== 'table') throw new Error('the table did not come back')
    const region = imported.tableStyles?.['style-1']?.regions

    expect(table.style).toMatchObject({ styleId: 'style-1', firstRow: true, bandRow: true })
    expect(region?.wholeTable?.borders?.insideH).toEqual({ color: { type: 'srgb', v: 'AAAAAA' }, width: 6350, style: 'solid' })
    expect(region?.firstRow?.text).toEqual({ bold: true })
    expect(table.rows[1]?.cells[0]?.pictureFill?.assetId).toBe(Object.keys(imported.assets ?? {})[0])
  })

  it('keeps all three levels of colour map and both themes', async () => {
    const { imported } = await roundTripStack()
    const masters = Object.values(imported.masters ?? {})
    const themes = Object.values(imported.themes ?? {})

    expect(masters[0]?.colorMap).toMatchObject({ tx1: 'dk2' })
    expect(Object.values(imported.layouts ?? {})[0]?.colorMapOverride).toMatchObject({ tx2: 'accent3', tx1: 'dk2' })
    expect(imported.slides.sld_1?.colorMapOverride).toMatchObject({ tx1: 'accent2', tx2: 'accent3' })
    expect(themes.map((theme) => theme.colors.accent1)).toEqual([{ type: 'srgb', v: '4472C4' }, { type: 'srgb', v: 'ED7D31' }])
    expect(themes[0]?.fonts?.minor).toMatchObject({ latin: 'Verdana' })
  })

  it('keeps the second slide\'s own picture background and the image mask', async () => {
    const { imported } = await roundTripStack()
    const image = Object.values(imported.elements).find((element) => element.kind === 'image')
    const assetId = Object.keys(imported.assets ?? {})[0]

    expect(imported.slides.sld_2?.background?.pictureFill).toEqual({ assetId, tile: { align: 'ctr' } })
    expect(image?.kind === 'image' ? image.maskPreset : undefined).toBe('ellipse')
  })

  it('is deterministic', async () => {
    const first = await createPptx(wholeStack(), { assetAdapter: adapter })
    const second = await createPptx(wholeStack(), { assetAdapter: adapter })

    expect(first).toEqual(second)
  })
})
