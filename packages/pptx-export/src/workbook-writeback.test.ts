import { describe, expect, it } from 'vitest'
import { parseCellRange, patchSheetCells } from './workbook-writeback.js'

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
