import type { Color, ColorTransformType } from '@ppt4ai/model'
import type { XmlElement } from './xml-range.js'

const colorTransformTypes = new Set<ColorTransformType>(['tint', 'shade', 'lumMod', 'lumOff', 'alpha', 'alphaMod', 'alphaOff'])

/** Mirrors the importer's `parseColor`; see the note in `text-source.ts` on why it is not shared. */
export function sourceColor(element: XmlElement | undefined): Color | undefined {
  if (!element) return undefined
  for (const child of element.children) {
    let color: Color | undefined
    if (child.localName === 'srgbClr' && /^[0-9A-F]{6}$/iu.test(child.attributes.val ?? '')) {
      color = { type: 'srgb', v: (child.attributes.val ?? '').toUpperCase() }
    } else if (child.localName === 'schemeClr' && child.attributes.val) {
      color = { type: 'scheme', v: child.attributes.val.trim() }
    } else if (child.localName === 'prstClr' && child.attributes.val) {
      color = { type: 'preset', v: child.attributes.val.trim() }
    } else if (child.localName === 'sysClr' && /^[0-9A-F]{6}$/iu.test(child.attributes.lastClr ?? '')) {
      color = { type: 'system', v: (child.attributes.lastClr ?? '').toUpperCase() }
    } else if (child.localName === 'scrgbClr') {
      const channels = [child.attributes.r, child.attributes.g, child.attributes.b].map((value) => Number(value))
      if (channels.every((value) => Number.isInteger(value) && value >= 0 && value <= 100000)) {
        color = { type: 'scrgb', v: channels.join(',') }
      }
    }
    if (!color) continue
    const transforms = child.children.flatMap((transform) => {
      if (!colorTransformTypes.has(transform.localName as ColorTransformType)) return []
      const value = Number(transform.attributes.val)
      return Number.isInteger(value) && value >= 0 && value <= 100000
        ? [{ type: transform.localName as ColorTransformType, value }]
        : []
    })
    return transforms.length > 0 ? { ...color, transforms } : color
  }
  return undefined
}
