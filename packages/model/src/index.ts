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

export interface TextMarks {
  fontFamily?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: 'none' | 'single'
  color?: Fill
  baseline?: number
}

export interface TextRun {
  text: string
  marks?: TextMarks
}

export type TextBulletScheme = 'arabic' | 'alphaLower' | 'alphaUpper'

export type TextBullet =
  | { type: 'char'; char: string; fontFamily?: string }
  | { type: 'autoNum'; scheme: TextBulletScheme; startAt?: number }

export interface TextParagraphAttrs {
  align?: 'left' | 'center' | 'right'
  level?: number
  indent?: number
  marginLeft?: number
  lineSpacing?: number
  spaceBefore?: number
  spaceAfter?: number
  bullet?: TextBullet
}

export interface TextParagraph {
  runs: TextRun[]
  attrs?: TextParagraphAttrs
}

export type TextAutofit =
  | { type: 'none' }
  | { type: 'shrink'; minFontScale?: number }
  | { type: 'resize'; maxHeight?: number }

export interface TextBodyProperties {
  insets?: { left: number; top: number; right: number; bottom: number }
  verticalAlign?: 'top' | 'middle' | 'bottom'
  wrap?: 'square' | 'none'
  autofit?: TextAutofit
}

export interface TextBody {
  bodyPr?: TextBodyProperties
  paragraphs: TextParagraph[]
}

export interface ShapeElement {
  id: string
  kind: 'shape'
  preset: PresetGeometry
  bounds: Rect
  fill?: Fill
  stroke?: Fill
  placeholder?: string
}

export interface TextElement {
  id: string
  kind: 'text'
  bounds: Rect
  text?: string
  body?: TextBody
  fill?: Fill
  stroke?: Fill
  placeholder?: string
}

export interface GroupElement {
  id: string
  kind: 'group'
  bounds: Rect
  childIds: string[]
}

export type Element = ShapeElement | TextElement | GroupElement

export interface ElementDefaults {
  bounds?: Rect
  preset?: PresetGeometry
  fill?: Fill
  stroke?: Fill
  text?: string
  body?: TextBody
}

export interface SlideLayout {
  id: string
  masterId: string
  defaults?: Record<string, ElementDefaults>
}

export interface SlideMaster {
  id: string
  defaults?: Record<string, ElementDefaults>
}

export interface Slide {
  id: string
  elementIds: string[]
  layoutId?: string
  masterId?: string
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
  layouts?: Record<string, SlideLayout>
  masters?: Record<string, SlideMaster>
  source?: {
    entries: Record<string, string>
  }
}

function elementKey(element: Element): string {
  return element.kind === 'group' ? element.id : element.placeholder ?? element.id
}

function findDefaults(element: Element, layout?: SlideLayout, master?: SlideMaster): ElementDefaults[] {
  const key = elementKey(element)
  const defaults: ElementDefaults[] = []
  const masterDefaults = master?.defaults?.[key]
  const layoutDefaults = layout?.defaults?.[key]
  if (masterDefaults) defaults.push(masterDefaults)
  if (layoutDefaults) defaults.push(layoutDefaults)
  return defaults
}

export function resolveInheritedElement(element: Element, layout?: SlideLayout, master?: SlideMaster): Element {
  const resolved = Object.assign({}, ...findDefaults(element, layout, master), element)
  return {
    ...element,
    ...resolved,
    id: element.id,
    kind: element.kind,
  } as Element
}

export type DocumentValidation =
  | { valid: true }
  | { valid: false; errors: string[] }

export type TextModelValidation =
  | { valid: true }
  | { valid: false; errors: string[] }

const textAlignments = new Set(['left', 'center', 'right'])
const verticalAlignments = new Set(['top', 'middle', 'bottom'])
const wraps = new Set(['square', 'none'])
const underlines = new Set(['none', 'single'])
const bulletSchemes = new Set(['arabic', 'alphaLower', 'alphaUpper'])

