import type { Point } from './selection-overlay'

export type ImageFlipAxis = 'horizontal' | 'vertical'

export const IMAGE_ROTATION_SNAP_STEP = 900000

const OOXML_UNITS_PER_RADIAN = 10800000 / Math.PI

function assertFinitePoint(point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('rotation points must be finite')
}

function angleFromCenter(center: Point, point: Point): number {
  const x = point.x - center.x
  const y = point.y - center.y
  if (x === 0 && y === 0) throw new Error('rotation pointer must not be at center')
  return Math.atan2(y, x)
}

function unwrapDelta(delta: number): number {
  let result = delta
  while (result > Math.PI) result -= Math.PI * 2
  while (result <= -Math.PI) result += Math.PI * 2
  return result
}

export function rotationFromPointer(
  startRotation: number,
  center: Point,
  startPoint: Point,
  currentPoint: Point,
  shiftKey = false,
): number {
  if (!Number.isInteger(startRotation) || !Number.isFinite(startRotation)) throw new Error('start rotation must be an integer')
  assertFinitePoint(center)
  assertFinitePoint(startPoint)
  assertFinitePoint(currentPoint)
  const startAngle = angleFromCenter(center, startPoint)
  const currentAngle = angleFromCenter(center, currentPoint)
  const deltaUnits = Math.round(unwrapDelta(currentAngle - startAngle) * OOXML_UNITS_PER_RADIAN)
  const rotation = startRotation + deltaUnits
  return shiftKey
    ? Math.round(rotation / IMAGE_ROTATION_SNAP_STEP) * IMAGE_ROTATION_SNAP_STEP
    : rotation
}
