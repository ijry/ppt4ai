import { rotationRadians } from '@ppt4ai/geometry'
import type { ImageCrop, ImageEffect, PresetGeometry, Rect } from '@ppt4ai/model'
import type { SceneImageNode } from '@ppt4ai/render'
import type { DecodedImage } from './image-canvas-renderer'

/** Exported because a shape's picture fill trims its source with the same `a:srcRect` semantics. */
export function cropSource(
  image: DecodedImage,
  crop: ImageCrop | undefined,
): [number, number, number, number] | undefined {
  if (!crop) return undefined
  const left = crop.left ?? 0
  const top = crop.top ?? 0
  const right = crop.right ?? 0
  const bottom = crop.bottom ?? 0
  const values = [left, top, right, bottom]
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100000)) return undefined

  const widthRatio = 1 - (left + right) / 100000
  const heightRatio = 1 - (top + bottom) / 100000
  if (widthRatio <= 0 || heightRatio <= 0) return undefined

  return [
    image.width * left / 100000,
    image.height * top / 100000,
    image.width * widthRatio,
    image.height * heightRatio,
  ]
}

function applyMask(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  preset: PresetGeometry,
  width: number,
  height: number,
): void {
  const halfWidth = width / 2
  const halfHeight = height / 2
  context.beginPath()
  if (preset === 'ellipse') {
    context.ellipse(0, 0, halfWidth, halfHeight, 0, 0, Math.PI * 2)
  } else if (preset === 'triangle') {
    context.moveTo(0, -halfHeight)
    context.lineTo(halfWidth, halfHeight)
    context.lineTo(-halfWidth, halfHeight)
    context.closePath()
  } else if (preset === 'roundRect') {
    const radius = Math.min(width, height) * 0.1
    context.roundRect(-halfWidth, -halfHeight, width, height, radius)
  } else {
    context.rect(-halfWidth, -halfHeight, width, height)
  }
  context.clip()
}

function applyEffects(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  effects: ImageEffect[] | undefined,
): void {
  for (const effect of effects ?? []) {
    if (effect.type === 'alphaModFix') {
      context.globalAlpha *= effect.amount / 100000
    } else if (effect.type === 'grayscl') {
      context.filter = 'grayscale(1)'
    }
  }
}

export function paintImageNode(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  node: SceneImageNode,
  image: DecodedImage,
  bounds: Rect,
): void {
  const { x, y, w: width, h: height } = bounds
  context.save()
  try {
    context.translate(x + width / 2, y + height / 2)
    if (node.transform?.rotation) {
      context.rotate(rotationRadians(node.transform.rotation))
    }
    if (node.transform?.flipH || node.transform?.flipV) {
      context.scale(node.transform.flipH ? -1 : 1, node.transform.flipV ? -1 : 1)
    }
    if (node.maskPreset) applyMask(context, node.maskPreset, width, height)
    applyEffects(context, node.effects)

    const source = cropSource(image, node.sourceCrop)
    if (source) {
      context.drawImage(image.source, ...source, -width / 2, -height / 2, width, height)
    } else {
      context.drawImage(image.source, -width / 2, -height / 2, width, height)
    }
  } finally {
    context.restore()
  }
}
