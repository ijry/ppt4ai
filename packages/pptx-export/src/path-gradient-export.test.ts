import { importPptx } from '@ppt4ai/pptx-import'
import type { Gradient, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

async function slideOf(bytes: Uint8Array): Promise<string> {
  const entries = await readZipEntries(bytes)
  const data = entries.find((entry) => entry.name === 'ppt/slides/slide1.xml')?.data
  if (!data) throw new Error('generated package has no slide')
  return new TextDecoder().decode(data)
}

const stops: Gradient['stops'] = [
  { pos: 0, color: { type: 'srgb', v: 'FFFFFF' } },
  { pos: 100000, color: { type: 'srgb', v: '4472C4' } },
]

function documentWith(gradient: Gradient): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_path_gradient',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1'] } },
    slideOrder: ['sld_1'],
    elements: {
      shape_1: {
        id: 'shape_1',
        kind: 'shape',
        preset: 'rect',
        bounds: { x: 0, y: 0, w: 2000000, h: 1000000 },
        fill: { color: stops[0]!.color, gradient },
      },
    },
  }
}

async function gradientBack(gradient: Gradient) {
  const imported = await importPptx(await createPptx(documentWith(gradient)))
  const element = imported.elements.el_1
  if (element?.kind !== 'shape' && element?.kind !== 'text') throw new Error('the shape did not come back')
  return element.fill?.gradient
}

describe('path gradient export', () => {
  it('writes a:path with the convergence rect', async () => {
    const slide = await slideOf(await createPptx(documentWith({ stops, path: 'circle', fillToRect: { left: 50000, top: 50000, right: 50000, bottom: 50000 } })))

    expect(slide).toContain('<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs>'
      + '<a:gs pos="100000"><a:srgbClr val="4472C4"/></a:gs></a:gsLst>'
      + '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>')
  })

  it('writes only the rect sides the model states, and none at all when it states no rect', async () => {
    const partial = await slideOf(await createPptx(documentWith({ stops, path: 'rect', fillToRect: { left: 25000 } })))
    const bare = await slideOf(await createPptx(documentWith({ stops, path: 'shape' })))

    expect(partial).toContain('<a:path path="rect"><a:fillToRect l="25000"/></a:path>')
    expect(bare).toContain('<a:path path="shape"></a:path>')
  })

  /** The two forms are a choice in OOXML; the path form wins, the way painting resolves it. */
  it('writes the path form when a hand-built model states both', async () => {
    const slide = await slideOf(await createPptx(documentWith({ stops, angle: 5400000, path: 'circle' })))

    expect(slide).toContain('<a:path path="circle">')
    expect(slide).not.toContain('<a:lin')
  })

  it('keeps writing a:lin for a linear gradient', async () => {
    const slide = await slideOf(await createPptx(documentWith({ stops, angle: 5400000, scaled: true })))

    expect(slide).toContain('<a:lin ang="5400000" scaled="1"/>')
  })

  it('brings the path form back through importPptx', async () => {
    expect(await gradientBack({ stops, path: 'circle', fillToRect: { left: 50000, top: 50000, right: 50000, bottom: 50000 } })).toEqual({
      stops,
      path: 'circle',
      fillToRect: { left: 50000, top: 50000, right: 50000, bottom: 50000 },
    })
    expect(await gradientBack({ stops, path: 'shape' })).toEqual({ stops, path: 'shape' })
    expect(await gradientBack({ stops, angle: 5400000, scaled: true })).toEqual({ stops, angle: 5400000, scaled: true })
  })
})
