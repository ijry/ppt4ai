import type { AssetAdapter, Rect, ResolvedColor, ResolvedGradient } from '@ppt4ai/model'
import { boundsCentre, gradientAxis, gradientFocus } from '@ppt4ai/geometry'
import type { PathCommand } from '@ppt4ai/geometry'
import type { SceneGraph, SceneImageNode, SceneNode } from '@ppt4ai/render'
import { paintPatternFill, paintPictureFill, paintShapeNode } from './shape-painting'
import { paintTableNode } from './table-painting'
import { paintTextNode } from './text-painting'
import { createImageNodeLoader, type DecodedImage, type ImageDecoder, type ImageLoadOutcome } from './image-canvas-renderer'
import { paintImageNode } from './image-painting'

const EMU_PER_CSS_PIXEL = 914400 / 96
const EMU_TO_CSS_PIXEL = 96 / 914400

/**
 * A per-element animation override the player lays over the scene at paint time (never mutating the
 * scene). Offsets are in EMU (the same unit as node bounds); scale/rotation pivot on the box centre;
 * opacity multiplies the element's own alpha. Structurally matches `@ppt4ai/player`'s resolved transform.
 */
export interface NodePaintOverride {
  opacity?: number
  translateX?: number
  translateY?: number
  scale?: number
  rotationDeg?: number
}

export interface SlideCanvasViewport {
  zoom?: number
  devicePixelRatio?: number
  signal?: AbortSignal
  /** Per-element paint overrides keyed by node id, e.g. from an animation player. */
  overrides?: ReadonlyMap<string, NodePaintOverride>
}

export interface SlideCanvasRenderIssue {
  nodeId: string
  kind: SceneNode['kind']
  code: 'draw-failed' | 'missing-asset' | 'decode-failed'
  message: string
}

export interface SlideCanvasRenderResult {
  drawnNodeIds: string[]
  skippedNodeIds: string[]
  issues: SlideCanvasRenderIssue[]
  cssWidth: number
  cssHeight: number
}

