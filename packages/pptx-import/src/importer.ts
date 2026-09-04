import { colorTransformValueIsValid, fingerprintBytes, fingerprintDocument, isOoxmlToken, parseBitmapMetadata as parseSharedBitmapMetadata, type AssetAdapter, type AssetMetadata, type Color, type ColorMap, type ColorMapKey, type ColorTransform, type ColorTransformType, type CustomGeometry, type CustomGeometryCommand, type CustomGeometryPath, type Element, type ElementDefaults, type ElementTransform, type Fill, type GradientStop, type ImageCrop, type ImageEffect, type LevelDefaults, type OuterShadow, type PictureFill, type PictureStretch, type PictureTile, type Ppt4aiDocument, type PresetGeometry, type Rect, type ShapeStyleReference, type SlideBackground, type SlideLayout, type StrokeCap, type StrokeJoin, type StrokeStyle, type StyleReference, type SlideMaster, type TableBorder, type TableCell, type TableCellBorders, type TableElement, type TableStyle, type TableStyleReference, type TableStyleRegion, type TableStyleRegionName, type TableStyleText, type TextAutofit, type TextBody, type TextBodyProperties, type TextBullet, type TextMarks, type TextParagraph, type TextParagraphAttrs, type TextRun, type TextStyles, type Theme, type ThemeEffectStyleEntry, type ThemeFormatScheme, type ThemeLineStyleEntry, type ThemeStyleEntry, type ThemeColorSlot, type ThemeFontFace, type ThemeFonts, type ThemeFontScript } from '@ppt4ai/model'
import { attribute, child, children, localName, parseXml, textContent, type XmlNode } from './xml'
import { readZipEntries } from './zip'

interface Relationship {
  id: string
  target: string
  type: string
}

interface ImportedPart {
  path: string
  xml: XmlNode
}

export type ImportIssueCode = 'unsupported-media'

export interface ImportIssue {
  code: ImportIssueCode
  slideId: string
  partPath: string
  message: string
}

export interface ImportPptxOptions {
  assetAdapter?: AssetAdapter
  onIssue?: (issue: ImportIssue) => void
}

