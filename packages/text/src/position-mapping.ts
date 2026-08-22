import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { measureText } from './measure'
import type { TextLayout, TextLayoutLine, TextLayoutRun } from './layout'

export interface TextPoint {
  x: number
  y: number
}

export interface TextCaretRect {
  x: number
  y: number
  width: number
  height: number
}

export interface TextSelectionRect extends TextCaretRect {
  from: number
  to: number
}

interface ParagraphInfo {
  start: number
  end: number
  text: string
}

interface LineInfo {
  line: TextLayoutLine
  paragraph: ParagraphInfo
  start: number
  end: number
  text: string
}

interface CharacterBoundary {
  position: number
  x: number
}

function paragraphInfos(document: ProseMirrorNode): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = []
  let start = 1
  document.forEach((paragraph) => {
    const text = paragraph.textContent
    paragraphs.push({ start, end: start + text.length, text })
    start += paragraph.nodeSize
  })
  return paragraphs
}

function lineText(line: TextLayoutLine): string {
  return line.runs.map((run) => run.text).join('')
}

function isSkippableSpace(character: string | undefined): boolean {
  return character === ' '
}

function createLineInfos(layout: TextLayout, document: ProseMirrorNode): LineInfo[] {
  const paragraphs = paragraphInfos(document)
  const offsets = paragraphs.map(() => 0)
  return layout.lines.map((line) => {
    const paragraph = paragraphs[line.paragraphIndex]
    if (!paragraph) throw new Error(`layout references missing paragraph: ${line.paragraphIndex}`)
    const text = lineText(line)
    let offset = offsets[line.paragraphIndex] ?? 0
    while (offset < paragraph.text.length && isSkippableSpace(paragraph.text[offset])) offset += 1
    const match = text.length === 0 ? offset : paragraph.text.indexOf(text, offset)
    if (match < 0) throw new Error(`layout line text does not match paragraph ${line.paragraphIndex}`)
    const startOffset = match
    const endOffset = startOffset + text.length
    offsets[line.paragraphIndex] = endOffset
    return { line, paragraph, start: paragraph.start + startOffset, end: paragraph.start + endOffset, text }
  })
}

function boundariesForLine(info: LineInfo, fontScale: number): CharacterBoundary[] {
  const boundaries: CharacterBoundary[] = [{ position: info.start, x: info.line.x }]
  let position = info.start
  let x = info.line.x
  for (const run of info.line.runs) {
    for (const character of [...run.text]) {
      position += character.length
      x += measureText(character, run.marks, fontScale)
      boundaries.push({ position, x })
    }
  }
  return boundaries
}

function clampPosition(document: ProseMirrorNode, position: number): number {
  if (!Number.isFinite(position)) return 1
  return Math.min(Math.max(1, Math.trunc(position)), Math.max(1, document.content.size - 1))
}

function nearestLine(infos: LineInfo[], position: number): LineInfo {
  return infos.reduce((best, info) => {
    const bestDistance = position < best.start ? best.start - position : position > best.end ? position - best.end : 0
    const distance = position < info.start ? info.start - position : position > info.end ? position - info.end : 0
    return distance < bestDistance ? info : best
  }, infos[0]!)
}

function boundaryForPosition(info: LineInfo, position: number, fontScale: number): CharacterBoundary {
  const boundaries = boundariesForLine(info, fontScale)
  return boundaries.reduce((best, boundary) => {
    const bestDistance = Math.abs(best.position - position)
    const distance = Math.abs(boundary.position - position)
    return distance < bestDistance ? boundary : best
  }, boundaries[0]!)
}

export function mapTextPosition(layout: TextLayout, document: ProseMirrorNode, position: number): TextCaretRect {
  const infos = createLineInfos(layout, document)
  if (infos.length === 0) return { x: layout.bounds.x, y: layout.bounds.y, width: 1, height: 1 }
  const clamped = clampPosition(document, position)
  const info = nearestLine(infos, clamped)
  const boundary = boundaryForPosition(info, clamped, layout.fontScale)
  return { x: boundary.x, y: info.line.y, width: 1, height: info.line.height }
}

export function mapTextSelection(
  layout: TextLayout,
  document: ProseMirrorNode,
  anchor: number,
  head: number,
): TextSelectionRect[] {
  const from = clampPosition(document, Math.min(anchor, head))
  const to = clampPosition(document, Math.max(anchor, head))
  if (from === to) return []
  return createLineInfos(layout, document).flatMap((info) => {
    const start = Math.max(from, info.start)
    const end = Math.min(to, info.end)
    if (start >= end) return []
    const startBoundary = boundaryForPosition(info, start, layout.fontScale)
    const endBoundary = boundaryForPosition(info, end, layout.fontScale)
    return [{ x: startBoundary.x, y: info.line.y, width: Math.max(0, endBoundary.x - startBoundary.x), height: info.line.height, from: start, to: end }]
  })
}

export function textPositionAtPoint(layout: TextLayout, document: ProseMirrorNode, point: TextPoint): number {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('point must be finite')
  const infos = createLineInfos(layout, document)
  if (infos.length === 0) return 1
  const info = infos.reduce((best, candidate) => {
    const bestCenter = best.line.y + best.line.height / 2
    const candidateCenter = candidate.line.y + candidate.line.height / 2
    return Math.abs(candidateCenter - point.y) < Math.abs(bestCenter - point.y) ? candidate : best
  }, infos[0]!)
  const boundaries = boundariesForLine(info, layout.fontScale)
  return boundaries.reduce((best, boundary) => {
    const bestDistance = Math.abs(best.x - point.x)
    const distance = Math.abs(boundary.x - point.x)
    return distance < bestDistance ? boundary : best
  }, boundaries[0]!).position
}
