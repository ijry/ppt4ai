import { describe, expect, it } from 'vitest'
import { importPptx, type ImportIssue } from './importer'
import { createStoredZip, files } from './test-fixtures'
import type { AssetAdapter, Ppt4aiDocument } from '@ppt4ai/model'

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x10,
  0x08, 0x06, 0x00, 0x00, 0x00,
])

/** EMF is not a bitmap, so the shared sniffer refuses it — the same media the picture path reports. */
const emfBytes = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x6c, 0x00, 0x00, 0x00])

class RecordingAdapter implements AssetAdapter {
  readonly writes: { id: string; data: Uint8Array }[] = []
  async get(): Promise<Uint8Array | undefined> {
    return undefined
  }
  async put(assetId: string, data: Uint8Array): Promise<void> {
    this.writes.push({ id: assetId, data })
  }
}

function shape(id: number, fill: string, tag: 'sp' = 'sp'): string {
  return `<p:${tag}><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"/>${fill}</p:spPr></p:${tag}>`
}

const stretched = '<a:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>'
const relationships = `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/drawing.emf"/></Relationships>`

async function documentFor(
  body: string,
  options: { adapter?: RecordingAdapter; issues?: ImportIssue[]; media?: Record<string, Uint8Array> } = {},
): Promise<Ppt4aiDocument> {
  const zip = createStoredZip({
    ...files,
    'ppt/slides/slide1.xml': `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels': relationships,
    'ppt/media/image1.png': pngBytes,
    ...(options.media ?? {}),
  })
  return importPptx(zip, {
    ...(options.adapter ? { assetAdapter: options.adapter } : {}),
    ...(options.issues ? { onIssue: (issue: ImportIssue) => options.issues!.push(issue) } : {}),
  })
}

function shapeElement(document: Ppt4aiDocument, id: string) {
  const element = document.elements[id]
  if (element?.kind !== 'shape' && element?.kind !== 'text') throw new Error(`element ${id} is not a shape or text`)
  return element
}

describe('shape picture fill import', () => {
  it('reads a stretched blip fill into the model and registers its media', async () => {
    const adapter = new RecordingAdapter()
    const document = await documentFor(shape(2, stretched), { adapter })

    expect(shapeElement(document, 'el_1').pictureFill).toEqual({ assetId: 'asset_ppt_media_image1_png' })
    expect(document.assets?.asset_ppt_media_image1_png).toEqual({
      id: 'asset_ppt_media_image1_png',
      mimeType: 'image/png',
      pixelWidth: 32,
      pixelHeight: 16,
      originalFilename: 'image1.png',
    })
    expect(adapter.writes.map((write) => write.id)).toEqual(['asset_ppt_media_image1_png'])
    expect(adapter.writes[0]?.data).toEqual(pngBytes)
  })

  it('reads a:srcRect into sourceCrop', async () => {
    const fill = '<a:blipFill><a:blip r:embed="rId2"/><a:srcRect l="10000" t="20000" r="30000" b="40000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>'
    const document = await documentFor(shape(2, fill))

    expect(shapeElement(document, 'el_1').pictureFill).toEqual({
      assetId: 'asset_ppt_media_image1_png',
      sourceCrop: { left: 10000, top: 20000, right: 30000, bottom: 40000 },
    })
  })

  /** A blip fill with no fill mode has no repeats to place, so stretch is the only reading available. */
  it('treats a missing fill mode as stretch', async () => {
    const document = await documentFor(shape(2, '<a:blipFill><a:blip r:embed="rId2"/></a:blipFill>'))

    expect(shapeElement(document, 'el_1').pictureFill).toEqual({ assetId: 'asset_ppt_media_image1_png' })
  })

  /**
   * This used to assert the opposite — a tiled fill was refused whole, so the shape painted nothing.
   * The six placement attributes are modeled now; `flip` is kept but not painted.
   */
  it('reads a tiled blip fill and its placement', async () => {
    const adapter = new RecordingAdapter()
    const fill = '<a:blipFill><a:blip r:embed="rId2"/><a:tile tx="76200" ty="-38100" sx="50000" sy="60000" flip="x" algn="ctr"/></a:blipFill>'
    const document = await documentFor(shape(2, fill), { adapter })

    expect(shapeElement(document, 'el_1').pictureFill).toEqual({
      assetId: 'asset_ppt_media_image1_png',
      tile: { offsetX: 76200, offsetY: -38100, scaleX: 50000, scaleY: 60000, align: 'ctr', flip: 'x' },
    })
    expect(adapter.writes).toHaveLength(1)
  })

  it('reads the blip effects a shape fill carries', async () => {
    const fill = '<a:blipFill><a:blip r:embed="rId2"><a:alphaModFix amt="40000"/><a:grayscl/></a:blip><a:stretch/></a:blipFill>'
    const document = await documentFor(shape(2, fill))

    expect(shapeElement(document, 'el_1').pictureFill?.effects).toEqual([
      { type: 'alphaModFix', amount: 40000 },
      { type: 'grayscl' },
    ])
  })

  it('leaves the tile field absent for a stretched fill', async () => {
    const document = await documentFor(shape(2, stretched))

    expect(shapeElement(document, 'el_1').pictureFill).not.toHaveProperty('tile')
  })

  it('leaves the fill unset when the relationship or the media part is missing', async () => {
    const missingRelationship = await documentFor(shape(2, '<a:blipFill><a:blip r:embed="rId9"/><a:stretch/></a:blipFill>'))
    expect(shapeElement(missingRelationship, 'el_1').pictureFill).toBeUndefined()

    const missingPart = await documentFor(shape(2, '<a:blipFill><a:blip r:embed="rId3"/><a:stretch/></a:blipFill>'))
    expect(shapeElement(missingPart, 'el_1').pictureFill).toBeUndefined()
  })

  it('reports unsupported media instead of dropping it silently', async () => {
    const issues: ImportIssue[] = []
    const document = await documentFor(shape(2, '<a:blipFill><a:blip r:embed="rId3"/><a:stretch/></a:blipFill>'), {
      issues,
      media: { 'ppt/media/drawing.emf': emfBytes },
    })

    expect(shapeElement(document, 'el_1').pictureFill).toBeUndefined()
    expect(issues).toEqual([{
      code: 'unsupported-media',
      slideId: 'sld_1',
      partPath: 'ppt/media/drawing.emf',
      message: 'picture fill skipped because ppt/media/drawing.emf is not a supported bitmap format',
    }])
  })

  it('registers one asset when two shapes share a media part', async () => {
    const adapter = new RecordingAdapter()
    const document = await documentFor(shape(2, stretched) + shape(3, stretched), { adapter })

    expect(shapeElement(document, 'el_1').pictureFill?.assetId).toBe('asset_ppt_media_image1_png')
    expect(shapeElement(document, 'el_2').pictureFill?.assetId).toBe('asset_ppt_media_image1_png')
    expect(adapter.writes).toHaveLength(1)
  })

  it('reads a picture fill on a text-carrying shape and inside a group', async () => {
    const textShape = `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Titled"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"/>${stretched}</p:spPr><p:txBody><a:p><a:r><a:t>Filled</a:t></a:r></a:p></p:txBody></p:sp>`
    const group = `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="2000000"/></a:xfrm></p:grpSpPr>${shape(5, stretched)}</p:grpSp>`
    const document = await documentFor(textShape + group)

    expect(shapeElement(document, 'el_1').kind).toBe('text')
    expect(shapeElement(document, 'el_1').pictureFill?.assetId).toBe('asset_ppt_media_image1_png')
    expect(shapeElement(document, 'el_2').pictureFill?.assetId).toBe('asset_ppt_media_image1_png')
  })

  it('leaves a colour fill alone', async () => {
    const document = await documentFor(shape(2, '<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>'))
    const element = shapeElement(document, 'el_1')

    expect(element.pictureFill).toBeUndefined()
    expect(element.fill).toEqual({ color: { type: 'srgb', v: '4472C4' } })
  })
})
