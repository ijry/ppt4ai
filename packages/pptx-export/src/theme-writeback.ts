import { colorTransformValueIsValid, isOoxmlToken, DEFAULT_THEME_COLORS, DEFAULT_THEME_FONTS, type Color, type ColorTransform, type Theme, type ThemeColorSlot, type ThemeFontScript, type ThemeFontSlot } from '@ppt4ai/model'
import { serializeColorXml } from './standalone-xml.js'
import { escapeXml } from './text-xml.js'
import { descendants, replaceRanges, scanXml, tagEnd, type Replacement, type XmlElement } from './xml-range.js'

const themeColorSlots = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const
const themeColorSlotSet = new Set<string>(themeColorSlots)
const themeFontSlots = ['major', 'minor'] as const
const themeFontScripts = ['latin', 'ea', 'cs'] as const
const colorNodeNames = new Set(['srgbClr', 'schemeClr', 'prstClr', 'sysClr', 'scrgbClr'])

function malformedTheme(theme: Theme): Error {
  return new Error(`PPTX export theme source malformed: ${theme.id}`)
}

function unsupportedColor(theme: Theme, slot: string): Error {
  return new Error(`PPTX export theme color unsupported: ${theme.id}.${slot}`)
}

function unsupportedFont(theme: Theme, slot: ThemeFontSlot, script: ThemeFontScript): Error {
  return new Error(`PPTX export theme font unsupported: ${theme.id}.${slot}.${script}`)
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
  // The same rule the importer's `parseColorTransforms` uses, so a source `satMod` or a valueless
  // `a:comp` is read rather than dropped — dropping it made an untouched theme colour compare changed.
  const transforms: ColorTransform[] = []
  for (const child of node.children) {
    if (!isOoxmlToken(child.localName)) continue
    const raw = child.attributes.val
    if (raw === undefined) {
      transforms.push({ type: child.localName })
      continue
    }
    const value = Number(raw)
    if (raw.trim() !== '' && Number.isInteger(value) && colorTransformValueIsValid(child.localName, value)) {
      transforms.push({ type: child.localName, value })
    }
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

/**
 * The model's own transform rule, shared rather than copied: any OOXML token is a transform, a `*Mod`
 * value is not capped at 100000, and the switch forms carry no value. The private allowlist this
 * replaces made a theme colour with a `satMod` throw on export while `validateDocument` passed it.
 */
function validatedTransforms(theme: Theme, slot: string, value: unknown): ColorTransform[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw unsupportedColor(theme, slot)
  const transforms: ColorTransform[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw unsupportedColor(theme, slot)
    const transform = candidate as Record<string, unknown>
    if (!isOoxmlToken(transform.type)) throw unsupportedColor(theme, slot)
    if (transform.value === undefined) {
      transforms.push({ type: transform.type })
      continue
    }
    if (typeof transform.value !== 'number' || !colorTransformValueIsValid(transform.type, transform.value)) {
      throw unsupportedColor(theme, slot)
    }
    transforms.push({ type: transform.type, value: transform.value })
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

function validatedTypeface(theme: Theme, slot: ThemeFontSlot, script: ThemeFontScript, value: string | null | undefined): string {
  if (value === null || value === undefined) return DEFAULT_THEME_FONTS[slot][script]
  if (typeof value !== 'string' || value.length === 0 || hasUnsupportedXmlCharacter(value)) throw unsupportedFont(theme, slot, script)
  return value
}

/**
 * Rewrites just the quoted value of one attribute. The unmodeled neighbours a real theme carries —
 * `panose`, `pitchFamily`, `charset` — keep their bytes, quote style and order.
 */
function attributeReplacement(xml: string, element: XmlElement, name: string, value: string): Replacement {
  const opening = xml.slice(element.start, tagEnd(xml, element.start + 1))
  const match = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*')`, 'u').exec(opening)
  if (!match) {
    const insertAt = element.start + 1 + element.name.length
    return { start: insertAt, end: insertAt, value: ` ${name}="${escapeXml(value)}"` }
  }
  const start = element.start + match.index + match[0].length - match[1]!.length
  return { start, end: start + match[1]!.length, value: `"${escapeXml(value)}"` }
}

/** Unknown children — `a:font`, `a:extLst` — sort after every name in the schema sequence. */
function childRank(order: readonly string[], localName: string): number {
  const index = order.indexOf(localName)
  return index >= 0 ? index : order.length
}

/**
 * Inserts children at their schema-sequence position. Callers pass them in schema order, so the
 * ones that share an insertion point stay ordered without depending on how ranges are applied.
 */
function insertChildrenXml(xml: string, parent: XmlElement, order: readonly string[], children: ReadonlyArray<{ localName: string; xml: string }>): Replacement[] {
  const byOffset = new Map<number, string>()
  for (const child of children) {
    const rank = childRank(order, child.localName)
    const successor = parent.children.find((candidate) => childRank(order, candidate.localName) > rank)
    const offset = successor?.start ?? -1
    byOffset.set(offset, (byOffset.get(offset) ?? '') + child.xml)
  }
  return [...byOffset].map(([offset, content]) => {
    if (offset >= 0) return { start: offset, end: offset, value: content }
    if (isSelfClosing(xml, parent)) return expandSelfClosing(xml, parent, content)
    const insertAt = closingStart(xml, parent)
    return { start: insertAt, end: insertAt, value: content }
  })
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

function fontNodeXml(prefix: string, script: ThemeFontScript, typeface: string): string {
  return `<${prefix}${script} typeface="${escapeXml(typeface)}"/>`
}

/**
 * The comparison trims the source value because the importer trims it too, so a theme nobody edited
 * never gets rewritten over stray whitespace.
 */
function fontReplacements(xml: string, theme: Theme, scheme: XmlElement): Replacement[] {
  const replacements: Replacement[] = []
  const missingCollections: Array<{ localName: string; xml: string }> = []
  const schemePrefix = namespacePrefix(scheme.name)

  for (const slot of themeFontSlots) {
    const face = theme.fonts?.[slot]
    if (!face || themeFontScripts.every((script) => face[script] === undefined)) continue
    const collection = scheme.children.find((child) => child.localName === `${slot}Font`)
    if (!collection) {
      // CT_FontCollection requires all three scripts, so a collection built from scratch carries the
      // built-in default wherever the model says nothing — the same value serializeThemeXml writes.
      const scripts = themeFontScripts.map((script) => fontNodeXml(schemePrefix, script, validatedTypeface(theme, slot, script, face[script]))).join('')
      missingCollections.push({ localName: `${slot}Font`, xml: `<${schemePrefix}${slot}Font>${scripts}</${schemePrefix}${slot}Font>` })
      continue
    }

    const collectionPrefix = namespacePrefix(collection.name)
    const missingScripts: Array<{ localName: string; xml: string }> = []
    for (const script of themeFontScripts) {
      if (face[script] === undefined) continue
      const typeface = validatedTypeface(theme, slot, script, face[script])
      const node = collection.children.find((child) => child.localName === script)
      if (!node) {
        missingScripts.push({ localName: script, xml: fontNodeXml(collectionPrefix, script, typeface) })
        continue
      }
      if ((node.attributes.typeface ?? '').trim() === typeface) continue
      replacements.push(attributeReplacement(xml, node, 'typeface', typeface))
    }
    if (missingScripts.length > 0) replacements.push(...insertChildrenXml(xml, collection, themeFontScripts, missingScripts))
  }

  if (missingCollections.length > 0) {
    replacements.push(...insertChildrenXml(xml, scheme, themeFontSlots.map((slot) => `${slot}Font`), missingCollections))
  }
  return replacements
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

  // Nothing here runs unless the model actually carries a typeface: a source fontScheme we never
  // touched has to come back byte for byte, self-closing and childless included.
  const modelHasFonts = themeFontSlots.some((slot) => themeFontScripts.some((script) => theme.fonts?.[slot]?.[script] !== undefined))
  if (modelHasFonts) {
    const fontScheme = descendants(roots, 'fontScheme')[0]
    if (!fontScheme) throw malformedTheme(theme)
    replacements.push(...fontReplacements(source, theme, fontScheme))
  }

  return replacements.length > 0 ? replaceRanges(source, replacements) : source
}
