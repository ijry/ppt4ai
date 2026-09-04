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

async function partsOf(bytes: Uint8Array): Promise<Map<string, string>> {
  const decoder = new TextDecoder()
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, decoder.decode(entry.data)]))
}

/** The same photo behind the master, the layout and the slide — one media part, three relationships. */
function backdropDocument(): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_backdrop',
    page: { w: 12192000, h: 6858000 },
    slides: {
      sld_1: {
        id: 'sld_1',
        elementIds: ['text_1'],
        masterId: 'mst_1',
        layoutId: 'lay_1',
        background: { pictureFill: { assetId: 'asset_backdrop', tile: { align: 'ctr' } } },
      },
    },
    slideOrder: ['sld_1'],
    elements: {
      text_1: { id: 'text_1', kind: 'text', bounds: { x: 0, y: 0, w: 1000000, h: 500000 }, body: { paragraphs: [{ runs: [{ text: 'On top' }] }] } },
    },
    masters: {
      mst_1: { id: 'mst_1', themeId: 'theme_1', background: { pictureFill: { assetId: 'asset_backdrop', sourceCrop: { left: 10000 } } } },
    },
    layouts: {
      lay_1: { id: 'lay_1', masterId: 'mst_1', background: { pictureFill: { assetId: 'asset_backdrop', stretch: { left: -5000 } } } },
    },
    themes: { theme_1: { id: 'theme_1', colors: { accent1: { type: 'srgb', v: '4472C4' } } } },
    assets: { asset_backdrop: { id: 'asset_backdrop', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 } },
  }
}

describe('standalone inherited picture background', () => {
  it('materializes one media part and relates it from all three levels', async () => {
    const bytes = await createPptx(backdropDocument(), { assetAdapter: adapter })
    const parts = await partsOf(bytes)

    expect([...parts.keys()].filter((name) => name.startsWith('ppt/media/'))).toEqual(['ppt/media/image1.png'])
    // Image relationships come last in each part, so the layout and theme ids never move.
    expect(parts.get('ppt/slideMasters/_rels/slideMaster1.xml.rels')).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"')
    expect(parts.get('ppt/slideLayouts/_rels/slideLayout1.xml.rels')).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"')
    expect(parts.get('ppt/slides/_rels/slide1.xml.rels')).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"')
  })

  it('writes the picture background each part states', async () => {
    const parts = await partsOf(await createPptx(backdropDocument(), { assetAdapter: adapter }))

    expect(parts.get('ppt/slideMasters/slideMaster1.xml'))
      .toContain('<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId3"/><a:srcRect l="10000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>')
    expect(parts.get('ppt/slideLayouts/slideLayout1.xml'))
      .toContain('<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect l="-5000"/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>')
    // The layout root needs the relationship namespace now that a blip can appear inside it.
    expect(parts.get('ppt/slideLayouts/slideLayout1.xml')).toContain('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
  })

  it('leaves a part with no picture background without an image relationship', async () => {
    const document = backdropDocument()
    document.masters!.mst_1!.background = { fill: { color: { type: 'srgb', v: '1F3864' } } }
    const parts = await partsOf(await createPptx(document, { assetAdapter: adapter }))

    expect(parts.get('ppt/slideMasters/_rels/slideMaster1.xml.rels')).not.toContain('relationships/image')
    expect(parts.get('ppt/slideMasters/slideMaster1.xml')).toContain('<a:solidFill><a:srgbClr val="1F3864"/></a:solidFill>')
  })

  it('brings all three picture backgrounds back through importPptx', async () => {
    const imported = await importPptx(await createPptx(backdropDocument(), { assetAdapter: adapter }))
    const master = Object.values(imported.masters ?? {})[0]
    const layout = Object.values(imported.layouts ?? {})[0]
    const assetId = Object.keys(imported.assets ?? {})[0]

    expect(Object.keys(imported.assets ?? {})).toHaveLength(1)
    expect(master?.background?.pictureFill).toEqual({ assetId, sourceCrop: { left: 10000 } })
    expect(layout?.background?.pictureFill).toEqual({ assetId, stretch: { left: -5000 } })
    expect(imported.slides.sld_1?.background?.pictureFill).toEqual({ assetId, tile: { align: 'ctr' } })
  })
})
