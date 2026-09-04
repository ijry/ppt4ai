import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument, ShapeElement } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x10,
  0x08, 0x06, 0x00, 0x00, 0x00,
])

const adapter = {
  get: async (): Promise<Uint8Array> => pngBytes,
  put: async (): Promise<void> => {},
}

const tiled: ShapeElement = {
  id: 'shape_1',
  kind: 'shape',
  preset: 'rect',
  bounds: { x: 0, y: 0, w: 2000000, h: 1000000 },
  pictureFill: {
    assetId: 'asset_photo',
    tile: { offsetX: 76200, offsetY: -38100, scaleX: 50000, scaleY: 60000, align: 'ctr', flip: 'x' },
    effects: [{ type: 'alphaModFix', amount: 40000 }, { type: 'grayscl' }],
  },
}

function documentWith(shape: ShapeElement): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_tiled_fill',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [shape.id] } },
    slideOrder: ['sld_1'],
    elements: { [shape.id]: shape },
    assets: { asset_photo: { id: 'asset_photo', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 } },
  }
}

async function slideOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slides/slide1.xml')!)
}

describe('tiled picture fill round trip', () => {
  it('writes a:tile with its attributes and the blip effects', async () => {
    const xml = await slideOf(await createPptx(documentWith(tiled), { assetAdapter: adapter }))

    expect(xml).toContain('<a:blip r:embed="rId2"><a:alphaModFix amt="40000"/><a:grayscl/></a:blip>')
    expect(xml).toContain('<a:tile tx="76200" ty="-38100" sx="50000" sy="60000" flip="x" algn="ctr"/>')
    expect(xml).not.toContain('a:stretch')
  })

  it('reads every tile attribute and effect back', async () => {
    const output = await createPptx(documentWith(tiled), { assetAdapter: adapter })
    const imported = await importPptx(output)
    const shape = imported.elements[imported.slides.sld_1?.elementIds[0] ?? '']
    if (shape?.kind !== 'shape') throw new Error('the generated shape did not import as a shape')

    expect(shape.pictureFill).toEqual({
      assetId: 'asset_ppt_media_image1_png',
      tile: { offsetX: 76200, offsetY: -38100, scaleX: 50000, scaleY: 60000, align: 'ctr', flip: 'x' },
      effects: [{ type: 'alphaModFix', amount: 40000 }, { type: 'grayscl' }],
    })
  })

  /** A tile with no attributes at all is still a tile: the fill mode is the choice, not the numbers. */
  it('round-trips a bare tile', async () => {
    const bare: ShapeElement = { ...tiled, pictureFill: { assetId: 'asset_photo', tile: {} } }
    const output = await createPptx(documentWith(bare), { assetAdapter: adapter })

    expect(await slideOf(output)).toContain('<a:tile/>')
    const imported = await importPptx(output)
    const shape = imported.elements[imported.slides.sld_1?.elementIds[0] ?? '']
    if (shape?.kind !== 'shape') throw new Error('the generated shape did not import as a shape')
    expect(shape.pictureFill?.tile).toEqual({})
  })

  it('still writes a:stretch when the fill does not tile', async () => {
    const stretched: ShapeElement = { ...tiled, pictureFill: { assetId: 'asset_photo' } }

    const xml = await slideOf(await createPptx(documentWith(stretched), { assetAdapter: adapter }))

    expect(xml).toContain('<a:stretch><a:fillRect/></a:stretch>')
    expect(xml).not.toContain('a:tile')
  })
})
