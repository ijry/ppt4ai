import {
  mapTextPosition,
  mapTextSelection,
  textPositionAtPoint,
  type ProseMirrorNode,
  type ScreenPoint,
  type ScreenRect,
  type TextEditorSelection,
  type TextLayout,
} from '@ppt4ai/text'

export interface TextViewportTransform {
  originX: number
  originY: number
  scale: number
}

export interface TextEditorInteraction {
  caret: ScreenRect
  selection: ScreenRect[]
}

interface LayoutRect {
  x: number
  y: number
  width: number
  height: number
}

function assertTransform(transform: TextViewportTransform): void {
  if (![transform.originX, transform.originY, transform.scale].every(Number.isFinite)) {
    throw new Error('transform must be finite')
  }
  if (transform.scale <= 0) throw new Error('transform scale must be positive')
}

export function layoutRectToScreen(rect: LayoutRect, transform: TextViewportTransform): ScreenRect {
  assertTransform(transform)
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) throw new Error('rect must be finite')
  return {
    x: transform.originX + rect.x * transform.scale,
    y: transform.originY + rect.y * transform.scale,
    width: Math.max(1, rect.width * transform.scale),
    height: Math.max(1, rect.height * transform.scale),
  }
}

export function screenPointToLayout(point: ScreenPoint, transform: TextViewportTransform): ScreenPoint {
  assertTransform(transform)
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('point must be finite')
  return {
    x: (point.x - transform.originX) / transform.scale,
    y: (point.y - transform.originY) / transform.scale,
  }
}

export function createTextInteraction(
  layout: TextLayout,
  document: ProseMirrorNode,
  selection: TextEditorSelection,
  transform: TextViewportTransform,
): TextEditorInteraction {
  return {
    caret: layoutRectToScreen(mapTextPosition(layout, document, selection.head), transform),
    selection: mapTextSelection(layout, document, selection.anchor, selection.head)
      .map((rect) => layoutRectToScreen(rect, transform)),
  }
}

export function textPositionAtScreenPoint(
  layout: TextLayout,
  document: ProseMirrorNode,
  point: ScreenPoint,
  transform: TextViewportTransform,
): number {
  return textPositionAtPoint(layout, document, screenPointToLayout(point, transform))
}
