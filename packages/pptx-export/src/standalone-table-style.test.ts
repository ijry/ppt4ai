import { importPptx } from '@ppt4ai/pptx-import'
import type { Ppt4aiDocument, TableStyle } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { createPptx } from './index.js'
import { readZipEntries } from './zip.js'

async function partsOf(bytes: Uint8Array): Promise<Map<string, string>> {
  const decoder = new TextDecoder()
  return new Map((await readZipEntries(bytes)).map((entry) => [entry.name, decoder.decode(entry.data)]))
}

/** Every region the model can express, so the written order can be checked against the ECMA sequence. */
function fullStyle(): TableStyle {
  return {
    id: 'style-1',
    regions: {
      wholeTable: {
        fill: { color: { type: 'srgb', v: '4472C4' } },
        borders: {
          left: { color: { type: 'srgb', v: 'FF0000' }, width: 12700, style: 'solid' },
          right: { color: { type: 'srgb', v: '00FF00' }, width: 25400, style: 'sysDash' },
          top: { color: { type: 'srgb', v: '0000FF' } },
          bottom: { color: { type: 'scheme', v: 'tx1' }, width: 50800, style: 'solid' },
        },
        text: { color: { type: 'srgb', v: 'FFFFFF' }, bold: true, italic: false },
      },
      band1H: { fill: { color: { type: 'srgb', v: 'D9E2F3' } } },
      band2H: { fill: { color: { type: 'srgb', v: 'E9EFF7' } } },
      band1V: { fill: { color: { type: 'srgb', v: 'C9D7EE' } } },
      band2V: { fill: { color: { type: 'srgb', v: 'B9CBE6' } } },
      lastCol: { text: { bold: true } },
      firstCol: { text: { italic: true } },
      lastRow: { fill: { color: { type: 'srgb', v: '203864' } } },
      firstRow: { fill: { color: { type: 'srgb', v: '2F5597' } }, text: { color: { type: 'srgb', v: 'FFFFFF' }, bold: true } },
    },
  }
}

function styledDocument(styles?: Record<string, TableStyle>): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_table_style',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['table_1'] } },
    slideOrder: ['sld_1'],
    elements: {
      table_1: {
        id: 'table_1',
        kind: 'table',
        bounds: { x: 0, y: 0, w: 2000000, h: 1000000 },
        columns: [2000000],
        rows: [{ height: 1000000, cells: [{ column: 0, body: { paragraphs: [{ runs: [{ text: 'Cell' }] }] } }] }],
        style: { styleId: 'style-1', firstRow: true, bandRow: true },
      },
    },
    ...(styles ? { tableStyles: styles } : {}),
  }
}

