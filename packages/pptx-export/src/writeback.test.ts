import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="rId1"/></p:sldIdLst></p:presentation>'
const relationships = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
const tableXml = '<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="1000000"/></a:tblGrid><a:tr h="1000000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Before</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl>'
const neighborXml = '<p:sp data-preserve="yes"><p:nvSpPr><p:cNvPr id="2" name="Neighbor"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm></p:spPr></p:sp>'
const slide = `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="1" name="Table"/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">${tableXml}</a:graphicData></a:graphic></p:graphicFrame>${neighborXml}</p:spTree></p:cSld></p:sld>`

function sourcePackage(): Uint8Array {
  return writeStoredZip([
    { name: 'ppt/presentation.xml', data: new TextEncoder().encode(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', data: new TextEncoder().encode(relationships) },
    { name: 'ppt/slides/slide1.xml', data: new TextEncoder().encode(slide) },
    { name: 'ppt/media/image1.bin', data: new Uint8Array([0, 17, 255, 3]) },
  ])
}

describe('exportPptx', () => {
  it('replaces imported table XML while preserving the package', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const table = document.elements.el_1
    if (!table || table.kind !== 'table') throw new Error('fixture table was not imported')
    table.rows[0]!.cells[0]!.body.paragraphs[0]!.runs[0]!.text = 'After & exported'
    const expectedDocument = structuredClone(document)

    const first = await exportPptx(document, source)
    const second = await exportPptx(document, source)

    expect(first).toEqual(second)
    const entries = await readZipEntries(first)
    expect(entries.map((entry) => entry.name)).toEqual([
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/slides/slide1.xml',
      'ppt/media/image1.bin',
    ])
    const outputSlide = new TextDecoder().decode(entries[2]!.data)
    expect(outputSlide).toContain('<a:t>After &amp; exported</a:t>')
    expect(outputSlide).not.toContain('<a:t>Before</a:t>')
    expect(outputSlide).toContain(neighborXml)
    expect(entries[3]!.data).toEqual(new Uint8Array([0, 17, 255, 3]))
    expect(document).toEqual(expectedDocument)
  })

  it('rejects a slide element count mismatch', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    document.slides.sld_1!.elementIds.pop()

    await expect(exportPptx(document, source)).rejects.toThrow('PPTX export element count mismatch for slide sld_1')
  })
})
