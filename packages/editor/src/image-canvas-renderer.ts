import type { AssetAdapter, ImageMimeType } from '@ppt4ai/model'
import type { SceneGraph, SceneImageNode } from '@ppt4ai/render'

const EMU_PER_CSS_PIXEL = 914400 / 96

export interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  close?: () => void
}

export type ImageDecoder = (data: Uint8Array, mimeType?: ImageMimeType) => Promise<DecodedImage>

export interface ImageViewport {
  zoom?: number
  devicePixelRatio?: number
  signal?: AbortSignal
}

export interface ImageRenderIssue {
  nodeId: string
  assetId: string
  code: 'missing-asset' | 'decode-failed' | 'draw-failed'
  message: string
}

export interface ImageRenderResult {
  drawnNodeIds: string[]
  skippedNodeIds: string[]
  issues: ImageRenderIssue[]
}

export interface ImageCanvasRendererOptions {
  adapter: AssetAdapter
  decoder?: ImageDecoder
  zoom?: number
  devicePixelRatio?: number
}

export interface ImageCanvasRenderer {
  render(
    scene: SceneGraph,
    context: CanvasRenderingContext2D,
    viewport?: ImageViewport,
  ): Promise<ImageRenderResult>
  clearCache(): void
  dispose(): void
}

function unavailableDecoder(): Promise<DecodedImage> {
  return Promise.reject(new Error('No browser image decoder configured'))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function renderIssue(node: SceneImageNode, code: ImageRenderIssue['code'], error: unknown): ImageRenderIssue {
  return {
    nodeId: node.id,
    assetId: node.assetId,
    code,
    message: errorMessage(error),
  }
}

export function createImageCanvasRenderer(options: ImageCanvasRendererOptions): ImageCanvasRenderer {
  const decoder = options.decoder ?? (() => unavailableDecoder())
  let disposed = false

  return {
    async render(scene, context, viewport = {}): Promise<ImageRenderResult> {
      if (disposed) throw new Error('Image canvas renderer is disposed')

      const zoom = viewport.zoom ?? options.zoom ?? 1
      const devicePixelRatio = viewport.devicePixelRatio ?? options.devicePixelRatio ?? 1
      const cssWidth = scene.page.w / EMU_PER_CSS_PIXEL * zoom
      const cssHeight = scene.page.h / EMU_PER_CSS_PIXEL * zoom
      const canvas = context.canvas

      canvas.width = Math.round(cssWidth * devicePixelRatio)
      canvas.height = Math.round(cssHeight * devicePixelRatio)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`

      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      const backingScale = devicePixelRatio * 96 / 914400 * zoom
      context.setTransform(backingScale, 0, 0, backingScale, 0, 0)

      const imageNodes = scene.nodes.filter((node): node is SceneImageNode => node.kind === 'image')
      const loaded = await Promise.all(imageNodes.map(async (node) => {
        if (viewport.signal?.aborted) return { node, image: undefined, issue: undefined }
        try {
          const data = await options.adapter.get(node.assetId)
          if (!data) return { node, image: undefined, issue: renderIssue(node, 'missing-asset', `Asset not found: ${node.assetId}`) }
          const image = await decoder(data, node.metadata?.mimeType)
          return { node, image, issue: undefined }
        } catch (error) {
          return { node, image: undefined, issue: renderIssue(node, 'decode-failed', error) }
        }
      }))

      const result: ImageRenderResult = { drawnNodeIds: [], skippedNodeIds: [], issues: [] }
      for (const entry of loaded) {
        if (viewport.signal?.aborted) break
        if (!entry.image) {
          if (entry.issue) {
            result.skippedNodeIds.push(entry.node.id)
            result.issues.push(entry.issue)
          }
          continue
        }
        try {
          context.drawImage(entry.image.source, entry.node.bounds.x, entry.node.bounds.y, entry.node.bounds.w, entry.node.bounds.h)
          result.drawnNodeIds.push(entry.node.id)
        } catch (error) {
          result.skippedNodeIds.push(entry.node.id)
          result.issues.push(renderIssue(entry.node, 'draw-failed', error))
        }
      }
      return result
    },

    clearCache(): void {},

    dispose(): void {
      disposed = true
    },
  }
}
