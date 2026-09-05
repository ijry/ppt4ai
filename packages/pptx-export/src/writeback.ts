import { fingerprintBytes, fingerprintDocument, parseBitmapMetadata, type AssetAdapter, type AssetMetadata, type Color, type ColorTransformType, type DashSegment, type Fill, type GroupElement, type ImageElement, type Ppt4aiDocument, type PresetGeometry, type Rect, type SlideBackground, type StrokeAlign, type StrokeCap, type StrokeCompound, type StrokeJoin, type StrokeStyle, type TextBody, type TextElement } from '@ppt4ai/model'
import { serializeTableXml } from './table.js'
import { serializeColorXml, serializeFillXml, serializeTextBodyXml } from './standalone-xml.js'
import { readZipEntries, writeStoredZip, type ZipEntry } from './zip.js'
import {
  allocateMediaPath,
  allocateRelationshipId,
  replacePictureRelationship,
  serializeImageRelationship,
  serializePictureXml,
  stableAssetId,
} from './image-writeback.js'
import { rewritePictureAppearance } from './image-appearance-writeback.js'
import { clonePartDependencies, findOrphanedParts, type DependencyCloneResult } from './dependency-graph.js'
import { decodeXml, descendants, replaceRanges, scanXml, tagEnd, type Replacement, type XmlElement } from './xml-range.js'
import { rewriteThemeXml } from './theme-writeback.js'
import { rewriteLayoutXml, rewriteMasterXml, rewriteSlideColorMapXml } from './master-layout-writeback.js'
import { sourceColor, sourceFill } from './color-source.js'
import { sourceTextBody } from './text-source.js'

interface SlideRelationship {
  id: string
  target: string
  type: string
}

interface LayoutRelationship extends SlideRelationship {
  targetPath: string
}

interface SourceImage {
  element: XmlElement
  assetId: string
  mediaPath: string
  relationshipId: string
}

interface ScannedElement {
  element: XmlElement
  expectedId: string
  image?: SourceImage
  sourceBody?: TextBody
  /** Set for a `p:grpSp` placeholder, which advances the positional map but has no writable content. */
  group?: true
}

interface ScannedSlide {
  elements: ScannedElement[]
  invalidPictures: Array<{ expectedId: string; error: Error }>
  nextElementNumber: number
  /** The asset the source's own `p:bg/a:blipFill` resolves to, so a photo background compares equal. */
  backgroundAssetId?: string
}

interface SourceSlide {
  originId: string
  partPath: string
  presentationId: string
  relationshipId: string
  reference: XmlElement
  relationship: XmlElement
}

interface SourcePackage {
  presentationEntry: ZipEntry
  presentationXml: string
  presentationRelationshipsEntry: ZipEntry
  presentationRelationshipsXml: string
  slides: SourceSlide[]
}

interface SlidePlan {
  mode: 'reuse' | 'clone' | 'blank'
  slideId: string
  outputPath: string
  presentationId: string
  relationshipId: string
  source?: SourceSlide
  layoutRelationship?: LayoutRelationship
}

interface ContentTypeAddition {
  path: string
  contentType?: string
}

interface ContentTypeDefaultAddition {
  extension: string
  contentType: string
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const encoder = new TextEncoder()

function relationshipType(value: string): string {
  return value.slice(value.lastIndexOf('/') + 1)
}

function relationshipFilePath(partPath: string): string {
  const directory = partPath.slice(0, partPath.lastIndexOf('/'))
  return `${directory}/_rels/${partPath.slice(partPath.lastIndexOf('/') + 1)}.rels`
}

function readRelationships(entries: Map<string, ZipEntry>, partPath: string): SlideRelationship[] {
  const relationshipEntry = entries.get(relationshipFilePath(partPath))
  if (!relationshipEntry) return []
  return descendants(scanXml(decoder.decode(relationshipEntry.data)), 'Relationship').flatMap((relationship) => {
    const id = relationship.attributes.Id
    const target = relationship.attributes.Target
    const type = relationship.attributes.Type
    return id && target && type ? [{ id, target, type: relationshipType(type) }] : []
  })
}

function firstDescendant(element: XmlElement, localName: string): XmlElement | undefined {
  return descendants(element.children, localName)[0]
}

function xmlTextContent(element: XmlElement): string {
  return decodeXml(element.text) + element.children.map((child) => xmlTextContent(child)).join('')
}

function textBodyForElement(element: TextElement): TextBody {
  return element.body ?? {
    paragraphs: [{ runs: element.text ? [{ text: element.text }] : [] }],
  }
}

function sourceBounds(element: XmlElement): Rect | undefined {
  const transform = firstDescendant(element, 'xfrm')
  const offset = transform && firstDescendant(transform, 'off')
  const extent = transform && firstDescendant(transform, 'ext')
  const values = [offset?.attributes.x, offset?.attributes.y, extent?.attributes.cx, extent?.attributes.cy].map((value) => Number(value))
  if (values.some((value) => !Number.isFinite(value))) return undefined
  const [x, y, w, h] = values
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined
  return { x, y, w, h }
}

function replaceXmlAttribute(source: string, name: string, value: string | number): string {
  const expression = new RegExp(`(\\s${name}\\s*=\\s*)(["'])([\\s\\S]*?)\\2`, 'u')
  const match = expression.exec(source)
  if (!match) throw new Error(`PPTX export source transform attribute missing: ${name}`)
  const replacement = `${match[1]}${match[2]}${escapeXml(String(value))}${match[2]}`
  return source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length)
}

