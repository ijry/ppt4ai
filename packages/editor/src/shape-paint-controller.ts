import type { EditorEngine, EngineState } from '@ppt4ai/engine'
import type { Fill, ResolvedColor, StrokeStyle } from '@ppt4ai/model'
import type { SceneGraph, SceneShapeNode, SceneTextNode } from '@ppt4ai/render'
import type { ShapePaintToolbarProps } from './shape-paint-toolbar'

export interface ShapePaintControllerOptions {
  engine: EditorEngine
}

export interface ShapePaintController {
  getState(): EngineState
  /** The single shape or text element the toolbar can edit, if the selection is exactly that. */
  target(): string | undefined
  props(scene?: SceneGraph): ShapePaintToolbarProps
  setFill(fill: Fill | null): EngineState
  setStroke(stroke: Fill | null): EngineState
  setStrokeWidth(width: number | null): EngineState
  setStrokeStyle(style: StrokeStyle | null): EngineState
}

const FALLBACK_FILL = '#FFFFFF'
const FALLBACK_STROKE = '#000000'

function hexFrom(color: ResolvedColor | undefined, fallback: string): string {
  return color && /^[0-9A-Fa-f]{6}$/.test(color.rgb) ? `#${color.rgb.toUpperCase()}` : fallback
}

type PaintNode = SceneShapeNode | SceneTextNode

function paintNode(scene: SceneGraph | undefined, elementId: string): PaintNode | undefined {
  const node = scene?.nodes.find((entry) => entry.id === elementId)
  return node?.kind === 'shape' || node?.kind === 'text' ? node : undefined
}

/**
 * Every displayed value comes from the scene node, not the element's own fields. A shape from the
 * gallery carries no `fill` of its own — its colour arrives through `fillRef` — so reading the
 * element would show a default while the canvas shows blue. The scene already merged the direct
 * value, the theme style reference and the per-property width and dash fallback.
 *
 * Clicking a swatch still writes a direct fill, overriding the theme reference, because that is the
 * only thing the command can do.
 */
export function createShapePaintController(options: ShapePaintControllerOptions): ShapePaintController {
  const target = (): string | undefined => {
    const state = options.engine.getState()
    if (state.selection.length !== 1) return undefined
    const element = state.document.elements[state.selection[0]!]
    return element?.kind === 'shape' || element?.kind === 'text' ? element.id : undefined
  }

  const dispatchTo = <T>(run: (elementId: string) => T): T => {
    const elementId = target()
    if (!elementId) throw new Error('a single shape or text element must be selected')
    return run(elementId)
  }

  return {
    getState: () => options.engine.getState(),
    target,
    props(scene) {
      const elementId = target()
      if (!elementId) {
        return { active: false, fillIsGradient: false, strokeIsGradient: false }
      }
      const node = paintNode(scene, elementId)
      const element = options.engine.getState().document.elements[elementId]
      const strokeWidth = node?.strokeWidth
        ?? (element?.kind === 'shape' || element?.kind === 'text' ? element.strokeWidth : undefined)
      const strokeStyle = node?.strokeStyle
        ?? (element?.kind === 'shape' || element?.kind === 'text' ? element.strokeStyle : undefined)
      return {
        active: true,
        fillColor: hexFrom(node?.resolvedFillColor, FALLBACK_FILL),
        fillIsGradient: node?.resolvedFillGradient !== undefined,
        strokeColor: hexFrom(node?.resolvedStrokeColor, FALLBACK_STROKE),
        strokeIsGradient: node?.resolvedStrokeGradient !== undefined,
        ...(strokeWidth === undefined ? {} : { strokeWidth }),
        ...(strokeStyle === undefined ? {} : { strokeStyle }),
      }
    },
    setFill: (fill) => dispatchTo((elementId) => options.engine.dispatch({ type: 'setElementFill', elementId, fill })),
    setStroke: (stroke) => dispatchTo((elementId) => options.engine.dispatch({ type: 'setElementStroke', elementId, stroke })),
    setStrokeWidth: (width) => dispatchTo((elementId) => options.engine.dispatch({ type: 'setElementStrokeWidth', elementId, width })),
    setStrokeStyle: (style) => dispatchTo((elementId) => options.engine.dispatch({ type: 'setElementStrokeStyle', elementId, style })),
  }
}
