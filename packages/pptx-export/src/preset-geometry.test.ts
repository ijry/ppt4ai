import { importPptx } from '@ppt4ai/pptx-import'
import { createPresetPath } from '@ppt4ai/geometry'
import type { Ppt4aiDocument, ShapeElement } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const geometry = '<a:prstGeom prst="chevron"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>'

function sourcePackage(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Shaped"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `${geometry}<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></p:spPr></p:sp>`
    + '</p:spTree></p:cSld></p:sld>'
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
  ])
}

async function slideOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  return new TextDecoder().decode(entries.get('ppt/slides/slide1.xml')!)
}

function documentWith(preset: string): Ppt4aiDocument {
  const shape: ShapeElement = {
    id: 'shape_1',
    kind: 'shape',
    preset,
    bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
    fill: { color: { type: 'srgb', v: '4472C4' } },
  }
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_preset_geometry',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1'] } },
    slideOrder: ['sld_1'],
    elements: { shape_1: shape },
  }
}

/** The loss this slice fixes: `createPptx` used to write `prst="rect"` for every unpainted word. */
describe('preset geometry tokens in standalone generation', () => {
  it('writes and re-reads every word verbatim', async () => {
    for (const preset of ['chevron', 'star5', 'rightArrow', 'flowChartMagneticDisk', 'roundRect']) {
      const output = await createPptx(documentWith(preset))

      expect(await slideOf(output)).toContain(`<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>`)
      const imported = await importPptx(output)
      const shape = imported.elements[imported.slides.sld_1?.elementIds[0] ?? '']
      if (shape?.kind !== 'shape') throw new Error('the generated shape did not import as a shape')
      expect(shape.preset).toBe(preset)
    }
  })
})

describe('preset geometry tokens in source writeback', () => {
  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /** The adjust values live inside the node the writeback must not rebuild. */
  it('keeps the word and its adjust values through an unrelated edit', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    expect(shape.preset).toBe('chevron')
    shape.bounds = { ...shape.bounds, x: 3000000 }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain(geometry)
    expect(xml).toContain('<a:off x="3000000" y="1000000"/>')
  })

  /** Before the words were modeled, this comparison could not tell `chevron` from `star5`. */
  it('writes a change between two words that used to collapse together', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    shape.preset = 'star5'

    expect(await slideOf(await exportPptx(document, source))).toContain('prst="star5"')
  })
})

describe('painting an unpainted word', () => {
  it('draws the bounding rectangle, exactly as before the word was preserved', () => {
    const bounds = { x: 0, y: 0, w: 200, h: 100 }

    expect(createPresetPath('chevron', bounds)).toEqual(createPresetPath('rect', bounds))
    expect(createPresetPath('flowChartMagneticDisk', bounds)).toEqual(createPresetPath('rect', bounds))
  })

  it('still draws the four it knows', () => {
    const bounds = { x: 0, y: 0, w: 200, h: 100 }

    expect(createPresetPath('ellipse', bounds)).not.toEqual(createPresetPath('rect', bounds))
    expect(createPresetPath('triangle', bounds)).not.toEqual(createPresetPath('rect', bounds))
    expect(createPresetPath('roundRect', bounds)).not.toEqual(createPresetPath('rect', bounds))
  })
})
