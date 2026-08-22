import { type Color, type Element, type ElementDefaults, type Fill, type Ppt4aiDocument, type PresetGeometry, type Rect, type SlideLayout, type SlideMaster, type TextBody, type TextBullet, type TextParagraph, type TextRun } from '@ppt4ai/model'
import { attribute, child, children, localName, parseXml, textContent, type XmlNode } from './xml'
import { readZipEntries } from './zip'

interface Relationship {
  id: string
  target: string
  type: string
}

interface ImportedPart {
  path: string
  xml: XmlNode
}

function pathDirectory(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

function normalizePath(path: string): string {
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}

function resolveTarget(basePath: string, target: string): string {
  return normalizePath(target.startsWith('/') ? target.slice(1) : `${pathDirectory(basePath)}/${target}`)
}

function findDescendants(node: XmlNode, name: string): XmlNode[] {
  const result: XmlNode[] = []
  for (const current of node.children) {
    if (localName(current.name) === name) result.push(current)
    result.push(...findDescendants(current, name))
  }
  return result
}

function relationshipType(value: string): string {
  return value.slice(value.lastIndexOf('/') + 1)
}

function parseRelationships(xml: string): Relationship[] {
  const root = parseXml(xml)
  return findDescendants(root, 'Relationship').flatMap((node) => {
    const id = attribute(node, 'Id')
    const target = attribute(node, 'Target')
    const type = attribute(node, 'Type')
    return id && target && type ? [{ id, target, type: relationshipType(type) }] : []
  })
}

function relationshipFilePath(partPath: string): string {
  return `${pathDirectory(partPath)}/_rels/${partPath.slice(partPath.lastIndexOf('/') + 1)}.rels`
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function parseBounds(shape: XmlNode): Rect | undefined {
  const transform = findDescendants(shape, 'xfrm')[0]
  const off = transform && child(transform, 'off')
  const ext = transform && child(transform, 'ext')
  const x = parseNumber(off && attribute(off, 'x'))
  const y = parseNumber(off && attribute(off, 'y'))
  const w = parseNumber(ext && attribute(ext, 'cx'))
  const h = parseNumber(ext && attribute(ext, 'cy'))
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined
  if (w <= 0 || h <= 0) return undefined
  return { x, y, w, h }
}

function parseColor(node: XmlNode | undefined): Color | undefined {
  if (!node) return undefined
  const srgb = child(node, 'srgbClr')
  if (srgb) {
    const value = attribute(srgb, 'val')
    return value ? { type: 'srgb', v: value } : undefined
  }
  const scheme = child(node, 'schemeClr')
  if (scheme) {
    const value = attribute(scheme, 'val')
    return value ? { type: 'scheme', v: value } : undefined
  }
  const preset = child(node, 'prstClr')
  if (preset) {
    const value = attribute(preset, 'val')
    return value ? { type: 'preset', v: value } : undefined
  }
  return undefined
}

function parseFill(shape: XmlNode): Fill | undefined {
  const fill = findDescendants(shape, 'solidFill')[0]
  return fill ? (parseColor(fill) ? { color: parseColor(fill)! } : undefined) : undefined
}

function parsePreset(shape: XmlNode): PresetGeometry {
  const geometry = findDescendants(shape, 'prstGeom')[0]
  const preset = geometry && attribute(geometry, 'prst')
  if (preset === 'roundRect' || preset === 'ellipse' || preset === 'triangle') return preset
  return 'rect'
}

function parsePlaceholder(shape: XmlNode): string | undefined {
  const placeholder = findDescendants(shape, 'ph')[0]
  if (!placeholder) return undefined
  const type = attribute(placeholder, 'type') ?? 'body'
  const index = attribute(placeholder, 'idx')
  return index ? `${type}:${index}` : type
}

function parseText(shape: XmlNode): { present: boolean; value: string } {
  const body = findDescendants(shape, 'txBody')[0]
  if (!body) return { present: false, value: '' }
  const parts: string[] = []
  for (const node of findDescendants(body, 't')) parts.push(textContent(node))
  const lineBreaks = findDescendants(body, 'br').length
  return { present: true, value: parts.join('') + '\n'.repeat(lineBreaks) }
}

function parseBullet(paragraphProperties: XmlNode | undefined): TextBullet | undefined {
  if (!paragraphProperties) return undefined
  const character = child(paragraphProperties, 'buChar')
  if (character) {
    const value = attribute(character, 'char')
    if (!value || Array.from(value).length !== 1) return undefined
    const runProperties = child(character, 'rPr')
    const fontFamily = runProperties ? attribute(runProperties, 'typeface') : undefined
    return fontFamily ? { type: 'char', char: value, fontFamily } : { type: 'char', char: value }
  }
  const autoNumber = child(paragraphProperties, 'buAutoNum')
  if (!autoNumber) return undefined
  const type = attribute(autoNumber, 'type')
  const scheme = type === 'alphaLcPeriod' || type === 'alphaLcParenRight'
    ? 'alphaLower'
    : type === 'alphaUcPeriod' || type === 'alphaUcParenRight'
      ? 'alphaUpper'
      : 'arabic'
  const rawStart = attribute(autoNumber, 'startAt')
  const startAt = rawStart === undefined ? undefined : parseNumber(rawStart)
  if (startAt !== undefined && (!Number.isInteger(startAt) || startAt <= 0)) return undefined
  return startAt === undefined ? { type: 'autoNum', scheme } : { type: 'autoNum', scheme, startAt }
}

function parseTextBody(shape: XmlNode): TextBody | undefined {
  const body = findDescendants(shape, 'txBody')[0]
  if (!body) return undefined
  const paragraphs: TextParagraph[] = children(body, 'p').map((paragraphNode) => {
    const runs: TextRun[] = []
    for (const runNode of children(paragraphNode, 'r')) {
      const textNode = child(runNode, 't')
      if (!textNode) continue
      const text = textContent(textNode)
      if (text) runs.push({ text })
    }
    const attrs = parseBullet(child(paragraphNode, 'pPr'))
    return attrs ? { runs, attrs: { bullet: attrs } } : { runs }
  })
  return paragraphs.length > 0 ? { paragraphs } : undefined
}

function parseElement(shape: XmlNode, id: string, requireBounds: boolean): Element | undefined {
  const bounds = parseBounds(shape)
  if (requireBounds && !bounds) return undefined
  const placeholder = parsePlaceholder(shape)
  const text = parseText(shape)
  if (text.present) {
    if (!bounds) return undefined
    const element: Extract<Element, { kind: 'text' }> = { id, kind: 'text', bounds, text: text.value }
    const body = parseTextBody(shape)
    if (body) element.body = body
    if (placeholder) element.placeholder = placeholder
    const fill = parseFill(shape)
    if (fill) element.fill = fill
    return element
  }
  if (!bounds) return undefined
  const element: Extract<Element, { kind: 'shape' }> = {
    id,
    kind: 'shape',
    preset: parsePreset(shape),
    bounds,
  }
  if (placeholder) element.placeholder = placeholder
  const fill = parseFill(shape)
  if (fill) element.fill = fill
  return element
}

function parseDefaults(shape: XmlNode): [string, ElementDefaults] | undefined {
  const placeholder = parsePlaceholder(shape)
  if (!placeholder) return undefined
  const defaults: ElementDefaults = {}
  const bounds = parseBounds(shape)
  if (bounds) defaults.bounds = bounds
  defaults.preset = parsePreset(shape)
  const fill = parseFill(shape)
  if (fill) defaults.fill = fill
  const text = parseText(shape)
  if (text.present && text.value) defaults.text = text.value
  return [placeholder, defaults]
}

function parseMaster(path: string, xml: string, id: string): SlideMaster {
  const defaults: Record<string, ElementDefaults> = {}
  for (const shape of findDescendants(parseXml(xml), 'sp')) {
    const parsed = parseDefaults(shape)
    if (parsed) defaults[parsed[0]] = parsed[1]
  }
  return { id, defaults }
}

function parseLayout(path: string, xml: string, id: string, masterId: string): SlideLayout {
  const defaults: Record<string, ElementDefaults> = {}
  for (const shape of findDescendants(parseXml(xml), 'sp')) {
    const parsed = parseDefaults(shape)
    if (parsed) defaults[parsed[0]] = parsed[1]
  }
  return { id, masterId, defaults }
}

function parsePart(entries: Record<string, Uint8Array>, path: string): ImportedPart | undefined {
  const bytes = entries[path]
  if (!bytes) return undefined
  return { path, xml: parseXml(new TextDecoder().decode(bytes)) }
}

function readRelationships(entries: Record<string, Uint8Array>, partPath: string): Relationship[] {
  const relationPath = relationshipFilePath(partPath)
  const bytes = entries[relationPath]
  return bytes ? parseRelationships(new TextDecoder().decode(bytes)) : []
}

function relationshipTarget(partPath: string, relations: Relationship[], relationshipId: string | undefined, type: string): string | undefined {
  const relationship = relations.find((value) => value.id === relationshipId && value.type === type)
  return relationship ? resolveTarget(partPath, relationship.target) : undefined
}

function parseSlideSize(root: XmlNode): { w: number; h: number } {
  const size = child(root, 'presentation') && child(child(root, 'presentation')!, 'sldSz')
  const w = parseNumber(size && attribute(size, 'cx')) ?? 12192000
  const h = parseNumber(size && attribute(size, 'cy')) ?? 6858000
  return { w, h }
}

function xmlEntries(entries: Record<string, Uint8Array>): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith('.xml') || path.endsWith('.rels')) output[path] = new TextDecoder().decode(bytes)
  }
  return output
}

