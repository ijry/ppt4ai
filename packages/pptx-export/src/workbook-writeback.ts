import { escapeXml } from './text-xml.js'
import { decodeXml, descendants, replaceRanges, scanXml, type Replacement } from './xml-range.js'

// Phase 2b (Tier B) pure helpers: map a chart series' `c:f` range to spreadsheet cells, and patch those
// numeric cells inside a worksheet's XML. The nested-zip read/write that feeds these is a separate,
// async step; kept out here so the risky range + cell logic is unit-testable in isolation.

function splitCell(ref: string): { col: string; row: number } | undefined {
  const match = /^([A-Z]+)(\d+)$/u.exec(ref)
  return match ? { col: match[1]!, row: Number(match[2]) } : undefined
}

function columnIndex(col: string): number {
  let index = 0
  for (const character of col) index = index * 26 + (character.charCodeAt(0) - 64)
  return index
}

function columnName(index: number): string {
  let remaining = index
  let name = ''
  while (remaining > 0) {
    const digit = (remaining - 1) % 26
    name = String.fromCharCode(65 + digit) + name
    remaining = Math.floor((remaining - 1) / 26)
  }
  return name
}

/**
 * A chart `c:f` like `Sheet1!$B$2:$B$3` (or `'My Data'!$A$1:$A$2`, or a single `$B$2`) → the sheet name
 * and the cells it covers, in order. Only single-row or single-column ranges are supported (a series is
 * one of those); a 2-D range or an unparseable formula returns undefined so the caller skips it.
 */
export function parseCellRange(formula: string): { sheet: string; cells: string[] } | undefined {
  const bang = formula.lastIndexOf('!')
  if (bang < 0) return undefined
  let sheet = formula.slice(0, bang)
  if (sheet.startsWith("'") && sheet.endsWith("'")) sheet = sheet.slice(1, -1).replaceAll("''", "'")
  const range = formula.slice(bang + 1).replaceAll('$', '')
  const [startRef, endRef] = range.split(':')
  if (!startRef) return undefined
  if (!endRef || startRef === endRef) return splitCell(startRef) ? { sheet, cells: [startRef] } : undefined
  const start = splitCell(startRef)
  const end = splitCell(endRef)
  if (!start || !end) return undefined
  const cells: string[] = []
  if (start.col === end.col) {
    for (let row = start.row; row <= end.row; row += 1) cells.push(`${start.col}${row}`)
  } else if (start.row === end.row) {
    for (let col = columnIndex(start.col); col <= columnIndex(end.col); col += 1) cells.push(`${columnName(col)}${start.row}`)
  } else return undefined
  return { sheet, cells }
}

/**
 * Patch numeric cells in a worksheet's XML to the given values, surgically and only when the value
 * actually changed (numeric comparison, so 10 vs 10.0 is a no-op). String cells (`t="s"/"str"`) are left
 * alone — category-label editing is Tier B2. Mirrors the chart-cache patcher's "changed only" rule so an
 * unedited workbook stays byte-identical.
 */
export function patchSheetCells(sheetXml: string, cellValues: ReadonlyMap<string, number>): string {
  const replacements: Replacement[] = []
  for (const cell of descendants(scanXml(sheetXml), 'c')) {
    const ref = cell.attributes.r
    const value = ref ? cellValues.get(ref) : undefined
    if (value === undefined) continue
    if (cell.attributes.t && cell.attributes.t !== 'n') continue
    const valueNode = cell.children.find((child) => child.localName === 'v')
    if (valueNode && Number(decodeXml(valueNode.text)) !== value) {
      replacements.push({ start: valueNode.start, end: valueNode.end, value: `<${valueNode.name}>${escapeXml(String(value))}</${valueNode.name}>` })
    }
  }
  return replaceRanges(sheetXml, replacements)
}
