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

export interface GeometryPoint {
  x: number
  y: number
}

const quarterTurn = Math.PI / 2

/** OOXML states rotation in 60000ths of a degree; positive turns clockwise in a y-down space. */
const EMU_ROTATION_TO_RADIANS = Math.PI / 10800000

export function rotationRadians(rotation: number): number {
  return rotation * EMU_ROTATION_TO_RADIANS
}

export function rotationUnitsFromRadians(radians: number): number {
  return radians / EMU_ROTATION_TO_RADIANS
}

export function boundsCentre(bounds: GeometryBounds): GeometryPoint {
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
}

export function rotatePointAround(point: GeometryPoint, centre: GeometryPoint, rotation: number): GeometryPoint {
  if (!rotation) return point
  const angle = rotationRadians(rotation)
  const dx = point.x - centre.x
  const dy = point.y - centre.y
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  }
}

function containsPoint(bounds: GeometryBounds, point: GeometryPoint): boolean {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + bounds.h
}

export function containsRotatedPoint(bounds: GeometryBounds, point: GeometryPoint, rotation: number | undefined): boolean {
  if (!rotation) return containsPoint(bounds, point)
  return containsPoint(bounds, rotatePointAround(point, boundsCentre(bounds), -rotation))
}

export interface RotationPivot {
  pivot: GeometryPoint
  rotation: number
}

/**
 * Fold a chain of ancestor rotations into one axis-aligned box plus a single angle.
 *
 * `ancestors` is ordered outermost first, matching a top-down tree walk, but the innermost
 * ancestor acts first: it rotates its own contents before any outer ancestor moves it. Each
 * pivot must therefore be the ancestor's own untransformed centre.
 *
 * Rotating an already-rotated rectangle about an outside point yields a congruent rectangle,
 * so width and height are exact and only the centre moves.
 */
export function cascadeRotation(
  bounds: GeometryBounds,
  rotation: number | undefined,
  ancestors: readonly RotationPivot[],
): { bounds: GeometryBounds; rotation: number } {
  let total = rotation ?? 0
  let centre = boundsCentre(bounds)
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]!
    if (!ancestor.rotation) continue
    centre = rotatePointAround(centre, ancestor.pivot, ancestor.rotation)
    total += ancestor.rotation
  }
  if (centre.x === bounds.x + bounds.w / 2 && centre.y === bounds.y + bounds.h / 2) {
    return { bounds, rotation: total }
  }
  return {
    bounds: { x: centre.x - bounds.w / 2, y: centre.y - bounds.h / 2, w: bounds.w, h: bounds.h },
    rotation: total,
  }
}

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