function xmlAttributePattern(name: string): RegExp {
  return new RegExp(`\\s${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'u')
}

function addXmlAttribute(source: string, name: string, value: string | number): string {
  const nameMatch = /^<([^\s/>]+)/u.exec(source)
  if (!nameMatch) throw new Error('PPTX export source transform opening tag malformed')
  const insertion = nameMatch[0].length
  return `${source.slice(0, insertion)} ${name}="${escapeXml(String(value))}"${source.slice(insertion)}`
}

function updateXmlAttribute(source: string, name: string, value: string | number | undefined): string {
  const expression = xmlAttributePattern(name)
  if (value === undefined) return source.replace(expression, '')
  return expression.test(source)
    ? replaceXmlAttribute(source, name, value)
    : addXmlAttribute(source, name, value)
}

function parseIntegerAttributeValue(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : undefined
}

function sourceRotation(element: XmlElement): number | undefined {
  const transform = firstDescendant(element, 'xfrm')
  return parseIntegerAttributeValue(transform?.attributes.rot)
}

/** Matches the importer: only `1`/`true` is a flip, so `flipH="0"` and an absent attribute agree. */
function flipAttribute(value: string | undefined): true | undefined {
  return value === '1' || value === 'true' ? true : undefined
}

function transformReplacements(
  xml: string,
  sourceElement: XmlElement,
  transform: { rotation?: number; flipH?: boolean; flipV?: boolean },
): Replacement[] {
  // A group's transform lives on grpSpPr, so scope there rather than reaching into a child's xfrm.
  const source = sourceElement.localName === 'grpSp'
    ? groupTransform(sourceElement)
    : firstDescendant(sourceElement, 'xfrm')
  if (!source) return []
  const previousRotation = parseIntegerAttributeValue(source.attributes.rot)
  const rotationChanged = previousRotation !== transform.rotation && !(previousRotation === undefined && transform.rotation === undefined)
  const flips = (['flipH', 'flipV'] as const).filter((axis) => flipAttribute(source.attributes[axis]) !== (transform[axis] === true ? true : undefined))
  if (!rotationChanged && flips.length === 0) return []
  const openingEnd = tagEnd(xml, source.start + 1)
  const openingXml = xml.slice(source.start, openingEnd)
  let value = rotationChanged ? updateXmlAttribute(openingXml, 'rot', transform.rotation) : openingXml
  for (const axis of flips) value = updateXmlAttribute(value, axis, transform[axis] === true ? '1' : undefined)
  return value === openingXml ? [] : [{ start: source.start, end: openingEnd, value }]
}

function boundsReplacements(xml: string, sourceElement: XmlElement, bounds: Rect): Replacement[] {
  const previous = sourceBounds(sourceElement)
  if (!previous || previous.x === bounds.x && previous.y === bounds.y && previous.w === bounds.w && previous.h === bounds.h) return []
  const transform = firstDescendant(sourceElement, 'xfrm')
  const offset = transform && firstDescendant(transform, 'off')
  const extent = transform && firstDescendant(transform, 'ext')
  if (!offset || !extent) throw new Error('PPTX export source transform bounds missing')
  const offsetXml = xml.slice(offset.start, offset.end)
  const extentXml = xml.slice(extent.start, extent.end)
  return [
    { start: offset.start, end: offset.end, value: replaceXmlAttribute(replaceXmlAttribute(offsetXml, 'x', bounds.x), 'y', bounds.y) },
    { start: extent.start, end: extent.end, value: replaceXmlAttribute(replaceXmlAttribute(extentXml, 'cx', bounds.w), 'cy', bounds.h) },
  ]
}

/**
 * Group transforms live on `p:grpSpPr`, whose `a:xfrm` also carries `a:chOff`/`a:chExt`. Scoping
 * to direct children avoids `firstDescendant` reaching into a nested child shape's own `a:xfrm`.
 */
function groupTransform(element: XmlElement): XmlElement | undefined {
  const properties = element.children.find((child) => child.localName === 'grpSpPr')
  return properties?.children.find((child) => child.localName === 'xfrm')
}

function rectFromPair(transform: XmlElement, offsetName: string, extentName: string): Rect | undefined {
  const offset = transform.children.find((child) => child.localName === offsetName)
  const extent = transform.children.find((child) => child.localName === extentName)
  const values = [offset?.attributes.x, offset?.attributes.y, extent?.attributes.cx, extent?.attributes.cy].map((value) => Number(value))
  if (values.some((value) => !Number.isFinite(value))) return undefined
  const [x, y, w, h] = values
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined
  return { x, y, w, h }
}

function pairReplacements(
  xml: string,
  transform: XmlElement,
  offsetName: string,
  extentName: string,
  bounds: Rect,
): Replacement[] {
  const previous = rectFromPair(transform, offsetName, extentName)
  if (!previous || previous.x === bounds.x && previous.y === bounds.y && previous.w === bounds.w && previous.h === bounds.h) return []
  const offset = transform.children.find((child) => child.localName === offsetName)
  const extent = transform.children.find((child) => child.localName === extentName)
  if (!offset || !extent) return []
  const offsetXml = xml.slice(offset.start, offset.end)
  const extentXml = xml.slice(extent.start, extent.end)
  return [
    { start: offset.start, end: offset.end, value: replaceXmlAttribute(replaceXmlAttribute(offsetXml, 'x', bounds.x), 'y', bounds.y) },
    { start: extent.start, end: extent.end, value: replaceXmlAttribute(replaceXmlAttribute(extentXml, 'cx', bounds.w), 'cy', bounds.h) },
  ]
}

function groupBoundsReplacements(xml: string, sourceElement: XmlElement, element: GroupElement): Replacement[] {
  const transform = groupTransform(sourceElement)
  if (!transform) return []
  return [
    ...pairReplacements(xml, transform, 'off', 'ext', element.bounds),
    ...(element.childSpace ? pairReplacements(xml, transform, 'chOff', 'chExt', element.childSpace) : []),
  ]
}

const colorTransformTypes = new Set<ColorTransformType>(['tint', 'shade', 'lumMod', 'lumOff', 'alpha', 'alphaMod', 'alphaOff'])
const fillNodeNames = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'])

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

function gradientsEqual(left: Fill['gradient'], right: Fill['gradient']): boolean {
  if (!left || !right) return left === right
  if (left.stops.length !== right.stops.length) return false
  if ((left.angle ?? 0) !== (right.angle ?? 0)) return false
  if ((left.scaled ?? false) !== (right.scaled ?? false)) return false
  return left.stops.every((stop, index) => {
    const other = right.stops[index]
    return other?.pos === stop.pos && colorsEqual(stop.color, other.color)
  })
}

function fillsEqual(left: Fill | undefined, right: Fill | undefined): boolean {
  return colorsEqual(left?.color, right?.color)
    && gradientsEqual(left?.gradient, right?.gradient)
    && patternsEqual(left?.pattern, right?.pattern)
}

/** Both absent counts as equal; otherwise the preset and both colours have to match. */
function patternsEqual(left: Fill['pattern'], right: Fill['pattern']): boolean {
  if (!left || !right) return !left && !right
  return left.preset === right.preset
    && colorsEqual(left.foreground, right.foreground)
    && colorsEqual(left.background, right.background)
}

function sourceShapeProperties(element: XmlElement): XmlElement | undefined {
  return firstDescendant(element, 'spPr')
}

function fillReplacements(xml: string, sourceElement: XmlElement, fill: Fill | undefined): Replacement[] {
  const properties = sourceShapeProperties(sourceElement)
  if (!properties) return []
  const fillNode = properties.children.find((child) => fillNodeNames.has(child.localName))
  const existing = sourceFill(fillNode)
  if (fillsEqual(existing, fill)) return []
  if (fill) {
    const value = serializeFillXml(fill)
    if (fillNode) return [{ start: fillNode.start, end: fillNode.end, value }]
    const line = properties.children.find((child) => child.localName === 'ln')
    const insertion = line?.start ?? xml.lastIndexOf('</', properties.end)
    if (insertion < properties.start) throw new Error('PPTX export source shape properties malformed')
    return [{ start: insertion, end: insertion, value }]
  }
  if (fillNode && existing) {
    return [{ start: fillNode.start, end: fillNode.end, value: '' }]
  }
  return []
}

function namespacePrefix(name: string): string {
  const separator = name.lastIndexOf(':')
  return separator >= 0 ? name.slice(0, separator + 1) : ''
}

function serializeFillForLine(fill: Fill, lineName: string): string {
  const prefix = namespacePrefix(lineName)
  const value = serializeFillXml(fill)
  if (prefix === 'a:') return value
  return value.replaceAll('<a:', `<${prefix}`).replaceAll('</a:', `</${prefix}`)
}

function serializeNoFill(lineName: string): string {
  return `<${qualifiedName(lineName, 'noFill')}/>`
}

function insertElementContent(xml: string, element: XmlElement, value: string): Replacement {
  const source = xml.slice(element.start, element.end)
  if (/\/\s*>$/u.test(source)) {
    const opening = source.replace(/\/\s*>$/u, '>')
    return { start: element.start, end: element.end, value: `${opening}${value}</${element.name}>` }
  }
  const closingOffset = source.lastIndexOf('</')
  if (closingOffset < 0) throw new Error('PPTX export source shape properties malformed')
  const closingStart = element.start + closingOffset
  return { start: closingStart, end: closingStart, value }
}

function lineReplacements(xml: string, line: XmlElement, value: string): Replacement[] {
  const firstChild = line.children[0]
  if (firstChild) return [{ start: firstChild.start, end: firstChild.start, value }]
  return [insertElementContent(xml, line, value)]
}

function shapePropertyInsertion(xml: string, properties: XmlElement, value: string): Replacement[] {
  const insertionBefore = properties.children.find((child) => (
    child.localName === 'effectLst'
      || child.localName === 'effectDag'
      || child.localName === 'scene3d'
      || child.localName === 'sp3d'
      || child.localName === 'extLst'
  ))
  if (insertionBefore) return [{ start: insertionBefore.start, end: insertionBefore.start, value }]
  return [insertElementContent(xml, properties, value)]
}

/**
 * `a:ln/@w`. Absent and `w="0"` are different things in OOXML — absent inherits the theme line
 * width, zero is an explicit hairline — so a model without a width removes the attribute rather than
 * leaving the source value behind, which would put the file and the model at odds.
 */
function lineWidthReplacements(xml: string, line: XmlElement, width: number | undefined): Replacement[] {
  const source = line.attributes.w
  const sourceWidth = source === undefined ? undefined : Number(source)
  if (width === undefined && sourceWidth === undefined) return []
  if (width !== undefined && width === sourceWidth) return []
  const openingEnd = xml.indexOf('>', line.start)
  if (openingEnd < 0) throw new Error('PPTX export source line malformed')
  const opening = xml.slice(line.start, openingEnd)
  const existing = /\s+w\s*=\s*"[^"]*"/u.exec(opening)
  if (width === undefined) {
    if (!existing) return []
    const start = line.start + existing.index
    return [{ start, end: start + existing[0].length, value: '' }]
  }
  if (existing) {
    const start = line.start + existing.index
    return [{ start, end: start + existing[0].length, value: ` w="${width}"` }]
  }
  // No `w` yet: it goes right after the element name, where every other attribute writer puts one.
  const nameEnd = line.start + 1 + line.name.length
  return [{ start: nameEnd, end: nameEnd, value: ` w="${width}"` }]
}

/**
 * `a:ln`'s dash, which is `a:prstDash` or `a:custDash` — a choice in `EG_LineDashProperties`, so at
 * most one may survive. `solid` never reaches the model, so a model with no style means "back to the
 * default" and whichever node is there is removed rather than written as `val="solid"`.
 *
 * The preset comparison is verbatim now that the model holds all eleven tokens. It used to run the
 * source token through the importer's three-way collapse, because a source `lgDashDot` could only be
 * held as `dash` and comparing raw would have rewritten it on any unrelated edit. With the tokens
 * modeled that collapse would do the opposite damage: `dash` → `lgDash` would compare equal and never
 * be written.
 *
 * Before `a:custDash` was modeled this function only looked for `prstDash`, so a source custom dash
 * was invisible to it: setting a preset style inserted `prstDash` and left `custDash` in place, which
 * is two halves of a choice in one `a:ln`. Both nodes are found now, and the unwanted one is deleted.
 */
function lineDashReplacements(xml: string, line: XmlElement, style: StrokeStyle | { custom: DashSegment[] } | undefined): Replacement[] {
  const presetNode = line.children.find((child) => child.localName === 'prstDash')
  const customNode = line.children.find((child) => child.localName === 'custDash')
  const wanted = style === 'solid' ? undefined : style
  const removals: Replacement[] = []
  const remove = (node: XmlElement | undefined) => {
    if (node) removals.push({ start: node.start, end: node.end, value: '' })
  }

  if (wanted === undefined) {
    remove(presetNode)
    remove(customNode)
    return removals
  }

  if (typeof wanted === 'string') {
    const sourceToken = presetNode?.attributes.val
    const sourceStyle = !sourceToken || sourceToken === 'solid' ? undefined : sourceToken
    // A stale `custDash` has to go even when the preset itself is unchanged, or the choice stays violated.
    remove(customNode)
    if (wanted === sourceStyle) return removals
    const value = `<${qualifiedName(line.name, 'prstDash')} val="${wanted}"/>`
    if (presetNode) return [...removals, { start: presetNode.start, end: presetNode.end, value }]
    return [...removals, ...dashInsertion(xml, line, value)]
  }

  remove(presetNode)
  if (customNode && customDashEqual(customNode, wanted.custom)) return removals
  const segments = wanted.custom
    .map((segment) => `<${qualifiedName(line.name, 'ds')} d="${segment.dash}" sp="${segment.space}"/>`)
    .join('')
  const value = `<${qualifiedName(line.name, 'custDash')}>${segments}</${qualifiedName(line.name, 'custDash')}>`
  if (customNode) return [...removals, { start: customNode.start, end: customNode.end, value }]
  return [...removals, ...dashInsertion(xml, line, value)]
}

/** ECMA-376 puts the dash after the fill, so it follows the fill node when there is one. */
function dashInsertion(xml: string, line: XmlElement, value: string): Replacement[] {
  const fillNode = line.children.find((child) => fillNodeNames.has(child.localName))
  if (fillNode) return [{ start: fillNode.end, end: fillNode.end, value }]
  return lineReplacements(xml, line, value)
}

function customDashEqual(node: XmlElement, segments: readonly DashSegment[]): boolean {
  const source = node.children.filter((child) => child.localName === 'ds')
  if (source.length !== segments.length) return false
  return segments.every((segment, index) => {
    const child = source[index]
    return child?.attributes.d === String(segment.dash) && child?.attributes.sp === String(segment.space)
  })
}

/** `a:ln/@cap`; absent means the OOXML default, so a model without one removes the attribute. */
function lineCapReplacements(xml: string, line: XmlElement, cap: StrokeCap | undefined): Replacement[] {
  return lineAttributeReplacements(xml, line, 'cap', cap)
}

/** `a:ln/@cmpd`; the model holds it verbatim, so an untouched source compares equal and is left alone. */
function lineCompoundReplacements(xml: string, line: XmlElement, compound: StrokeCompound | undefined): Replacement[] {
  return lineAttributeReplacements(xml, line, 'cmpd', compound)
}

/** `a:ln/@algn`, same shape. */
function lineAlignReplacements(xml: string, line: XmlElement, align: StrokeAlign | undefined): Replacement[] {
  return lineAttributeReplacements(xml, line, 'algn', align)
}

/**
 * One attribute of the `<a:ln>` opening tag, patched in place. The whole tag is never rewritten, so the
 * attributes this project does not model stay exactly as the source wrote them.
 */
function lineAttributeReplacements(xml: string, line: XmlElement, name: string, value: string | undefined): Replacement[] {
  const source = line.attributes[name]
  if (value === source || (value === undefined && source === undefined)) return []
  const openingEnd = xml.indexOf('>', line.start)
  if (openingEnd < 0) throw new Error('PPTX export source line malformed')
  const existing = new RegExp(`\\s+${name}\\s*=\\s*"[^"]*"`, 'u').exec(xml.slice(line.start, openingEnd))
  if (value === undefined) {
    if (!existing) return []
    const start = line.start + existing.index
    return [{ start, end: start + existing[0].length, value: '' }]
  }
  if (existing) {
    const start = line.start + existing.index
    return [{ start, end: start + existing[0].length, value: ` ${name}="${value}"` }]
  }
  const nameEnd = line.start + 1 + line.name.length
  return [{ start: nameEnd, end: nameEnd, value: ` ${name}="${value}"` }]
}

