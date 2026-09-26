import { containsRotatedPoint } from '@ppt4ai/geometry'
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

export interface CanvasRect {
  x: number
  y: number
  w: number
  h: number
}

function rectsIntersect(a: CanvasRect, b: CanvasRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * Every top-level element whose axis-aligned bounds intersect the marquee rectangle (all in scene EMU).
 * Top-level means a group with no ancestors, or a node that belongs to no group — the same targets
 * `hitTestScene` picks from at the root, so a marquee selects whole groups, not their children.
 * Rotation is ignored for the hit (marquee uses unrotated bounds), matching common editor behaviour.
 */
export function marqueeSelect(scene: SceneGraph, rect: CanvasRect, _groupPath: string[] = []): string[] {
  const groups = scene.groups ?? []
  const groupedElementIds = new Set(groups.flatMap((group) => group.childIds))
  const targets = [
    ...groups.filter((group) => group.ancestorIds.length === 0).map((group) => ({ id: group.id, bounds: group.bounds })),
    ...scene.nodes.flatMap((node) => (!node || groupedElementIds.has(node.id) ? [] : [{ id: node.id, bounds: node.bounds }])),
  ]
  return targets.filter((target) => rectsIntersect(rect, target.bounds)).map((target) => target.id)
}

export function hitTestScene(scene: SceneGraph, point: CanvasPoint, groupPath: string[] = []): string | undefined {
  const groups = scene.groups ?? []
  if (groupPath.length > 0) {
    const currentGroup = groups.find((group) => group.id === groupPath[groupPath.length - 1])
    if (!currentGroup) return hitTestScene(scene, point)
    if (!containsRotatedPoint(currentGroup.bounds, point, currentGroup.rotation)) return hitTestScene(scene, point)
    const directChildIds = new Set(currentGroup.childIds)
    const directGroups = groups
      .filter((group) => directChildIds.has(group.id) && group.ancestorIds.length === groupPath.length)
      .map((group, sourceIndex) => ({ id: group.id, bounds: group.bounds, rotation: group.rotation, paintOrder: group.paintOrder, sourceIndex }))
    const directNodes = scene.nodes.flatMap((node, sourceIndex) => {
      if (!node || !directChildIds.has(node.id)) return []
      const rotation = node.transform?.rotation
      return [{ id: node.id, bounds: node.bounds, rotation, paintOrder: sourceIndex, sourceIndex }]
    })
    const targets = [...directGroups, ...directNodes].sort((left, right) => left.paintOrder - right.paintOrder || left.sourceIndex - right.sourceIndex)
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      const target = targets[index]
      if (target && containsRotatedPoint(target.bounds, point, target.rotation)) return target.id
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
      rotation: group.rotation,
      paintOrder: group.paintOrder,
      sourceIndex,
    })),
    ...scene.nodes.flatMap((node, sourceIndex) => {
      if (!node || groupedElementIds.has(node.id)) return []
      const rotation = node.transform?.rotation
      return [{ id: node.id, bounds: node.bounds, rotation, paintOrder: sourceIndex, sourceIndex }]
    }),
  ].sort((left, right) => left.paintOrder - right.paintOrder || left.sourceIndex - right.sourceIndex)

  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index]
    if (target && containsRotatedPoint(target.bounds, point, target.rotation)) return target.id
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
