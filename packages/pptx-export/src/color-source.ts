import { colorTransformValueIsValid, isOoxmlToken, type Color, type Fill, type OuterShadow } from '@ppt4ai/model'
import type { XmlElement } from './xml-range.js'

/**
 * Every `EG_ColorChoice` element, `a:hslClr` included even though nothing here can read one: a colour is
 * found by name in order to be *replaced*, and a colour left beside the new one would break the choice.
 */
export const colorChoiceNames = new Set(['srgbClr', 'schemeClr', 'prstClr', 'sysClr', 'scrgbClr', 'hslClr'])

/** Whether the source says what the model says — the other half of the mirror's job. */
export function colorsEqual(left: Color | undefined, right: Color | undefined): boolean {
  if (!left || !right) return left === right
  if (left.type !== right.type || left.v !== right.v) return false
  if (left.systemName !== right.systemName) return false
  const leftTransforms = left.transforms ?? []
  const rightTransforms = right.transforms ?? []
  return leftTransforms.length === rightTransforms.length
    && leftTransforms.every((transform, index) => {
      const other = rightTransforms[index]
      return other?.type === transform.type && other.value === transform.value
    })
}

/** Mirrors the importer's `parseColor`; see the note in `text-source.ts` on why it is not shared. */
export function sourceColor(element: XmlElement | undefined): Color | undefined {
  return sourceColorNode(element)?.color
}

/**
 * The colour a wrapper states, together with the node it came from, for the writebacks that patch that
 * node rather than replace it. The first readable colour wins, which is what the importer's loop does.
 */
export function sourceColorNode(element: XmlElement | undefined): { node: XmlElement; color: Color } | undefined {
  if (!element) return undefined
  for (const child of element.children) {
    const color = colorOfNode(child)
    if (color) return { node: child, color }
  }
  return undefined
}

function colorOfNode(child: XmlElement): Color | undefined {
  let color: Color | undefined
  if (child.localName === 'srgbClr' && /^[0-9A-F]{6}$/iu.test(child.attributes.val ?? '')) {
    color = { type: 'srgb', v: (child.attributes.val ?? '').toUpperCase() }
  } else if (child.localName === 'schemeClr' && child.attributes.val) {
    color = { type: 'scheme', v: child.attributes.val.trim() }
  } else if (child.localName === 'prstClr' && child.attributes.val) {
    color = { type: 'preset', v: child.attributes.val.trim() }
  } else if (child.localName === 'sysClr' && /^[0-9A-F]{6}$/iu.test(child.attributes.lastClr ?? '')) {
    // `@val` is the system colour's name, `@lastClr` its cached value; the importer keeps both, so the
    // comparison has to see both or an edited name looks unchanged.
    const systemName = child.attributes.val?.trim()
    color = { type: 'system', v: (child.attributes.lastClr ?? '').toUpperCase(), ...(systemName ? { systemName } : {}) }
  } else if (child.localName === 'scrgbClr') {
    const channels = [child.attributes.r, child.attributes.g, child.attributes.b].map((value) => Number(value))
    if (channels.every((value) => Number.isInteger(value) && value >= 0 && value <= 100000)) {
      color = { type: 'scrgb', v: channels.join(',') }
    }
  }
  if (!color) return undefined
  // Mirrors the importer, including its per-type ranges: comparing a source `satMod` against a model
  // that dropped it is what used to make an edited colour look unchanged.
  const transforms = child.children.flatMap((transform) => {
    if (!isOoxmlToken(transform.localName)) return []
    if (transform.attributes.val === undefined) return [{ type: transform.localName }]
    const value = Number(transform.attributes.val)
    return colorTransformValueIsValid(transform.localName, value) ? [{ type: transform.localName, value }] : []
  })
  return transforms.length > 0 ? { ...color, transforms } : color
}

/**
 * The source fill as the model would have imported it, so the writeback comparison can tell an
 * untouched gradient from an edited one. Mirrors the importer's `parseDirectFill`: `solidFill` is a
 * plain colour, a `gradFill` carries its stops plus whichever of `a:lin`/`a:path` the file used, and
 * anything else stays unexpressed.
 *
 * Without this a `gradFill` source compared as "no fill", so the moment the importer started reading
 * gradients every edited deck had them overwritten with a flat first stop.
 */
