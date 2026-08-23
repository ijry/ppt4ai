import { validateTextBody, type Fill, type TextBullet, type TextMarks } from '@ppt4ai/model'
import type { Mark, Node as PMNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { textEditorSchema } from './schema'

export type TextMarksPatch = {
  [K in keyof TextMarks]?: TextMarks[K] | undefined
}

export type TextMarkName = 'bold' | 'italic' | 'underline'

export type TextToggleState = boolean | 'mixed'

export interface TextFormattingState {
  readonly bold: TextToggleState
  readonly italic: TextToggleState
  readonly underline: TextToggleState
  readonly fontFamily?: string
  readonly fontSize?: number
  readonly color?: Fill
  readonly align?: 'left' | 'center' | 'right'
}

const markNames = new Set<keyof TextMarks>([
  'fontFamily',
  'fontSize',
  'bold',
  'italic',
  'underline',
  'color',
  'baseline',
])
const colorTypes = new Set(['srgb', 'scheme', 'preset', 'system', 'scrgb'])
const colorTransformTypes = new Set(['tint', 'shade', 'lumMod', 'lumOff', 'alpha', 'alphaMod', 'alphaOff'])

export function setTextMarks(state: EditorState, patch: TextMarksPatch): EditorState {
  validatePatch(patch)
  if (state.selection.empty) {
    const current = getMarksAtCursor(state)
    const merged = mergeMarks(current, patch)
    const storedMarks = marksToProseMirror(merged)
    if (sameStoredMarks(state.storedMarks, storedMarks)) return state
    return state.apply(state.tr.setStoredMarks(storedMarks))
  }

  const markType = textEditorSchema.marks.pptText
  const transaction = state.tr
  let changed = false
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, position) => {
    if (!node.isText || !node.text) return
    const from = Math.max(position, state.selection.from)
    const to = Math.min(position + node.nodeSize, state.selection.to)
    if (from >= to) return
    const current = marksFromProseMirror(node.marks)
    const merged = mergeMarks(current, patch)
    transaction.removeMark(from, to, markType)
    const nextMark = marksToProseMirror(merged)[0]
    if (nextMark) transaction.addMark(from, to, nextMark)
    changed = true
  })
  return changed ? state.apply(transaction) : state
}

export function toggleTextMark(state: EditorState, name: TextMarkName): EditorState {
  const current = getToggleValue(state, name)
  const value = name === 'underline' ? (current ? 'none' : 'single') : !current
  return setTextMarks(state, { [name]: value } as TextMarksPatch)
}

export function setTextAlignment(state: EditorState, align: 'left' | 'center' | 'right'): EditorState {
  if (align !== 'left' && align !== 'center' && align !== 'right') throw new TypeError('alignment must be left, center, or right')
  const transaction = state.tr
  let changed = false
  state.doc.descendants((node, position) => {
    if (node.type !== textEditorSchema.nodes.paragraph || !paragraphIntersectsSelection(state, node, position)) return
    if (node.attrs.align === align) return
    transaction.setNodeMarkup(position, undefined, { ...node.attrs, align })
    changed = true
  })
  return changed ? state.apply(transaction) : state
}

export function setTextBullet(state: EditorState, bullet: TextBullet): EditorState {
  validateBullet(bullet)
  const transaction = state.tr
  let changed = false
  state.doc.descendants((node, position) => {
    if (node.type !== textEditorSchema.nodes.paragraph || !paragraphIntersectsSelection(state, node, position)) return
    if (JSON.stringify(node.attrs.bullet) === JSON.stringify(bullet)) return
    transaction.setNodeMarkup(position, undefined, { ...node.attrs, bullet: structuredClone(bullet) })
    changed = true
  })
  return changed ? state.apply(transaction) : state
}

export function clearTextBullet(state: EditorState): EditorState {
  const transaction = state.tr
  let changed = false
  state.doc.descendants((node, position) => {
    if (node.type !== textEditorSchema.nodes.paragraph || !paragraphIntersectsSelection(state, node, position)) return
    if (node.attrs.bullet === null) return
    transaction.setNodeMarkup(position, undefined, { ...node.attrs, bullet: null })
    changed = true
  })
  return changed ? state.apply(transaction) : state
}

export function getTextFormattingState(state: EditorState): TextFormattingState {
  const markSets = collectMarkSets(state)
  const marks = markSets.length === 0 ? undefined : markSets
  const result: {
    bold: TextToggleState
    italic: TextToggleState
    underline: TextToggleState
    fontFamily?: string
    fontSize?: number
    color?: Fill
    align?: 'left' | 'center' | 'right'
  } = {
    bold: reduceBoolean(marks?.map((value) => value?.bold === true) ?? [false]),
    italic: reduceBoolean(marks?.map((value) => value?.italic === true) ?? [false]),
    underline: reduceBoolean(marks?.map((value) => value?.underline === 'single') ?? [false]),
  }
  const fontFamily = reduceScalar(marks?.map((value) => value?.fontFamily) ?? [undefined])
  const fontSize = reduceScalar(marks?.map((value) => value?.fontSize) ?? [undefined])
  const color = reduceScalar(marks?.map((value) => value?.color) ?? [undefined])
  if (fontFamily !== undefined) result.fontFamily = fontFamily
  if (fontSize !== undefined) result.fontSize = fontSize
  if (color !== undefined) result.color = structuredClone(color)
  const alignments = collectParagraphAlignments(state)
  const align = reduceScalar(alignments)
  if (align !== undefined) result.align = align
  return structuredClone(result)
}

