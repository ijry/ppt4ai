import { describe, expect, it } from 'vitest'
import { importPptx, parseXml, readZipEntries } from './index'

function createStoredZip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const [name, value] of Object.entries(files)) {
    const nameBytes = encoder.encode(name)
    const valueBytes = encoder.encode(value)
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
    const imported = await importPptx(createStoredZip(files))
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
