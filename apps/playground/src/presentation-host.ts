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
  presentationHistory: {
    undoDepth: number
    redoDepth: number
  }
}

export interface PlaygroundPresentationHost {
  adapter: AssetAdapter
  readonly snapOptions: SnapOptions
  getSnapshot(): PlaygroundPresentationSnapshot
  selectSlide(slideId: string): PlaygroundPresentationSnapshot
  undo(): PlaygroundPresentationSnapshot
  redo(): PlaygroundPresentationSnapshot
  addSlide(): PlaygroundPresentationSnapshot
  duplicateSlide(): PlaygroundPresentationSnapshot
  deleteSlide(): PlaygroundPresentationSnapshot
  moveSlide(slideId: string, direction: 'up' | 'down'): PlaygroundPresentationSnapshot
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

interface PresentationHistoryEntry {
  beforeOrder: string[]
  afterOrder: string[]
  beforeActiveSlideId: string
  afterActiveSlideId: string
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
  let slideSequence = 1
  let status: PlaygroundAssetHostSnapshot['status'] = { kind: 'idle', message: '' }
  const undoStack: PresentationHistoryEntry[] = []
  const redoStack: PresentationHistoryEntry[] = []

  const activeHost = (): PlaygroundAssetHost => pageHosts.get(activeSlideId)!
  const recordStructuralChange = (beforeOrder: string[], beforeActiveSlideId: string): void => {
    undoStack.push({
      beforeOrder,
      afterOrder: [...slideOrder],
      beforeActiveSlideId,
      afterActiveSlideId: activeSlideId,
    })
    redoStack.length = 0
  }
  const applyStructuralState = (entry: PresentationHistoryEntry, direction: 'undo' | 'redo'): void => {
    const order = direction === 'undo' ? entry.beforeOrder : entry.afterOrder
    slideOrder.splice(0, slideOrder.length, ...order)
    activeSlideId = direction === 'undo' ? entry.beforeActiveSlideId : entry.afterActiveSlideId
  }
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
      presentationHistory: { undoDepth: undoStack.length, redoDepth: redoStack.length },
    })
  }
  const forward = (operation: (host: PlaygroundAssetHost) => PlaygroundAssetHostSnapshot): PlaygroundPresentationSnapshot => {
    const result = operation(activeHost())
    status = result.status
    return snapshot()
  }
  const nextSlideId = (prefix = 'sld_playground'): string => {
    let slideId = `${prefix}_${slideSequence}`
    while (pageHosts.has(slideId)) {
      slideSequence += 1
      slideId = `${prefix}_${slideSequence}`
    }
    slideSequence += 1
    return slideId
  }
  const insertPage = (slideId: string, title: string, document: Ppt4aiDocument, index: number): PlaygroundPresentationSnapshot => {
    const beforeOrder = [...slideOrder]
    const beforeActiveSlideId = activeSlideId
    pageHosts.set(slideId, createPlaygroundAssetHost({ adapter: seedHost.adapter, document }))
    titles.set(slideId, title)
    slideOrder.splice(index, 0, slideId)
    activeSlideId = slideId
    status = { kind: 'success', message: 'slide-added' }
    recordStructuralChange(beforeOrder, beforeActiveSlideId)
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
    undo() {
      const current = activeHost().getSnapshot().engineState
      if (current.history.undoDepth > 0) {
        const result = activeHost().undo()
        status = result.status
        return snapshot()
      }
      const entry = undoStack.pop()
      if (!entry) {
        status = { kind: 'error', message: 'undo-unavailable' }
        return snapshot()
      }
      applyStructuralState(entry, 'undo')
      redoStack.push(entry)
      status = { kind: 'success', message: 'presentation-undone' }
      return snapshot()
    },
    redo() {
      const current = activeHost().getSnapshot().engineState
      if (current.history.redoDepth > 0) {
        const result = activeHost().redo()
        status = result.status
        return snapshot()
      }
      const entry = redoStack.pop()
      if (!entry) {
        status = { kind: 'error', message: 'redo-unavailable' }
        return snapshot()
      }
      applyStructuralState(entry, 'redo')
      undoStack.push(entry)
      status = { kind: 'success', message: 'presentation-redone' }
      return snapshot()
    },
    addSlide() {
      const index = slideOrder.indexOf(activeSlideId) + 1
      const slideId = nextSlideId()
      const document = pageDocument(activeHost().getSnapshot().engineState.document, slideId, [])
      return insertPage(slideId, `Page ${index + 1}`, document, index)
    },
    duplicateSlide() {
      const sourceId = activeSlideId
      const sourceState = activeHost().getSnapshot().engineState
      const slideId = nextSlideId('sld_playground_copy')
      const sourceSlide = sourceState.document.slides[sourceState.document.slideOrder[0]!]!
      const document = pageDocument(sourceState.document, slideId, sourceSlide.elementIds)
      const index = slideOrder.indexOf(sourceId) + 1
      const beforeOrder = [...slideOrder]
      const beforeActiveSlideId = activeSlideId
      pageHosts.set(slideId, createPlaygroundAssetHost({ adapter: seedHost.adapter, document }))
      titles.set(slideId, `${titles.get(sourceId)} copy`)
      slideOrder.splice(index, 0, slideId)
      activeSlideId = slideId
      status = { kind: 'success', message: 'slide-duplicated' }
      recordStructuralChange(beforeOrder, beforeActiveSlideId)
      return snapshot()
    },
    deleteSlide() {
      if (slideOrder.length === 1) {
        status = { kind: 'error', message: 'slide-delete-blocked' }
        return snapshot()
      }
      const index = slideOrder.indexOf(activeSlideId)
      const beforeOrder = [...slideOrder]
      const beforeActiveSlideId = activeSlideId
      slideOrder.splice(index, 1)
      activeSlideId = slideOrder[Math.min(index, slideOrder.length - 1)]!
      status = { kind: 'success', message: 'slide-deleted' }
      recordStructuralChange(beforeOrder, beforeActiveSlideId)
      return snapshot()
    },
    moveSlide(slideId, direction) {
      const index = slideOrder.indexOf(slideId)
      if (index < 0) {
        status = { kind: 'error', message: 'slide-missing' }
        return snapshot()
      }
      const nextIndex = direction === 'up' ? index - 1 : index + 1
      if (nextIndex < 0 || nextIndex >= slideOrder.length) {
        status = { kind: 'error', message: 'slide-reorder-blocked' }
        return snapshot()
      }
      const beforeOrder = [...slideOrder]
      const beforeActiveSlideId = activeSlideId
      const neighborId = slideOrder[nextIndex]!
      slideOrder[index] = neighborId
      slideOrder[nextIndex] = slideId
      activeSlideId = slideId
      status = { kind: 'success', message: 'slide-reordered' }
      recordStructuralChange(beforeOrder, beforeActiveSlideId)
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
