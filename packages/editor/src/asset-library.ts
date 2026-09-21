import type { AssetMetadata } from '@ppt4ai/model'

export interface AssetLibraryItem {
  id: string
  metadata: AssetMetadata
  displayName: string
  formatLabel: string
  dimensionsLabel: string
}

export interface AssetLibraryModel {
  items: AssetLibraryItem[]
  selectedAssetId?: string
}

function formatLabel(mimeType: AssetMetadata['mimeType']): string {
  return mimeType.slice('image/'.length).replace('jpeg', 'jpg').toUpperCase()
}

function dimensionsLabel(metadata: AssetMetadata): string {
  if (metadata.pixelWidth === undefined || metadata.pixelHeight === undefined) return 'unknown'
  return `${metadata.pixelWidth} \u00d7 ${metadata.pixelHeight}`
}

export function createAssetLibraryModel(
  assets: Record<string, AssetMetadata> | undefined,
  selectedAssetId?: string,
): AssetLibraryModel {
  const items = Object.values(assets ?? {})
    .map((metadata) => {
      const copied = structuredClone(metadata)
      return {
        id: copied.id,
        metadata: copied,
        displayName: copied.originalFilename || copied.id,
        formatLabel: formatLabel(copied.mimeType),
        dimensionsLabel: dimensionsLabel(copied),
      }
    })
    .sort((left, right) => {
      const nameOrder = left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' })
      return nameOrder || left.id.localeCompare(right.id)
    })

  return {
    items,
    ...(selectedAssetId && items.some((item) => item.id === selectedAssetId) ? { selectedAssetId } : {}),
  }
}
