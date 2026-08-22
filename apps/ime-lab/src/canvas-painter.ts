import type { ImeSessionState, ScreenRect } from '@ppt4ai/text'
import { layoutImeText, type PaintMetrics } from './text-layout'

export type { PaintMetrics } from './text-layout'

export interface PaintResult {
  readonly caretRect: ScreenRect
  readonly visibleText: string
}

export function paintImeFrame(
  context: CanvasRenderingContext2D,
  state: ImeSessionState,
  metrics: PaintMetrics,
): PaintResult {
  const ratio = Math.max(1, metrics.devicePixelRatio)
  context.canvas.width = Math.round(metrics.canvasWidth * ratio)
  context.canvas.height = Math.round(metrics.canvasHeight * ratio)
  context.setTransform(ratio, 0, 0, ratio, 0, 0)

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, metrics.canvasWidth, metrics.canvasHeight)
  context.font = metrics.font
  const layout = layoutImeText(context, state, metrics)

  for (const line of layout.lines) {
    const baseline = line.y + fontSize(metrics.font)
    for (const run of line.runs) {
      context.fillStyle = run.kind === 'composition' ? '#2563eb' : '#111827'
      context.fillText(run.text, run.x, baseline)
      if (run.kind === 'composition') {
        context.strokeStyle = '#2563eb'
        context.lineWidth = 2
        context.beginPath()
        context.moveTo(run.x, baseline + 2)
        context.lineTo(run.x + context.measureText(run.text).width, baseline + 2)
        context.stroke()
      }
    }
  }

  const caretRect = layout.caretRect
  context.fillStyle = '#111827'
  context.fillRect(caretRect.x, caretRect.y, caretRect.width, caretRect.height)

  return {
    caretRect,
    visibleText: layout.visibleText,
  }
}

function fontSize(font: string): number {
  const match = /(?:^|\s)(\d+(?:\.\d+)?)px(?:\s|$)/u.exec(font)
  return match ? Number(match[1]) : 24
}
