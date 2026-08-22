export type PresetGeometry = 'rect' | 'roundRect' | 'ellipse' | 'triangle'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Color {
  type: 'srgb' | 'scheme' | 'preset' | 'system' | 'scrgb'
  v: string
  alpha?: number
}

export interface Fill {
  color: Color
}

export interface ShapeElement {
  id: string
  kind: 'shape'
  preset: PresetGeometry
  bounds: Rect
  fill?: Fill
  stroke?: Fill
}

export interface TextElement {
  id: string
  kind: 'text'
  bounds: Rect
  text: string
}

export type Element = ShapeElement | TextElement

export interface Slide {
  id: string
  elementIds: string[]
}

export interface Ppt4aiDocument {
  format: 'ppt4ai'
  version: 1
  id: string
  page: {
    w: number
    h: number
  }
  slides: Record<string, Slide>
  elements: Record<string, Element>
  slideOrder: string[]
}

export type DocumentValidation =
  | { valid: true }
  | { valid: false; errors: string[] }

export function validateDocument(value: Ppt4aiDocument): DocumentValidation {
  const errors: string[] = []

  if (value.format !== 'ppt4ai') errors.push('format must be ppt4ai')
  if (value.version !== 1) errors.push('version must be 1')
  if (!Number.isFinite(value.page.w) || value.page.w <= 0) errors.push('page.w must be positive')
  if (!Number.isFinite(value.page.h) || value.page.h <= 0) errors.push('page.h must be positive')

  const slideOrderIds = new Set<string>()
  for (const slideId of value.slideOrder) {
    if (slideOrderIds.has(slideId)) errors.push(`slideOrder references duplicate slide: ${slideId}`)
    slideOrderIds.add(slideId)
    if (!value.slides[slideId]) errors.push(`slideOrder references missing slide: ${slideId}`)
  }

  for (const [slideId, slide] of Object.entries(value.slides)) {
    if (slide.id !== slideId) errors.push(`slide key does not match id: ${slideId}`)
    const elementIds = new Set<string>()
    for (const elementId of slide.elementIds) {
      if (elementIds.has(elementId)) errors.push(`slide ${slideId} references duplicate element: ${elementId}`)
      elementIds.add(elementId)
      if (!value.elements[elementId]) errors.push(`slide ${slideId} references missing element: ${elementId}`)
    }
  }

  for (const [elementId, element] of Object.entries(value.elements)) {
    if (element.id !== elementId) errors.push(`element key does not match id: ${elementId}`)
    if (element.bounds.w <= 0 || element.bounds.h <= 0) errors.push(`element ${elementId} bounds must be positive`)
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}
