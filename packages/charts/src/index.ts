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
  /** Fallback colours for slices/series with no explicit colour, indexed round-robin. */
  palette?: string[]
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

export interface ChartPoint {
  x: number
  y: number
}

export interface ChartPolyline {
  points: ChartPoint[]
  color?: string
}

export interface ChartArea {
  points: ChartPoint[]
  color?: string
}

/** A pie/doughnut slice: an annular wedge from `start` to `end` radians (clockwise from 12 o'clock),
 * with `innerR` 0 for a full pie. */
export interface ChartSector {
  cx: number
  cy: number
  r: number
  innerR: number
  start: number
  end: number
  color?: string
}

export interface ChartPrimitives {
  bars: ChartBar[]
  /** Line-chart series, one polyline each (gaps split into separate points). */
  polylines?: ChartPolyline[]
  /** Area-chart series, each closed down to the baseline. */
  areas?: ChartArea[]
  /** Pie/doughnut slices. */
  sectors?: ChartSector[]
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

interface Cartesian {
  plot: Rect
  lo: number
  hi: number
  yOf: (value: number) => number
  baseline: number
  slotWidth: number
  slotCenter: (index: number) => number
}

/** The shared cartesian frame column/line/area all sit in: plot area, a zero-anchored value scale, and
 * evenly spaced category slots. */
function cartesian(spec: ChartSpec, box: Rect): Cartesian {
  const plot = plotArea(box)
  const { lo, hi } = valueDomain(spec.series)
  const span = hi - lo
  const slotWidth = plot.w / Math.max(1, spec.categories.length)
  return {
    plot,
    lo,
    hi,
    yOf: (value) => plot.y + plot.h * (hi - value) / span,
    baseline: plot.y + plot.h * hi / span,
    slotWidth,
    slotCenter: (index) => plot.x + (index + 0.5) * slotWidth,
  }
}

function cartesianDecorations(spec: ChartSpec, frame: Cartesian): { axes: ChartLine[]; labels: ChartLabel[] } {
  const { plot } = frame
  const axes: ChartLine[] = [
    { x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.h },
    { x1: plot.x, y1: frame.baseline, x2: plot.x + plot.w, y2: frame.baseline },
  ]
  const labels: ChartLabel[] = spec.categories.map((text, index) => ({
    text, x: frame.slotCenter(index), y: plot.y + plot.h, align: 'center', baseline: 'top', role: 'category',
  }))
  labels.push(
    { text: formatValue(frame.hi), x: plot.x, y: plot.y, align: 'end', baseline: 'middle', role: 'value' },
    { text: formatValue(frame.lo), x: plot.x, y: plot.y + plot.h, align: 'end', baseline: 'middle', role: 'value' },
  )
  return { axes, labels }
}

function layoutColumn(spec: ChartSpec, box: Rect): ChartPrimitives {
  const frame = cartesian(spec, box)
  const groupWidth = frame.slotWidth * GROUP_FRACTION
  const barWidth = groupWidth / Math.max(1, spec.series.length)
  const bars: ChartBar[] = []
  spec.categories.forEach((_, categoryIndex) => {
    const groupX = frame.plot.x + categoryIndex * frame.slotWidth + (frame.slotWidth - groupWidth) / 2
    spec.series.forEach((entry, seriesIndex) => {
      const value = entry.values[categoryIndex]
      if (value === null || value === undefined || !Number.isFinite(value)) return
      const y = frame.yOf(value)
      bars.push({
        x: groupX + seriesIndex * barWidth,
        y: Math.min(y, frame.baseline),
        w: barWidth,
        h: Math.abs(y - frame.baseline),
        ...(entry.color ? { color: entry.color } : {}),
        seriesIndex,
        categoryIndex,
      })
    })
  })
  const { axes, labels } = cartesianDecorations(spec, frame)
  return { bars, axes, gridlines: [], labels }
}

/** Line and area share their geometry: one polyline per series over the category slots, plus (for area)
 * a copy closed down to the baseline. Gaps (`null`) simply drop their point. */
function layoutLine(spec: ChartSpec, box: Rect, filled: boolean): ChartPrimitives {
  const frame = cartesian(spec, box)
  const polylines: ChartPolyline[] = []
  const areas: ChartArea[] = []
  for (const entry of spec.series) {
    const points: ChartPoint[] = []
    entry.values.forEach((value, categoryIndex) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return
      points.push({ x: frame.slotCenter(categoryIndex), y: frame.yOf(value) })
    })
    if (points.length === 0) continue
    polylines.push({ points, ...(entry.color ? { color: entry.color } : {}) })
    if (filled) {
      const closed = [...points, { x: points[points.length - 1]!.x, y: frame.baseline }, { x: points[0]!.x, y: frame.baseline }]
      areas.push({ points: closed, ...(entry.color ? { color: entry.color } : {}) })
    }
  }
  const { axes, labels } = cartesianDecorations(spec, frame)
  return { bars: [], axes, gridlines: [], labels, ...(polylines.length ? { polylines } : {}), ...(filled && areas.length ? { areas } : {}) }
}

