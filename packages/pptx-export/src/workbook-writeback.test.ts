import { describe, expect, it } from 'vitest'
import { parseCellRange, patchEmbeddedWorkbook, patchSheetCells } from './workbook-writeback.js'
import { readZipEntries, writeStoredZip } from './zip.js'

describe('parseCellRange', () => {
  it('expands a single-column range top to bottom', () => {
    expect(parseCellRange('Sheet1!$B$2:$B$4')).toEqual({ sheet: 'Sheet1', cells: ['B2', 'B3', 'B4'] })
  })

  it('expands a single-row range left to right', () => {
    expect(parseCellRange('Sheet1!$B$2:$D$2')).toEqual({ sheet: 'Sheet1', cells: ['B2', 'C2', 'D2'] })
  })

  it('reads a single cell', () => {
    expect(parseCellRange('Sheet1!$B$2')).toEqual({ sheet: 'Sheet1', cells: ['B2'] })
  })

  it('unquotes a sheet name with spaces', () => {
    expect(parseCellRange("'My Data'!$A$1:$A$2")).toEqual({ sheet: 'My Data', cells: ['A1', 'A2'] })
  })

  it('returns undefined for a formula with no sheet or a 2-D range', () => {
    expect(parseCellRange('$B$2')).toBeUndefined()
    expect(parseCellRange('Sheet1!$B$2:$D$4')).toBeUndefined()
  })
})

const sheet = (cells: string): string => `<worksheet><sheetData>${cells}</sheetData></worksheet>`

describe('patchSheetCells', () => {
  it('rewrites a changed numeric cell and leaves the rest', () => {
    const out = patchSheetCells(sheet('<c r="B2"><v>10</v></c><c r="B3"><v>20</v></c>'), new Map([['B3', 99]]))
    expect(out).toContain('<c r="B3"><v>99</v></c>')
    expect(out).toContain('<c r="B2"><v>10</v></c>')
  })

  it('leaves the sheet byte-identical when the number did not change (10 vs 10.0)', () => {
    const src = sheet('<c r="B2"><v>10.0</v></c>')
    expect(patchSheetCells(src, new Map([['B2', 10]]))).toBe(src)
  })

  it('skips string cells (category labels are Tier B2)', () => {
    const src = sheet('<c r="A2" t="s"><v>0</v></c>')
    expect(patchSheetCells(src, new Map([['A2', 5]]))).toBe(src)
  })

  it('leaves the sheet untouched when no target cells are present', () => {
    const src = sheet('<c r="B2"><v>10</v></c>')
    expect(patchSheetCells(src, new Map([['Z9', 1]]))).toBe(src)
  })
})

const enc = (value: string): Uint8Array => new TextEncoder().encode(value)
function xlsx(sheetCells: string): Uint8Array {
  return writeStoredZip([
    { name: 'xl/workbook.xml', data: enc('<workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: enc('<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc(`<worksheet><sheetData>${sheetCells}</sheetData></worksheet>`) },
  ])
}

describe('patchEmbeddedWorkbook', () => {
  it('patches a numeric cell inside the nested workbook, resolving the sheet by name', async () => {
    const out = await patchEmbeddedWorkbook(xlsx('<c r="B2"><v>10</v></c><c r="B3"><v>20</v></c>'), new Map([['Sheet1', new Map([['B3', 99]])]]))
    const inner = await readZipEntries(out)
    const sheetXml = new TextDecoder().decode(inner.find((entry) => entry.name === 'xl/worksheets/sheet1.xml')!.data)
    expect(sheetXml).toContain('<v>99</v>')
    expect(sheetXml).toContain('<v>10</v>')
  })

  it('returns the exact same bytes when no cell changed', async () => {
    const bytes = xlsx('<c r="B2"><v>10</v></c>')
    expect(await patchEmbeddedWorkbook(bytes, new Map([['Sheet1', new Map([['B2', 10]])]]))).toBe(bytes)
  })
})