describe('standalone table style export', () => {
  it('writes the region in the shape ECMA defines', async () => {
    const parts = await partsOf(await createPptx(styledDocument({ 'style-1': fullStyle() })))
    const styles = parts.get('ppt/tableStyles.xml') ?? ''

    expect(styles).toContain('<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="style-1">')
    expect(styles).toContain('<a:tblStyle styleId="style-1" styleName="style-1">')
    expect(styles).toContain('<a:wholeTbl><a:tcTxStyle b="on" i="off"><a:srgbClr val="FFFFFF"/></a:tcTxStyle><a:tcStyle><a:tcBdr>'
      + '<a:left><a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></a:left>'
      + '<a:right><a:ln w="25400"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:prstDash val="sysDash"/></a:ln></a:right>'
      + '<a:top><a:ln><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln></a:top>'
      + '<a:bottom><a:ln w="50800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln></a:bottom>'
      + '</a:tcBdr><a:fill><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></a:fill></a:tcStyle></a:wholeTbl>')
  })

  /** `CT_TableStyle` is a sequence, and its order is not the obvious one: `firstRow` comes near the end. */
  it('writes the regions in the ECMA sequence order rather than the model order', async () => {
    const parts = await partsOf(await createPptx(styledDocument({ 'style-1': fullStyle() })))
    const styles = parts.get('ppt/tableStyles.xml') ?? ''
    const order = [...styles.matchAll(/<a:(wholeTbl|band1H|band2H|band1V|band2V|lastCol|firstCol|lastRow|firstRow)>/g)].map((match) => match[1])

    expect(order).toEqual(['wholeTbl', 'band1H', 'band2H', 'band1V', 'band2V', 'lastCol', 'firstCol', 'lastRow', 'firstRow'])
  })

  it('declares the part in the content types and relates it from the presentation', async () => {
    const parts = await partsOf(await createPptx(styledDocument({ 'style-1': fullStyle() })))

    expect(parts.get('[Content_Types].xml')).toContain('<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>')
    expect(parts.get('ppt/_rels/presentation.xml.rels')).toContain('<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>')
    // The slide keeps the relationship id the presentation already pointed at.
    expect(parts.get('ppt/presentation.xml')).toContain('<p:sldId id="256" r:id="rId3"/>')
  })

  it('writes no part at all when the model carries no styles', async () => {
    const parts = await partsOf(await createPptx(styledDocument()))

    expect(parts.has('ppt/tableStyles.xml')).toBe(false)
    expect(parts.get('[Content_Types].xml')).not.toContain('tableStyles')
    expect(parts.get('ppt/_rels/presentation.xml.rels')).not.toContain('tableStyles')
  })

  it('brings every region back through importPptx', async () => {
    const style = fullStyle()
    const imported = await importPptx(await createPptx(styledDocument({ 'style-1': style })))

    // The one normalization: a border with no `a:prstDash` reads back as `solid`, which is the OOXML
    // default the importer states rather than a value the round trip lost.
    const expected = structuredClone(style)
    const top = expected.regions?.wholeTable?.borders?.top
    if (!top) throw new Error('fixture lost its top border')
    top.style = 'solid'
    expect(imported.tableStyles).toEqual({ 'style-1': expected })
  })

  it('keeps the reference a package cannot resolve, because Office resolves built-ins from its own gallery', async () => {
    const parts = await partsOf(await createPptx(styledDocument()))
    const slide = parts.get('ppt/slides/slide1.xml') ?? ''

    expect(slide).toContain('<a:tblPr tableStyleId="style-1" firstRow="1" bandRow="1">')
  })

  it('writes the interior lines after the four outer ones and reads them back', async () => {
    const style = fullStyle()
    style.regions!.wholeTable!.borders!.insideH = { color: { type: 'srgb', v: 'AAAAAA' }, width: 6350, style: 'solid' }
    style.regions!.wholeTable!.borders!.insideV = { color: { type: 'srgb', v: 'BBBBBB' }, width: 6350, style: 'dash' }
    const bytes = await createPptx(styledDocument({ 'style-1': style }))
    const parts = await partsOf(bytes)

    expect(parts.get('ppt/tableStyles.xml')).toContain('<a:bottom><a:ln w="50800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln></a:bottom>'
      + '<a:insideH><a:ln w="6350"><a:solidFill><a:srgbClr val="AAAAAA"/></a:solidFill></a:ln></a:insideH>'
      + '<a:insideV><a:ln w="6350"><a:solidFill><a:srgbClr val="BBBBBB"/></a:solidFill><a:prstDash val="dash"/></a:ln></a:insideV></a:tcBdr>')

    const imported = await importPptx(bytes)

    expect(imported.tableStyles?.['style-1']?.regions?.wholeTable?.borders?.insideH).toEqual({ color: { type: 'srgb', v: 'AAAAAA' }, width: 6350, style: 'solid' })
    expect(imported.tableStyles?.['style-1']?.regions?.wholeTable?.borders?.insideV).toEqual({ color: { type: 'srgb', v: 'BBBBBB' }, width: 6350, style: 'dash' })
  })
})
