import type { Ppt4aiDocument } from '@ppt4ai/model'
import { serializeTableXml } from './table.js'
import { readZipEntries, writeStoredZip, type ZipEntry } from './zip.js'

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

function slideElements(xml: string): XmlElement[] {
  const roots = scanXml(xml)
  const tree = descendants(roots, 'spTree')[0]
  if (!tree) return []
  const result: XmlElement[] = []
  const visit = (elements: XmlElement[]): void => {
    for (const element of elements) {
      if (element.localName === 'sp' && hasBounds(element)) result.push(element)
      if (element.localName === 'graphicFrame' && isImportableTable(element)) result.push(element)
      visit(element.children)
    }
  }
  visit(tree.children)
  return result
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

function replaceSlideTables(document: Ppt4aiDocument, slideId: string, xml: string): string {
  const slide = document.slides[slideId]
  if (!slide) throw new Error(`PPTX export document slide missing: ${slideId}`)
  const sourceElements = slideElements(xml)
  if (sourceElements.length !== slide.elementIds.length) throw new Error(`PPTX export element count mismatch for slide ${slideId}`)

  const replacements: Replacement[] = []
  for (let index = 0; index < sourceElements.length; index += 1) {
    const sourceElement = sourceElements[index]
    const elementId = slide.elementIds[index]
    const element = elementId ? document.elements[elementId] : undefined
    if (!sourceElement || !element) throw new Error(`PPTX export element mapping missing for slide ${slideId}`)
    if (sourceElement.localName !== 'graphicFrame') {
      if (element.kind === 'table') throw new Error(`PPTX export table source mismatch for element ${element.id}`)
      continue
    }
    if (element.kind !== 'table') throw new Error(`PPTX export table source mismatch for element ${element.id}`)
    const table = firstDescendant(sourceElement, 'tbl')
    if (!table) throw new Error(`PPTX export table source missing for element ${element.id}`)
    replacements.push({ start: table.start, end: table.end, value: serializeTableXml(element) })
  }

  let output = xml
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end)
  }
  return output
}

export async function exportPptx(document: Ppt4aiDocument, source: Uint8Array): Promise<Uint8Array> {
  const entries = await readZipEntries(source)
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]))
  const slidePaths = sourceSlidePaths(entriesByName)

  for (const slideId of document.slideOrder) {
    const slidePath = slidePaths.get(slideId)
    if (!slidePath) throw new Error(`PPTX export slide relationship missing for slide ${slideId}`)
    const entry = entriesByName.get(slidePath)
    if (!entry) throw new Error(`PPTX export source part missing: ${slidePath}`)
    entry.data = encoder.encode(replaceSlideTables(document, slideId, decoder.decode(entry.data)))
  }
  return writeStoredZip(entries)
}
