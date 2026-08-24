import type { Rect } from '@ppt4ai/model'
import type { SceneGraph } from '@ppt4ai/render'

export type CanvasSelectionIntent = {
  nodeId: string | undefined
  toggle: boolean
}

const EMU_PER_CSS_PIXEL = 914400 / 96

export interface CanvasPoint {
  x: number
  y: number
}

function contains(bounds: Rect, point: CanvasPoint): boolean {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.w && point.y >= bounds.y && point.y <= bounds.y + bounds.h
}

export function hitTestScene(scene: SceneGraph, point: CanvasPoint, groupPath: string[] = []): string | undefined {
  const groups = scene.groups ?? []
  if (groupPath.length > 0) {
    const currentGroup = groups.find((group) => group.id === groupPath[groupPath.length - 1])
    if (!currentGroup) return hitTestScene(scene, point)
    if (!contains(currentGroup.bounds, point)) return hitTestScene(scene, point)
    const directChildIds = new Set(currentGroup.childIds)
    const directGroups = groups
      .filter((group) => directChildIds.has(group.id) && group.ancestorIds.length === groupPath.length)
      .map((group, sourceIndex) => ({ id: group.id, bounds: group.bounds, paintOrder: group.paintOrder, sourceIndex }))
    const directNodes = scene.nodes.flatMap((node, sourceIndex) => node && directChildIds.has(node.id)
      ? [{ id: node.id, bounds: node.bounds, paintOrder: sourceIndex, sourceIndex }]
      : [])
    const targets = [...directGroups, ...directNodes].sort((left, right) => left.paintOrder - right.paintOrder || left.sourceIndex - right.sourceIndex)
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      const target = targets[index]
      if (target && contains(target.bounds, point)) return target.id
    }
    return undefined
  }
  const groupedElementIds = new Set(groups.flatMap((group) => group.childIds))
  const topLevelGroups = groups
    .filter((group) => group.ancestorIds.length === 0)
    .map((group, sourceIndex) => ({ group, sourceIndex }))
  const targets = [
    ...topLevelGroups.map(({ group, sourceIndex }) => ({
      id: group.id,
      bounds: group.bounds,
      paintOrder: group.paintOrder,
      sourceIndex,
    })),
    ...scene.nodes.flatMap((node, sourceIndex) => node && !groupedElementIds.has(node.id)
      ? [{ id: node.id, bounds: node.bounds, paintOrder: sourceIndex, sourceIndex }]
      : []),
  ].sort((left, right) => left.paintOrder - right.paintOrder || left.sourceIndex - right.sourceIndex)

  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index]
    if (target && contains(target.bounds, point)) return target.id
  }
  return undefined
}

export function pointFromCanvasEvent(event: Pick<PointerEvent, 'clientX' | 'clientY'>, canvas: HTMLCanvasElement, zoom: number): CanvasPoint {
  const rect = canvas.getBoundingClientRect()
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('zoom must be positive')
  return {
    x: (event.clientX - rect.left) / (zoom / EMU_PER_CSS_PIXEL),
    y: (event.clientY - rect.top) / (zoom / EMU_PER_CSS_PIXEL),
  }
}
