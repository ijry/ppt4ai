import { describe, expect, it } from 'vitest'
import { fingerprintBytes, fingerprintDocument, type AssetAdapter, type AssetMetadata } from '@ppt4ai/model'
import { importPptx, parseXml, readZipEntries } from './index'

function createStoredZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const [name, value] of Object.entries(files)) {
    const nameBytes = encoder.encode(name)
    const valueBytes = typeof value === 'string' ? encoder.encode(value) : value
    const local = new Uint8Array(30 + nameBytes.length + valueBytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(8, 0, true)
    localView.setUint32(18, valueBytes.length, true)
    localView.setUint32(22, valueBytes.length, true)
    localView.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(valueBytes, 30 + nameBytes.length)
    locals.push(local)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint32(20, valueBytes.length, true)
    centralView.setUint32(24, valueBytes.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centrals.push(central)
    offset += local.length
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, locals.length, true)
  endView.setUint16(10, locals.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  const output = new Uint8Array(offset + centralSize + end.length)
  let cursor = 0
  for (const part of locals) {
    output.set(part, cursor)
    cursor += part.length
  }
  for (const part of centrals) {
    output.set(part, cursor)
    cursor += part.length
  }
  output.set(end, cursor)
  return output
}

const files = {
  'ppt/presentation.xml': `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
  'ppt/_rels/presentation.xml.rels': `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
  'ppt/slides/slide1.xml': `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="roundRect"/><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></p:spPr><p:txBody><a:p><a:r><a:t>Imported title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  'ppt/slides/_rels/slide1.xml.rels': `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`,
  'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  'ppt/slideMasters/slideMaster1.xml': `<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sldMaster>`,
}

const strokeFiles = {
  ...files,
  'ppt/slides/slide1.xml': '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp data-preserve="stroke-shape"><p:nvSpPr><p:cNvPr id="3" name="Shape"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"/><a:ln w="12700" cap="rnd" data-line="keep"><a:solidFill><a:srgbClr val="112233"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:prstDash val="dash"/><a:customLine keep="yes"/></a:ln></p:spPr></p:sp><p:sp data-preserve="stroke-text"><p:nvSpPr><p:cNvPr id="4" name="Text"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="500000" y="4000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm><a:ln w="25400"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Stroked text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  'ppt/slideLayouts/slideLayout1.xml': files['ppt/slideLayouts/slideLayout1.xml'].replace('<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>', '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="1000"><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></a:ln>'),
  'ppt/slideMasters/slideMaster1.xml': files['ppt/slideMasters/slideMaster1.xml'].replace('<a:solidFill><a:srgbClr val="000000"/></a:solidFill>', '<a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:ln w="2000"><a:solidFill><a:srgbClr val="FEDCBA"/></a:solidFill></a:ln>'),
}

const rotationFiles = {
  ...files,
  'ppt/slides/slide1.xml': '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp data-preserve="rotation-shape"><p:nvSpPr><p:cNvPr id="3" name="Shape"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="-5400000" data-rotation="keep"><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/><a:customTransform keep="yes"/></a:xfrm><a:prstGeom prst="triangle"/></p:spPr></p:sp><p:sp data-preserve="rotation-text"><p:nvSpPr><p:cNvPr id="4" name="Text"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="2700000"><a:off x="500000" y="4000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Rotated text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
}

const malformedRotationFiles = {
  ...rotationFiles,
  'ppt/slides/slide1.xml': rotationFiles['ppt/slides/slide1.xml'].replace('rot="-5400000"', 'rot="bad"').replace('rot="2700000"', 'rot="1.5"'),
}

const rotationDefaultsFiles = {
  ...files,
  'ppt/slideLayouts/slideLayout1.xml': files['ppt/slideLayouts/slideLayout1.xml'].replace('<p:spPr>', '<p:spPr><a:xfrm rot="-1800000"/>'),
  'ppt/slideMasters/slideMaster1.xml': files['ppt/slideMasters/slideMaster1.xml'].replace('<p:spPr>', '<p:spPr><a:xfrm rot="3600000"/>'),
}

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x10,
  0x08, 0x06, 0x00, 0x00, 0x00,
])

const jpegBytes = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x18, 0x00, 0x28,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
])

const gifBytes = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x07, 0x00, 0x09, 0x00,
])

const bmpBytes = new Uint8Array([
  0x42, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00,
  0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x0b, 0x00, 0x00, 0x00, 0x0d, 0x00,
  0x00, 0x00,
])

const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1e, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x1f, 0x00, 0x00, 0x0f, 0x00, 0x00,
])

const lossyWebpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x9d,
  0x01, 0x2a, 0x15, 0x00, 0x16, 0x00,
])

const losslessWebpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x11, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00, 0x2f, 0x10, 0x80, 0x04,
  0x00,
])

function pictureMarkup(relationshipId: string, x: number, includeBounds = true): string {
  const bounds = includeBounds ? `<a:xfrm><a:off x="${x}" y="1500000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>` : ''
  return `<p:pic><p:nvPicPr><p:cNvPr id="${x}" name="Picture"/><p:cNvPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relationshipId}"/></p:blipFill><p:spPr>${bounds}</p:spPr></p:pic>`
}

const bitmapFiles = {
  ...files,
  'ppt/slides/slide1.xml': `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Before"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1" y="1"/><a:ext cx="1" cy="1"/></a:xfrm></p:spPr></p:sp>${pictureMarkup('rId2', 2000000)}${pictureMarkup('rId3', 3000000)}${pictureMarkup('rId4', 4000000)}${pictureMarkup('rId5', 5000000)}${pictureMarkup('rId5', 6000000)}<p:sp><p:nvSpPr><p:cNvPr id="7" name="After"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1" y="1"/><a:ext cx="1" cy="1"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
  'ppt/slides/_rels/slide1.xml.rels': `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/photo.jpg"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/animation.gif"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/bitmap.bmp"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/vector.webp"/></Relationships>`,
  'ppt/media/photo.jpg': jpegBytes,
  'ppt/media/animation.gif': gifBytes,
  'ppt/media/bitmap.bmp': bmpBytes,
  'ppt/media/vector.webp': webpBytes,
}

const imageFiles = {
  ...files,
  'ppt/slides/slide1.xml': `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Before"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="1000000" cy="1000000"/></a:xfrm></p:spPr></p:sp><p:pic><p:nvPicPr><p:cNvPr id="4" name="Photo"/><p:cNvPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="2000000" y="1500000"/><a:ext cx="5000000" cy="3000000"/></a:xfrm></p:spPr></p:pic><p:pic><p:nvPicPr><p:cNvPr id="5" name="Broken"/><p:cNvPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="missing"/></p:blipFill><p:spPr><a:xfrm><a:off x="3000000" y="2000000"/><a:ext cx="5000000" cy="3000000"/></a:xfrm></p:spPr></p:pic><p:sp><p:nvSpPr><p:cNvPr id="6" name="After"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="4000000" y="4000000"/><a:ext cx="1000000" cy="1000000"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
  'ppt/slides/_rels/slide1.xml.rels': `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  'ppt/media/image1.png': pngBytes,
}

const imageAppearanceFiles = {
  ...imageFiles,
  'ppt/slides/slide1.xml': imageFiles['ppt/slides/slide1.xml']
    .replace('<a:xfrm><a:off x="2000000" y="1500000"/><a:ext cx="5000000" cy="3000000"/></a:xfrm>', '<a:xfrm rot="5400000" flipH="1" flipV="0"><a:off x="2000000" y="1500000"/><a:ext cx="5000000" cy="3000000"/></a:xfrm>')
    .replace('<a:blip r:embed="rId2"/>', '<a:blip r:embed="rId2"><a:alphaModFix amt="50000"/><a:grayscl/></a:blip><a:srcRect l="1000" t="2000" r="3000" b="4000"/>')
    .replace('</p:spPr></p:pic>', '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr></p:pic>'),
}

const malformedImageAppearanceFiles = {
  ...imageFiles,
  'ppt/slides/slide1.xml': imageFiles['ppt/slides/slide1.xml']
    .replace('<a:xfrm><a:off x="2000000" y="1500000"/><a:ext cx="5000000" cy="3000000"/></a:xfrm>', '<a:xfrm rot="bad" flipH="maybe" flipV="2"><a:off x="2000000" y="1500000"/><a:ext cx="5000000" cy="3000000"/></a:xfrm>')
    .replace('<a:blip r:embed="rId2"/>', '<a:blip r:embed="rId2"><a:alphaModFix amt="-1"/></a:blip><a:srcRect l="-1" t="100001" r="bad" b="invalid"/>')
    .replace('</p:spPr></p:pic>', '<a:prstGeom prst="hexagon"><a:avLst/></a:prstGeom></p:spPr></p:pic>'),
}

class RecordingAssetAdapter implements AssetAdapter {
  readonly writes: Array<{ assetId: string; data: Uint8Array; metadata: AssetMetadata }> = []

  async get(): Promise<Uint8Array | undefined> {
    return undefined
  }

  async put(assetId: string, data: Uint8Array, metadata: AssetMetadata): Promise<void> {
    this.writes.push({ assetId, data, metadata })
  }
}

const bulletFiles = {
  ...files,
  'ppt/slides/slide1.xml': '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody><a:p><a:pPr><a:buChar char="•"><a:rPr typeface="Wingdings"/></a:buChar></a:pPr><a:r><a:t>First</a:t></a:r></a:p><a:p><a:pPr><a:buAutoNum type="arabicPeriod" startAt="3"/></a:pPr><a:r><a:t>Second</a:t></a:r></a:p><a:p><a:pPr><a:buAutoNum type="alphaUcPeriod"/></a:pPr><a:r><a:t>Third</a:t></a:r></a:p><a:p><a:pPr><a:buAutoNum type="unsupportedFormat"/></a:pPr><a:r><a:t>Fourth</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
}

const themeFiles = {
  ...files,
  'ppt/slideMasters/_rels/slideMaster1.xml.rels': '<Relationships xmlns="r"><Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/custom.xml"/></Relationships>',
  'ppt/theme/custom.xml': '<a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Custom"><a:dk1><a:sysClr val="windowText" lastClr="202020"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="111111"/></a:dk2><a:lt2><a:scrgbClr r="100000" g="50000" b="0"/></a:lt2><a:accent1><a:srgbClr val="336699"><a:lumMod val="80000"/><a:lumOff val="10000"/><a:alphaMod val="90000"/><a:alphaOff val="5000"/></a:srgbClr></a:accent1><a:hlink><a:prstClr val="red"/></a:hlink><a:folHlink><a:srgbClr val="ABCDEF"/></a:folHlink></a:clrScheme></a:themeElements></a:theme>',
  'ppt/slideMasters/slideMaster1.xml': '<p:sldMaster xmlns:p="p" xmlns:a="a"><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent2" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sldMaster>',
  'ppt/slideLayouts/slideLayout1.xml': '<p:sldLayout xmlns:p="p" xmlns:a="a"><p:clrMapOvr><a:overrideClrMapping accent1="accent3"/></p:clrMapOvr><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>',
  'ppt/slides/slide1.xml': '<p:sld xmlns:p="p" xmlns:a="a"><p:clrMapOvr><a:overrideClrMapping accent1="accent4" unknown="accent1"/><a:masterClrMapping/></p:clrMapOvr><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr><p:txBody><a:p><a:r><a:t>Imported title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
}

function verticalFiles(value: string | undefined) {
  const bodyPr = value === undefined ? '<a:bodyPr/>' : `<a:bodyPr vert="${value}"/>`
  return {
    ...files,
    'ppt/slides/slide1.xml': `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr><p:txBody>${bodyPr}<a:p><a:r><a:t>Vertical text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  }
}

const tableFiles = {
  ...files,
  'ppt/slides/slide1.xml': `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="500000" y="600000"/><a:ext cx="6000000" cy="3000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr><a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill></a:tblPr><a:tblGrid><a:gridCol w="1000000"/><a:gridCol w="2000000"/><a:gridCol w="3000000"/></a:tblGrid><a:tr h="700000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody><a:tcPr gridSpan="2"><a:solidFill><a:srgbClr val="FFF2CC"/></a:solidFill><a:lnL w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:lnL><a:lnR w="25400"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:lnR><a:lnT w="38100"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:lnT><a:lnB w="50800"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnB></a:tcPr></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>B</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr><a:tr h="800000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>C</a:t></a:r></a:p></a:txBody><a:tcPr rowSpan="2"/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>D</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr hMerge="1"/></a:tc></a:tr><a:tr h="900000"><a:tc><a:txBody><a:bodyPr/><a:p/></a:txBody><a:tcPr vMerge="1"/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>E</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>F</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame><p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="4000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Neighbor</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
}

describe('importPptx', () => {
  it('detects supported bitmap formats and deduplicates repeated media references', async () => {
    const adapter = new RecordingAssetAdapter()
    const imported = await importPptx(createStoredZip(bitmapFiles), { assetAdapter: adapter })

    expect(imported.slides.sld_1?.elementIds).toEqual(['el_1', 'el_2', 'el_3', 'el_4', 'el_5', 'el_6', 'el_7'])
    expect(imported.elements.el_2).toMatchObject({ kind: 'image', assetId: 'asset_ppt_media_photo_jpg' })
    expect(imported.elements.el_3).toMatchObject({ kind: 'image', assetId: 'asset_ppt_media_animation_gif' })
    expect(imported.elements.el_4).toMatchObject({ kind: 'image', assetId: 'asset_ppt_media_bitmap_bmp' })
    expect(imported.elements.el_5).toMatchObject({ kind: 'image', assetId: 'asset_ppt_media_vector_webp' })
    expect(imported.elements.el_6).toMatchObject({ kind: 'image', assetId: 'asset_ppt_media_vector_webp' })
    expect(imported.assets).toEqual({
      asset_ppt_media_photo_jpg: { id: 'asset_ppt_media_photo_jpg', mimeType: 'image/jpeg', pixelWidth: 40, pixelHeight: 24, originalFilename: 'photo.jpg' },
      asset_ppt_media_animation_gif: { id: 'asset_ppt_media_animation_gif', mimeType: 'image/gif', pixelWidth: 7, pixelHeight: 9, originalFilename: 'animation.gif' },
      asset_ppt_media_bitmap_bmp: { id: 'asset_ppt_media_bitmap_bmp', mimeType: 'image/bmp', pixelWidth: 11, pixelHeight: 13, originalFilename: 'bitmap.bmp' },
      asset_ppt_media_vector_webp: { id: 'asset_ppt_media_vector_webp', mimeType: 'image/webp', pixelWidth: 32, pixelHeight: 16, originalFilename: 'vector.webp' },
    })
    expect(adapter.writes.map((write) => write.assetId)).toEqual([
      'asset_ppt_media_photo_jpg',
      'asset_ppt_media_animation_gif',
      'asset_ppt_media_bitmap_bmp',
      'asset_ppt_media_vector_webp',
    ])
    expect(adapter.writes.map((write) => write.data)).toEqual([jpegBytes, gifBytes, bmpBytes, webpBytes])
  })

  it.each([
    ['lossy VP8', lossyWebpBytes, 21, 22],
    ['lossless VP8L', losslessWebpBytes, 17, 19],
  ])('reads %s WebP dimensions', async (_label, bytes, pixelWidth, pixelHeight) => {
    const imported = await importPptx(createStoredZip({
      ...imageFiles,
      'ppt/slides/_rels/slide1.xml.rels': imageFiles['ppt/slides/_rels/slide1.xml.rels'].replace('../media/image1.png', '../media/image1.webp'),
      'ppt/media/image1.webp': bytes,
    }))
    expect(imported.assets?.asset_ppt_media_image1_webp).toMatchObject({ mimeType: 'image/webp', pixelWidth, pixelHeight })
  })

  it('skips unsupported, malformed, and unbounded pictures while preserving neighbors', async () => {
    const invalidFiles = {
      ...imageFiles,
      'ppt/slides/slide1.xml': `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Before"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1" y="1"/><a:ext cx="1" cy="1"/></a:xfrm></p:spPr></p:sp>${pictureMarkup('rId2', 2000000, false)}${pictureMarkup('rId3', 3000000)}<p:sp><p:nvSpPr><p:cNvPr id="4" name="After"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1" y="1"/><a:ext cx="1" cy="1"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
      'ppt/slides/_rels/slide1.xml.rels': `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/bad.bin"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/bad.png"/></Relationships>`,
      'ppt/media/bad.bin': new Uint8Array([0x00, 0x01, 0x02]),
      'ppt/media/bad.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
    }
    const imported = await importPptx(createStoredZip(invalidFiles))
    expect(imported.slides.sld_1?.elementIds).toEqual(['el_1', 'el_4'])
    expect(imported.elements.el_1?.kind).toBe('shape')
    expect(imported.elements.el_4?.kind).toBe('shape')
    expect(imported.assets).toBeUndefined()
  })

  it('imports bitmap pictures in slide order and writes exact asset bytes once', async () => {
    const adapter = new RecordingAssetAdapter()
    const imported = await importPptx(createStoredZip(imageFiles), { assetAdapter: adapter })

    expect(imported.slides.sld_1?.elementIds).toEqual(['el_1', 'el_2', 'el_4'])
    expect(imported.elements.el_2).toEqual({
      id: 'el_2',
      kind: 'image',
      bounds: { x: 2000000, y: 1500000, w: 5000000, h: 3000000 },
      assetId: 'asset_ppt_media_image1_png',
    })
    expect(imported.assets).toEqual({
      asset_ppt_media_image1_png: {
        id: 'asset_ppt_media_image1_png',
        mimeType: 'image/png',
        pixelWidth: 32,
        pixelHeight: 16,
        originalFilename: 'image1.png',
      },
    })
    expect(adapter.writes).toHaveLength(1)
    expect(adapter.writes[0]?.assetId).toBe('asset_ppt_media_image1_png')
    expect(adapter.writes[0]?.data).toEqual(pngBytes)
    expect(adapter.writes[0]?.metadata).toEqual(imported.assets?.asset_ppt_media_image1_png)
    expect(structuredClone(imported)).toEqual(imported)
  })

  it('imports picture transforms, crop, mask, and source-ordered effects', async () => {
    const imported = await importPptx(createStoredZip(imageAppearanceFiles))

    expect(imported.elements.el_2).toEqual({
      id: 'el_2',
      kind: 'image',
      bounds: { x: 2000000, y: 1500000, w: 5000000, h: 3000000 },
      assetId: 'asset_ppt_media_image1_png',
      transform: { rotation: 5400000, flipH: true, flipV: false },
      sourceCrop: { left: 1000, top: 2000, right: 3000, bottom: 4000 },
      maskPreset: 'ellipse',
      effects: [{ type: 'alphaModFix', amount: 50000 }, { type: 'grayscl' }],
    })
  })

  it('ignores malformed optional picture appearance fragments', async () => {
    const imported = await importPptx(createStoredZip(malformedImageAppearanceFiles))

    expect(imported.elements.el_2).toEqual({
      id: 'el_2',
      kind: 'image',
      bounds: { x: 2000000, y: 1500000, w: 5000000, h: 3000000 },
      assetId: 'asset_ppt_media_image1_png',
    })
  })

  it('skips pictures with missing relationships while preserving neighboring elements', async () => {
    const imported = await importPptx(createStoredZip(imageFiles))

    expect(imported.slides.sld_1?.elementIds).toEqual(['el_1', 'el_2', 'el_4'])
    expect(imported.elements.el_1?.kind).toBe('shape')
    expect(imported.elements.el_4?.kind).toBe('shape')
    expect(imported.assets).toEqual({
      asset_ppt_media_image1_png: {
        id: 'asset_ppt_media_image1_png',
        mimeType: 'image/png',
        pixelWidth: 32,
        pixelHeight: 16,
        originalFilename: 'image1.png',
      },
    })
  })

  it('skips unsupported and malformed bitmap media without creating assets', async () => {
    const malformedFiles = {
      ...imageFiles,
      'ppt/slides/slide1.xml': imageFiles['ppt/slides/slide1.xml'].replace('rId2', 'rId3'),
      'ppt/slides/_rels/slide1.xml.rels': imageFiles['ppt/slides/_rels/slide1.xml.rels'].replace('Id="rId2"', 'Id="rId3"'),
      'ppt/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    }
    const imported = await importPptx(createStoredZip(malformedFiles))
    expect(imported.slides.sld_1?.elementIds).toEqual(['el_1', 'el_4'])
    expect(imported.assets).toBeUndefined()
  })

  it('keeps the relationship XML tree addressable', () => {
    const root = parseXml(files['ppt/_rels/presentation.xml.rels'])
    expect(root.children[0]?.name).toBe('Relationships')
    expect(root.children[0]?.children[0]?.name).toBe('Relationship')
    expect(root.children[0]?.children[0]?.attributes['Id']).toBe('rId1')
  })

  it('reads presentation relationship entries by their OOXML path', async () => {
    const entries = await readZipEntries(createStoredZip(files))
    expect(Object.keys(entries)).toContain('ppt/_rels/presentation.xml.rels')
    expect(new TextDecoder().decode(entries['ppt/_rels/presentation.xml.rels'])).toContain('slides/slide1.xml')
    const presentation = parseXml(new TextDecoder().decode(entries['ppt/presentation.xml']))
    const presentationRoot = presentation.children[0]
    const slideList = presentationRoot?.children.find((node) => node.name === 'p:sldIdLst')
    expect(slideList?.children[0]?.attributes['r:id']).toBe('rId1')
    expect(entries['ppt/slides/slide1.xml']).toBeDefined()
  })

  it('imports a real OOXML relationship chain into the JSON model', async () => {
    const input = createStoredZip(files)
    const imported = await importPptx(input)
    expect(imported.page).toEqual({ w: 12192000, h: 6858000 })
    expect(imported.slideOrder).toEqual(['sld_1'])
    expect(imported.slides.sld_1).toMatchObject({ layoutId: 'lyt_1', masterId: 'mst_1' })
    expect(imported.layouts?.lyt_1?.masterId).toBe('mst_1')
    expect(imported.masters?.mst_1?.defaults?.title).toMatchObject({
      fill: { color: { type: 'srgb', v: '000000' } },
    })
    const element = imported.elements[imported.slides.sld_1!.elementIds[0] ?? '']
    expect(element).toMatchObject({
      kind: 'text',
      bounds: { x: 1000000, y: 1000000, w: 4000000, h: 2000000 },
      text: 'Imported title',
      fill: { color: { type: 'srgb', v: '4472C4' } },
      placeholder: 'title',
    })
    expect(imported.source?.entries['ppt/slides/slide1.xml']).toContain('Imported title')
    expect(imported.source?.packageFingerprint).toBe(fingerprintBytes(input))
    expect(imported.source?.modelFingerprint).toBe(fingerprintDocument(imported))
    expect(structuredClone(imported).source).toEqual(imported.source)
    expect(structuredClone(imported)).toEqual(imported)
  })

  it('imports direct shape and text strokes without treating line fills as shape fills', async () => {
    const imported = await importPptx(createStoredZip(strokeFiles))

    expect(imported.elements.el_1).toMatchObject({
      kind: 'shape',
      stroke: { color: { type: 'srgb', v: '112233', transforms: [{ type: 'alpha', value: 50000 }] } },
    })
    expect(imported.elements.el_1).not.toHaveProperty('fill')
    expect(imported.elements.el_2).toMatchObject({
      kind: 'text',
      stroke: { color: { type: 'scheme', v: 'accent2' } },
    })
    expect(imported.masters?.mst_1?.defaults?.title).toMatchObject({
      stroke: { color: { type: 'srgb', v: 'FEDCBA' } },
    })
    expect(imported.layouts?.lyt_1?.defaults?.title).toMatchObject({
      stroke: { color: { type: 'srgb', v: 'ABCDEF' } },
    })
  })

  it('imports shape and text rotations in OOXML units', async () => {
    const imported = await importPptx(createStoredZip(rotationFiles))

    expect(imported.elements.el_1).toMatchObject({ kind: 'shape', rotation: -5400000 })
    expect(imported.elements.el_2).toMatchObject({ kind: 'text', rotation: 2700000 })
    expect(structuredClone(imported)).toEqual(imported)
  })

  it('ignores malformed shape and text rotation attributes', async () => {
    const imported = await importPptx(createStoredZip(malformedRotationFiles))

    expect(imported.elements.el_1).not.toHaveProperty('rotation')
    expect(imported.elements.el_2).not.toHaveProperty('rotation')
  })

  it('imports rotations from layout and master placeholder defaults', async () => {
    const imported = await importPptx(createStoredZip(rotationDefaultsFiles))

    expect(imported.masters?.mst_1?.defaults?.title).toMatchObject({ rotation: 3600000 })
    expect(imported.layouts?.lyt_1?.defaults?.title).toMatchObject({ rotation: -1800000 })
    expect(structuredClone(imported)).toEqual(imported)
  })

  it('reuses shared layouts and masters while preserving slide element order', async () => {
    const multiSlideFiles = {
      ...files,
      'ppt/presentation.xml': `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
      'ppt/_rels/presentation.xml.rels': `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`,
      'ppt/slides/slide2.xml': `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="4" name="Body"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="3500000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
      'ppt/slides/_rels/slide2.xml.rels': `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    }
    const imported = await importPptx(createStoredZip(multiSlideFiles))
    expect(imported.slideOrder).toEqual(['sld_1', 'sld_2'])
    expect(Object.keys(imported.layouts ?? {})).toEqual(['lyt_1'])
    expect(Object.keys(imported.masters ?? {})).toEqual(['mst_1'])
    expect(imported.slides.sld_2).toMatchObject({ layoutId: 'lyt_1', masterId: 'mst_1' })
    expect(imported.slides.sld_1?.elementIds).toEqual(['el_1'])
    expect(imported.slides.sld_2?.elementIds).toEqual(['el_2'])
    expect(imported.slides.sld_1?.source).toMatchObject({
      originId: 'sld_1',
      partPath: 'ppt/slides/slide1.xml',
      relationshipId: 'rId1',
      presentationId: '256',
    })
    expect(imported.slides.sld_2?.source).toMatchObject({
      originId: 'sld_2',
      partPath: 'ppt/slides/slide2.xml',
      relationshipId: 'rId2',
      presentationId: '257',
    })
  })

  it('imports structured character and auto-number bullets without marker text', async () => {
    const imported = await importPptx(createStoredZip(bulletFiles))
    const element = imported.elements[imported.slides.sld_1!.elementIds[0]!]
    if (!element || element.kind !== 'text') throw new Error('expected text element')

    expect(element.text).toBe('FirstSecondThirdFourth')
    expect(element.body).toEqual({
      paragraphs: [
        { runs: [{ text: 'First' }], attrs: { bullet: { type: 'char', char: '•', fontFamily: 'Wingdings' } } },
        { runs: [{ text: 'Second' }], attrs: { bullet: { type: 'autoNum', scheme: 'arabic', startAt: 3 } } },
        { runs: [{ text: 'Third' }], attrs: { bullet: { type: 'autoNum', scheme: 'alphaUpper' } } },
        { runs: [{ text: 'Fourth' }], attrs: { bullet: { type: 'autoNum', scheme: 'arabic' } } },
      ],
    })
    expect(element.body?.paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text)).not.toContain('•')
    expect(structuredClone(imported)).toEqual(imported)
  })

  it('omits malformed marker values instead of inserting them into text', async () => {
    const malformedFiles = {
      ...bulletFiles,
      'ppt/slides/slide1.xml': bulletFiles['ppt/slides/slide1.xml'].replace('char="•"', 'char=""').replace('startAt="3"', 'startAt="0"'),
    }
    const imported = await importPptx(createStoredZip(malformedFiles))
    const element = imported.elements[imported.slides.sld_1!.elementIds[0]!]
    if (!element || element.kind !== 'text') throw new Error('expected text element')
    expect(element.text).toBe('FirstSecondThirdFourth')
    expect(element.body?.paragraphs[0]?.attrs).toBeUndefined()
    expect(element.body?.paragraphs[1]?.attrs).toBeUndefined()
  })

  it.each(['vert270', 'vert', 'wordArtVert'])('imports %s as vertical body writing mode', async (value) => {
    const imported = await importPptx(createStoredZip(verticalFiles(value)))
    const element = imported.elements[imported.slides.sld_1!.elementIds[0]!]
    if (!element || element.kind !== 'text') throw new Error('expected text element')
    expect(element.text).toBe('Vertical text')
    expect(element.body?.bodyPr).toEqual({ vertical: 'vertical' })
    expect(structuredClone(imported)).toEqual(imported)
  })

  it.each(['horz', 'eaVert', 'mongolianVert', 'unknown', undefined])('ignores non-basic vertical value %s', async (value) => {
    const imported = await importPptx(createStoredZip(verticalFiles(value)))
    const element = imported.elements[imported.slides.sld_1!.elementIds[0]!]
    if (!element || element.kind !== 'text') throw new Error('expected text element')
    expect(element.body?.bodyPr).toBeUndefined()
  })

  it('imports table grids, normalized merges, cell styling, and borders', async () => {
    const imported = await importPptx(createStoredZip(tableFiles))
    expect(imported.slideOrder).toEqual(['sld_1'])
    expect(imported.slides.sld_1?.elementIds).toEqual(['el_1', 'el_2'])
    const element = imported.elements.el_1
    expect(element).toMatchObject({
      id: 'el_1',
      kind: 'table',
      bounds: { x: 500000, y: 600000, w: 6000000, h: 3000000 },
      columns: [1000000, 2000000, 3000000],
      rows: [
        { height: 700000, cells: [{ column: 0, colSpan: 2, body: { paragraphs: [{ runs: [{ text: 'A' }] }] }, fill: { color: { type: 'srgb', v: 'FFF2CC' } }, borders: { left: { color: { type: 'srgb', v: 'FF0000' }, width: 12700, style: 'solid' }, right: { color: { type: 'srgb', v: '00FF00' }, width: 25400, style: 'solid' }, top: { color: { type: 'srgb', v: '0000FF' }, width: 38100, style: 'solid' }, bottom: { color: { type: 'srgb', v: '000000' }, width: 50800, style: 'solid' } } }, { column: 2, body: { paragraphs: [{ runs: [{ text: 'B' }] }] } }],
        },
        { height: 800000, cells: [{ column: 0, rowSpan: 2, body: { paragraphs: [{ runs: [{ text: 'C' }] }] } }, { column: 1, colSpan: 2, body: { paragraphs: [{ runs: [{ text: 'D' }] }] } }],
        },
        { height: 900000, cells: [{ column: 1, body: { paragraphs: [{ runs: [{ text: 'E' }] }] } }, { column: 2, body: { paragraphs: [{ runs: [{ text: 'F' }] }] } }],
        },
      ],
      fill: { color: { type: 'srgb', v: 'F2F2F2' } },
    })
    expect(imported.elements.el_2).toMatchObject({ kind: 'text', text: 'Neighbor' })
    expect(imported.source?.entries['ppt/slides/slide1.xml']).toContain('hMerge="1"')
    expect(structuredClone(imported)).toEqual(imported)
  })

  it('imports custom table style definitions and table style flags', async () => {
    const styleXml = '<a:tblStyleLst xmlns:a="a"><a:tblStyle styleId=" style-1 " name="First"><a:wholeTbl><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:lnB w="1000"><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:lnB></a:wholeTbl><a:band1H><a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill></a:band1H><a:firstRow><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:lnL w="1000"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnL><a:lnR w="2000"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:lnR><a:tcStyle><a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="50000"/></a:schemeClr></a:solidFill></a:fill><a:tcBdr><a:lnL w="12700"><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:lnL></a:tcBdr></a:tcStyle><a:tcTxStyle b="1" i="0"><a:schemeClr val="tx1"/></a:tcTxStyle></a:firstRow></a:tblStyle><a:tblStyle styleId="style-1" name="Duplicate"><a:wholeTbl><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:wholeTbl></a:tblStyle><a:tblStyle styleId="bad"><a:wholeTbl><a:solidFill><a:srgbClr/></a:solidFill><a:lnL w="bad"><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:lnL></a:wholeTbl></a:tblStyle></a:tblStyleLst>'
    const styledFiles = {
      ...tableFiles,
      'ppt/tableStyles.xml': styleXml,
      'ppt/slides/slide1.xml': tableFiles['ppt/slides/slide1.xml'].replace('<a:tblPr>', '<a:tblPr tableStyleId="style-1" firstRow="1" lastRow="0" firstCol="true" lastCol="false" bandRow="1" bandCol="0">'),
    }
    const imported = await importPptx(createStoredZip(styledFiles))
    const table = imported.elements.el_1
    expect(table).toMatchObject({
      kind: 'table',
      style: { styleId: 'style-1', firstRow: true, lastRow: false, firstColumn: true, lastColumn: false, bandRow: true, bandColumn: false },
    })
    expect(imported.tableStyles).toEqual({
      'style-1': {
        id: 'style-1',
        regions: {
          wholeTable: { fill: { color: { type: 'srgb', v: 'FFFFFF' } }, borders: { bottom: { color: { type: 'srgb', v: '111111' }, width: 1000, style: 'solid' } } },
          band1H: { fill: { color: { type: 'srgb', v: 'EEEEEE' } } },
          firstRow: {
            fill: { color: { type: 'scheme', v: 'accent1', transforms: [{ type: 'tint', value: 50000 }] } },
            borders: {
              left: { color: { type: 'srgb', v: '111111' }, width: 12700, style: 'solid' },
              right: { color: { type: 'srgb', v: '00FF00' }, width: 2000, style: 'solid' },
            },
            text: { color: { type: 'scheme', v: 'tx1' }, bold: true, italic: false },
          },
        },
      },
    })
    expect(imported.source?.entries['ppt/tableStyles.xml']).toBe(styleXml)
    expect(imported.elements.el_2).toMatchObject({ kind: 'text', text: 'Neighbor' })
    expect(structuredClone(imported)).toEqual(imported)
  })

  it('omits invalid nested table text flags while retaining valid style fields', async () => {
    const styleXml = '<a:tblStyleLst xmlns:a="a"><a:tblStyle styleId="style-invalid-flags"><a:firstRow><a:tcTxStyle b="true" i="invalid"><a:schemeClr val="tx1"/></a:tcTxStyle></a:firstRow></a:tblStyle></a:tblStyleLst>'
    const imported = await importPptx(createStoredZip({ ...files, 'ppt/tableStyles.xml': styleXml }))
    expect(imported.tableStyles?.['style-invalid-flags']).toEqual({
      id: 'style-invalid-flags',
      regions: { firstRow: { text: { color: { type: 'scheme', v: 'tx1' } } } },
    })
  })

  it('ignores unusable tables while importing neighboring elements', async () => {
    const malformedTableFiles = {
      ...tableFiles,
      'ppt/slides/slide1.xml': tableFiles['ppt/slides/slide1.xml'].replace('w="1000000"', 'w="invalid"'),
    }
    const imported = await importPptx(createStoredZip(malformedTableFiles))
    expect(imported.slides.sld_1?.elementIds).toEqual(['el_2'])
    expect(imported.elements.el_2).toMatchObject({ kind: 'text', text: 'Neighbor' })
    expect(structuredClone(imported)).toEqual(imported)
  })

  it('imports themes through master relationships with ordered transforms and color-map overlays', async () => {
    const imported = await importPptx(createStoredZip(themeFiles))
    expect(imported.themes).toEqual({
      theme_1: {
        id: 'theme_1',
        colors: {
          dk1: { type: 'system', v: '202020' },
          lt1: { type: 'srgb', v: 'FFFFFF' },
          dk2: { type: 'srgb', v: '111111' },
          lt2: { type: 'scrgb', v: '100000,50000,0' },
          accent1: { type: 'srgb', v: '336699', transforms: [
            { type: 'lumMod', value: 80000 },
            { type: 'lumOff', value: 10000 },
            { type: 'alphaMod', value: 90000 },
            { type: 'alphaOff', value: 5000 },
          ] },
          hlink: { type: 'preset', v: 'red' },
          folHlink: { type: 'srgb', v: 'ABCDEF' },
        },
      },
    })
    expect(imported.masters?.mst_1).toMatchObject({ id: 'mst_1', themeId: 'theme_1', colorMap: { accent1: 'accent2' } })
    expect(imported.layouts?.lyt_1).toMatchObject({ colorMapOverride: { accent1: 'accent3' } })
    expect(imported.slides.sld_1).toMatchObject({ colorMapOverride: { accent1: 'accent4' } })
    expect(imported.slides.sld_1?.colorMapOverride).not.toHaveProperty('unknown')
    expect(imported.source?.entries['ppt/theme/custom.xml']).toBe(themeFiles['ppt/theme/custom.xml'])
    expect(structuredClone(imported)).toEqual(imported)
  })

  it('omits malformed optional theme fragments while preserving the imported graph', async () => {
    const malformedFiles = {
      ...themeFiles,
      'ppt/theme/custom.xml': '<a:theme xmlns:a="a"><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="336699"><a:lumMod val="invalid"/><a:tint val=""/><a:alphaOff val="10000"/></a:srgbClr></a:accent1></a:clrScheme></a:themeElements></a:theme>',
      'ppt/slideMasters/slideMaster1.xml': themeFiles['ppt/slideMasters/slideMaster1.xml'].replace('accent2="accent2"', 'accent2="unknown"'),
      'ppt/slideLayouts/slideLayout1.xml': themeFiles['ppt/slideLayouts/slideLayout1.xml'].replace('accent3', 'unknown'),
    }
    const imported = await importPptx(createStoredZip(malformedFiles))
    expect(imported.slideOrder).toEqual(['sld_1'])
    expect(imported.layouts?.lyt_1?.colorMapOverride).toBeUndefined()
    expect(imported.masters?.mst_1?.colorMap).not.toHaveProperty('accent2')
    expect(imported.themes?.theme_1?.colors.accent1).toEqual({ type: 'srgb', v: '336699', transforms: [{ type: 'alphaOff', value: 10000 }] })
    expect(structuredClone(imported)).toEqual(imported)
  })

  it('omits missing or unreadable optional themes without dropping slides, layouts, or masters', async () => {
    const missingRelationshipFiles = {
      ...themeFiles,
      'ppt/slideMasters/_rels/slideMaster1.xml.rels': '<Relationships xmlns="r"></Relationships>',
      'ppt/slideLayouts/slideLayout1.xml': themeFiles['ppt/slideLayouts/slideLayout1.xml'].replace('<a:overrideClrMapping accent1="accent3"/>', '<a:masterClrMapping/>'),
    }
    const missingRelationship = await importPptx(createStoredZip(missingRelationshipFiles))
    expect(missingRelationship.themes).toBeUndefined()
    expect(missingRelationship.masters?.mst_1?.themeId).toBeUndefined()
    expect(missingRelationship.layouts?.lyt_1?.colorMapOverride).toBeUndefined()
    expect(missingRelationship.slideOrder).toEqual(['sld_1'])

    const unreadableTheme = await importPptx(createStoredZip({ ...themeFiles, 'ppt/theme/custom.xml': '<a:theme>' }))
    expect(unreadableTheme.themes).toBeUndefined()
    expect(unreadableTheme.masters?.mst_1?.themeId).toBeUndefined()
    expect(unreadableTheme.slideOrder).toEqual(['sld_1'])

    const themeWithoutScheme = await importPptx(createStoredZip({ ...themeFiles, 'ppt/theme/custom.xml': '<a:theme xmlns:a="a"><a:themeElements/></a:theme>' }))
    expect(themeWithoutScheme.themes).toBeUndefined()
    expect(themeWithoutScheme.masters?.mst_1?.themeId).toBeUndefined()
    expect(themeWithoutScheme.slideOrder).toEqual(['sld_1'])
  })
})
