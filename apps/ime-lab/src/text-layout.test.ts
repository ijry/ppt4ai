import { describe, expect, it } from 'vitest'
import type { ImeSessionState } from '@ppt4ai/text'
import { hitTestImeText, layoutImeText, type PaintMetrics } from './text-layout'

describe('layoutImeText', () => {
  it('soft-wraps measured text without changing visible text', () => {
    const state: ImeSessionState = {
      committedText: 'ABCD',
      compositionText: '',
      isComposing: false,
      caretOffset: 4,
    }

    const layout = layoutImeText(context(), state, metrics(25))

    expect(layout.lines.map((line) => line.text)).toEqual(['AB', 'CD'])
    expect(layout.visibleText).toBe('ABCD')
    expect(layout.caretRect).toEqual({ x: 60, y: 68, width: 1, height: 28 })
  })

  it('uses explicit newlines as hard breaks and maps clicks to offsets', () => {
    const state: ImeSessionState = {
      committedText: 'AB\nCD',
      compositionText: '',
      isComposing: false,
      caretOffset: 5,
    }
    const metricsValue = metrics(100)
    const layout = layoutImeText(context(), state, metricsValue)

    expect(layout.lines.map((line) => line.text)).toEqual(['AB', 'CD'])
    expect(hitTestImeText(context(), state, { x: 41, y: 76 }, metricsValue)).toBe(3)
  })
})

function metrics(textBoxWidth: number): PaintMetrics {
  return {
    canvasHeight: 540,
    canvasWidth: 960,
    devicePixelRatio: 1,
    font: '24px Arial',
    lineHeight: 28,
    origin: { x: 40, y: 40 },
    textBoxWidth,
  }
}

function context(): CanvasRenderingContext2D {
  return {
    measureText: (text: string) => ({ width: [...text].length * 10 }),
  } as CanvasRenderingContext2D
}