function validateFiniteNumber(value: unknown, path: string, errors: string[], predicate: (value: number) => boolean, message: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || !predicate(value)) errors.push(`${path} ${message}`)
}

function validateTextMarks(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const marks = value as Record<string, unknown>
  if ('fontFamily' in marks && typeof marks.fontFamily !== 'string') errors.push(`${path}.fontFamily must be a string`)
  if ('fontSize' in marks) validateFiniteNumber(marks.fontSize, `${path}.fontSize`, errors, (number) => number > 0, 'must be positive')
  for (const key of ['bold', 'italic']) {
    if (key in marks && typeof marks[key] !== 'boolean') errors.push(`${path}.${key} must be boolean`)
  }
  if ('underline' in marks && (typeof marks.underline !== 'string' || !underlines.has(marks.underline))) errors.push(`${path}.underline must be none or single`)
  if ('baseline' in marks) validateFiniteNumber(marks.baseline, `${path}.baseline`, errors, () => true, 'must be finite')
}

function validateTextParagraph(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const paragraph = value as Record<string, unknown>
  if (!Array.isArray(paragraph.runs)) {
    errors.push(`${path}.runs must be an array`)
  } else {
    paragraph.runs.forEach((run, index) => {
      const runPath = `${path}.runs[${index}]`
      if (!run || typeof run !== 'object' || Array.isArray(run)) {
        errors.push(`${runPath} must be an object`)
        return
      }
      const runValue = run as Record<string, unknown>
      if (typeof runValue.text !== 'string' || runValue.text.length === 0) errors.push(`${runPath}.text must be non-empty`)
      if ('marks' in runValue && runValue.marks !== undefined) validateTextMarks(runValue.marks, `${runPath}.marks`, errors)
    })
  }
  if (!('attrs' in paragraph) || paragraph.attrs === undefined) return
  if (!paragraph.attrs || typeof paragraph.attrs !== 'object' || Array.isArray(paragraph.attrs)) {
    errors.push(`${path}.attrs must be an object`)
    return
  }
  const attrs = paragraph.attrs as Record<string, unknown>
  if ('align' in attrs && (typeof attrs.align !== 'string' || !textAlignments.has(attrs.align))) errors.push(`${path}.attrs.align must be left, center, or right`)
  if ('level' in attrs) {
    validateFiniteNumber(attrs.level, `${path}.attrs.level`, errors, (number) => number >= 0 && Number.isInteger(number), 'must be non-negative integer')
  }
  for (const key of ['indent', 'marginLeft', 'spaceBefore', 'spaceAfter']) {
    if (key in attrs) validateFiniteNumber(attrs[key], `${path}.attrs.${key}`, errors, (number) => number >= 0, 'must be non-negative')
  }
  if ('lineSpacing' in attrs) validateFiniteNumber(attrs.lineSpacing, `${path}.attrs.lineSpacing`, errors, (number) => number > 0, 'must be positive')
  if ('bullet' in attrs && attrs.bullet !== undefined) validateTextBullet(attrs.bullet, `${path}.attrs.bullet`, errors)
}

function validateTextBullet(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const bullet = value as Record<string, unknown>
  if (bullet.type === 'char') {
    if (typeof bullet.char !== 'string' || Array.from(bullet.char).length !== 1) errors.push(`${path}.char must contain exactly one Unicode code point`)
    if ('fontFamily' in bullet && (typeof bullet.fontFamily !== 'string' || bullet.fontFamily.length === 0)) errors.push(`${path}.fontFamily must be non-empty`)
    return
  }
  if (bullet.type === 'autoNum') {
    if (typeof bullet.scheme !== 'string' || !bulletSchemes.has(bullet.scheme)) errors.push(`${path}.scheme must be arabic, alphaLower, or alphaUpper`)
    if ('startAt' in bullet && (typeof bullet.startAt !== 'number' || !Number.isFinite(bullet.startAt) || !Number.isInteger(bullet.startAt) || bullet.startAt <= 0)) errors.push(`${path}.startAt must be a positive integer`)
    return
  }
  errors.push(`${path}.type must be char or autoNum`)
}

