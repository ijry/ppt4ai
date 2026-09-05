import type { Color, Fill } from '@ppt4ai/model'
import { serializeColorXml, serializeFillXml } from './standalone-xml.js'
import { tagEnd, type Replacement, type XmlElement } from './xml-range.js'

/**
 * The comparison and the patching a fill node needs, shared by the two writebacks that own one: the
 * slide's own shapes and a master or layout's placeholder defaults. It lives in its own module because
 * `writeback.ts` imports `master-layout-writeback.ts`, so the shared half cannot sit in either.
 */

export const fillNodeNames = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'])

/**
 * Every `EG_ColorChoice` element, `a:hslClr` included even though nothing here can read one: a colour is
 * found by name in order to be *replaced*, and a colour left beside the new one would break the choice.
 */
export const colorChoiceNames = new Set(['srgbClr', 'schemeClr', 'prstClr', 'sysClr', 'scrgbClr', 'hslClr'])

export function colorsEqual(left: Color | undefined, right: Color | undefined): boolean {
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

export function gradientsEqual(left: Fill['gradient'], right: Fill['gradient']): boolean {
  if (!left || !right) return left === right
  if (left.stops.length !== right.stops.length) return false
  if ((left.angle ?? 0) !== (right.angle ?? 0)) return false
  if ((left.scaled ?? false) !== (right.scaled ?? false)) return false
  return left.stops.every((stop, index) => {
    const other = right.stops[index]
    return other?.pos === stop.pos && colorsEqual(stop.color, other.color)
  })
}

/** Both absent counts as equal; otherwise the preset and both colours have to match. */
export function patternsEqual(left: Fill['pattern'], right: Fill['pattern']): boolean {
  if (!left || !right) return !left && !right
  return left.preset === right.preset
    && colorsEqual(left.foreground, right.foreground)
    && colorsEqual(left.background, right.background)
}

export function fillsEqual(left: Fill | undefined, right: Fill | undefined): boolean {
  return colorsEqual(left?.color, right?.color)
    && gradientsEqual(left?.gradient, right?.gradient)
    && patternsEqual(left?.pattern, right?.pattern)
}

export type FillKind = 'solid' | 'gradient' | 'pattern'

export function fillKind(fill: Fill): FillKind {
  if (fill.gradient) return 'gradient'
  if (fill.pattern) return 'pattern'
  return 'solid'
}

export function modelFillNodeName(fill: Fill): string {
  const kind = fillKind(fill)
  return kind === 'gradient' ? 'gradFill' : kind === 'pattern' ? 'pattFill' : 'solidFill'
}

export function namespacePrefix(name: string): string {
  const separator = name.lastIndexOf(':')
  return separator >= 0 ? name.slice(0, separator + 1) : ''
}

/** A serialized fragment moved to another prefix, for the nodes that do not carry the plain `a:`. */
export function reprefixed(value: string, prefix: string): string {
  if (prefix === 'a:') return value
  return value.replaceAll('<a:', `<${prefix}`).replaceAll('</a:', `</${prefix}`)
}

/** Replaces `child` with `value`, or appends it inside `parent` when the child is not there yet. */
export function childReplacement(xml: string, parent: XmlElement, child: XmlElement | undefined, value: string): Replacement {
  if (child) return { start: child.start, end: child.end, value }
  const openingEnd = tagEnd(xml, parent.start + 1)
  const opening = xml.slice(parent.start, openingEnd)
  if (opening.endsWith('/>')) {
    return { start: parent.start, end: openingEnd, value: `${opening.slice(0, -2)}>${value}</${parent.name}>` }
  }
  return { start: openingEnd, end: openingEnd, value }
}

/**
 * One attribute of an opening tag, patched in place. The whole tag is never rewritten, so the attributes
 * this project does not model stay exactly as the source wrote them. Written for `a:ln` and since reused
 * on `a:outerShdw` and `a:pattFill`, which is why the name says nothing about a line.
 */
export function attributeReplacements(xml: string, element: XmlElement, name: string, value: string | undefined): Replacement[] {
  const source = element.attributes[name]
  if (value === source || (value === undefined && source === undefined)) return []
  const openingEnd = xml.indexOf('>', element.start)
  if (openingEnd < 0) throw new Error('PPTX export source line malformed')
  const existing = new RegExp(`\\s+${name}\\s*=\\s*"[^"]*"`, 'u').exec(xml.slice(element.start, openingEnd))
  if (value === undefined) {
    if (!existing) return []
    const start = element.start + existing.index
    return [{ start, end: start + existing[0].length, value: '' }]
  }
  if (existing) {
    const start = element.start + existing.index
    return [{ start, end: start + existing[0].length, value: ` ${name}="${value}"` }]
  }
  const nameEnd = element.start + 1 + element.name.length
  return [{ start: nameEnd, end: nameEnd, value: ` ${name}="${value}"` }]
}

/**
 * One fill node, patched part by part. Each part compares on its own so that changing a gradient's stops
 * leaves its axis alone, and changing a pattern's foreground leaves its background alone.
 */
export function sameKindFillPatches(xml: string, fillNode: XmlElement, existing: Fill, fill: Fill): Replacement[] {
  const named = (name: string): XmlElement | undefined => fillNode.children.find((child) => child.localName === name)
  const colorChild = (): XmlElement | undefined => fillNode.children.find((child) => colorChoiceNames.has(child.localName))
  const kind = fillKind(fill)
  // A stroke's fill sits inside `a:ln`, and a placeholder's inside a part with its own prefix, so every
  // emitted fragment takes the node's own — the reason `serializeFillForLine` exists for the whole-node path.
  const prefix = namespacePrefix(fillNode.name) || 'a:'
  const reprefix = (value: string): string => reprefixed(value, prefix)

  if (kind === 'solid') {
    if (colorsEqual(existing.color, fill.color)) return []
    return [childReplacement(xml, fillNode, colorChild(), serializeColorXml(fill.color, prefix))]
  }

  if (kind === 'pattern') {
    const pattern = fill.pattern!
    const before = existing.pattern
    const replacements: Replacement[] = []
    if (before?.preset !== pattern.preset) {
      replacements.push(...attributeReplacements(xml, fillNode, 'prst', pattern.preset))
    }
    for (const [name, next, previous] of [
      ['fgClr', pattern.foreground, before?.foreground],
      ['bgClr', pattern.background, before?.background],
    ] as const) {
      if (colorsEqual(previous, next)) continue
      const slot = named(name)
      const value = `<${prefix}${name}>${serializeColorXml(next, prefix)}</${prefix}${name}>`
      replacements.push(childReplacement(xml, fillNode, slot, value))
    }
    return replacements
  }

  const gradient = fill.gradient!
  const before = existing.gradient
  const replacements: Replacement[] = []
  const stopsChanged = before === undefined
    || before.stops.length !== gradient.stops.length
    || !gradient.stops.every((stop, index) => before.stops[index]?.pos === stop.pos && colorsEqual(before.stops[index]?.color, stop.color))
  if (stopsChanged) {
    const serialized = serializeFillXml(fill)
    const list = serialized.slice(serialized.indexOf('<a:gsLst'), serialized.indexOf('</a:gsLst>') + 10)
    replacements.push(childReplacement(xml, fillNode, named('gsLst'), reprefix(list)))
  }
  // `a:lin` and `a:path` are a choice, so a change of form replaces whichever one is there.
  const wantsPath = gradient.path !== undefined
  const formChanged = (before?.path !== undefined) !== wantsPath
    || (!wantsPath && ((before?.angle ?? 0) !== (gradient.angle ?? 0) || (before?.scaled ?? false) !== (gradient.scaled ?? false)))
    || (wantsPath && before?.path !== gradient.path)
  if (formChanged) {
    const serialized = serializeFillXml(fill)
    const form = serialized.slice(
      wantsPath ? serialized.indexOf('<a:path') : serialized.indexOf('<a:lin'),
      serialized.lastIndexOf('</a:gradFill>'),
    )
    replacements.push(childReplacement(xml, fillNode, named('lin') ?? named('path'), reprefix(form)))
  }
  return replacements
}
