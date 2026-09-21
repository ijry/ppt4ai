import type { Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

/** Model after deleteLayout removed the unused lyt_b — only the used layout remains. */
function deckAfterDelete(): Ppt4aiDocument {
  return {
    format: 'ppt4ai', version: 1, id: 'dck_del_layout', page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [], layoutId: 'lyt_a', masterId: 'mst_1' } },
    slideOrder: ['sld_1'],
    elements: {},
    layouts: { lyt_a: { id: 'lyt_a', masterId: 'mst_1' } },
    masters: { mst_1: { id: 'mst_1', themeId: 'thm_1' } },
    themes: { thm_1: { id: 'thm_1', colors: { accent1: { type: 'srgb', v: '4472C4' } } } },
  }
}

async function partNames(bytes: Uint8Array): Promise<string[]> {
  return (await readZipEntries(bytes)).map((e) => e.name)
}

describe('deleted layout drops from standalone generation', () => {
  it('writes only the layouts the model still holds', async () => {
    const output = await createPptx(deckAfterDelete(), {})
    const layoutParts = (await partNames(output)).filter((n) => /ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))
    expect(layoutParts).toHaveLength(1)
  })
})
