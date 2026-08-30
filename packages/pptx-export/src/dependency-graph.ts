import type { ZipEntry } from './zip.js'

interface XmlElement {
  name: string
  localName: string
  attributes: Record<string, string>
  start: number
  end: number
  openingEnd: number
  children: XmlElement[]
}

interface OpenElement extends XmlElement {
  end: number
}

interface RelationshipNode {
  id: string
  type: string
  target: string
  targetMode?: string
  element: XmlElement
}

export interface DependencyCloneResult {
  rootPath: string
  pathMap: Map<string, string>
  entries: ZipEntry[]
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const encoder = new TextEncoder()

const sharedRelationshipTypes = new Set([
  'handoutMaster',
  'notesMaster',
  'slideLayout',
  'slideMaster',
  'theme',
])

const sharedPartPaths = new Set([
  'ppt/presentation.xml',
  'ppt/tableStyles.xml',
  'ppt/presProps.xml',
  'ppt/viewProps.xml',
])

function fail(message: string): never {
  throw new Error(`PPTX export dependency ${message}`)
}

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
  return fail('XML malformed')
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (match, entity: string) => {
    if (entity === 'amp') return '&'
    if (entity === 'lt') return '<'
    if (entity === 'gt') return '>'
    if (entity === 'quot') return '"'
    if (entity === 'apos') return "'"
    if (entity.toLowerCase().startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
  })
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
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
      if (end < 0) return fail('XML malformed')
      cursor = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const end = xml.indexOf(']]>', start + 9)
      if (end < 0) return fail('XML malformed')
      cursor = end + 3
      continue
    }
    if (xml.startsWith('<?', start)) {
      const end = xml.indexOf('?>', start + 2)
      if (end < 0) return fail('XML malformed')
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
      if (!current || current.name !== name) return fail('XML malformed')
      current.end = end
      cursor = end
      continue
    }

    const selfClosing = /\/\s*$/.test(content)
    const opening = selfClosing ? content.replace(/\/\s*$/, '').trimEnd() : content
    const name = opening.split(/\s/, 1)[0]
    if (!name) return fail('XML malformed')
    const element: OpenElement = {
      name,
      localName: name.slice(name.lastIndexOf(':') + 1),
      attributes: parseAttributes(opening.slice(name.length)),
      start,
      end,
      openingEnd: end,
      children: [],
    }
    const parent = stack.at(-1)
    if (parent) parent.children.push(element)
    else roots.push(element)
    if (!selfClosing) stack.push(element)
    cursor = end
  }
  if (stack.length > 0) return fail('XML malformed')
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
  const separator = partPath.lastIndexOf('/')
  const directory = separator < 0 ? '' : partPath.slice(0, separator)
  const name = partPath.slice(separator + 1)
  return directory ? `${directory}/_rels/${name}.rels` : `_rels/${name}.rels`
}

function normalizePath(path: string): string {
  const result: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (result.length === 0) return fail(`target escapes package root: ${path}`)
      result.pop()
    } else result.push(segment)
  }
  return result.join('/')
}

function splitTarget(target: string): { path: string; fragment: string } {
  const separator = target.indexOf('#')
  return separator < 0
    ? { path: target, fragment: '' }
    : { path: target.slice(0, separator), fragment: target.slice(separator) }
}

function resolveTarget(ownerPath: string, target: string): { path: string; fragment: string } {
  const split = splitTarget(target)
  const directory = ownerPath.slice(0, ownerPath.lastIndexOf('/') + 1)
  const path = split.path.startsWith('/') ? split.path.slice(1) : `${directory}${split.path}`
  return { path: normalizePath(path), fragment: split.fragment }
}

function relativeTarget(ownerPath: string, targetPath: string): string {
  const ownerDirectory = ownerPath.slice(0, ownerPath.lastIndexOf('/') + 1).split('/').filter(Boolean)
  const targetSegments = targetPath.split('/').filter(Boolean)
  let common = 0
  while (common < ownerDirectory.length && common < targetSegments.length && ownerDirectory[common] === targetSegments[common]) common += 1
  const prefix = Array.from({ length: ownerDirectory.length - common }, () => '..')
  const suffix = targetSegments.slice(common)
  return [...prefix, ...suffix].join('/') || '.'
}