export async function importPptx(input: Uint8Array): Promise<Ppt4aiDocument> {
  const entries = await readZipEntries(input)
  const presentationPath = 'ppt/presentation.xml'
  const presentation = parsePart(entries, presentationPath)
  if (!presentation) throw new Error('PPTX is missing ppt/presentation.xml')
  const presentationRelations = readRelationships(entries, presentationPath)
  const slideIds = child(presentation.xml, 'presentation') && child(child(presentation.xml, 'presentation')!, 'sldIdLst')
  const slideRefs = slideIds ? children(slideIds, 'sldId') : []
  const slides: Ppt4aiDocument['slides'] = {}
  const elements: Ppt4aiDocument['elements'] = {}
  const layouts: Record<string, SlideLayout> = {}
  const masters: Record<string, SlideMaster> = {}
  const slideOrder: string[] = []
  let elementCounter = 1
  let layoutCounter = 1
  let masterCounter = 1
  const layoutIdsByPath = new Map<string, string>()
  const masterIdsByPath = new Map<string, string>()

  for (let slideIndex = 0; slideIndex < slideRefs.length; slideIndex += 1) {
    const reference = slideRefs[slideIndex]
    if (!reference) continue
    const relationshipId = reference.attributes['r:id'] ?? reference.attributes['id']
    const slidePath = relationshipTarget(presentationPath, presentationRelations, relationshipId, 'slide')
    if (!slidePath) continue
    const slidePart = parsePart(entries, slidePath)
    if (!slidePart) continue
    const slideId = `sld_${slideIndex + 1}`
    const slideRelations = readRelationships(entries, slidePath)
    const layoutRelationship = slideRelations.find((value) => value.type === 'slideLayout')
    const layoutPath = relationshipTarget(slidePath, slideRelations, layoutRelationship?.id, 'slideLayout')
    let layoutId: string | undefined
    let masterId: string | undefined
    if (layoutPath) {
      layoutId = layoutIdsByPath.get(layoutPath)
      if (layoutId) {
        masterId = layouts[layoutId]?.masterId
      } else {
        layoutId = `lyt_${layoutCounter++}`
        layoutIdsByPath.set(layoutPath, layoutId)
        const layoutPart = parsePart(entries, layoutPath)
        const layoutRelations = readRelationships(entries, layoutPath)
        const masterRelationship = layoutRelations.find((value) => value.type === 'slideMaster')
        const masterPath = relationshipTarget(layoutPath, layoutRelations, masterRelationship?.id, 'slideMaster')
        if (masterPath) {
          masterId = masterIdsByPath.get(masterPath)
          if (!masterId) {
            masterId = `mst_${masterCounter++}`
            masterIdsByPath.set(masterPath, masterId)
            const masterPart = parsePart(entries, masterPath)
            if (masterPart) masters[masterId] = parseMaster(masterPath, new TextDecoder().decode(entries[masterPath]!), masterId)
          }
        }
        if (layoutPart) layouts[layoutId] = parseLayout(layoutPath, new TextDecoder().decode(entries[layoutPath]!), layoutId, masterId ?? '')
      }
    }

    const elementIds: string[] = []
    for (const shape of findDescendants(slidePart.xml, 'sp')) {
      const id = `el_${elementCounter++}`
      const element = parseElement(shape, id, true)
      if (!element) continue
      elements[id] = element
      elementIds.push(id)
    }
    slides[slideId] = { id: slideId, elementIds, ...(layoutId ? { layoutId } : {}), ...(masterId ? { masterId } : {}) }
    slideOrder.push(slideId)
  }

  const page = parseSlideSize(presentation.xml)
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_imported',
    page,
    slides,
    elements,
    slideOrder,
    layouts,
    masters,
    source: { entries: xmlEntries(entries) },
  }
}