const joinNames = new Set(['round', 'bevel', 'miter'])

/** The corner is a child element, so changing it replaces one element with another. */
function lineJoinReplacements(xml: string, line: XmlElement, join: StrokeJoin | undefined): Replacement[] {
  const node = line.children.find((child) => joinNames.has(child.localName))
  if (join === node?.localName) return []
  if (join === undefined) return node ? [{ start: node.start, end: node.end, value: '' }] : []
  const value = `<${qualifiedName(line.name, join)}/>`
  if (node) return [{ start: node.start, end: node.end, value }]
  const dash = line.children.find((child) => child.localName === 'prstDash')
  if (dash) return [{ start: dash.end, end: dash.end, value }]
  const fillNode = line.children.find((child) => fillNodeNames.has(child.localName))
  if (fillNode) return [{ start: fillNode.end, end: fillNode.end, value }]
  return lineReplacements(xml, line, value)
}

function strokeReplacements(
  xml: string,
  sourceElement: XmlElement,
  stroke: Fill | undefined,
  strokeWidth?: number,
  strokeStyle?: StrokeStyle | { custom: DashSegment[] },
  strokeCap?: StrokeCap,
  strokeJoin?: StrokeJoin,
  strokeCompound?: StrokeCompound,
  strokeAlign?: StrokeAlign,
): Replacement[] {
  const properties = sourceShapeProperties(sourceElement)
  if (!properties) return []
  const line = properties.children.find((child) => child.localName === 'ln')
  const fillNode = line?.children.find((child) => fillNodeNames.has(child.localName))
  const existing = sourceFill(fillNode)
  const replacements: Replacement[] = []

  if (!fillsEqual(existing, stroke)) {
    if (stroke) {
      if (!line) {
        const dash = strokeStyle && strokeStyle !== 'solid' ? `<a:prstDash val="${strokeStyle}"/>` : ''
        const join = strokeJoin ? `<a:${strokeJoin}/>` : ''
        const widthAttribute = strokeWidth === undefined ? '' : ` w="${strokeWidth}"`
        const capAttribute = strokeCap === undefined ? '' : ` cap="${strokeCap}"`
        const value = `<a:ln${widthAttribute}${capAttribute}>${serializeFillXml(stroke)}${dash}${join}</a:ln>`
        return shapePropertyInsertion(xml, properties, value)
      }
      const value = serializeFillForLine(stroke, line.name)
      replacements.push(...(fillNode ? [{ start: fillNode.start, end: fillNode.end, value }] : lineReplacements(xml, line, value)))
    } else if (line && fillNode && existing) {
      replacements.push({ start: fillNode.start, end: fillNode.end, value: serializeNoFill(line.name) })
    }
  }

  // Width and dash are siblings of `stroke` on the element, not part of `Fill`, so each compares on
  // its own. Rewriting the whole `<a:ln>` instead would drop `cap`/`cmpd`/`algn`.
  if (line) {
    replacements.push(...lineWidthReplacements(xml, line, strokeWidth))
    replacements.push(...lineDashReplacements(xml, line, strokeStyle))
    replacements.push(...lineCapReplacements(xml, line, strokeCap))
    replacements.push(...lineJoinReplacements(xml, line, strokeJoin))
    replacements.push(...lineCompoundReplacements(xml, line, strokeCompound))
    replacements.push(...lineAlignReplacements(xml, line, strokeAlign))
  }
  return replacements
}

/**
 * The source's own word. This used to collapse it onto the four painted presets, because that was all
 * the model could hold — the same patch `collapsedDashStyle` was, and obsolete for the same reason.
 * An absent or empty word is `rect`, which is what the importer records for it.
 */
function importedPreset(value: string | undefined): PresetGeometry {
  const token = value?.trim()
  return token ? token : 'rect'
}

function qualifiedName(sourceName: string, localName: string): string {
  const separator = sourceName.lastIndexOf(':')
  return separator >= 0 ? `${sourceName.slice(0, separator + 1)}${localName}` : localName
}

function serializePresetGeometry(sourceName: string | undefined, preset: PresetGeometry): string {
  const name = qualifiedName(sourceName ?? 'a:prstGeom', 'prstGeom')
  const avList = qualifiedName(sourceName ?? 'a:prstGeom', 'avLst')
  return `<${name} prst="${escapeXml(preset)}"><${avList}/></${name}>`
}

function geometryReplacements(xml: string, sourceElement: XmlElement, preset: PresetGeometry): Replacement[] {
  const properties = sourceShapeProperties(sourceElement)
  if (!properties) return []
  const geometry = properties.children.find((child) => child.localName === 'prstGeom' || child.localName === 'custGeom')
  const previous = geometry?.localName === 'prstGeom' ? importedPreset(geometry.attributes.prst) : 'rect'
  if (previous === preset) return []
  if (geometry?.localName === 'prstGeom' && geometry.attributes.prst !== undefined) {
    const value = xml.slice(geometry.start, geometry.end)
    return [{ start: geometry.start, end: geometry.end, value: replaceXmlAttribute(value, 'prst', preset) }]
  }
  const value = serializePresetGeometry(geometry?.name, preset)
  if (geometry) return [{ start: geometry.start, end: geometry.end, value }]
  const fill = properties.children.find((child) => fillNodeNames.has(child.localName))
  const line = properties.children.find((child) => child.localName === 'ln')
  const insertion = fill?.start ?? line?.start ?? xml.lastIndexOf('</', properties.end)
  if (insertion < properties.start) throw new Error('PPTX export source shape properties malformed')
  return [{ start: insertion, end: insertion, value }]
}

function normalizePath(path: string): string {
  const result: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') result.pop()
    else result.push(segment)
  }
  return result.join('/')
}

function resolveTarget(basePath: string, target: string): string {
  const directory = basePath.slice(0, basePath.lastIndexOf('/') + 1)
  return normalizePath(target.startsWith('/') ? target.slice(1) : `${directory}${target}`)
}

function relativeTarget(basePath: string, targetPath: string): string {
  const baseDirectory = basePath.slice(0, basePath.lastIndexOf('/') + 1).split('/').filter(Boolean)
  const targetSegments = normalizePath(targetPath).split('/').filter(Boolean)
  let common = 0
  while (common < baseDirectory.length && common < targetSegments.length
    && baseDirectory[common] === targetSegments[common]) common += 1
  const parentSegments = Array.from({ length: baseDirectory.length - common }, () => '..')
  return [...parentSegments, ...targetSegments.slice(common)].join('/')
}

function sourceImage(element: XmlElement, slideId: string, slidePath: string, relationships: SlideRelationship[], entries: Map<string, ZipEntry>): SourceImage {
  const blip = firstDescendant(element, 'blip')
  const relationshipId = blip?.attributes['r:embed'] ?? blip?.attributes.embed
  const relationship = relationships.find((value) => value.id === relationshipId && value.type === 'image')
  if (!relationship || !relationshipId) throw new Error(`PPTX export image relationship missing for slide ${slideId}`)
  const mediaPath = resolveTarget(slidePath, relationship.target)
  const mediaEntry = entries.get(mediaPath)
  if (!mediaEntry || !parseBitmapMetadata(mediaEntry.data)) throw new Error(`PPTX export image media missing for slide ${slideId}`)
  return { element, assetId: stableAssetId(mediaPath), mediaPath, relationshipId }
}

function numericAttribute(element: XmlElement | undefined, name: string): boolean {
  return element !== undefined && element.attributes[name] !== undefined && Number.isFinite(Number(element.attributes[name]))
}

function hasBounds(element: XmlElement): boolean {
  const transform = firstDescendant(element, 'xfrm')
  const offset = transform && firstDescendant(transform, 'off')
  const extent = transform && firstDescendant(transform, 'ext')
  return numericAttribute(offset, 'x') && numericAttribute(offset, 'y')
    && numericAttribute(extent, 'cx') && numericAttribute(extent, 'cy')
}

