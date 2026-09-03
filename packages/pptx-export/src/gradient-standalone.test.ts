import { importPptx } from '@ppt4ai/pptx-import'
import type { Fill, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

const gradient: Fill = {
  color: { type: 'srgb', v: '4472C4' },
  gradient: {
    stops: [
      { pos: 0, color: { type: 'srgb', v: '4472C4' } },
      { pos: 65000, color: { type: 'scheme', v: 'accent1', transforms: [{ type: 'tint', value: 60000 }] } },
      { pos: 100000, color: { type: 'srgb', v: '203864' } },
    ],
    angle: 5400000,
    scaled: false,
  },
}

function documentWith(fill: Fill): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_gradient',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1'] } },
    slideOrder: ['sld_1'],
    elements: {
      shape_1: { id: 'shape_1', kind: 'shape', preset: 'rect', bounds: { x: 0, y: 0, w: 2000000, h: 1000000 }, fill },
    },
  }
}

async function slideXml(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const data = entries.get('ppt/slides/slide1.xml')
  if (!data) throw new Error('missing generated slide')
  return new TextDecoder().decode(data)
}

describe('gradient fills on standalone export', () => {
  it('writes gradFill with every stop, the angle and the scaled flag', async () => {
    const xml = await slideXml(await createPptx(documentWith(gradient)))

    expect(xml).toContain('<a:gradFill><a:gsLst>'
      + '<a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs>'
      + '<a:gs pos="65000"><a:schemeClr val="accent1"><a:tint val="60000"/></a:schemeClr></a:gs>'
      + '<a:gs pos="100000"><a:srgbClr val="203864"/></a:gs>'
      + '</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>')
    expect(xml).not.toContain('<a:solidFill>')
  })

  it('writes a plain solidFill when the model carries no gradient', async () => {
    const xml = await slideXml(await createPptx(documentWith({ color: { type: 'srgb', v: '112233' } })))

    expect(xml).toContain('<a:solidFill><a:srgbClr val="112233"/></a:solidFill>')
    expect(xml).not.toContain('gradFill')
  })

  it('omits the lin attributes the model does not carry', async () => {
    const xml = await slideXml(await createPptx(documentWith({
      color: { type: 'srgb', v: '000000' },
      gradient: {
        stops: [
          { pos: 0, color: { type: 'srgb', v: '000000' } },
          { pos: 100000, color: { type: 'srgb', v: 'FFFFFF' } },
        ],
      },
    })))

    expect(xml).toContain('</a:gsLst><a:lin/></a:gradFill>')
  })

  it('round-trips the gradient back through import', async () => {
    const imported = await importPptx(await createPptx(documentWith(gradient)))
    const id = imported.slides.sld_1?.elementIds[0] ?? ''

    expect(imported.elements[id]).toMatchObject({ kind: 'shape', fill: gradient })
  })

  it('stays byte-identical across two generations', async () => {
    const document = documentWith(gradient)

    expect(await createPptx(document)).toEqual(await createPptx(structuredClone(document)))
  })
})