function pathDirectory(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

function normalizePath(path: string): string {
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}

function resolveTarget(basePath: string, target: string): string {
  return normalizePath(target.startsWith('/') ? target.slice(1) : `${pathDirectory(basePath)}/${target}`)
}

function findDescendants(node: XmlNode, name: string): XmlNode[] {
  const result: XmlNode[] = []
  for (const current of node.children) {
    if (localName(current.name) === name) result.push(current)
    result.push(...findDescendants(current, name))
  }
  return result
}

function relationshipType(value: string): string {
  return value.slice(value.lastIndexOf('/') + 1)
}

function parseRelationships(xml: string): Relationship[] {
  const root = parseXml(xml)
  return findDescendants(root, 'Relationship').flatMap((node) => {
    const id = attribute(node, 'Id')
    const target = attribute(node, 'Target')
    const type = attribute(node, 'Type')
    return id && target && type ? [{ id, target, type: relationshipType(type) }] : []
  })
}

function relationshipFilePath(partPath: string): string {
  return `${pathDirectory(partPath)}/_rels/${partPath.slice(partPath.lastIndexOf('/') + 1)}.rels`
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function parseIntegerAttribute(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) && Number.isInteger(number) ? number : undefined
}

const themeColorSlots = new Set<ThemeColorSlot>(['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'])
const colorMapKeys = new Set<ColorMapKey>(['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'])
const themeFontScripts: readonly ThemeFontScript[] = ['latin', 'ea', 'cs']

function parsePercentage(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const number = parseNumber(value)
  return number !== undefined && Number.isInteger(number) && number >= 0 && number <= 100000 ? number : undefined
}

function parseHexColor(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^[0-9A-F]{6}$/.test(normalized) ? normalized : undefined
}

/**
 * Every transform the colour node lists, whichever kind it is. The old seven-word whitelist dropped
 * `satMod` and friends, and the `0..100000` range dropped them a second time — Office writes
 * `satMod val="160000"`. Colour resolution still only computes the families it understands.
 */
function parseColorTransforms(node: XmlNode): ColorTransform[] | undefined {
  const transforms: ColorTransform[] = []
  for (const transformNode of node.children) {
    const type = localName(transformNode.name)
    if (!isOoxmlToken(type)) continue
    const raw = attribute(transformNode, 'val')
    // No `val` at all is the switch form (`a:comp`, `a:inv`, `a:gray`); a `val` that is out of its
    // type's range is malformed and still drops.
    if (raw === undefined) {
      transforms.push({ type })
      continue
    }
    const value = parseIntegerAttribute(raw)
    if (value !== undefined && colorTransformValueIsValid(type, value)) transforms.push({ type, value })
  }
  return transforms.length > 0 ? transforms : undefined
}

function parseBounds(shape: XmlNode): Rect | undefined {
  const transform = findDescendants(shape, 'xfrm')[0]
  const off = transform && child(transform, 'off')
  const ext = transform && child(transform, 'ext')
  const x = parseNumber(off && attribute(off, 'x'))
  const y = parseNumber(off && attribute(off, 'y'))
  const w = parseNumber(ext && attribute(ext, 'cx'))
  const h = parseNumber(ext && attribute(ext, 'cy'))
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined
  if (w <= 0 || h <= 0) return undefined
  return { x, y, w, h }
}

function parseColor(node: XmlNode | undefined): Color | undefined {
  if (!node) return undefined
  for (const colorNode of node.children) {
    const name = localName(colorNode.name)
    let color: Color | undefined
    if (name === 'srgbClr') {
      const value = parseHexColor(attribute(colorNode, 'val'))
      if (value) color = { type: 'srgb', v: value }
    } else if (name === 'schemeClr') {
      const value = attribute(colorNode, 'val')?.trim()
      if (value) color = { type: 'scheme', v: value }
    } else if (name === 'prstClr') {
      const value = attribute(colorNode, 'val')?.trim()
      if (value) color = { type: 'preset', v: value }
    } else if (name === 'sysClr') {
      const value = parseHexColor(attribute(colorNode, 'lastClr'))
      if (value) color = { type: 'system', v: value }
    } else if (name === 'scrgbClr') {
      const red = parsePercentage(attribute(colorNode, 'r'))
      const green = parsePercentage(attribute(colorNode, 'g'))
      const blue = parsePercentage(attribute(colorNode, 'b'))
      if (red !== undefined && green !== undefined && blue !== undefined) color = { type: 'scrgb', v: `${red},${green},${blue}` }
    }
    if (!color) continue
    const transforms = parseColorTransforms(colorNode)
    return transforms ? { ...color, transforms } : color
  }
  return undefined
}

function parseThemeFontFace(node: XmlNode | undefined): ThemeFontFace | undefined {
  if (!node) return undefined
  const face: ThemeFontFace = {}
  for (const script of themeFontScripts) {
    const scriptNode = child(node, script)
    // `typeface=""` is the stock way of saying "no override for this script", so it stays unmodeled.
    const typeface = scriptNode ? attribute(scriptNode, 'typeface')?.trim() : undefined
    if (typeface) face[script] = typeface
  }
  return Object.keys(face).length > 0 ? face : undefined
}

function parseThemeFonts(root: XmlNode): ThemeFonts | undefined {
  const scheme = findDescendants(root, 'fontScheme')[0]
  if (!scheme) return undefined
  const major = parseThemeFontFace(child(scheme, 'majorFont'))
  const minor = parseThemeFontFace(child(scheme, 'minorFont'))
  if (!major && !minor) return undefined
  return { ...(major ? { major } : {}), ...(minor ? { minor } : {}) }
}

/**
 * `a:fillStyleLst` / `a:bgFillStyleLst` in document order. Solid and linear gradient entries are
 * modeled; a pattern, picture or `a:path` gradient entry becomes `null` — a shape pointing at it
 * stays unfilled rather than getting an invented approximation.
 */
function parseThemeStyleEntries(list: XmlNode | undefined): ThemeStyleEntry[] | undefined {
  if (!list) return undefined
  const entries: ThemeStyleEntry[] = list.children.map((node) => parseFillNode(node) ?? null)
  return entries.length > 0 ? entries : undefined
}

/**
 * `a:effectStyleLst` entries. Each `a:effectStyle` keeps only its `a:outerShdw`; an empty effect list
 * and one holding effects we cannot express both become `null`, which is what the model means by
 * "this entry paints nothing" — the same convention the fill entries use for gradients and pictures.
 */
function parseThemeEffectStyleEntries(list: XmlNode | undefined): ThemeEffectStyleEntry[] | undefined {
  if (!list) return undefined
  const entries: ThemeEffectStyleEntry[] = list.children.map((node) => {
    const effects = child(node, 'effectLst')
    const outer = effects && child(effects, 'outerShdw')
    if (!outer) return null
    const color = parseColor(outer)
    if (!color) return null
    const blurRadius = parseIntegerAttribute(attribute(outer, 'blurRad'))
    const distance = parseIntegerAttribute(attribute(outer, 'dist'))
    const direction = parseIntegerAttribute(attribute(outer, 'dir'))
    return {
      color,
      ...(blurRadius !== undefined && blurRadius >= 0 ? { blurRadius } : {}),
      ...(distance !== undefined && distance >= 0 ? { distance } : {}),
      ...(direction === undefined ? {} : { direction }),
    }
  })
  return entries.length > 0 ? entries : undefined
}

/** `a:lnStyleLst` entries wrap their fill in `a:ln`, which also carries the width and the dash. */
function parseThemeLineStyleEntries(list: XmlNode | undefined): ThemeLineStyleEntry[] | undefined {
  if (!list) return undefined
  const entries: ThemeLineStyleEntry[] = list.children.map((node) => {
    const color = parseColor(child(node, 'solidFill'))
    if (!color) return null
    const width = parseLineWidth(node)
    const style = parseDashStyle(node)
    return { color, ...(width === undefined ? {} : { width }), ...(style === 'solid' ? {} : { style }) }
  })
  return entries.length > 0 ? entries : undefined
}

/** `p:bg` is either a direct fill in `p:bgPr` or a `p:bgRef` into the theme's background style list. */
function parseBackground(container: XmlNode | undefined): SlideBackground | undefined {
  const background = container && child(container, 'bg')
  if (!background) return undefined
  const properties = child(background, 'bgPr')
  const fill = properties ? parseDirectFill(properties) : undefined
  if (fill) return { fill }
  const styleRef = parseStyleReferenceNode(child(background, 'bgRef'))
  return styleRef ? { styleRef } : undefined
}

function parseFormatScheme(root: XmlNode): ThemeFormatScheme | undefined {
  const scheme = findDescendants(root, 'fmtScheme')[0]
  if (!scheme) return undefined
  const fillStyles = parseThemeStyleEntries(child(scheme, 'fillStyleLst'))
  const lineStyles = parseThemeLineStyleEntries(child(scheme, 'lnStyleLst'))
  const backgroundStyles = parseThemeStyleEntries(child(scheme, 'bgFillStyleLst'))
  const effectStyles = parseThemeEffectStyleEntries(child(scheme, 'effectStyleLst'))
  if (!fillStyles && !lineStyles && !backgroundStyles && !effectStyles) return undefined
  return {
    ...(fillStyles ? { fillStyles } : {}),
    ...(lineStyles ? { lineStyles } : {}),
    ...(backgroundStyles ? { backgroundStyles } : {}),
    ...(effectStyles ? { effectStyles } : {}),
  }
}

function parseTheme(xml: string, id: string, partPath: string): Theme | undefined {
  let root: XmlNode
  try {
    root = parseXml(xml)
  } catch {
    return undefined
  }
  const scheme = findDescendants(root, 'clrScheme')[0]
  const colors: Theme['colors'] = {}
  for (const slotNode of scheme?.children ?? []) {
    const slot = localName(slotNode.name) as ThemeColorSlot
    if (!themeColorSlots.has(slot)) continue
    const color = parseColor(slotNode)
    if (color) colors[slot] = color
  }
  const fonts = parseThemeFonts(root)
  const formatScheme = parseFormatScheme(root)
  if (Object.keys(colors).length === 0 && !fonts && !formatScheme) return undefined
  return { id, colors, ...(fonts ? { fonts } : {}), ...(formatScheme ? { formatScheme } : {}), source: { partPath } }
}

function parseColorMap(node: XmlNode | undefined): Partial<ColorMap> | undefined {
  if (!node) return undefined
  const map: Partial<ColorMap> = {}
  for (const [attributeName, target] of Object.entries(node.attributes)) {
    const key = localName(attributeName) as ColorMapKey
    if (!colorMapKeys.has(key) || !themeColorSlots.has(target as ThemeColorSlot)) continue
    map[key] = target as ThemeColorSlot
  }
  return Object.keys(map).length > 0 ? map : undefined
}

function parseColorMapOverride(root: XmlNode): Partial<ColorMap> | undefined {
  const override = findDescendants(root, 'clrMapOvr')[0]
  return override ? parseColorMap(child(override, 'overrideClrMapping')) : undefined
}

function parseFill(shape: XmlNode): Fill | undefined {
  const fill = findDescendants(shape, 'solidFill')[0]
  return fill ? (parseColor(fill) ? { color: parseColor(fill)! } : undefined) : undefined
}

/**
 * `a:prstDash/@val` verbatim. All eleven `ST_PresetLineDashVal` tokens reach the model, so the word
 * the file used survives a round trip; grouping them into dash patterns is the painter's business.
 * An unknown token is solid, which is also what an absent `a:prstDash` means.
 */
const presetDashTokens = new Set<StrokeStyle>([
  'solid', 'dot', 'sysDot', 'dash', 'lgDash', 'sysDash',
  'dashDot', 'lgDashDot', 'sysDashDot', 'lgDashDotDot', 'sysDashDotDot',
])

function parseDashStyle(line: XmlNode | undefined): StrokeStyle {
  const dash = line && child(line, 'prstDash')
  const value = dash && attribute(dash, 'val')
  return value && presetDashTokens.has(value as StrokeStyle) ? value as StrokeStyle : 'solid'
}

function parseTableBorder(line: XmlNode | undefined): TableBorder | undefined {
  if (!line) return undefined
  const color = parseColor(child(line, 'solidFill'))
  if (!color) return undefined
  const widthValue = parseNumber(attribute(line, 'w'))
  const width = widthValue !== undefined && widthValue > 0 ? widthValue : undefined
  const style = parseDashStyle(line)
  return { color, ...(width === undefined ? {} : { width }), style }
}

function parseTableCellBorders(properties: XmlNode): TableCellBorders | undefined {
  const borders: TableCellBorders = {}
  const left = parseTableBorder(child(properties, 'lnL'))
  const right = parseTableBorder(child(properties, 'lnR'))
  const top = parseTableBorder(child(properties, 'lnT'))
  const bottom = parseTableBorder(child(properties, 'lnB'))
  if (left) borders.left = left
  if (right) borders.right = right
  if (top) borders.top = top
  if (bottom) borders.bottom = bottom
  return Object.keys(borders).length === 0 ? undefined : borders
}

const tableStyleRegionNames: Record<string, TableStyleRegionName> = {
  wholeTbl: 'wholeTable',
  band1H: 'band1H',
  band2H: 'band2H',
  band1V: 'band1V',
  band2V: 'band2V',
  firstRow: 'firstRow',
  lastRow: 'lastRow',
  firstCol: 'firstCol',
  lastCol: 'lastCol',
}

/**
 * `a:gsLst` stops in document order. An unusable `pos` or colour drops that stop rather than being
 * guessed at, and the order is left alone so a malformed file is not quietly repaired.
 */
function parseGradientStops(gradient: XmlNode): GradientStop[] {
  const list = child(gradient, 'gsLst')
  if (!list) return []
  return children(list, 'gs').flatMap((node) => {
    const pos = parseIntegerAttribute(attribute(node, 'pos'))
    const color = parseColor(node)
    return pos !== undefined && pos >= 0 && pos <= 100000 && color ? [{ pos, color }] : []
  })
}

/**
 * A linear `a:gradFill` node. `a:path` gradients stay unmodeled, so this returns `undefined` for
 * them exactly as the solid-only parser did. Two usable stops are the minimum for a gradient; one
 * stop is the flat colour PowerPoint also paints, and none is no fill at all.
 */
function parseGradientNode(gradient: XmlNode): Fill | undefined {
  const linear = child(gradient, 'lin')
  if (!linear) return undefined
  const stops = parseGradientStops(gradient)
  const first = stops[0]
  if (!first) return undefined
  if (stops.length < 2) return { color: first.color }
  const angle = parseIntegerAttribute(attribute(linear, 'ang'))
  const scaled = attribute(linear, 'scaled')
  return {
    color: first.color,
    gradient: {
      stops,
      ...(angle === undefined ? {} : { angle }),
      ...(scaled === undefined ? {} : { scaled: scaled === '1' || scaled === 'true' }),
    },
  }
}

/**
 * One fill node, whichever kind it is. Theme style entries *are* fill nodes while a shape's fill is
 * wrapped in `spPr`, so both go through here and the gradient rules are written once.
 */
function parseFillNode(node: XmlNode | undefined): Fill | undefined {
  if (!node) return undefined
  const name = localName(node.name)
  if (name === 'solidFill') {
    const color = parseColor(node)
    return color ? { color } : undefined
  }
  return name === 'gradFill' ? parseGradientNode(node) : undefined
}

function parseDirectFill(node: XmlNode | undefined): Fill | undefined {
  if (!node) return undefined
  const solid = child(node, 'solidFill')
  if (solid) {
    const color = parseColor(solid)
    if (color) return { color }
  }
  const gradient = child(node, 'gradFill')
  return gradient ? parseGradientNode(gradient) : undefined
}

function shapeProperties(shape: XmlNode): XmlNode | undefined {
  return findDescendants(shape, 'spPr')[0]
}

function parseRotation(shape: XmlNode): number | undefined {
  const transform = findDescendants(shape, 'xfrm')[0]
  return parseIntegerAttribute(transform ? attribute(transform, 'rot') : undefined)
}

/** Only a set flip is recorded; `flipH="0"` means no flip, so it stays absent from the model. */
function parseFlips(transform: XmlNode | undefined): { flipH?: boolean; flipV?: boolean } {
  if (!transform) return {}
  const flipH = attribute(transform, 'flipH') === '1' || attribute(transform, 'flipH') === 'true'
  const flipV = attribute(transform, 'flipV') === '1' || attribute(transform, 'flipV') === 'true'
  return { ...(flipH ? { flipH } : {}), ...(flipV ? { flipV } : {}) }
}

function parseShapeFlips(shape: XmlNode): { flipH?: boolean; flipV?: boolean } {
  return parseFlips(findDescendants(shape, 'xfrm')[0])
}

function parseShapeFill(shape: XmlNode): Fill | undefined {
  return parseDirectFill(shapeProperties(shape))
}

/** `<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>`: the entry index plus the colour its `phClr` stands for. */
function parseStyleReferenceNode(reference: XmlNode | undefined): StyleReference | undefined {
  if (!reference) return undefined
  const idx = parseIntegerAttribute(attribute(reference, 'idx'))
  if (idx === undefined || idx < 0) return undefined
  const color = parseColor(reference)
  return { idx, ...(color ? { color } : {}) }
}

function parseStyleReference(style: XmlNode | undefined, name: string): StyleReference | undefined {
  return parseStyleReferenceNode(style && child(style, name))
}

function parseShapeStyleReference(shape: XmlNode): ShapeStyleReference | undefined {
  const style = child(shape, 'style')
  if (!style) return undefined
  const fill = parseStyleReference(style, 'fillRef')
  const line = parseStyleReference(style, 'lnRef')
  const effect = parseStyleReference(style, 'effectRef')
  const fontNode = child(style, 'fontRef')
  const fontIndex = fontNode ? attribute(fontNode, 'idx')?.trim() : undefined
  const fontColor = fontNode ? parseColor(fontNode) : undefined
  const font: ShapeStyleReference['font'] = fontIndex === 'major' || fontIndex === 'minor' || fontIndex === 'none'
    ? { idx: fontIndex, ...(fontColor ? { color: fontColor } : {}) }
    : undefined
  const styleRef: ShapeStyleReference = {
    ...(fill ? { fill } : {}),
    ...(line ? { line } : {}),
    ...(effect ? { effect } : {}),
    ...(font ? { font } : {}),
  }
  return Object.keys(styleRef).length > 0 ? styleRef : undefined
}

function parseStroke(shape: XmlNode): Fill | undefined {
  const line = child(shapeProperties(shape) ?? shape, 'ln')
  return parseDirectFill(line)
}

/** `a:ln/@w` in EMU. An unusable value is ignored rather than stored, the rule other measurements follow. */
function parseLineWidth(line: XmlNode | undefined): number | undefined {
  const width = line ? parseIntegerAttribute(attribute(line, 'w')) : undefined
  return width !== undefined && width >= 0 ? width : undefined
}

function parseStrokeWidth(shape: XmlNode): number | undefined {
  return parseLineWidth(child(shapeProperties(shape) ?? shape, 'ln'))
}

const strokeCaps = new Set<StrokeCap>(['flat', 'rnd', 'sq'])
const strokeJoins = new Set<StrokeJoin>(['round', 'bevel', 'miter'])

/** `a:ln/@cap`; an unrecognised word is ignored rather than stored, as elsewhere. */
function parseStrokeCap(line: XmlNode | undefined): StrokeCap | undefined {
  const value = line ? attribute(line, 'cap') : undefined
  return value !== undefined && strokeCaps.has(value as StrokeCap) ? value as StrokeCap : undefined
}

/** The corner is a child element rather than an attribute, so its name is the value. */
function parseStrokeJoin(line: XmlNode | undefined): StrokeJoin | undefined {
  if (!line) return undefined
  for (const node of line.children) {
    const name = localName(node.name) as StrokeJoin
    if (strokeJoins.has(name)) return name
  }
  return undefined
}

function parseStyleBorder(line: XmlNode | undefined): TableBorder | undefined {
  if (!line) return undefined
  const widthAttribute = attribute(line, 'w')
  const width = widthAttribute === undefined ? undefined : parsePositiveInteger(widthAttribute)
  if (widthAttribute !== undefined && width === undefined) return undefined
  const color = parseColor(child(line, 'solidFill'))
  if (!color) return undefined
  const style = parseDashStyle(line)
  return { color, ...(width === undefined ? {} : { width }), style }
}

/**
 * `b`/`i` on `a:tcTxStyle` are `ST_OnOffStyleType` — `on`/`off`/`def` — not the `0`/`1` of `a:rPr/@b`.
 * `def` means "inherit", so it leaves the field out rather than claiming `false`. The numeric pair is
 * read too: it is what this parser accepted before, and fixtures in this repo carry it.
 */
function parseStyleFlag(value: string | undefined): boolean | undefined {
  if (value === 'on' || value === '1') return true
  if (value === 'off' || value === '0') return false
  return undefined
}

function parseStyleText(node: XmlNode | undefined): TableStyleText | undefined {
  if (!node) return undefined
  const color = parseColor(node)
  const bold = parseStyleFlag(attribute(node, 'b'))
  const italic = parseStyleFlag(attribute(node, 'i'))
  if (!color && bold === undefined && italic === undefined) return undefined
  return {
    ...(color ? { color } : {}),
    ...(bold === undefined ? {} : { bold }),
    ...(italic === undefined ? {} : { italic }),
  }
}

/**
 * A table style's `a:tcBdr` names its sides `a:left`/`a:right`/`a:top`/`a:bottom` and wraps each in an
 * `a:ln` (`CT_ThemeableLineStyle`), while a cell's own `a:tcPr` names them `a:lnL`/`a:lnR`/`a:lnT`/
 * `a:lnB` with the line properties inline. This parser is the style one, and until now it read only the
 * cell vocabulary — so a real style's borders never arrived. Both are read: the ECMA shape first, the
 * flat one as the fallback that keeps older fixtures working.
 */
function parseStyleBorders(node: XmlNode | undefined): TableCellBorders | undefined {
  if (!node) return undefined
  const sides: Array<[keyof TableCellBorders, string, string]> = [
    ['left', 'left', 'lnL'],
    ['right', 'right', 'lnR'],
    ['top', 'top', 'lnT'],
    ['bottom', 'bottom', 'lnB'],
  ]
  const borders: TableCellBorders = {}
  for (const [side, themeable, flat] of sides) {
    const wrapper = child(node, themeable)
    const border = parseStyleBorder(wrapper ? child(wrapper, 'ln') : child(node, flat))
    if (border) borders[side] = border
  }
  return Object.keys(borders).length > 0 ? borders : undefined
}

function parseStyleRegion(node: XmlNode): TableStyleRegion | undefined {
  const directFill = parseDirectFill(node)
  const directBorders = parseStyleBorders(node)
  const nestedStyle = child(node, 'tcStyle')
  const nestedFill = parseDirectFill(nestedStyle && child(nestedStyle, 'fill'))
  const nestedBorders = parseStyleBorders(nestedStyle && child(nestedStyle, 'tcBdr'))
  const fill = nestedFill ?? directFill
  const mergedBorders = { ...(directBorders ?? {}), ...(nestedBorders ?? {}) }
  const text = parseStyleText(child(node, 'tcTxStyle'))
  if (!fill && Object.keys(mergedBorders).length === 0 && !text) return undefined
  return {
    ...(fill ? { fill } : {}),
    ...(Object.keys(mergedBorders).length > 0 ? { borders: mergedBorders } : {}),
    ...(text ? { text } : {}),
  }
}

function parseTableStyles(xml: string): Record<string, TableStyle> {
  const styles: Record<string, TableStyle> = {}
  let root: XmlNode
  try {
    root = parseXml(xml)
  } catch {
    return styles
  }
  for (const node of findDescendants(root, 'tblStyle')) {
    const id = attribute(node, 'styleId')?.trim()
    if (!id || styles[id]) continue
    const regions: NonNullable<TableStyle['regions']> = {}
    for (const regionNode of node.children) {
      const regionName = tableStyleRegionNames[localName(regionNode.name)]
      if (!regionName) continue
      const region = parseStyleRegion(regionNode)
      if (region) regions[regionName] = region
    }
    if (Object.keys(regions).length > 0) styles[id] = { id, regions }
  }
  return styles
}

function parseBooleanAttribute(node: XmlNode, name: string): boolean | undefined {
  const value = attribute(node, name)
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return undefined
}

function parseTableStyleReference(properties: XmlNode | undefined): TableStyleReference | undefined {
  if (!properties) return undefined
  const style: TableStyleReference = {}
  const styleId = attribute(properties, 'tableStyleId')?.trim()
  if (styleId) style.styleId = styleId
  const flags: Array<[string, keyof TableStyleReference]> = [
    ['firstRow', 'firstRow'], ['lastRow', 'lastRow'], ['firstCol', 'firstColumn'], ['lastCol', 'lastColumn'], ['bandRow', 'bandRow'], ['bandCol', 'bandColumn'],
  ]
  for (const [attributeName, propertyName] of flags) {
    const value = parseBooleanAttribute(properties, attributeName)
    if (value !== undefined) style[propertyName] = value as never
  }
  return Object.keys(style).length === 0 ? undefined : style
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const number = parseNumber(value)
  return number !== undefined && Number.isInteger(number) && number > 0 ? number : undefined
}

interface ImportedTableCell {
  row: number
  column: number
  rowSpan: number
  colSpan: number
  cell: TableCell
}

interface TableMediaContext {
  slidePath: string
  slideRelations: Relationship[]
  entries: Record<string, Uint8Array>
  register: (asset: { pictureFill: PictureFill; metadata: AssetMetadata; bytes: Uint8Array }) => void
  reportUnsupportedMedia?: (partPath: string) => void
}

function parseTable(frame: XmlNode, id: string, media?: TableMediaContext): TableElement | undefined {
  const bounds = parseBounds(frame)
  const table = findDescendants(frame, 'tbl')[0]
  if (!bounds || !table) return undefined
  const grid = child(table, 'tblGrid')
  const gridColumns = grid ? children(grid, 'gridCol').map((column) => parsePositiveInteger(attribute(column, 'w'))) : []
  if (gridColumns.length === 0 || gridColumns.some((value) => value === undefined)) return undefined
  const rows = children(table, 'tr')
  if (rows.length === 0) return undefined

  const occupied = new Map<string, ImportedTableCell>()
  const parsedRows: Array<{ height: number; cells: TableCell[] }> = []
  const columns = gridColumns as number[]

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const rowNode = rows[rowIndex]
    if (!rowNode) return undefined
    const height = parsePositiveInteger(attribute(rowNode, 'h'))
    if (height === undefined) return undefined
    const cells: TableCell[] = []
    let cursor = 0
    for (const cellNode of children(rowNode, 'tc')) {
      const properties = child(cellNode, 'tcPr')
      const hMerge = properties && attribute(properties, 'hMerge')
      const vMerge = properties && attribute(properties, 'vMerge')
      const mergeHorizontal = hMerge === '1' || hMerge === 'true'
      const mergeVertical = vMerge === '1' || vMerge === 'true'

      if (mergeVertical) {
        let mergeColumn = cursor
        while (mergeColumn < columns.length && !occupied.has(`${rowIndex}:${mergeColumn}`)) mergeColumn += 1
        const origin = occupied.get(`${rowIndex}:${mergeColumn}`)
        if (!origin || origin.row + origin.rowSpan < rowIndex) return undefined
        if (origin.row + origin.rowSpan === rowIndex) origin.rowSpan += 1
        if (origin.rowSpan > 1) origin.cell.rowSpan = origin.rowSpan
        for (let column = origin.column; column < origin.column + origin.colSpan; column += 1) occupied.set(`${rowIndex}:${column}`, origin)
        cursor = Math.max(cursor, origin.column + origin.colSpan)
        continue
      }

      if (mergeHorizontal) {
        const origin = occupied.get(`${rowIndex}:${Math.max(0, cursor - 1)}`)
        if (!origin || origin.row !== rowIndex || origin.column + origin.colSpan !== cursor) return undefined
        if (origin.column + origin.colSpan >= columns.length) return undefined
        origin.colSpan += 1
        if (origin.colSpan > 1) origin.cell.colSpan = origin.colSpan
        occupied.set(`${rowIndex}:${cursor}`, origin)
        cursor += 1
        continue
      }

      while (cursor < columns.length && occupied.has(`${rowIndex}:${cursor}`)) cursor += 1
      const column = cursor
      const colSpan = parsePositiveInteger(properties && attribute(properties, 'gridSpan')) ?? 1
      const rowSpan = parsePositiveInteger(properties && attribute(properties, 'rowSpan')) ?? 1
      if (column + colSpan > columns.length || rowIndex + rowSpan > rows.length) return undefined
      for (let row = rowIndex; row < rowIndex + rowSpan; row += 1) {
        for (let gridColumn = column; gridColumn < column + colSpan; gridColumn += 1) {
          if (occupied.has(`${row}:${gridColumn}`)) return undefined
        }
      }
      const body = parseTextBody(cellNode) ?? { paragraphs: [{ runs: [] }] }
      const cell: TableCell = { column, body }
      const fill = properties ? parseFill(properties) : undefined
      const borders = properties ? parseTableCellBorders(properties) : undefined
      if (fill) cell.fill = fill
      if (borders) cell.borders = borders
      const cellPicture = media && properties
        ? parsePictureFillNode(child(properties, 'blipFill'), media.slidePath, media.slideRelations, media.entries, media.reportUnsupportedMedia)
        : undefined
      if (cellPicture) {
        cell.pictureFill = cellPicture.pictureFill
        media?.register(cellPicture)
      }
      const parsed: ImportedTableCell = { row: rowIndex, column, rowSpan, colSpan, cell }
      if (rowSpan > 1) cell.rowSpan = rowSpan
      if (colSpan > 1) cell.colSpan = colSpan
      cells.push(cell)
      for (let row = rowIndex; row < rowIndex + rowSpan; row += 1) {
        for (let gridColumn = column; gridColumn < column + colSpan; gridColumn += 1) occupied.set(`${row}:${gridColumn}`, parsed)
      }
      cursor = column + colSpan
    }
    parsedRows.push({ height, cells })
  }

  const tableProperties = child(table, 'tblPr')
  const tableFill = parseFill(tableProperties ?? table)
  const style = parseTableStyleReference(tableProperties)
  const rotation = parseRotation(frame)
  return {
    id,
    kind: 'table',
    bounds,
    columns,
    rows: parsedRows,
    ...(rotation === undefined ? {} : { rotation }),
    ...parseShapeFlips(frame),
    ...(tableFill ? { fill: tableFill } : {}),
    ...(style ? { style } : {}),
  }
}

