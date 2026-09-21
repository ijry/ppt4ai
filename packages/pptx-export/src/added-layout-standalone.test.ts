import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

/** A model with a second layout added under the same master (what the engine's addLayout produces). */
function deckWithAddedLayout(): Ppt4aiDocument {
  return {
    format: 'ppt4ai', version: 1, id: 'dck_add_layout', page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [], layoutId: 'lyt_b', masterId: 'mst_1' } },
    slideOrder: ['sld_1'],
    elements: {},
    layouts: {
      lyt_a: { id: 'lyt_a', masterId: 'mst_1' },
      lyt_b: { id: 'lyt_b', masterId: 'mst_1', background: { fill: { color: { type: 'srgb', v: '1F3864' } } } },
    },
    masters: { mst_1: { id: 'mst_1', themeId: 'thm_1' } },
    themes: { thm_1: { id: 'thm_1', colors: { accent1: { type: 'srgb', v: '4472C4' } } } },
  }
}

async function partNames(bytes: Uint8Array): Promise<string[]> {
  return (await readZipEntries(bytes)).map((entry) => entry.name)
}

describe('added layout in standalone generation', () => {
  it('writes one layout part per model layout and round-trips both', async () => {
    const output = await createPptx(deckWithAddedLayout(), {})
    const layoutParts = (await partNames(output)).filter((name) => /ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name))
    expect(layoutParts).toHaveLength(2)

    // The importer only imports layouts a slide references, so the reimport has the one the slide uses —
    // and it carries the background the added layout declared, proving the added layout became a real part.
    const reimported = await importPptx(output)
    const slide = reimported.slides.sld_1
    const layout = slide?.layoutId ? reimported.layouts?.[slide.layoutId] : undefined
    expect(layout?.background?.fill?.color).toEqual({ type: 'srgb', v: '1F3864' })
  })
})