function validatePatch(patch: TextMarksPatch): void {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('text mark patch must be an object')
  for (const [key, value] of Object.entries(patch)) {
    if (!markNames.has(key as keyof TextMarks)) throw new TypeError(`unsupported text mark: ${key}`)
    if (value === undefined) continue
    if (key === 'fontFamily' && (typeof value !== 'string' || value.trim().length === 0)) throw new TypeError('fontFamily must be non-empty')
    if (key === 'fontSize' && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) throw new TypeError('fontSize must be positive')
    if ((key === 'bold' || key === 'italic') && typeof value !== 'boolean') throw new TypeError(`${key} must be boolean`)
    if (key === 'underline' && value !== 'none' && value !== 'single') throw new TypeError('underline must be none or single')
    if (key === 'baseline' && (typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError('baseline must be finite')
    if (key === 'color' && !isFill(value)) throw new TypeError('color must be a valid fill')
  }
}

function validateBullet(bullet: TextBullet): void {
  const validation = validateTextBody({ paragraphs: [{ runs: [{ text: 'x' }], attrs: { bullet } }] })
  if (!validation.valid) throw new TypeError(validation.errors.join('; '))
}

function isFill(value: unknown): value is Fill {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const fill = value as Record<string, unknown>
  if (!fill.color || typeof fill.color !== 'object' || Array.isArray(fill.color)) return false
  const color = fill.color as Record<string, unknown>
  if (typeof color.type !== 'string' || !colorTypes.has(color.type) || typeof color.v !== 'string' || color.v.length === 0) return false
  if (color.transforms === undefined) return true
  if (!Array.isArray(color.transforms)) return false
  return color.transforms.every((transform) => {
    if (!transform || typeof transform !== 'object' || Array.isArray(transform)) return false
    const entry = transform as Record<string, unknown>
    return typeof entry.type === 'string' && colorTransformTypes.has(entry.type)
      && typeof entry.value === 'number' && Number.isFinite(entry.value)
      && entry.value >= 0 && entry.value <= 100000
  })
}

function mergeMarks(current: TextMarks | undefined, patch: TextMarksPatch): TextMarks | undefined {
  const merged: TextMarks = structuredClone(current ?? {})
  for (const [key, value] of Object.entries(patch) as Array<[keyof TextMarks, TextMarks[keyof TextMarks] | undefined]>) {
    if (value === undefined) delete merged[key]
    else Object.assign(merged, { [key]: structuredClone(value) })
  }
  return Object.keys(merged).length === 0 ? undefined : merged
}

function marksFromProseMirror(marks: readonly Mark[]): TextMarks | undefined {
  const mark = marks.find((candidate) => candidate.type === textEditorSchema.marks.pptText)
  return mark?.attrs.marks === null || mark?.attrs.marks === undefined ? undefined : structuredClone(mark.attrs.marks) as TextMarks
}

function marksToProseMirror(marks: TextMarks | undefined): readonly Mark[] {
  return marks === undefined ? [] : [textEditorSchema.marks.pptText.create({ marks: structuredClone(marks) })]
}

function getMarksAtCursor(state: EditorState): TextMarks | undefined {
  return marksFromProseMirror(state.storedMarks ?? state.selection.$from.marks())
}

function collectMarkSets(state: EditorState): Array<TextMarks | undefined> {
  if (state.selection.empty) return [getMarksAtCursor(state)]
  const values: Array<TextMarks | undefined> = []
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (node.isText && node.text) values.push(marksFromProseMirror(node.marks))
  })
  return values
}

function collectParagraphAlignments(state: EditorState): Array<'left' | 'center' | 'right' | undefined> {
  const paragraphs: Array<'left' | 'center' | 'right' | undefined> = []
  state.doc.descendants((node, position) => {
    if (node.type === textEditorSchema.nodes.paragraph && paragraphIntersectsSelection(state, node, position)) paragraphs.push(node.attrs.align ?? undefined)
  })
  return paragraphs
}

function paragraphIntersectsSelection(state: EditorState, paragraph: PMNode, position: number): boolean {
  if (state.selection.empty) return state.selection.$from.parent === paragraph
  const start = position + 1
  const end = position + paragraph.nodeSize - 1
  return state.selection.from < end && state.selection.to > start
}

function reduceBoolean(values: boolean[]): TextToggleState {
  if (values.every((value) => value === values[0])) return values[0] ?? false
  return 'mixed'
}

function reduceScalar<T>(values: Array<T | undefined>): T | undefined {
  if (values.length === 0 || values.some((value) => JSON.stringify(value) !== JSON.stringify(values[0]))) return undefined
  return values[0] === undefined ? undefined : structuredClone(values[0])
}

function getToggleValue(state: EditorState, name: TextMarkName): boolean {
  const values: boolean[] = []
  if (state.selection.empty) {
    const marks = getMarksAtCursor(state)
    return name === 'underline' ? marks?.underline === 'single' : marks?.[name] === true
  }
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (!node.isText || !node.text) return
    const marks = marksFromProseMirror(node.marks)
    values.push(name === 'underline' ? marks?.underline === 'single' : marks?.[name] === true)
  })
  return values.length > 0 && values.every(Boolean)
}

function sameStoredMarks(left: readonly Mark[] | null, right: readonly Mark[]): boolean {
  if ((left?.length ?? 0) !== right.length) return false
  return JSON.stringify(left?.map((mark) => ({ type: mark.type.name, attrs: mark.attrs })) ?? [])
    === JSON.stringify(right.map((mark) => ({ type: mark.type.name, attrs: mark.attrs })))
}
