import type { EngineState, ImageFlipAxis, SnapOptions } from '@ppt4ai/engine'
import { documentToSceneGraph, type SceneGraph } from '@ppt4ai/render'
import type { AssetAdapter, Ppt4aiDocument, Rect, TextBody } from '@ppt4ai/model'
import { createPlaygroundAssetHost, type PlaygroundAssetHost, type PlaygroundAssetHostSnapshot } from './asset-host'
import type { PlaygroundImageUploadInput } from './image-file-upload'

export interface PlaygroundSlideSnapshot {
  id: string
  title: string
  thumbnailScene: SceneGraph
  engineState: EngineState
}

export interface PlaygroundPresentationSnapshot {
  slideOrder: string[]
  activeSlideId: string
  slides: Record<string, PlaygroundSlideSnapshot>
  selectedAssetId?: string
  status: PlaygroundAssetHostSnapshot['status']
}

export interface PlaygroundPresentationHost {
  adapter: AssetAdapter
  readonly snapOptions: SnapOptions
  getSnapshot(): PlaygroundPresentationSnapshot
  selectSlide(slideId: string): PlaygroundPresentationSnapshot
  selectElements(elementIds: string[]): PlaygroundPresentationSnapshot
  selectElement(elementId: string | undefined): PlaygroundPresentationSnapshot
  moveSelected(elementId: string, dx: number, dy: number): PlaygroundPresentationSnapshot
  groupSelected(): PlaygroundPresentationSnapshot
  ungroupSelected(groupId: string): PlaygroundPresentationSnapshot
  resizeSelected(elementIds: string[], bounds: Rect): PlaygroundPresentationSnapshot
  resizeElement(elementId: string, bounds: Rect): PlaygroundPresentationSnapshot
  rotateSelectedImage(elementId: string, rotation: number): PlaygroundPresentationSnapshot
  toggleSelectedImageFlip(elementId: string, axis: ImageFlipAxis): PlaygroundPresentationSnapshot
  updateTextElement(elementId: string, body: TextBody): PlaygroundPresentationSnapshot
  selectAsset(assetId: string): PlaygroundPresentationSnapshot
  insertAsset(assetId: string): PlaygroundPresentationSnapshot
  replaceSelectedImage(assetId: string): PlaygroundPresentationSnapshot
  uploadAndInsert(input: PlaygroundImageUploadInput): Promise<PlaygroundPresentationSnapshot>
  uploadAndReplace(input: PlaygroundImageUploadInput): Promise<PlaygroundPresentationSnapshot>
}

interface PageEntry {
  id: string
  title: string
  document: Ppt4aiDocument
}

function pageDocument(source: Ppt4aiDocument, slideId: string, elementIds: string[]): Ppt4aiDocument {
  const document = structuredClone(source)
  const sourceSlide = document.slides[source.slideOrder[0]!]!
  document.id = `dck_${slideId}`
  document.slides = {
    [slideId]: {
      ...sourceSlide,
      id: slideId,
      elementIds: [...elementIds],
    },
  }
  document.slideOrder = [slideId]
  return document
}

function createPageEntries(source: Ppt4aiDocument): PageEntry[] {
  return [
    {
      id: 'sld_playground',
      title: 'Page 1',
      document: pageDocument(source, 'sld_playground', ['group_demo', 'table_demo']),
    },
    {
      id: 'sld_playground_blue',
      title: 'Page 2',
      document: pageDocument(source, 'sld_playground_blue', ['table_demo']),
    },
  ]
}

export function createPlaygroundPresentationHost(): PlaygroundPresentationHost {
  const seedHost = createPlaygroundAssetHost()
  const entries = createPageEntries(seedHost.getSnapshot().engineState.document)
  const pageHosts = new Map<string, PlaygroundAssetHost>(entries.map((entry) => [
    entry.id,
    createPlaygroundAssetHost({ adapter: seedHost.adapter, document: entry.document }),
  ]))
  const slideOrder = entries.map((entry) => entry.id)
  const titles = new Map(entries.map((entry) => [entry.id, entry.title]))
  let activeSlideId = slideOrder[0]!
  let status: PlaygroundAssetHostSnapshot['status'] = { kind: 'idle', message: '' }

  const activeHost = (): PlaygroundAssetHost => pageHosts.get(activeSlideId)!
  const snapshot = (): PlaygroundPresentationSnapshot => {
    const slides: Record<string, PlaygroundSlideSnapshot> = {}
    for (const slideId of slideOrder) {
      const state = pageHosts.get(slideId)!.getSnapshot().engineState
      slides[slideId] = {
        id: slideId,
        title: titles.get(slideId)!,
        thumbnailScene: documentToSceneGraph(state.document),
        engineState: state,
      }
    }
    const current = activeHost().getSnapshot()
    return structuredClone({
      slideOrder,
      activeSlideId,
      slides,
      ...(current.selectedAssetId ? { selectedAssetId: current.selectedAssetId } : {}),
      status,
    })
  }
  const forward = (operation: (host: PlaygroundAssetHost) => PlaygroundAssetHostSnapshot): PlaygroundPresentationSnapshot => {
    const result = operation(activeHost())
    status = result.status
    return snapshot()
  }

  return {
    adapter: seedHost.adapter,
    snapOptions: structuredClone(seedHost.snapOptions),
    getSnapshot: snapshot,
    selectSlide(slideId) {
      if (!pageHosts.has(slideId)) {
        status = { kind: 'error', message: 'slide-missing' }
        return snapshot()
      }
      activeSlideId = slideId
      status = { kind: 'success', message: 'slide-selected' }
      return snapshot()
    },
    selectElements(elementIds) {
      return forward((host) => host.selectElements(elementIds))
    },
    selectElement(elementId) {
      return forward((host) => host.selectElement(elementId))
    },
    moveSelected(elementId, dx, dy) {
      return forward((host) => host.moveSelected(elementId, dx, dy))
    },
    groupSelected() {
      return forward((host) => host.groupSelected())
    },
    ungroupSelected(groupId) {
      return forward((host) => host.ungroupSelected(groupId))
    },
    resizeSelected(elementIds, bounds) {
      return forward((host) => host.resizeSelected(elementIds, bounds))
    },
    resizeElement(elementId, bounds) {
      return forward((host) => host.resizeElement(elementId, bounds))
    },
    rotateSelectedImage(elementId, rotation) {
      return forward((host) => host.rotateSelectedImage(elementId, rotation))
    },
    toggleSelectedImageFlip(elementId, axis) {
      return forward((host) => host.toggleSelectedImageFlip(elementId, axis))
    },
    updateTextElement(elementId, body) {
      return forward((host) => host.updateTextElement(elementId, body))
    },
    selectAsset(assetId) {
      return forward((host) => host.selectAsset(assetId))
    },
    insertAsset(assetId) {
      return forward((host) => host.insertAsset(assetId))
    },
    replaceSelectedImage(assetId) {
      return forward((host) => host.replaceSelectedImage(assetId))
    },
    async uploadAndInsert(input) {
      const result = await activeHost().uploadAndInsert(input)
      status = result.status
      return snapshot()
    },
    async uploadAndReplace(input) {
      const result = await activeHost().uploadAndReplace(input)
      status = result.status
      return snapshot()
    },
  }
}
