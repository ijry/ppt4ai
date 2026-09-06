import type { Color, Fill } from '@ppt4ai/model'
import { colorChoiceNames, colorsEqual } from './color-source.js'
import { serializeColorXml, serializeFillXml } from './standalone-xml.js'
import { attributeReplacements, tagEnd, type Replacement, type XmlElement } from './xml-range.js'

/**
 * The comparison and the patching a fill node needs, shared by the two writebacks that own one: the
 * slide's own shapes and a master or layout's placeholder defaults. It lives in its own module because
 * `writeback.ts` imports `master-layout-writeback.ts`, so the shared half cannot sit in either.
 */

export const fillNodeNames = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'])

export function gradientsEqual(left: Fill['gradient'], right: Fill['gradient']): boolean {
  if (!left || !right) return left === right
  if (left.stops.length !== right.stops.length) return false
  if ((left.angle ?? 0) !== (right.angle ?? 0)) return false
  if ((left.scaled ?? false) !== (right.scaled ?? false)) return false
  // The radial form is part of the comparison now that the mirror reads it; without these two an edit
  // from one path word to another, or to the rect it converges to, would be swallowed as "unchanged".
  if (left.path !== right.path) return false
  if (!fillToRectsEqual(left.fillToRect, right.fillToRect)) return false
  return left.stops.every((stop, index) => {
    const other = right.stops[index]
    return other?.pos === stop.pos && colorsEqual(stop.color, other.color)
  })
}

/** Each inset absent and zero are the same thing, the way `a:fillToRect` omits the sides it does not move. */
function fillToRectsEqual(left: NonNullable<Fill['gradient']>['fillToRect'], right: NonNullable<Fill['gradient']>['fillToRect']): boolean {
  return (['left', 'top', 'right', 'bottom'] as const).every((side) => (left?.[side] ?? 0) === (right?.[side] ?? 0))
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

/** A whole fill node at the prefix its surroundings use, for the paths that replace the node outright. */
export function serializeFillPrefixed(fill: Fill, prefix: string): string {
  return reprefixed(serializeFillXml(fill), prefix)
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
 * The replacements one fill node needs in order to state `fill`: patched part by part when the node is
 * already that kind of fill, swapped whole when it is not — `EG_FillProperties` is a choice, so a change
 * of kind has no correspondence to preserve.
 *
 * `existing` is what the mirror could read out of the node. Being unable to read it (an `a:hslClr`, a
 * `gradFill` with a single stop) makes every part count as changed; it is not a reason to take the node
 * and its unmodeled attributes down with it.
 */
export function fillNodeReplacements(xml: string, fillNode: XmlElement, existing: Fill | undefined, fill: Fill): Replacement[] {
  if (fillNode.localName === modelFillNodeName(fill)) return sameKindFillPatches(xml, fillNode, existing, fill)
  return [{ start: fillNode.start, end: fillNode.end, value: serializeFillPrefixed(fill, namespacePrefix(fillNode.name)) }]
}

/**
 * One fill node, patched part by part. Each part compares on its own so that changing a gradient's stops
 * leaves its axis alone, and changing a pattern's foreground leaves its background alone.
 */
export function sameKindFillPatches(xml: string, fillNode: XmlElement, existing: Fill | undefined, fill: Fill): Replacement[] {
  const named = (name: string): XmlElement | undefined => fillNode.children.find((child) => child.localName === name)
  const colorChild = (): XmlElement | undefined => fillNode.children.find((child) => colorChoiceNames.has(child.localName))
  const kind = fillKind(fill)
  // A stroke's fill sits inside `a:ln`, and a placeholder's inside a part that may carry another prefix,
  // so every emitted fragment takes the node's own — the reason `serializeFillForLine` exists too.
  const prefix = namespacePrefix(fillNode.name) || 'a:'
  const reprefix = (value: string): string => reprefixed(value, prefix)

  if (kind === 'solid') {
    if (colorsEqual(existing?.color, fill.color)) return []
    return [childReplacement(xml, fillNode, colorChild(), serializeColorXml(fill.color, prefix))]
  }

  if (kind === 'pattern') {
    const pattern = fill.pattern!
    const before = existing?.pattern
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
  const before = existing?.gradient
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
    || (wantsPath && (before?.path !== gradient.path || !fillToRectsEqual(before?.fillToRect, gradient.fillToRect)))
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
