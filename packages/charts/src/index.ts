import type { ChartType, Rect } from '@ppt4ai/model'

// Phase 1 chart-layout kernel: pure geometry, no canvas/DOM. `layoutChart` turns a normalized chart
// spec + a box (EMU, absolute) into drawable primitives in that same space; the renderer maps them to
// the canvas like any other node. Block 1 implements the column type; bar/line/area/pie follow.
// The chart-type vocabulary is owned by @ppt4ai/model so the model, importer and this kernel cannot
// drift apart on what a "column" is.

export type { ChartType }

export interface ChartSeries {
  name?: string
  /** Cached category values; `null` is an explicit gap (a bar/point is skipped). */
  values: (number | null)[]
  /** A resolved sRGB hex (`#RRGGBB`) when the file carried one; otherwise the renderer picks a palette. */
  color?: string
}

export interface ChartSpec {
  type: ChartType
  categories: string[]
  series: ChartSeries[]
}

export interface ChartBar {
  x: number
  y: number
  w: number
  h: number
  color?: string
  seriesIndex: number
  categoryIndex: number
}

export interface ChartLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface ChartLabel {
  text: string
  x: number
  y: number
  align: 'start' | 'center' | 'end'
  baseline: 'top' | 'middle' | 'bottom'
  role: 'category' | 'value'
}

export interface ChartPrimitives {
  bars: ChartBar[]
  axes: ChartLine[]
  gridlines: ChartLine[]
  labels: ChartLabel[]
}

// APPEND-BELOW

/**
 * The value-axis domain: anchored at zero so an all-positive (or all-negative) series shares a real
 * baseline, and never degenerate — an all-zero/empty series gets a unit height so the mapping stays
 * finite. `null` and non-finite values are ignored.
 */
export function valueDomain(series: readonly Pick<ChartSeries, 'values'>[]): { lo: number; hi: number } {
  let lo = 0
  let hi = 0
  for (const entry of series) {
    for (const value of entry.values) {
      if (value === null || value === undefined || !Number.isFinite(value)) continue
      if (value < lo) lo = value
      if (value > hi) hi = value
    }
  }
  if (lo === 0 && hi === 0) return { lo: 0, hi: 1 }
  return { lo, hi }
}

const MARGIN = { left: 0.1, right: 0.04, top: 0.06, bottom: 0.1 }
const GROUP_FRACTION = 0.8

function plotArea(box: Rect): Rect {
  return {
    x: box.x + box.w * MARGIN.left,
    y: box.y + box.h * MARGIN.top,
    w: box.w * (1 - MARGIN.left - MARGIN.right),
    h: box.h * (1 - MARGIN.top - MARGIN.bottom),
  }
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function layoutColumn(spec: ChartSpec, box: Rect): ChartPrimitives {
  const plot = plotArea(box)
  const { lo, hi } = valueDomain(spec.series)
  const span = hi - lo
  const yOf = (value: number): number => plot.y + plot.h * (hi - value) / span
  const baseline = yOf(0)
  const categoryCount = Math.max(1, spec.categories.length)
  const seriesCount = Math.max(1, spec.series.length)
  const slotWidth = plot.w / categoryCount
  const groupWidth = slotWidth * GROUP_FRACTION
  const barWidth = groupWidth / seriesCount

  const bars: ChartBar[] = []
  const labels: ChartLabel[] = []
  spec.categories.forEach((text, categoryIndex) => {
    const groupX = plot.x + categoryIndex * slotWidth + (slotWidth - groupWidth) / 2
    spec.series.forEach((entry, seriesIndex) => {
      const value = entry.values[categoryIndex]
      if (value === null || value === undefined || !Number.isFinite(value)) return
      const y = yOf(value)
      bars.push({
        x: groupX + seriesIndex * barWidth,
        y: Math.min(y, baseline),
        w: barWidth,
        h: Math.abs(y - baseline),
        ...(entry.color ? { color: entry.color } : {}),
        seriesIndex,
        categoryIndex,
      })
    })
    labels.push({ text, x: plot.x + categoryIndex * slotWidth + slotWidth / 2, y: plot.y + plot.h, align: 'center', baseline: 'top', role: 'category' })
  })

  const axes: ChartLine[] = [
    { x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.h },
    { x1: plot.x, y1: baseline, x2: plot.x + plot.w, y2: baseline },
  ]
  labels.push(
    { text: formatValue(hi), x: plot.x, y: plot.y, align: 'end', baseline: 'middle', role: 'value' },
    { text: formatValue(lo), x: plot.x, y: plot.y + plot.h, align: 'end', baseline: 'middle', role: 'value' },
  )
  return { bars, axes, gridlines: [], labels }
}

const EMPTY: ChartPrimitives = { bars: [], axes: [], gridlines: [], labels: [] }

/** Lay out a chart into primitives within `box`. Block 1 handles `column`; other types return empty
 * until their blocks land, so the renderer falls back to the placeholder. */
export function layoutChart(spec: ChartSpec, box: Rect): ChartPrimitives {
  if (spec.type === 'column') return layoutColumn(spec, box)
  return EMPTY
}
