import type { Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

/** Two masters (the second is a duplicate the editor's addMaster would produce), each with its own layout. */
function twoMasterDeck(): Ppt4aiDocument {
  return {
    format: 'ppt4ai', version: 1, id: 'dck_two_master', page: { w: 12192000, h: 6858000 },
    slides: {
      sld_1: { id: 'sld_1', elementIds: [], layoutId: 'lyt_a', masterId: 'mst_1' },
      sld_2: { id: 'sld_2', elementIds: [], layoutId: 'lyt_b', masterId: 'mst_2' },
    },
    slideOrder: ['sld_1', 'sld_2'],
    elements: {},
    layouts: {
      lyt_a: { id: 'lyt_a', masterId: 'mst_1' },
      lyt_b: { id: 'lyt_b', masterId: 'mst_2', background: { fill: { color: { type: 'srgb', v: '1F3864' } } } },
    },
    masters: {
      mst_1: { id: 'mst_1', themeId: 'thm_1' },
      mst_2: { id: 'mst_2', themeId: 'thm_1' },
    },
    themes: { thm_1: { id: 'thm_1', colors: { accent1: { type: 'srgb', v: '4472C4' } } } },
  }
}

async function partNames(bytes: Uint8Array): Promise<string[]> {
  return (await readZipEntries(bytes)).map((e) => e.name)
}

describe('added master in standalone generation', () => {
  it('writes a master part per model master, each with its own layout, and round-trips', async () => {
    const { importPptx } = await import('@ppt4ai/pptx-import')
    const output = await createPptx(twoMasterDeck(), {})
    const names = await partNames(output)
    expect(names.filter((n) => /ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n))).toHaveLength(2)
    expect(names.filter((n) => /ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))).toHaveLength(2)

    const reimported = await importPptx(output)
    expect(Object.keys(reimported.masters ?? {})).toHaveLength(2)
    // The second slide's layout carries the background the duplicated master's layout declared.
    const layout = reimported.layouts?.[reimported.slides.sld_2!.layoutId!]
    expect(layout?.background?.fill?.color).toEqual({ type: 'srgb', v: '1F3864' })
  })
})