export function validateTextBody(value: unknown): TextModelValidation {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['body must be an object'] }
  const body = value as Record<string, unknown>
  if (!Array.isArray(body.paragraphs)) errors.push('paragraphs must be an array')
  else {
    if (body.paragraphs.length === 0) errors.push('paragraphs must be non-empty')
    body.paragraphs.forEach((paragraph, index) => validateTextParagraph(paragraph, `paragraphs[${index}]`, errors))
  }
  if ('bodyPr' in body && body.bodyPr !== undefined) {
    if (!body.bodyPr || typeof body.bodyPr !== 'object' || Array.isArray(body.bodyPr)) errors.push('bodyPr must be an object')
    else {
      const bodyPr = body.bodyPr as Record<string, unknown>
      if ('insets' in bodyPr) {
        if (!bodyPr.insets || typeof bodyPr.insets !== 'object' || Array.isArray(bodyPr.insets)) errors.push('bodyPr.insets must be an object')
        else {
          const insets = bodyPr.insets as Record<string, unknown>
          for (const key of ['left', 'top', 'right', 'bottom']) validateFiniteNumber(insets[key], `bodyPr.insets.${key}`, errors, (number) => number >= 0, 'must be non-negative')
        }
      }
      if ('verticalAlign' in bodyPr && (typeof bodyPr.verticalAlign !== 'string' || !verticalAlignments.has(bodyPr.verticalAlign))) errors.push('bodyPr.verticalAlign must be top, middle, or bottom')
      if ('wrap' in bodyPr && (typeof bodyPr.wrap !== 'string' || !wraps.has(bodyPr.wrap))) errors.push('bodyPr.wrap must be square or none')
      if ('autofit' in bodyPr) {
        if (!bodyPr.autofit || typeof bodyPr.autofit !== 'object' || Array.isArray(bodyPr.autofit)) errors.push('bodyPr.autofit must be an object')
        else {
          const autofit = bodyPr.autofit as Record<string, unknown>
          if (autofit.type !== 'none' && autofit.type !== 'shrink' && autofit.type !== 'resize') errors.push('bodyPr.autofit.type must be none, shrink, or resize')
          if (autofit.type === 'shrink' && 'minFontScale' in autofit) validateFiniteNumber(autofit.minFontScale, 'bodyPr.autofit.minFontScale', errors, (number) => number >= 1 && number <= 100000, 'must be between 1 and 100000')
          if (autofit.type === 'resize' && 'maxHeight' in autofit) validateFiniteNumber(autofit.maxHeight, 'bodyPr.autofit.maxHeight', errors, (number) => number > 0, 'must be positive')
        }
      }
    }
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}

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
    if (element.kind === 'group') {
      const childIds = new Set<string>()
      for (const childId of element.childIds) {
        if (childIds.has(childId)) errors.push(`group ${elementId} references duplicate child: ${childId}`)
        childIds.add(childId)
        if (!value.elements[childId]) errors.push(`group ${elementId} references missing child: ${childId}`)
      }
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const path: string[] = []
  const visitGroup = (groupId: string): void => {
    if (visiting.has(groupId)) {
      const cycleStart = path.indexOf(groupId)
      errors.push(`group cycle detected: ${[...path.slice(cycleStart), groupId].join(' -> ')}`)
      return
    }
    if (visited.has(groupId)) return
    const element = value.elements[groupId]
    if (!element || element.kind !== 'group') return
    visiting.add(groupId)
    path.push(groupId)
    for (const childId of element.childIds) {
      const child = value.elements[childId]
      if (child?.kind === 'group') visitGroup(childId)
    }
    path.pop()
    visiting.delete(groupId)
    visited.add(groupId)
  }
  for (const [elementId, element] of Object.entries(value.elements)) {
    if (element.kind === 'group') visitGroup(elementId)
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}
