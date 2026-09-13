import { colorTransformValueIsValid, isOoxmlToken, DEFAULT_THEME_COLORS, DEFAULT_THEME_FONTS, type Color, type ColorTransform, type Fill, type Theme, type ThemeColorSlot, type ThemeFontScript, type ThemeFontSlot } from '@ppt4ai/model'
import { colorChoiceNames, colorsEqual, sourceColorNode, sourceFill } from './color-source.js'
import { fillNodeNames, fillNodeReplacements, fillsEqual, serializeFillPrefixed } from './fill-patch.js'
import { themeLineReplacements, validateLineProperties } from './theme-line-patch.js'
import { serializeColorXml } from './standalone-xml.js'
import { escapeXml } from './text-xml.js'
import { descendants, attributeReplacements, replaceRanges, scanXml, tagEnd, type Replacement, type XmlElement } from './xml-range.js'

const themeColorSlots = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const
const themeColorSlotSet = new Set<string>(themeColorSlots)
const themeFontSlots = ['major', 'minor'] as const
const themeFontScripts = ['latin', 'ea', 'cs'] as const

function malformedTheme(theme: Theme): Error {
  return new Error(`PPTX export theme source malformed: ${theme.id}`)
}

function unsupportedColor(theme: Theme, slot: string): Error {
  return new Error(`PPTX export theme color unsupported: ${theme.id}.${slot}`)
}

function unsupportedFont(theme: Theme, slot: ThemeFontSlot, script: ThemeFontScript): Error {
  return new Error(`PPTX export theme font unsupported: ${theme.id}.${slot}.${script}`)
}

function parseHexColor(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^[0-9A-F]{6}$/u.test(normalized) ? normalized : undefined
}

/** A `scrgbClr` channel, on the model's own terms: a thousandth of a percent, integral and in range. */
function parsePercentage(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) && Number.isInteger(number) && number >= 0 && number <= 100000 ? number : undefined
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

  // The system colour's name rides along, or the serializer falls back to `windowText` and a light slot
  // ends up naming the dark colour. Rebuilding the colour without it is how a new field goes missing.
  if (color.systemName !== undefined && !isOoxmlToken(color.systemName)) throw unsupportedColor(theme, slot)
  const transforms = validatedTransforms(theme, slot, color.transforms)
  return {
    type: color.type as Color['type'],
    v: normalizedValue,
    ...(color.systemName === undefined ? {} : { systemName: color.systemName }),
    ...(transforms ? { transforms } : {}),
  }
}

function unsupportedFormatFill(theme: Theme, field: string): Error {
  return new Error('PPTX export theme format fill unsupported: ' + theme.id + '.' + field)
}

function isPercentage(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100000
}

/** The same color normalization as clrScheme, also applied to every stop and pattern color. */
function validateStyleFill(theme: Theme, field: string, value: Fill): Fill {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unsupportedFormatFill(theme, field)
  const color = validateColor(theme, field + '.color', value.color)
  const gradient = value.gradient
  if (gradient !== undefined) {
    if (!gradient || typeof gradient !== 'object' || Array.isArray(gradient)
      || !Array.isArray(gradient.stops) || gradient.stops.length < 2) throw unsupportedFormatFill(theme, field)
    const stops = gradient.stops.map((stop) => {
      if (!stop || !isPercentage(stop.pos)) throw unsupportedFormatFill(theme, field)
      return { pos: stop.pos, color: validateColor(theme, field + '.gradient.stops', stop.color) }
    })
    if (gradient.angle !== undefined && !Number.isInteger(gradient.angle)) throw unsupportedFormatFill(theme, field)
    if (gradient.scaled !== undefined && typeof gradient.scaled !== 'boolean') throw unsupportedFormatFill(theme, field)
    if (gradient.path !== undefined && !['circle', 'rect', 'shape'].includes(gradient.path)) throw unsupportedFormatFill(theme, field)
    const rect = gradient.fillToRect
    if (rect !== undefined) {
      if (!rect || typeof rect !== 'object' || Array.isArray(rect)) throw unsupportedFormatFill(theme, field)
      for (const side of ['left', 'top', 'right', 'bottom'] as const) {
        if (rect[side] !== undefined && !isPercentage(rect[side])) throw unsupportedFormatFill(theme, field)
      }
    }
    return { color, gradient: { ...gradient, stops } }
  }
  const pattern = value.pattern
  if (pattern !== undefined) {
    if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern) || !isOoxmlToken(pattern.preset)) throw unsupportedFormatFill(theme, field)
    return {
      color,
      pattern: {
        preset: pattern.preset,
        foreground: validateColor(theme, field + '.pattern.foreground', pattern.foreground),
        background: validateColor(theme, field + '.pattern.background', pattern.background),
      },
    }
  }
  return { color }
}

