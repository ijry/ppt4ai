import type { AssetAdapter, AssetMetadata, SceneGraph } from '@ppt4ai/editor'

function solidAsset(color: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable')
  context.fillStyle = color
  context.fillRect(0, 0, 2, 2)
  return canvas.toDataURL('image/png')
}

export const thumbnailAssets = {
  'asset-red': solidAsset('#ef4444'),
  'asset-blue': solidAsset('#2563eb'),
} as const

export function createThumbnailScene(color: 'red' | 'blue'): SceneGraph {
  const assetId = color === 'red' ? 'asset-red' : 'asset-blue'
  return {
    slideId: `slide-${color}`,
    page: { w: 1000, h: 562.5 },
    nodes: [{
      id: color === 'red' ? 'image-red' : 'image-blue',
      kind: 'image',
      bounds: { x: 0, y: 0, w: 1000, h: 562.5 },
      assetId,
      metadata: { id: assetId, mimeType: 'image/png' },
    }],
  }
}

export const thumbnailAdapter: AssetAdapter = {
  async get(assetId: string): Promise<Uint8Array | undefined> {
    const source = thumbnailAssets[assetId as keyof typeof thumbnailAssets]
    if (!source) return undefined
    const response = await fetch(source)
    return new Uint8Array(await response.arrayBuffer())
  },
  async put(_assetId: string, _data: Uint8Array, _metadata: AssetMetadata): Promise<void> {},
}