function isImportableTable(element: XmlElement): boolean {
  const table = firstDescendant(element, 'tbl')
  if (!table || !hasBounds(element)) return false
  const grid = firstDescendant(table, 'tblGrid')
  const columns = grid?.children.filter((child) => child.localName === 'gridCol') ?? []
  const rows = table.children.filter((child) => child.localName === 'tr')
  return columns.length > 0 && columns.every((column) => numericAttribute(column, 'w'))
    && rows.length > 0 && rows.every((row) => numericAttribute(row, 'h'))
}

function groupHasBounds(element: XmlElement): boolean {
  const properties = element.children.find((child) => child.localName === 'grpSpPr')
  const transform = properties?.children.find((child) => child.localName === 'xfrm')
  const offset = transform?.children.find((child) => child.localName === 'off')
  const extent = transform?.children.find((child) => child.localName === 'ext')
  return numericAttribute(offset, 'x') && numericAttribute(offset, 'y')
    && numericAttribute(extent, 'cx') && numericAttribute(extent, 'cy')
}

function sourceBackgroundAssetId(roots: XmlElement[], slidePath: string, relationships: SlideRelationship[]): string | undefined {
  const common = descendants(roots, 'cSld')[0]
  const bg = common?.children.find((child) => child.localName === 'bg')
  const properties = bg?.children.find((child) => child.localName === 'bgPr')
  const fill = properties?.children.find((child) => child.localName === 'blipFill')
  const blip = fill?.children.find((child) => child.localName === 'blip')
  const relationshipId = blip?.attributes['r:embed'] ?? blip?.attributes.embed
  const relationship = relationships.find((value) => value.id === relationshipId && value.type === 'image')
  return relationship ? stableAssetId(resolveTarget(slidePath, relationship.target)) : undefined
}

function slideElements(xml: string, slideId: string, slidePath: string, relationships: SlideRelationship[], entries: Map<string, ZipEntry>, elementNumberStart: number): ScannedSlide {
  const roots = scanXml(xml)
  const backgroundAssetId = sourceBackgroundAssetId(roots, slidePath, relationships)
  const tree = descendants(roots, 'spTree')[0]
  if (!tree) {
    return {
      elements: [],
      invalidPictures: [],
      nextElementNumber: elementNumberStart,
      ...(backgroundAssetId ? { backgroundAssetId } : {}),
    }
  }
  const result: ScannedElement[] = []
  const invalidPictures: Array<{ expectedId: string; error: Error }> = []
  let elementNumber = elementNumberStart
  let groupNumber = 1
  const visit = (elements: XmlElement[]): void => {
    for (const element of elements) {
      // Mirror the importer: a group takes a grp_N slot before its children, which keep el_N.
      if (element.localName === 'grpSp') {
        if (groupHasBounds(element)) result.push({ element, expectedId: `grp_${groupNumber++}`, group: true })
        visit(element.children)
        continue
      }
      const candidate = element.localName === 'sp' || element.localName === 'graphicFrame' || element.localName === 'pic'
      const expectedId = candidate ? `el_${elementNumber}` : undefined
      if (candidate) elementNumber += 1
      if (expectedId && element.localName === 'sp' && hasBounds(element)) {
        const sourceBody = sourceTextBody(element)
        result.push({ element, expectedId, ...(sourceBody !== undefined ? { sourceBody } : {}) })
      } else if (expectedId && element.localName === 'graphicFrame' && isImportableTable(element)) {
        result.push({ element, expectedId })
      }
      if (expectedId && element.localName === 'pic') {
        if (hasBounds(element)) {
          try {
            const image = sourceImage(element, slideId, slidePath, relationships, entries)
            result.push({ element, expectedId, image })
          } catch (error) {
            invalidPictures.push({ expectedId, error: error instanceof Error ? error : new Error(String(error)) })
          }
        }
      }
      visit(element.children)
    }
  }
  visit(tree.children)
  return {
    elements: result,
    invalidPictures,
    nextElementNumber: elementNumber,
    ...(backgroundAssetId ? { backgroundAssetId } : {}),
  }
}

function sourcePackage(entries: Map<string, ZipEntry>): SourcePackage {
  const presentationPath = 'ppt/presentation.xml'
  const relationshipsPath = 'ppt/_rels/presentation.xml.rels'
  const presentationEntry = entries.get(presentationPath)
  const relationshipsEntry = entries.get(relationshipsPath)
  if (!presentationEntry) throw new Error(`PPTX export source part missing: ${presentationPath}`)
  if (!relationshipsEntry) throw new Error(`PPTX export source part missing: ${relationshipsPath}`)

  const presentationXml = decoder.decode(presentationEntry.data)
  const presentationRelationshipsXml = decoder.decode(relationshipsEntry.data)
  const slideReferences = descendants(scanXml(presentationXml), 'sldId')
  const relationships = descendants(scanXml(presentationRelationshipsXml), 'Relationship')
  const relationshipsById = new Map(relationships.flatMap((relationship) => {
    const id = relationship.attributes.Id
    return id ? [[id, relationship] as const] : []
  }))
  const slides: SourceSlide[] = []
  for (let index = 0; index < slideReferences.length; index += 1) {
    const reference = slideReferences[index]
    const relationshipId = reference?.attributes['r:id'] ?? reference?.attributes.id
    const relationship = relationshipId ? relationshipsById.get(relationshipId) : undefined
    const target = relationship?.attributes.Target
    const type = relationship?.attributes.Type
    const presentationId = reference?.attributes.id
    if (!reference || !relationship || !relationshipId || !target || !presentationId || relationshipType(type ?? '') !== 'slide') continue
    slides.push({
      originId: `sld_${index + 1}`,
      partPath: resolveTarget(presentationPath, target),
      presentationId,
      relationshipId,
      reference,
      relationship,
    })
  }
  return {
    presentationEntry,
    presentationXml,
    presentationRelationshipsEntry: relationshipsEntry,
    presentationRelationshipsXml,
    slides,
  }
}

