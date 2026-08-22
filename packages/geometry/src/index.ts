export type PresetGeometry = 'rect' | 'roundRect' | 'ellipse' | 'triangle'

export interface GeometryBounds {
  x: number
  y: number
  w: number
  h: number
}

export type PathCommand =
  | { type: 'move' | 'line'; x: number; y: number }
  | { type: 'arc'; cx: number; cy: number; rx: number; ry: number; start: number; end: number }
  | { type: 'close' }

const quarterTurn = Math.PI / 2

function rectanglePath({ x, y, w, h }: GeometryBounds): PathCommand[] {
  return [
    { type: 'move', x, y },
    { type: 'line', x: x + w, y },
    { type: 'line', x: x + w, y: y + h },
    { type: 'line', x, y: y + h },
    { type: 'close' },
  ]
}

function roundRectanglePath({ x, y, w, h }: GeometryBounds): PathCommand[] {
  const radius = Math.min(w, h) / 2
  return [
    { type: 'move', x: x + radius, y },
    { type: 'line', x: x + w - radius, y },
    { type: 'arc', cx: x + w - radius, cy: y + radius, rx: radius, ry: radius, start: -quarterTurn, end: 0 },
    { type: 'line', x: x + w, y: y + h - radius },
    { type: 'arc', cx: x + w - radius, cy: y + h - radius, rx: radius, ry: radius, start: 0, end: quarterTurn },
    { type: 'line', x: x + radius, y: y + h },
    { type: 'arc', cx: x + radius, cy: y + h - radius, rx: radius, ry: radius, start: quarterTurn, end: Math.PI },
    { type: 'line', x, y: y + radius },
    { type: 'arc', cx: x + radius, cy: y + radius, rx: radius, ry: radius, start: Math.PI, end: Math.PI + quarterTurn },
    { type: 'close' },
  ]
}

function ellipsePath({ x, y, w, h }: GeometryBounds): PathCommand[] {
  const rx = w / 2
  const ry = h / 2
  const cx = x + rx
  const cy = y + ry
  return [
    { type: 'move', x: cx + rx, y: cy },
    { type: 'arc', cx, cy, rx, ry, start: 0, end: quarterTurn },
    { type: 'arc', cx, cy, rx, ry, start: quarterTurn, end: Math.PI },
    { type: 'arc', cx, cy, rx, ry, start: Math.PI, end: Math.PI + quarterTurn },
    { type: 'arc', cx, cy, rx, ry, start: Math.PI + quarterTurn, end: Math.PI * 2 },
    { type: 'close' },
  ]
}

function trianglePath({ x, y, w, h }: GeometryBounds): PathCommand[] {
  return [
    { type: 'move', x: x + w / 2, y },
    { type: 'line', x: x + w, y: y + h },
    { type: 'line', x, y: y + h },
    { type: 'close' },
  ]
}

export function createPresetPath(preset: PresetGeometry, bounds: GeometryBounds): PathCommand[] {
  switch (preset) {
    case 'rect': return rectanglePath(bounds)
    case 'roundRect': return roundRectanglePath(bounds)
    case 'ellipse': return ellipsePath(bounds)
    case 'triangle': return trianglePath(bounds)
  }
}
