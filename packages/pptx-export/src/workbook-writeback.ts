import { escapeXml } from './text-xml.js'
import { readZipEntries, writeStoredZip, type ZipEntry } from './zip.js'
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

/** Map each worksheet's name to its part path inside the xlsx, via `xl/workbook.xml` + its rels. */
function resolveSheetPaths(entries: readonly ZipEntry[]): Map<string, string> {
  const result = new Map<string, string>()
  const workbook = entries.find((entry) => entry.name === 'xl/workbook.xml')
  const rels = entries.find((entry) => entry.name === 'xl/_rels/workbook.xml.rels')
  if (!workbook || !rels) return result
  const decoder = new TextDecoder()
  const targetById = new Map<string, string>()
  for (const relationship of descendants(scanXml(decoder.decode(rels.data)), 'Relationship')) {
    const id = relationship.attributes.Id
    const target = relationship.attributes.Target
    if (id && target) targetById.set(id, target)
  }
  for (const sheet of descendants(scanXml(decoder.decode(workbook.data)), 'sheet')) {
    const name = sheet.attributes.name
    const relId = sheet.attributes['r:id']
    const target = relId ? targetById.get(relId) : undefined
    if (name && target) result.set(name, `xl/${target.replace(/^\//u, '')}`)
  }
  return result
}

/**
 * Sync edited values into the embedded workbook (Tier B1). Reads the nested xlsx (DEFLATE inflated),
 * patches the numeric cells named per sheet, and re-writes it (stored). Returns the original bytes
 * unchanged when nothing changed, so an unedited chart's workbook entry stays byte-identical.
 */
export async function patchEmbeddedWorkbook(xlsxBytes: Uint8Array, editsBySheet: ReadonlyMap<string, ReadonlyMap<string, number>>): Promise<Uint8Array> {
  if (editsBySheet.size === 0) return xlsxBytes
  const entries = await readZipEntries(xlsxBytes)
  const sheetPaths = resolveSheetPaths(entries)
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let changed = false
  for (const [sheetName, cells] of editsBySheet) {
    const path = sheetPaths.get(sheetName)
    const entry = path ? entries.find((candidate) => candidate.name === path) : undefined
    if (!entry) continue
    const sheetXml = decoder.decode(entry.data)
    const patched = patchSheetCells(sheetXml, cells)
    if (patched !== sheetXml) {
      entry.data = encoder.encode(patched)
      changed = true
    }
  }
  return changed ? writeStoredZip(entries) : xlsxBytes
}
