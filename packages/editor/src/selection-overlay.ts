import type { Rect } from '@ppt4ai/model'

export type SelectionHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface Point {
  x: number
  y: number
}

export interface SelectionHandleRect {
  name: SelectionHandle
  rect: Rect
}

export interface SelectionOverlayModel {
  border: Rect
  handles: SelectionHandleRect[]
}

export interface SelectionOverlayOptions {
  handleSize?: number
}

export interface ResizeOptions {
  minWidth?: number
  minHeight?: number
}

const handleNames: SelectionHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

function assertRect(bounds: Rect): void {
  if (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite)) throw new Error('bounds must be finite')
  if (bounds.w <= 0 || bounds.h <= 0) throw new Error('bounds must be positive')
}

function assertPoint(point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('pointer must be finite')
}

function handleCenter(bounds: Rect, handle: SelectionHandle): Point {
  const right = bounds.x + bounds.w
  const bottom = bounds.y + bounds.h
  const centerX = bounds.x + bounds.w / 2
  const centerY = bounds.y + bounds.h / 2
  switch (handle) {
    case 'nw': return { x: bounds.x, y: bounds.y }
    case 'n': return { x: centerX, y: bounds.y }
    case 'ne': return { x: right, y: bounds.y }
    case 'e': return { x: right, y: centerY }
    case 'se': return { x: right, y: bottom }
    case 's': return { x: centerX, y: bottom }
    case 'sw': return { x: bounds.x, y: bottom }
    case 'w': return { x: bounds.x, y: centerY }
  }
}

export function createSelectionOverlay(bounds: Rect, options: SelectionOverlayOptions = {}): SelectionOverlayModel {
  assertRect(bounds)
  const handleSize = options.handleSize ?? 8
  if (!Number.isFinite(handleSize) || handleSize <= 0) throw new Error('handleSize must be positive')
  const half = handleSize / 2
  return {
    border: { ...bounds },
    handles: handleNames.map((name) => {
      const center = handleCenter(bounds, name)
      return { name, rect: { x: center.x - half, y: center.y - half, w: handleSize, h: handleSize } }
    }),
  }
}

export function resizeBounds(startBounds: Rect, handle: SelectionHandle, pointer: Point, options: ResizeOptions = {}): Rect {
  assertRect(startBounds)
  assertPoint(pointer)
  if (!handleNames.includes(handle)) throw new Error(`unsupported handle: ${handle}`)
  const minWidth = options.minWidth ?? 1
  const minHeight = options.minHeight ?? 1
  if (!Number.isFinite(minWidth) || minWidth <= 0) throw new Error('minWidth must be positive')
  if (!Number.isFinite(minHeight) || minHeight <= 0) throw new Error('minHeight must be positive')

  const right = startBounds.x + startBounds.w
  const bottom = startBounds.y + startBounds.h
  const movesWest = handle.includes('w')
  const movesEast = handle.includes('e')
  const movesNorth = handle.includes('n')
  const movesSouth = handle.includes('s')
  const nextLeft = movesWest ? Math.min(pointer.x, right - minWidth) : startBounds.x
  const nextRight = movesEast ? Math.max(pointer.x, startBounds.x + minWidth) : right
  const nextTop = movesNorth ? Math.min(pointer.y, bottom - minHeight) : startBounds.y
  const nextBottom = movesSouth ? Math.max(pointer.y, startBounds.y + minHeight) : bottom
  return { x: nextLeft, y: nextTop, w: nextRight - nextLeft, h: nextBottom - nextTop }
}
