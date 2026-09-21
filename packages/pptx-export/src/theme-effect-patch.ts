import type { OuterShadow } from '@ppt4ai/model'
import { colorChoiceNames, colorsEqual, sourceColorNode, sourceOuterShadow } from './color-source.js'
import { namespacePrefix, reprefixed } from './fill-patch.js'
import { serializeShadowXml } from './standalone-xml.js'
import { escapeXml, serializeColorXml } from './text-xml.js'
import { attributeReplacements, tagEnd, type Replacement, type XmlElement } from './xml-range.js'

const afterOuterShadow = new Set(['prstShdw', 'reflection', 'softEdge', 'extLst'])
const styleTail = new Set(['scene3d', 'sp3d', 'extLst'])

/** Expanding only the closing slash lets attributes and content be edited without overlapping ranges. */
function insertContent(xml: string, parent: XmlElement, value: string, before?: number): Replacement {
  const openingEnd = tagEnd(xml, parent.start + 1)
  const selfClosing = /\/\s*>$/u.exec(xml.slice(parent.start, openingEnd))
  if (selfClosing) return { start: parent.start + selfClosing.index, end: openingEnd, value: '>' + value + '</' + parent.name + '>' }
  const start = before ?? xml.lastIndexOf('</', parent.end - 1)
  return { start, end: start, value }
}

function serializedOuter(shadow: OuterShadow, prefix: string): string {
  const serialized = serializeShadowXml(shadow)
  return reprefixed(serialized.slice(serialized.indexOf('<a:outerShdw'), serialized.lastIndexOf('</a:effectLst>')), prefix)
}

/** A color replacement still needs a namespace binding declared on the original color itself. */
function colorReplacement(node: XmlElement, shadow: OuterShadow): Replacement {
  const prefix = namespacePrefix(node.name)
  const declaration = prefix ? 'xmlns:' + prefix.slice(0, -1) : 'xmlns'
  const namespace = node.attributes[declaration]
  let value = serializeColorXml(shadow.color, prefix)
  if (namespace !== undefined) value = value.replace(/^<[^\s/>]+/u, (opening) => opening + ' ' + declaration + '="' + escapeXml(namespace) + '"')
  return { start: node.start, end: node.end, value }
}

/** Attribute insertions can share the closing-slash offset of a bare outerShdw tag. */
function orderedPatches(patches: Replacement[]): Replacement[] {
  const insertions = new Map<number, Replacement>()
  const combined = patches.filter((patch) => {
    if (patch.start !== patch.end) return true
    const prior = insertions.get(patch.start)
    if (prior) { prior.value += patch.value; return false }
    insertions.set(patch.start, patch)
    return true
  })
  return combined.sort((left, right) => right.start - left.start || right.end - left.end)
}

/**
 * Only effectLst/outerShdw is modeled. Keep the list, its other effects and the style's 3D settings;
 * never convert an effectDag or interpret an imported null as a request to delete unknown content.
 */
export function themeEffectReplacements(xml: string, style: XmlElement, next: OuterShadow | null): Replacement[] {
  if (style.children.some((child) => child.localName === 'effectDag')) return []
  const effects = style.children.find((child) => child.localName === 'effectLst')
  const outer = effects?.children.find((child) => child.localName === 'outerShdw')
  const existing = sourceOuterShadow(effects)
  if (next === null) return existing && outer ? [{ start: outer.start, end: outer.end, value: '' }] : []

  if (outer) {
    const patches: Replacement[] = []
    for (const [key, attribute] of [['blurRadius', 'blurRad'], ['distance', 'dist'], ['direction', 'dir']] as const) {
      // An explicit replacement for an unreadable shadow owns these fields, even if the old color
      // prevented the mirror from reading them. For a readable shadow, preserve unchanged spellings.
      if (!existing || existing[key] !== next[key]) {
        patches.push(...attributeReplacements(xml, outer, attribute, next[key] === undefined ? undefined : String(next[key])))
      }
    }
    if (!colorsEqual(existing?.color, next.color)) {
      const color = sourceColorNode(outer)?.node ?? outer.children.find((child) => colorChoiceNames.has(child.localName))
      if (color) patches.push(colorReplacement(color, next))
      else patches.push(insertContent(xml, outer, serializeColorXml(next.color, namespacePrefix(outer.name)), outer.children[0]?.start))
    }
    return orderedPatches(patches)
  }

  if (effects) {
    const successor = effects.children.find((child) => afterOuterShadow.has(child.localName))
    return [insertContent(xml, effects, serializedOuter(next, namespacePrefix(effects.name)), successor?.start)]
  }
  const prefix = namespacePrefix(style.name)
  const successor = style.children.find((child) => styleTail.has(child.localName))
  return [insertContent(xml, style, reprefixed(serializeShadowXml(next), prefix), successor?.start)]
}
