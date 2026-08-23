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
  nextElementNumber: number
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
  if (!tree) return { elements: [], nextElementNumber: elementNumberStart }
  const result: ScannedElement[] = []
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
        const image = sourceImage(element, slideId, slidePath, relationships, entries)
        result.push({ element, expectedId, image })
      }
      visit(element.children)
    }
  }
  visit(tree.children)
  return { elements: result, nextElementNumber: elementNumber }
}

function sourceSlidePaths(entries: Map<string, ZipEntry>): Map<string, string> {
  const presentationPath = 'ppt/presentation.xml'
  const relationshipsPath = 'ppt/_rels/presentation.xml.rels'
  const presentationEntry = entries.get(presentationPath)
  const relationshipsEntry = entries.get(relationshipsPath)
  if (!presentationEntry) throw new Error(`PPTX export source part missing: ${presentationPath}`)
  if (!relationshipsEntry) throw new Error(`PPTX export source part missing: ${relationshipsPath}`)

  const slideReferences = descendants(scanXml(decoder.decode(presentationEntry.data)), 'sldId')
  const relationships = descendants(scanXml(decoder.decode(relationshipsEntry.data)), 'Relationship')
  const targets = new Map<string, string>()
  for (const relationship of relationships) {
    const id = relationship.attributes.Id
    const target = relationship.attributes.Target
    const type = relationship.attributes.Type
    if (id && target && type?.slice(type.lastIndexOf('/') + 1) === 'slide') targets.set(id, resolveTarget(presentationPath, target))
  }

  const paths = new Map<string, string>()
  for (let index = 0; index < slideReferences.length; index += 1) {
    const reference = slideReferences[index]
    const relationshipId = reference?.attributes['r:id'] ?? reference?.attributes.id
    const target = relationshipId ? targets.get(relationshipId) : undefined
    if (target) paths.set(`sld_${index + 1}`, target)
  }
  return paths
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

  let output = xml
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end)
  }
  return output
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
  const slidePaths = sourceSlidePaths(entriesByName)
  const state: ImageWritebackState = {
    ...(options.assetAdapter ? { adapter: options.assetAdapter } : {}),
    ...(document.assets ? { assets: document.assets } : {}),
    entryNames: new Set(entries.map((entry) => entry.name)),
    mediaByAsset: new Map(),
    pendingMedia: [],
  }
  let sourceElementNumber = 1

  for (const slideId of document.slideOrder) {
    const slidePath = slidePaths.get(slideId)
    if (!slidePath) throw new Error(`PPTX export slide relationship missing for slide ${slideId}`)
    const entry = entriesByName.get(slidePath)
    if (!entry) throw new Error(`PPTX export source part missing: ${slidePath}`)
    const slideXml = decoder.decode(entry.data)
    const slideRelationships = readRelationships(entriesByName, slidePath)
    const slideRelationshipPath = relationshipFilePath(slidePath)
    const relationshipEntry = entriesByName.get(slideRelationshipPath)
    const scanned = slideElements(slideXml, slideId, slidePath, slideRelationships, entriesByName, sourceElementNumber)
    sourceElementNumber = scanned.nextElementNumber
    const slide = document.slides[slideId]
    if (!slide) throw new Error(`PPTX export document slide missing: ${slideId}`)
    if (slide.elementIds.length < scanned.elements.length) throw new Error(`PPTX export element count mismatch for slide ${slideId}`)
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
  return writeStoredZip([...entries, ...state.pendingMedia])
}
