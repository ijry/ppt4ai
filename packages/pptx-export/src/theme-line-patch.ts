import type { DashSegment, StrokeStyle, ThemeLineStyle } from '@ppt4ai/model'
import { sourceFill } from './color-source.js'
import { fillNodeNames, fillNodeReplacements, fillsEqual, namespacePrefix, reprefixed, serializeFillPrefixed } from './fill-patch.js'
import { escapeXml } from './text-xml.js'
import { attributeReplacements, scanXml, tagEnd, type Replacement, type XmlElement } from './xml-range.js'

type LineProperties = Pick<ThemeLineStyle, 'width' | 'style' | 'cap' | 'join' | 'compound' | 'align' | 'miterLimit'>
const tokens = {
  cap: ['flat', 'rnd', 'sq'], join: ['round', 'bevel', 'miter'],
  compound: ['sng', 'dbl', 'thickThin', 'thinThick', 'tri'], align: ['ctr', 'in'],
} as const
const dashTokens = new Set<StrokeStyle>(['solid', 'dot', 'sysDot', 'dash', 'lgDash', 'sysDash', 'dashDot', 'lgDashDot', 'sysDashDot', 'lgDashDotDot', 'sysDashDotDot'])
const dashNames = new Set(['prstDash', 'custDash'])
const joinNames = new Set<string>(tokens.join)

