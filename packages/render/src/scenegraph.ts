import { createPresetPath, type PathCommand } from '@ppt4ai/geometry'
import type { Element, Fill, Ppt4aiDocument, Rect } from '@ppt4ai/model'

export interface SceneGraph {
  slideId: string
  page: {
    w: number
    h: number
  }
  nodes: SceneNode[]
}

export interface SceneShapeNode {
  id: string
  kind: 'shape'
  bounds: Rect
  path: PathCommand[]
  fill?: Fill
  stroke?: Fill
}

export interface SceneTextNode {
  id: string
  kind: 'text'
  bounds: Rect
  text: string
}

export type SceneNode = SceneShapeNode | SceneTextNode

function createShapeNode(element: Extract<Element, { kind: 'shape' }>): SceneShapeNode {
  const node: SceneShapeNode = {
    id: element.id,
    kind: 'shape',
    bounds: element.bounds,
    path: createPresetPath(element.preset, element.bounds),
  }

  if (element.fill) node.fill = element.fill
  if (element.stroke) node.stroke = element.stroke
  return node
}

function createTextNode(element: Extract<Element, { kind: 'text' }>): SceneTextNode {
  return {
    id: element.id,
    kind: 'text',
    bounds: element.bounds,
    text: element.text,
  }
}

function createNode(element: Element): SceneNode | undefined {
  switch (element.kind) {
    case 'shape':
      return createShapeNode(element)
    case 'text':
      return createTextNode(element)
    default:
      return undefined
  }
}

export function documentToSceneGraph(value: Ppt4aiDocument): SceneGraph {
  const slideId = value.slideOrder[0]
  if (!slideId) throw new Error('input must contain at least one slide')

  const slide = value.slides[slideId]
  if (!slide) throw new Error(`input references missing slide: ${slideId}`)

  const nodes: SceneNode[] = []
  for (const elementId of slide.elementIds) {
    const element = value.elements[elementId]
    if (!element) continue

    const node = createNode(element)
    if (node) nodes.push(node)
  }

  return {
    slideId,
    page: { ...value.page },
    nodes,
  }
}