function resolveSourceSlide(slideId: string, slide: Ppt4aiDocument['slides'][string] | undefined, slides: SourceSlide[]): SourceSlide | undefined {
  if (!slide) throw new Error(`PPTX export document slide missing: ${slideId}`)
  if (slide.source) {
    const source = slides.find((candidate) => candidate.partPath === slide.source?.partPath
      && candidate.relationshipId === slide.source?.relationshipId
      && candidate.presentationId === slide.source?.presentationId)
    if (!source) throw new Error(`PPTX export source slide binding missing for slide ${slideId}`)
    return source
  }
  const legacyMatch = /^sld_(\d+)$/u.exec(slideId)
  const index = legacyMatch ? Number(legacyMatch[1]) - 1 : -1
  const source = index >= 0 ? slides[index] : undefined
  return source?.originId === slideId ? source : undefined
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function allocateSlidePath(entryNames: Set<string>): string {
  let next = 1
  for (const entryName of entryNames) {
    const match = /^ppt\/slides\/slide(\d+)\.xml$/u.exec(entryName)
    if (match) next = Math.max(next, Number(match[1]) + 1)
  }
  while (entryNames.has(`ppt/slides/slide${next}.xml`) || entryNames.has(`ppt/slides/_rels/slide${next}.xml.rels`)) next += 1
  return `ppt/slides/slide${next}.xml`
}

function allocatePresentationId(ids: Set<string>): string {
  let next = 1
  for (const id of ids) {
    if (/^\d+$/u.test(id)) next = Math.max(next, Number(id) + 1)
  }
  while (ids.has(String(next))) next += 1
  return String(next)
}

function presentationRelationshipIds(xml: string): Set<string> {
  return new Set(descendants(scanXml(xml), 'Relationship').flatMap((relationship) => {
    const id = relationship.attributes.Id
    return id ? [id] : []
  }))
}

function sourceLayoutRelationship(entries: Map<string, ZipEntry>, slidePath: string): LayoutRelationship | undefined {
  const relationship = readRelationships(entries, slidePath).find((candidate) => candidate.type === 'slideLayout')
  if (!relationship) return undefined
  return {
    ...relationship,
    targetPath: resolveTarget(slidePath, relationship.target),
  }
}

function layoutRelationshipsById(document: Ppt4aiDocument, source: SourcePackage, entries: Map<string, ZipEntry>): Map<string, LayoutRelationship> {
  const result = new Map<string, LayoutRelationship>()
  const idsByPath = new Map<string, string>()
  let nextId = 1
  for (const sourceSlide of source.slides) {
    const relationship = sourceLayoutRelationship(entries, sourceSlide.partPath)
    if (!relationship || idsByPath.has(relationship.targetPath)) continue
    const layoutId = `lyt_${nextId}`
    nextId += 1
    idsByPath.set(relationship.targetPath, layoutId)
    result.set(layoutId, relationship)
  }

  for (const sourceSlide of source.slides) {
    const layoutId = document.slides[sourceSlide.originId]?.layoutId
    const relationship = sourceLayoutRelationship(entries, sourceSlide.partPath)
    const canonicalId = relationship ? idsByPath.get(relationship.targetPath) : undefined
    if (layoutId && relationship && canonicalId && !result.has(layoutId)) result.set(layoutId, relationship)
  }
  return result
}

function firstLayoutRelationship(source: SourcePackage, entries: Map<string, ZipEntry>): LayoutRelationship | undefined {
  for (const slide of source.slides) {
    const relationship = sourceLayoutRelationship(entries, slide.partPath)
    if (relationship) return relationship
  }
  return undefined
}

function slidePlans(document: Ppt4aiDocument, source: SourcePackage, entries: Map<string, ZipEntry>): SlidePlan[] {
  const entryNames = new Set(entries.keys())
  const usedSourcePaths = new Set<string>()
  const presentationIds = new Set(source.slides.map((slide) => slide.presentationId))
  const relationshipIds = presentationRelationshipIds(source.presentationRelationshipsXml)
  const layoutRelationship = firstLayoutRelationship(source, entries)
  const layoutRelationships = layoutRelationshipsById(document, source, entries)
  const plans: SlidePlan[] = []

  for (const slideId of document.slideOrder) {
    const slide = document.slides[slideId]
    const sourceSlide = resolveSourceSlide(slideId, slide, source.slides)
    const sourceSlideLayout = sourceSlide ? sourceLayoutRelationship(entries, sourceSlide.partPath) : undefined
    const selectedLayout = slide?.layoutId ? layoutRelationships.get(slide.layoutId) : undefined
    const currentLayout = selectedLayout ?? sourceSlideLayout ?? layoutRelationship
    const isOriginal = sourceSlide !== undefined && (slide?.source?.originId === slideId || sourceSlide.originId === slideId)
    if (sourceSlide && isOriginal) {
      if (usedSourcePaths.has(sourceSlide.partPath)) throw new Error(`PPTX export source slide reused by multiple pages: ${sourceSlide.partPath}`)
      usedSourcePaths.add(sourceSlide.partPath)
      plans.push({
        mode: 'reuse',
        slideId,
        outputPath: sourceSlide.partPath,
        presentationId: sourceSlide.presentationId,
        relationshipId: sourceSlide.relationshipId,
        source: sourceSlide,
        ...(currentLayout ? { layoutRelationship: currentLayout } : {}),
      })
      continue
    }

    const outputPath = allocateSlidePath(entryNames)
    const outputRelationshipPath = relationshipFilePath(outputPath)
    entryNames.add(outputPath)
    entryNames.add(outputRelationshipPath)
    const presentationId = allocatePresentationId(presentationIds)
    presentationIds.add(presentationId)
    const relationshipId = allocateRelationshipId(relationshipIds)
    relationshipIds.add(relationshipId)
    if (sourceSlide) {
      plans.push({ mode: 'clone', slideId, outputPath, presentationId, relationshipId, source: sourceSlide, ...(currentLayout ? { layoutRelationship: currentLayout } : {}) })
    } else {
      if (!currentLayout) throw new Error(`PPTX export blank slide layout missing for slide ${slideId}`)
      plans.push({ mode: 'blank', slideId, outputPath, presentationId, relationshipId, layoutRelationship: currentLayout })
    }
  }
  return plans
}

function scanSourceSlides(source: SourcePackage, entries: Map<string, ZipEntry>): Map<string, ScannedSlide> {
  const result = new Map<string, ScannedSlide>()
  let elementNumber = 1
  for (const slide of source.slides) {
    const entry = entries.get(slide.partPath)
    if (!entry) throw new Error(`PPTX export source part missing: ${slide.partPath}`)
    const relationships = readRelationships(entries, slide.partPath)
    const scanned = slideElements(decoder.decode(entry.data), slide.originId, slide.partPath, relationships, entries, elementNumber)
    result.set(slide.partPath, scanned)
    elementNumber = scanned.nextElementNumber
  }
  return result
}

function rewritePresentationOrder(xml: string, plans: SlidePlan[], originalSlides: SourceSlide[]): string {
  const list = descendants(scanXml(xml), 'sldIdLst')[0]
  if (!list) throw new Error('PPTX export presentation slide list missing')
  const originalPaths = originalSlides.map((slide) => slide.partPath)
  const currentPaths = plans.map((plan) => plan.outputPath)
  if (plans.every((plan) => plan.mode === 'reuse')
    && originalPaths.length === currentPaths.length
    && originalPaths.every((path, index) => path === currentPaths[index])) return xml
  if (plans.length === 0) throw new Error('PPTX export presentation cannot be empty')
  const references = list.children.filter((child) => child.localName === 'sldId')
  if (references.length === 0) throw new Error('PPTX export presentation slide list missing')
  const openingEnd = tagEnd(xml, list.start + 1)
  const closingStart = xml.lastIndexOf('</', list.end)
  if (closingStart < openingEnd) throw new Error('PPTX export presentation slide list malformed')
  const first = references[0]
  const last = references.at(-1)
  if (!first || !last) throw new Error('PPTX export presentation slide list missing')
  const leading = xml.slice(openingEnd, first.start)
  const separator = references.length > 1 ? xml.slice(first.end, references[1]!.start) : leading
  const trailing = xml.slice(last.end, closingStart)
  const rawReferences = plans.map((plan) => plan.mode === 'reuse' && plan.source
    ? xml.slice(plan.source.reference.start, plan.source.reference.end)
    : `<${first.name} id="${escapeXml(plan.presentationId)}" r:id="${escapeXml(plan.relationshipId)}"/>`)
  const replacement: Replacement = {
    start: first.start,
    end: last.end,
    value: rawReferences.join(separator),
  }
  return xml.slice(0, replacement.start) + replacement.value + xml.slice(replacement.end)
}

function rewritePresentationRelationships(xml: string, originalSlides: SourceSlide[], plans: SlidePlan[]): string {
  const usedPaths = new Set(plans.filter((plan) => plan.mode === 'reuse').map((plan) => plan.outputPath))
  const replacements = originalSlides
    .filter((slide) => !usedPaths.has(slide.partPath))
    .map((slide) => ({ start: slide.relationship.start, end: slide.relationship.end, value: '' }))
  const removed = replacements.length > 0 ? replaceRanges(xml, replacements) : xml
  const additions = plans.filter((plan) => plan.mode !== 'reuse').map((plan) => (
    `<Relationship Id="${escapeXml(plan.relationshipId)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${escapeXml(plan.outputPath.slice('ppt/'.length))}"/>`
  ))
  return additions.length > 0 ? appendRelationships(removed, additions) : removed
}

function sourceContentType(xml: string, path: string): string | undefined {
  return descendants(scanXml(xml), 'Override').find((override) => override.attributes.PartName === `/${path}`)?.attributes.ContentType
}

function mediaContentTypeAdditions(xml: string, media: Map<string, string>): { defaults: ContentTypeDefaultAddition[]; overrides: ContentTypeAddition[] } {
  const roots = scanXml(xml)
  const defaults = descendants(roots, 'Default').flatMap((entry) => {
    const extension = entry.attributes.Extension?.toLowerCase()
    const contentType = entry.attributes.ContentType
    return extension && contentType ? [{ extension, contentType }] : []
  })
  const overrides = descendants(roots, 'Override').flatMap((entry) => {
    const path = entry.attributes.PartName
    const contentType = entry.attributes.ContentType
    return path && contentType ? [{ path, contentType }] : []
  })
  const addedDefaults: ContentTypeDefaultAddition[] = []
  const addedOverrides: ContentTypeAddition[] = []
  const plannedDefaults = new Map<string, string>()
  for (const path of [...media.keys()].sort()) {
    const contentType = media.get(path)
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    if (!contentType || !extension) continue
    const existingOverride = overrides.find((entry) => entry.path === `/${path}`)
    if (existingOverride?.contentType === contentType) continue
    const existingDefault = defaults.find((entry) => entry.extension === extension)
    if (existingDefault?.contentType === contentType) continue
    const plannedDefault = plannedDefaults.get(extension)
    if (!existingDefault && (!plannedDefault || plannedDefault === contentType)) {
      if (!plannedDefault) {
        plannedDefaults.set(extension, contentType)
        addedDefaults.push({ extension, contentType })
      }
      continue
    }
    addedOverrides.push({ path, contentType })
  }
  return { defaults: addedDefaults, overrides: addedOverrides }
}

function contentTypePrefix(xml: string): string {
  const root = scanXml(xml)[0]
  if (!root) throw new Error('PPTX export content types malformed')
  const separator = root.name.lastIndexOf(':')
  return separator >= 0 ? root.name.slice(0, separator + 1) : ''
}

function rewriteContentTypes(
  xml: string,
  removedPaths: string[],
  addedPaths: string[] = [],
  addedOverrides: ContentTypeAddition[] = [],
  addedDefaults: ContentTypeDefaultAddition[] = [],
): string {
  const removed = new Set(removedPaths.map((path) => `/${path}`))
  const replacements = descendants(scanXml(xml), 'Override')
    .filter((override) => override.attributes.PartName !== undefined && removed.has(override.attributes.PartName))
    .map((override) => ({ start: override.start, end: override.end, value: '' }))
  const updated = replacements.length > 0 ? replaceRanges(xml, replacements) : xml
  const prefix = contentTypePrefix(updated)
  const existingOverrides = new Set(descendants(scanXml(updated), 'Override').flatMap((override) => override.attributes.PartName ? [override.attributes.PartName] : []))
  const existingDefaults = new Map(descendants(scanXml(updated), 'Default').flatMap((entry) => {
    const extension = entry.attributes.Extension?.toLowerCase()
    const contentType = entry.attributes.ContentType
    return extension && contentType ? [[extension, contentType] as const] : []
  }))
  const defaults = addedDefaults
    .filter((entry, index, values) => values.findIndex((value) => value.extension.toLowerCase() === entry.extension.toLowerCase()) === index)
    .filter((entry) => existingDefaults.get(entry.extension.toLowerCase()) !== entry.contentType)
    .map((entry) => `<${prefix}Default Extension="${escapeXml(entry.extension)}" ContentType="${escapeXml(entry.contentType)}"/>`)
  const additions = [
    ...addedPaths.map((path) => ({ path, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml' })),
    ...addedOverrides,
  ].filter(({ path }, index, values) => values.findIndex((value) => value.path === path) === index)
    .filter(({ path }) => !existingOverrides.has(`/${path}`))
    .map(({ path, contentType }) => (
      contentType
        ? `<${prefix}Override PartName="/${escapeXml(path)}" ContentType="${escapeXml(contentType)}"/>`
        : ''
    ))
    .filter((value) => value.length > 0)
  if (defaults.length === 0 && additions.length === 0) return updated
  const close = updated.lastIndexOf('</Types>')
  if (close < 0) throw new Error('PPTX export content types malformed')
  return `${updated.slice(0, close)}${defaults.join('')}${additions.join('')}${updated.slice(close)}`
}

/** Mirrors the importer's `parseBackground`, so an untouched background compares equal. */
function sourceBackground(bg: XmlElement | undefined, backgroundAssetId?: string): SlideBackground | undefined {
  if (!bg) return undefined
  const properties = bg.children.find((child) => child.localName === 'bgPr')
  const fillNode = properties?.children.find((child) => fillNodeNames.has(child.localName))
  // A photo background reads as its resolved asset, so an untouched one compares equal instead of
  // looking like "no background" and getting the whole node rewritten.
  if (fillNode?.localName === 'blipFill' && backgroundAssetId) return { pictureFill: { assetId: backgroundAssetId } }
  const fill = sourceFill(fillNode)
  if (fill) return { fill }
  const reference = bg.children.find((child) => child.localName === 'bgRef')
  const idx = Number(reference?.attributes.idx)
  if (!reference || !Number.isInteger(idx)) return undefined
  const color = sourceColor(reference)
  return { styleRef: { idx, ...(color ? { color } : {}) } }
}

function backgroundsEqual(left: SlideBackground | undefined, right: SlideBackground | undefined): boolean {
  if (!left || !right) return left === right
  if ((left.pictureFill?.assetId ?? undefined) !== (right.pictureFill?.assetId ?? undefined)) return false
  if (!fillsEqual(left.fill, right.fill)) return false
  const leftRef = left.styleRef
  const rightRef = right.styleRef
  if (!leftRef || !rightRef) return leftRef === rightRef
  return leftRef.idx === rightRef.idx && colorsEqual(leftRef.color, rightRef.color)
}

/** `p:bgPr` needs an effect list to be valid, which is why the empty one is written along with the fill. */
function serializeBackgroundNode(prefix: string, background: SlideBackground): string {
  if (background.fill) return `<${prefix}bg><${prefix}bgPr>${serializeFillXml(background.fill)}<a:effectLst/></${prefix}bgPr></${prefix}bg>`
  const reference = background.styleRef
  if (!reference) return ''
  const color = reference.color ? serializeColorXml(reference.color) : ''
  return `<${prefix}bg><${prefix}bgRef idx="${reference.idx}">${color}</${prefix}bgRef></${prefix}bg>`
}

/**
 * `p:bg`. A colour change replaces only the fill node inside the source's own `p:bgPr`, so its effect
 * list and any unknown siblings survive; a structural change (a `p:bgRef` becoming a fill, or the other
 * way round) replaces the whole node, and clearing the background deletes it — which is exactly what
 * "inherit from the layout" means in OOXML.
 */
function backgroundReplacements(xml: string, background: SlideBackground | undefined, backgroundAssetId?: string): Replacement[] {
  const roots = scanXml(xml)
  const common = descendants(roots, 'cSld')[0]
  if (!common) return []
  const bg = common.children.find((child) => child.localName === 'bg')
  const existing = sourceBackground(bg, backgroundAssetId)
  if (backgroundsEqual(existing, background)) return []
  // A picture background cannot be introduced here: it needs a media part and a relationship, and no
  // command can ask for one. Leaving the source alone is the only choice that does not corrupt it.
  if (background?.pictureFill) return []
  if (!background) return bg ? [{ start: bg.start, end: bg.end, value: '' }] : []
  const properties = bg?.children.find((child) => child.localName === 'bgPr')
  const fillNode = properties?.children.find((child) => fillNodeNames.has(child.localName))
  if (background.fill && properties && fillNode) {
    return [{ start: fillNode.start, end: fillNode.end, value: serializeFillForLine(background.fill, fillNode.name) }]
  }
  const prefix = namespacePrefix(bg?.name ?? common.name)
  const value = serializeBackgroundNode(prefix, background)
  if (!value) return []
  if (bg) return [{ start: bg.start, end: bg.end, value }]
  const tree = descendants(roots, 'spTree')[0]
  if (!tree) return []
  // `CT_CommonSlideData` puts `p:bg` before `p:spTree`, so the tree's start is the insertion point.
  return [{ start: tree.start, end: tree.start, value }]
}

/** Asset id to the relationship the source table already uses for it, so nothing new has to be added. */
function tablePictureRelationships(
  table: XmlElement,
  slidePath: string,
  relationships: SlideRelationship[],
): (assetId: string) => string | undefined {
  const byAsset = new Map<string, string>()
  for (const blip of descendants(table.children, 'blip')) {
    const relationshipId = blip.attributes['r:embed'] ?? blip.attributes.embed
    const relationship = relationships.find((value) => value.id === relationshipId && value.type === 'image')
    if (!relationship || !relationshipId) continue
    const assetId = stableAssetId(resolveTarget(slidePath, relationship.target))
    if (!byAsset.has(assetId)) byAsset.set(assetId, relationshipId)
  }
  return (assetId) => byAsset.get(assetId)
}

function replaceSlideTables(document: Ppt4aiDocument, slideId: string, xml: string, scanned: ScannedSlide, imageReplacements: Replacement[], strictIdentity: boolean, slidePath: string, relationships: SlideRelationship[]): string {
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`PPTX export document slide missing: ${slideId}`)
  const sourceElements = scanned.elements
  if (slide.elementIds.length < sourceElements.length) throw new Error(`PPTX export element count mismatch for slide ${slideId}`)

  const replacements: Replacement[] = [...imageReplacements, ...backgroundReplacements(xml, slide.background, scanned.backgroundAssetId)]
  for (let index = 0; index < sourceElements.length; index += 1) {
    const source = sourceElements[index]
    const elementId = slide.elementIds[index]
    const element = elementId ? document.elements[elementId] : undefined
    if (!source || !element) throw new Error(`PPTX export element mapping missing for slide ${slideId}`)
    const sourceElement = source.element
    if (strictIdentity && elementId !== source.expectedId) throw new Error(`PPTX export element prefix mismatch for slide ${slideId}`)
    if (source.group) {
      if (element.kind !== 'group') throw new Error(`PPTX export element prefix mismatch for slide ${slideId}`)
      replacements.push(...transformReplacements(xml, sourceElement, element))
      replacements.push(...groupBoundsReplacements(xml, sourceElement, element))
      continue
    }
    if (sourceElement.localName === 'pic') {
      if (element.kind !== 'image') throw new Error(`PPTX export element prefix mismatch for slide ${slideId}`)
      continue
    }
    if (sourceElement.localName !== 'graphicFrame') {
      if (element.kind === 'table') throw new Error(`PPTX export table source mismatch for element ${element.id}`)
      const sourceBodyElement = firstDescendant(sourceElement, 'txBody')
      if (sourceBodyElement) {
        if (element.kind !== 'text') throw new Error(`PPTX export text source mismatch for element ${element.id}`)
        const body = textBodyForElement(element)
        // Both sides go through the same serializer, so field order and omission rules normalize
        // themselves. Comparing against the raw source XML instead would rewrite every txBody,
        // since the source's own formatting and attribute order will not match ours.
        if (source.sourceBody === undefined || serializeTextBodyXml(body) !== serializeTextBodyXml(source.sourceBody)) {
          replacements.push({ start: sourceBodyElement.start, end: sourceBodyElement.end, value: serializeTextBodyXml(body) })
        }
        replacements.push(...boundsReplacements(xml, sourceElement, element.bounds))
        replacements.push(...transformReplacements(xml, sourceElement, element))
        replacements.push(...fillReplacements(xml, sourceElement, element.fill))
        replacements.push(...strokeReplacements(xml, sourceElement, element.stroke, element.strokeWidth, element.strokeStyle, element.strokeCap, element.strokeJoin, element.strokeCompound, element.strokeAlign))
      } else if (element.kind === 'text') {
        throw new Error(`PPTX export text source mismatch for element ${element.id}`)
      } else if (element.kind === 'shape') {
        replacements.push(...boundsReplacements(xml, sourceElement, element.bounds))
        replacements.push(...transformReplacements(xml, sourceElement, element))
        replacements.push(...fillReplacements(xml, sourceElement, element.fill))
        replacements.push(...strokeReplacements(xml, sourceElement, element.stroke, element.strokeWidth, element.strokeStyle, element.strokeCap, element.strokeJoin, element.strokeCompound, element.strokeAlign))
        replacements.push(...geometryReplacements(xml, sourceElement, element.preset))
      } else {
        throw new Error(`PPTX export shape source mismatch for element ${element.id}`)
      }
      continue
    }
    if (element.kind !== 'table') throw new Error(`PPTX export table source mismatch for element ${element.id}`)
    const table = firstDescendant(sourceElement, 'tbl')
    if (!table) throw new Error(`PPTX export table source missing for element ${element.id}`)
    replacements.push(...transformReplacements(xml, sourceElement, element))
    // The whole `a:tbl` is rebuilt, so the cells' pictures would vanish unless their relationships come
    // along: the ids are read back out of the table being replaced and matched by asset.
    replacements.push({ start: table.start, end: table.end, value: serializeTableXml(element, tablePictureRelationships(table, slidePath, relationships)) })
  }

  for (let index = sourceElements.length; index < slide.elementIds.length; index += 1) {
    const elementId = slide.elementIds[index]
    const element = elementId ? document.elements[elementId] : undefined
    if (!element || element.kind !== 'image') throw new Error(`PPTX export only supports trailing image additions for slide ${slideId}`)
  }

  return replaceRanges(xml, replacements)
}

function pictureShapeId(xml: string): number {
  const ids = descendants(scanXml(xml), 'cNvPr').flatMap((element) => {
    const value = Number(element.attributes.id)
    return Number.isInteger(value) && value > 0 ? [value] : []
  })
  return Math.max(0, ...ids) + 1
}

function appendBeforeSpTreeClose(xml: string, pictures: string[]): string {
  if (pictures.length === 0) return xml
  const close = xml.lastIndexOf('</p:spTree>')
  if (close >= 0) return `${xml.slice(0, close)}${pictures.join('')}${xml.slice(close)}`
  const selfClosing = /<p:spTree\b([^>]*)\/\s*>/iu
  if (!selfClosing.test(xml)) throw new Error('PPTX export slide shape tree missing')
  return xml.replace(selfClosing, '<p:spTree$1>' + pictures.join('') + '</p:spTree>')
}

function appendRelationships(xml: string | undefined, relationships: string[]): string {
  if (relationships.length === 0) return xml ?? ''
  if (!xml) return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`
  const close = xml.lastIndexOf('</Relationships>')
  if (close < 0) throw new Error('PPTX export slide relationships malformed')
  return `${xml.slice(0, close)}${relationships.join('')}${xml.slice(close)}`
}

function rewriteSlideLayoutRelationship(
  xml: string | undefined,
  outputPath: string,
  sourcePath: string,
  layout: LayoutRelationship,
): string {
  const target = relativeTarget(outputPath, layout.targetPath || resolveTarget(sourcePath, layout.target))
  const currentXml = xml ?? '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
  const relationship = descendants(scanXml(currentXml), 'Relationship').find((candidate) => relationshipType(candidate.attributes.Type ?? '') === 'slideLayout')
  if (relationship) {
    const currentTarget = relationship.attributes.Target
    if (currentTarget && resolveTarget(outputPath, currentTarget) === resolveTarget(outputPath, target)) return currentXml
    const raw = currentXml.slice(relationship.start, relationship.end)
    const targetPattern = /(\bTarget\s*=\s*)(["'])[^"']*\2/iu
    if (!targetPattern.test(raw)) throw new Error('PPTX export slide layout relationship malformed')
    const updated = raw.replace(targetPattern, (_match, prefix: string, quote: string) => `${prefix}${quote}${escapeXml(target)}${quote}`)
    return replaceRanges(currentXml, [{ start: relationship.start, end: relationship.end, value: updated }])
  }
  const ids = new Set(descendants(scanXml(currentXml), 'Relationship').flatMap((candidate) => candidate.attributes.Id ? [candidate.attributes.Id] : []))
  const relationshipId = ids.has(layout.id) ? allocateRelationshipId(ids) : layout.id
  return appendRelationships(currentXml, [`<Relationship Id="${escapeXml(relationshipId)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="${escapeXml(target)}"/>`])
}

function blankSlideXml(): string {
  return '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>'
}

function blankSlideRelationships(layout: SlideRelationship): string {
  return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${escapeXml(layout.id)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="${escapeXml(layout.target)}"/></Relationships>`
}

function sourceRelationshipXml(entries: Map<string, ZipEntry>, sourcePath: string, layout: SlideRelationship | undefined): string {
  const relationshipEntry = entries.get(relationshipFilePath(sourcePath))
  if (relationshipEntry) return decoder.decode(relationshipEntry.data)
  return layout ? blankSlideRelationships(layout) : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
}

interface ImageWritebackState {
  adapter?: AssetAdapter
  assets?: Record<string, AssetMetadata>
  entryNames: Set<string>
  mediaByAsset: Map<string, { path: string; bytes: Uint8Array }>
  mediaContentTypes: Map<string, string>
  pendingMedia: ZipEntry[]
}

async function imageBytes(state: ImageWritebackState, element: ImageElement): Promise<{ path: string; bytes: Uint8Array }> {
  const existing = state.mediaByAsset.get(element.assetId)
  if (existing) return existing
  if (!state.adapter) throw new Error(`PPTX export asset adapter missing: ${element.assetId}`)
  const bytes = await state.adapter.get(element.assetId)
  if (!bytes) throw new Error(`PPTX export asset bytes missing: ${element.assetId}`)
  const mimeType = state.assets?.[element.assetId]?.mimeType
  if (!mimeType) throw new Error(`PPTX export asset metadata missing: ${element.assetId}`)
  const bitmap = parseBitmapMetadata(bytes)
  if (!bitmap || bitmap.mimeType !== mimeType) throw new Error(`PPTX export asset bytes MIME mismatch: ${element.assetId}`)
  const path = allocateMediaPath(state.entryNames, mimeType)
  const result = { path, bytes: new Uint8Array(bytes) }
  state.entryNames.add(path)
  state.mediaByAsset.set(element.assetId, result)
  state.mediaContentTypes.set(path, mimeType)
  state.pendingMedia.push({ name: path, data: result.bytes })
  return result
}

function rewriteSourceThemes(document: Ppt4aiDocument, entriesByName: Map<string, ZipEntry>): void {
  const originalXmlByPath = new Map<string, string>()
  const rewrittenXmlByPath = new Map<string, string>()
  for (const themeId of Object.keys(document.themes ?? {}).sort()) {
    const theme = document.themes?.[themeId]
    const path = theme?.source?.partPath
    if (!path) continue
    const entry = entriesByName.get(path)
    if (!entry) throw new Error(`PPTX export theme source missing: ${path}`)
    let originalXml = originalXmlByPath.get(path)
    if (originalXml === undefined) {
      originalXml = decoder.decode(entry.data)
      originalXmlByPath.set(path, originalXml)
    }
    const rewrittenXml = rewriteThemeXml(originalXml, theme)
    const previous = rewrittenXmlByPath.get(path)
    if (previous !== undefined && previous !== rewrittenXml) throw new Error(`PPTX export theme source conflict: ${path}`)
    rewrittenXmlByPath.set(path, rewrittenXml)
  }

  for (const [path, rewrittenXml] of rewrittenXmlByPath) {
    const originalXml = originalXmlByPath.get(path)
    const entry = entriesByName.get(path)
    if (!originalXml || !entry || rewrittenXml === originalXml) continue
    entry.data = encoder.encode(rewrittenXml)
  }
}

function rewriteSourceMastersAndLayouts(document: Ppt4aiDocument, entriesByName: Map<string, ZipEntry>): void {
  const originalXmlByPath = new Map<string, string>()
  const rewrittenXmlByPath = new Map<string, string>()

  const rewritePart = (
    kind: 'master' | 'layout',
    id: string,
    path: string,
    rewrite: (source: string) => string,
  ): void => {
    const entry = entriesByName.get(path)
    if (!entry) throw new Error(`PPTX export ${kind} source missing: ${path}`)
    let originalXml = originalXmlByPath.get(path)
    if (originalXml === undefined) {
      originalXml = decoder.decode(entry.data)
      originalXmlByPath.set(path, originalXml)
    }
    const rewrittenXml = rewrite(originalXml)
    const previous = rewrittenXmlByPath.get(path)
    if (previous !== undefined && previous !== rewrittenXml) throw new Error(`PPTX export ${kind} source conflict: ${path}`)
    rewrittenXmlByPath.set(path, rewrittenXml)
  }

  for (const id of Object.keys(document.masters ?? {}).sort()) {
    const master = document.masters?.[id]
    const path = master?.source?.partPath
    if (!path || !master) continue
    rewritePart('master', id, path, (source) => rewriteMasterXml(source, master.defaults ?? {}, master.colorMap, id))
  }

  for (const id of Object.keys(document.layouts ?? {}).sort()) {
    const layout = document.layouts?.[id]
    const path = layout?.source?.partPath
    if (!path || !layout) continue
    rewritePart('layout', id, path, (source) => rewriteLayoutXml(source, layout.defaults ?? {}, layout.colorMapOverride, id))
  }

  for (const [path, rewrittenXml] of rewrittenXmlByPath) {
    const originalXml = originalXmlByPath.get(path)
    const entry = entriesByName.get(path)
    if (!originalXml || !entry || rewrittenXml === originalXml) continue
    entry.data = encoder.encode(rewrittenXml)
  }
}

export interface ExportPptxOptions {
  assetAdapter?: AssetAdapter
}

export async function exportPptx(document: Ppt4aiDocument, source: Uint8Array, options: ExportPptxOptions = {}): Promise<Uint8Array> {
  const sourceMetadata = document.source
  if (sourceMetadata?.packageFingerprint && sourceMetadata.modelFingerprint
    && sourceMetadata.packageFingerprint === fingerprintBytes(source)
    && sourceMetadata.modelFingerprint === fingerprintDocument(document)) {
    return new Uint8Array(source)
  }
  const entries = await readZipEntries(source)
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]))
  rewriteSourceThemes(document, entriesByName)
  rewriteSourceMastersAndLayouts(document, entriesByName)
  const sourcePackageData = sourcePackage(entriesByName)
  const plans = slidePlans(document, sourcePackageData, entriesByName)
  const scannedSlides = scanSourceSlides(sourcePackageData, entriesByName)
  const usedPaths = new Set(plans.filter((plan) => plan.mode === 'reuse').map((plan) => plan.outputPath))
  const removedSlides = sourcePackageData.slides.filter((slide) => !usedPaths.has(slide.partPath))
  const addedSlidePaths = plans.filter((plan) => plan.mode !== 'reuse').map((plan) => plan.outputPath)
  const dependencyClones = new Map<string, DependencyCloneResult>()
  const contentTypesEntry = entriesByName.get('[Content_Types].xml')
  const sourceContentTypesXml = contentTypesEntry ? decoder.decode(contentTypesEntry.data) : undefined
  const reservedPaths = new Set(entries.map((entry) => entry.name))
  for (const plan of plans.filter((candidate) => candidate.mode !== 'reuse')) {
    reservedPaths.add(plan.outputPath)
    reservedPaths.add(relationshipFilePath(plan.outputPath))
  }
  for (const plan of plans) {
    if (plan.mode !== 'clone' || !plan.source) continue
    const clone = clonePartDependencies(entriesByName, plan.source.partPath, plan.outputPath, reservedPaths)
    dependencyClones.set(plan.outputPath, clone)
    for (const entry of clone.entries) {
      if (entriesByName.has(entry.name)) throw new Error(`PPTX export dependency path collision: ${entry.name}`)
      entries.push(entry)
      entriesByName.set(entry.name, entry)
      reservedPaths.add(entry.name)
    }
  }
  const layoutRelationship = firstLayoutRelationship(sourcePackageData, entriesByName)
  for (const plan of plans) {
    if (plan.mode === 'reuse') continue
    if (plan.mode === 'clone' && dependencyClones.has(plan.outputPath)) continue
    const sourceEntry = plan.source ? entriesByName.get(plan.source.partPath) : undefined
    const slideData = plan.mode === 'clone'
      ? sourceEntry?.data.slice()
      : encoder.encode(blankSlideXml())
    if (!slideData) throw new Error(`PPTX export source part missing: ${plan.source?.partPath ?? plan.outputPath}`)
    const relationshipXml = plan.mode === 'clone'
      ? sourceRelationshipXml(entriesByName, plan.source?.partPath ?? '', plan.layoutRelationship ?? layoutRelationship)
      : plan.layoutRelationship
        ? blankSlideRelationships(plan.layoutRelationship)
        : layoutRelationship
          ? blankSlideRelationships(layoutRelationship)
          : undefined
    if (!relationshipXml) throw new Error(`PPTX export blank slide layout missing for slide ${plan.slideId}`)
    const relationshipPath = relationshipFilePath(plan.outputPath)
    if (entriesByName.has(plan.outputPath) || entriesByName.has(relationshipPath)) throw new Error(`PPTX export slide part collision: ${plan.outputPath}`)
    const slideEntry = { name: plan.outputPath, data: slideData }
    const relationshipEntry = { name: relationshipPath, data: encoder.encode(relationshipXml) }
    entries.push(slideEntry, relationshipEntry)
    entriesByName.set(slideEntry.name, slideEntry)
    entriesByName.set(relationshipEntry.name, relationshipEntry)
  }
  const state: ImageWritebackState = {
    ...(options.assetAdapter ? { adapter: options.assetAdapter } : {}),
    ...(document.assets ? { assets: document.assets } : {}),
    entryNames: new Set(entries.map((entry) => entry.name)),
    mediaByAsset: new Map(),
    mediaContentTypes: new Map(),
    pendingMedia: [],
  }
  for (const plan of plans) {
    const slideId = plan.slideId
    const slidePath = plan.outputPath
    const entry = entriesByName.get(slidePath)
    if (!entry) throw new Error(`PPTX export source part missing: ${slidePath}`)
    const slideRelationshipPath = relationshipFilePath(slidePath)
    let relationshipEntry = entriesByName.get(slideRelationshipPath)
    let slideXml = decoder.decode(entry.data)
    if (plan.mode !== 'blank' && plan.layoutRelationship) {
      const relationshipXml = relationshipEntry ? decoder.decode(relationshipEntry.data) : undefined
      const updatedRelationshipXml = rewriteSlideLayoutRelationship(
        relationshipXml,
        slidePath,
        plan.source?.partPath ?? slidePath,
        plan.layoutRelationship,
      )
      const relationshipData = encoder.encode(updatedRelationshipXml)
      if (relationshipEntry) relationshipEntry.data = relationshipData
      else {
        const created = { name: slideRelationshipPath, data: relationshipData }
        entries.push(created)
        entriesByName.set(created.name, created)
        relationshipEntry = created
      }
    }
    const slideRelationships = readRelationships(entriesByName, slidePath)
    const scanned = plan.source
      ? scannedSlides.get(plan.source.partPath)
      : { elements: [], invalidPictures: [], nextElementNumber: 0 }
    if (!scanned) throw new Error(`PPTX export source slide scan missing: ${plan.source?.partPath ?? slidePath}`)
    const slide = document.slides[slideId]
    if (!slide) throw new Error(`PPTX export document slide missing: ${slideId}`)
    if (slide.elementIds.length < scanned.elements.length) throw new Error(`PPTX export element count mismatch for slide ${slideId}`)
    const invalidPicture = scanned.invalidPictures.find(({ expectedId }) => slide.elementIds.includes(expectedId))
    if (invalidPicture) throw invalidPicture.error
    const newRelationships: string[] = []
    const relationshipIds = new Set(slideRelationships.map((relationship) => relationship.id))
    const pictures: string[] = []
    const imageReplacements: Replacement[] = []
    let nextShapeId = pictureShapeId(slideXml)
    for (let index = 0; index < slide.elementIds.length; index += 1) {
      const elementId = slide.elementIds[index]
      const element = elementId ? document.elements[elementId] : undefined
      const source = scanned.elements[index]
      const sourceElement = source?.element
      const sourceImage = source?.image
      if (!element) throw new Error(`PPTX export element mapping missing for slide ${slideId}`)
      if (source && plan.mode === 'reuse' && elementId !== source.expectedId) throw new Error(`PPTX export element prefix mismatch for slide ${slideId}`)
      if (source?.group) {
        if (element.kind !== 'group') throw new Error(`PPTX export element prefix mismatch for slide ${slideId}`)
        continue
      }
      if (sourceElement?.localName === 'pic') {
        if (!sourceImage || element.kind !== 'image') throw new Error(`PPTX export element prefix mismatch for slide ${slideId}`)
        const pictureStart = sourceElement.start
        const pictureEnd = sourceElement.end
        const pictureXml = slideXml.slice(pictureStart, pictureEnd)
        let rewrittenPicture = rewritePictureAppearance(pictureXml, element)
        if (element.assetId !== sourceImage.assetId) {
          const bytes = await imageBytes(state, element)
          const relationshipId = allocateRelationshipId(relationshipIds)
          relationshipIds.add(relationshipId)
          newRelationships.push(serializeImageRelationship(relationshipId, `../media/${bytes.path.slice('ppt/media/'.length)}`))
          rewrittenPicture = replacePictureRelationship(rewrittenPicture, relationshipId)
        }
        if (rewrittenPicture !== pictureXml) imageReplacements.push({ start: pictureStart, end: pictureEnd, value: rewrittenPicture })
        continue
      }
      if (sourceElement) {
        if (element.kind === 'image') throw new Error(`PPTX export element prefix mismatch for slide ${slideId}`)
        if (sourceElement.localName === 'graphicFrame' && element.kind !== 'table') throw new Error(`PPTX export table source mismatch for element ${element.id}`)
        if (sourceElement.localName !== 'graphicFrame' && element.kind === 'table') throw new Error(`PPTX export table source mismatch for element ${element.id}`)
        continue
      }
      if (element.kind !== 'image') throw new Error(`PPTX export only supports trailing image additions for slide ${slideId}`)
      const bytes = await imageBytes(state, element)
      const relationshipId = allocateRelationshipId(relationshipIds)
      relationshipIds.add(relationshipId)
      newRelationships.push(serializeImageRelationship(relationshipId, `../media/${bytes.path.slice('ppt/media/'.length)}`))
      pictures.push(serializePictureXml(element, relationshipId, nextShapeId))
      nextShapeId += 1
    }
    const replacedSlide = replaceSlideTables(document, slideId, slideXml, scanned, imageReplacements, plan.mode === 'reuse', slidePath, slideRelationships)
    const materializedSlide = appendBeforeSpTreeClose(replacedSlide, pictures)
    const rewrittenSlide = plan.source && slide.colorMapOverride !== undefined
      ? rewriteSlideColorMapXml(materializedSlide, slide.colorMapOverride, slideId)
      : materializedSlide
    entry.data = encoder.encode(rewrittenSlide)
    if (newRelationships.length > 0) {
      const relationshipXml = relationshipEntry ? decoder.decode(relationshipEntry.data) : undefined
      const relationshipData = encoder.encode(appendRelationships(relationshipXml, newRelationships))
      if (relationshipEntry) relationshipEntry.data = relationshipData
      else {
        const created = { name: slideRelationshipPath, data: relationshipData }
        entries.push(created)
        entriesByName.set(created.name, created)
      }
    }
  }

  const protectedRoots = plans.map((plan) => plan.outputPath)
  const presentationDependencies = readRelationships(entriesByName, 'ppt/presentation.xml')
    .filter((relationship) => relationship.type !== 'slide' && !/^[a-z][a-z\d+.-]*:/iu.test(relationship.target))
    .map((relationship) => resolveTarget('ppt/presentation.xml', relationship.target))
    .filter((path) => entriesByName.has(path))
  const orphanedPaths = findOrphanedParts(
    entriesByName,
    removedSlides.map((slide) => slide.partPath),
    [...protectedRoots, ...presentationDependencies],
  )
  const structureRequiresContentTypes = removedSlides.length > 0 || addedSlidePaths.length > 0 || dependencyClones.size > 0 || orphanedPaths.size > 0
  if (structureRequiresContentTypes || state.pendingMedia.length > 0) {
    if ((!contentTypesEntry || !sourceContentTypesXml) && structureRequiresContentTypes) throw new Error('PPTX export source part missing: [Content_Types].xml')
    if (contentTypesEntry && sourceContentTypesXml) {
      const mediaAdditions = mediaContentTypeAdditions(sourceContentTypesXml, state.mediaContentTypes)
      const dependencyOverrides = [...dependencyClones.values()].flatMap((clone) => [...clone.pathMap.entries()]
        .filter(([sourcePath, outputPath]) => sourcePath !== outputPath && !sourcePath.endsWith('.rels'))
        .flatMap(([sourcePath, outputPath]) => {
          const contentType = sourceContentType(sourceContentTypesXml, sourcePath)
          return contentType ? [{ path: outputPath, contentType }] : []
        }))
      contentTypesEntry.data = encoder.encode(rewriteContentTypes(
        sourceContentTypesXml,
        [...orphanedPaths],
        addedSlidePaths,
        [...dependencyOverrides, ...mediaAdditions.overrides],
        mediaAdditions.defaults,
      ))
    }
  }

  sourcePackageData.presentationEntry.data = encoder.encode(rewritePresentationOrder(
    sourcePackageData.presentationXml,
    plans,
    sourcePackageData.slides,
  ))
  sourcePackageData.presentationRelationshipsEntry.data = encoder.encode(rewritePresentationRelationships(
    sourcePackageData.presentationRelationshipsXml,
    sourcePackageData.slides,
    plans,
  ))
  const retainedEntries = entries.filter((entry) => !orphanedPaths.has(entry.name))
  return writeStoredZip([...retainedEntries, ...state.pendingMedia])
}
