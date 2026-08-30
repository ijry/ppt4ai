import { parseBitmapMetadata, type AssetAdapter, type AssetMetadata, type ImageElement, type Ppt4aiDocument } from '@ppt4ai/model'
import { serializeTableXml } from './table.js'
import { readZipEntries, writeStoredZip, type ZipEntry } from './zip.js'
import {
  allocateMediaPath,
  allocateRelationshipId,
  replacePictureRelationship,
  serializeImageRelationship,
  serializePictureXml,
  stableAssetId,
} from './image-writeback.js'

interface XmlElement {
  name: string
  localName: string
  attributes: Record<string, string>
  start: number
  end: number
  children: XmlElement[]
}

interface OpenElement extends XmlElement {
  end: number
}

interface Replacement {
  start: number
  end: number
  value: string
}

interface SlideRelationship {
  id: string
  target: string
  type: string
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
}

interface ScannedSlide {
  elements: ScannedElement[]
  invalidPictures: Array<{ expectedId: string; error: Error }>
  nextElementNumber: number
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

interface ReuseSlidePlan {
  slideId: string
  source: SourceSlide
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const encoder = new TextEncoder()

function tagEnd(xml: string, start: number): number {
  let quote = ''
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index] ?? ''
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index + 1
    }
  }
  throw new Error('PPTX export encountered malformed XML')
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const expression = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (const match of source.matchAll(expression)) {
    const name = match[1]
    if (name) attributes[name] = decodeXml(match[2] ?? match[3] ?? '')
  }
  return attributes
}

function scanXml(xml: string): XmlElement[] {
  const roots: XmlElement[] = []
  const stack: OpenElement[] = []
  let cursor = 0
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor)
    if (start < 0) break
    if (xml.startsWith('<!--', start)) {
      const end = xml.indexOf('-->', start + 4)
      if (end < 0) throw new Error('PPTX export encountered malformed XML')
      cursor = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const end = xml.indexOf(']]>', start + 9)
      if (end < 0) throw new Error('PPTX export encountered malformed XML')
      cursor = end + 3
      continue
    }
    if (xml.startsWith('<?', start)) {
      const end = xml.indexOf('?>', start + 2)
      if (end < 0) throw new Error('PPTX export encountered malformed XML')
      cursor = end + 2
      continue
    }
    if (xml.startsWith('<!', start)) {
      cursor = tagEnd(xml, start + 2)
      continue
    }

    const end = tagEnd(xml, start + 1)
    const content = xml.slice(start + 1, end - 1).trim()
    if (content.startsWith('/')) {
      const name = content.slice(1).trim().split(/\s/, 1)[0]
      const current = stack.pop()
      if (!current || current.name !== name) throw new Error('PPTX export encountered malformed XML')
      current.end = end
      cursor = end
      continue
    }

    const selfClosing = /\/\s*$/.test(content)
    const opening = selfClosing ? content.replace(/\/\s*$/, '').trimEnd() : content
    const name = opening.split(/\s/, 1)[0]
    if (!name) throw new Error('PPTX export encountered malformed XML')
    const element: OpenElement = {
      name,
      localName: name.slice(name.lastIndexOf(':') + 1),
      attributes: parseAttributes(opening.slice(name.length)),
      start,
      end,
      children: [],
    }
    const parent = stack.at(-1)
    if (parent) parent.children.push(element)
    else roots.push(element)
    if (!selfClosing) stack.push(element)
    cursor = end
  }
  if (stack.length > 0) throw new Error('PPTX export encountered malformed XML')
  return roots
}

function descendants(elements: XmlElement[], localName: string): XmlElement[] {
  const result: XmlElement[] = []
  for (const element of elements) {
    if (element.localName === localName) result.push(element)
    result.push(...descendants(element.children, localName))
  }
  return result
}

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

