import { DEFAULT_THEME_COLORS, type Color, type ColorTransform, type ColorTransformType, type Theme, type ThemeColorSlot } from '@ppt4ai/model'
import { serializeColorXml } from './standalone-xml.js'
import { descendants, replaceRanges, scanXml, tagEnd, type Replacement, type XmlElement } from './xml-range.js'

const themeColorSlots = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const
const themeColorSlotSet = new Set<string>(themeColorSlots)
const colorNodeNames = new Set(['srgbClr', 'schemeClr', 'prstClr', 'sysClr', 'scrgbClr'])
const colorTransformTypes = new Set<ColorTransformType>(['tint', 'shade', 'lumMod', 'lumOff', 'alpha', 'alphaMod', 'alphaOff'])

function malformedTheme(theme: Theme): Error {
  return new Error(`PPTX export theme source malformed: ${theme.id}`)
}

function unsupportedColor(theme: Theme, slot: string): Error {
  return new Error(`PPTX export theme color unsupported: ${theme.id}.${slot}`)
}

function parsePercentage(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) && Number.isInteger(number) && number >= 0 && number <= 100000 ? number : undefined
}

function parseHexColor(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^[0-9A-F]{6}$/u.test(normalized) ? normalized : undefined
}

function parseColor(node: XmlElement): Color | undefined {
  let color: Color | undefined
  if (node.localName === 'srgbClr') {
    const value = parseHexColor(node.attributes.val)
    if (value) color = { type: 'srgb', v: value }
  } else if (node.localName === 'schemeClr') {
    const value = node.attributes.val?.trim()
    if (value) color = { type: 'scheme', v: value }
  } else if (node.localName === 'prstClr') {
    const value = node.attributes.val?.trim()
    if (value) color = { type: 'preset', v: value }
  } else if (node.localName === 'sysClr') {
    const value = parseHexColor(node.attributes.lastClr)
    if (value) color = { type: 'system', v: value }
  } else if (node.localName === 'scrgbClr') {
    const red = parsePercentage(node.attributes.r)
    const green = parsePercentage(node.attributes.g)
    const blue = parsePercentage(node.attributes.b)
    if (red !== undefined && green !== undefined && blue !== undefined) color = { type: 'scrgb', v: `${red},${green},${blue}` }
  }
  if (!color) return undefined
  const transforms: ColorTransform[] = []
  for (const child of node.children) {
    if (!colorTransformTypes.has(child.localName as ColorTransformType)) continue
    const value = parsePercentage(child.attributes.val)
    if (value !== undefined) transforms.push({ type: child.localName as ColorTransformType, value })
  }
  return transforms.length > 0 ? { ...color, transforms } : color
}

interface SourceColor {
  node?: XmlElement
  color?: Color
  invalidKnownNode: boolean
}

function sourceColor(slot: XmlElement): SourceColor {
  let invalidKnownNode = false
  for (const child of slot.children) {
    if (!colorNodeNames.has(child.localName)) continue
    const color = parseColor(child)
    if (color) return { node: child, color, invalidKnownNode }
    invalidKnownNode = true
  }
  return { invalidKnownNode }
}

function colorsEqual(left: Color, right: Color): boolean {
  if (left.type !== right.type || left.v !== right.v) return false
  const leftTransforms = left.transforms ?? []
  const rightTransforms = right.transforms ?? []
  return leftTransforms.length === rightTransforms.length
    && leftTransforms.every((transform, index) => {
      const other = rightTransforms[index]
      return other?.type === transform.type && other.value === transform.value
    })
}

function isXmlCharacterAllowed(codePoint: number): boolean {
  return codePoint === 0x9
    || codePoint === 0xA
    || codePoint === 0xD
    || (codePoint >= 0x20 && codePoint <= 0xD7FF)
    || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
    || (codePoint >= 0x10000 && codePoint <= 0x10FFFF)
}

function hasUnsupportedXmlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && !isXmlCharacterAllowed(codePoint)) return true
  }
  return false
}

function validatedTransforms(theme: Theme, slot: string, value: unknown): ColorTransform[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw unsupportedColor(theme, slot)
  const transforms: ColorTransform[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw unsupportedColor(theme, slot)
    const transform = candidate as Record<string, unknown>
    if (typeof transform.type !== 'string' || !colorTransformTypes.has(transform.type as ColorTransformType)) throw unsupportedColor(theme, slot)
    if (typeof transform.value !== 'number' || !Number.isInteger(transform.value) || transform.value < 0 || transform.value > 100000) throw unsupportedColor(theme, slot)
    transforms.push({ type: transform.type as ColorTransformType, value: transform.value })
  }
  return transforms.length > 0 ? transforms : undefined
}

