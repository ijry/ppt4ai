import { importPptx } from '@ppt4ai/pptx-import'
import type { AssetAdapter, Element, GroupElement, Ppt4aiDocument } from '@ppt4ai/model'
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

async function entriesOf(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
}

async function slideOf(bytes: Uint8Array): Promise<string> {
  const data = (await entriesOf(bytes)).get('ppt/slides/slide1.xml')
  if (!data) throw new Error('generated package has no slide')
  return new TextDecoder().decode(data)
}

/** The `p:grpSp` and everything nested in it, so a child can be told apart from a sibling. */
function groupXml(slide: string): string {
  const start = slide.indexOf('<p:grpSp>')
  const end = slide.lastIndexOf('</p:grpSp>')
  if (start === -1 || end === -1) throw new Error('generated slide has no group')
  return slide.slice(start, end)
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

/** A group of two leaves, the shape the editor's group command produces: children out of `elementIds`. */
function groupedDocument(group: Partial<GroupElement> = {}, elementIds = ['grp_1']): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_group',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds } },
    slideOrder: ['sld_1'],
    elements: {
      grp_1: { id: 'grp_1', kind: 'group', bounds: { x: 1000000, y: 2000000, w: 4000000, h: 2000000 }, childIds: ['el_a', 'el_b'], ...group },
      el_a: { id: 'el_a', kind: 'shape', preset: 'rect', bounds: { x: 1000000, y: 2000000, w: 2000000, h: 1000000 }, fill: { color: { type: 'srgb', v: 'FF0000' } } },
      el_b: { id: 'el_b', kind: 'text', bounds: { x: 3000000, y: 2000000, w: 1000000, h: 1000000 }, body: { paragraphs: [{ runs: [{ text: 'Inside' }] }] } },
    },
  }
}

