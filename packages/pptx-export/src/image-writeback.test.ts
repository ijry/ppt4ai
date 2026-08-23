import type { ImageElement } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import {
  allocateMediaPath,
  allocateRelationshipId,
  imageExtension,
  replacePictureRelationship,
  serializeImageRelationship,
  serializePictureXml,
  stableAssetId,
} from './image-writeback.js'

const image: ImageElement = {
  id: 'img_1',
  kind: 'image',
  bounds: { x: 10, y: 20, w: 300, h: 400 },
  assetId: 'asset_1',
  transform: { rotation: 60000, flipH: true, flipV: false },
  sourceCrop: { left: 1000, top: 2000, right: 3000, bottom: 4000 },
  maskPreset: 'ellipse',
  effects: [{ type: 'alphaModFix', amount: 50000 }, { type: 'grayscl' }],
}

describe('image writeback helpers', () => {
  it('maps supported MIME types to deterministic media extensions', () => {
    expect(imageExtension('image/png')).toBe('png')
    expect(imageExtension('image/jpeg')).toBe('jpg')
    expect(imageExtension('image/gif')).toBe('gif')
    expect(imageExtension('image/bmp')).toBe('bmp')
    expect(imageExtension('image/webp')).toBe('webp')
  })

  it('allocates first-free media names and relationship IDs', () => {
    const entries = new Set(['ppt/media/image1.png', 'ppt/media/image3.jpg'])
    expect(allocateMediaPath(entries, 'image/png')).toBe('ppt/media/image2.png')
    expect(allocateRelationshipId(new Set(['rId1', 'rId3']))).toBe('rId2')
  })

  it('derives asset IDs using the importer media path rule', () => {
    expect(stableAssetId('ppt/media/Image 01.PNG')).toBe('asset_ppt_media_image_01_png')
  })

  it('serializes image relationships with escaped attributes', () => {
    expect(serializeImageRelationship('rId&1', '../media/image&1.png')).toBe(
      '<Relationship Id="rId&amp;1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image&amp;1.png"/>',
    )
  })

  it('generates picture XML from image appearance', () => {
    const xml = serializePictureXml(image, 'rId7', 42)
    expect(xml).toContain('<a:off x="10" y="20"/><a:ext cx="300" cy="400"/>')
    expect(xml).toContain('<a:blip r:embed="rId7">')
    expect(xml).toContain('<a:srcRect l="1000" t="2000" r="3000" b="4000"/>')
    expect(xml).toContain('<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>')
    expect(xml).toContain('<a:alphaModFix amt="50000"/><a:grayscl/>')
    expect(xml).toContain('<p:cNvPr id="42" name="img_1"/>')
  })

  it('escapes generated XML attributes', () => {
    const xml = serializePictureXml({ ...image, id: 'image&<1' }, 'rId&1', 1)
    expect(xml).toContain('r:embed="rId&amp;1"')
    expect(xml).toContain('name="image&amp;&lt;1"')
  })

  it('replaces only the embedded relationship in existing picture XML', () => {
    const xml = '<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>'
    expect(replacePictureRelationship(xml, 'rId8')).toBe(
      '<p:pic><p:blipFill><a:blip r:embed="rId8"/></p:blipFill></p:pic>',
    )
  })

  it('preserves the source quote style while replacing the embedded relationship', () => {
    const xml = `<p:pic><a:blip r:embed='rId2'/></p:pic>`
    expect(replacePictureRelationship(xml, 'rId8')).toBe(
      `<p:pic><a:blip r:embed='rId8'/></p:pic>`,
    )
  })

  it('rejects picture XML without an embedded relationship', () => {
    expect(() => replacePictureRelationship('<p:pic/>', 'rId8')).toThrow(
      'PPTX export image relationship missing',
    )
  })
})
