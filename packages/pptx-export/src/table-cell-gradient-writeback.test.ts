import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

const cellGradient = '<a:gradFill><a:gsLst>'
  + '<a:gs pos="0"><a:srgbClr val="4472C4"/></a:gs>'
  + '<a:gs pos="100000"><a:srgbClr val="203864"/></a:gs>'
  + '</a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill>'

function sourcePackage(fill = cellGradient): Uint8Array {
  const table = '<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="2000000"/></a:tblGrid>'
    + `<a:tr h="1000000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody><a:tcPr>${fill}</a:tcPr></a:tc></a:tr></a:tbl>`
  const slide = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
    + '<p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></p:xfrm>'
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">${table}</a:graphicData></a:graphic></p:graphicFrame>`
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

describe('table cell gradient fill survives writeback', () => {
  it('imports the cell fill as a gradient', async () => {
    const document = await importPptx(sourcePackage())
    const element = document.elements.el_1
    if (element?.kind !== 'table') throw new Error('fixture did not import as a table')

    expect(element.rows[0]?.cells[0]?.fill?.gradient?.stops).toHaveLength(2)
  })

  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = sourcePackage()
    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  it('rebuilds the gradient from the model when a cell edit forces a rebuild', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'table') throw new Error('fixture did not import as a table')
    const cell = element.rows[0]?.cells[0]
    if (!cell) throw new Error('fixture produced no cell')
    cell.body = { paragraphs: [{ runs: [{ text: 'Edited' }] }] }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain('<a:gradFill>')
    expect(xml).toContain('Edited')
    expect(xml).not.toContain('<a:solidFill>')
  })
})
