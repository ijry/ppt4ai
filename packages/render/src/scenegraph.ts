import { createPresetPath, type PathCommand } from '@ppt4ai/geometry'
import { resolveInheritedElement, type Element, type Fill, type Ppt4aiDocument, type Rect } from '@ppt4ai/model'

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
  fill?: Fill
  stroke?: Fill
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
  const node: SceneTextNode = {
    id: element.id,
    kind: 'text',
    bounds: element.bounds,
    text: element.text,
  }
  if (element.fill) node.fill = element.fill
  if (element.stroke) node.stroke = element.stroke
  return node
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
  const layout = slide.layoutId ? value.layouts?.[slide.layoutId] : undefined
  const masterId = slide.masterId ?? layout?.masterId
  const master = masterId ? value.masters?.[masterId] : undefined
  for (const elementId of slide.elementIds) {
    const element = value.elements[elementId]
    if (!element) continue

    const node = createNode(resolveInheritedElement(element, layout, master))
    if (node) nodes.push(node)
  }

  return {
    slideId,
    page: { ...value.page },
    nodes,
  }
}
