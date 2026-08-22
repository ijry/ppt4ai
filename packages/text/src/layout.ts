import type { Rect, TextBody, TextMarks, TextParagraph } from '@ppt4ai/model'
import { DEFAULT_FONT_SIZE, measureText } from './measure'

export interface TextLayoutRun {
  text: string
  x: number
  width: number
  marks?: TextMarks
}

export interface TextLayoutLine {
  paragraphIndex: number
  x: number
  y: number
  width: number
  height: number
  runs: TextLayoutRun[]
}

export interface TextLayout {
  bounds: Rect
  lines: TextLayoutLine[]
  fontScale: number
  overflow: boolean
  contentBounds: Rect
}

export interface TextLayoutInput {
  bounds: Rect
  body: TextBody
}

interface Token {
  text: string
  width: number
  marks?: TextMarks
  space: boolean
  cjk: boolean
}

interface PendingLine {
  paragraphIndex: number
  baseX: number
  availableWidth: number
  align: 'left' | 'center' | 'right'
  height: number
  tokens: Token[]
}

const DEFAULT_FONT_SCALE = 100000
const DEFAULT_LINE_SPACING = 100000

function isCjkOrFullWidth(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint > 0xffff
    || (codePoint >= 0x1100 && codePoint <= 0x11ff)
    || (codePoint >= 0x2e80 && codePoint <= 0x9fff)
    || (codePoint >= 0xac00 && codePoint <= 0xd7af)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xff01 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
}