interface SlideShape {
  node: XmlNode
  /** Group children come after their group so the caller can register the group first. */
  childOf?: number
}

/**
 * Walk the shape tree keeping groups as structure. Leaves stay in document order so their
 * `el_N` ids match the writeback scanner, which numbers the same three tag names.
 */
function findSlideShapes(node: XmlNode, groupIndex?: number, result: SlideShape[] = []): SlideShape[] {
  for (const current of node.children) {
    const name = localName(current.name)
    if (name === 'grpSp') {
      const index = result.push({ node: current, ...(groupIndex === undefined ? {} : { childOf: groupIndex }) }) - 1
      findSlideShapes(current, index, result)
      continue
    }
    if (name === 'sp' || name === 'graphicFrame' || name === 'pic') {
      result.push({ node: current, ...(groupIndex === undefined ? {} : { childOf: groupIndex }) })
      continue
    }
    findSlideShapes(current, groupIndex, result)
  }
  return result
}

function parseGroupBounds(group: XmlNode): Rect | undefined {
  const properties = child(group, 'grpSpPr')
  if (!properties) return undefined
  const transform = child(properties, 'xfrm')
  if (!transform) return undefined
  const off = child(transform, 'off')
  const ext = child(transform, 'ext')
  const x = parseNumber(off && attribute(off, 'x'))
  const y = parseNumber(off && attribute(off, 'y'))
  const w = parseNumber(ext && attribute(ext, 'cx'))
  const h = parseNumber(ext && attribute(ext, 'cy'))
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined
  if (w <= 0 || h <= 0) return undefined
  return { x, y, w, h }
}

