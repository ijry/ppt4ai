/** Mirrors `@ppt4ai/model`'s type: the `prst` word verbatim, of which four have a real outline. */
export type PresetGeometry = string

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

export interface GradientAxis {
  from: GeometryPoint
  to: GeometryPoint
}

/**
 * The two endpoints of an `a:lin` gradient across a box. `angle` is OOXML's `a:lin/@ang`, so it is
 * measured clockwise from the positive x axis in a y-down space, which is what `rotationRadians`
 * already converts.
 *
 * The axis runs through the centre and the half-extent is the box's own extent along it, so the
 * gradient covers the whole box exactly: at 90 degrees the endpoints are the top and bottom edge
 * midpoints.
 *
 * `scaled` is OOXML's "measure the angle in the shape's unit square, then stretch it to the box",
 * which is the direction `(w·cos, h·sin)` renormalised. The two agree at 0 and 90 degrees; at 45
 * degrees on a box twice as wide as it is tall, scaled gives exactly the box diagonal.
 */
export function gradientAxis(bounds: GeometryBounds, angle = 0, scaled = false): GradientAxis {
  const centre = boundsCentre(bounds)
  const radians = rotationRadians(angle)
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const rawX = scaled ? bounds.w * cos : cos
  const rawY = scaled ? bounds.h * sin : sin
  const length = Math.hypot(rawX, rawY)
  // A degenerate box or direction has no axis to speak of; a zero-length axis paints the last stop.
  if (!length) return { from: centre, to: centre }
  const dx = rawX / length
  const dy = rawY / length
  const half = Math.abs((bounds.w / 2) * dx) + Math.abs((bounds.h / 2) * dy)
  return {
    from: { x: centre.x - dx * half, y: centre.y - dy * half },
    to: { x: centre.x + dx * half, y: centre.y + dy * half },
  }
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

/** A group's own transform plus the pivot it applies about, which is always its own centre. */
export interface GroupTransform {
  pivot: GeometryPoint
  rotation?: number
  flipH?: boolean
  flipV?: boolean
}

export interface ElementTransformValues {
  rotation?: number
  flipH?: boolean
  flipV?: boolean
}

export interface CascadedTransform {
  bounds: GeometryBounds
  rotation: number
  flipH: boolean
  flipV: boolean
}

/**
 * Map a rectangle from a declared child coordinate space onto the box that space is drawn into.
 * OOXML groups author descendants in `a:chOff`/`a:chExt` and stretch that onto `a:off`/`a:ext`.
 */
export function mapChildSpace(bounds: GeometryBounds, childSpace: GeometryBounds, target: GeometryBounds): GeometryBounds {
  const scaleX = target.w / childSpace.w
  const scaleY = target.h / childSpace.h
  return {
    x: target.x + (bounds.x - childSpace.x) * scaleX,
    y: target.y + (bounds.y - childSpace.y) * scaleY,
    w: bounds.w * scaleX,
    h: bounds.h * scaleY,
  }
}

/**
 * Fold a chain of ancestor transforms into one axis-aligned box plus a single angle and flip pair.
 *
 * `ancestors` is ordered outermost first, matching a top-down tree walk, but the innermost
 * ancestor acts first: it transforms its own contents before any outer ancestor moves them. Each
 * pivot must therefore be the ancestor's own untransformed centre.
 *
 * Each ancestor mirrors before it rotates, the order `a:xfrm` implies. Rotating or mirroring a
 * rectangle about an outside point yields a congruent rectangle, so width and height are exact
 * and only the centre moves.
 */
export function cascadeTransform(
  bounds: GeometryBounds,
  own: ElementTransformValues,
  ancestors: readonly GroupTransform[],
): CascadedTransform {
  let rotation = own.rotation ?? 0
  let flipH = own.flipH === true
  let flipV = own.flipV === true
  let centre = boundsCentre(bounds)
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]!
    const mirrorH = ancestor.flipH === true
    const mirrorV = ancestor.flipV === true
    if (mirrorH) centre = { x: 2 * ancestor.pivot.x - centre.x, y: centre.y }
    if (mirrorV) centre = { x: centre.x, y: 2 * ancestor.pivot.y - centre.y }
    // One mirror reverses the sense of an angle. Two are a point reflection, which does not, and
    // which the descendant's own two flips already carry: flipH+flipV is itself a half turn.
    if (mirrorH !== mirrorV && rotation !== 0) rotation = -rotation
    if (mirrorH) flipH = !flipH
    if (mirrorV) flipV = !flipV
    if (ancestor.rotation) {
      centre = rotatePointAround(centre, ancestor.pivot, ancestor.rotation)
      rotation += ancestor.rotation
    }
  }
  const unmoved = centre.x === bounds.x + bounds.w / 2 && centre.y === bounds.y + bounds.h / 2
  return {
    bounds: unmoved ? bounds : { x: centre.x - bounds.w / 2, y: centre.y - bounds.h / 2, w: bounds.w, h: bounds.h },
    rotation,
    flipH,
    flipV,
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
    case 'roundRect': return roundRectanglePath(bounds)
    case 'ellipse': return ellipsePath(bounds)
    case 'triangle': return trianglePath(bounds)
    // Every other `prst` word — 183 of them — has an outline this project cannot verify, so it paints
    // as its bounding rectangle. That is what they painted before the word reached the model too.
    default: return rectanglePath(bounds)
  }
}
