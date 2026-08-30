import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument } from '@ppt4ai/model'
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
})