/** A kind change must carry a prefix binding that was declared only on the old fill node. */
function keepFillNamespace(node: XmlElement, replacement: Replacement): Replacement {
  if (replacement.start !== node.start || replacement.end !== node.end) return replacement
  const prefix = namespacePrefix(node.name)
  const declaration = prefix ? 'xmlns:' + prefix.slice(0, -1) : 'xmlns'
  const namespace = node.attributes[declaration]
  if (namespace === undefined) return replacement
  return {
    ...replacement,
    value: replacement.value.replace(/^<[^\s/>]+/u, (opening) => opening + ' ' + declaration + '="' + escapeXml(namespace) + '"'),
  }
}

/**
 * Only existing fill/background slots are writable here. Match the importer's all-children indexing:
 * a picture or unknown child occupies a null slot too, and filtering it out would shift later edits.
 * Missing/extra entries do not change the list structure. Null clears a readable fill, but cannot
 * distinguish an imported picture/unknown fill from an intentional edit, so those stay in the source.
 */
function formatFillReplacements(source: string, roots: XmlElement[], theme: Theme): Replacement[] {
  const scheme = descendants(roots, 'fmtScheme')[0]
  if (!scheme || !theme.formatScheme) return []
  const replacements: Replacement[] = []
  for (const [key, tag] of [['fillStyles', 'fillStyleLst'], ['backgroundStyles', 'bgFillStyleLst']] as const) {
    const entries = theme.formatScheme[key]
    if (entries === undefined) continue
    if (!Array.isArray(entries)) throw unsupportedFormatFill(theme, 'formatScheme.' + key)
    const list = scheme.children.find((child) => child.localName === tag)
    if (!list) continue
    for (const [index, node] of list.children.entries()) {
      const entry = entries[index]
      if (entry === undefined || !fillNodeNames.has(node.localName)) continue
      const existing = sourceFill(node)
      if (entry === null) {
        if (existing) replacements.push(keepFillNamespace(node, {
          start: node.start, end: node.end, value: '<' + namespacePrefix(node.name) + 'noFill/>',
        }))
        continue
      }
      const fill = validateStyleFill(theme, 'formatScheme.' + key + '[' + index + ']', entry)
      if (fillsEqual(existing, fill)) continue
      // An imported null has no modeled parts to preserve. An explicit replacement may therefore
      // rebuild that slot, also avoiding overlapping child insertions into an empty source node.
      const patches = existing ? fillNodeReplacements(source, node, existing, fill) : [{
        start: node.start, end: node.end, value: serializeFillPrefixed(fill, namespacePrefix(node.name)),
      }]
      replacements.push(...patches.map((replacement) => keepFillNamespace(node, replacement)))
    }
  }
  return replacements
}

/** Line entries keep the same positional map as the imported fill lists, including null slots. */
function formatLineReplacements(source: string, roots: XmlElement[], theme: Theme): Replacement[] {
  const scheme = descendants(roots, 'fmtScheme')[0]
  const entries = theme.formatScheme?.lineStyles
  if (!scheme || entries === undefined) return []
  if (!Array.isArray(entries)) throw new Error('PPTX export theme line unsupported: ' + theme.id + '.formatScheme.lineStyles')
  const list = scheme.children.find((child) => child.localName === 'lnStyleLst')
  const replacements: Replacement[] = []
  for (const [index, node] of (list?.children ?? []).entries()) {
    const entry = entries[index]
    if (entry === undefined || node.localName !== 'ln') continue
    const field = 'formatScheme.lineStyles[' + index + ']'
    const line = entry === null ? null : {
      ...validateStyleFill(theme, field, entry),
      ...validateLineProperties(entry, theme.id + '.' + field),
    }
    replacements.push(...themeLineReplacements(source, node, line))
  }
  return replacements
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
      // The trimmed comparison is the importer's, so a source that pads a typeface is not a change; the
      // patcher's own value comparison would call it one.
      if ((node.attributes.typeface ?? '').trim() === typeface) continue
      replacements.push(...attributeReplacements(xml, node, 'typeface', typeface))
    }
    if (missingScripts.length > 0) replacements.push(...insertChildrenXml(xml, collection, themeFontScripts, missingScripts))
  }

  if (missingCollections.length > 0) {
    replacements.push(...insertChildrenXml(xml, scheme, themeFontSlots.map((slot) => `${slot}Font`), missingCollections))
  }
  return replacements
}

