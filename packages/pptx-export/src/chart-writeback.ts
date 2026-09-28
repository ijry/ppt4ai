import type { ChartSeries } from '@ppt4ai/model'
import { escapeXml } from './text-xml.js'
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
