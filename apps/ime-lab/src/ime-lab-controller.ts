import {
  createImeInputBridge,
  initialImeSessionState,
  reduceImeSession,
  type ImeBridgeEvent,
  type ImeInputBridge,
  type ImeInputBridgeOptions,
  type ImeSessionState,
  type ScreenPoint,
} from '@ppt4ai/text'
import { paintImeFrame, type PaintMetrics, type PaintResult } from './canvas-painter'
import { hitTestImeText } from './text-layout'

export interface ImeLabSnapshot extends ImeSessionState {
  readonly visibleText: string
}

export interface ImeLabProbe {
  getSnapshot(): ImeLabSnapshot
  getInputRect(): DOMRectReadOnly
  setCaretOrigin(point: ScreenPoint): void
}

export interface ImeLabController extends ImeLabProbe {
  destroy(): void
}

export interface ImeLabControllerOptions {
  readonly canvas: HTMLCanvasElement
  readonly host: HTMLElement
  readonly bridgeFactory?: (options: ImeInputBridgeOptions) => ImeInputBridge
  readonly context?: CanvasRenderingContext2D
  readonly metrics?: PaintMetrics
  readonly paint?: typeof paintImeFrame
}

const defaultMetrics: PaintMetrics = {
  canvasWidth: 960,
  canvasHeight: 540,
  devicePixelRatio: 1,
  font: '24px Arial, sans-serif',
  lineHeight: 28,
  origin: { x: 40, y: 40 },
  textBoxWidth: 880,
}

export function createImeLabController(options: ImeLabControllerOptions): ImeLabController {
  const contextOrNull = options.context ?? options.canvas.getContext('2d')
  if (!contextOrNull) {
    throw new Error('Canvas 2D context is unavailable')
  }
  const context: CanvasRenderingContext2D = contextOrNull

  options.host.append(options.canvas)
  const paint = options.paint ?? paintImeFrame
  let metrics = options.metrics ?? {
    ...defaultMetrics,
    devicePixelRatio: window.devicePixelRatio || 1,
  }
  let state = initialImeSessionState
  let paintResult: PaintResult = { caretRect: { x: 0, y: 0, width: 1, height: 1 }, visibleText: '' }
  let destroyed = false

  const bridgeFactory = options.bridgeFactory ?? createImeInputBridge
  const bridge = bridgeFactory({ host: options.host, onEvent: handleBridgeEvent })

  const handleCanvasClick = (event: MouseEvent): void => {
    if (destroyed) return
    const point = toCanvasPoint(options.canvas, event, metrics)
    const caretOffset = hitTestImeText(context, state, point, metrics)
    state = { ...state, caretOffset }
    if (!state.committedText) {
      metrics = { ...metrics, origin: point }
    }
    repaint()
    bridge.focus()
  }
  options.canvas.addEventListener('click', handleCanvasClick)
  repaint()

  return {
    getSnapshot(): ImeLabSnapshot {
      return { ...state, visibleText: paintResult.visibleText }
    },

    getInputRect(): DOMRectReadOnly {
      return bridge.getCaretClientRect()
    },

    setCaretOrigin(point: ScreenPoint): void {
      if (destroyed) return
      metrics = { ...metrics, origin: point }
      repaint()
    },

    destroy(): void {
      if (destroyed) return
      destroyed = true
      options.canvas.removeEventListener('click', handleCanvasClick)
      bridge.destroy()
    },
  }

  function handleBridgeEvent(event: ImeBridgeEvent): void {
    if (destroyed) return
    state = reduceImeSession(state, event)
    repaint()
  }

  function repaint(): void {
    paintResult = paint(context, state, metrics)
    bridge.setCaretRect(toViewportRect(options.canvas, paintResult.caretRect, metrics))
  }
}

function toViewportRect(
  canvas: HTMLCanvasElement,
  rect: PaintResult['caretRect'],
  metrics: PaintMetrics,
): PaintResult['caretRect'] {
  const bounds = canvas.getBoundingClientRect()
  const scaleX = bounds.width > 0 ? bounds.width / metrics.canvasWidth : 1
  const scaleY = bounds.height > 0 ? bounds.height / metrics.canvasHeight : 1
  return {
    x: bounds.left + rect.x * scaleX,
    y: bounds.top + rect.y * scaleY,
    width: Math.max(1, rect.width * scaleX),
    height: Math.max(1, rect.height * scaleY),
  }
}

function toCanvasPoint(canvas: HTMLCanvasElement, event: MouseEvent, metrics: PaintMetrics): ScreenPoint {
  const bounds = canvas.getBoundingClientRect()
  return {
    x: (event.clientX - bounds.left) * (metrics.canvasWidth / Math.max(1, bounds.width)),
    y: (event.clientY - bounds.top) * (metrics.canvasHeight / Math.max(1, bounds.height)),
  }
}

declare global {
  interface Window {
    __IME_LAB__: ImeLabProbe
  }
}
