import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x10,
  0x08, 0x06, 0x00, 0x00, 0x00,
])

/** `p:bg` has the same shape in a master, a layout and a slide; only the relationship table differs. */
function pictureBackground(relationshipId: string, extra = ''): string {
  return `<p:bg><p:bgPr><a:blipFill><a:blip r:embed="${relationshipId}"/>${extra}<a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`
}

function partRelationships(imageTarget: string): string {
  return `<Relationships xmlns="r"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${imageTarget}"/></Relationships>`
}

async function importWith(overrides: Record<string, string>, media = { 'ppt/media/backdrop.png': pngBytes }) {
  return importPptx(createStoredZip({ ...files, ...overrides, ...media } as Record<string, string | Uint8Array>))
}

const masterWithPicture = '<p:sldMaster xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld>'
  + `${pictureBackground('rId9', '<a:srcRect l="10000"/>')}<p:spTree/></p:cSld></p:sldMaster>`

const layoutWithPicture = '<p:sldLayout xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld>'
  + `${pictureBackground('rId9', '<a:tile algn="ctr" sx="50000"/>')}<p:spTree/></p:cSld></p:sldLayout>`

describe('inherited picture background', () => {
  it('reads a master background blip through the master\'s own relationships', async () => {
    const imported = await importWith({
      'ppt/slideMasters/slideMaster1.xml': masterWithPicture,
      'ppt/slideMasters/_rels/slideMaster1.xml.rels': partRelationships('../media/backdrop.png'),
    })
    const master = Object.values(imported.masters ?? {})[0]

    expect(master?.background?.pictureFill).toEqual({ assetId: 'asset_ppt_media_backdrop_png', sourceCrop: { left: 10000 } })
    expect(Object.keys(imported.assets ?? {})).toEqual(['asset_ppt_media_backdrop_png'])
  })

  it('reads a layout background blip and its tile', async () => {
    const imported = await importWith({
      'ppt/slideLayouts/slideLayout1.xml': layoutWithPicture,
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/backdrop.png"/></Relationships>`,
    })
    const layout = Object.values(imported.layouts ?? {})[0]

    expect(layout?.background?.pictureFill).toEqual({ assetId: 'asset_ppt_media_backdrop_png', tile: { align: 'ctr', scaleX: 50000 } })
  })

  it('registers one asset when the master and the layout share the photo', async () => {
    const imported = await importWith({
      'ppt/slideMasters/slideMaster1.xml': masterWithPicture,
      'ppt/slideMasters/_rels/slideMaster1.xml.rels': partRelationships('../media/backdrop.png'),
      'ppt/slideLayouts/slideLayout1.xml': layoutWithPicture,
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/backdrop.png"/></Relationships>`,
    })

    expect(Object.keys(imported.assets ?? {})).toEqual(['asset_ppt_media_backdrop_png'])
    expect(Object.values(imported.masters ?? {})[0]?.background?.pictureFill?.assetId).toBe('asset_ppt_media_backdrop_png')
    expect(Object.values(imported.layouts ?? {})[0]?.background?.pictureFill?.assetId).toBe('asset_ppt_media_backdrop_png')
  })

  it('reports media it cannot decode and leaves the background unset', async () => {
    const issues: string[] = []
    const document = await importPptx(
      createStoredZip({
        ...files,
        'ppt/slideMasters/slideMaster1.xml': masterWithPicture,
        'ppt/slideMasters/_rels/slideMaster1.xml.rels': partRelationships('../media/backdrop.emf'),
        'ppt/media/backdrop.emf': new Uint8Array([1, 2, 3, 4]),
      } as Record<string, string | Uint8Array>),
      { onIssue: (issue) => issues.push(issue.message) },
    )

    expect(Object.values(document.masters ?? {})[0]?.background).toBeUndefined()
    expect(issues).toEqual(['master background skipped because ppt/media/backdrop.emf is not a supported bitmap format'])
  })

  /** A colour background still reaches the model the way it always did. */
  it('leaves a solid background alone', async () => {
    const imported = await importWith({
      'ppt/slideMasters/slideMaster1.xml': '<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill></p:bgPr></p:bg><p:spTree/></p:cSld></p:sldMaster>',
    })

    expect(Object.values(imported.masters ?? {})[0]?.background).toEqual({ fill: { color: { type: 'srgb', v: '1F3864' } } })
  })
})
