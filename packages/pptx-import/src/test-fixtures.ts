export function createStoredZip(files: Record<string, string | Uint8Array>): Uint8Array {
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

export const files = {
  'ppt/presentation.xml': `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
  'ppt/_rels/presentation.xml.rels': `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
  'ppt/slides/slide1.xml': `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="roundRect"/><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></p:spPr><p:txBody><a:p><a:r><a:t>Imported title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  'ppt/slides/_rels/slide1.xml.rels': `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`,
  'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  'ppt/slideMasters/slideMaster1.xml': `<p:sldMaster xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sldMaster>`,
}
