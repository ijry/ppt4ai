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
})
