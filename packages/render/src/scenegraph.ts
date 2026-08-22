import { createPresetPath, type PathCommand } from '@ppt4ai/geometry'
import { layoutTable, type TableLayout } from '@ppt4ai/layout'
import { resolveInheritedElement, type Element, type Fill, type Ppt4aiDocument, type Rect } from '@ppt4ai/model'
import { layoutText, normalizeTextElement, type TextLayout } from '@ppt4ai/text'

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
  layout: TextLayout
  fill?: Fill
  stroke?: Fill
}

export interface SceneTableNode {
  id: string
  kind: 'table'
  bounds: Rect
  layout: TableLayout
  fill?: Fill
  stroke?: Fill
}

export type SceneNode = SceneShapeNode | SceneTextNode | SceneTableNode

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
  const body = normalizeTextElement(element)
  const node: SceneTextNode = {
    id: element.id,
    kind: 'text',
    bounds: element.bounds,
    text: element.text ?? body.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n'),
    layout: layoutText({ bounds: element.bounds, body }),
  }
  if (element.fill) node.fill = element.fill
  if (element.stroke) node.stroke = element.stroke
  return node
}

function createTableNode(element: Extract<Element, { kind: 'table' }>): SceneTableNode {
  const node: SceneTableNode = {
    id: element.id,
    kind: 'table',
    bounds: { ...element.bounds },
    layout: layoutTable(element),
  }
  if (element.fill) node.fill = structuredClone(element.fill)
  if (element.stroke) node.stroke = structuredClone(element.stroke)
  return node
}

function createNode(element: Element): SceneNode | undefined {
  switch (element.kind) {
    case 'shape':
      return createShapeNode(element)
    case 'text':
      return createTextNode(element)
    case 'table':
      return createTableNode(element)
    case 'group':
      return undefined
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
  const visited = new Set<string>()
  const appendElement = (elementId: string): void => {
    if (visited.has(elementId)) return
    visited.add(elementId)
    const element = value.elements[elementId]
    if (!element) return
    if (element.kind === 'group') {
      for (const childId of element.childIds) appendElement(childId)
      return
    }
    const node = createNode(resolveInheritedElement(element, layout, master))
    if (node) nodes.push(node)
  }
  for (const elementId of slide.elementIds) appendElement(elementId)

  return {
    slideId,
    page: { ...value.page },
    nodes,
  }
}
