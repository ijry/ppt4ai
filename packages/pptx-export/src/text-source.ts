import type { TextAutofit, TextBody, TextBodyProperties, TextBullet, TextMarks, TextParagraphAttrs, TextRun } from '@ppt4ai/model'
import { decodeXml, descendants, type XmlElement } from './xml-range.js'
import { sourceColor } from './color-source.js'

function firstDescendant(element: XmlElement, localName: string): XmlElement | undefined {
  return descendants(element.children, localName)[0]
}

function xmlTextContent(element: XmlElement): string {
  return decodeXml(element.text) + element.children.map((child) => xmlTextContent(child)).join('')
}

function directChildOf(element: XmlElement, localName: string): XmlElement | undefined {
  return element.children.find((child) => child.localName === localName)
}

function integerAttribute(element: XmlElement, name: string): number | undefined {
  const raw = element.attributes[name]
  if (raw === undefined || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) && Number.isInteger(value) ? value : undefined
}

function numberAttribute(element: XmlElement, name: string): number | undefined {
  const raw = element.attributes[name]
  if (raw === undefined || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function booleanAttributeValue(value: string | undefined): boolean | undefined {
  return value === '1' || value === 'true' ? true : value === '0' || value === 'false' ? false : undefined
}

/**
 * These readers mirror the importer's `parseRunMarks`, `parseParagraphAttrs`, `parseBodyProperties`
 * and `parseTextBody`. They are duplicated rather than shared because the two XML representations
 * differ by design: range writeback needs byte offsets on every element, which the importer's nodes
 * do not carry.
 */
function sourceRunMarks(runProperties: XmlElement | undefined): TextMarks | undefined {
  if (!runProperties) return undefined
  const marks: TextMarks = {}
  const typeface = directChildOf(runProperties, 'latin')?.attributes.typeface?.trim()
  if (typeface) marks.fontFamily = typeface
  const eastAsian = directChildOf(runProperties, 'ea')?.attributes.typeface?.trim()
  if (eastAsian) marks.fontFamilyEa = eastAsian
  const complex = directChildOf(runProperties, 'cs')?.attributes.typeface?.trim()
  if (complex) marks.fontFamilyCs = complex
  const size = numberAttribute(runProperties, 'sz')
  if (size !== undefined && size > 0) marks.fontSize = size / 100
  const bold = booleanAttributeValue(runProperties.attributes.b)
  if (bold !== undefined) marks.bold = bold
  const italic = booleanAttributeValue(runProperties.attributes.i)
  if (italic !== undefined) marks.italic = italic
  const underline = runProperties.attributes.u
  if (underline === 'none') marks.underline = 'none'
  else if (underline !== undefined && underline !== '') marks.underline = 'single'
  const color = sourceColor(directChildOf(runProperties, 'solidFill'))
  if (color) marks.color = { color }
  const baseline = numberAttribute(runProperties, 'baseline')
  if (baseline !== undefined) marks.baseline = baseline
  return Object.keys(marks).length > 0 ? marks : undefined
}

function sourceBullet(paragraphProperties: XmlElement): TextBullet | undefined {
  const character = directChildOf(paragraphProperties, 'buChar')
  if (character) {
    const value = character.attributes.char
    if (!value || [...value].length !== 1) return undefined
    const typeface = directChildOf(character, 'rPr')?.attributes.typeface
    return typeface ? { type: 'char', char: value, fontFamily: typeface } : { type: 'char', char: value }
  }
  const autoNumber = directChildOf(paragraphProperties, 'buAutoNum')
  if (!autoNumber) return undefined
  const type = autoNumber.attributes.type
  const scheme = type === 'alphaLcPeriod' || type === 'alphaLcParenRight'
    ? 'alphaLower'
    : type === 'alphaUcPeriod' || type === 'alphaUcParenRight'
      ? 'alphaUpper'
      : 'arabic'
  const startAt = integerAttribute(autoNumber, 'startAt')
  if (autoNumber.attributes.startAt !== undefined && (startAt === undefined || startAt <= 0)) return undefined
  return startAt === undefined ? { type: 'autoNum', scheme } : { type: 'autoNum', scheme, startAt }
}

function sourceSpacingPercentage(node: XmlElement | undefined): number | undefined {
  const percentage = node && directChildOf(node, 'spcPct')
  const value = percentage && numberAttribute(percentage, 'val')
  return value !== undefined && value > 0 ? value : undefined
}

function sourceSpacingEmu(node: XmlElement | undefined): number | undefined {
  const points = node && directChildOf(node, 'spcPts')
  const value = points && numberAttribute(points, 'val')
  return value !== undefined && value >= 0 ? value * 127 : undefined
}

function sourceParagraphAttrs(paragraphProperties: XmlElement | undefined): TextParagraphAttrs | undefined {
  if (!paragraphProperties) return undefined
  const attrs: TextParagraphAttrs = {}
  const alignment = paragraphProperties.attributes.algn
  if (alignment === 'l') attrs.align = 'left'
  else if (alignment === 'ctr') attrs.align = 'center'
  else if (alignment === 'r') attrs.align = 'right'
  const level = integerAttribute(paragraphProperties, 'lvl')
  if (level !== undefined && level >= 0) attrs.level = level
  const marginLeft = numberAttribute(paragraphProperties, 'marL')
  if (marginLeft !== undefined && marginLeft >= 0) attrs.marginLeft = marginLeft
  const indent = numberAttribute(paragraphProperties, 'indent')
  if (indent !== undefined) attrs.indent = indent
  const lineSpacing = sourceSpacingPercentage(directChildOf(paragraphProperties, 'lnSpc'))
  if (lineSpacing !== undefined) attrs.lineSpacing = lineSpacing
  const spaceBefore = sourceSpacingEmu(directChildOf(paragraphProperties, 'spcBef'))
  if (spaceBefore !== undefined) attrs.spaceBefore = spaceBefore
  const spaceAfter = sourceSpacingEmu(directChildOf(paragraphProperties, 'spcAft'))
  if (spaceAfter !== undefined) attrs.spaceAfter = spaceAfter
  const bullet = sourceBullet(paragraphProperties)
  if (bullet) attrs.bullet = bullet
  return Object.keys(attrs).length > 0 ? attrs : undefined
}

/** `lnSpcReduction` is not read: ECMA-376 gives `spAutoFit` no attributes at all. */
function sourceAutofit(bodyProperties: XmlElement): TextAutofit | undefined {
  if (directChildOf(bodyProperties, 'noAutofit')) return { type: 'none' }
  const normal = directChildOf(bodyProperties, 'normAutofit')
  if (normal) {
    const scale = integerAttribute(normal, 'fontScale')
    return scale !== undefined && scale >= 1 && scale <= 100000 ? { type: 'shrink', minFontScale: scale } : { type: 'shrink' }
  }
  return directChildOf(bodyProperties, 'spAutoFit') ? { type: 'resize' } : undefined
}

function sourceBodyProperties(bodyProperties: XmlElement | undefined): TextBodyProperties | undefined {
  if (!bodyProperties) return undefined
  const properties: TextBodyProperties = {}
  const insets = (['lIns', 'tIns', 'rIns', 'bIns'] as const).map((name) => numberAttribute(bodyProperties, name))
  const [left, top, right, bottom] = insets
  if (left !== undefined && top !== undefined && right !== undefined && bottom !== undefined && insets.every((value) => value! >= 0)) {
    properties.insets = { left, top, right, bottom }
  }
  const anchor = bodyProperties.attributes.anchor
  if (anchor === 't') properties.verticalAlign = 'top'
  else if (anchor === 'ctr') properties.verticalAlign = 'middle'
  else if (anchor === 'b') properties.verticalAlign = 'bottom'
  const vertical = bodyProperties.attributes.vert
  if (vertical === 'vert270' || vertical === 'vert' || vertical === 'wordArtVert') properties.vertical = 'vertical'
  else if (vertical === 'horz') properties.vertical = 'horizontal'
  const wrap = bodyProperties.attributes.wrap
  if (wrap === 'square' || wrap === 'none') properties.wrap = wrap
  const autofit = sourceAutofit(bodyProperties)
  if (autofit) properties.autofit = autofit
  return Object.keys(properties).length > 0 ? properties : undefined
}

/** `a:br` is read in position, matching the importer and `serializeTextBodyXml`'s split on `\n`. */
function sourceParagraphRuns(paragraph: XmlElement): TextRun[] {
  const runs: TextRun[] = []
  for (const node of paragraph.children) {
    if (node.localName === 'br') {
      const previous = runs[runs.length - 1]
      if (previous) previous.text += '\n'
      else runs.push({ text: '\n' })
      continue
    }
    if (node.localName !== 'r') continue
    const textNode = directChildOf(node, 't')
    if (!textNode) continue
    const text = xmlTextContent(textNode)
    if (!text) continue
    const marks = sourceRunMarks(directChildOf(node, 'rPr'))
    runs.push(marks ? { text, marks } : { text })
  }
  return runs
}

export function sourceTextBody(element: XmlElement): TextBody | undefined {
  const body = firstDescendant(element, 'txBody')
  if (!body) return undefined
  const bodyPr = sourceBodyProperties(directChildOf(body, 'bodyPr'))
  const paragraphs = body.children
    .filter((child) => child.localName === 'p')
    .map((paragraph) => {
      const runs = sourceParagraphRuns(paragraph)
      const attrs = sourceParagraphAttrs(directChildOf(paragraph, 'pPr'))
      return attrs ? { runs, attrs } : { runs }
    })
  if (paragraphs.length === 0) return undefined
  return bodyPr ? { bodyPr, paragraphs } : { paragraphs }
}
