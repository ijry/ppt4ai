import { describe, expect, it } from 'vitest'
import type { ImeSessionState } from '@ppt4ai/text'
import { paintImeFrame, type PaintMetrics } from './canvas-painter'

describe('paintImeFrame', () => {
  it('paints committed and composition text with an underline and caret', () => {
    const context = createFakeContext()
    const state: ImeSessionState = {
      committedText: '中',
      compositionText: 'zhong',
      isComposing: true,
      caretOffset: 1,
    }

    const result = paintImeFrame(context, state, metrics())

    expect(context.fillTextCalls).toEqual([
      { text: '中', x: 40, y: 64, color: '#111827' },
      { text: 'zhong', x: 64, y: 64, color: '#2563eb' },
    ])
    expect(context.strokeCalls).toEqual([{ x: 64, endX: 124, y: 66, lineWidth: 2 }])
    expect(context.fillRectCalls.at(-1)).toEqual({ x: 124, y: 40, width: 1, height: 28, color: '#111827' })
    expect(result).toEqual({
      caretRect: { x: 124, y: 40, width: 1, height: 28 },
      visibleText: '中zhong',
    })
  })

  it('does not draw composition underline when no composition exists', () => {
    const context = createFakeContext()
    const result = paintImeFrame(context, { committedText: '中', compositionText: '', isComposing: false, caretOffset: 1 }, metrics())

    expect(context.strokeCalls).toHaveLength(0)
    expect(result.caretRect).toEqual({ x: 64, y: 40, width: 1, height: 28 })
  })

  it('paints line breaks and places the caret on the active line', () => {
    const context = createFakeContext()
    const result = paintImeFrame(context, {
      committedText: 'A\nB',
      compositionText: '',
      isComposing: false,
      caretOffset: 2,
    }, metrics())

    expect(context.fillTextCalls).toEqual([
      { text: 'A', x: 40, y: 64, color: '#111827' },
      { text: 'B', x: 40, y: 92, color: '#111827' },
    ])
    expect(result.caretRect).toEqual({ x: 40, y: 68, width: 1, height: 28 })
    expect(result.visibleText).toBe('A\nB')
  })
})

function metrics(): PaintMetrics {
  return {
    canvasHeight: 540,
    canvasWidth: 960,
    devicePixelRatio: 1,
    font: '24px Arial',
    lineHeight: 28,
    textBoxWidth: 920,
    origin: { x: 40, y: 40 },
  }
}

function createFakeContext(): CanvasRenderingContext2D & {
  fillTextCalls: Array<{ text: string; x: number; y: number; color: string }>
  fillRectCalls: Array<{ x: number; y: number; width: number; height: number; color: string }>
  strokeCalls: Array<{ x: number; endX: number; y: number; lineWidth: number }>
} {
  const fillTextCalls: Array<{ text: string; x: number; y: number; color: string }> = []
  const fillRectCalls: Array<{ x: number; y: number; width: number; height: number; color: string }> = []
  const strokeCalls: Array<{ x: number; endX: number; y: number; lineWidth: number }> = []
  let fillStyle = ''
  let lineWidth = 1
  let startX = 0
  let startY = 0
  let endX = 0
  let endY = 0
  const context = {
    canvas: { width: 960, height: 540 },
    get fillStyle() { return fillStyle },
    set fillStyle(value: string) { fillStyle = value },
    set font(_value: string) {},
    measureText(text: string) {
      const widths: Record<string, number> = { '中': 24, z: 12, h: 12, o: 12, n: 12, g: 12, A: 12, B: 12 }
      return { width: [...text].reduce((total, character) => total + (widths[character] ?? 0), 0) }
    },
    fillText(text: string, x: number, y: number) { fillTextCalls.push({ text, x, y, color: fillStyle }) },
    fillRect(x: number, y: number, width: number, height: number) { fillRectCalls.push({ x, y, width, height, color: fillStyle }) },
    clearRect() {},
    beginPath() {},
    moveTo(x: number, y: number) { startX = x; startY = y },
    lineTo(x: number, y: number) { endX = x; endY = y },
    stroke() { strokeCalls.push({ x: startX, endX, y: startY, lineWidth }) },
    set lineWidth(value: number) { lineWidth = value },
    get lineWidth() { return lineWidth },
    save() {},
    restore() {},
    setTransform() {},
  } as unknown as CanvasRenderingContext2D & {
    fillTextCalls: Array<{ text: string; x: number; y: number; color: string }>
    fillRectCalls: Array<{ x: number; y: number; width: number; height: number; color: string }>
    strokeCalls: Array<{ x: number; endX: number; y: number; lineWidth: number }>
  }
  context.fillTextCalls = fillTextCalls
  context.fillRectCalls = fillRectCalls
  context.strokeCalls = strokeCalls
  return context
}