function parseGroupRotation(group: XmlNode): number | undefined {
  const properties = child(group, 'grpSpPr')
  const transform = properties && child(properties, 'xfrm')
  return parseIntegerAttribute(transform ? attribute(transform, 'rot') : undefined)
}

function parseGroupFlips(group: XmlNode): { flipH?: boolean; flipV?: boolean } {
  const properties = child(group, 'grpSpPr')
  return parseFlips(properties && child(properties, 'xfrm'))
}

/**
 * `a:chOff`/`a:chExt` declare the coordinate space children are authored in, which PowerPoint
 * rescales onto `a:off`/`a:ext` when the group is resized. Stored exactly as authored so bounds
 * writeback keeps comparing like with like; the scene graph composes it when flattening.
 */
function parseChildSpace(group: XmlNode): Rect | undefined {
  const properties = child(group, 'grpSpPr')
  const transform = properties && child(properties, 'xfrm')
  if (!transform) return undefined
  const childOff = child(transform, 'chOff')
  const childExt = child(transform, 'chExt')
  const x = parseNumber(childOff && attribute(childOff, 'x'))
  const y = parseNumber(childOff && attribute(childOff, 'y'))
  const w = parseNumber(childExt && attribute(childExt, 'cx'))
  const h = parseNumber(childExt && attribute(childExt, 'cy'))
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined
  if (w <= 0 || h <= 0) return undefined
  return { x, y, w, h }
}

function parseBitmapMetadata(path: string, bytes: Uint8Array, assetId: string): AssetMetadata | undefined {
  const metadata = parseSharedBitmapMetadata(bytes)
  if (!metadata) return undefined
  return { id: assetId, ...metadata, originalFilename: path.slice(path.lastIndexOf('/') + 1) }
}

