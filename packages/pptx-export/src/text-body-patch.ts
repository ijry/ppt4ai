import type { TextBody } from '@ppt4ai/model'
import { namespacePrefix, reprefixed } from './fill-patch.js'
import { escapeXml, serializeTextBodyXml } from './text-xml.js'
import { attributeReplacements, scanXml, tagEnd, type Replacement, type XmlElement } from './xml-range.js'

const autofitNames = new Set(['noAutofit', 'normAutofit', 'spAutoFit'])
const afterAutofitNames = new Set(['scene3d', 'sp3d', 'flatTx', 'extLst'])

function fragment(xml: string, element: XmlElement | undefined): string {
  return element ? xml.slice(element.start, element.end) : ''
}

/** A replaced node may be the only scope declaring its own prefix (or default namespace). */
function prefixedFragment(value: string, prefix: string, scope?: XmlElement): string {
  const qualified = reprefixed(value, prefix)
  if (!qualified) return qualified
  const declaration = prefix ? 'xmlns:' + prefix.slice(0, -1) : 'xmlns'
  const namespace = scope?.attributes[declaration]
  if (namespace === undefined) return qualified
  return qualified.replace(/^<[^\s/>]+/u, (opening) => opening + ' ' + declaration + '="' + escapeXml(namespace) + '"')
}

/** Compare the serializer's view, not the raw XML: vert270 and vert share one model value. */
function serializedBody(body: TextBody) {
  const xml = serializeTextBodyXml(body)
  const root = scanXml(xml)[0]!
  return {
    xml,
    properties: root.children.find((child) => child.localName === 'bodyPr')!,
    paragraphs: root.children.filter((child) => child.localName === 'p'),
  }
}

type SerializedBody = ReturnType<typeof serializedBody>

function closingStart(xml: string, element: XmlElement): number {
  return xml.lastIndexOf('</', element.end - 1)
}

/** Expand only the closing slash, leaving attribute values outside the replaced range. */
function insertContent(xml: string, parent: XmlElement, value: string, before?: number): Replacement {
  const openingEnd = tagEnd(xml, parent.start + 1)
  const opening = xml.slice(parent.start, openingEnd)
  const selfClosing = /\/\s*>$/u.exec(opening)
  if (selfClosing) {
    return { start: parent.start + selfClosing.index, end: openingEnd, value: '>' + value + '</' + parent.name + '>' }
  }
  const start = before ?? closingStart(xml, parent)
  return { start, end: start, value }
}

function changedAttributes(xml: string, source: XmlElement, previous: XmlElement | undefined, next: XmlElement): Replacement[] {
  const names = new Set([...Object.keys(previous?.attributes ?? {}), ...Object.keys(next.attributes)])
  return [...names].flatMap((name) => previous?.attributes[name] === next.attributes[name]
    ? []
    : attributeReplacements(xml, source, name, next.attributes[name]))
}

function propertiesReplacements(xml: string, source: XmlElement, previous: SerializedBody, next: SerializedBody): Replacement[] {
  const replacements = changedAttributes(xml, source, previous.properties, next.properties)
  const before = previous.properties.children.find((child) => autofitNames.has(child.localName))
  const after = next.properties.children.find((child) => autofitNames.has(child.localName))
  if (fragment(previous.xml, before) === fragment(next.xml, after)) return replacements

  const choices = source.children.filter((child) => autofitNames.has(child.localName))
  const choice = choices[0]
  if (choice && after && before?.localName === after.localName && choice.localName === after.localName) {
    // A shrink-scale edit owns fontScale, not lnSpcReduction or any extension attributes.
    replacements.push(...changedAttributes(xml, choice, before, after))
  } else if (choice) {
    const value = prefixedFragment(fragment(next.xml, after), namespacePrefix(choice.name), choice)
    replacements.push({ start: choice.start, end: choice.end, value })
    for (const extra of choices.slice(1)) replacements.push({ start: extra.start, end: extra.end, value: '' })
  } else if (after) {
    // CT_TextBodyProperties: prstTxWarp, autofit choice, scene3d, sp3d/flatTx, extLst.
    const beforeSibling = source.children.find((child) => afterAutofitNames.has(child.localName))
    replacements.push(insertContent(xml, source, reprefixed(fragment(next.xml, after), namespacePrefix(source.name)), beforeSibling?.start))
  }
  return replacements
}

