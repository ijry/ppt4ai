import type { Color, ColorMap, ColorMapKey, ColorTransformType, ElementDefaults, Fill, Rect, TextBody } from '@ppt4ai/model'
import { serializeColorXml, serializeFillXml, serializeTextBodyXml } from './standalone-xml.js'
import { sourceTextBody } from './text-source.js'
import { decodeXml, descendants, replaceRanges, scanXml, tagEnd, type Replacement, type XmlElement } from './xml-range.js'

const colorNodeNames = new Set(['srgbClr', 'schemeClr', 'prstClr', 'sysClr', 'scrgbClr'])
const fillNodeNames = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'])
const colorTransformTypes = new Set<ColorTransformType>(['tint', 'shade', 'lumMod', 'lumOff', 'alpha', 'alphaMod', 'alphaOff'])
const colorTypes = new Set(['srgb', 'scheme', 'preset', 'system', 'scrgb'])
const themeColorSlots = new Set(['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'])
/** The twelve `CT_ColorMapping` slots, in the order both the writeback and the standalone path write them. */
export const colorMapKeys = ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const

type ColorMapPart = 'master' | 'layout' | 'slide'

function failure(kind: string, id: string, detail: string): Error {
  return new Error(`PPTX export ${kind} ${detail}: ${id}`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function isXmlCharacterAllowed(codePoint: number): boolean {
  return codePoint === 0x9
    || codePoint === 0xA
    || codePoint === 0xD
    || (codePoint >= 0x20 && codePoint <= 0xD7FF)
    || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
    || (codePoint >= 0x10000 && codePoint <= 0x10FFFF)
}

function assertXmlCharacters(value: string, kind: string, id: string): void {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && !isXmlCharacterAllowed(codePoint)) throw failure(kind, id, `unsupported XML character U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`)
  }
}

