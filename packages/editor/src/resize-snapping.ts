import type { SnapGuide, SnapOptions } from '@ppt4ai/engine'
import type { Rect } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'
import type { SelectionHandle } from './selection-overlay'

export interface ResizeSnapRequest {
  scene: SceneGraph
  selectedElementIds: readonly string[]
  sourceBounds: Rect
  proposedBounds: Rect
  handle: SelectionHandle
  options?: SnapOptions
  aspectRatioLocked?: boolean
  centered?: boolean
}

export interface ResizeSnapResult {
  bounds: Rect
  guides: SnapGuide[]
}

type Axis = 'x' | 'y'

interface CandidateEntry {
  id: string
  bounds: Rect
  order: number
}

interface SnapCandidate {
  axis: Axis
  delta: number
  position: number
  source: 'element' | 'grid'
  elementId?: string
  order: number
  lineOrder: number
}

const xLines = (bounds: Rect): number[] => [bounds.x, bounds.x + bounds.w / 2, bounds.x + bounds.w]
const yLines = (bounds: Rect): number[] => [bounds.y, bounds.y + bounds.h / 2, bounds.y + bounds.h]

function cloneBounds(bounds: Rect): Rect {
  return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }
}

function validBounds(bounds: Rect): boolean {
  return [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) && bounds.w > 0 && bounds.h > 0
}

function selectedDescendants(scene: SceneGraph, selectedElementIds: readonly string[]): Set<string> {
  const groups = scene.groups ?? []
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const result = new Set<string>()
  const visit = (elementId: string): void => {
    if (result.has(elementId)) return
    result.add(elementId)
    groupsById.get(elementId)?.childIds.forEach(visit)
  }
  selectedElementIds.forEach(visit)
  return result
}

function candidateEntries(scene: SceneGraph, selectedElementIds: readonly string[]): CandidateEntry[] {
  const excluded = selectedDescendants(scene, selectedElementIds)
  const groups = (scene.groups ?? [])
    .filter((group) => group.ancestorIds.length === 0 && !excluded.has(group.id))
    .map((group, index) => ({ id: group.id, bounds: cloneBounds(group.bounds), order: group.paintOrder >= 0 ? group.paintOrder : index }))
  const groupChildIds = new Set((scene.groups ?? []).flatMap((group) => group.childIds))
  const nodes = scene.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => !groupChildIds.has(node.id) && !excluded.has(node.id))
    .map(({ node, index }) => ({ id: node.id, bounds: cloneBounds(node.bounds), order: index }))
  return [...groups, ...nodes]
}

function activeEdge(bounds: Rect, handle: SelectionHandle, axis: Axis): number | undefined {
  if (axis === 'x') {
    if (handle.includes('w')) return bounds.x
    if (handle.includes('e')) return bounds.x + bounds.w
  } else {
    if (handle.includes('n')) return bounds.y
    if (handle.includes('s')) return bounds.y + bounds.h
  }
  return undefined
}

function applyDelta(bounds: Rect, handle: SelectionHandle, axis: Axis, delta: number): Rect {
  if (axis === 'x') {
    if (handle.includes('w')) return { ...bounds, x: bounds.x + delta, w: bounds.w - delta }
    if (handle.includes('e')) return { ...bounds, w: bounds.w + delta }
  } else {
    if (handle.includes('n')) return { ...bounds, y: bounds.y + delta, h: bounds.h - delta }
    if (handle.includes('s')) return { ...bounds, h: bounds.h + delta }
  }
  return cloneBounds(bounds)
}

function applyCenteredDelta(
  sourceBounds: Rect,
  proposedBounds: Rect,
  handle: SelectionHandle,
  axis: Axis,
  delta: number,
): Rect {
  const edge = activeEdge(proposedBounds, handle, axis)
  if (edge === undefined) return cloneBounds(proposedBounds)
  const center = axis === 'x'
    ? sourceBounds.x + sourceBounds.w / 2
    : sourceBounds.y + sourceBounds.h / 2
  const halfSize = axis === 'x'
    ? handle.includes('w') ? center - edge - delta : edge + delta - center
    : handle.includes('n') ? center - edge - delta : edge + delta - center
  if (halfSize <= 0) return { ...proposedBounds, [axis === 'x' ? 'w' : 'h']: 0 }
  if (axis === 'x') {
    return { ...proposedBounds, x: center - halfSize, w: halfSize * 2 }
  }
  return { ...proposedBounds, y: center - halfSize, h: halfSize * 2 }
}

function guide(candidate: SnapCandidate): SnapGuide {
  return {
    axis: candidate.axis,
    position: candidate.position,
    source: candidate.source,
    ...(candidate.elementId ? { elementId: candidate.elementId } : {}),
  }
}

