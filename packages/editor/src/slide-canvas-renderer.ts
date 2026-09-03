import type { AssetAdapter, Rect, ResolvedColor, ResolvedGradient } from '@ppt4ai/model'
import { gradientAxis } from '@ppt4ai/geometry'
import type { SceneGraph, SceneImageNode, SceneNode } from '@ppt4ai/render'
import { paintShapeNode } from './shape-painting'
import { paintTableNode } from './table-painting'
import { paintTextNode } from './text-painting'
import { createImageNodeLoader, type DecodedImage, type ImageDecoder, type ImageLoadOutcome } from './image-canvas-renderer'
import { paintImageNode } from './image-painting'

const EMU_PER_CSS_PIXEL = 914400 / 96
const EMU_TO_CSS_PIXEL = 96 / 914400

export interface SlideCanvasViewport {
  zoom?: number
  devicePixelRatio?: number
  signal?: AbortSignal
}

export interface SlideCanvasRenderIssue {
  nodeId: string
  kind: SceneNode['kind']
  code: 'draw-failed' | 'missing-asset' | 'decode-failed'
  message: string
}

export interface SlideCanvasRenderResult {
  drawnNodeIds: string[]
  skippedNodeIds: string[]
  issues: SlideCanvasRenderIssue[]
  cssWidth: number
  cssHeight: number
}

export interface SlideCanvasRenderer {
  render(scene: SceneGraph, context: CanvasRenderingContext2D, viewport?: SlideCanvasViewport): Promise<SlideCanvasRenderResult>
  clearCache(): void
  dispose(): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function imageIssue(node: SceneImageNode, outcome: Exclude<ImageLoadOutcome, { status: 'ready' }>): SlideCanvasRenderIssue {
  return { nodeId: node.id, kind: node.kind, code: outcome.code, message: outcome.message }
}

function drawNode(context: CanvasRenderingContext2D, node: SceneNode, scale: number): void {
  const mapping = { scale, offsetX: 0, offsetY: 0 }
  if (node.kind === 'shape') paintShapeNode(context, node, mapping)
  else if (node.kind === 'text') paintTextNode(context, node, mapping)
  else if (node.kind === 'table') paintTableNode(context, node, mapping)
  else throw new Error('image nodes require decoded image data')
}

/**
 * Images take a target rect rather than a page mapping, so their EMU bounds have to be mapped here.
 * The thumbnail worker does the same; before this the slide renderer handed over raw EMU, leaving
 * images 9525 times larger than every other node.
 */
function mapBounds(bounds: Rect, scale: number): Rect {
  return { x: bounds.x * scale, y: bounds.y * scale, w: bounds.w * scale, h: bounds.h * scale }
}

function colorStyle(color: ResolvedColor): { style: string; alpha: number } {
  return { style: `#${color.rgb.toUpperCase()}`, alpha: color.alpha / 100000 }
}

function rgbaStyle(hex: string, alpha: number): string {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

/**
 * Background gradients use the same axis formula but over the page bounds, not a shape's bounds.
 * The mapped bounds are already in CSS pixels, matching where the shape painters work.
 */
function createBackgroundGradient(
  context: CanvasRenderingContext2D,
  gradient: ResolvedGradient,
  mappedBounds: Rect,
): CanvasGradient {
  const axis = gradientAxis(mappedBounds, gradient.angle ?? 0, gradient.scaled ?? false)
  const canvasGradient = context.createLinearGradient(axis.from.x, axis.from.y, axis.to.x, axis.to.y)
  for (const stop of gradient.stops) {
    const { style, alpha } = colorStyle(stop.color)
    const offset = Math.min(1, Math.max(0, stop.pos / 100000))
    canvasGradient.addColorStop(offset, alpha >= 1 ? style : rgbaStyle(style, alpha))
  }
  return canvasGradient
}


export function createSlideCanvasRenderer(options: { adapter: AssetAdapter; decoder?: ImageDecoder }): SlideCanvasRenderer {
  const imageLoader = createImageNodeLoader(options)
  let disposed = false

  return {
    async render(scene, context, viewport = {}): Promise<SlideCanvasRenderResult> {
      if (disposed) throw new Error('renderer is disposed')
      const zoom = viewport.zoom ?? 1
      const devicePixelRatio = viewport.devicePixelRatio ?? 1
      const cssWidth = scene.page.w / EMU_PER_CSS_PIXEL * zoom
      const cssHeight = scene.page.h / EMU_PER_CSS_PIXEL * zoom
      const result: SlideCanvasRenderResult = { drawnNodeIds: [], skippedNodeIds: [], issues: [], cssWidth, cssHeight }
      if (viewport.signal?.aborted) return result

      const canvas = context.canvas
      canvas.width = Math.round(cssWidth * devicePixelRatio)
      canvas.height = Math.round(cssHeight * devicePixelRatio)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      // Every painter maps EMU to CSS pixels through `scale`, so the transform only has to carry
      // CSS pixels to the device pixel backing store. Scaling here as well would apply zoom twice.
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)

      const scale = EMU_TO_CSS_PIXEL * zoom
      // The page fill goes down first, in the same space the node painters draw in.
      if (scene.background) {
        const mappedBounds = { x: 0, y: 0, w: scene.page.w * scale, h: scene.page.h * scale }
        if (scene.backgroundGradient) {
          context.fillStyle = createBackgroundGradient(context, scene.backgroundGradient, mappedBounds)
        } else {
          context.fillStyle = `#${scene.background.rgb.toUpperCase()}`
          context.globalAlpha = scene.background.alpha / 100000
        }
        context.fillRect(0, 0, mappedBounds.w, mappedBounds.h)
        context.globalAlpha = 1
      }
      for (const node of scene.nodes) {
        if (viewport.signal?.aborted) break
        try {
          if (node.kind === 'image') {
            const outcome = await imageLoader.load(node)
            if (outcome.status === 'failed') {
              result.skippedNodeIds.push(node.id)
              result.issues.push(imageIssue(node, outcome))
              continue
            }
            paintImageNode(context, node, outcome.image, mapBounds(node.bounds, scale))
          } else {
            drawNode(context, node, scale)
          }
          result.drawnNodeIds.push(node.id)
        } catch (error) {
          result.skippedNodeIds.push(node.id)
          result.issues.push({ nodeId: node.id, kind: node.kind, code: 'draw-failed', message: errorMessage(error) })
        }
      }
      return result
    },
    clearCache: () => imageLoader.clearCache(),
    dispose: () => {
      disposed = true
      imageLoader.dispose()
    },
  }
}

export type { DecodedImage, ImageDecoder }
