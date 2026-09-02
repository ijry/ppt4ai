import { describe, expect, it } from 'vitest'
import type { Color, TableElement } from '@ppt4ai/model'
import { serializeTableXml } from './index.js'

const srgb = (value: string, transforms?: Color['transforms']): Color => ({ type: 'srgb', v: value, ...(transforms ? { transforms } : {}) })

const table: TableElement = {
  id: 'table-1',
  kind: 'table',
  bounds: { x: 0, y: 0, w: 300, h: 200 },
  columns: [100, 200],
  fill: { color: srgb('F2F2F2') },
  style: { styleId: 'style-1', firstRow: true, lastRow: false, firstColumn: true, lastColumn: false, bandRow: true, bandColumn: false },
  rows: [
    {
      height: 70,
      cells: [
        {
          column: 0,
          colSpan: 2,
          body: {
            bodyPr: { wrap: 'square', verticalAlign: 'middle' },
            paragraphs: [{
              attrs: { align: 'center' },
              runs: [{
                text: 'A < & "',
                marks: { fontFamily: 'Aptos', fontSize: 18, bold: true, italic: true, underline: 'single', color: { color: srgb('FF0000') } },
              }],
            }],
          },
          fill: { color: srgb('FFF2CC') },
          borders: {
            left: { color: srgb('FF0000'), width: 12700, style: 'solid' },
            right: { color: srgb('00FF00'), width: 25400, style: 'dash' },
            top: { color: srgb('0000FF'), width: 38100, style: 'dot' },
            bottom: { color: srgb('000000'), width: 50800, style: 'solid' },
          },
        },
      ],
    },
    {
      height: 80,
      cells: [
        {
          column: 0,
          rowSpan: 2,
          body: { paragraphs: [{ runs: [{ text: 'C' }] }] },
        },
        {
          column: 1,
          body: { paragraphs: [{ runs: [{ text: 'D' }] }] },
        },
      ],
    },
    {
      height: 90,
      cells: [
        {
          column: 1,
          body: { paragraphs: [{ runs: [{ text: 'E' }] }] },
        },
      ],
    },
  ],
}

describe('serializeTableXml', () => {
  it('serializes grid, merge continuations, text marks, fills, borders, and table flags in order', () => {
    const before = structuredClone(table)

    expect(serializeTableXml(table)).toBe(
      '<a:tbl xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        '<a:tblPr tableStyleId="style-1" firstRow="1" lastRow="0" firstCol="1" lastCol="0" bandRow="1" bandCol="0">' +
          '<a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill>' +
        '</a:tblPr>' +
        '<a:tblGrid><a:gridCol w="100"/><a:gridCol w="200"/></a:tblGrid>' +
        '<a:tr h="70">' +
          '<a:tc><a:txBody><a:bodyPr wrap="square" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800" b="1" i="1" u="sng"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr><a:t>A &lt; &amp; &quot;</a:t></a:r></a:p></a:txBody>' +
            '<a:tcPr gridSpan="2"><a:solidFill><a:srgbClr val="FFF2CC"/></a:solidFill><a:lnL w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:lnL><a:lnR w="25400"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:prstDash val="dash"/></a:lnR><a:lnT w="38100"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill><a:prstDash val="dot"/></a:lnT><a:lnB w="50800"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnB></a:tcPr>' +
          '</a:tc>' +
        '</a:tr>' +
        '<a:tr h="80">' +
          '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>C</a:t></a:r></a:p></a:txBody><a:tcPr rowSpan="2"/></a:tc>' +
          '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>D</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>' +
        '</a:tr>' +
        '<a:tr h="90">' +
          '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr vMerge="1"/></a:tc>' +
          '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>E</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>' +
        '</a:tr>' +
      '</a:tbl>',
    )
    expect(table).toEqual(before)
  })

  it('preserves every supported structured color kind and transform order', () => {
    const colors: Color[] = [
      { type: 'srgb', v: '123456', transforms: [{ type: 'tint', value: 50000 }, { type: 'alpha', value: 90000 }] },
      { type: 'scheme', v: 'accent1' },
      { type: 'preset', v: 'red' },
      { type: 'system', v: '112233' },
      { type: 'scrgb', v: '100000,50000,0' },
    ]
    const colorTable: TableElement = {
      id: 'color-table',
      kind: 'table',
      bounds: table.bounds,
      columns: [1, 1, 1, 1, 1],
      rows: [{ height: 1, cells: colors.map((color, column) => ({ column, body: { paragraphs: [{ runs: [{ text: String(column) }] }] }, fill: { color } })) }],
    }

    expect(serializeTableXml(colorTable)).toContain(
      '<a:solidFill><a:srgbClr val="123456"><a:tint val="50000"/><a:alpha val="90000"/></a:srgbClr></a:solidFill>',
    )
    expect(serializeTableXml(colorTable)).toContain('<a:schemeClr val="accent1"/>')
    expect(serializeTableXml(colorTable)).toContain('<a:prstClr val="red"/>')
    expect(serializeTableXml(colorTable)).toContain('<a:sysClr val="windowText" lastClr="112233"/>')
    expect(serializeTableXml(colorTable)).toContain('<a:scrgbClr r="100000" g="50000" b="0"/>')
  })

  it('serializes a two-dimensional merge continuation as one covered vertical cell', () => {
    const mergedTable: TableElement = {
      id: 'merged-table',
      kind: 'table',
      bounds: table.bounds,
      columns: [1, 1, 1],
      rows: [
        { height: 1, cells: [{ column: 0, rowSpan: 2, colSpan: 2, body: { paragraphs: [{ runs: [{ text: 'origin' }] }] } }, { column: 2, body: { paragraphs: [{ runs: [{ text: 'top' }] }] } }] },
        { height: 1, cells: [{ column: 2, body: { paragraphs: [{ runs: [{ text: 'bottom' }] }] } }] },
      ],
    }

    expect(serializeTableXml(mergedTable)).toContain(
      '<a:tr h="1"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>origin</a:t></a:r></a:p></a:txBody><a:tcPr gridSpan="2" rowSpan="2"/></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>top</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>' +
        '<a:tr h="1"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr vMerge="1"/></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>bottom</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>',
    )
  })

  it('serializes a none border as an explicit noFill line', () => {
    const noneBorderTable: TableElement = {
      id: 'none-border-table',
      kind: 'table',
      bounds: table.bounds,
      columns: [1],
      rows: [{ height: 1, cells: [{ column: 0, borders: { left: { color: srgb('000000'), style: 'none' } }, body: { paragraphs: [{ runs: [] }] } }] }],
    }

    expect(serializeTableXml(noneBorderTable)).toContain('<a:lnL><a:noFill/></a:lnL>')
  })
})