export interface SlideCanvasRenderer {
  render(scene: SceneGraph, context: CanvasRenderingContext2D, viewport?: SlideCanvasViewport): Promise<SlideCanvasRenderResult>
  clearCache(): void
  dispose(): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function imageIssue(node: SceneImageNode, outcome: Exclude<ImageLoadOutcome, { status: 'ready' }>): SlideCanvasRenderIssue {
  return { nodeId: node.id, kind: node.kind, code: outcome.code, message: outcome.message }
}

function drawNode(
  context: CanvasRenderingContext2D,
  node: SceneNode,
  scale: number,
  alpha: number,
  picture?: DecodedImage,
  cellPictures?: ReadonlyMap<string, DecodedImage>,
): void {
  const mapping = { scale, offsetX: 0, offsetY: 0, alpha }
  if (node.kind === 'shape') paintShapeNode(context, node, mapping, picture)
  else if (node.kind === 'text') paintTextNode(context, node, mapping, picture)
  else if (node.kind === 'table') paintTableNode(context, node, mapping, cellPictures)
  else throw new Error('image nodes require decoded image data')
}

/**
 * Lay an animation override over one node's paint. Geometry (offset/scale/rotation about the box centre)
 * is a canvas transform outside the node's own rotation/flip; opacity rides `globalAlpha` for images
 * (which multiply it in) and `mapping.alpha` for shape/text/table (whose painters set alpha absolutely).
 * A missing or identity override paints directly, so byte-for-byte behaviour is unchanged without one.
 */
function withNodeOverride(
  context: CanvasRenderingContext2D,
  mappedBounds: Rect,
  override: NodePaintOverride | undefined,
  scale: number,
  draw: () => void,
): void {
  if (!override) { draw(); return }
  const translateX = (override.translateX ?? 0) * scale
  const translateY = (override.translateY ?? 0) * scale
  const nodeScale = override.scale ?? 1
  const rotationDeg = override.rotationDeg ?? 0
  const opacity = override.opacity ?? 1
  if (translateX === 0 && translateY === 0 && nodeScale === 1 && rotationDeg === 0 && opacity === 1) {
    draw()
    return
  }
  const centre = boundsCentre(mappedBounds)
  context.save()
  try {
    if (opacity !== 1) context.globalAlpha *= opacity
    context.translate(translateX, translateY)
    if (rotationDeg !== 0 || nodeScale !== 1) {
      context.translate(centre.x, centre.y)
      // The override's rotation is plain degrees (clockwise); `rotationRadians` is for EMU 1/60000° units.
      if (rotationDeg !== 0) context.rotate((rotationDeg * Math.PI) / 180)
      if (nodeScale !== 1) context.scale(nodeScale, nodeScale)
      context.translate(-centre.x, -centre.y)
    }
    draw()
  } finally {
    context.restore()
  }
}

/**
 * Images take a target rect rather than a page mapping, so their EMU bounds have to be mapped here.
 * The thumbnail worker does the same; before this the slide renderer handed over raw EMU, leaving
 * images 9525 times larger than every other node.
 */
function mapBounds(bounds: Rect, scale: number): Rect {
  return { x: bounds.x * scale, y: bounds.y * scale, w: bounds.w * scale, h: bounds.h * scale }
}

function colorStyle(color: ResolvedColor): { style: string; alpha: number } {
  return { style: `#${color.rgb.toUpperCase()}`, alpha: color.alpha / 100000 }
}

function rgbaStyle(hex: string, alpha: number): string {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

/**
 * Background gradients use the same axis formula but over the page bounds, not a shape's bounds.
 * The mapped bounds are already in CSS pixels, matching where the shape painters work.
 */
function createBackgroundGradient(
  context: CanvasRenderingContext2D,
  gradient: ResolvedGradient,
  mappedBounds: Rect,
): CanvasGradient {
  // A path gradient is a circle on the rect it converges to; anything else runs along the axis.
  const focus = gradient.path ? gradientFocus(mappedBounds, gradient.fillToRect) : undefined
  const axis = focus ? undefined : gradientAxis(mappedBounds, gradient.angle ?? 0, gradient.scaled ?? false)
  const canvasGradient = focus
    ? context.createRadialGradient(focus.centre.x, focus.centre.y, 0, focus.centre.x, focus.centre.y, focus.radius)
    : context.createLinearGradient(axis!.from.x, axis!.from.y, axis!.to.x, axis!.to.y)
  for (const stop of gradient.stops) {
    const { style, alpha } = colorStyle(stop.color)
    const offset = Math.min(1, Math.max(0, stop.pos / 100000))
    canvasGradient.addColorStop(offset, alpha >= 1 ? style : rgbaStyle(style, alpha))
  }
  return canvasGradient
}


/** The page box as a path, so the shared picture painter can fill it exactly as it fills a shape. */
function paintPageBackgroundPicture(
  context: CanvasRenderingContext2D,
  scene: SceneGraph,
  scale: number,
  fill: NonNullable<SceneGraph['backgroundPicture']>,
  image: DecodedImage,
): void {
  const bounds = { x: 0, y: 0, w: scene.page.w, h: scene.page.h }
  const path: PathCommand[] = [
    { type: 'move', x: 0, y: 0 },
    { type: 'line', x: bounds.w, y: 0 },
    { type: 'line', x: bounds.w, y: bounds.h },
    { type: 'line', x: 0, y: bounds.h },
    { type: 'close' },
  ]
  paintPictureFill(context, path, { scale, offsetX: 0, offsetY: 0 }, mapBounds(bounds, scale), fill, image)
}

/** The page box as a path, so the shared pattern painter tiles it exactly as it tiles a shape. */
function paintPageBackgroundPattern(
  context: CanvasRenderingContext2D,
  scene: SceneGraph,
  scale: number,
  pattern: NonNullable<SceneGraph['backgroundPattern']>,
): boolean {
  const bounds = { x: 0, y: 0, w: scene.page.w, h: scene.page.h }
  const path: PathCommand[] = [
    { type: 'move', x: 0, y: 0 },
    { type: 'line', x: bounds.w, y: 0 },
    { type: 'line', x: bounds.w, y: bounds.h },
    { type: 'line', x: 0, y: bounds.h },
    { type: 'close' },
  ]
  return paintPatternFill(context, pattern, path, { scale, offsetX: 0, offsetY: 0 }, mapBounds(bounds, scale))
}

export function createSlideCanvasRenderer(options: { adapter: AssetAdapter; decoder?: ImageDecoder }): SlideCanvasRenderer {
  const imageLoader = createImageNodeLoader(options)
  let disposed = false

  return {
    async render(scene, context, viewport = {}): Promise<SlideCanvasRenderResult> {
      if (disposed) throw new Error('renderer is disposed')
      const zoom = viewport.zoom ?? 1
      const devicePixelRatio = viewport.devicePixelRatio ?? 1
      const cssWidth = scene.page.w / EMU_PER_CSS_PIXEL * zoom
      const cssHeight = scene.page.h / EMU_PER_CSS_PIXEL * zoom
      const result: SlideCanvasRenderResult = { drawnNodeIds: [], skippedNodeIds: [], issues: [], cssWidth, cssHeight }
      if (viewport.signal?.aborted) return result

      const canvas = context.canvas
      canvas.width = Math.round(cssWidth * devicePixelRatio)
      canvas.height = Math.round(cssHeight * devicePixelRatio)
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      // Every painter maps EMU to CSS pixels through `scale`, so the transform only has to carry
      // CSS pixels to the device pixel backing store. Scaling here as well would apply zoom twice.
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)

      const scale = EMU_TO_CSS_PIXEL * zoom
      // A photo background goes down before the colour it may sit on: `p:bg` replaces the whole
      // background, so the picture is the background rather than something layered over one.
      if (scene.backgroundPicture) {
        const outcome = await imageLoader.load({
          id: scene.slideId,
          assetId: scene.backgroundPicture.assetId,
          ...(scene.backgroundPicture.metadata ? { metadata: scene.backgroundPicture.metadata } : {}),
        })
        if (outcome.status === 'failed') {
          result.issues.push({ nodeId: scene.slideId, kind: 'shape', code: outcome.code, message: outcome.message })
        } else {
          paintPageBackgroundPicture(context, scene, scale, scene.backgroundPicture, outcome.image)
        }
      }
      // The page fill goes down first, in the same space the node painters draw in.
      if (scene.background) {
        const mappedBounds = { x: 0, y: 0, w: scene.page.w * scale, h: scene.page.h * scale }
        // A pattern paints its own two colours over the page, so it replaces the flat fill rather
        // than layering over it. A preset with no geometry falls through to the flat colour below.
        const paintedPattern = scene.backgroundPattern
          ? paintPageBackgroundPattern(context, scene, scale, scene.backgroundPattern)
          : false
        if (!paintedPattern) {
          if (scene.backgroundGradient) {
            context.fillStyle = createBackgroundGradient(context, scene.backgroundGradient, mappedBounds)
          } else {
            context.fillStyle = `#${scene.background.rgb.toUpperCase()}`
            context.globalAlpha = scene.background.alpha / 100000
          }
          context.fillRect(0, 0, mappedBounds.w, mappedBounds.h)
          context.globalAlpha = 1
        }
      }
      for (const node of scene.nodes) {
        if (viewport.signal?.aborted) break
        const override = viewport.overrides?.get(node.id)
        try {
          if (node.kind === 'image') {
            const outcome = await imageLoader.load(node)
            if (outcome.status === 'failed') {
              result.skippedNodeIds.push(node.id)
              result.issues.push(imageIssue(node, outcome))
              continue
            }
            withNodeOverride(context, mapBounds(node.bounds, scale), override, scale, () => {
              paintImageNode(context, node, outcome.image, mapBounds(node.bounds, scale))
            })
          } else {
            // A shape's picture fill is only part of what it paints, so a failed load reports the
            // issue and the node still draws: losing a photo should not take the outline and the
            // text with it, the way a failed `p:pic` legitimately skips its whole node.
            let picture: DecodedImage | undefined
            // A table asks for one picture per filled cell, so it gets a map rather than a single image.
            const cellPictures = new Map<string, DecodedImage>()
            if (node.kind === 'table') {
              for (const cell of node.layout.cells) {
                const fill = cell.pictureFill
                if (!fill || cellPictures.has(fill.assetId)) continue
                const outcome = await imageLoader.load({
                  id: node.id,
                  assetId: fill.assetId,
                  ...(fill.metadata ? { metadata: fill.metadata } : {}),
                })
                if (outcome.status === 'failed') {
                  result.issues.push({ nodeId: node.id, kind: node.kind, code: outcome.code, message: outcome.message })
                } else cellPictures.set(fill.assetId, outcome.image)
              }
            }
            const pictureFill = node.kind === 'shape' || node.kind === 'text' ? node.pictureFill : undefined
            if (pictureFill) {
              const outcome = await imageLoader.load({
                id: node.id,
                assetId: pictureFill.assetId,
                ...(pictureFill.metadata ? { metadata: pictureFill.metadata } : {}),
              })
              if (outcome.status === 'failed') {
                result.issues.push({ nodeId: node.id, kind: node.kind, code: outcome.code, message: outcome.message })
              } else picture = outcome.image
            }
            withNodeOverride(context, mapBounds(node.bounds, scale), override, scale, () => {
              drawNode(context, node, scale, override?.opacity ?? 1, picture, cellPictures)
            })
          }
          result.drawnNodeIds.push(node.id)
        } catch (error) {
          result.skippedNodeIds.push(node.id)
          result.issues.push({ nodeId: node.id, kind: node.kind, code: 'draw-failed', message: errorMessage(error) })
        }
      }
      return result
    },
    clearCache: () => imageLoader.clearCache(),
    dispose: () => {
      disposed = true
      imageLoader.dispose()
    },
  }
}

export type { DecodedImage, ImageDecoder }
