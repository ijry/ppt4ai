import { importPptx } from '@ppt4ai/pptx-import'
import type { ElementDefaults, Ppt4aiDocument } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

const titleDefaults: ElementDefaults = {
  bounds: { x: 100000, y: 100000, w: 4000000, h: 1000000 },
  preset: 'roundRect',
  adjustValues: [{ name: 'adj', formula: 'val 25000' }],
  stroke: { color: { type: 'srgb', v: '203864' } },
  strokeWidth: 76200,
  strokeStyle: 'lgDashDot',
  strokeCap: 'sq',
  strokeJoin: 'miter',
  strokeMiterLimit: 800000,
  strokeCompound: 'dbl',
  strokeAlign: 'in',
}

function documentWith(defaults: ElementDefaults): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_placeholder_outline',
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

async function partOf(bytes: Uint8Array, name: string): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const data = entries.get(name)
  if (!data) throw new Error(`missing ${name}`)
  return new TextDecoder().decode(data)
}

describe('placeholder outline defaults on standalone export', () => {
  /** The serializer wrote `<a:ln>` with a fill and nothing else, so seven fields never reached the file. */
  it('writes the whole outline vocabulary on the layout placeholder', async () => {
    const layout = await partOf(await createPptx(documentWith(titleDefaults)), 'ppt/slideLayouts/slideLayout1.xml')

    expect(layout).toContain('<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>')
    expect(layout).toContain('<a:ln w="76200" cap="sq" cmpd="dbl" algn="in">'
      + '<a:solidFill><a:srgbClr val="203864"/></a:solidFill>'
      + '<a:prstDash val="lgDashDot"/><a:miter lim="800000"/></a:ln>')
  })

  /** A placeholder may state a width and take its colour from `lnRef`; the old condition dropped it. */
  it('writes the line when there is a width but no colour', async () => {
    const layout = await partOf(
      await createPptx(documentWith({ preset: 'rect', strokeWidth: 12700 })),
      'ppt/slideLayouts/slideLayout1.xml',
    )

    expect(layout).toContain('<a:ln w="12700"></a:ln>')
  })

  it('writes no line at all when the default states none', async () => {
    const layout = await partOf(
      await createPptx(documentWith({ preset: 'rect' })),
      'ppt/slideLayouts/slideLayout1.xml',
    )

    expect(layout).not.toContain('<a:ln')
  })

  it('brings every field back through import', async () => {
    const reimported = await importPptx(await createPptx(documentWith(titleDefaults)))
    const layout = Object.values(reimported.layouts ?? {})[0]

    expect(layout?.defaults?.title).toMatchObject({
      preset: 'roundRect',
      adjustValues: [{ name: 'adj', formula: 'val 25000' }],
      strokeWidth: 76200,
      strokeStyle: 'lgDashDot',
      strokeCap: 'sq',
      strokeJoin: 'miter',
      strokeMiterLimit: 800000,
      strokeCompound: 'dbl',
      strokeAlign: 'in',
    })
  })

  it('stays deterministic across repeated exports', async () => {
    expect(await createPptx(documentWith(titleDefaults)))
      .toEqual(await createPptx(documentWith(titleDefaults)))
  })
})