function numberValue(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** A declared solid preset and an empty custom list serialize as the default, not as a new dash. */
function normalizedDash(style: LineProperties['style']): LineProperties['style'] {
  return style === 'solid' || (typeof style === 'object' && style.custom.length === 0) ? undefined : style
}

/** Validate before these properties reach tag names or unescaped numeric attributes. */
export function validateLineProperties(line: ThemeLineStyle, path: string): LineProperties {
  const fail = (field: string): never => { throw new Error('PPTX export theme line unsupported: ' + path + '.' + field) }
  if (line.width !== undefined && (!Number.isInteger(line.width) || line.width < 0)) fail('width')
  if (line.miterLimit !== undefined && (!Number.isFinite(line.miterLimit) || line.miterLimit <= 0)) fail('miterLimit')
  for (const key of ['cap', 'join', 'compound', 'align'] as const) {
    if (line[key] !== undefined && !(tokens[key] as readonly string[]).includes(line[key])) fail(key)
  }
  if (line.style !== undefined) {
    if (typeof line.style === 'string') {
      if (!dashTokens.has(line.style)) fail('style')
    } else {
      if (!line.style || typeof line.style !== 'object' || Array.isArray(line.style) || !Array.isArray(line.style.custom)) fail('style')
      for (const segment of line.style.custom) {
        if (!segment || !positiveInteger(segment.dash) || !positiveInteger(segment.space)) fail('style')
      }
    }
  }
  const style = normalizedDash(line.style)
  return {
    ...(line.width === undefined ? {} : { width: line.width }),
    ...(style === undefined ? {} : { style }),
    ...(line.cap === undefined ? {} : { cap: line.cap }),
    ...(line.join === undefined ? {} : { join: line.join }),
    ...(line.compound === undefined ? {} : { compound: line.compound }),
    ...(line.align === undefined ? {} : { align: line.align }),
    ...(line.miterLimit === undefined ? {} : { miterLimit: line.miterLimit }),
  }
}

/** Mirror parseThemeLineStyleEntries, including dropped bad values and the preset-before-custom rule. */
function sourceLineProperties(line: XmlElement): LineProperties {
  const result: LineProperties = {}
  const width = numberValue(line.attributes.w)
  if (width !== undefined && Number.isInteger(width) && width >= 0) result.width = width
  const cap = line.attributes.cap
  if ((tokens.cap as readonly string[]).includes(cap ?? '')) result.cap = cap as LineProperties['cap'] & string
  const compound = line.attributes.cmpd
  if ((tokens.compound as readonly string[]).includes(compound ?? '')) result.compound = compound as LineProperties['compound'] & string
  const align = line.attributes.algn
  if ((tokens.align as readonly string[]).includes(align ?? '')) result.align = align as LineProperties['align'] & string
  const join = line.children.find((child) => joinNames.has(child.localName))
  if (join) result.join = join.localName as NonNullable<LineProperties['join']>
  const limit = numberValue(line.children.find((child) => child.localName === 'miter')?.attributes.lim)
  if (limit !== undefined && limit > 0) result.miterLimit = limit
  const preset = line.children.find((child) => child.localName === 'prstDash')?.attributes.val
  if (preset && dashTokens.has(preset as StrokeStyle)) {
    if (preset !== 'solid') result.style = preset as StrokeStyle
  } else {
    const custom = line.children.find((child) => child.localName === 'custDash')
    const segments: DashSegment[] = []
    for (const child of custom?.children ?? []) {
      if (child.localName !== 'ds') continue
      const dash = numberValue(child.attributes.d)
      const space = numberValue(child.attributes.sp)
      if (positiveInteger(dash) && positiveInteger(space)) segments.push({ dash, space })
    }
    if (segments.length > 0) result.style = { custom: segments }
  }
  return result
}

/** Match parseDirectFill precedence, rather than mistaking a nested extension fill for the line fill. */
function lineFillNode(line: XmlElement): XmlElement | undefined {
  const named = (name: string) => line.children.find((child) => child.localName === name)
  const solid = named('solidFill')
  return (sourceFill(solid) ? solid : undefined) ?? named('gradFill') ?? named('pattFill')
    ?? line.children.find((child) => fillNodeNames.has(child.localName))
}

function dashesEqual(left: LineProperties['style'], right: LineProperties['style']): boolean {
  if (typeof left !== 'object' || typeof right !== 'object') return left === right
  return left.custom.length === right.custom.length
    && left.custom.every((segment, index) => segment.dash === right.custom[index]?.dash && segment.space === right.custom[index]?.space)
}

/** Only a full-node replacement needs to carry a binding declared on that node itself. */
function keepNamespace(node: XmlElement, replacement: Replacement): Replacement {
  if (replacement.start !== node.start || replacement.end !== node.end || replacement.value === '') return replacement
  const prefix = namespacePrefix(node.name)
  const declaration = prefix ? 'xmlns:' + prefix.slice(0, -1) : 'xmlns'
  const namespace = node.attributes[declaration]
  if (namespace === undefined || scanXml(replacement.value)[0]?.attributes[declaration] !== undefined) return replacement
  return { ...replacement, value: replacement.value.replace(/^<[^\s/>]+/u, (opening) => opening + ' ' + declaration + '="' + escapeXml(namespace) + '"') }
}

function childRank(node: XmlElement): number {
  return fillNodeNames.has(node.localName) ? 0 : dashNames.has(node.localName) ? 1 : joinNames.has(node.localName) ? 2 : 3
}

/** Coalesce same-offset insertions and apply span replacements before insertions at the same start. */
function orderedPatches(patches: Replacement[]): Replacement[] {
  const insertions = new Map<number, Replacement>()
  const result = patches.filter((patch) => {
    if (patch.start !== patch.end) return true
    const prior = insertions.get(patch.start)
    if (prior) { prior.value += patch.value; return false }
    insertions.set(patch.start, patch)
    return true
  })
  return result.sort((left, right) => right.start - left.start || right.end - left.end)
}

/**
 * One existing lnStyleLst slot. Compare only modeled values before touching XML, so an explicit
 * prstDash solid, padded numbers, unknown attributes and unedited child nodes retain their bytes.
 * Unlike whole-line serialization this never replaces arrows/extensions or shifts a later slot.
 */
export function themeLineReplacements(xml: string, line: XmlElement, next: ThemeLineStyle | null): Replacement[] {
  const fillNode = lineFillNode(line)
  const existingFill = sourceFill(fillNode)
  if (next === null && !existingFill) return []
  const previous = sourceLineProperties(line)
  const patches: Replacement[] = []
  const missing: Array<{ rank: number; value: string }> = []
  const replaceChild = (node: XmlElement | undefined, rank: number, value: string): void => {
    if (node) patches.push(keepNamespace(node, { start: node.start, end: node.end, value }))
    else if (value) missing.push({ rank, value })
  }
  const prefix = namespacePrefix(line.name)

  for (const [key, attribute] of [['width', 'w'], ['cap', 'cap'], ['compound', 'cmpd'], ['align', 'algn']] as const) {
    if (previous[key] !== next?.[key]) patches.push(...attributeReplacements(xml, line, attribute, next?.[key] === undefined ? undefined : String(next[key])))
  }

  if (!fillsEqual(existingFill, next ?? undefined)) {
    if (next === null) replaceChild(fillNode, 0, '<' + (fillNode ? namespacePrefix(fillNode.name) : prefix) + 'noFill/>')
    else if (existingFill && fillNode) patches.push(...fillNodeReplacements(xml, fillNode, existingFill, next).map((patch) => keepNamespace(fillNode, patch)))
    else replaceChild(fillNode, 0, serializeFillPrefixed(next, fillNode ? namespacePrefix(fillNode.name) : prefix))
  }

  const dashNodes = line.children.filter((child) => dashNames.has(child.localName))
  const wantedDash = normalizedDash(next?.style)
  if (next === null || !dashesEqual(previous.style, wantedDash)) {
    const name = typeof wantedDash === 'object' ? 'custDash' : 'prstDash'
    const node = dashNodes.find((child) => child.localName === name) ?? dashNodes[0]
    if (typeof wantedDash === 'string' && node?.localName === 'prstDash') patches.push(...attributeReplacements(xml, node, 'val', wantedDash))
    else {
      const value = wantedDash === undefined ? '' : typeof wantedDash === 'string'
        ? '<a:prstDash val="' + wantedDash + '"/>'
        : '<a:custDash>' + wantedDash.custom.map((segment) => '<a:ds d="' + segment.dash + '" sp="' + segment.space + '"/>').join('') + '</a:custDash>'
      replaceChild(node, 1, reprefixed(value, node ? namespacePrefix(node.name) : prefix))
    }
    for (const extra of dashNodes) if (extra !== node) replaceChild(extra, 1, '')
  }

  const joinNodes = line.children.filter((child) => joinNames.has(child.localName))
  const wantedJoin = next?.join
  const previousLimit = previous.join === 'miter' ? previous.miterLimit : undefined
  const wantedLimit = wantedJoin === 'miter' ? next?.miterLimit : undefined
  if (next === null || previous.join !== wantedJoin || previousLimit !== wantedLimit) {
    const node = joinNodes[0]
    if (node && node.localName === wantedJoin && wantedJoin === 'miter') patches.push(...attributeReplacements(xml, node, 'lim', wantedLimit === undefined ? undefined : String(wantedLimit)))
    else {
      const value = wantedJoin === undefined ? '' : '<a:' + wantedJoin + (wantedLimit === undefined ? '' : ' lim="' + wantedLimit + '"') + '/>'
      replaceChild(node, 2, reprefixed(value, node ? namespacePrefix(node.name) : prefix))
    }
    for (const extra of joinNodes.slice(1)) replaceChild(extra, 2, '')
  }

  if (missing.length > 0) {
    const openingEnd = tagEnd(xml, line.start + 1)
    const opening = xml.slice(line.start, openingEnd)
    const selfClosing = /\/\s*>$/u.exec(opening)
    if (selfClosing) patches.push({ start: line.start + selfClosing.index, end: openingEnd, value: '>' + missing.map((child) => child.value).join('') + '</' + line.name + '>' })
    else for (const child of missing) {
      const position = line.children.find((node) => childRank(node) > child.rank)?.start ?? xml.lastIndexOf('</', line.end - 1)
      patches.push({ start: position, end: position, value: child.value })
    }
  }
  return orderedPatches(patches)
}
