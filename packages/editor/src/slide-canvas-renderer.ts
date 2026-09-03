import type { AssetAdapter } from '@ppt4ai/model'
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
      context.setTransform(devicePixelRatio * EMU_TO_CSS_PIXEL * zoom, 0, 0, devicePixelRatio * EMU_TO_CSS_PIXEL * zoom, 0, 0)

      const scale = EMU_TO_CSS_PIXEL * zoom
      // The page fill goes down first, in the same space the node painters draw in.
      if (scene.background) {
        context.fillStyle = `#${scene.background.rgb.toUpperCase()}`
        context.globalAlpha = scene.background.alpha / 100000
        context.fillRect(0, 0, scene.page.w * scale, scene.page.h * scale)
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
            paintImageNode(context, node, outcome.image, node.bounds)
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
