import {
  validateTextBody,
  type TextBody,
  type TextMarks,
  type TextParagraphAttrs,
} from '@ppt4ai/model'
import type { Mark, Node as PMNode } from 'prosemirror-model'
import { textEditorSchema } from './schema'

const paragraphAttrNames: readonly (keyof TextParagraphAttrs)[] = [
  'align',
  'level',
  'indent',
  'marginLeft',
  'lineSpacing',
  'spaceBefore',
  'spaceAfter',
  'bullet',
]

export class TextEditorModelError extends Error {
  readonly path?: string
  readonly errors: readonly string[]

  constructor(errors: string[], path?: string) {
    super(errors.join('; '))
    this.name = 'TextEditorModelError'
    this.errors = [...errors]
    if (path !== undefined) this.path = path
  }
}

export function textBodyToProseMirror(body: TextBody): PMNode {
  const validation = validateTextBody(body)
  if (!validation.valid) throw new TextEditorModelError(validation.errors, validation.errors[0]?.split(' ')[0])
  const clone = structuredClone(body)
  return textEditorSchema.node(
    'doc',
    { bodyPr: clone.bodyPr ?? null },
    clone.paragraphs.map((paragraph) => textEditorSchema.node(
      'paragraph',
      paragraphAttrsToNodeAttrs(paragraph.attrs),
      paragraph.runs.map((run) => {
        const marks = run.marks === undefined ? [] : [textEditorSchema.marks.pptText.create({ marks: structuredClone(run.marks) })]
        return textEditorSchema.text(run.text, marks)
      }),
    )),
  )
}

export function proseMirrorToTextBody(document: PMNode): TextBody {
  if (document.type.schema !== textEditorSchema) throw new TextEditorModelError(['document must use textEditorSchema'], 'document')
  if (document.type.name !== 'doc') throw new TextEditorModelError(['document must be a doc node'], 'document')
  const paragraphs: TextBody['paragraphs'] = []
  document.forEach((paragraph, paragraphIndex) => {
    if (paragraph.type.name !== 'paragraph') throw new TextEditorModelError([`paragraphs[${paragraphIndex}] must be a paragraph node`], `paragraphs[${paragraphIndex}]`)
    const runs: TextBody['paragraphs'][number]['runs'] = []
    paragraph.forEach((child, childIndex) => {
      if (child.type.name !== 'text') throw new TextEditorModelError([`paragraphs[${paragraphIndex}].content[${childIndex}] must be a text node`], `paragraphs[${paragraphIndex}].content[${childIndex}]`)
      const marks = marksFromNode(child.marks, paragraphIndex, childIndex)
      const previous = runs.at(-1)
      if (previous && deepEqual(previous.marks, marks)) previous.text += child.text ?? ''
      else runs.push(marks === undefined ? { text: child.text ?? '' } : { text: child.text ?? '', marks })
    })
    paragraphs.push({ runs, ...(hasAttrs(paragraph.attrs) ? { attrs: attrsFromNodeAttrs(paragraph.attrs) } : {}) })
  })
  const body: TextBody = {
    ...(document.attrs.bodyPr === null ? {} : { bodyPr: structuredClone(document.attrs.bodyPr) }),
    paragraphs,
  }
  const validation = validateTextBody(body)
  if (!validation.valid) throw new TextEditorModelError(validation.errors, validation.errors[0]?.split(' ')[0])
  return structuredClone(body)
}

function paragraphAttrsToNodeAttrs(attrs: TextParagraphAttrs | undefined): Record<string, unknown> {
  return Object.fromEntries(paragraphAttrNames.map((name) => [name, attrs?.[name] ?? null]))
}

function attrsFromNodeAttrs(attrs: Record<string, unknown>): TextParagraphAttrs {
  const result: TextParagraphAttrs = {}
  for (const name of paragraphAttrNames) {
    if (attrs[name] !== null && attrs[name] !== undefined) Object.assign(result, { [name]: attrs[name] })
  }
  return result
}

function hasAttrs(attrs: Record<string, unknown>): boolean {
  return paragraphAttrNames.some((name) => attrs[name] !== null && attrs[name] !== undefined)
}

function marksFromNode(marks: readonly Mark[], paragraphIndex: number, childIndex: number): TextMarks | undefined {
  if (marks.length === 0) return undefined
  if (marks.length !== 1 || marks[0]?.type.name !== 'pptText') throw new TextEditorModelError([`paragraphs[${paragraphIndex}].content[${childIndex}] has unsupported marks`], `paragraphs[${paragraphIndex}].content[${childIndex}]`)
  const value = marks[0].attrs.marks
  return value === null || value === undefined ? undefined : structuredClone(value) as TextMarks
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
