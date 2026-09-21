// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import type { ImeBridgeEvent, ImeInputBridge } from '@ppt4ai/text'
import { createImeLabController } from './ime-lab-controller'

describe('createImeLabController', () => {
  it('repaints composition updates and moves the input anchor', () => {
    const { bridge, bridgeFactory, emit } = fakeBridge()
    const paint = vi.fn(() => ({ caretRect: { x: 100, y: 80, width: 1, height: 28 }, visibleText: 'zhong' }))
    const controller = createImeLabController({
      canvas: document.createElement('canvas'),
      host: document.body,
      bridgeFactory,
      context: {} as CanvasRenderingContext2D,
      paint,
    })

    emit({ type: 'composition-start' })
    emit({ type: 'composition-update', text: 'zhong' })

    expect(paint).toHaveBeenCalledTimes(3)
    expect(bridge.setCaretRect).toHaveBeenLastCalledWith({ x: 100, y: 80, width: 1, height: 28 })
    expect(controller.getSnapshot()).toMatchObject({ compositionText: 'zhong', isComposing: true, caretOffset: 0, visibleText: 'zhong' })
  })

  it('clears composition and paints committed text exactly once', () => {
    const { bridge, bridgeFactory, emit } = fakeBridge()
    const paint = vi.fn((_: unknown, state: { committedText: string; compositionText: string }) => ({
      caretRect: { x: 0, y: 0, width: 1, height: 28 },
      visibleText: state.committedText + state.compositionText,
    }))
    const controller = createImeLabController({ canvas: document.createElement('canvas'), host: document.body, bridgeFactory, context: {} as CanvasRenderingContext2D, paint })

    emit({ type: 'composition-start' })
    emit({ type: 'composition-update', text: 'zhong' })
    emit({ type: 'composition-end', text: '中' })
    emit({ type: 'text-input', text: '中' })

    expect(controller.getSnapshot()).toEqual({ committedText: '中', compositionText: '', isComposing: false, caretOffset: 1, visibleText: '中' })
    expect(paint.mock.lastCall?.[1]).toEqual({ committedText: '中', compositionText: '', isComposing: false, caretOffset: 1 })
  })

  it('focuses the bridge when the canvas is clicked', () => {
    const { bridge, bridgeFactory, emit } = fakeBridge()
    const canvas = document.createElement('canvas')
    const context = {
      measureText: (text: string) => ({ width: [...text].length * 10 }),
    } as CanvasRenderingContext2D
    const paint = vi.fn((_: unknown, state: { committedText: string; caretOffset?: number }) => ({
      caretRect: { x: 40 + (state.caretOffset ?? 0) * 10, y: 40, width: 1, height: 28 },
      visibleText: state.committedText,
    }))
    const controller = createImeLabController({ canvas, host: document.body, bridgeFactory, context, paint })
    emit({ type: 'text-input', text: 'AB' })
    canvas.getBoundingClientRect = () => new DOMRect(100, 50, 960, 540)
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 150, clientY: 60, bubbles: true }))
    expect(bridge.focus).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().caretOffset).toBe(1)
    expect(paint).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ caretOffset: 1 }), expect.anything())
  })

  it('maps clicks on a soft-wrapped line to the committed offset', () => {
    const { bridgeFactory, emit } = fakeBridge()
    const canvas = document.createElement('canvas')
    const context = {
      measureText: (text: string) => ({ width: [...text].length * 10 }),
    } as CanvasRenderingContext2D
    const metrics = {
      canvasHeight: 540,
      canvasWidth: 960,
      devicePixelRatio: 1,
      font: '24px Arial',
      lineHeight: 28,
      origin: { x: 40, y: 40 },
      textBoxWidth: 25,
    }
    const controller = createImeLabController({
      canvas,
      host: document.body,
      bridgeFactory,
      context,
      metrics,
      paint: vi.fn((_: unknown, state: { committedText: string }) => ({
        caretRect: { x: 40, y: 40, width: 1, height: 28 },
        visibleText: state.committedText,
      })),
    })
    emit({ type: 'text-input', text: 'ABCD' })
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 960, 540)

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 51, clientY: 76, bubbles: true }))

    expect(controller.getSnapshot().caretOffset).toBe(3)
  })
})

function fakeBridge(): {
  bridge: ImeInputBridge
  bridgeFactory: (options: { onEvent: (event: ImeBridgeEvent) => void }) => ImeInputBridge
  emit: (event: ImeBridgeEvent) => void
} {
  let onEvent: ((event: ImeBridgeEvent) => void) | undefined
  const bridge: ImeInputBridge = {
    focus: vi.fn(),
    setCaretRect: vi.fn(),
    getCaretClientRect: vi.fn(() => new DOMRect()),
    destroy: vi.fn(),
  }
  return {
    bridge,
    bridgeFactory: (options) => {
      onEvent = options.onEvent
      return bridge
    },
    emit: (event) => onEvent?.(event),
  }
}