const PIE_RADIUS_FRACTION = 0.9
const DOUGHNUT_INNER_FRACTION = 0.5

function paletteColor(spec: ChartSpec, index: number): string | undefined {
  return spec.palette && spec.palette.length > 0 ? spec.palette[index % spec.palette.length] : undefined
}

/** Pie/doughnut: the first series' positive values become slices of a circle centred in the box,
 * clockwise from 12 o'clock. `null`/non-positive values are skipped. Slices are coloured by the
 * palette (per point), since our model carries one colour per series, not per point. */
function layoutPie(spec: ChartSpec, box: Rect, doughnut: boolean): ChartPrimitives {
  const values = spec.series[0]?.values ?? []
  const total = values.reduce<number>((sum, value) => sum + (value !== null && Number.isFinite(value) && value > 0 ? value : 0), 0)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const r = (Math.min(box.w, box.h) / 2) * PIE_RADIUS_FRACTION
  const innerR = doughnut ? r * DOUGHNUT_INNER_FRACTION : 0
  const sectors: ChartSector[] = []
  if (total > 0) {
    let angle = -Math.PI / 2
    values.forEach((value, index) => {
      if (value === null || !Number.isFinite(value) || value <= 0) return
      const sweep = (value / total) * Math.PI * 2
      const color = paletteColor(spec, index)
      sectors.push({ cx, cy, r, innerR, start: angle, end: angle + sweep, ...(color ? { color } : {}) })
      angle += sweep
    })
  }
  return { bars: [], axes: [], gridlines: [], labels: [], ...(sectors.length ? { sectors } : {}) }
}

const EMPTY: ChartPrimitives = { bars: [], axes: [], gridlines: [], labels: [] }

/** Horizontal bar: column's transpose — categories run down the Y axis, values along X from a zero
 * baseline. Bars are still rects, so the painter needs no new path. */
function layoutBar(spec: ChartSpec, box: Rect): ChartPrimitives {
  const plot = plotArea(box)
  const { lo, hi } = valueDomain(spec.series)
  const span = hi - lo
  const xOf = (value: number): number => plot.x + plot.w * (value - lo) / span
  const baseline = xOf(0)
  const slotHeight = plot.h / Math.max(1, spec.categories.length)
  const groupHeight = slotHeight * GROUP_FRACTION
  const barHeight = groupHeight / Math.max(1, spec.series.length)
  const bars: ChartBar[] = []
  const labels: ChartLabel[] = []
  spec.categories.forEach((text, categoryIndex) => {
    const groupY = plot.y + categoryIndex * slotHeight + (slotHeight - groupHeight) / 2
    spec.series.forEach((entry, seriesIndex) => {
      const value = entry.values[categoryIndex]
      if (value === null || value === undefined || !Number.isFinite(value)) return
      const x = xOf(value)
      bars.push({
        x: Math.min(x, baseline),
        y: groupY + seriesIndex * barHeight,
        w: Math.abs(x - baseline),
        h: barHeight,
        ...(entry.color ? { color: entry.color } : {}),
        seriesIndex,
        categoryIndex,
      })
    })
    labels.push({ text, x: plot.x, y: plot.y + categoryIndex * slotHeight + slotHeight / 2, align: 'end', baseline: 'middle', role: 'category' })
  })
  const axes: ChartLine[] = [
    { x1: baseline, y1: plot.y, x2: baseline, y2: plot.y + plot.h },
    { x1: plot.x, y1: plot.y + plot.h, x2: plot.x + plot.w, y2: plot.y + plot.h },
  ]
  labels.push(
    { text: formatValue(lo), x: plot.x, y: plot.y + plot.h, align: 'start', baseline: 'top', role: 'value' },
    { text: formatValue(hi), x: plot.x + plot.w, y: plot.y + plot.h, align: 'end', baseline: 'top', role: 'value' },
  )
  return { bars, axes, gridlines: [], labels }
}

/** Lay out a chart into primitives within `box`. Cartesian types: `column`, `bar`, `line`, `area`;
 * radial types: `pie`, `doughnut`. Other types return empty, so the renderer falls back to the placeholder. */
export function layoutChart(spec: ChartSpec, box: Rect): ChartPrimitives {
  if (spec.type === 'column') return layoutColumn(spec, box)
  if (spec.type === 'bar') return layoutBar(spec, box)
  if (spec.type === 'line') return layoutLine(spec, box, false)
  if (spec.type === 'area') return layoutLine(spec, box, true)
  if (spec.type === 'pie') return layoutPie(spec, box, false)
  if (spec.type === 'doughnut') return layoutPie(spec, box, true)
  return EMPTY
}
