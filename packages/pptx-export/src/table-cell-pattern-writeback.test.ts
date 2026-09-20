import { importPptx } from '@ppt4ai/pptx-import'
import { describe, expect, it } from 'vitest'
import { exportPptx } from './index.js'
import { readZipEntries, writeStoredZip } from './zip.js'

const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
const presentationRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'

/** The a:extLst is the discriminator: nothing re-emits an unmodeled ext, so its survival proves a patch. */
const cellPattern = '<a:pattFill prst="ltHorz">'
  + '<a:fgClr><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:fgClr>'
  + '<a:bgClr><a:srgbClr val="00FF00"/></a:bgClr>'
  + '<a:extLst><a:ext uri="{9F1B4A2C-0000-0000-0000-000000000000}"/></a:extLst>'
  + '</a:pattFill>'

function sourcePackage(fill = cellPattern): Uint8Array {
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

describe('table cell pattern fill survives writeback', () => {
  it('imports the cell fill as a pattern', async () => {
    const document = await importPptx(sourcePackage())
    const element = document.elements.el_1
    if (element?.kind !== 'table') throw new Error('fixture did not import as a table')

    expect(element.rows[0]?.cells[0]?.fill).toEqual({
      color: { type: 'srgb', v: 'FF0000', transforms: [{ type: 'alpha', value: 50000 }] },
      pattern: {
        preset: 'ltHorz',
        foreground: { type: 'srgb', v: 'FF0000', transforms: [{ type: 'alpha', value: 50000 }] },
        background: { type: 'srgb', v: '00FF00' },
      },
    })
  })

  it('leaves the package byte-identical when nothing is edited', async () => {
    const source = sourcePackage()

    expect(await exportPptx(await importPptx(source), source)).toEqual(source)
  })

  /**
   * A table is rebuilt from the model on writeback (not patched like a shape), so the modeled preset and
   * both colours survive verbatim while an unmodeled a:extLst inside the cell is dropped — the same rule
   * every other unmodeled cell detail already follows. The pattern must never collapse into a solid fill.
   */
  it('rebuilds the cell pattern from the model when an unrelated cell edit forces a rebuild', async () => {
    const source = sourcePackage()
    const document = await importPptx(source)
    const element = document.elements.el_1
    if (element?.kind !== 'table') throw new Error('fixture did not import as a table')
    const cell = element.rows[0]?.cells[0]
    if (!cell) throw new Error('fixture produced no cell')
    cell.body = { paragraphs: [{ runs: [{ text: 'Edited' }] }] }

    const xml = await slideOf(await exportPptx(document, source))

    expect(xml).toContain('<a:pattFill prst="ltHorz"><a:fgClr><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:fgClr><a:bgClr><a:srgbClr val="00FF00"/></a:bgClr></a:pattFill>')
    expect(xml).toContain('Edited')
    expect(xml).not.toContain('<a:solidFill>')
  })
})
