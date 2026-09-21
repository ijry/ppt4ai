import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const slideRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'
const layoutRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>'

/** The title states no `a:xfrm` and inherits; the subtitle states its own, so the slide has both shapes. */
const titleSp = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
  + '<p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Inherited</a:t></a:r></a:p></p:txBody></p:sp>'

const subtitleSp = '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Subtitle"/><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>'
  + '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Positioned</a:t></a:r></a:p></p:txBody></p:sp>'

function sourcePackage(): Uint8Array {
  const slide = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>${titleSp}${subtitleSp}</p:spTree></p:cSld></p:sld>`
  const layout = '<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>'
    + '</p:sp></p:spTree></p:cSld></p:sldLayout>'
  const master = '<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree/></p:cSld>'
    + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3"'
    + ' accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:sldMaster>'
  const encode = (value: string) => new TextEncoder().encode(value)
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: encode(presentationRels) },
    { name: 'ppt/slides/slide1.xml', data: encode(slide) },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: encode(slideRels) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: encode(layout) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: encode(layoutRels) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: encode(master) },
  ])
}

async function movedFirst(x: number): Promise<string> {
  const source = sourcePackage()
  const document = await importPptx(source)
  const ids = Object.values(document.slides)[0]?.elementIds ?? []
  const element = document.elements[ids[0] ?? '']
  if (!element) throw new Error('the inherited element did not import')
  element.bounds = { ...element.bounds, x }
  return slideXmlOf(await exportPptx(document, source))
}

async function slideXmlOf(bytes: Uint8Array): Promise<string> {
  const entries = new Map((await readZipEntries(bytes)).map((entry) => [entry.name, entry.data]))
  const data = entries.get('ppt/slides/slide1.xml')
  if (!data) throw new Error('missing slide')
  return new TextDecoder().decode(data)
}

describe('a placeholder with inherited bounds survives source writeback', () => {
  it('imports both shapes, one of them through inheritance', async () => {
    const document = await importPptx(sourcePackage())
    const ids = Object.values(document.slides)[0]?.elementIds ?? []

    expect(ids).toHaveLength(2)
    expect(document.elements[ids[0] ?? '']?.bounds)
      .toEqual({ x: 838200, y: 365125, w: 10515600, h: 1325563 })
  })

  /**
   * The safety property this slice rests on. The model now holds bounds the source never stated, and the
   * writeback has to leave that alone — `boundsReplacements` returns early when the source has no
   * `a:xfrm`, so it never invents one. Without this the whole slice would rewrite every such deck.
   */
  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /**
   * Moving it used to be lost: the element was visible and draggable after the import slice, and the move
   * silently did not persist. The node is created now, first inside `p:spPr` as `CT_ShapeProperties` wants,
   * and the self-closing `<p:spPr/>` is expanded to hold it.
   */
  it('creates the transform when the inherited element moves', async () => {
    const slide = await movedFirst(4444444)

    expect(slide).toContain('<p:spPr><a:xfrm><a:off x="4444444" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>')
  })

  it('keeps the inherited height and width it was not asked to change', async () => {
    const slide = await movedFirst(4444444)

    expect(slide).toContain('cx="10515600" cy="1325563"')
  })

  /** Rotation went through the same hole, so it is created by the same insertion. */
  it('creates the transform with a rotation', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const ids = Object.values(document.slides)[0]?.elementIds ?? []
    const element = document.elements[ids[0] ?? '']
    if (element?.kind !== 'text') throw new Error('the inherited element did not import as text')
    element.rotation = 2700000

    const slide = await slideXmlOf(await exportPptx(document, source))

    expect(slide).toContain('<a:xfrm rot="2700000">')
  })

  /** Nothing moved, so nothing is created — this is the byte-identity property in its edited form. */
  it('creates nothing when the inherited bounds are unchanged', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const ids = Object.values(document.slides)[0]?.elementIds ?? []
    const other = document.elements[ids[1] ?? '']
    if (!other) throw new Error('the positioned element did not import')
    other.bounds = { ...other.bounds, x: 5555555 }

    const slide = await slideXmlOf(await exportPptx(document, source))

    expect(slide).toContain('<p:spPr/>')
  })

  /** Editing its neighbour must not disturb it, which is what a shifted positional map would do. */
  it('leaves the inherited placeholder untouched when the other shape moves', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const ids = Object.values(document.slides)[0]?.elementIds ?? []
    const other = document.elements[ids[1] ?? '']
    if (!other) throw new Error('the positioned element did not import')
    other.bounds = { ...other.bounds, x: 5555555 }

    const slide = await slideXmlOf(await exportPptx(document, source))

    expect(slide).toContain(titleSp)
    expect(slide).toContain('x="5555555"')
  })
})
