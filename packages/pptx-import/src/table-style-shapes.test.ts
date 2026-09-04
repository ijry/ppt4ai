import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

/**
 * A table style region as ECMA-376 defines it: `a:tcBdr`'s children are `a:left`/`a:right`/`a:top`/
 * `a:bottom` (`CT_ThemeableLineStyle`), each wrapping an `a:ln` — not the `a:lnL`/`a:lnR` with inline
 * line properties that a cell's own `a:tcPr` uses. Both vocabularies exist in OOXML and this parser
 * used to read only the cell one, so a real style's borders never arrived.
 */
function styleList(region: string): string {
  return '<a:tblStyleLst xmlns:a="a" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}">'
    + `<a:tblStyle styleId="style-1" styleName="Probe"><a:wholeTbl>${region}</a:wholeTbl></a:tblStyle></a:tblStyleLst>`
}

async function regionOf(region: string) {
  const imported = await importPptx(createStoredZip({ ...files, 'ppt/tableStyles.xml': styleList(region) }))
  return imported.tableStyles?.['style-1']?.regions?.wholeTable
}

const ecmaBorders = '<a:tcStyle><a:tcBdr>'
  + '<a:left><a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></a:left>'
  + '<a:right><a:ln w="25400"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:prstDash val="sysDash"/></a:ln></a:right>'
  + '<a:top><a:ln><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln></a:top>'
  + '<a:bottom><a:ln w="50800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:ln></a:bottom>'
  + '</a:tcBdr></a:tcStyle>'

describe('table style shapes', () => {
  it('reads the four borders ECMA wraps in a:ln', async () => {
    const region = await regionOf(ecmaBorders)

    expect(region?.borders).toEqual({
      left: { color: { type: 'srgb', v: 'FF0000' }, width: 12700, style: 'solid' },
      right: { color: { type: 'srgb', v: '00FF00' }, width: 25400, style: 'sysDash' },
      top: { color: { type: 'srgb', v: '0000FF' }, style: 'solid' },
      bottom: { color: { type: 'scheme', v: 'tx1' }, width: 50800, style: 'solid' },
    })
  })

  it('still reads the flat border shape the older fixtures carry', async () => {
    const region = await regionOf('<a:tcStyle><a:tcBdr><a:lnL w="1000"><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:lnL></a:tcBdr></a:tcStyle>')

    expect(region?.borders).toEqual({ left: { color: { type: 'srgb', v: '111111' }, width: 1000, style: 'solid' } })
  })

  it('drops a border whose width is unusable rather than repairing it', async () => {
    const region = await regionOf('<a:tcStyle><a:tcBdr><a:left><a:ln w="wide"><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:ln></a:left></a:tcBdr></a:tcStyle>')

    expect(region).toBeUndefined()
  })

  it('reads bold and italic in the on/off vocabulary the schema defines', async () => {
    const region = await regionOf('<a:tcTxStyle b="on" i="off"><a:srgbClr val="FFFFFF"/></a:tcTxStyle>')

    expect(region?.text).toEqual({ color: { type: 'srgb', v: 'FFFFFF' }, bold: true, italic: false })
  })

  /** `def` means "inherit", which is a field the model leaves out — not a `false`. */
  it('treats def as unstated and keeps rejecting values the schema does not define', async () => {
    const inherited = await regionOf('<a:tcTxStyle b="def" i="def"><a:srgbClr val="FFFFFF"/></a:tcTxStyle>')
    const invalid = await regionOf('<a:tcTxStyle b="yes" i="maybe"><a:srgbClr val="FFFFFF"/></a:tcTxStyle>')

    expect(inherited?.text).toEqual({ color: { type: 'srgb', v: 'FFFFFF' } })
    expect(invalid?.text).toEqual({ color: { type: 'srgb', v: 'FFFFFF' } })
  })

  it('still reads the numeric flags the older fixtures carry', async () => {
    const region = await regionOf('<a:tcTxStyle b="1" i="0"><a:srgbClr val="FFFFFF"/></a:tcTxStyle>')

    expect(region?.text).toEqual({ color: { type: 'srgb', v: 'FFFFFF' }, bold: true, italic: false })
  })

  /** The interior grid lines a real Office style draws with; a cell's own `a:tcPr` has no counterpart. */
  it('reads the two interior lines', async () => {
    const region = await regionOf('<a:tcStyle><a:tcBdr>'
      + '<a:insideH><a:ln w="6350"><a:solidFill><a:srgbClr val="AAAAAA"/></a:solidFill></a:ln></a:insideH>'
      + '<a:insideV><a:ln w="12700"><a:solidFill><a:srgbClr val="BBBBBB"/></a:solidFill><a:prstDash val="dash"/></a:ln></a:insideV>'
      + '</a:tcBdr></a:tcStyle>')

    expect(region?.borders).toEqual({
      insideH: { color: { type: 'srgb', v: 'AAAAAA' }, width: 6350, style: 'solid' },
      insideV: { color: { type: 'srgb', v: 'BBBBBB' }, width: 12700, style: 'dash' },
    })
  })
})