describe('standalone group export', () => {
  it('writes the group transform and an identity child space', async () => {
    const slide = await slideOf(await createPptx(groupedDocument()))

    expect(slide).toContain('<p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="grp_1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
      + '<p:grpSpPr><a:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="4000000" cy="2000000"/>'
      + '<a:chOff x="1000000" y="2000000"/><a:chExt cx="4000000" cy="2000000"/></a:xfrm></p:grpSpPr>')
  })

  it('nests both children in the group and writes each exactly once', async () => {
    const slide = await slideOf(await createPptx(groupedDocument()))
    const group = groupXml(slide)

    expect(group).toContain('name="el_a"')
    expect(group).toContain('name="el_b"')
    expect(occurrences(slide, 'name="el_a"')).toBe(1)
    expect(occurrences(slide, 'name="el_b"')).toBe(1)
  })

  it('writes rotation and flips only when the model sets them', async () => {
    const plain = await slideOf(await createPptx(groupedDocument()))
    const turned = await slideOf(await createPptx(groupedDocument({ rotation: 2700000, flipH: true, flipV: true })))

    expect(plain).toContain('<p:grpSpPr><a:xfrm><a:off')
    expect(turned).toContain('<p:grpSpPr><a:xfrm rot="2700000" flipH="1" flipV="1"><a:off')
  })

  it('writes an authored child space verbatim instead of the identity one', async () => {
    const slide = await slideOf(await createPptx(groupedDocument({ childSpace: { x: 0, y: 0, w: 8000000, h: 4000000 } })))

    expect(slide).toContain('<a:ext cx="4000000" cy="2000000"/><a:chOff x="0" y="0"/><a:chExt cx="8000000" cy="4000000"/>')
  })

  it('numbers every shape in the tree once, nested groups included', async () => {
    const nested = groupedDocument({ childIds: ['grp_2', 'el_b'] })
    nested.elements.grp_2 = { id: 'grp_2', kind: 'group', bounds: { x: 1000000, y: 2000000, w: 2000000, h: 1000000 }, childIds: ['el_a'] }
    const slide = await slideOf(await createPptx(nested))
    const ids = [...slide.matchAll(/<p:cNvPr id="(\d+)"/g)].map((match) => match[1])

    expect(ids).toEqual(['1', '2', '3', '4', '5'])
    expect(groupXml(slide)).toContain('name="grp_2"')
  })

  it('writes a child once when the flat elementIds lists it too, the importer convention', async () => {
    const slide = await slideOf(await createPptx(groupedDocument({}, ['grp_1', 'el_a', 'el_b'])))

    expect(occurrences(slide, 'name="el_a"')).toBe(1)
    expect(occurrences(slide, 'name="el_b"')).toBe(1)
    expect(groupXml(slide)).toContain('name="el_a"')
  })

  /**
   * The renderer's `visited` rule painted a child that precedes its group as a top-level node and left
   * it out of the group. Export inherits that verbatim, so the file and the canvas agree about z order.
   */
  it('leaves a child that precedes its group at the top level, exactly as the canvas paints it', async () => {
    const slide = await slideOf(await createPptx(groupedDocument({}, ['el_a', 'grp_1'])))

    expect(occurrences(slide, 'name="el_a"')).toBe(1)
    expect(groupXml(slide)).not.toContain('name="el_a"')
    expect(slide.indexOf('name="el_a"')).toBeLessThan(slide.indexOf('name="grp_1"'))
  })

  it('materializes a photo used only inside a group', async () => {
    const document = groupedDocument()
    const child = document.elements.el_a
    if (child?.kind !== 'shape') throw new Error('fixture child was not a shape')
    child.pictureFill = { assetId: 'asset_photo', sourceCrop: { left: 10000 } }
    document.assets = { asset_photo: { id: 'asset_photo', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 } }
    const bytes = await createPptx(document, { assetAdapter: adapter })
    const entries = await entriesOf(bytes)
    const relationships = new TextDecoder().decode(entries.get('ppt/slides/_rels/slide1.xml.rels'))

    expect([...entries.keys()].filter((name) => name.startsWith('ppt/media/'))).toHaveLength(1)
    expect(relationships).toContain('Target="../media/image1.png"')
    expect(groupXml(await slideOf(bytes))).toContain('<a:blipFill><a:blip r:embed="rId2"/><a:srcRect l="10000"/>')
  })

  it('writes a table and a picture nested in the group', async () => {
    const document = groupedDocument({ childIds: ['el_table', 'el_image'] })
    document.elements.el_table = {
      id: 'el_table',
      kind: 'table',
      bounds: { x: 1000000, y: 2000000, w: 2000000, h: 1000000 },
      columns: [2000000],
      rows: [{ height: 1000000, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Cell' }] }] } }] }],
    }
    document.elements.el_image = { id: 'el_image', kind: 'image', bounds: { x: 3000000, y: 2000000, w: 1000000, h: 1000000 }, assetId: 'asset_photo' }
    document.assets = { asset_photo: { id: 'asset_photo', mimeType: 'image/png', pixelWidth: 32, pixelHeight: 16 } }
    const group = groupXml(await slideOf(await createPptx(document, { assetAdapter: adapter })))

    expect(group).toContain('<p:graphicFrame>')
    expect(group).toContain('<p:pic>')
  })

  it('still rejects an unmodeled kind, nested as well as top level', async () => {
    const document = groupedDocument()
    document.elements.el_a = { ...document.elements.el_a, kind: 'connector' } as unknown as Element

    await expect(createPptx(document)).rejects.toThrow('PPTX generation unsupported element kind: connector')
  })

  it('brings the whole group tree back through importPptx', async () => {
    const document = groupedDocument({ rotation: 2700000, flipH: true, childIds: ['grp_2', 'el_b'] })
    document.elements.grp_2 = { id: 'grp_2', kind: 'group', bounds: { x: 1000000, y: 2000000, w: 2000000, h: 1000000 }, childIds: ['el_a'] }
    const imported = await importPptx(await createPptx(document))
    const outer = imported.elements.grp_1
    const inner = imported.elements.grp_2
    if (outer?.kind !== 'group' || inner?.kind !== 'group') throw new Error('the groups did not come back as groups')

    // Leaves are numbered in document order, so the one nested a level deeper is `el_1`.
    expect(outer).toMatchObject({ bounds: { x: 1000000, y: 2000000, w: 4000000, h: 2000000 }, rotation: 2700000, flipH: true, childIds: ['grp_2', 'el_2'] })
    expect(inner.childIds).toEqual(['el_1'])
    expect(imported.elements.el_1?.bounds).toEqual({ x: 1000000, y: 2000000, w: 2000000, h: 1000000 })
    // The identity child space the export invents is read back as a field the source model lacked. It
    // is a no-op — `mapChildSpace` with `childSpace === target` is the identity — and pinned here so the
    // one difference the round trip has is written down rather than discovered later.
    expect(outer.childSpace).toEqual(outer.bounds)
  })
})
