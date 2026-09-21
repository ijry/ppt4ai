import type { ImeSessionState, ScreenPoint, ScreenRect } from '@ppt4ai/text'

export interface PaintMetrics {
  readonly canvasWidth: number
  readonly canvasHeight: number
  readonly devicePixelRatio: number
  readonly font: string
  readonly lineHeight: number
  readonly origin: ScreenPoint
  readonly textBoxWidth: number
}

export interface TextLayoutRun {
  readonly text: string
  readonly x: number
  readonly kind: 'committed' | 'composition'
}

export interface TextLayoutLine {
  readonly text: string
  readonly y: number
  readonly runs: readonly TextLayoutRun[]
}

export interface ImeTextLayout {
  readonly lines: readonly TextLayoutLine[]
  readonly caretRect: ScreenRect
  readonly visibleText: string
}

interface MutableLine {
  text: string
  readonly y: number
  readonly runs: Array<{ text: string; x: number; kind: TextLayoutRun['kind'] }>
  readonly boundaries: Array<{ x: number; offset: number }>
}

interface LayoutResult extends ImeTextLayout {
  readonly hitLines: readonly MutableLine[]
}

type LayoutToken =
  | {
      readonly character: string
      readonly kind: TextLayoutRun['kind']
      readonly advancesOffset: boolean
    }
  | {
      readonly character: ''
      readonly kind: 'caret'
      readonly advancesOffset: false
    }

export function layoutImeText(
  context: CanvasRenderingContext2D,
  state: ImeSessionState,
  metrics: PaintMetrics,
): ImeTextLayout {
  return createLayout(context, state, metrics)
}

export function hitTestImeText(
  context: CanvasRenderingContext2D,
  state: ImeSessionState,
  point: ScreenPoint,
  metrics: PaintMetrics,
): number {
  const layout = createLayout(context, state, metrics)
  const lineIndex = Math.min(
    layout.hitLines.length - 1,
    Math.max(0, Math.floor((point.y - metrics.origin.y) / metrics.lineHeight)),
  )
  const line = layout.hitLines[lineIndex]
  if (!line) return 0

  for (let index = 0; index < line.boundaries.length - 1; index += 1) {
    const current = line.boundaries[index]
    const next = line.boundaries[index + 1]
    if (current && next && point.x < (current.x + next.x) / 2) {
      return current.offset
    }
  }
  return line.boundaries.at(-1)?.offset ?? 0
}

function createLayout(
  context: CanvasRenderingContext2D,
  state: ImeSessionState,
  metrics: PaintMetrics,
): LayoutResult {
  context.font = metrics.font
  const committed = [...state.committedText]
  const caretOffset = Math.min(Math.max(0, state.caretOffset), committed.length)
  const tokens: LayoutToken[] = [
    ...committed.slice(0, caretOffset).map(committedToken),
    ...[...state.compositionText].map(compositionToken),
    { character: '', kind: 'caret', advancesOffset: false },
    ...committed.slice(caretOffset).map(committedToken),
  ]
  const lines: MutableLine[] = []
  let line = createLine(metrics.origin.y, metrics.origin.x, 0)
  let x = metrics.origin.x
  let committedOffset = 0
  let caretRect: ScreenRect | undefined
  const maxX = metrics.origin.x + Math.max(1, metrics.textBoxWidth)

  for (const token of tokens) {
    if (token.kind === 'caret') {
      caretRect = caretAt(x, line.y, metrics)
      continue
    }
    if (token.character === '\n') {
      if (token.advancesOffset) committedOffset += 1
      lines.push(line)
      line = createLine(line.y + metrics.lineHeight, metrics.origin.x, committedOffset)
      x = metrics.origin.x
      continue
    }

    const width = context.measureText(token.character).width
    if (x > metrics.origin.x && x + width > maxX) {
      lines.push(line)
      line = createLine(line.y + metrics.lineHeight, metrics.origin.x, committedOffset)
      x = metrics.origin.x
    }

    appendRun(line, token, x)
    line.text += token.character
    x += width
    if (token.advancesOffset) committedOffset += 1
    line.boundaries.push({ x, offset: committedOffset })
  }

  lines.push(line)
  if (!caretRect) caretRect = caretAt(x, line.y, metrics)

  return {
    lines,
    hitLines: lines,
    caretRect,
    visibleText: committed.slice(0, caretOffset).join('') + state.compositionText + committed.slice(caretOffset).join(''),
  }
}

function createLine(y: number, x: number, offset: number): MutableLine {
  return { text: '', y, runs: [], boundaries: [{ x, offset }] }
}

function appendRun(
  line: MutableLine,
  token: Extract<LayoutToken, { readonly kind: TextLayoutRun['kind'] }>,
  x: number,
): void {
  const previous = line.runs.at(-1)
  if (previous?.kind === token.kind) {
    previous.text += token.character
    return
  }
  line.runs.push({ text: token.character, x, kind: token.kind })
}

function caretAt(x: number, y: number, metrics: PaintMetrics): ScreenRect {
  return { x, y, width: 1, height: metrics.lineHeight }
}

function committedToken(character: string): LayoutToken {
  return { character, kind: 'committed', advancesOffset: true }
}

function compositionToken(character: string): LayoutToken {
  return { character, kind: 'composition', advancesOffset: false }
}
