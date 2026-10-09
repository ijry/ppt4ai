import type { ChartSeries } from '@ppt4ai/model'
import { escapeXml } from './text-xml.js'
import { parseCellRange } from './workbook-writeback.js'
import { decodeXml, descendants, replaceRanges, scanXml, type Replacement, type XmlElement } from './xml-range.js'

const PLOT_TYPES = ['barChart', 'lineChart', 'areaChart', 'pieChart', 'doughnutChart']

function plotNode(roots: XmlElement[]): XmlElement | undefined {
  for (const type of PLOT_TYPES) {
    const node = descendants(roots, type)[0]
    if (node) return node
  }
  return undefined
}

function replaceText(node: XmlElement, value: string): Replacement {
  return { start: node.start, end: node.end, value: `<${node.name}>${escapeXml(value)}</${node.name}>` }
}

/**
 * Surgically patch a chart part's cached data to match the edited model (Tier A: cache only, the
 * embedded workbook is not touched). Only `c:v` texts whose value actually changed are rewritten —
 * numeric values compared numerically (so 10 vs 10.0 is a no-op), category strings compared exactly — so
 * an unedited chart round-trips byte-identical. Mirrors the importer's cache reader: series match by
 * position, points by `c:pt/@idx`, categories come from the first series that carries them.
 */
export function patchChartCache(chartXml: string, categories: readonly string[], series: readonly Pick<ChartSeries, 'values'>[]): string {
  const plot = plotNode(scanXml(chartXml))
  if (!plot) return chartXml
  const serNodes = plot.children.filter((child) => child.localName === 'ser')
  const replacements: Replacement[] = []
  let categoriesPatched = false
  serNodes.forEach((ser, seriesIndex) => {
    const valNode = ser.children.find((child) => child.localName === 'val')
    const numCache = valNode ? descendants([valNode], 'numCache')[0] : undefined
    const modelValues = series[seriesIndex]?.values
    if (numCache && modelValues) {
      for (const point of descendants([numCache], 'pt')) {
        const idx = Number(point.attributes.idx)
        const modelValue = Number.isInteger(idx) ? modelValues[idx] : undefined
        if (modelValue === null || modelValue === undefined || !Number.isFinite(modelValue)) continue
        const valueNode = descendants([point], 'v')[0]
        if (valueNode && Number(decodeXml(valueNode.text)) !== modelValue) replacements.push(replaceText(valueNode, String(modelValue)))
      }
    }
    if (categoriesPatched) return
    const catNode = ser.children.find((child) => child.localName === 'cat')
    const strCache = catNode ? descendants([catNode], 'strCache')[0] : undefined
    if (!strCache) return
    categoriesPatched = true
    for (const point of descendants([strCache], 'pt')) {
      const idx = Number(point.attributes.idx)
      const label = Number.isInteger(idx) ? categories[idx] : undefined
      if (label === undefined) continue
      const valueNode = descendants([point], 'v')[0]
      if (valueNode && decodeXml(valueNode.text) !== label) replacements.push(replaceText(valueNode, label))
    }
  })
  return replaceRanges(chartXml, replacements)
}

/**
 * Map a chart's edited series values to the embedded-workbook cells that back them, grouped by sheet.
 * Reads each series' `c:val/c:numRef/c:f` range (Tier B1: numeric values only); a series without a
 * formula contributes nothing. The caller patches these cells so the workbook agrees with the cache.
 */
export function chartValueCellEdits(chartXml: string, series: readonly Pick<ChartSeries, 'values'>[]): Map<string, Map<string, number>> {
  const edits = new Map<string, Map<string, number>>()
  const plot = plotNode(scanXml(chartXml))
  if (!plot) return edits
  const serNodes = plot.children.filter((child) => child.localName === 'ser')
  serNodes.forEach((ser, seriesIndex) => {
    const modelValues = series[seriesIndex]?.values
    const valNode = ser.children.find((child) => child.localName === 'val')
    const formulaNode = valNode ? descendants([valNode], 'f')[0] : undefined
    if (!modelValues || !formulaNode) return
    const range = parseCellRange(decodeXml(formulaNode.text))
    if (!range) return
    const sheetEdits = edits.get(range.sheet) ?? new Map<string, number>()
    range.cells.forEach((cell, index) => {
      const value = modelValues[index]
      if (value !== null && value !== undefined && Number.isFinite(value)) sheetEdits.set(cell, value)
    })
    if (sheetEdits.size > 0) edits.set(range.sheet, sheetEdits)
  })
  return edits
}

function strCacheLabels(cache: XmlElement | undefined): string[] {
  if (!cache) return []
  const byIndex = new Map<number, string>()
  let max = -1
  for (const point of descendants([cache], 'pt')) {
    const idx = Number(point.attributes.idx)
    const valueNode = descendants([point], 'v')[0]
    if (!Number.isInteger(idx) || !valueNode) continue
    byIndex.set(idx, decodeXml(valueNode.text))
    if (idx > max) max = idx
  }
  return Array.from({ length: max + 1 }, (_, index) => byIndex.get(index) ?? '')
}

/**
 * Map changed category labels to the workbook cells that back them (Tier B2). Compares the model's new
 * categories against the chart's cached labels (`c:cat/c:strCache`) and emits only the cells that
 * changed, keyed by sheet via the category `c:f` range. Categories come from the first series that
 * carries them, mirroring the importer.
 */
export function chartCategoryCellEdits(chartXml: string, categories: readonly string[]): Map<string, Map<string, string>> {
  const edits = new Map<string, Map<string, string>>()
  const plot = plotNode(scanXml(chartXml))
  if (!plot) return edits
  for (const ser of plot.children.filter((child) => child.localName === 'ser')) {
    const catNode = ser.children.find((child) => child.localName === 'cat')
    if (!catNode) continue
    const formulaNode = descendants([catNode], 'f')[0]
    if (!formulaNode) return edits
    const range = parseCellRange(decodeXml(formulaNode.text))
    if (!range) return edits
    const oldLabels = strCacheLabels(descendants([catNode], 'strCache')[0])
    const sheetEdits = new Map<string, string>()
    range.cells.forEach((cell, index) => {
      const next = categories[index]
      if (next !== undefined && next !== oldLabels[index]) sheetEdits.set(cell, next)
    })
    if (sheetEdits.size > 0) edits.set(range.sheet, sheetEdits)
    return edits
  }
  return edits
}