function stableAssetId(path: string): string {
  return `asset_${path.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return undefined
}

function parsePictureTransform(picture: XmlNode): ElementTransform | undefined {
  const transformNode = child(child(picture, 'spPr') ?? picture, 'xfrm')
  if (!transformNode) return undefined
  const rotationValue = parseNumber(attribute(transformNode, 'rot'))
  const rotation = rotationValue !== undefined && Number.isInteger(rotationValue) ? rotationValue : undefined
  const flipH = parseBoolean(attribute(transformNode, 'flipH'))
  const flipV = parseBoolean(attribute(transformNode, 'flipV'))
  if (rotation === undefined && flipH === undefined && flipV === undefined) return undefined
  return {
    ...(rotation !== undefined ? { rotation } : {}),
    ...(flipH !== undefined ? { flipH } : {}),
    ...(flipV !== undefined ? { flipV } : {}),
  }
}

function parseImageCrop(picture: XmlNode): ImageCrop | undefined {
  const sourceRect = child(child(picture, 'blipFill') ?? picture, 'srcRect')
  if (!sourceRect) return undefined
  const left = parsePercentage(attribute(sourceRect, 'l'))
  const top = parsePercentage(attribute(sourceRect, 't'))
  const right = parsePercentage(attribute(sourceRect, 'r'))
  const bottom = parsePercentage(attribute(sourceRect, 'b'))
  if (left === undefined && top === undefined && right === undefined && bottom === undefined) return undefined
  return {
    ...(left !== undefined ? { left } : {}),
    ...(top !== undefined ? { top } : {}),
    ...(right !== undefined ? { right } : {}),
    ...(bottom !== undefined ? { bottom } : {}),
  }
}

function parseImageMaskPreset(picture: XmlNode): PresetGeometry | undefined {
  const geometry = child(child(picture, 'spPr') ?? picture, 'prstGeom')
  const preset = geometry && attribute(geometry, 'prst')?.trim()
  // The word is kept even when the mask painter has no outline for it, so exporting a star-cropped
  // picture cannot turn it into a rectangle; painting falls back to the rectangular mask.
  return preset && isOoxmlToken(preset) ? preset : undefined
}

function parseImageEffects(picture: XmlNode): ImageEffect[] | undefined {
  const blip = child(child(picture, 'blipFill') ?? picture, 'blip')
  if (!blip) return undefined
  const effects: ImageEffect[] = []
  for (const effectNode of blip.children) {
    const effectType = localName(effectNode.name)
    if (effectType === 'grayscl') effects.push({ type: 'grayscl' })
    else if (effectType === 'alphaModFix') {
      const amount = parsePercentage(attribute(effectNode, 'amt'))
      if (amount !== undefined) effects.push({ type: 'alphaModFix', amount })
    }
  }
  return effects.length > 0 ? effects : undefined
}

function parsePicture(
  picture: XmlNode,
  id: string,
  slidePath: string,
  slideRelations: Relationship[],
  entries: Record<string, Uint8Array>,
  reportUnsupportedMedia?: (partPath: string) => void,
): { element: Extract<Element, { kind: 'image' }>; metadata: AssetMetadata; bytes: Uint8Array } | undefined {
  const bounds = parseBounds(picture)
  const blip = findDescendants(picture, 'blip')[0]
  const relationshipId = blip && attribute(blip, 'embed')
  const mediaPath = relationshipTarget(slidePath, slideRelations, relationshipId, 'image')
  const bytes = mediaPath && entries[mediaPath]
  if (!bounds || !mediaPath || !bytes) return undefined
  const assetId = stableAssetId(mediaPath)
  const metadata = parseBitmapMetadata(mediaPath, bytes, assetId)
  if (!metadata) {
    reportUnsupportedMedia?.(mediaPath)
    return undefined
  }
  const transform = parsePictureTransform(picture)
  const sourceCrop = parseImageCrop(picture)
  const maskPreset = parseImageMaskPreset(picture)
  const effects = parseImageEffects(picture)
  return {
    element: {
      id,
      kind: 'image',
      bounds,
      assetId,
      ...(transform ? { transform } : {}),
      ...(sourceCrop ? { sourceCrop } : {}),
      ...(maskPreset ? { maskPreset } : {}),
      ...(effects ? { effects } : {}),
    },
    metadata,
    bytes,
  }
}

/**
 * `spPr/a:effectLst/a:outerShdw`, the only effect modeled. A shadow with no usable colour is dropped
 * whole: the three measurements describe where to put a colour we would not have. Attributes the
 * canvas cannot honour (`sx`/`sy`/`kx`/`ky`/`algn`/`rotWithShape`) are deliberately not read.
 */
function parseOuterShadow(shape: XmlNode): OuterShadow | undefined {
  const effects = shapeProperties(shape) && child(shapeProperties(shape)!, 'effectLst')
  const outer = effects && child(effects, 'outerShdw')
  if (!outer) return undefined
  const color = parseColor(outer)
  if (!color) return undefined
  const blurRadius = parseIntegerAttribute(attribute(outer, 'blurRad'))
  const distance = parseIntegerAttribute(attribute(outer, 'dist'))
  const direction = parseIntegerAttribute(attribute(outer, 'dir'))
  return {
    color,
    ...(blurRadius !== undefined && blurRadius >= 0 ? { blurRadius } : {}),
    ...(distance !== undefined && distance >= 0 ? { distance } : {}),
    ...(direction === undefined ? {} : { direction }),
  }
}

/**
 * `a:blipFill` on a shape's `spPr`. A blip fill with no fill mode at all reads as stretch, which is what
 * `p:pic` already does with its own blip; `a:tile` now carries its own placement instead of being
 * refused, so the only thing left unread here is `a:stretch`'s `a:fillRect` insets.
 */
/** `a:stretch/a:fillRect`. Signed, and only read for the stretched form — a tile has its own placement. */
function parsePictureStretch(fill: XmlNode): PictureStretch | undefined {
  const stretch = child(fill, 'stretch')
  const rect = stretch && child(stretch, 'fillRect')
  if (!rect) return undefined
  const left = parseIntegerAttribute(attribute(rect, 'l'))
  const top = parseIntegerAttribute(attribute(rect, 't'))
  const right = parseIntegerAttribute(attribute(rect, 'r'))
  const bottom = parseIntegerAttribute(attribute(rect, 'b'))
  const values = {
    ...(left === undefined ? {} : { left }),
    ...(top === undefined ? {} : { top }),
    ...(right === undefined ? {} : { right }),
    ...(bottom === undefined ? {} : { bottom }),
  }
  return Object.keys(values).length > 0 ? values : undefined
}

/** `a:tile`'s six attributes. Absent values stay absent so the model does not claim defaults it read. */
function parsePictureTile(fill: XmlNode): PictureTile | undefined {
  const tile = child(fill, 'tile')
  if (!tile) return undefined
  const offsetX = parseIntegerAttribute(attribute(tile, 'tx'))
  const offsetY = parseIntegerAttribute(attribute(tile, 'ty'))
  const scaleX = parseIntegerAttribute(attribute(tile, 'sx'))
  const scaleY = parseIntegerAttribute(attribute(tile, 'sy'))
  const align = attribute(tile, 'algn')?.trim()
  const flip = attribute(tile, 'flip')?.trim()
  return {
    ...(offsetX === undefined ? {} : { offsetX }),
    ...(offsetY === undefined ? {} : { offsetY }),
    ...(scaleX !== undefined && scaleX >= 0 ? { scaleX } : {}),
    ...(scaleY !== undefined && scaleY >= 0 ? { scaleY } : {}),
    ...(align && isOoxmlToken(align) ? { align } : {}),
    ...(flip && isOoxmlToken(flip) ? { flip } : {}),
  }
}

/**
 * `a:blipFill` under an arbitrary container (`p:spPr`, `p:bgPr`, `a:tcPr`), resolved to an asset. Shared so
 * a shape fill, a slide background and a table cell all register the same media once.
 */
function parsePictureFillNode(
  fill: XmlNode | undefined,
  slidePath: string,
  slideRelations: Relationship[],
  entries: Record<string, Uint8Array>,
  reportUnsupportedMedia?: (partPath: string) => void,
): { pictureFill: PictureFill; metadata: AssetMetadata; bytes: Uint8Array } | undefined {
  if (!fill) return undefined
  const blip = child(fill, 'blip')
  const relationshipId = blip && attribute(blip, 'embed')
  const mediaPath = relationshipTarget(slidePath, slideRelations, relationshipId, 'image')
  const bytes = mediaPath && entries[mediaPath]
  if (!mediaPath || !bytes) return undefined
  const assetId = stableAssetId(mediaPath)
  const metadata = parseBitmapMetadata(mediaPath, bytes, assetId)
  if (!metadata) {
    reportUnsupportedMedia?.(mediaPath)
    return undefined
  }
  const sourceCrop = parseImageCrop(fill)
  const tile = parsePictureTile(fill)
  const stretch = tile ? undefined : parsePictureStretch(fill)
  const effects = parseImageEffects(fill)
  return {
    pictureFill: {
      assetId,
      ...(sourceCrop ? { sourceCrop } : {}),
      ...(tile ? { tile } : {}),
      ...(stretch ? { stretch } : {}),
      ...(effects ? { effects } : {}),
    },
    metadata,
    bytes,
  }
}

function parseShapePictureFill(
  shape: XmlNode,
  slidePath: string,
  slideRelations: Relationship[],
  entries: Record<string, Uint8Array>,
  reportUnsupportedMedia?: (partPath: string) => void,
): { pictureFill: PictureFill; metadata: AssetMetadata; bytes: Uint8Array } | undefined {
  const properties = shapeProperties(shape)
  const fill = properties && child(properties, 'blipFill')
  if (!fill) return undefined
  const blip = child(fill, 'blip')
  const relationshipId = blip && attribute(blip, 'embed')
  const mediaPath = relationshipTarget(slidePath, slideRelations, relationshipId, 'image')
  const bytes = mediaPath && entries[mediaPath]
  if (!mediaPath || !bytes) return undefined
  const assetId = stableAssetId(mediaPath)
  const metadata = parseBitmapMetadata(mediaPath, bytes, assetId)
  if (!metadata) {
    reportUnsupportedMedia?.(mediaPath)
    return undefined
  }
  const sourceCrop = parseImageCrop(fill)
  const tile = parsePictureTile(fill)
  const stretch = tile ? undefined : parsePictureStretch(fill)
  const effects = parseImageEffects(fill)
  return {
    pictureFill: {
      assetId,
      ...(sourceCrop ? { sourceCrop } : {}),
      ...(tile ? { tile } : {}),
      ...(stretch ? { stretch } : {}),
      ...(effects ? { effects } : {}),
    },
    metadata,
    bytes,
  }
}

/**
 * The `prst` word verbatim. Only the four painted ones used to survive, so `chevron` became `rect` and
 * standalone export wrote that back into the file; `rect` remains the answer for an absent or
 * malformed word, which is also OOXML's default geometry.
 */
/**
 * `a:custGeom/a:pathLst`. Every coordinate has to be a literal number: OOXML also allows guide names
 * (`x="adj1"`) resolved through `a:gdLst`'s formula language, and that table is as unverifiable here as
 * the preset outlines are. One non-numeric coordinate therefore discards the whole geometry — half a
 * path would join lines to invented places, which is worse than the rectangle it falls back to.
 */
function parseCustomGeometry(shape: XmlNode): CustomGeometry | undefined {
  const geometry = shapeProperties(shape) && child(shapeProperties(shape)!, 'custGeom')
  const list = geometry && child(geometry, 'pathLst')
  if (!list) return undefined
  const paths: CustomGeometryPath[] = []
  for (const pathNode of children(list, 'path')) {
    const commands: CustomGeometryCommand[] = []
    for (const commandNode of pathNode.children) {
      const name = localName(commandNode.name)
      if (name === 'close') {
        commands.push({ type: 'close' })
        continue
      }
      const points = children(commandNode, 'pt').map((point) => ({
        x: parseNumber(attribute(point, 'x')),
        y: parseNumber(attribute(point, 'y')),
      }))
      if (points.some((point) => point.x === undefined || point.y === undefined)) return undefined
      if ((name === 'moveTo' || name === 'lnTo') && points.length === 1) {
        commands.push({ type: name === 'moveTo' ? 'move' : 'line', x: points[0]!.x!, y: points[0]!.y! })
      } else if (name === 'cubicBezTo' && points.length === 3) {
        commands.push({
          type: 'cubic',
          x1: points[0]!.x!, y1: points[0]!.y!,
          x2: points[1]!.x!, y2: points[1]!.y!,
          x: points[2]!.x!, y: points[2]!.y!,
        })
      } else if (name === 'quadBezTo' && points.length === 2) {
        commands.push({ type: 'quad', x1: points[0]!.x!, y1: points[0]!.y!, x: points[1]!.x!, y: points[1]!.y! })
      } else if (name === 'arcTo') {
        const widthRadius = parseNumber(attribute(commandNode, 'wR'))
        const heightRadius = parseNumber(attribute(commandNode, 'hR'))
        const startAngle = parseNumber(attribute(commandNode, 'stAng'))
        const swingAngle = parseNumber(attribute(commandNode, 'swAng'))
        if (widthRadius === undefined || heightRadius === undefined || startAngle === undefined || swingAngle === undefined) return undefined
        commands.push({ type: 'arc', widthRadius, heightRadius, startAngle, swingAngle })
      } else {
        return undefined
      }
    }
    if (commands.length === 0) continue
    const width = parseNumber(attribute(pathNode, 'w'))
    const height = parseNumber(attribute(pathNode, 'h'))
    paths.push({
      ...(width !== undefined && width > 0 ? { width } : {}),
      ...(height !== undefined && height > 0 ? { height } : {}),
      commands,
    })
  }
  return paths.length > 0 ? { paths } : undefined
}

/**
 * `p:bg/p:bgPr/a:blipFill` — a photo background. Shares the shape path's media resolution, so the same
 * media part used by a picture, a shape fill and a background registers one asset. Only slides are read:
 * a layout or master background would need that part's own relationships, which this loop does not have.
 */
function parseBackgroundPictureFill(
  container: XmlNode | undefined,
  slidePath: string,
  slideRelations: Relationship[],
  entries: Record<string, Uint8Array>,
  reportUnsupportedMedia?: (partPath: string) => void,
): { pictureFill: PictureFill; metadata: AssetMetadata; bytes: Uint8Array } | undefined {
  const background = container && child(container, 'bg')
  const properties = background && child(background, 'bgPr')
  const fill = properties && child(properties, 'blipFill')
  if (!fill) return undefined
  const blip = child(fill, 'blip')
  const relationshipId = blip && attribute(blip, 'embed')
  const mediaPath = relationshipTarget(slidePath, slideRelations, relationshipId, 'image')
  const bytes = mediaPath && entries[mediaPath]
  if (!mediaPath || !bytes) return undefined
  const assetId = stableAssetId(mediaPath)
  const metadata = parseBitmapMetadata(mediaPath, bytes, assetId)
  if (!metadata) {
    reportUnsupportedMedia?.(mediaPath)
    return undefined
  }
  const sourceCrop = parseImageCrop(fill)
  const tile = parsePictureTile(fill)
  const stretch = tile ? undefined : parsePictureStretch(fill)
  const effects = parseImageEffects(fill)
  return {
    pictureFill: {
      assetId,
      ...(sourceCrop ? { sourceCrop } : {}),
      ...(tile ? { tile } : {}),
      ...(stretch ? { stretch } : {}),
      ...(effects ? { effects } : {}),
    },
    metadata,
    bytes,
  }
}

function parsePreset(shape: XmlNode): PresetGeometry {
  const geometry = findDescendants(shape, 'prstGeom')[0]
  const preset = geometry && attribute(geometry, 'prst')?.trim()
  return preset && isOoxmlToken(preset) ? preset : 'rect'
}

/** Only set when the source declares geometry, so a plain text box does not gain a preset it never had. */
function parseOptionalPreset(shape: XmlNode): PresetGeometry | undefined {
  return findDescendants(shape, 'prstGeom')[0] ? parsePreset(shape) : undefined
}

function parsePlaceholder(shape: XmlNode): string | undefined {
  const placeholder = findDescendants(shape, 'ph')[0]
  if (!placeholder) return undefined
  const type = attribute(placeholder, 'type') ?? 'body'
  const index = attribute(placeholder, 'idx')
  return index ? `${type}:${index}` : type
}

/**
 * The legacy flat `text` field. Breaks are read in place for the same reason as in
 * `parseParagraphRuns`, and paragraphs join with a newline so the two agree.
 */
function parseText(shape: XmlNode): { present: boolean; value: string } {
  const body = findDescendants(shape, 'txBody')[0]
  if (!body) return { present: false, value: '' }
  const paragraphs = children(body, 'p').map((paragraphNode) => {
    let text = ''
    for (const node of paragraphNode.children) {
      const name = localName(node.name)
      if (name === 'br') text += '\n'
      else if (name === 'r') {
        const textNode = child(node, 't')
        if (textNode) text += textContent(textNode)
      }
    }
    return text
  })
  return { present: true, value: paragraphs.join('\n') }
}

function parseBullet(paragraphProperties: XmlNode | undefined): TextBullet | undefined {
  if (!paragraphProperties) return undefined
  const character = child(paragraphProperties, 'buChar')
  if (character) {
    const value = attribute(character, 'char')
    if (!value || Array.from(value).length !== 1) return undefined
    const runProperties = child(character, 'rPr')
    const fontFamily = runProperties ? attribute(runProperties, 'typeface') : undefined
    return fontFamily ? { type: 'char', char: value, fontFamily } : { type: 'char', char: value }
  }
  const autoNumber = child(paragraphProperties, 'buAutoNum')
  if (!autoNumber) return undefined
  // The word itself, not one of three families. The old whitelist also asked for `alphaLcParenRight`,
  // which is not an OOXML word at all (`alphaLcParenR` is), so lettered lists never matched it.
  const type = attribute(autoNumber, 'type')?.trim()
  const scheme = type && isOoxmlToken(type) ? type : 'arabicPeriod'
  const rawStart = attribute(autoNumber, 'startAt')
  const startAt = rawStart === undefined ? undefined : parseNumber(rawStart)
  if (startAt !== undefined && (!Number.isInteger(startAt) || startAt <= 0)) return undefined
  return startAt === undefined ? { type: 'autoNum', scheme } : { type: 'autoNum', scheme, startAt }
}

/**
 * `u="none"` stays as `'none'` rather than becoming absent: the model has that value, and an
 * explicit none overrides an inherited underline, so it is not the same as saying nothing.
 */
function parseRunMarks(runProperties: XmlNode | undefined): TextMarks | undefined {
  if (!runProperties) return undefined
  const marks: TextMarks = {}
  const latin = child(runProperties, 'latin')
  const typeface = latin && attribute(latin, 'typeface')?.trim()
  if (typeface) marks.fontFamily = typeface
  // `a:ea` and `a:cs` are the same shape as `a:latin`, one per script.
  const eastAsian = child(runProperties, 'ea')
  const eastAsianTypeface = eastAsian && attribute(eastAsian, 'typeface')?.trim()
  if (eastAsianTypeface) marks.fontFamilyEa = eastAsianTypeface
  const complex = child(runProperties, 'cs')
  const complexTypeface = complex && attribute(complex, 'typeface')?.trim()
  if (complexTypeface) marks.fontFamilyCs = complexTypeface
  // `sz` is in hundredths of a point; the model stores points.
  const size = parseNumber(attribute(runProperties, 'sz'))
  if (size !== undefined && size > 0) marks.fontSize = size / 100
  const bold = parseBoolean(attribute(runProperties, 'b'))
  if (bold !== undefined) marks.bold = bold
  const italic = parseBoolean(attribute(runProperties, 'i'))
  if (italic !== undefined) marks.italic = italic
  // The word itself: `dbl`, `wavy` and the rest used to collapse onto `single`, which both export paths
  // then wrote back as `sng`.
  const underline = attribute(runProperties, 'u')?.trim()
  if (underline && isOoxmlToken(underline)) marks.underline = underline
  const color = parseColor(child(runProperties, 'solidFill'))
  if (color) marks.color = { color }
  const baseline = parseNumber(attribute(runProperties, 'baseline'))
  if (baseline !== undefined) marks.baseline = baseline
  return Object.keys(marks).length > 0 ? marks : undefined
}

/**
 * `a:br` is a position, not a count. Walking the paragraph's children in order keeps it there;
 * the previous "count every br, append that many newlines" only agreed with the source when a
 * paragraph held a single run.
 *
 * A break joins the run in front of it, matching how the exporter splits run text on `\n` and
 * emits `<a:br/>` between the fragments. Leading breaks get a run of their own.
 */
function parseParagraphRuns(paragraphNode: XmlNode): TextRun[] {
  const runs: TextRun[] = []
  for (const node of paragraphNode.children) {
    const name = localName(node.name)
    if (name === 'br') {
      const previous = runs[runs.length - 1]
      if (previous) previous.text += '\n'
      else runs.push({ text: '\n' })
      continue
    }
    if (name !== 'r') continue
    const textNode = child(node, 't')
    if (!textNode) continue
    const text = textContent(textNode)
    if (!text) continue
    const marks = parseRunMarks(child(node, 'rPr'))
    runs.push(marks ? { text, marks } : { text })
  }
  return runs
}

/**
 * Only the `spcPct` form of line spacing and the `spcPts` form of paragraph spacing are read,
 * because those are the two the model can hold: `lineSpacing` is a percentage and `spaceBefore` is
 * EMU. The other pairing is skipped rather than converted, since guessing the unit would silently
 * misplace text.
 */
function parseSpacingPercentage(node: XmlNode | undefined): number | undefined {
  const percentage = node && child(node, 'spcPct')
  const value = percentage && parseNumber(attribute(percentage, 'val'))
  return value !== undefined && value > 0 ? value : undefined
}

function parseSpacingEmu(node: XmlNode | undefined): number | undefined {
  const points = node && child(node, 'spcPts')
  const value = points && parseNumber(attribute(points, 'val'))
  // `spcPts@val` is in hundredths of a point, and one point is 12700 EMU.
  return value !== undefined && value >= 0 ? value * 127 : undefined
}

function parseParagraphAttrs(paragraphProperties: XmlNode | undefined): TextParagraphAttrs | undefined {
  if (!paragraphProperties) return undefined
  const attrs: TextParagraphAttrs = {}
  const alignment = attribute(paragraphProperties, 'algn')
  if (alignment === 'l') attrs.align = 'left'
  else if (alignment === 'ctr') attrs.align = 'center'
  else if (alignment === 'r') attrs.align = 'right'
  const level = parseIntegerAttribute(attribute(paragraphProperties, 'lvl'))
  if (level !== undefined && level >= 0) attrs.level = level
  const marginLeft = parseNumber(attribute(paragraphProperties, 'marL'))
  if (marginLeft !== undefined && marginLeft >= 0) attrs.marginLeft = marginLeft
  // Signed: a hanging indent is negative against a positive marL.
  const indent = parseNumber(attribute(paragraphProperties, 'indent'))
  if (indent !== undefined) attrs.indent = indent
  const lineSpacing = parseSpacingPercentage(child(paragraphProperties, 'lnSpc'))
  if (lineSpacing !== undefined) attrs.lineSpacing = lineSpacing
  const spaceBefore = parseSpacingEmu(child(paragraphProperties, 'spcBef'))
  if (spaceBefore !== undefined) attrs.spaceBefore = spaceBefore
  const spaceAfter = parseSpacingEmu(child(paragraphProperties, 'spcAft'))
  if (spaceAfter !== undefined) attrs.spaceAfter = spaceAfter
  const bullet = parseBullet(paragraphProperties)
  if (bullet) attrs.bullet = bullet
  const defaultMarks = parseRunMarks(child(paragraphProperties, 'defRPr'))
  if (defaultMarks) attrs.defaultMarks = defaultMarks
  return Object.keys(attrs).length > 0 ? attrs : undefined
}

/**
 * `a:lvl1pPr`…`a:lvl9pPr` of an `a:lstStyle` or a `p:txStyles` child, as zero-based levels. The
 * level's `a:defRPr` is the same node `parseParagraphAttrs` reads as `defaultMarks`, so it is lifted
 * to the level's own `marks` rather than parsed twice.
 */
function parseLevelDefaults(parent: XmlNode | undefined): LevelDefaults[] | undefined {
  if (!parent) return undefined
  const levels: LevelDefaults[] = []
  for (let index = 1; index <= 9; index += 1) {
    const parsed = parseParagraphAttrs(child(parent, `lvl${index}pPr`))
    if (!parsed) continue
    const { defaultMarks, ...attrs } = parsed
    levels.push({
      level: index - 1,
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
      ...(defaultMarks ? { marks: defaultMarks } : {}),
    })
  }
  return levels.length > 0 ? levels : undefined
}

function parseListStyle(shape: XmlNode): LevelDefaults[] | undefined {
  const body = findDescendants(shape, 'txBody')[0]
  return body ? parseLevelDefaults(child(body, 'lstStyle')) : undefined
}

function parseTextStyles(root: XmlNode): TextStyles | undefined {
  const styles = findDescendants(root, 'txStyles')[0]
  if (!styles) return undefined
  const title = parseLevelDefaults(child(styles, 'titleStyle'))
  const body = parseLevelDefaults(child(styles, 'bodyStyle'))
  const other = parseLevelDefaults(child(styles, 'otherStyle'))
  if (!title && !body && !other) return undefined
  return { ...(title ? { title } : {}), ...(body ? { body } : {}), ...(other ? { other } : {}) }
}

/** `lnSpcReduction` is deliberately not read: see the note in the design doc about the exporter. */
function parseAutofit(bodyProperties: XmlNode): TextAutofit | undefined {
  if (child(bodyProperties, 'noAutofit')) return { type: 'none' }
  const normal = child(bodyProperties, 'normAutofit')
  if (normal) {
    const scale = parsePercentage(attribute(normal, 'fontScale'))
    return scale !== undefined && scale >= 1 ? { type: 'shrink', minFontScale: scale } : { type: 'shrink' }
  }
  return child(bodyProperties, 'spAutoFit') ? { type: 'resize' } : undefined
}

function parseBodyProperties(bodyProperties: XmlNode | undefined): TextBodyProperties | undefined {
  if (!bodyProperties) return undefined
  const properties: TextBodyProperties = {}
  const insets = (['lIns', 'tIns', 'rIns', 'bIns'] as const).map((name) => parseNumber(attribute(bodyProperties, name)))
  const [left, top, right, bottom] = insets
  // All four or none: the model has no partial inset form.
  if (left !== undefined && top !== undefined && right !== undefined && bottom !== undefined && insets.every((value) => value! >= 0)) {
    properties.insets = { left, top, right, bottom }
  }
  const anchor = attribute(bodyProperties, 'anchor')
  if (anchor === 't') properties.verticalAlign = 'top'
  else if (anchor === 'ctr') properties.verticalAlign = 'middle'
  else if (anchor === 'b') properties.verticalAlign = 'bottom'
  const verticalValue = attribute(bodyProperties, 'vert')
  if (verticalValue === 'vert270' || verticalValue === 'vert' || verticalValue === 'wordArtVert') properties.vertical = 'vertical'
  else if (verticalValue === 'horz') properties.vertical = 'horizontal'
  const wrap = attribute(bodyProperties, 'wrap')
  if (wrap === 'square' || wrap === 'none') properties.wrap = wrap
  const autofit = parseAutofit(bodyProperties)
  if (autofit) properties.autofit = autofit
  return Object.keys(properties).length > 0 ? properties : undefined
}

function parseTextBody(shape: XmlNode): TextBody | undefined {
  const body = findDescendants(shape, 'txBody')[0]
  if (!body) return undefined
  const bodyPr = parseBodyProperties(child(body, 'bodyPr'))
  const paragraphs: TextParagraph[] = children(body, 'p').map((paragraphNode) => {
    const runs = parseParagraphRuns(paragraphNode)
    const attrs = parseParagraphAttrs(child(paragraphNode, 'pPr'))
    return attrs ? { runs, attrs } : { runs }
  })
  if (paragraphs.length === 0) return undefined
  return bodyPr ? { bodyPr, paragraphs } : { paragraphs }
}

function parseElement(shape: XmlNode, id: string, requireBounds: boolean): Element | undefined {
  const bounds = parseBounds(shape)
  if (requireBounds && !bounds) return undefined
  const placeholder = parsePlaceholder(shape)
  const rotation = parseRotation(shape)
  const flips = parseShapeFlips(shape)
  const text = parseText(shape)
  if (text.present) {
    if (!bounds) return undefined
    const element: Extract<Element, { kind: 'text' }> = { id, kind: 'text', bounds, ...(rotation === undefined ? {} : { rotation }), ...flips, text: text.value }
    const preset = parseOptionalPreset(shape)
    if (preset) element.preset = preset
    const body = parseTextBody(shape)
    if (body) element.body = body
    if (placeholder) element.placeholder = placeholder
    const fill = parseShapeFill(shape)
    if (fill) element.fill = fill
    const stroke = parseStroke(shape)
    if (stroke) element.stroke = stroke
    const textStrokeWidth = parseStrokeWidth(shape)
    if (textStrokeWidth !== undefined) element.strokeWidth = textStrokeWidth
    const line = child(shapeProperties(shape) ?? shape, 'ln')
    const textStrokeStyle = stroke ? parseDashStyle(line) : undefined
    if (textStrokeStyle && textStrokeStyle !== 'solid') element.strokeStyle = textStrokeStyle
    const textCap = parseStrokeCap(line)
    if (textCap) element.strokeCap = textCap
    const textJoin = parseStrokeJoin(line)
    if (textJoin) element.strokeJoin = textJoin
    const textShadow = parseOuterShadow(shape)
    if (textShadow) element.shadow = textShadow
    const textGeometry = parseCustomGeometry(shape)
    if (textGeometry) element.customGeometry = textGeometry
    const styleRef = parseShapeStyleReference(shape)
    if (styleRef) element.styleRef = styleRef
    return element
  }
  if (!bounds) return undefined
  const element: Extract<Element, { kind: 'shape' }> = {
    id,
    kind: 'shape',
    preset: parsePreset(shape),
    bounds,
    ...(rotation === undefined ? {} : { rotation }),
    ...flips,
  }
  if (placeholder) element.placeholder = placeholder
  const fill = parseShapeFill(shape)
  if (fill) element.fill = fill
  const stroke = parseStroke(shape)
  if (stroke) element.stroke = stroke
  const shapeStrokeWidth = parseStrokeWidth(shape)
  if (shapeStrokeWidth !== undefined) element.strokeWidth = shapeStrokeWidth
  const shapeLine = child(shapeProperties(shape) ?? shape, 'ln')
  const shapeStrokeStyle = stroke ? parseDashStyle(shapeLine) : undefined
  if (shapeStrokeStyle && shapeStrokeStyle !== 'solid') element.strokeStyle = shapeStrokeStyle
  const shapeCap = parseStrokeCap(shapeLine)
  if (shapeCap) element.strokeCap = shapeCap
  const shapeJoin = parseStrokeJoin(shapeLine)
  if (shapeJoin) element.strokeJoin = shapeJoin
  const shapeShadow = parseOuterShadow(shape)
  if (shapeShadow) element.shadow = shapeShadow
  const shapeGeometry = parseCustomGeometry(shape)
  if (shapeGeometry) element.customGeometry = shapeGeometry
  const shapeStyleRef = parseShapeStyleReference(shape)
  if (shapeStyleRef) element.styleRef = shapeStyleRef
  return element
}

function parseDefaults(shape: XmlNode): [string, ElementDefaults] | undefined {
  const placeholder = parsePlaceholder(shape)
  if (!placeholder) return undefined
  const defaults: ElementDefaults = {}
  const bounds = parseBounds(shape)
  if (bounds) defaults.bounds = bounds
  const rotation = parseRotation(shape)
  if (rotation !== undefined) defaults.rotation = rotation
  defaults.preset = parsePreset(shape)
  const fill = parseShapeFill(shape)
  if (fill) defaults.fill = fill
  const stroke = parseStroke(shape)
  if (stroke) defaults.stroke = stroke
  const body = parseTextBody(shape)
  // `text` stays alongside `body`: master/layout writeback compares against it in its no-body path.
  if (body) defaults.body = body
  const listStyle = parseListStyle(shape)
  if (listStyle) defaults.listStyle = listStyle
  const text = parseText(shape)
  if (text.present && text.value) defaults.text = text.value
  return [placeholder, defaults]
}

function parseMaster(xml: string, id: string, themeId: string | undefined, partPath: string): SlideMaster {
  const root = parseXml(xml)
  const defaults: Record<string, ElementDefaults> = {}
  for (const shape of findDescendants(root, 'sp')) {
    const parsed = parseDefaults(shape)
    if (parsed) defaults[parsed[0]] = parsed[1]
  }
  const colorMap = parseColorMap(findDescendants(root, 'clrMap')[0])
  const textStyles = parseTextStyles(root)
  const background = parseBackground(findDescendants(root, 'cSld')[0])
  return { id, defaults, ...(background ? { background } : {}), ...(themeId ? { themeId } : {}), ...(colorMap ? { colorMap } : {}), ...(textStyles ? { textStyles } : {}), source: { partPath } }
}

function parseLayout(xml: string, id: string, masterId: string, partPath: string): SlideLayout {
  const root = parseXml(xml)
  const defaults: Record<string, ElementDefaults> = {}
  for (const shape of findDescendants(root, 'sp')) {
    const parsed = parseDefaults(shape)
    if (parsed) defaults[parsed[0]] = parsed[1]
  }
  const colorMapOverride = parseColorMapOverride(root)
  const background = parseBackground(findDescendants(root, 'cSld')[0])
  return { id, masterId, defaults, ...(background ? { background } : {}), ...(colorMapOverride ? { colorMapOverride } : {}), source: { partPath } }
}

function parsePart(entries: Record<string, Uint8Array>, path: string): ImportedPart | undefined {
  const bytes = entries[path]
  if (!bytes) return undefined
  return { path, xml: parseXml(new TextDecoder().decode(bytes)) }
}

function readRelationships(entries: Record<string, Uint8Array>, partPath: string): Relationship[] {
  const relationPath = relationshipFilePath(partPath)
  const bytes = entries[relationPath]
  return bytes ? parseRelationships(new TextDecoder().decode(bytes)) : []
}

function relationshipTarget(partPath: string, relations: Relationship[], relationshipId: string | undefined, type: string): string | undefined {
  const relationship = relations.find((value) => value.id === relationshipId && value.type === type)
  return relationship ? resolveTarget(partPath, relationship.target) : undefined
}

function parseSlideSize(root: XmlNode): { w: number; h: number } {
  const size = child(root, 'presentation') && child(child(root, 'presentation')!, 'sldSz')
  const w = parseNumber(size && attribute(size, 'cx')) ?? 12192000
  const h = parseNumber(size && attribute(size, 'cy')) ?? 6858000
  return { w, h }
}

function xmlEntries(entries: Record<string, Uint8Array>): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith('.xml') || path.endsWith('.rels')) output[path] = new TextDecoder().decode(bytes)
  }
  return output
}

export async function importPptx(input: Uint8Array, options: ImportPptxOptions = {}): Promise<Ppt4aiDocument> {
  const entries = await readZipEntries(input)
  const presentationPath = 'ppt/presentation.xml'
  const presentation = parsePart(entries, presentationPath)
  if (!presentation) throw new Error('PPTX is missing ppt/presentation.xml')
  const presentationRelations = readRelationships(entries, presentationPath)
  const slideIds = child(presentation.xml, 'presentation') && child(child(presentation.xml, 'presentation')!, 'sldIdLst')
  const slideRefs = slideIds ? children(slideIds, 'sldId') : []
  const slides: Ppt4aiDocument['slides'] = {}
  const elements: Ppt4aiDocument['elements'] = {}
  const assets: NonNullable<Ppt4aiDocument['assets']> = {}
  const layouts: Record<string, SlideLayout> = {}
  const masters: Record<string, SlideMaster> = {}
  const themes: NonNullable<Ppt4aiDocument['themes']> = {}
  const slideOrder: string[] = []
  let elementCounter = 1
  let groupCounter = 1
  let layoutCounter = 1
  let masterCounter = 1
  let themeCounter = 1
  const layoutIdsByPath = new Map<string, string>()
  const masterIdsByPath = new Map<string, string>()
  const themeIdsByPath = new Map<string, string | undefined>()
  const tableStylesXml = entries['ppt/tableStyles.xml']
  const tableStyles = tableStylesXml ? parseTableStyles(new TextDecoder().decode(tableStylesXml)) : {}

  for (let slideIndex = 0; slideIndex < slideRefs.length; slideIndex += 1) {
    const reference = slideRefs[slideIndex]
    if (!reference) continue
    const relationshipId = reference.attributes['r:id'] ?? reference.attributes['id']
    const slidePath = relationshipTarget(presentationPath, presentationRelations, relationshipId, 'slide')
    if (!slidePath) continue
    const slidePart = parsePart(entries, slidePath)
    if (!slidePart) continue
    const slideId = `sld_${slideIndex + 1}`
    const slideRelations = readRelationships(entries, slidePath)
    const layoutRelationship = slideRelations.find((value) => value.type === 'slideLayout')
    const layoutPath = relationshipTarget(slidePath, slideRelations, layoutRelationship?.id, 'slideLayout')
    let layoutId: string | undefined
    let masterId: string | undefined
    if (layoutPath) {
      layoutId = layoutIdsByPath.get(layoutPath)
      if (layoutId) {
        masterId = layouts[layoutId]?.masterId
      } else {
        layoutId = `lyt_${layoutCounter++}`
        layoutIdsByPath.set(layoutPath, layoutId)
        const layoutPart = parsePart(entries, layoutPath)
        const layoutRelations = readRelationships(entries, layoutPath)
        const masterRelationship = layoutRelations.find((value) => value.type === 'slideMaster')
        const masterPath = relationshipTarget(layoutPath, layoutRelations, masterRelationship?.id, 'slideMaster')
        if (masterPath) {
          masterId = masterIdsByPath.get(masterPath)
          if (!masterId) {
            masterId = `mst_${masterCounter++}`
            masterIdsByPath.set(masterPath, masterId)
            const masterPart = parsePart(entries, masterPath)
            if (masterPart) {
              const masterRelations = readRelationships(entries, masterPath)
              const themeRelationship = masterRelations.find((value) => value.type === 'theme')
              const themePath = themeRelationship ? resolveTarget(masterPath, themeRelationship.target) : undefined
              let themeId: string | undefined
              if (themePath) {
                if (themeIdsByPath.has(themePath)) {
                  themeId = themeIdsByPath.get(themePath)
                } else {
                  const themeBytes = entries[themePath]
                  const candidateId = `theme_${themeCounter}`
                  const theme = themeBytes ? parseTheme(new TextDecoder().decode(themeBytes), candidateId, themePath) : undefined
                  if (theme) {
                    themeCounter += 1
                    themeId = candidateId
                    themes[themeId] = theme
                  }
                  themeIdsByPath.set(themePath, themeId)
                }
              }
              masters[masterId] = parseMaster(new TextDecoder().decode(entries[masterPath]!), masterId, themeId, masterPath)
            }
          }
        }
        if (layoutPart) layouts[layoutId] = parseLayout(new TextDecoder().decode(entries[layoutPath]!), layoutId, masterId ?? '', layoutPath)
      }
    }

    const elementIds: string[] = []
    // Table cells register their media through a buffer: the adapter write is awaited outside the
    // synchronous cell walk, which cannot await.
    const registeredAssets: Array<{ metadata: AssetMetadata; bytes: Uint8Array }> = []
    const shapes = findSlideShapes(slidePart.xml)
    // Groups are registered before their children so the flattened scene cascades rotation.
    const groupIds = new Map<number, string>()
    const groupChildIds = new Map<number, string[]>()
    const registerChild = (shape: SlideShape, id: string): void => {
      if (shape.childOf === undefined) {
        elementIds.push(id)
        return
      }
      const owner = groupIds.get(shape.childOf)
      if (!owner) {
        elementIds.push(id)
        return
      }
      groupChildIds.get(shape.childOf)!.push(id)
      elementIds.push(id)
    }
    for (const [shapeIndex, shape] of shapes.entries()) {
      if (localName(shape.node.name) === 'grpSp') {
        const bounds = parseGroupBounds(shape.node)
        if (!bounds) continue
        const groupId = `grp_${groupCounter++}`
        const rotation = parseGroupRotation(shape.node)
        const childSpace = parseChildSpace(shape.node)
        groupIds.set(shapeIndex, groupId)
        groupChildIds.set(shapeIndex, [])
        elements[groupId] = {
          id: groupId,
          kind: 'group',
          bounds,
          childIds: [],
          ...(rotation === undefined ? {} : { rotation }),
          ...parseGroupFlips(shape.node),
          ...(childSpace === undefined ? {} : { childSpace }),
        }
        registerChild(shape, groupId)
        continue
      }
      const id = `el_${elementCounter++}`
      if (localName(shape.node.name) === 'pic') {
        const picture = parsePicture(shape.node, id, slidePath, slideRelations, entries, (partPath) => {
          options.onIssue?.({
            code: 'unsupported-media',
            slideId,
            partPath,
            message: `picture skipped because ${partPath} is not a supported bitmap format`,
          })
        })
        if (!picture) continue
        elements[id] = picture.element
        registerChild(shape, id)
        if (!assets[picture.metadata.id]) {
          assets[picture.metadata.id] = picture.metadata
          await options.assetAdapter?.put(picture.metadata.id, new Uint8Array(picture.bytes), picture.metadata)
        }
        continue
      }
      const tableMedia: TableMediaContext = {
        slidePath,
        slideRelations,
        entries,
        register: (asset) => {
          if (assets[asset.metadata.id]) return
          assets[asset.metadata.id] = asset.metadata
          registeredAssets.push(asset)
        },
        reportUnsupportedMedia: (partPath) => {
          options.onIssue?.({
            code: 'unsupported-media',
            slideId,
            partPath,
            message: `table cell fill skipped because ${partPath} is not a supported bitmap format`,
          })
        },
      }
      const element = localName(shape.node.name) === 'graphicFrame' ? parseTable(shape.node, id, tableMedia) : parseElement(shape.node, id, true)
      if (!element) continue
      // A shape's picture fill is resolved here rather than in `parseElement`, because only this loop
      // has the relationships and part bytes the blip points at — the same reason `parsePicture` takes
      // them as parameters instead of reading them itself.
      if (element.kind === 'shape' || element.kind === 'text') {
        const picture = parseShapePictureFill(shape.node, slidePath, slideRelations, entries, (partPath) => {
          options.onIssue?.({
            code: 'unsupported-media',
            slideId,
            partPath,
            message: `picture fill skipped because ${partPath} is not a supported bitmap format`,
          })
        })
        if (picture) {
          element.pictureFill = picture.pictureFill
          if (!assets[picture.metadata.id]) {
            assets[picture.metadata.id] = picture.metadata
            await options.assetAdapter?.put(picture.metadata.id, new Uint8Array(picture.bytes), picture.metadata)
          }
        }
      }
      elements[id] = element
      registerChild(shape, id)
    }
    for (const asset of registeredAssets) {
      await options.assetAdapter?.put(asset.metadata.id, new Uint8Array(asset.bytes), asset.metadata)
    }
    for (const [shapeIndex, groupId] of groupIds) {
      const childIds = groupChildIds.get(shapeIndex) ?? []
      const group = elements[groupId]
      if (group?.kind !== 'group') continue
      if (childIds.length === 0) {
        delete elements[groupId]
        const position = elementIds.indexOf(groupId)
        if (position >= 0) elementIds.splice(position, 1)
        continue
      }
      group.childIds = childIds
    }
    const colorMapOverride = parseColorMapOverride(slidePart.xml)
    const source = relationshipId && reference.attributes.id
      ? {
          originId: slideId,
          partPath: slidePath,
          relationshipId,
          presentationId: reference.attributes.id,
        }
      : undefined
    const common = findDescendants(slidePart.xml, 'cSld')[0]
    let slideBackground = parseBackground(common)
    const backgroundPicture = parseBackgroundPictureFill(common, slidePath, slideRelations, entries, (partPath) => {
      options.onIssue?.({
        code: 'unsupported-media',
        slideId,
        partPath,
        message: `slide background skipped because ${partPath} is not a supported bitmap format`,
      })
    })
    if (backgroundPicture) {
      slideBackground = { ...(slideBackground ?? {}), pictureFill: backgroundPicture.pictureFill }
      if (!assets[backgroundPicture.metadata.id]) {
        assets[backgroundPicture.metadata.id] = backgroundPicture.metadata
        await options.assetAdapter?.put(backgroundPicture.metadata.id, new Uint8Array(backgroundPicture.bytes), backgroundPicture.metadata)
      }
    }
    slides[slideId] = { id: slideId, elementIds, ...(slideBackground ? { background: slideBackground } : {}), ...(layoutId ? { layoutId } : {}), ...(masterId ? { masterId } : {}), ...(colorMapOverride ? { colorMapOverride } : {}), ...(source ? { source } : {}) }
    slideOrder.push(slideId)
  }

  const page = parseSlideSize(presentation.xml)
  const document: Ppt4aiDocument = {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_imported',
    page,
    slides,
    elements,
    ...(Object.keys(assets).length > 0 ? { assets } : {}),
    slideOrder,
    layouts,
    masters,
    ...(Object.keys(themes).length > 0 ? { themes } : {}),
    ...(Object.keys(tableStyles).length > 0 ? { tableStyles } : {}),
    source: { entries: xmlEntries(entries), packageFingerprint: fingerprintBytes(input) },
  }
  if (!document.source) throw new Error('PPTX import source metadata missing')
  document.source.modelFingerprint = fingerprintDocument(document)
  return document
}