/** Multiple new attributes (or bodyPr plus the first paragraph) can share an insertion offset. */
function combineInsertions(replacements: Replacement[]): Replacement[] {
  const insertions = new Map<number, Replacement>()
  const combined = replacements.filter((replacement) => {
    if (replacement.start !== replacement.end) return true
    const prior = insertions.get(replacement.start)
    if (!prior) {
      insertions.set(replacement.start, replacement)
      return true
    }
    prior.value += replacement.value
    return false
  })
  // In <a:bodyPr/>, a new attribute starts exactly where expanding '/>' does. Replace the old span
  // before inserting at that offset; replaceRanges' stable start-offset sort retains this tie order.
  return combined.sort((left, right) => right.start - left.start || right.end - left.end)
}

/**
 * Patch a source-backed txBody one modeled part at a time, shared by slide shapes and placeholder
 * defaults. The source owns its wrapper, list style and unknown children. A bodyPr edit owns only the
 * changed attributes or autofit choice; a changed paragraph is serialized, but unedited paragraphs
 * keep their bytes (including fields and links we do not model). No run-level correspondence is guessed.
 */
export function textBodyReplacements(
  xml: string,
  source: XmlElement,
  existing: TextBody | undefined,
  body: TextBody,
  fallbackDrawingPrefix = 'a:',
): Replacement[] {
  const next = serializedBody(body)
  const previous = serializedBody(existing ?? { paragraphs: [] })
  if (existing && previous.xml === next.xml) return []

  const sourceProperties = source.children.find((child) => child.localName === 'bodyPr')
  const sourceParagraphs = source.children.filter((child) => child.localName === 'p')
  const drawing = sourceProperties ?? sourceParagraphs[0] ?? source.children.find((child) => child.localName === 'lstStyle')
  const prefix = drawing ? namespacePrefix(drawing.name) : fallbackDrawingPrefix
  const openingEnd = tagEnd(xml, source.start + 1)
  if (/\/\s*>$/u.test(xml.slice(source.start, openingEnd))) {
    const content = next.xml.slice(next.xml.indexOf('>') + 1, next.xml.lastIndexOf('</'))
    return [insertContent(xml, source, reprefixed(content, prefix))]
  }

  const replacements = sourceProperties
    ? propertiesReplacements(xml, sourceProperties, previous, next)
    : [insertContent(xml, source, prefixedFragment(fragment(next.xml, next.properties), prefix, drawing), openingEnd)]

  for (const [index, paragraph] of sourceParagraphs.entries()) {
    const desired = next.paragraphs[index]
    const value = fragment(next.xml, desired)
    if (desired && existing && fragment(previous.xml, previous.paragraphs[index]) === value) continue
    replacements.push({ start: paragraph.start, end: paragraph.end, value: prefixedFragment(value, namespacePrefix(paragraph.name), paragraph) })
  }
  if (next.paragraphs.length > sourceParagraphs.length) {
    const lastParagraph = sourceParagraphs.at(-1)
    const paragraphPrefix = lastParagraph ? namespacePrefix(lastParagraph.name) : prefix
    const added = next.paragraphs.slice(sourceParagraphs.length).map((paragraph) => prefixedFragment(fragment(next.xml, paragraph), paragraphPrefix, lastParagraph ?? drawing)).join('')
    const lastHeader = source.children.filter((child) => child.localName === 'bodyPr' || child.localName === 'lstStyle').at(-1)
    replacements.push(insertContent(xml, source, added, lastParagraph?.end ?? lastHeader?.end ?? openingEnd))
  }
  return combineInsertions(replacements)
}
