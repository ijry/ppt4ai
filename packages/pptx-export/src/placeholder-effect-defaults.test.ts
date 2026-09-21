import { importPptx } from '@ppt4ai/pptx-import'
import type { ElementDefaults, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

const titleDefaults: ElementDefaults = {
  bounds: { x: 100000, y: 100000, w: 4000000, h: 1000000 },
  preset: 'rect',
  shadow: { color: { type: 'srgb', v: '000000' }, blurRadius: 50800, distance: 38100, direction: 2700000 },
  customGeometry: {
    paths: [{
      width: 100,
      height: 100,
      commands: [
        { type: 'move', x: 0, y: 0 },
        { type: 'line', x: 100, y: 100 },
        { type: 'close' },
      ],
    }],
  },
  styleRef: {
    line: { idx: 2, color: { type: 'scheme', v: 'accent1' } },
    fill: { idx: 1, color: { type: 'scheme', v: 'accent1' } },
    effect: { idx: 0, color: { type: 'scheme', v: 'accent1' } },
    font: { idx: 'minor', color: { type: 'scheme', v: 'lt1' } },
  },
}

function documentWith(defaults: ElementDefaults): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_placeholder_effects',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['text_1'], layoutId: 'lyt_1', masterId: 'mst_1' } },
    slideOrder: ['sld_1'],
    elements: {
      text_1: {
        id: 'text_1',
        kind: 'text',
        bounds: { x: 100000, y: 100000, w: 4000000, h: 1000000 },
        placeholder: 'title',
        body: { paragraphs: [{ runs: [{ text: 'Inherited' }] }] },
      },
    },
    layouts: { lyt_1: { id: 'lyt_1', masterId: 'mst_1', defaults: { title: defaults } } },
    masters: { mst_1: { id: 'mst_1' } },
  }
}

async function layoutPartOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const data = entries.get('ppt/slideLayouts/slideLayout1.xml')
  if (!data) throw new Error('missing layout')
  return new TextDecoder().decode(data)
}

describe('placeholder effect and style defaults on standalone export', () => {
  it('writes the shadow inside the shape properties', async () => {
    const layout = await layoutPartOf(await createPptx(documentWith(titleDefaults)))

    expect(layout).toContain('<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000">'
      + '<a:srgbClr val="000000"/></a:outerShdw></a:effectLst>')
  })

  /** Custom geometry replaces the preset, the precedence `serializeShapeXml` already uses. */
  it('writes the custom geometry instead of a prstGeom', async () => {
    const layout = await layoutPartOf(await createPptx(documentWith(titleDefaults)))

    expect(layout).toContain('<a:custGeom>')
    expect(layout).not.toContain('<a:prstGeom')
  })

  /** `<p:style>` is a sibling of `p:spPr`, not a child, so its position is worth asserting. */
  it('writes the style references after the shape properties', async () => {
    const layout = await layoutPartOf(await createPptx(documentWith(titleDefaults)))

    expect(layout).toContain('</p:spPr><p:style>')
    expect(layout).toContain('<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>')
  })

  it('brings all three back through import', async () => {
    const reimported = await importPptx(await createPptx(documentWith(titleDefaults)))
    const defaults = Object.values(reimported.layouts ?? {})[0]?.defaults?.title

    expect(defaults?.shadow).toEqual(titleDefaults.shadow)
    expect(defaults?.customGeometry).toEqual(titleDefaults.customGeometry)
    expect(defaults?.styleRef).toEqual(titleDefaults.styleRef)
  })

  it('writes none of them when the default states none', async () => {
    const layout = await layoutPartOf(await createPptx(documentWith({ preset: 'rect' })))

    expect(layout).not.toContain('a:effectLst')
    expect(layout).not.toContain('a:custGeom')
    expect(layout).not.toContain('p:style')
  })

  it('stays deterministic across repeated exports', async () => {
    expect(await createPptx(documentWith(titleDefaults)))
      .toEqual(await createPptx(documentWith(titleDefaults)))
  })
})
