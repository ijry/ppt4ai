import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument, ShapeElement } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const navy = '<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>'
/** Carries `sx`, `algn` and a sibling `a:glow`: three things the model cannot express. */
const sourceEffects = '<a:effectLst data-keep="yes"><a:outerShdw blurRad="50800" dist="38100" dir="2700000" sx="90000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw><a:glow rad="63500"><a:srgbClr val="FF0000"/></a:glow></a:effectLst>'

function sourcePackage(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Shadowed"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${navy}${sourceEffects}</p:spPr></p:sp>`
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

const shadowedShape: ShapeElement = {
  id: 'shape_1',
  kind: 'shape',
  preset: 'rect',
  bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
  fill: { color: { type: 'srgb', v: '4472C4' } },
  stroke: { color: { type: 'srgb', v: '203864' } },
  shadow: { color: { type: 'srgb', v: '000000' }, blurRadius: 50800, distance: 38100, direction: 2700000 },
}

function documentWith(shape: ShapeElement): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_shadow',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: [shape.id] } },
    slideOrder: ['sld_1'],
    elements: { [shape.id]: shape },
  }
}

describe('outer shadow standalone generation', () => {
  it('writes the shadow after the outline and re-imports it', async () => {
    const output = await createPptx(documentWith(shadowedShape))
    const xml = await slideOf(output)

    expect(xml).toContain('<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000"><a:srgbClr val="000000"/></a:outerShdw></a:effectLst>')
    expect(xml.indexOf('</a:ln>')).toBeLessThan(xml.indexOf('<a:effectLst>'))

    const imported = await importPptx(output)
    const shape = imported.elements[imported.slides.sld_1?.elementIds[0] ?? '']
    if (shape?.kind !== 'shape') throw new Error('the generated shape did not import as a shape')
    expect(shape.shadow).toEqual(shadowedShape.shadow)
  })

  it('writes nothing when the shape has no shadow', async () => {
    const plain: ShapeElement = { ...shadowedShape }
    delete plain.shadow

    expect(await slideOf(await createPptx(documentWith(plain)))).not.toContain('effectLst')
  })
})

/**
 * Decision 4: the model holds four of `a:outerShdw`'s attributes and none of its siblings, so writing
 * the node back from the model would delete `sx`, `algn` and the `a:glow` next to it. There is no
 * command to change a shadow, so the writeback leaves the whole effect list alone.
 */
describe('outer shadow source writeback', () => {
  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  it('keeps the effect list verbatim through an unrelated edit', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    expect(shape.shadow).toMatchObject({ blurRadius: 50800, distance: 38100, direction: 2700000 })
    shape.bounds = { ...shape.bounds, x: 3000000 }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain(sourceEffects)
    expect(xml).toContain('<a:off x="3000000" y="1000000"/>')
  })

  /**
   * Dropping the model shadow used to do nothing at all; it now removes the node. What must survive is
   * everything the model cannot express — the `a:glow` here, and the list itself — because rewriting the
   * whole `a:effectLst` is the damage this exporter has had to undo twice.
   */
  it('removes only the shadow node when the model shadow is dropped', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    delete shape.shadow
    shape.bounds = { ...shape.bounds, y: 2000000 }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain('<a:effectLst data-keep="yes"><a:glow rad="63500"><a:srgbClr val="FF0000"/></a:glow></a:effectLst>')
    expect(xml).not.toContain('outerShdw')
  })

  it('patches the modeled parts of the shadow node when the model shadow changes', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    shape.shadow = { color: { type: 'srgb', v: 'FF0000' }, blurRadius: 12700 }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain('blurRad="12700"')
    expect(xml).toContain('<a:srgbClr val="FF0000"/></a:outerShdw>')
    // The model no longer carries these two, so their attributes go.
    expect(xml).not.toContain('dist="38100"')
    expect(xml).not.toContain('dir="2700000"')
    expect(xml).toContain('<a:glow rad="63500">')
    expect(xml).toContain('data-keep="yes"')
  })

  /**
   * These used to be lost, because changing a shadow rewrote the whole node. The node is patched in
   * place now — the same move as replacing only `a:outerShdw` rather than the whole `a:effectLst`, one
   * level further in — so what the model cannot express survives an edit to what it can.
   */
  it('keeps the shadow attributes the model cannot express', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    shape.shadow = { color: { type: 'srgb', v: 'FF0000' }, blurRadius: 12700 }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain('sx="90000"')
    expect(xml).toContain('algn="tl"')
    expect(xml).toContain('rotWithShape="0"')
  })

  /** Only what changed is touched: a blur edit must not rewrite the colour child. */
  it('leaves the colour alone when only a measurement changes', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    shape.shadow = { ...shape.shadow!, blurRadius: 12700 }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain('blurRad="12700"')
    expect(xml).toContain('<a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr>')
  })

  it('removes an attribute the model no longer carries', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const shape = document.elements.el_1
    if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
    shape.shadow = { color: shape.shadow!.color, blurRadius: 50800, direction: 2700000 }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).not.toContain('dist=')
    expect(xml).toContain('blurRad="50800"')
    expect(xml).toContain('dir="2700000"')
  })
})