function marksEqual(left: TextMarks | undefined, right: TextMarks | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function paragraphTokens(paragraph: TextParagraph, fontScale: number): Token[] {
  return paragraph.runs.flatMap((run) => [...run.text].map((character) => {
    const token: Token = {
      text: character,
      width: measureText(character, run.marks, fontScale),
      space: character === ' ',
      cjk: isCjkOrFullWidth(character),
    }
    if (run.marks) token.marks = structuredClone(run.marks)
    return token
  }))
}

function groupTokens(tokens: Token[]): Token[][] {
  const groups: Token[][] = []
  let latinGroup: Token[] = []
  const flushLatin = (): void => {
    if (latinGroup.length > 0) groups.push(latinGroup)
    latinGroup = []
  }
  for (const token of tokens) {
    if (token.space || token.cjk) {
      flushLatin()
      groups.push([token])
    } else {
      latinGroup.push(token)
    }
  }
  flushLatin()
  return groups
}

function tokensWidth(tokens: Token[]): number {
  return tokens.reduce((width, token) => width + token.width, 0)
}

function trimTrailingSpaces(tokens: Token[]): Token[] {
  let end = tokens.length
  while (end > 0 && tokens[end - 1]?.space) end -= 1
  return tokens.slice(0, end)
}

function wrapTokens(tokens: Token[], availableWidth: number, wrap: 'square' | 'none'): Token[][] {
  if (tokens.length === 0) return [[]]
  if (wrap === 'none') return [tokens]
  const lines: Token[][] = []
  let current: Token[] = []
  let currentWidth = 0
  const emit = (): void => {
    const trimmed = trimTrailingSpaces(current)
    if (trimmed.length > 0) lines.push(trimmed)
    current = []
    currentWidth = 0
  }
  for (const group of groupTokens(tokens)) {
    const groupWidth = tokensWidth(group)
    if (group[0]?.space) {
      if (current.length > 0 && currentWidth + groupWidth <= availableWidth) {
        current.push(...group)
        currentWidth += groupWidth
      }
      continue
    }
    if (groupWidth <= availableWidth && currentWidth + groupWidth <= availableWidth) {
      current.push(...group)
      currentWidth += groupWidth
      continue
    }
    if (current.length > 0) emit()
    if (groupWidth <= availableWidth) {
      current.push(...group)
      currentWidth = groupWidth
      continue
    }
    for (const token of group) {
      if (current.length > 0 && currentWidth + token.width > availableWidth) emit()
      current.push(token)
      currentWidth += token.width
      if (availableWidth <= 0 || currentWidth >= availableWidth) emit()
    }
  }
  if (current.length > 0) emit()
  return lines.length > 0 ? lines : [[]]
}

function lineHeight(paragraph: TextParagraph, fontScale: number): number {
  const maxFontSize = paragraph.runs.reduce((size, run) => Math.max(size, run.marks?.fontSize ?? DEFAULT_FONT_SIZE), DEFAULT_FONT_SIZE)
  const spacing = paragraph.attrs?.lineSpacing ?? DEFAULT_LINE_SPACING
  return Math.round(maxFontSize * 12700 * fontScale / DEFAULT_FONT_SCALE * spacing / DEFAULT_LINE_SPACING)
}

function createRuns(tokens: Token[], lineX: number): TextLayoutRun[] {
  const runs: TextLayoutRun[] = []
  let x = lineX
  for (const token of tokens) {
    const previous = runs[runs.length - 1]
    if (previous && marksEqual(previous.marks, token.marks)) {
      previous.text += token.text
      previous.width += token.width
    } else {
      const run: TextLayoutRun = { text: token.text, x, width: token.width }
      if (token.marks) run.marks = structuredClone(token.marks)
      runs.push(run)
    }
    x += token.width
  }
  return runs
}

function positionLine(pending: PendingLine, y: number): TextLayoutLine {
  const width = tokensWidth(pending.tokens)
  const alignmentOffset = pending.align === 'center'
    ? Math.round((pending.availableWidth - width) / 2)
    : pending.align === 'right' ? pending.availableWidth - width : 0
  const x = pending.baseX + alignmentOffset
  return {
    paragraphIndex: pending.paragraphIndex,
    x,
    y,
    width,
    height: pending.height,
    runs: createRuns(pending.tokens, x),
  }
}

function layoutAtScale(input: TextLayoutInput, fontScale: number): TextLayout {
  const insets = input.body.bodyPr?.insets ?? { left: 0, top: 0, right: 0, bottom: 0 }
  const wrap = input.body.bodyPr?.wrap ?? 'square'
  const pendingLines: Array<PendingLine & { y: number }> = []
  let cursorY = input.bounds.y + insets.top
  for (const [paragraphIndex, paragraph] of input.body.paragraphs.entries()) {
    const attrs = paragraph.attrs
    const marginLeft = attrs?.marginLeft ?? 0
    const indent = attrs?.indent ?? 0
    const availableWidth = Math.max(0, input.bounds.w - insets.left - insets.right - marginLeft - indent)
    const height = lineHeight(paragraph, fontScale)
    cursorY += attrs?.spaceBefore ?? 0
    for (const tokens of wrapTokens(paragraphTokens(paragraph, fontScale), availableWidth, wrap)) {
      pendingLines.push({
        paragraphIndex,
        baseX: input.bounds.x + insets.left + marginLeft + indent,
        availableWidth,
        align: attrs?.align ?? 'left',
        height,
        tokens,
        y: cursorY,
      })
      cursorY += height
    }
    cursorY += attrs?.spaceAfter ?? 0
  }
  const contentHeight = cursorY - input.bounds.y - insets.top
  const availableHeight = Math.max(0, input.bounds.h - insets.top - insets.bottom)
  const verticalAlign = input.body.bodyPr?.verticalAlign ?? 'top'
  const remainingHeight = Math.max(0, availableHeight - contentHeight)
  const verticalOffset = verticalAlign === 'middle'
    ? Math.round(remainingHeight / 2)
    : verticalAlign === 'bottom' ? remainingHeight : 0
  const lines = pendingLines.map((line) => positionLine(line, line.y + verticalOffset))
  const contentX = lines.length > 0 ? Math.min(...lines.map((line) => line.x)) : input.bounds.x + insets.left
  const contentWidth = lines.length > 0 ? Math.max(...lines.map((line) => line.x + line.width)) - contentX : 0
  return {
    bounds: { ...input.bounds },
    lines,
    fontScale,
    overflow: contentHeight > availableHeight,
    contentBounds: {
      x: contentX,
      y: input.bounds.y + insets.top + verticalOffset,
      w: contentWidth,
      h: contentHeight,
    },
  }
}

export function layoutText(input: TextLayoutInput): TextLayout {
  const autofit = input.body.bodyPr?.autofit ?? { type: 'none' }
  const initial = layoutAtScale(input, DEFAULT_FONT_SCALE)
  if (autofit.type === 'none' || !initial.overflow) return initial
  if (autofit.type === 'shrink') {
    const minimum = autofit.minFontScale ?? 60000
    let low = minimum
    let high = DEFAULT_FONT_SCALE
    let best = layoutAtScale(input, minimum)
    while (low <= high) {
      const candidateScale = Math.floor((low + high) / 2)
      const candidate = layoutAtScale(input, candidateScale)
      if (candidate.overflow) {
        high = candidateScale - 1
      } else {
        best = candidate
        low = candidateScale + 1
      }
    }
    return best
  }
  const insets = input.body.bodyPr?.insets ?? { left: 0, top: 0, right: 0, bottom: 0 }
  const requiredHeight = initial.contentBounds.h + insets.top + insets.bottom
  const expandedHeight = Math.max(input.bounds.h, requiredHeight)
  const height = autofit.maxHeight === undefined ? expandedHeight : Math.min(expandedHeight, autofit.maxHeight)
  return layoutAtScale({ ...input, bounds: { ...input.bounds, h: height } }, DEFAULT_FONT_SCALE)
}