/**
 * The attributes a colour of this type states itself in. A system colour writes its name too when the
 * model carries one; when it does not, the source's own `val` is left alone rather than guessed at.
 */
function colorValueAttributes(color: Color, node: XmlElement): Array<[string, string]> {
  if (color.type === 'system') {
    return [['lastClr', color.v], ['val', color.systemName ?? node.attributes.val ?? 'windowText']]
  }
  if (color.type === 'scrgb') {
    const channels = color.v.split(',')
    return [['r', channels[0] ?? '0'], ['g', channels[1] ?? '0'], ['b', channels[2] ?? '0']]
  }
  return [['val', color.v]]
}

const colorElementNames: Readonly<Record<Color['type'], string>> = {
  srgb: 'srgbClr',
  scheme: 'schemeClr',
  preset: 'prstClr',
  system: 'sysClr',
  scrgb: 'scrgbClr',
}

/**
 * One colour element, patched rather than replaced. Three levels, the same shape the fill patcher
 * settled on: a different kind of colour swaps the element, since `EG_ColorChoice` is a choice; a changed
 * value touches only the attributes carrying it, so a system colour's `@val` takes the model's own name
 * and the source's word survives when the model has none; a changed transform list swaps the children.
 *
 * The transforms go as a block rather than one at a time because the mirror skips a token child whose
 * `val` is out of range, so the i-th child is not the i-th transform, and a type may legally appear twice.
 */
function colorNodeReplacements(
  xml: string,
  theme: Theme,
  slot: ThemeColorSlot,
  node: XmlElement,
  existing: Color | undefined,
  color: Color,
  prefix: string,
): Replacement[] {
  if (node.localName !== colorElementNames[color.type]) {
    return [{ start: node.start, end: node.end, value: serializedColor(theme, slot, color, prefix) }]
  }
  const replacements = colorValueAttributes(color, node).flatMap(([name, value]) => attributeReplacements(xml, node, name, value))
  const transforms = color.transforms ?? []
  const before = existing?.transforms ?? []
  const transformsEqual = before.length === transforms.length
    && transforms.every((transform, index) => before[index]?.type === transform.type && before[index]?.value === transform.value)
  if (transformsEqual) return replacements
  const value = transforms.map((transform) => serializeColorTransform(prefix, transform)).join('')
  const first = node.children[0]
  if (!first) {
    if (value === '') return replacements
    return [...replacements, isSelfClosing(xml, node)
      ? expandSelfClosing(xml, node, value)
      : { start: closingStart(xml, node), end: closingStart(xml, node), value }]
  }
  // An emptied colour collapses back to the self-closing form rather than leaving `<a:srgbClr …></a:srgbClr>`,
  // and only the opening tag's `>` is touched, so its attributes keep their bytes.
  if (value === '') {
    const openingEnd = tagEnd(xml, node.start + 1)
    return [...replacements, { start: openingEnd - 1, end: node.end, value: '/>' }]
  }
  return [...replacements, { start: first.start, end: closingStart(xml, node), value }]
}

function serializeColorTransform(prefix: string, transform: ColorTransform): string {
  const attribute = transform.value === undefined ? '' : ` val="${escapeXml(String(transform.value))}"`
  return `<${prefix}${transform.type}${attribute}/>`
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

    const parsed = sourceColorNode(sourceSlot)
    if (parsed && colorsEqual(parsed.color, color)) continue
    const prefix = namespacePrefix(sourceSlot.name)
    // A colour element already there is patched, whichever of `EG_ColorChoice` it is: replacing the node
    // costs the attributes this project does not model, and appending beside one it cannot read leaves
    // two colours inside a single slot, which no reader accepts.
    const existingNode = parsed?.node ?? sourceSlot.children.find((child) => colorChoiceNames.has(child.localName))
    if (existingNode) {
      replacements.push(...colorNodeReplacements(source, theme, slot, existingNode, parsed?.color, color, prefix))
      continue
    }
    const colorXml = serializedColor(theme, slot, color, prefix)
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

  replacements.push(...formatFillReplacements(source, roots, theme))
  replacements.push(...formatLineReplacements(source, roots, theme))

  return replacements.length > 0 ? replaceRanges(source, replacements) : source
}
