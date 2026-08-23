import type { AssetAdapter, ImageCrop, ImageEffect, ImageMimeType, PresetGeometry } from '@ppt4ai/model'
import type { SceneGraph, SceneImageNode } from '@ppt4ai/render'
import { decodeBrowserImage } from './browser-image-decoder'

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

type LoadOutcome =
  | { status: 'ready'; image: DecodedImage }
  | { status: 'failed'; code: 'missing-asset' | 'decode-failed'; message: string }

interface CacheEntry {
  promise: Promise<LoadOutcome>
  image?: DecodedImage
  closed: boolean
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

function cropSource(
  image: DecodedImage,
  crop: ImageCrop | undefined,
): [number, number, number, number] | undefined {
  if (!crop) return undefined
  const left = crop.left ?? 0
  const top = crop.top ?? 0
  const right = crop.right ?? 0
  const bottom = crop.bottom ?? 0
  const values = [left, top, right, bottom]
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100000)) return undefined

  const widthRatio = 1 - (left + right) / 100000
  const heightRatio = 1 - (top + bottom) / 100000
  if (widthRatio <= 0 || heightRatio <= 0) return undefined

  return [
    image.width * left / 100000,
    image.height * top / 100000,
    image.width * widthRatio,
    image.height * heightRatio,
  ]
}

function applyMask(
  context: CanvasRenderingContext2D,
  preset: PresetGeometry,
  width: number,
  height: number,
): void {
  const halfWidth = width / 2
  const halfHeight = height / 2
  context.beginPath()
  if (preset === 'ellipse') {
    context.ellipse(0, 0, halfWidth, halfHeight, 0, 0, Math.PI * 2)
  } else if (preset === 'triangle') {
    context.moveTo(0, -halfHeight)
    context.lineTo(halfWidth, halfHeight)
    context.lineTo(-halfWidth, halfHeight)
    context.closePath()
  } else if (preset === 'roundRect') {
    const radius = Math.min(width, height) * 0.1
    context.roundRect(-halfWidth, -halfHeight, width, height, radius)
  } else {
    context.rect(-halfWidth, -halfHeight, width, height)
  }
  context.clip()
}

function applyEffects(context: CanvasRenderingContext2D, effects: ImageEffect[] | undefined): void {
  for (const effect of effects ?? []) {
    if (effect.type === 'alphaModFix') {
      context.globalAlpha *= effect.amount / 100000
    } else if (effect.type === 'grayscl') {
      context.filter = 'grayscale(1)'
    }
  }
}

function drawImageNode(
  context: CanvasRenderingContext2D,
  node: SceneImageNode,
  image: DecodedImage,
): void {
  const { x, y, w: width, h: height } = node.bounds
  context.save()
  try {
    context.translate(x + width / 2, y + height / 2)
    if (node.transform?.rotation) {
      context.rotate(node.transform.rotation * Math.PI / 10800000)
    }
    if (node.transform?.flipH || node.transform?.flipV) {
      context.scale(node.transform.flipH ? -1 : 1, node.transform.flipV ? -1 : 1)
    }
    if (node.maskPreset) applyMask(context, node.maskPreset, width, height)
    applyEffects(context, node.effects)

    const source = cropSource(image, node.sourceCrop)
    if (source) {
      context.drawImage(image.source, ...source, -width / 2, -height / 2, width, height)
    } else {
      context.drawImage(image.source, -width / 2, -height / 2, width, height)
    }
  } finally {
    context.restore()
  }
}

export function createImageCanvasRenderer(options: ImageCanvasRendererOptions): ImageCanvasRenderer {
  const decoder = options.decoder ?? decodeBrowserImage
  const cache = new Map<string, CacheEntry>()
  let disposed = false

  const closeEntry = (entry: CacheEntry, image: DecodedImage): void => {
    if (entry.closed) return
    entry.closed = true
    entry.image = image
    image.close?.()
  }

  const load = (node: SceneImageNode): CacheEntry => {
    const existing = cache.get(node.assetId)
    if (existing) return existing

    const entry: CacheEntry = {
      promise: Promise.resolve({ status: 'failed', code: 'decode-failed', message: 'not loaded' }),
      closed: false,
    }
    entry.promise = options.adapter.get(node.assetId)
      .then(async (data): Promise<LoadOutcome> => {
        if (!data) return { status: 'failed', code: 'missing-asset', message: 'asset not found' }
        try {
          const image = await decoder(data, node.metadata?.mimeType)
          entry.image = image
          return { status: 'ready', image }
        } catch (error) {
          return { status: 'failed', code: 'decode-failed', message: errorMessage(error) }
        }
      })
      .catch((error): LoadOutcome => ({ status: 'failed', code: 'decode-failed', message: errorMessage(error) }))
    cache.set(node.assetId, entry)
    return entry
  }

  return {
    async render(scene, context, viewport = {}): Promise<ImageRenderResult> {
      if (disposed) throw new Error('renderer is disposed')
      if (viewport.signal?.aborted) return { drawnNodeIds: [], skippedNodeIds: [], issues: [] }

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
      const loaded = await Promise.all(imageNodes.map(async (node) => ({ node, outcome: await load(node).promise })))

      const result: ImageRenderResult = { drawnNodeIds: [], skippedNodeIds: [], issues: [] }
      for (const entry of loaded) {
        if (viewport.signal?.aborted) break
        if (entry.outcome.status === 'failed') {
          result.skippedNodeIds.push(entry.node.id)
          result.issues.push(renderIssue(entry.node, entry.outcome.code, entry.outcome.message))
          continue
        }
        try {
          drawImageNode(context, entry.node, entry.outcome.image)
          result.drawnNodeIds.push(entry.node.id)
        } catch (error) {
          result.skippedNodeIds.push(entry.node.id)
          result.issues.push(renderIssue(entry.node, 'draw-failed', error))
        }
      }
      return result
    },

    clearCache(): void {
      const entries = [...cache.values()]
      cache.clear()
      for (const entry of entries) {
        if (entry.image) {
          closeEntry(entry, entry.image)
          continue
        }
        void entry.promise.then((outcome) => {
          if (outcome.status === 'ready') closeEntry(entry, outcome.image)
        })
      }
    },

    dispose(): void {
      disposed = true
      this.clearCache()
    },
  }
}