export function sourceFill(fillNode: XmlElement | undefined): Fill | undefined {
  if (!fillNode) return undefined
  if (fillNode.localName === 'solidFill') {
    const color = sourceColor(fillNode)
    return color ? { color } : undefined
  }
  if (fillNode.localName === 'pattFill') return sourcePatternFill(fillNode)
  if (fillNode.localName !== 'gradFill') return undefined
  const linear = fillNode.children.find((child) => child.localName === 'lin')
  const pathNode = fillNode.children.find((child) => child.localName === 'path')
  if (!linear && !pathNode) return undefined
  const list = fillNode.children.find((child) => child.localName === 'gsLst')
  const stops = (list?.children ?? []).flatMap((node) => {
    if (node.localName !== 'gs') return []
    const pos = sourceInteger(node.attributes.pos)
    const color = sourceColor(node)
    return pos !== undefined && pos >= 0 && pos <= 100000 && color ? [{ pos, color }] : []
  })
  const first = stops[0]
  if (!first) return undefined
  if (stops.length < 2) return { color: first.color }
  // `a:path` wins over `a:lin` when a file writes both, the precedence the importer and painting use.
  if (pathNode) return { color: first.color, gradient: { stops, ...sourceGradientPath(pathNode) } }
  const angle = sourceInteger(linear!.attributes.ang)
  const scaled = linear!.attributes.scaled
  return {
    color: first.color,
    gradient: {
      stops,
      ...(angle === undefined ? {} : { angle }),
      ...(scaled === undefined ? {} : { scaled: scaled === '1' || scaled === 'true' }),
    },
  }
}

function sourceInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : undefined
}

/**
 * The radial form's `@path` and `a:fillToRect`, on the importer's terms: only the three words it keeps,
 * and only the insets inside their range. Reading `a:lin` but not `a:path` is what made every export
 * rewrite a radial fill node — the comparison called an untouched one changed.
 */
function sourceGradientPath(pathNode: XmlElement): Pick<NonNullable<Fill['gradient']>, 'path' | 'fillToRect'> {
  const path = pathNode.attributes.path
  const rect = pathNode.children.find((child) => child.localName === 'fillToRect')
  const inset = (name: string): number | undefined => {
    const value = sourceInteger(rect?.attributes[name])
    return value !== undefined && value >= 0 && value <= 100000 ? value : undefined
  }
  const left = inset('l')
  const top = inset('t')
  const right = inset('r')
  const bottom = inset('b')
  const insets = {
    ...(left === undefined ? {} : { left }),
    ...(top === undefined ? {} : { top }),
    ...(right === undefined ? {} : { right }),
    ...(bottom === undefined ? {} : { bottom }),
  }
  return {
    ...(path === 'circle' || path === 'rect' || path === 'shape' ? { path } : {}),
    ...(Object.keys(insets).length > 0 ? { fillToRect: insets } : {}),
  }
}

/**
 * Mirrors the importer's `parsePatternFillNode`. Without it an untouched `a:pattFill` compared as "no
 * fill" the moment the importer learned to read patterns, so editing anything else on the shape
 * rewrote the fill node and dropped whatever the model does not express — an `extLst`, say.
 */
function sourcePatternFill(fillNode: XmlElement): Fill | undefined {
  const preset = fillNode.attributes.prst
  const foreground = sourceColor(fillNode.children.find((child) => child.localName === 'fgClr'))
  const background = sourceColor(fillNode.children.find((child) => child.localName === 'bgClr'))
  if (!preset || !foreground || !background) return undefined
  return { color: foreground, pattern: { preset, foreground, background } }
}

/**
 * The source's `a:outerShdw` as the model would have imported it, mirroring `parseOuterShadow` for the
 * same reason `sourceFill` mirrors `parseDirectFill`: the comparison has to see what the model sees, or
 * an edit is silently dropped and an untouched node is needlessly rewritten.
 */
export function sourceOuterShadow(effectList: XmlElement | undefined): OuterShadow | undefined {
  const outer = effectList?.children.find((child) => child.localName === 'outerShdw')
  if (!outer) return undefined
  const color = sourceColor(outer)
  if (!color) return undefined
  const integer = (name: string): number | undefined => {
    const raw = outer.attributes[name]
    if (raw === undefined || raw.trim() === '') return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : undefined
  }
  const blurRadius = integer('blurRad')
  const distance = integer('dist')
  const direction = integer('dir')
  return {
    color,
    ...(blurRadius !== undefined && blurRadius >= 0 ? { blurRadius } : {}),
    ...(distance !== undefined && distance >= 0 ? { distance } : {}),
    ...(direction === undefined ? {} : { direction }),
  }
}