function nearestCandidate(
  scene: SceneGraph,
  selectedElementIds: readonly string[],
  bounds: Rect,
  handle: SelectionHandle,
  axis: Axis,
  options: SnapOptions,
): SnapCandidate | undefined {
  const edge = activeEdge(bounds, handle, axis)
  if (edge === undefined) return undefined
  const candidates: SnapCandidate[] = []
  for (const entry of candidateEntries(scene, selectedElementIds)) {
    const lines = axis === 'x' ? xLines(entry.bounds) : yLines(entry.bounds)
    lines.forEach((position, lineOrder) => {
      candidates.push({
        axis,
        delta: position - edge,
        position,
        source: 'element',
        elementId: entry.id,
        order: entry.order,
        lineOrder,
      })
    })
  }
  if (Number.isFinite(options.gridSize) && options.gridSize! > 0) {
    const position = Math.round(edge / options.gridSize!) * options.gridSize!
    candidates.push({ axis, delta: position - edge, position, source: 'grid', order: Number.POSITIVE_INFINITY, lineOrder: 0 })
  }
  candidates.sort((left, right) => (
    Math.abs(left.delta) - Math.abs(right.delta)
    || (left.source === right.source ? 0 : left.source === 'element' ? -1 : 1)
    || left.order - right.order
    || left.lineOrder - right.lineOrder
  ))
  const candidate = candidates[0]
  return candidate && Math.abs(candidate.delta) <= options.threshold ? candidate : undefined
}

function aspectBounds(
  source: Rect,
  proposed: Rect,
  handle: SelectionHandle,
  drivingAxis: Axis,
  centered = false,
): Rect {
  const ratio = source.w / source.h
  const width = drivingAxis === 'x' ? proposed.w : proposed.h * ratio
  const height = drivingAxis === 'x' ? proposed.w / ratio : proposed.h
  if (centered) {
    const centerX = source.x + source.w / 2
    const centerY = source.y + source.h / 2
    return {
      x: centerX - width / 2,
      y: centerY - height / 2,
      w: width,
      h: height,
    }
  }
  const right = source.x + source.w
  const bottom = source.y + source.h
  return {
    x: handle.includes('w') ? right - width : source.x,
    y: handle.includes('n') ? bottom - height : source.y,
    w: width,
    h: height,
  }
}

function isCorner(handle: SelectionHandle): boolean {
  return handle.length === 2
}

function snapOptionsEnabled(options: SnapOptions | undefined): options is SnapOptions {
  if (!options) return false
  return options.enabled !== false
    && Number.isFinite(options.threshold)
    && options.threshold > 0
}

export function snapResizeBounds(request: ResizeSnapRequest): ResizeSnapResult {
  const proposedBounds = cloneBounds(request.proposedBounds)
  const options = request.options
  if (!validBounds(request.sourceBounds) || !validBounds(proposedBounds) || !snapOptionsEnabled(options)) {
    return { bounds: proposedBounds, guides: [] }
  }

  const xCandidate = nearestCandidate(request.scene, request.selectedElementIds, proposedBounds, request.handle, 'x', options)
  const yCandidate = nearestCandidate(request.scene, request.selectedElementIds, proposedBounds, request.handle, 'y', options)
  if (request.aspectRatioLocked && isCorner(request.handle)) {
    const candidates = [xCandidate, yCandidate].filter((candidate): candidate is SnapCandidate => Boolean(candidate))
    if (candidates.length === 0) return { bounds: proposedBounds, guides: [] }
    candidates.sort((left, right) => (
      Math.abs(left.delta) / request.sourceBounds.w - Math.abs(right.delta) / request.sourceBounds.h
      || (left.axis === right.axis ? 0 : left.axis === 'x' ? -1 : 1)
    ))
    const chosen = candidates[0]!
    const snapped = request.centered
      ? applyCenteredDelta(request.sourceBounds, proposedBounds, request.handle, chosen.axis, chosen.delta)
      : applyDelta(proposedBounds, request.handle, chosen.axis, chosen.delta)
    if (!validBounds(snapped)) return { bounds: proposedBounds, guides: [] }
    return {
      bounds: aspectBounds(request.sourceBounds, snapped, request.handle, chosen.axis, request.centered),
      guides: [guide(chosen)],
    }
  }

  let bounds = proposedBounds
  const guides: SnapGuide[] = []
  if (xCandidate) {
    bounds = request.centered
      ? applyCenteredDelta(request.sourceBounds, bounds, request.handle, 'x', xCandidate.delta)
      : applyDelta(bounds, request.handle, 'x', xCandidate.delta)
    if (validBounds(bounds)) guides.push(guide(xCandidate))
    else bounds = proposedBounds
  }
  if (yCandidate) {
    const next = request.centered
      ? applyCenteredDelta(request.sourceBounds, bounds, request.handle, 'y', yCandidate.delta)
      : applyDelta(bounds, request.handle, 'y', yCandidate.delta)
    if (validBounds(next)) {
      bounds = next
      guides.push(guide(yCandidate))
    }
  }
  return { bounds: cloneBounds(bounds), guides }
}