function slideElements(xml: string, slideId: string, slidePath: string, relationships: SlideRelationship[], entries: Map<string, ZipEntry>, elementNumberStart: number): ScannedSlide {
  const roots = scanXml(xml)
  const tree = descendants(roots, 'spTree')[0]
  if (!tree) return { elements: [], invalidPictures: [], nextElementNumber: elementNumberStart }
  const result: ScannedElement[] = []
  const invalidPictures: Array<{ expectedId: string; error: Error }> = []
  let elementNumber = elementNumberStart
  const visit = (elements: XmlElement[]): void => {
    for (const element of elements) {
      const candidate = element.localName === 'sp' || element.localName === 'graphicFrame' || element.localName === 'pic'
      const expectedId = candidate ? `el_${elementNumber}` : undefined
      if (candidate) elementNumber += 1
      if (expectedId && element.localName === 'sp' && hasBounds(element)) {
        result.push({ element, expectedId })
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
  return { elements: result, invalidPictures, nextElementNumber: elementNumber }
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

function resolveSourceSlide(slideId: string, slide: Ppt4aiDocument['slides'][string] | undefined, slides: SourceSlide[]): SourceSlide {
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
  if (!source || source.originId !== slideId) throw new Error(`PPTX export source slide binding missing for slide ${slideId}`)
  return source
}

function reuseSlidePlans(document: Ppt4aiDocument, source: SourcePackage): ReuseSlidePlan[] {
  const usedPaths = new Set<string>()
  return document.slideOrder.map((slideId) => {
    const slide = document.slides[slideId]
    const sourceSlide = resolveSourceSlide(slideId, slide, source.slides)
    if (usedPaths.has(sourceSlide.partPath)) throw new Error(`PPTX export source slide reused by multiple pages: ${sourceSlide.partPath}`)
    usedPaths.add(sourceSlide.partPath)
    return { slideId, source: sourceSlide }
  })
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

function replaceRanges(xml: string, replacements: Replacement[]): string {
  let output = xml
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end)
  }
  return output
}

function rewritePresentationOrder(xml: string, plans: ReuseSlidePlan[], originalSlides: SourceSlide[]): string {
  const list = descendants(scanXml(xml), 'sldIdLst')[0]
  if (!list) throw new Error('PPTX export presentation slide list missing')
  const originalPaths = originalSlides.map((slide) => slide.partPath)
  const currentPaths = plans.map((plan) => plan.source.partPath)
  if (originalPaths.length === currentPaths.length && originalPaths.every((path, index) => path === currentPaths[index])) return xml
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
  const rawReferences = plans.map((plan) => xml.slice(plan.source.reference.start, plan.source.reference.end))
  const replacement: Replacement = {
    start: first.start,
    end: last.end,
    value: rawReferences.join(separator),
  }
  return xml.slice(0, replacement.start) + replacement.value + xml.slice(replacement.end)
}

function rewritePresentationRelationships(xml: string, originalSlides: SourceSlide[], usedPaths: Set<string>): string {
  const replacements = originalSlides
    .filter((slide) => !usedPaths.has(slide.partPath))
    .map((slide) => ({ start: slide.relationship.start, end: slide.relationship.end, value: '' }))
  return replacements.length > 0 ? replaceRanges(xml, replacements) : xml
}

function rewriteContentTypes(xml: string, removedPaths: string[]): string {
  const removed = new Set(removedPaths.map((path) => `/${path}`))
  const replacements = descendants(scanXml(xml), 'Override')
    .filter((override) => override.attributes.PartName !== undefined && removed.has(override.attributes.PartName))
    .map((override) => ({ start: override.start, end: override.end, value: '' }))
  return replacements.length > 0 ? replaceRanges(xml, replacements) : xml
}

function replaceSlideTables(document: Ppt4aiDocument, slideId: string, xml: string, scanned: ScannedSlide, imageReplacements: Replacement[]): string {
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`PPTX export document slide missing: ${slideId}`)
  const sourceElements = scanned.elements
  if (slide.elementIds.length < sourceElements.length) throw new Error(`PPTX export element count mismatch for slide ${slideId}`)

  const replacements: Replacement[] = [...imageReplacements]
  for (let index = 0; index < sourceElements.length; index += 1) {
    const source = sourceElements[index]
    const elementId = slide.elementIds[index]
    const element = elementId ? document.elements[elementId] : undefined
    if (!source || !element) throw new Error(`PPTX export element mapping missing for slide ${slideId}`)
    const sourceElement = source.element
    if (elementId !== source.expectedId) throw new Error(`PPTX export element prefix mismatch for slide ${slideId}`)
    if (sourceElement.localName !== 'graphicFrame') {
      if (element.kind === 'table') throw new Error(`PPTX export table source mismatch for element ${element.id}`)
      continue
    }
    if (element.kind !== 'table') throw new Error(`PPTX export table source mismatch for element ${element.id}`)
    const table = firstDescendant(sourceElement, 'tbl')
    if (!table) throw new Error(`PPTX export table source missing for element ${element.id}`)
    replacements.push({ start: table.start, end: table.end, value: serializeTableXml(element) })
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

interface ImageWritebackState {
  adapter?: AssetAdapter
  assets?: Record<string, AssetMetadata>
  entryNames: Set<string>
  mediaByAsset: Map<string, { path: string; bytes: Uint8Array }>
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
  state.pendingMedia.push({ name: path, data: result.bytes })
  return result
}

export interface ExportPptxOptions {
  assetAdapter?: AssetAdapter
}

export async function exportPptx(document: Ppt4aiDocument, source: Uint8Array, options: ExportPptxOptions = {}): Promise<Uint8Array> {
  const entries = await readZipEntries(source)
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]))
  const sourcePackageData = sourcePackage(entriesByName)
  const plans = reuseSlidePlans(document, sourcePackageData)
  const scannedSlides = scanSourceSlides(sourcePackageData, entriesByName)
  const usedPaths = new Set(plans.map((plan) => plan.source.partPath))
  const removedSlides = sourcePackageData.slides.filter((slide) => !usedPaths.has(slide.partPath))
  if (removedSlides.length > 0) {
    const contentTypesEntry = entriesByName.get('[Content_Types].xml')
    if (!contentTypesEntry) throw new Error('PPTX export source part missing: [Content_Types].xml')
    contentTypesEntry.data = encoder.encode(rewriteContentTypes(
      decoder.decode(contentTypesEntry.data),
      removedSlides.map((slide) => slide.partPath),
    ))
  }
  const state: ImageWritebackState = {
    ...(options.assetAdapter ? { adapter: options.assetAdapter } : {}),
    ...(document.assets ? { assets: document.assets } : {}),
    entryNames: new Set(entries.map((entry) => entry.name)),
    mediaByAsset: new Map(),
    pendingMedia: [],
  }
  for (const plan of plans) {
    const slideId = plan.slideId
    const slidePath = plan.source.partPath
    const entry = entriesByName.get(slidePath)
    if (!entry) throw new Error(`PPTX export source part missing: ${slidePath}`)
    const slideXml = decoder.decode(entry.data)
    const slideRelationships = readRelationships(entriesByName, slidePath)
    const slideRelationshipPath = relationshipFilePath(slidePath)
    const relationshipEntry = entriesByName.get(slideRelationshipPath)
    const scanned = scannedSlides.get(slidePath)
    if (!scanned) throw new Error(`PPTX export source slide scan missing: ${slidePath}`)
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
      if (source && elementId !== source.expectedId) throw new Error(`PPTX export element prefix mismatch for slide ${slideId}`)
      if (sourceElement?.localName === 'pic') {
        if (!sourceImage || element.kind !== 'image') throw new Error(`PPTX export element prefix mismatch for slide ${slideId}`)
        if (element.assetId !== sourceImage.assetId) {
          const bytes = await imageBytes(state, element)
          const relationshipId = allocateRelationshipId(relationshipIds)
          relationshipIds.add(relationshipId)
          newRelationships.push(serializeImageRelationship(relationshipId, `../media/${bytes.path.slice('ppt/media/'.length)}`))
          const pictureStart = sourceElement.start
          const pictureEnd = sourceElement.end
          const pictureXml = slideXml.slice(pictureStart, pictureEnd)
          imageReplacements.push({ start: pictureStart, end: pictureEnd, value: replacePictureRelationship(pictureXml, relationshipId) })
        }
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
    const replacedSlide = replaceSlideTables(document, slideId, slideXml, scanned, imageReplacements)
    entry.data = encoder.encode(appendBeforeSpTreeClose(replacedSlide, pictures))
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

  sourcePackageData.presentationEntry.data = encoder.encode(rewritePresentationOrder(
    sourcePackageData.presentationXml,
    plans,
    sourcePackageData.slides,
  ))
  sourcePackageData.presentationRelationshipsEntry.data = encoder.encode(rewritePresentationRelationships(
    sourcePackageData.presentationRelationshipsXml,
    sourcePackageData.slides,
    usedPaths,
  ))
  const removedPaths = new Set(removedSlides.flatMap((slide) => [slide.partPath, relationshipFilePath(slide.partPath)]))
  const retainedEntries = entries.filter((entry) => !removedPaths.has(entry.name))
  return writeStoredZip([...retainedEntries, ...state.pendingMedia])
}
