import type { ImageCrop, ImageEffect, ImageElement, Rect } from '@ppt4ai/model'
import { replaceRanges, scanXml, tagEnd, type Replacement, type XmlElement } from './xml-range.js'

const cropAttributes = ['l', 't', 'r', 'b'] as const
const supportedMasks = new Set(['rect', 'roundRect', 'ellipse', 'triangle'])

function failure(element: ImageElement, detail: string): Error {
  return new Error(`PPTX export image appearance ${detail}: ${element.id}`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function namespacePrefix(name: string): string {
  const separator = name.lastIndexOf(':')
  return separator >= 0 ? name.slice(0, separator + 1) : ''
}

function directChild(element: XmlElement, localName: string): XmlElement | undefined {
  return element.children.find((child) => child.localName === localName)
}

function openingEnd(source: string, element: XmlElement): number {
  return tagEnd(source, element.start + 1)
}

function openingXml(source: string, element: XmlElement): string {
  return source.slice(element.start, openingEnd(source, element))
}

function isSelfClosing(source: string, element: XmlElement): boolean {
  return /\/\s*>$/u.test(openingXml(source, element))
}

function closingStart(source: string, element: XmlElement, image: ImageElement): number {
  const start = openingEnd(source, element)
  let candidate = source.lastIndexOf('</', element.end - 1)
  while (candidate >= start) {
    const name = source.slice(candidate + 2, element.end - 1).trim()
    if (name === element.name) return candidate
    candidate = source.lastIndexOf('</', candidate - 1)
  }
  throw failure(image, 'source XML closing tag missing')
}

function updateAttribute(raw: string, name: string, value: string | number | undefined, image: ImageElement): string {
  const expression = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)(["'])([\\s\\S]*?)\\2`, 'u')
  if (value === undefined) return raw.replace(expression, '')
  if (expression.test(raw)) {
    return raw.replace(expression, (_match, prefix: string, quote: string) => `${prefix}${quote}${String(value)}${quote}`)
  }
  const close = raw.search(/\/?\s*>$/u)
  if (close < 0) throw failure(image, 'source XML opening tag malformed')
  return `${raw.slice(0, close)} ${name}="${String(value)}"${raw.slice(close)}`
}

function openingAttributesReplacement(
  source: string,
  element: XmlElement,
  attributes: Array<readonly [string, string | number | undefined]>,
  image: ImageElement,
): Replacement | undefined {
  const end = openingEnd(source, element)
  const raw = source.slice(element.start, end)
  const updated = attributes.reduce((value, [name, next]) => updateAttribute(value, name, next, image), raw)
  return updated === raw ? undefined : { start: element.start, end, value: updated }
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function parseInteger(value: string | undefined): number | undefined {
  const number = parseNumber(value)
  return number !== undefined && Number.isInteger(number) ? number : undefined
}

function parsePercentage(value: string | undefined): number | undefined {
  const number = parseInteger(value)
  return number !== undefined && number >= 0 && number <= 100000 ? number : undefined
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return undefined
}

function sourceBounds(transform: XmlElement): Rect | undefined {
  const offset = directChild(transform, 'off')
  const extent = directChild(transform, 'ext')
  const values = [offset?.attributes.x, offset?.attributes.y, extent?.attributes.cx, extent?.attributes.cy].map(parseNumber)
  if (values.some((value) => value === undefined)) return undefined
  const [x, y, w, h] = values
  return x === undefined || y === undefined || w === undefined || h === undefined ? undefined : { x, y, w, h }
}

function boundsReplacements(source: string, transform: XmlElement, bounds: Rect, image: ImageElement): Replacement[] {
  const previous = sourceBounds(transform)
  if (!previous) throw failure(image, 'source transform bounds missing')
  const offset = directChild(transform, 'off')
  const extent = directChild(transform, 'ext')
  if (!offset || !extent) throw failure(image, 'source transform bounds missing')
  const replacements: Replacement[] = []
  if (previous.x !== bounds.x || previous.y !== bounds.y) {
    const replacement = openingAttributesReplacement(source, offset, [
      ...(previous.x !== bounds.x ? [['x', bounds.x] as const] : []),
      ...(previous.y !== bounds.y ? [['y', bounds.y] as const] : []),
    ], image)
    if (replacement) replacements.push(replacement)
  }
  if (previous.w !== bounds.w || previous.h !== bounds.h) {
    const replacement = openingAttributesReplacement(source, extent, [
      ...(previous.w !== bounds.w ? [['cx', bounds.w] as const] : []),
      ...(previous.h !== bounds.h ? [['cy', bounds.h] as const] : []),
    ], image)
    if (replacement) replacements.push(replacement)
  }
  return replacements
}

function transformReplacement(source: string, transform: XmlElement, image: ImageElement): Replacement | undefined {
  const previousRotation = parseInteger(transform.attributes.rot)
  const previousFlipH = parseBoolean(transform.attributes.flipH)
  const previousFlipV = parseBoolean(transform.attributes.flipV)
  const rotation = image.transform?.rotation
  const flipH = image.transform?.flipH
  const flipV = image.transform?.flipV
  const attributes: Array<readonly [string, string | number | undefined]> = []
  if (previousRotation !== rotation) attributes.push(['rot', rotation])
  if (previousFlipH !== flipH) attributes.push(['flipH', flipH === undefined ? undefined : flipH ? '1' : '0'])
  if (previousFlipV !== flipV) attributes.push(['flipV', flipV === undefined ? undefined : flipV ? '1' : '0'])
  return attributes.length > 0 ? openingAttributesReplacement(source, transform, attributes, image) : undefined
}

function normalizeCrop(crop: ImageCrop | undefined): ImageCrop | undefined {
  if (!crop) return undefined
  const result: ImageCrop = {}
  if (crop.left !== undefined) result.left = crop.left
  if (crop.top !== undefined) result.top = crop.top
  if (crop.right !== undefined) result.right = crop.right
  if (crop.bottom !== undefined) result.bottom = crop.bottom
  return Object.keys(result).length > 0 ? result : undefined
}

function sourceCrop(sourceRect: XmlElement | undefined): ImageCrop | undefined {
  if (!sourceRect) return undefined
  const crop: ImageCrop = {}
  const left = parsePercentage(sourceRect.attributes.l)
  const top = parsePercentage(sourceRect.attributes.t)
  const right = parsePercentage(sourceRect.attributes.r)
  const bottom = parsePercentage(sourceRect.attributes.b)
  if (left !== undefined) crop.left = left
  if (top !== undefined) crop.top = top
  if (right !== undefined) crop.right = right
  if (bottom !== undefined) crop.bottom = bottom
  return Object.keys(crop).length > 0 ? crop : undefined
}

function cropsEqual(left: ImageCrop | undefined, right: ImageCrop | undefined): boolean {
  return cropAttributes.every((attribute) => {
    const field = attribute === 'l' ? 'left' : attribute === 't' ? 'top' : attribute === 'r' ? 'right' : 'bottom'
    return left?.[field] === right?.[field]
  })
}

function serializeCrop(crop: ImageCrop, prefix: string): string {
  const attributes = [
    crop.left !== undefined ? ` l="${crop.left}"` : '',
    crop.top !== undefined ? ` t="${crop.top}"` : '',
    crop.right !== undefined ? ` r="${crop.right}"` : '',
    crop.bottom !== undefined ? ` b="${crop.bottom}"` : '',
  ].join('')
  return `<${prefix}srcRect${attributes}/>`
}

function insertionReplacement(source: string, parent: XmlElement, at: number, value: string, image: ImageElement): Replacement {
  if (!isSelfClosing(source, parent)) return { start: at, end: at, value }
  const opening = openingXml(source, parent).replace(/\/\s*>$/u, '>')
  return { start: parent.start, end: parent.end, value: `${opening}${value}</${parent.name}>` }
}

function cropReplacements(source: string, blipFill: XmlElement, image: ImageElement): Replacement[] {
  const sourceRect = directChild(blipFill, 'srcRect')
  const previous = sourceCrop(sourceRect)
  const crop = normalizeCrop(image.sourceCrop)
  if (cropsEqual(previous, crop)) return []
  if (!sourceRect && crop) {
    const blip = directChild(blipFill, 'blip')
    const drawingChild = blip ?? blipFill.children.find((child) => namespacePrefix(child.name) !== namespacePrefix(blipFill.name))
    const prefix = namespacePrefix(drawingChild?.name ?? 'a:srcRect')
    const next = blipFill.children.find((child) => child.localName === 'tile' || child.localName === 'stretch')
    const at = next?.start ?? closingStart(source, blipFill, image)
    return [insertionReplacement(source, blipFill, at, serializeCrop(crop, prefix), image)]
  }
  if (!sourceRect) return []
  const hasUnknownAttributes = Object.keys(sourceRect.attributes).some((name) => !cropAttributes.includes(name as typeof cropAttributes[number]))
  if (!crop && !hasUnknownAttributes && sourceRect.children.length === 0 && sourceRect.text.trim() === '') {
    return [{ start: sourceRect.start, end: sourceRect.end, value: '' }]
  }
  const replacement = openingAttributesReplacement(source, sourceRect, [
    ['l', crop?.left],
    ['t', crop?.top],
    ['r', crop?.right],
    ['b', crop?.bottom],
  ], image)
  return replacement ? [replacement] : []
}

interface SourceEffect {
  node: XmlElement
  value: ImageEffect
}

function sourceEffects(blip: XmlElement): SourceEffect[] {
  const effects: SourceEffect[] = []
  for (const node of blip.children) {
    if (node.localName === 'grayscl') {
      effects.push({ node, value: { type: 'grayscl' } })
      continue
    }
    if (node.localName !== 'alphaModFix') continue
    const amount = parsePercentage(node.attributes.amt)
    if (amount !== undefined) effects.push({ node, value: { type: 'alphaModFix', amount } })
  }
  return effects
}

function effectsEqual(left: ImageEffect[], right: ImageEffect[]): boolean {
  return left.length === right.length && left.every((effect, index) => {
    const other = right[index]
    return effect.type === other?.type
      && (effect.type !== 'alphaModFix' || other.type === 'alphaModFix' && effect.amount === other.amount)
  })
}

function serializeEffect(effect: ImageEffect, prefix: string): string {
  return effect.type === 'grayscl'
    ? `<${prefix}grayscl/>`
    : `<${prefix}alphaModFix amt="${effect.amount}"/>`
}

function rewriteEffect(source: string, sourceEffect: SourceEffect, effect: ImageEffect, image: ImageElement): string {
  const raw = source.slice(sourceEffect.node.start, sourceEffect.node.end)
  const end = tagEnd(raw, 1)
  const targetName = `${namespacePrefix(sourceEffect.node.name)}${effect.type}`
  const namePattern = new RegExp(`^<${escapeRegExp(sourceEffect.node.name)}(?=[\\s/>])`, 'u')
  let opening = raw.slice(0, end).replace(namePattern, `<${targetName}`)
  opening = updateAttribute(opening, 'amt', effect.type === 'alphaModFix' ? effect.amount : undefined, image)
  let updated = opening + raw.slice(end)
  if (!isSelfClosing(source, sourceEffect.node)) {
    const close = updated.lastIndexOf(`</${sourceEffect.node.name}`)
    if (close < 0) throw failure(image, 'source effect closing tag missing')
    updated = `${updated.slice(0, close)}</${targetName}${updated.slice(close + sourceEffect.node.name.length + 2)}`
  }
  return updated
}

function effectReplacements(source: string, blip: XmlElement, image: ImageElement): Replacement[] {
  const previous = sourceEffects(blip)
  const effects = image.effects ?? []
  if (effectsEqual(previous.map((effect) => effect.value), effects)) return []
  const prefix = namespacePrefix(previous[0]?.node.name ?? blip.name)
  const replacements: Replacement[] = []
  const shared = Math.min(previous.length, effects.length)
  for (let index = 0; index < shared; index += 1) {
    const sourceEffect = previous[index]
    const effect = effects[index]
    if (!sourceEffect || !effect || effectsEqual([sourceEffect.value], [effect])) continue
    if (sourceEffect.value.type === 'alphaModFix' && effect.type === 'alphaModFix') {
      const replacement = openingAttributesReplacement(source, sourceEffect.node, [['amt', effect.amount]], image)
      if (replacement) replacements.push(replacement)
    } else {
      replacements.push({
        start: sourceEffect.node.start,
        end: sourceEffect.node.end,
        value: rewriteEffect(source, sourceEffect, effect, image),
      })
    }
  }
  for (let index = effects.length; index < previous.length; index += 1) {
    const sourceEffect = previous[index]
    if (sourceEffect) replacements.push({ start: sourceEffect.node.start, end: sourceEffect.node.end, value: '' })
  }
  if (effects.length > previous.length) {
    const additions = effects.slice(previous.length).map((effect) => serializeEffect(effect, prefix)).join('')
    if (previous.length > 0) {
      const last = previous.at(-1)
      if (last) replacements.push({ start: last.node.end, end: last.node.end, value: additions })
    } else if (isSelfClosing(source, blip)) {
      const opening = openingXml(source, blip).replace(/\/\s*>$/u, '>')
      replacements.push({ start: blip.start, end: blip.end, value: `${opening}${additions}</${blip.name}>` })
    } else {
      const at = blip.children[0]?.start ?? closingStart(source, blip, image)
      replacements.push({ start: at, end: at, value: additions })
    }
  }
  return replacements
}

function sourceMask(geometry: XmlElement | undefined): ImageElement['maskPreset'] {
  const preset = geometry?.localName === 'prstGeom' ? geometry.attributes.prst : undefined
  return preset && supportedMasks.has(preset) ? preset as ImageElement['maskPreset'] : undefined
}

function serializeGeometry(mask: NonNullable<ImageElement['maskPreset']>, prefix: string): string {
  return `<${prefix}prstGeom prst="${mask}"><${prefix}avLst/></${prefix}prstGeom>`
}

function geometryReplacements(source: string, properties: XmlElement, transform: XmlElement, image: ImageElement): Replacement[] {
  const geometry = properties.children.find((child) => child.localName === 'prstGeom' || child.localName === 'custGeom')
  const previous = sourceMask(geometry)
  let mask = image.maskPreset
  if (mask === undefined) {
    if (previous === undefined) return []
    mask = 'rect'
  }
  if (previous === mask) return []
  if (geometry?.localName === 'prstGeom') {
    const replacement = openingAttributesReplacement(source, geometry, [['prst', mask]], image)
    return replacement ? [replacement] : []
  }
  const prefix = namespacePrefix(geometry?.name ?? transform.name) || 'a:'
  const value = serializeGeometry(mask, prefix)
  if (geometry) return [{ start: geometry.start, end: geometry.end, value }]
  return [{ start: transform.end, end: transform.end, value }]
}

export function rewritePictureAppearance(source: string, image: ImageElement): string {
  const picture = scanXml(source).find((element) => element.localName === 'pic')
  if (!picture) throw failure(image, 'source picture missing')
  const properties = directChild(picture, 'spPr')
  const blipFill = directChild(picture, 'blipFill')
  const transform = properties && directChild(properties, 'xfrm')
  const blip = blipFill && directChild(blipFill, 'blip')
  if (!properties || !transform || !blipFill || !blip) throw failure(image, 'source structure missing')

  const replacements: Replacement[] = [
    ...boundsReplacements(source, transform, image.bounds, image),
    ...cropReplacements(source, blipFill, image),
    ...effectReplacements(source, blip, image),
    ...geometryReplacements(source, properties, transform, image),
  ]
  const transformUpdate = transformReplacement(source, transform, image)
  if (transformUpdate) replacements.push(transformUpdate)
  return replacements.length > 0 ? replaceRanges(source, replacements) : source
}