function relationshipNodes(xml: string, ownerPath: string): RelationshipNode[] {
  let roots: XmlElement[]
  try {
    roots = scanXml(xml)
  } catch (error) {
    return fail(`XML malformed for ${ownerPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return descendants(roots, 'Relationship').map((element) => {
    const id = element.attributes.Id
    const type = element.attributes.Type
    const target = element.attributes.Target
    if (!id || !type || !target) return fail(`relationship malformed for ${ownerPath}`)
    const targetMode = element.attributes.TargetMode
    return {
      id,
      type: relationshipType(type),
      target,
      ...(targetMode ? { targetMode } : {}),
      element,
    }
  })
}

function isExternalRelationship(relationship: RelationshipNode): boolean {
  if (relationship.targetMode?.toLowerCase() === 'external') return true
  return /^[a-z][a-z\d+.-]*:/iu.test(splitTarget(relationship.target).path)
}

export function isSharedDependency(relationshipTypeName: string, targetPath: string): boolean {
  if (sharedRelationshipTypes.has(relationshipTypeName)) return true
  if (sharedPartPaths.has(targetPath)) return true
  return /^(?:ppt\/(?:slideMasters|slideLayouts|theme|notesMasters|handoutMasters)\/)/u.test(targetPath)
}

function hasRelationshipPart(entries: ReadonlyMap<string, ZipEntry>, partPath: string): boolean {
  return entries.has(relationshipFilePath(partPath))
}

function validateTarget(entries: ReadonlyMap<string, ZipEntry>, ownerPath: string, relationship: RelationshipNode): { path: string; fragment: string } {
  const resolved = resolveTarget(ownerPath, relationship.target)
  if (!entries.has(resolved.path)) return fail(`target missing: ${ownerPath} -> ${resolved.path}`)
  return resolved
}

export function collectPartClosure(entries: ReadonlyMap<string, ZipEntry>, rootPath: string): Set<string> {
  const closure = new Set<string>()
  const visit = (partPath: string): void => {
    if (closure.has(partPath)) return
    if (!entries.has(partPath)) fail(`part missing: ${partPath}`)
    closure.add(partPath)
    const relationshipPath = relationshipFilePath(partPath)
    const relationshipEntry = entries.get(relationshipPath)
    if (!relationshipEntry) return
    closure.add(relationshipPath)
    const relationships = relationshipNodes(decoder.decode(relationshipEntry.data), relationshipPath)
    for (const relationship of relationships) {
      if (isExternalRelationship(relationship)) continue
      visit(validateTarget(entries, partPath, relationship).path)
    }
  }
  visit(rootPath)
  return closure
}

function partName(path: string): { directory: string; filename: string; stem: string; extension: string; number?: number } {
  const separator = path.lastIndexOf('/')
  const directory = separator < 0 ? '' : path.slice(0, separator)
  const filename = path.slice(separator + 1)
  const extensionStart = filename.lastIndexOf('.')
  const extension = extensionStart >= 0 ? filename.slice(extensionStart) : ''
  const withoutExtension = extensionStart >= 0 ? filename.slice(0, extensionStart) : filename
  const numeric = /^(.*?)(\d+)$/u.exec(withoutExtension)
  return {
    directory,
    filename,
    stem: numeric?.[1] ?? withoutExtension,
    extension,
    ...(numeric ? { number: Number(numeric[2]) } : {}),
  }
}

function candidatePath(sourcePath: string, index: number): string {
  const name = partName(sourcePath)
  const filename = name.number === undefined
    ? `${name.stem || 'part'}-copy${index}${name.extension}`
    : `${name.stem}${name.number + index}${name.extension}`
  return name.directory ? `${name.directory}/${filename}` : filename
}

function allocateClonePath(
  sourcePath: string,
  entries: ReadonlyMap<string, ZipEntry>,
  occupied: Set<string>,
): string {
  const sourceRelationshipPath = relationshipFilePath(sourcePath)
  const sourceHasRelationships = entries.has(sourceRelationshipPath)
  for (let index = 1; ; index += 1) {
    const path = candidatePath(sourcePath, index)
    const relationshipPath = relationshipFilePath(path)
    if (occupied.has(path) || entries.has(path)) continue
    if (sourceHasRelationships && (occupied.has(relationshipPath) || entries.has(relationshipPath))) continue
    occupied.add(path)
    if (sourceHasRelationships) occupied.add(relationshipPath)
    return path
  }
}

function relationshipTargetReplacement(xml: string, element: XmlElement, target: string): string {
  const opening = xml.slice(element.start, element.openingEnd)
  const pattern = /(\bTarget\s*=\s*)(["'])([\s\S]*?)\2/u
  if (!pattern.test(opening)) return fail('relationship target attribute missing')
  return opening.replace(pattern, (_match, prefix: string, quote: string) => `${prefix}${quote}${escapeXml(target)}${quote}`)
}

export function rewriteRelationshipTargets(xml: string, ownerPath: string, pathMap: ReadonlyMap<string, string>): string {
  const relationships = relationshipNodes(xml, ownerPath)
  const outputOwnerPath = pathMap.get(ownerPath) ?? ownerPath
  const replacements = relationships.flatMap((relationship) => {
    if (isExternalRelationship(relationship)) return []
    const resolved = resolveTarget(ownerPath, relationship.target)
    const mapped = pathMap.get(resolved.path)
    if (!mapped || mapped === resolved.path) return []
    const target = `${relativeTarget(outputOwnerPath, mapped)}${resolved.fragment}`
    return [{ start: relationship.element.start, end: relationship.element.openingEnd, value: relationshipTargetReplacement(xml, relationship.element, target) }]
  })
  let output = xml
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end)
  }
  return output
}

export function clonePartDependencies(
  entries: ReadonlyMap<string, ZipEntry>,
  sourcePath: string,
  outputPath: string,
  reservedPaths: ReadonlySet<string>,
): DependencyCloneResult {
  if (!entries.has(sourcePath)) fail(`part missing: ${sourcePath}`)
  if (entries.has(outputPath)) fail(`path collision: ${outputPath}`)
  const occupied = new Set(reservedPaths)
  occupied.add(outputPath)
  const pathMap = new Map<string, string>([[sourcePath, outputPath]])
  const rootRelationshipPath = relationshipFilePath(sourcePath)
  if (entries.has(rootRelationshipPath)) pathMap.set(rootRelationshipPath, relationshipFilePath(outputPath))
  const resultEntries: ZipEntry[] = []
  const visited = new Set<string>()

  const visit = (currentSourcePath: string, currentOutputPath: string): void => {
    if (visited.has(currentSourcePath)) return
    const sourceEntry = entries.get(currentSourcePath)
    if (!sourceEntry) fail(`part missing: ${currentSourcePath}`)
    visited.add(currentSourcePath)
    resultEntries.push({ name: currentOutputPath, data: new Uint8Array(sourceEntry.data) })

    const sourceRelationshipPath = relationshipFilePath(currentSourcePath)
    const relationshipEntry = entries.get(sourceRelationshipPath)
    if (!relationshipEntry) return
    const outputRelationshipPath = relationshipFilePath(currentOutputPath)
    const mappedRelationshipPath = pathMap.get(sourceRelationshipPath)
    if (entries.has(outputRelationshipPath) || (occupied.has(outputRelationshipPath) && mappedRelationshipPath !== outputRelationshipPath)) {
      fail(`path collision: ${outputRelationshipPath}`)
    }
    occupied.add(outputRelationshipPath)
    pathMap.set(sourceRelationshipPath, outputRelationshipPath)
    const relationshipXml = decoder.decode(relationshipEntry.data)
    resultEntries.push({ name: outputRelationshipPath, data: new Uint8Array() })
    const relationships = relationshipNodes(relationshipXml, sourceRelationshipPath)
    for (const relationship of relationships) {
      if (isExternalRelationship(relationship)) continue
      const resolved = validateTarget(entries, currentSourcePath, relationship)
      if (pathMap.has(resolved.path)) continue
      if (isSharedDependency(relationship.type, resolved.path)) {
        pathMap.set(resolved.path, resolved.path)
        continue
      }
      const dependencyOutputPath = allocateClonePath(resolved.path, entries, occupied)
      pathMap.set(resolved.path, dependencyOutputPath)
      const dependencyRelationshipPath = relationshipFilePath(resolved.path)
      if (entries.has(dependencyRelationshipPath)) pathMap.set(dependencyRelationshipPath, relationshipFilePath(dependencyOutputPath))
      visit(resolved.path, dependencyOutputPath)
    }
    const rewritten = rewriteRelationshipTargets(relationshipXml, currentSourcePath, pathMap)
    const relationshipIndex = resultEntries.findIndex((entry) => entry.name === outputRelationshipPath)
    if (relationshipIndex < 0) fail(`relationship part missing: ${outputRelationshipPath}`)
    resultEntries[relationshipIndex] = { name: outputRelationshipPath, data: encoder.encode(rewritten) }
  }

  visit(sourcePath, outputPath)
  return { rootPath: outputPath, pathMap, entries: resultEntries }
}
