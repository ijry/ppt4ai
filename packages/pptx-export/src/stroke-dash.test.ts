import { importPptx } from '@ppt4ai/pptx-import'
import type { Element, Ppt4aiDocument, StrokeStyle } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

async function slideXml(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const data = entries.get('ppt/slides/slide1.xml')
  if (!data) throw new Error('missing generated slide')
  return new TextDecoder().decode(data)
}

function documentWith(element: Element): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_dash',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [element.id] } },
    slideOrder: ['sld_1'],
    elements: { [element.id]: element },
  }
}

function dashedShape(strokeStyle?: StrokeStyle): Element {
  return {
    id: 'shape_1',
    kind: 'shape',
    preset: 'rect',
    bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
    stroke: { color: { type: 'srgb', v: '203864' } },
    strokeWidth: 76200,
    ...(strokeStyle ? { strokeStyle } : {}),
  }
}

describe('stroke dash on standalone export', () => {
  /** `a:prstDash` is a child of `a:ln` and follows the fill, not an attribute on it. */
  it('writes the dash style as a child element after the fill', async () => {
    const xml = await slideXml(await createPptx(documentWith(dashedShape('dash'))))

    expect(xml).toContain('<a:ln w="76200"><a:solidFill><a:srgbClr val="203864"/></a:solidFill><a:prstDash val="dash"/></a:ln>')
  })

  it('omits the element for a solid outline', async () => {
    const xml = await slideXml(await createPptx(documentWith(dashedShape())))

    expect(xml).toContain('<a:ln w="76200"><a:solidFill><a:srgbClr val="203864"/></a:solidFill></a:ln>')
    expect(xml).not.toContain('prstDash')
  })

  it('round-trips both styles back through import', async () => {
    for (const style of ['dash', 'dot'] as const) {
      const imported = await importPptx(await createPptx(documentWith(dashedShape(style))))
      const id = imported.slides.sld_1?.elementIds[0] ?? ''

      expect(imported.elements[id]).toMatchObject({ kind: 'shape', strokeWidth: 76200, strokeStyle: style })
    }
  })

  it('round-trips a solid outline back with no style', async () => {
    const imported = await importPptx(await createPptx(documentWith(dashedShape())))
    const id = imported.slides.sld_1?.elementIds[0] ?? ''

    expect(imported.elements[id]).not.toHaveProperty('strokeStyle')
  })

  it('writes the dash style of a shape that carries text', async () => {
    const xml = await slideXml(await createPptx(documentWith({
      id: 'text_1',
      kind: 'text',
      bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
      stroke: { color: { type: 'srgb', v: '203864' } },
      strokeStyle: 'dot',
      body: { paragraphs: [{ runs: [{ text: 'Label' }] }] },
    })))

    expect(xml).toContain('<a:prstDash val="dot"/></a:ln>')
  })
})
