import { importPptx } from '@ppt4ai/pptx-import'
import { createCustomPath } from '@ppt4ai/geometry'
import type { CustomGeometry, Ppt4aiDocument, ShapeElement } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx, exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const sourceGeometry = '<a:custGeom data-keep="yes"><a:avLst/><a:gdLst/><a:cxnLst/><a:rect l="0" t="0" r="100" b="100"/>'
  + '<a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="100"/></a:moveTo><a:lnTo><a:pt x="50" y="0"/></a:lnTo>'
  + '<a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>'

function sourcePackage(): Uint8Array {
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Freeform"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `${sourceGeometry}<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></p:spPr></p:sp>`
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

async function shapeOf(bytes: Uint8Array) {
  const document = await importPptx(bytes)
  const shape = document.elements[document.slides.sld_1?.elementIds[0] ?? ''] ?? document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  return { document, shape }
}

const triangle: CustomGeometry = {
  paths: [{
    width: 100,
    height: 100,
    commands: [
      { type: 'move', x: 0, y: 100 },
      { type: 'line', x: 50, y: 0 },
      { type: 'line', x: 100, y: 100 },
      { type: 'close' },
    ],
  }],
}

const curves: CustomGeometry = {
  paths: [{
    commands: [
      { type: 'move', x: 0, y: 0 },
      { type: 'cubic', x1: 10, y1: 20, x2: 30, y2: 40, x: 50, y: 60 },
      { type: 'quad', x1: 70, y1: 80, x: 90, y: 100 },
      { type: 'arc', widthRadius: 25, heightRadius: 15, startAngle: 0, swingAngle: 5400000 },
      { type: 'close' },
    ],
  }],
}

function documentWith(geometry: CustomGeometry): Ppt4aiDocument {
  const shape: ShapeElement = {
    id: 'shape_1',
    kind: 'shape',
    preset: 'rect',
    bounds: { x: 1000000, y: 1000000, w: 2000000, h: 1000000 },
    customGeometry: geometry,
    fill: { color: { type: 'srgb', v: '4472C4' } },
  }
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_custom_geometry',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['shape_1'] } },
    slideOrder: ['sld_1'],
    elements: { shape_1: shape },
  }
}

/** Before this, `createPptx` wrote `prst="rect"` and the whole path was gone from the file. */
describe('custom geometry in standalone generation', () => {
  it('writes the path list instead of a preset', async () => {
    const xml = await slideOf(await createPptx(documentWith(triangle)))

    expect(xml).toContain('<a:custGeom><a:avLst/><a:pathLst><a:path w="100" h="100">')
    expect(xml).toContain('<a:moveTo><a:pt x="0" y="100"/></a:moveTo>')
    expect(xml).toContain('<a:lnTo><a:pt x="50" y="0"/></a:lnTo>')
    expect(xml).toContain('<a:close/>')
    expect(xml).not.toContain('prstGeom')
  })

  it('round-trips every command kind', async () => {
    const output = await createPptx(documentWith(curves))

    expect(await slideOf(output)).toContain('<a:arcTo wR="25" hR="15" stAng="0" swAng="5400000"/>')
    expect((await shapeOf(output)).shape.customGeometry).toEqual(curves)
  })
})

describe('custom geometry in source writeback', () => {
  it('imports the literal path and ignores the parts it does not model', async () => {
    const { shape } = await shapeOf(sourcePackage())

    expect(shape.customGeometry).toEqual(triangle)
    // The preset stays `rect`, which is what keeps the geometry writeback from touching the node.
    expect(shape.preset).toBe('rect')
  })

  it('stays byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /** `a:gdLst`, `a:cxnLst` and `a:rect` are unmodeled, so the node has to survive an edit verbatim. */
  it('keeps the custGeom node verbatim through an unrelated edit', async () => {
    const source = sourcePackage()
    const { document, shape } = await shapeOf(source)
    shape.bounds = { ...shape.bounds, x: 3000000 }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain(sourceGeometry)
    expect(xml).toContain('<a:off x="3000000" y="1000000"/>')
  })
})

describe('mapping a custom path into the shape box', () => {
  it('scales the path space onto the bounds', () => {
    const bounds = { x: 100, y: 50, w: 200, h: 100 }

    expect(createCustomPath(triangle.paths, bounds)).toEqual([
      { type: 'move', x: 100, y: 150 },
      { type: 'line', x: 200, y: 50 },
      { type: 'line', x: 300, y: 150 },
      { type: 'close' },
    ])
  })

  /** `a:arcTo` names radii and angles; the centre comes from where the pen already is. */
  it('derives the arc centre from the current point', () => {
    const path = createCustomPath(
      [{ commands: [{ type: 'move', x: 10, y: 0 }, { type: 'arc', widthRadius: 10, heightRadius: 10, startAngle: 0, swingAngle: 5400000 }] }],
      { x: 0, y: 0, w: 100, h: 100 },
    )

    expect(path[1]).toMatchObject({ type: 'arc', cx: 0, cy: 0, rx: 10, ry: 10 })
  })

  it('leaves a path with no coordinate space in the shape space', () => {
    const path = createCustomPath([{ commands: [{ type: 'move', x: 5, y: 7 }] }], { x: 1000, y: 2000, w: 10, h: 10 })

    expect(path[0]).toEqual({ type: 'move', x: 1005, y: 2007 })
  })
})
