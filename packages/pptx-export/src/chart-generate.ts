import type { ChartElement } from '@ppt4ai/model'
import { escapeXml } from './text-xml.js'
import { writeStoredZip } from './zip.js'

// Phase 3 chart generators: build a chart part (`c:chartSpace`) and its embedded workbook from a
// ChartElement, from scratch. These are the inverse of the importer's parser and the Tier A/B patchers,
// and must stay structurally in step with them (same ser/cat/val/numCache/strCache/c:f shape).

const PLOT_TAG: Record<string, string> = {
  column: 'c:barChart', bar: 'c:barChart', line: 'c:lineChart', area: 'c:areaChart', pie: 'c:pieChart', doughnut: 'c:doughnutChart',
}

/** 1 → A, 2 → B, … (spreadsheet column letters). */
function columnLetter(index: number): string {
  let remaining = index
  let name = ''
  while (remaining > 0) {
    name = String.fromCharCode(65 + ((remaining - 1) % 26)) + name
    remaining = Math.floor((remaining - 1) / 26)
  }
  return name
}

function strCache(formula: string, labels: readonly string[]): string {
  const points = labels.map((label, index) => `<c:pt idx="${index}"><c:v>${escapeXml(label)}</c:v></c:pt>`).join('')
  return `<c:strRef><c:f>${escapeXml(formula)}</c:f><c:strCache><c:ptCount val="${labels.length}"/>${points}</c:strCache></c:strRef>`
}

function numCache(formula: string, values: readonly (number | null)[]): string {
  const points = values.map((value, index) => (value === null || !Number.isFinite(value) ? '' : `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`)).join('')
  return `<c:numRef><c:f>${escapeXml(formula)}</c:f><c:numCache><c:ptCount val="${values.length}"/>${points}</c:numCache></c:numRef>`
}

/** The `c:chartSpace` XML for a chart element, referencing its embedded workbook via `rId1`. */
export function serializeChartSpace(element: ChartElement, sheet = 'Sheet1'): string {
  const type = element.chartType && element.chartType !== 'unknown' ? element.chartType : 'column'
  const tag = PLOT_TAG[type] ?? 'c:barChart'
  const categories = element.categories ?? []
  const series = element.series ?? []
  const lastRow = categories.length + 1
  const categoryFormula = `${sheet}!$A$2:$A$${lastRow}`
  const seriesXml = series.map((entry, seriesIndex) => {
    const column = columnLetter(seriesIndex + 2)
    const name = entry.name ? `<c:tx>${strCache(`${sheet}!$${column}$1`, [entry.name])}</c:tx>` : ''
    return `<c:ser><c:idx val="${seriesIndex}"/><c:order val="${seriesIndex}"/>${name}`
      + `<c:cat>${strCache(categoryFormula, categories)}</c:cat>`
      + `<c:val>${numCache(`${sheet}!$${column}$2:$${column}$${lastRow}`, entry.values)}</c:val></c:ser>`
  }).join('')
  const cartesian = type !== 'pie' && type !== 'doughnut'
  const barDir = type === 'bar' ? '<c:barDir val="bar"/>' : type === 'column' ? '<c:barDir val="col"/>' : ''
  const grouping = cartesian ? '<c:grouping val="clustered"/>' : ''
  const axisIds = cartesian ? '<c:axId val="111111111"/><c:axId val="222222222"/>' : ''
  const axes = cartesian
    ? '<c:catAx><c:axId val="111111111"/><c:orientation val="minMax"/><c:crossAx val="222222222"/></c:catAx>'
      + '<c:valAx><c:axId val="222222222"/><c:orientation val="minMax"/><c:crossAx val="111111111"/></c:valAx>'
    : ''
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<c:chart><c:plotArea><c:layout/><${tag}>${barDir}${grouping}${seriesXml}${axisIds}</${tag}>${axes}</c:plotArea></c:chart>`
    + '<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>'
}

// APPEND-BELOW

const XLSX_WORKSHEET_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
const XLSX_WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'

/** A minimal embedded workbook (a stored xlsx) holding the chart's data: categories down column A,
 * each series in the next column, series names on row 1. Matches the `c:f` ranges serializeChartSpace
 * emits and the sheet shape patchEmbeddedWorkbook / resolveSheetPaths expect. */
export function serializeChartWorkbook(element: ChartElement, sheet = 'Sheet1'): Uint8Array {
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
  const categories = element.categories ?? []
  const series = element.series ?? []
  const header = series.map((entry, index) => (entry.name ? `<c r="${columnLetter(index + 2)}1" t="inlineStr"><is><t>${escapeXml(entry.name)}</t></is></c>` : '')).join('')
  const rows = [`<row r="1">${header}</row>`]
  categories.forEach((category, categoryIndex) => {
    const rowNumber = categoryIndex + 2
    const cells = [`<c r="A${rowNumber}" t="inlineStr"><is><t>${escapeXml(category)}</t></is></c>`]
    series.forEach((entry, seriesIndex) => {
      const value = entry.values[categoryIndex]
      if (value !== null && value !== undefined && Number.isFinite(value)) cells.push(`<c r="${columnLetter(seriesIndex + 2)}${rowNumber}"><v>${value}</v></c>`)
    })
    rows.push(`<row r="${rowNumber}">${cells.join('')}</row>`)
  })
  const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`
  const workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + `<Override PartName="/xl/workbook.xml" ContentType="${XLSX_WORKBOOK_TYPE}"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${XLSX_WORKSHEET_TYPE}"/></Types>`
  return writeStoredZip([
    { name: '[Content_Types].xml', data: encode(contentTypes) },
    { name: '_rels/.rels', data: encode(rootRels) },
    { name: 'xl/workbook.xml', data: encode(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: encode(workbookRels) },
    { name: 'xl/worksheets/sheet1.xml', data: encode(sheetXml) },
  ])
}