function validateColor(theme: Theme, slot: string, value: unknown): Color {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unsupportedColor(theme, slot)
  const color = value as Record<string, unknown>
  if (typeof color.type !== 'string' || !['srgb', 'scheme', 'preset', 'system', 'scrgb'].includes(color.type)) throw unsupportedColor(theme, slot)
  if (typeof color.v !== 'string' || color.v.length === 0 || hasUnsupportedXmlCharacter(color.v)) throw unsupportedColor(theme, slot)

  let normalizedValue: string
  if (color.type === 'srgb' || color.type === 'system') {
    const normalized = parseHexColor(color.v)
    if (!normalized) throw unsupportedColor(theme, slot)
    normalizedValue = normalized
  } else if (color.type === 'scrgb') {
    const channels = color.v.split(',')
    if (channels.length !== 3 || channels.some((channel) => parsePercentage(channel) === undefined)) throw unsupportedColor(theme, slot)
    normalizedValue = channels.map((channel) => String(parsePercentage(channel))).join(',')
  } else {
    normalizedValue = color.v.trim()
    if (normalizedValue.length === 0) throw unsupportedColor(theme, slot)
  }

  const transforms = validatedTransforms(theme, slot, color.transforms)
  return {
    type: color.type as Color['type'],
    v: normalizedValue,
    ...(transforms ? { transforms } : {}),
  }
}

function namespacePrefix(name: string): string {
  const separator = name.lastIndexOf(':')
  return separator >= 0 ? name.slice(0, separator + 1) : ''
}

function isSelfClosing(xml: string, element: XmlElement): boolean {
  const openingEnd = tagEnd(xml, element.start + 1)
  return /\/\s*>$/u.test(xml.slice(element.start, openingEnd))
}

function closingStart(xml: string, element: XmlElement): number {
  const openingEnd = tagEnd(xml, element.start + 1)
  let candidate = xml.lastIndexOf('</', element.end - 1)
  while (candidate >= openingEnd) {
    const content = xml.slice(candidate + 2, element.end - 1).trim()
    if (content === element.name) return candidate
    candidate = xml.lastIndexOf('</', candidate - 1)
  }
  throw new Error('closing tag missing')
}

function expandSelfClosing(xml: string, element: XmlElement, content: string): Replacement {
  const openingEnd = tagEnd(xml, element.start + 1)
  const opening = xml.slice(element.start, openingEnd).replace(/\/\s*>$/u, '>')
  return { start: element.start, end: element.end, value: `${opening}${content}</${element.name}>` }
}

function effectiveColor(theme: Theme, slot: ThemeColorSlot, color: unknown): Color {
  return color === null ? DEFAULT_THEME_COLORS[slot] : validateColor(theme, slot, color)
}

function serializedColor(theme: Theme, slot: ThemeColorSlot, color: Color, prefix: string): string {
  try {
    return serializeColorXml(color, prefix)
  } catch {
    throw unsupportedColor(theme, slot)
  }
}

export function rewriteThemeXml(source: string, theme: Theme): string {
  let roots: XmlElement[]
  try {
    roots = scanXml(source)
  } catch {
    throw malformedTheme(theme)
  }
  const scheme = descendants(roots, 'clrScheme')[0]
  if (!scheme) throw malformedTheme(theme)

  const slots = new Map<string, XmlElement>()
  for (const child of scheme.children) {
    if (themeColorSlotSet.has(child.localName) && !slots.has(child.localName)) slots.set(child.localName, child)
  }

  const replacements: Replacement[] = []
  const missing: string[] = []
  for (const slot of themeColorSlots) {
    const value = theme.colors[slot]
    if (value === undefined) continue
    const color = effectiveColor(theme, slot, value)
    const sourceSlot = slots.get(slot)
    if (!sourceSlot) {
      const colorXml = serializedColor(theme, slot, color, namespacePrefix(scheme.name))
      missing.push(`<${namespacePrefix(scheme.name)}${slot}>${colorXml}</${namespacePrefix(scheme.name)}${slot}>`)
      continue
    }

    const parsed = sourceColor(sourceSlot)
    if (parsed.invalidKnownNode && !parsed.color) throw malformedTheme(theme)
    const prefix = namespacePrefix(sourceSlot.name)
    const colorXml = serializedColor(theme, slot, color, prefix)
    if (parsed.color && colorsEqual(parsed.color, color)) continue
    if (parsed.node) {
      replacements.push({ start: parsed.node.start, end: parsed.node.end, value: colorXml })
      continue
    }
    if (isSelfClosing(source, sourceSlot)) {
      replacements.push(expandSelfClosing(source, sourceSlot, colorXml))
    } else {
      const insertAt = closingStart(source, sourceSlot)
      replacements.push({ start: insertAt, end: insertAt, value: colorXml })
    }
  }

  if (missing.length > 0) {
    if (isSelfClosing(source, scheme)) {
      const openingEnd = tagEnd(source, scheme.start + 1)
      const opening = source.slice(scheme.start, openingEnd).replace(/\/\s*>$/u, '>')
      replacements.push({ start: scheme.start, end: scheme.end, value: `${opening}${missing.join('')}</${scheme.name}>` })
    } else {
      const insertAt = closingStart(source, scheme)
      replacements.push({ start: insertAt, end: insertAt, value: missing.join('') })
    }
  }

  return replacements.length > 0 ? replaceRanges(source, replacements) : source
}