function escapeXml(value: string | number, kind: string, id: string): string {
  const source = String(value)
  assertXmlCharacters(source, kind, id)
  return source
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function namespacePrefix(name: string): string {
  const separator = name.lastIndexOf(':')
  return separator >= 0 ? name.slice(0, separator + 1) : ''
}

function qualifiedName(sourceName: string, localName: string): string {
  return `${namespacePrefix(sourceName)}${localName}`
}

function openingEnd(xml: string, element: XmlElement): number {
  return tagEnd(xml, element.start + 1)
}

function isSelfClosing(xml: string, element: XmlElement): boolean {
  return /\/\s*>$/u.test(xml.slice(element.start, openingEnd(xml, element)))
}

function closingStart(xml: string, element: XmlElement): number {
  const start = openingEnd(xml, element)
  let candidate = xml.lastIndexOf('</', element.end - 1)
  while (candidate >= start) {
    const name = xml.slice(candidate + 2, element.end - 1).trim()
    if (name === element.name) return candidate
    candidate = xml.lastIndexOf('</', candidate - 1)
  }
  throw new Error('closing tag missing')
}

function insertElementContent(xml: string, element: XmlElement, value: string, kind: string, id: string): Replacement {
  if (isSelfClosing(xml, element)) {
    const opening = xml.slice(element.start, openingEnd(xml, element)).replace(/\/\s*>$/u, '>')
    return { start: element.start, end: element.end, value: `${opening}${value}</${element.name}>` }
  }
  let insertAt: number
  try {
    insertAt = closingStart(xml, element)
  } catch {
    throw failure(kind, id, 'source XML closing tag missing')
  }
  return { start: insertAt, end: insertAt, value }
}

function updateOpeningAttribute(raw: string, name: string, value: string, kind: string, id: string): string {
  const expression = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)(["'])([\\s\\S]*?)\\2`, 'u')
  const escaped = escapeXml(value, kind, id)
  if (expression.test(raw)) return raw.replace(expression, (_match, prefix: string, quote: string) => `${prefix}${quote}${escaped}${quote}`)
  const close = raw.search(/\/?\s*>$/u)
  if (close < 0) throw failure(kind, id, 'source XML opening tag malformed')
  return `${raw.slice(0, close)} ${name}="${escaped}"${raw.slice(close)}`
}

function updateElementAttribute(xml: string, element: XmlElement, name: string, value: string | number | undefined, kind: string, id: string): Replacement | undefined {
  const end = openingEnd(xml, element)
  const raw = xml.slice(element.start, end)
  const updated = value === undefined
    ? raw.replace(new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(["'])[^"']*\\1`, 'u'), '')
    : updateOpeningAttribute(raw, name, String(value), kind, id)
  return updated === raw ? undefined : { start: element.start, end, value: updated }
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function parsePercentage(value: string | undefined): number | undefined {
  const number = parseNumber(value)
  return number !== undefined && Number.isInteger(number) && number >= 0 && number <= 100000 ? number : undefined
}

function parseHexColor(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^[0-9A-F]{6}$/u.test(normalized) ? normalized : undefined
}

interface SourceColor {
  node?: XmlElement
  color?: Color
  invalidKnownNode: boolean
}

function sourceColor(node: XmlElement | undefined): SourceColor {
  if (!node) return { invalidKnownNode: false }
  let invalidKnownNode = false
  for (const child of node.children) {
    if (!colorNodeNames.has(child.localName)) continue
    let color: Color | undefined
    if (child.localName === 'srgbClr') {
      const value = parseHexColor(child.attributes.val)
      if (value) color = { type: 'srgb', v: value }
    } else if (child.localName === 'schemeClr') {
      const value = child.attributes.val?.trim()
      if (value) color = { type: 'scheme', v: value }
    } else if (child.localName === 'prstClr') {
      const value = child.attributes.val?.trim()
      if (value) color = { type: 'preset', v: value }
    } else if (child.localName === 'sysClr') {
      const value = parseHexColor(child.attributes.lastClr)
      if (value) color = { type: 'system', v: value }
    } else if (child.localName === 'scrgbClr') {
      const channels = [child.attributes.r, child.attributes.g, child.attributes.b].map(parsePercentage)
      if (channels.every((value) => value !== undefined)) color = { type: 'scrgb', v: channels.join(',') }
    }
    if (!color) {
      invalidKnownNode = true
      continue
    }
    const transforms = child.children.flatMap((transform) => {
      if (!colorTransformTypes.has(transform.localName as ColorTransformType)) return []
      const value = parsePercentage(transform.attributes.val)
      return value === undefined ? [] : [{ type: transform.localName as ColorTransformType, value }]
    })
    return { node: child, color: transforms.length > 0 ? { ...color, transforms } : color, invalidKnownNode }
  }
  return { invalidKnownNode }
}

function colorsEqual(left: Color | undefined, right: Color | undefined): boolean {
  if (!left || !right) return left === right
  if (left.type !== right.type || left.v !== right.v) return false
  const leftTransforms = left.transforms ?? []
  const rightTransforms = right.transforms ?? []
  return leftTransforms.length === rightTransforms.length
    && leftTransforms.every((transform, index) => {
      const other = rightTransforms[index]
      return other?.type === transform.type && other.value === transform.value
    })
}

function validateColor(value: unknown, kind: string, id: string, field: string): Color {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(kind, id, `unsupported color ${field}`)
  const candidate = value as Record<string, unknown>
  if (typeof candidate.type !== 'string' || !colorTypes.has(candidate.type)) throw failure(kind, id, `unsupported color ${field}`)
  if (typeof candidate.v !== 'string' || candidate.v.length === 0) throw failure(kind, id, `unsupported color ${field}`)
  let normalized: string
  if (candidate.type === 'srgb' || candidate.type === 'system') {
    normalized = parseHexColor(candidate.v) ?? ''
    if (!normalized) throw failure(kind, id, `unsupported color ${field}`)
  } else if (candidate.type === 'scrgb') {
    const channels = candidate.v.split(',').map((channel) => parsePercentage(channel))
    if (channels.length !== 3 || channels.some((channel) => channel === undefined)) throw failure(kind, id, `unsupported color ${field}`)
    normalized = channels.join(',')
  } else {
    normalized = candidate.v.trim()
    if (normalized.length === 0) throw failure(kind, id, `unsupported color ${field}`)
  }
  let transforms: Color['transforms']
  if (candidate.transforms !== undefined) {
    if (!Array.isArray(candidate.transforms)) throw failure(kind, id, `unsupported color ${field}`)
    const parsed: Array<{ type: ColorTransformType; value: number }> = []
    for (const transform of candidate.transforms) {
      if (!transform || typeof transform !== 'object' || Array.isArray(transform)) throw failure(kind, id, `unsupported color ${field}`)
      const item = transform as Record<string, unknown>
      if (typeof item.type !== 'string' || !colorTransformTypes.has(item.type as ColorTransformType)
        || typeof item.value !== 'number' || !Number.isInteger(item.value) || item.value < 0 || item.value > 100000) throw failure(kind, id, `unsupported color ${field}`)
      parsed.push({ type: item.type as ColorTransformType, value: item.value })
    }
    if (parsed.length > 0) transforms = parsed
  }
  return { type: candidate.type as Color['type'], v: normalized, ...(transforms ? { transforms } : {}) }
}

function serializeFill(fill: Fill, prefix: string, kind: string, id: string, field: string): string {
  const color = validateColor(fill.color, kind, id, field)
  try {
    const colorXml = serializeColorXml(color, prefix)
    return `<${prefix}solidFill>${colorXml}</${prefix}solidFill>`
  } catch {
    throw failure(kind, id, `unsupported color ${field}`)
  }
}

function sourceShapeProperties(shape: XmlElement): XmlElement | undefined {
  return descendants(shape.children, 'spPr')[0]
}

function drawingPrefix(shape: XmlElement, fallback = 'a:'): string {
  const properties = sourceShapeProperties(shape)
  const child = properties?.children.find((candidate) => candidate.localName !== 'extLst')
  return child ? namespacePrefix(child.name) : fallback
}

function sourceBounds(shape: XmlElement): Rect | undefined {
  const transform = descendants(shape.children, 'xfrm')[0]
  const offset = transform && descendants(transform.children, 'off')[0]
  const extent = transform && descendants(transform.children, 'ext')[0]
  const values = [offset?.attributes.x, offset?.attributes.y, extent?.attributes.cx, extent?.attributes.cy].map(parseNumber)
  if (values.some((value) => value === undefined)) return undefined
  const [x, y, w, h] = values
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined
  return { x, y, w, h }
}

function sourceRotation(shape: XmlElement): number | undefined {
  const transform = descendants(shape.children, 'xfrm')[0]
  const value = parseNumber(transform?.attributes.rot)
  return value !== undefined && Number.isInteger(value) ? value : undefined
}

/** The placeholder's own `prst` word, compared verbatim now that the model keeps it — see the slide writeback. */
function sourcePreset(shape: XmlElement): string {
  const geometry = descendants(shape.children, 'prstGeom')[0]
  const preset = geometry?.attributes.prst?.trim()
  return preset ? preset : 'rect'
}

function sourceText(shape: XmlElement): string | undefined {
  const body = descendants(shape.children, 'txBody')[0]
  if (!body) return undefined
  const text = descendants([body], 't').map((node) => decodeXml(node.text) + node.children.map((child) => decodeXml(child.text)).join('')).join('')
  return text + '\n'.repeat(descendants([body], 'br').length)
}

function bodyText(body: TextBody): string {
  let text = ''
  for (const [paragraphIndex, paragraph] of body.paragraphs.entries()) {
    if (paragraphIndex > 0) text += '\n'
    for (const run of paragraph.runs) text += run.text
  }
  return text
}

function placeholderKey(shape: XmlElement): string | undefined {
  const placeholder = descendants(shape.children, 'ph')[0]
  if (!placeholder) return undefined
  const type = placeholder.attributes.type ?? 'body'
  const index = placeholder.attributes.idx
  return index ? `${type}:${index}` : type
}

function qualifyDrawing(fragment: string, prefix: string): string {
  return fragment.replaceAll('<a:', `<${prefix}`).replaceAll('</a:', `</${prefix}`)
}

function qualifyTextBody(fragment: string, presentationPrefix: string, drawingPrefixValue: string): string {
  return fragment
    .replaceAll('<p:', `<${presentationPrefix}`)
    .replaceAll('</p:', `</${presentationPrefix}`)
    .replaceAll('<a:', `<${drawingPrefixValue}`)
    .replaceAll('</a:', `</${drawingPrefixValue}`)
}

function boundsReplacements(xml: string, shape: XmlElement, bounds: Rect, kind: string, id: string): Replacement[] {
  const previous = sourceBounds(shape)
  if (!previous || previous.x === bounds.x && previous.y === bounds.y && previous.w === bounds.w && previous.h === bounds.h) return []
  const transform = descendants(shape.children, 'xfrm')[0]
  const offset = transform && descendants(transform.children, 'off')[0]
  const extent = transform && descendants(transform.children, 'ext')[0]
  if (!offset || !extent) throw failure(kind, id, 'placeholder transform bounds missing')
  const offsetEnd = offset.end
  const extentEnd = extent.end
  const offsetXml = xml.slice(offset.start, offsetEnd)
  const extentXml = xml.slice(extent.start, extentEnd)
  const update = (value: string, name: string, next: number): string => updateOpeningAttribute(value, name, String(next), kind, id)
  return [
    { start: offset.start, end: offsetEnd, value: update(update(offsetXml, 'x', bounds.x), 'y', bounds.y) },
    { start: extent.start, end: extentEnd, value: update(update(extentXml, 'cx', bounds.w), 'cy', bounds.h) },
  ]
}

function rotationReplacements(xml: string, shape: XmlElement, rotation: number | undefined, kind: string, id: string): Replacement[] {
  const transform = descendants(shape.children, 'xfrm')[0]
  if (!transform) return []
  if (sourceRotation(shape) === rotation) return []
  const replacement = updateElementAttribute(xml, transform, 'rot', rotation, kind, id)
  return replacement ? [replacement] : []
}

function geometryReplacements(xml: string, shape: XmlElement, preset: ElementDefaults['preset'], kind: string, id: string): Replacement[] {
  if (!preset || sourcePreset(shape) === preset) return []
  const properties = sourceShapeProperties(shape)
  if (!properties) return []
  const geometry = properties.children.find((child) => child.localName === 'prstGeom' || child.localName === 'custGeom')
  if (geometry?.localName === 'prstGeom' && geometry.attributes.prst !== undefined) {
    const raw = xml.slice(geometry.start, openingEnd(xml, geometry))
    const updated = updateOpeningAttribute(raw, 'prst', preset, kind, id)
    return [{ start: geometry.start, end: openingEnd(xml, geometry), value: updated }]
  }
  const prefix = drawingPrefix(shape)
  const value = `<${prefix}prstGeom prst="${escapeXml(preset, kind, id)}"><${prefix}avLst/></${prefix}prstGeom>`
  if (geometry) return [{ start: geometry.start, end: geometry.end, value }]
  const fill = properties.children.find((child) => fillNodeNames.has(child.localName))
  const line = properties.children.find((child) => child.localName === 'ln')
  const insertion = fill?.start ?? line?.start ?? closingStart(xml, properties)
  return [{ start: insertion, end: insertion, value }]
}

function fillReplacements(xml: string, shape: XmlElement, fill: Fill | undefined, kind: string, id: string, field: string): Replacement[] {
  if (!fill) return []
  const properties = sourceShapeProperties(shape)
  if (!properties) return []
  const fillNode = properties.children.find((child) => fillNodeNames.has(child.localName) && child.localName !== 'ln')
  const source = fillNode?.localName === 'solidFill' ? sourceColor(fillNode) : { invalidKnownNode: false }
  if (source.invalidKnownNode && !source.color) throw failure(kind, id, `placeholder ${field} malformed`)
  const expected = validateColor(fill.color, kind, id, field)
  if (colorsEqual(source.color, expected)) return []
  const value = serializeFill({ color: expected }, fillNode ? namespacePrefix(fillNode.name) : drawingPrefix(shape), kind, id, field)
  if (fillNode) return [{ start: fillNode.start, end: fillNode.end, value }]
  const line = properties.children.find((child) => child.localName === 'ln')
  const insertion = line?.start ?? closingStart(xml, properties)
  return [{ start: insertion, end: insertion, value }]
}

function strokeReplacements(xml: string, shape: XmlElement, stroke: Fill | undefined, kind: string, id: string): Replacement[] {
  if (!stroke) return []
  const properties = sourceShapeProperties(shape)
  if (!properties) return []
  const line = properties.children.find((child) => child.localName === 'ln')
  const fillNode = line?.children.find((child) => fillNodeNames.has(child.localName))
  const source = fillNode?.localName === 'solidFill' ? sourceColor(fillNode) : { invalidKnownNode: false }
  if (source.invalidKnownNode && !source.color) throw failure(kind, id, 'placeholder stroke malformed')
  const expected = validateColor(stroke.color, kind, id, 'stroke')
  if (colorsEqual(source.color, expected)) return []
  if (fillNode) return [{ start: fillNode.start, end: fillNode.end, value: serializeFill({ color: expected }, namespacePrefix(fillNode.name), kind, id, 'stroke') }]
  const value = serializeFill({ color: expected }, line ? namespacePrefix(line.name) : drawingPrefix(shape), kind, id, 'stroke')
  if (line) {
    if (line.children.length > 0) return [{ start: line.children[0]!.start, end: line.children[0]!.start, value }]
    return [insertElementContent(xml, line, value, kind, id)]
  }
  const insertion = properties.children.find((child) => child.localName === 'effectLst' || child.localName === 'extLst')?.start ?? closingStart(xml, properties)
  return [{ start: insertion, end: insertion, value: `<${drawingPrefix(shape)}ln>${value}</${drawingPrefix(shape)}ln>` }]
}

/**
 * A placeholder default body is rewritten only when it differs from the source, compared through the
 * same serializer on both sides -- the same judgement `replaceSlideTables` uses. The old plain-text
 * comparison could not see a formatting change, and unconditionally rewriting would drop whatever
 * the source holds that we do not model (`a:lstStyle`, `a:defRPr`, unknown children).
 */
function textReplacements(xml: string, shape: XmlElement, defaults: ElementDefaults, kind: string, id: string): Replacement[] {
  const hasBody = defaults.body !== undefined
  const hasText = !hasBody && Object.prototype.hasOwnProperty.call(defaults, 'text') && defaults.text !== undefined
  if (!hasBody && !hasText) return []
  const body = hasBody ? defaults.body! : { paragraphs: [{ runs: defaults.text ? [{ text: defaults.text }] : [] }] }
  if (hasBody) {
    const current = sourceTextBody(shape)
    if (current && serializeTextBodyXml(current) === serializeTextBodyXml(body)) return []
  } else if (sourceText(shape) === defaults.text) return []
  const sourceBody = descendants(shape.children, 'txBody')[0]
  const presentationPrefix = sourceBody ? namespacePrefix(sourceBody.name) : namespacePrefix(shape.name)
  const drawing = sourceBody?.children.find((child) => child.localName === 'bodyPr' || child.localName === 'p')
  const value = qualifyTextBody(serializeTextBodyXml(body), presentationPrefix, drawing ? namespacePrefix(drawing.name) : drawingPrefix(shape))
  if (sourceBody) return [{ start: sourceBody.start, end: sourceBody.end, value }]
  return [insertElementContent(xml, shape, value, kind, id)]
}

function rewritePlaceholderDefaults(source: string, defaults: Record<string, ElementDefaults>, kind: string, id: string): string {
  let roots: XmlElement[]
  try {
    roots = scanXml(source)
  } catch {
    throw failure(kind, id, 'source XML malformed')
  }
  if (roots.length === 0) throw failure(kind, id, 'source XML malformed')
  const shapes = descendants(roots, 'sp')
  const replacements: Replacement[] = []
  for (const placeholder of Object.keys(defaults).sort()) {
    const shape = shapes.find((candidate) => placeholderKey(candidate) === placeholder)
    const value = defaults[placeholder]
    if (!shape || !value) continue
    if (value.bounds !== undefined) replacements.push(...boundsReplacements(source, shape, value.bounds, kind, id))
    if (value.rotation !== undefined) replacements.push(...rotationReplacements(source, shape, value.rotation, kind, id))
    replacements.push(...geometryReplacements(source, shape, value.preset, kind, id))
    replacements.push(...fillReplacements(source, shape, value.fill, kind, id, 'fill'))
    replacements.push(...strokeReplacements(source, shape, value.stroke, kind, id))
    replacements.push(...textReplacements(source, shape, value, kind, id))
  }
  return replacements.length > 0 ? replaceRanges(source, replacements) : source
}

function mapAttributes(map: Partial<ColorMap> | undefined, kind: ColorMapPart, id: string): Array<[ColorMapKey, string]> {
  if (!map) return []
  const result: Array<[ColorMapKey, string]> = []
  for (const [key, target] of Object.entries(map)) {
    if (!(colorMapKeys as readonly string[]).includes(key) || typeof target !== 'string' || !themeColorSlots.has(target)) throw failure(`${kind} color map`, id, `unsupported mapping ${key}`)
    result.push([key as ColorMapKey, target])
  }
  return result
}

function mappingElement(roots: XmlElement[], kind: ColorMapPart): XmlElement | undefined {
  if (kind === 'master') return descendants(roots, 'clrMap')[0]
  return descendants(roots, 'overrideClrMapping')[0]
}

function drawingMappingPrefix(roots: XmlElement[]): string {
  const candidate = descendants(roots, 'overrideClrMapping')[0] ?? descendants(roots, 'masterClrMapping')[0]
  if (candidate) return namespacePrefix(candidate.name)
  const root = roots[0]
  const rootPrefix = root ? namespacePrefix(root.name) : ''
  const declared = root
    ? Object.entries(root.attributes).find(([name, value]) => name.startsWith('xmlns:')
      && name.slice('xmlns:'.length) + ':' !== rootPrefix
      && (value.includes('drawingml') || value === 'drawing'))
    : undefined
  return declared ? `${declared[0].slice('xmlns:'.length)}:` : 'a:'
}

function rewriteColorMapInternal(source: string, kind: ColorMapPart, map: Partial<ColorMap> | undefined, id: string): string {
  const values = mapAttributes(map, kind, id)
  let roots: XmlElement[]
  try {
    roots = scanXml(source)
  } catch {
    throw failure(`${kind} color map`, id, 'source XML malformed')
  }
  const root = roots[0]
  if (!root) throw failure(`${kind} color map`, id, 'source XML malformed')
  if (values.length === 0) return source

  const current = mappingElement(roots, kind)
  if (current) {
    const end = openingEnd(source, current)
    let raw = source.slice(current.start, end)
    for (const [key, target] of values) {
      if (current.attributes[key] === target) continue
      raw = updateOpeningAttribute(raw, key, target, `${kind} color map`, id)
    }
    return raw === source.slice(current.start, end)
      ? source
      : replaceRanges(source, [{ start: current.start, end, value: raw }])
  }

  const attributes = values.map(([key, target]) => `${key}="${escapeXml(target, `${kind} color map`, id)}"`).join(' ')
  if (kind === 'master') {
    const prefix = namespacePrefix(root.name)
    const value = `<${prefix}clrMap${attributes ? ` ${attributes}` : ''}/>`
    return replaceRanges(source, [insertElementContent(source, root, value, `${kind} color map`, id)])
  }

  const overridePrefix = drawingMappingPrefix(roots)
  const presentationPrefix = namespacePrefix(root.name)
  const mapping = `<${overridePrefix}overrideClrMapping${attributes ? ` ${attributes}` : ''}/>`
  const override = descendants(roots, 'clrMapOvr')[0]
  if (override) return replaceRanges(source, [insertElementContent(source, override, mapping, `${kind} color map`, id)])
  const wrapper = `<${presentationPrefix}clrMapOvr>${mapping}</${presentationPrefix}clrMapOvr>`
  return replaceRanges(source, [insertElementContent(source, root, wrapper, `${kind} color map`, id)])
}

export function rewritePlaceholderPartXml(source: string, defaults: Record<string, ElementDefaults>, kind: 'master' | 'layout' = 'master', id = kind): string {
  return rewritePlaceholderDefaults(source, defaults, kind, id)
}

export function rewriteColorMapXml(source: string, kind: ColorMapPart, map: Partial<ColorMap> | undefined, id: string = kind): string {
  return rewriteColorMapInternal(source, kind, map, id)
}

export function rewriteMasterXml(source: string, defaults: Record<string, ElementDefaults> = {}, colorMap?: Partial<ColorMap>, id = 'master'): string {
  return rewriteColorMapInternal(rewritePlaceholderDefaults(source, defaults, 'master', id), 'master', colorMap, id)
}

export function rewriteLayoutXml(source: string, defaults: Record<string, ElementDefaults> = {}, colorMap?: Partial<ColorMap>, id = 'layout'): string {
  return rewriteColorMapInternal(rewritePlaceholderDefaults(source, defaults, 'layout', id), 'layout', colorMap, id)
}

export function rewriteSlideColorMapXml(source: string, colorMap: Partial<ColorMap> | undefined, id = 'slide'): string {
  return rewriteColorMapInternal(source, 'slide', colorMap, id)
}
