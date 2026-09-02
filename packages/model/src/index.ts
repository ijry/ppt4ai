export type PresetGeometry = 'rect' | 'roundRect' | 'ellipse' | 'triangle'

export { parseBitmapMetadata, type BitmapMetadata } from './bitmap-metadata'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Color {
  type: 'srgb' | 'scheme' | 'preset' | 'system' | 'scrgb'
  v: string
  transforms?: ColorTransform[]
}

export type ColorTransformType = 'tint' | 'shade' | 'lumMod' | 'lumOff' | 'alpha' | 'alphaMod' | 'alphaOff'

export interface ColorTransform {
  type: ColorTransformType
  value: number
}

export type ThemeColorSlot = 'dk1' | 'lt1' | 'dk2' | 'lt2' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' | 'hlink' | 'folHlink'

export const DEFAULT_THEME_COLORS: Readonly<Record<ThemeColorSlot, Color>> = {
  dk1: { type: 'srgb', v: '000000' },
  lt1: { type: 'srgb', v: 'FFFFFF' },
  dk2: { type: 'srgb', v: '1F1F1F' },
  lt2: { type: 'srgb', v: 'F7F7F7' },
  accent1: { type: 'srgb', v: '4472C4' },
  accent2: { type: 'srgb', v: 'ED7D31' },
  accent3: { type: 'srgb', v: 'A5A5A5' },
  accent4: { type: 'srgb', v: 'FFC000' },
  accent5: { type: 'srgb', v: '5B9BD5' },
  accent6: { type: 'srgb', v: '70AD47' },
  hlink: { type: 'srgb', v: '0563C1' },
  folHlink: { type: 'srgb', v: '954F72' },
}

export interface ThemeSource {
  partPath: string
}

export interface Theme {
  id: string
  colors: Partial<Record<ThemeColorSlot, Color | null>>
  source?: ThemeSource
}

export type ColorMapKey = 'bg1' | 'tx1' | 'bg2' | 'tx2' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' | 'hlink' | 'folHlink'

export type ColorMap = Record<ColorMapKey, ThemeColorSlot>

export const DEFAULT_COLOR_MAP: ColorMap = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folHlink: 'folHlink',
}

export interface ResolvedColor {
  rgb: string
  alpha: number
}

export interface Fill {
  color: Color
}

export interface TextMarks {
  fontFamily?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: 'none' | 'single'
  color?: Fill
  baseline?: number
}

export interface TextRun {
  text: string
  marks?: TextMarks
}

export type TextBulletScheme = 'arabic' | 'alphaLower' | 'alphaUpper'

export type TextBullet =
  | { type: 'char'; char: string; fontFamily?: string }
  | { type: 'autoNum'; scheme: TextBulletScheme; startAt?: number }

export interface TextParagraphAttrs {
  align?: 'left' | 'center' | 'right'
  level?: number
  indent?: number
  marginLeft?: number
  lineSpacing?: number
  spaceBefore?: number
  spaceAfter?: number
  bullet?: TextBullet
}

export interface TextParagraph {
  runs: TextRun[]
  attrs?: TextParagraphAttrs
}

export type TextAutofit =
  | { type: 'none' }
  | { type: 'shrink'; minFontScale?: number }
  | { type: 'resize'; maxHeight?: number }

export interface TextBodyProperties {
  insets?: { left: number; top: number; right: number; bottom: number }
  verticalAlign?: 'top' | 'middle' | 'bottom'
  vertical?: 'horizontal' | 'vertical'
  wrap?: 'square' | 'none'
  autofit?: TextAutofit
}

export interface TextBody {
  bodyPr?: TextBodyProperties
  paragraphs: TextParagraph[]
}

export interface ShapeElement {
  id: string
  kind: 'shape'
  preset: PresetGeometry
  bounds: Rect
  rotation?: number
  flipH?: boolean
  flipV?: boolean
  fill?: Fill
  stroke?: Fill
  placeholder?: string
}

export interface TextElement {
  id: string
  kind: 'text'
  bounds: Rect
  rotation?: number
  flipH?: boolean
  flipV?: boolean
  text?: string
  body?: TextBody
  fill?: Fill
  stroke?: Fill
  placeholder?: string
}

export interface TableBorder {
  color: Color
  width?: number
  style?: 'solid' | 'dash' | 'dot' | 'none'
}

export interface TableCellBorders {
  left?: TableBorder
  right?: TableBorder
  top?: TableBorder
  bottom?: TableBorder
}

export type TableStyleRegionName =
  | 'wholeTable'
  | 'band1H'
  | 'band2H'
  | 'band1V'
  | 'band2V'
  | 'firstRow'
  | 'lastRow'
  | 'firstCol'
  | 'lastCol'

export interface TableStyleRegion {
  fill?: Fill
  borders?: TableCellBorders
  text?: TableStyleText
}

export interface TableStyleText {
  color?: Color
  bold?: boolean
  italic?: boolean
}

export interface TableStyle {
  id: string
  regions?: Partial<Record<TableStyleRegionName, TableStyleRegion>>
}

export interface TableStyleReference {
  styleId?: string
  firstRow?: boolean
  lastRow?: boolean
  firstColumn?: boolean
  lastColumn?: boolean
  bandRow?: boolean
  bandColumn?: boolean
}

export interface TableCell {
  column: number
  rowSpan?: number
  colSpan?: number
  body: TextBody
  fill?: Fill
  borders?: TableCellBorders
}

export interface TableRow {
  height: number
  cells: TableCell[]
}

export interface TableElement {
  id: string
  kind: 'table'
  bounds: Rect
  columns: number[]
  rows: TableRow[]
  rotation?: number
  flipH?: boolean
  flipV?: boolean
  fill?: Fill
  stroke?: Fill
  placeholder?: string
  style?: TableStyleReference
}

export interface GroupElement {
  id: string
  kind: 'group'
  bounds: Rect
  childIds: string[]
  rotation?: number
  flipH?: boolean
  flipV?: boolean
  /**
   * OOXML `a:chOff`/`a:chExt`: the coordinate space descendants are authored in. Descendant
   * bounds stay as authored so writeback compares like with like; the scene graph maps this
   * space onto `bounds` when flattening.
   */
  childSpace?: Rect
}

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/bmp' | 'image/webp'

export interface AssetMetadata {
  id: string
  mimeType: ImageMimeType
  pixelWidth?: number
  pixelHeight?: number
  originalFilename?: string
}

export interface AssetAdapter {
  get(assetId: string): Promise<Uint8Array | undefined>
  put(assetId: string, data: Uint8Array, metadata: AssetMetadata): Promise<void>
}

export interface ElementTransform {
  rotation?: number
  flipH?: boolean
  flipV?: boolean
}

export interface ImageCrop {
  left?: number
  top?: number
  right?: number
  bottom?: number
}

export type ImageEffect =
  | { type: 'alphaModFix'; amount: number }
  | { type: 'grayscl' }

export interface ImageElement {
  id: string
  kind: 'image'
  bounds: Rect
  assetId: string
  placeholder?: string
  transform?: ElementTransform
  sourceCrop?: ImageCrop
  maskPreset?: PresetGeometry
  effects?: ImageEffect[]
}

export type Element = ShapeElement | TextElement | TableElement | GroupElement | ImageElement

export interface ElementDefaults {
  bounds?: Rect
  rotation?: number
  preset?: PresetGeometry
  fill?: Fill
  stroke?: Fill
  text?: string
  body?: TextBody
}

export interface SlideLayoutSource {
  partPath: string
}

export interface SlideMasterSource {
  partPath: string
}

export interface SlideLayout {
  id: string
  masterId: string
  defaults?: Record<string, ElementDefaults>
  colorMapOverride?: Partial<ColorMap>
  source?: SlideLayoutSource
}

export interface SlideMaster {
  id: string
  defaults?: Record<string, ElementDefaults>
  themeId?: string
  colorMap?: Partial<ColorMap>
  source?: SlideMasterSource
}

export interface SlideSource {
  originId: string
  partPath: string
  relationshipId: string
  presentationId: string
}

export interface Slide {
  id: string
  elementIds: string[]
  layoutId?: string
  masterId?: string
  colorMapOverride?: Partial<ColorMap>
  source?: SlideSource
}

export interface Ppt4aiDocument {
  format: 'ppt4ai'
  version: 1
  id: string
  page: {
    w: number
    h: number
  }
  slides: Record<string, Slide>
  elements: Record<string, Element>
  assets?: Record<string, AssetMetadata>
  slideOrder: string[]
  tableStyles?: Record<string, TableStyle>
  layouts?: Record<string, SlideLayout>
  masters?: Record<string, SlideMaster>
  themes?: Record<string, Theme>
  source?: {
    entries: Record<string, string>
    packageFingerprint?: string
    modelFingerprint?: string
  }
}

function canonicalJson(value: unknown, root = false, arrayItem = false): string | undefined {
  if (value === undefined) return arrayItem ? 'null' : undefined
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, false, true) ?? 'null').join(',')}]`
  if (typeof value !== 'object') return undefined
  const fields = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !(root && key === 'source'))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .flatMap(([key, item]) => {
      const serialized = canonicalJson(item)
      return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`]
    })
  return `{${fields.join(',')}}`
}

function fnv1a64(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * prime)
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

export function fingerprintBytes(bytes: Uint8Array): string {
  return fnv1a64(bytes)
}

export function fingerprintDocument(document: Ppt4aiDocument): string {
  const serialized = canonicalJson(document, true) ?? '{}'
  return fingerprintBytes(new TextEncoder().encode(serialized))
}

export interface ResolvedTableCellStyle {
  fill?: Fill
  borders: TableCellBorders
  text?: TableStyleText
}

export function mergeColorMaps(...overlays: Array<Partial<ColorMap> | undefined>): ColorMap {
  const result = { ...DEFAULT_COLOR_MAP }
  for (const overlay of overlays) {
    if (overlay) Object.assign(result, overlay)
  }
  return result
}

const presetColors: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
  cyan: '00FFFF', magenta: 'FF00FF', gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080',
}

function parseRgb(value: string): [number, number, number] | undefined {
  if (!/^[0-9a-f]{6}$/i.test(value)) return undefined
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)]
}

function clamp(value: number, min = 0, max = 100000): number {
  return Math.min(max, Math.max(min, value))
}

function toRgb(rgb: [number, number, number]): string {
  return rgb.map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase()
}

function rgbToHsl([red, green, blue]: [number, number, number]): [number, number, number] {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  hue /= 6
  return [hue, saturation, lightness]
}

function hslToRgb([hue, saturation, lightness]: [number, number, number]): [number, number, number] {
  if (saturation === 0) return [lightness * 255, lightness * 255, lightness * 255]
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const channel = (t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255]
}

function resolveColorSource(color: Color, theme: Theme | undefined, colorMap: ColorMap, seen: Set<string>, depth: number): ResolvedColor | undefined {
  if (depth > 16) return undefined
  let rgb: [number, number, number] | undefined
  if (color.type === 'srgb') rgb = parseRgb(color.v)
  else if (color.type === 'system') rgb = parseRgb(color.v)
  else if (color.type === 'preset') rgb = parseRgb(presetColors[color.v.toLowerCase()] ?? '')
  else if (color.type === 'scrgb') {
    const channels = color.v.split(',').map(Number)
    if (channels.length === 3 && channels.every((value) => Number.isFinite(value) && value >= 0 && value <= 100000)) rgb = channels.map((value) => value * 255 / 100000) as [number, number, number]
  } else if (color.type === 'scheme' && color.v !== 'phClr') {
    const slot = colorMap[color.v as ColorMapKey] ?? color.v
    if (seen.has(slot)) return undefined
    const themeSlot = slot as ThemeColorSlot
    const nestedValue = theme?.colors[themeSlot]
    if (nestedValue === undefined) return undefined
    const nested = nestedValue ?? DEFAULT_THEME_COLORS[themeSlot]
    seen.add(slot)
    const resolved = resolveColorSource(nested, theme, colorMap, seen, depth + 1)
    seen.delete(slot)
    if (!resolved) return undefined
    rgb = parseRgb(resolved.rgb)
    if (!rgb) return undefined
    return applyColorTransforms(rgb, resolved.alpha, color.transforms)
  }
  if (!rgb) return undefined
  return applyColorTransforms(rgb, 100000, color.transforms)
}

function applyColorTransforms(rgb: [number, number, number], alpha: number, transforms: ColorTransform[] | undefined): ResolvedColor {
  let currentRgb = [...rgb] as [number, number, number]
  let currentAlpha = alpha
  for (const transform of transforms ?? []) {
    const factor = transform.value / 100000
    if (transform.type === 'tint') currentRgb = currentRgb.map((channel) => channel + (255 - channel) * factor) as [number, number, number]
    else if (transform.type === 'shade') currentRgb = currentRgb.map((channel) => channel * factor) as [number, number, number]
    else if (transform.type === 'lumMod' || transform.type === 'lumOff') {
      const hsl = rgbToHsl(currentRgb)
      hsl[2] = clamp((transform.type === 'lumMod' ? hsl[2] * factor : hsl[2] + factor), 0, 1)
      currentRgb = hslToRgb(hsl)
    } else if (transform.type === 'alpha') currentAlpha = clamp(transform.value)
    else if (transform.type === 'alphaMod') currentAlpha = clamp(currentAlpha * factor)
    else if (transform.type === 'alphaOff') currentAlpha = clamp(currentAlpha + transform.value)
  }
  return { rgb: toRgb(currentRgb), alpha: Math.round(currentAlpha) }
}

export function resolveColor(color: Color, theme?: Theme, colorMap: ColorMap = DEFAULT_COLOR_MAP): ResolvedColor | undefined {
  return resolveColorSource(color, theme, colorMap, new Set<string>(), 0)
}

function elementKey(element: Element): string {
  return element.kind === 'group' ? element.id : element.placeholder ?? element.id
}

function findDefaults(element: Element, layout?: SlideLayout, master?: SlideMaster): ElementDefaults[] {
  const key = elementKey(element)
  const defaults: ElementDefaults[] = []
  const masterDefaults = master?.defaults?.[key]
  const layoutDefaults = layout?.defaults?.[key]
  if (masterDefaults) defaults.push(masterDefaults)
  if (layoutDefaults) defaults.push(layoutDefaults)
  return defaults
}

export function resolveInheritedElement(element: Element, layout?: SlideLayout, master?: SlideMaster): Element {
  const resolved = Object.assign({}, ...findDefaults(element, layout, master), element)
  return {
    ...element,
    ...resolved,
    id: element.id,
    kind: element.kind,
  } as Element
}

function mergeTableStyleRegion(target: ResolvedTableCellStyle, region: TableStyleRegion | undefined): ResolvedTableCellStyle {
  if (!region) return target
  const text = region.text
    ? { ...target.text, ...structuredClone(region.text) }
    : target.text
  return {
    ...(target.fill ? { fill: target.fill } : {}),
    ...(region.fill ? { fill: structuredClone(region.fill) } : {}),
    borders: {
      ...target.borders,
      ...(region.borders ? structuredClone(region.borders) : {}),
    },
    ...(text ? { text } : {}),
  }
}

export function resolveTableCellStyle(
  table: TableElement,
  cell: TableCell,
  row: number,
  column: number,
  tableStyles?: Record<string, TableStyle>,
): ResolvedTableCellStyle {
  const style = table.style?.styleId ? tableStyles?.[table.style.styleId] : undefined
  let resolved: ResolvedTableCellStyle = { borders: {} }
  resolved = mergeTableStyleRegion(resolved, style?.regions?.wholeTable)
  if (table.style?.bandRow) {
    const bandRow = row - (table.style.firstRow ? 1 : 0)
    if (bandRow >= 0) resolved = mergeTableStyleRegion(resolved, style?.regions?.[bandRow % 2 === 0 ? 'band1H' : 'band2H'])
  }
  if (table.style?.bandColumn) {
    const bandColumn = column - (table.style.firstColumn ? 1 : 0)
    if (bandColumn >= 0) resolved = mergeTableStyleRegion(resolved, style?.regions?.[bandColumn % 2 === 0 ? 'band1V' : 'band2V'])
  }
  if (table.style?.firstRow && row === 0) resolved = mergeTableStyleRegion(resolved, style?.regions?.firstRow)
  if (table.style?.lastRow && row === table.rows.length - 1) resolved = mergeTableStyleRegion(resolved, style?.regions?.lastRow)
  if (table.style?.firstColumn && column === 0) resolved = mergeTableStyleRegion(resolved, style?.regions?.firstCol)
  if (table.style?.lastColumn && column === table.columns.length - 1) resolved = mergeTableStyleRegion(resolved, style?.regions?.lastCol)
  if (cell.fill) resolved.fill = structuredClone(cell.fill)
  if (cell.borders) resolved.borders = { ...resolved.borders, ...structuredClone(cell.borders) }
  return resolved
}

export type DocumentValidation =
  | { valid: true }
  | { valid: false; errors: string[] }

export type TextModelValidation =
  | { valid: true }
  | { valid: false; errors: string[] }

const textAlignments = new Set(['left', 'center', 'right'])
const verticalAlignments = new Set(['top', 'middle', 'bottom'])
const writingModes = new Set(['horizontal', 'vertical'])
const wraps = new Set(['square', 'none'])
const underlines = new Set(['none', 'single'])
const bulletSchemes = new Set(['arabic', 'alphaLower', 'alphaUpper'])
const tableBorderStyles = new Set(['solid', 'dash', 'dot', 'none'])
const tableStyleRegions = new Set<TableStyleRegionName>(['wholeTable', 'band1H', 'band2H', 'band1V', 'band2V', 'firstRow', 'lastRow', 'firstCol', 'lastCol'])
const colorTypes = new Set(['srgb', 'scheme', 'preset', 'system', 'scrgb'])
const colorTransformTypes = new Set<ColorTransformType>(['tint', 'shade', 'lumMod', 'lumOff', 'alpha', 'alphaMod', 'alphaOff'])
const themeColorSlots = new Set<ThemeColorSlot>(['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'])
const colorMapKeys = new Set<ColorMapKey>(['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'])
const imageMimeTypes = new Set<ImageMimeType>(['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp'])
const imageEffects = new Set(['alphaModFix', 'grayscl'])

function validateFiniteNumber(value: unknown, path: string, errors: string[], predicate: (value: number) => boolean, message: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || !predicate(value)) errors.push(`${path} ${message}`)
}

function validateDefaultRotations(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  for (const [key, defaultValue] of Object.entries(value as Record<string, unknown>)) {
    if (!defaultValue || typeof defaultValue !== 'object' || Array.isArray(defaultValue)) continue
    const rotation = (defaultValue as Record<string, unknown>).rotation
    if (rotation !== undefined) validateFiniteNumber(rotation, `${path}.${key}.rotation`, errors, Number.isInteger, 'must be an integer')
  }
}

function validateColor(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const color = value as Record<string, unknown>
  if (typeof color.type !== 'string' || !colorTypes.has(color.type)) errors.push(`${path}.type must be a supported color type`)
  if (typeof color.v !== 'string' || color.v.length === 0) errors.push(`${path}.v must be a non-empty string`)
  if ('transforms' in color && color.transforms !== undefined) {
    if (!Array.isArray(color.transforms)) errors.push(`${path}.transforms must be an array`)
    else color.transforms.forEach((transform, index) => {
      const transformPath = `${path}.transforms[${index}]`
      if (!transform || typeof transform !== 'object' || Array.isArray(transform)) {
        errors.push(`${transformPath} must be an object`)
        return
      }
      const transformValue = transform as Record<string, unknown>
      if (typeof transformValue.type !== 'string' || !colorTransformTypes.has(transformValue.type as ColorTransformType)) {
        errors.push(`${transformPath}.type must be a supported color transform type`)
      }
      validateFiniteNumber(transformValue.value, `${transformPath}.value`, errors, (number) => number >= 0 && number <= 100000, 'must be between 0 and 100000')
    })
  }
}

function validateColorMap(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  for (const [key, target] of Object.entries(value)) {
    if (!colorMapKeys.has(key as ColorMapKey)) errors.push(`${path}.${key} is not a supported color-map key`)
    if (typeof target !== 'string' || !themeColorSlots.has(target as ThemeColorSlot)) errors.push(`${path}.${key} must reference a supported theme color slot`)
  }
}

function validateImageAppearance(element: ImageElement, path: string, errors: string[]): void {
  if (element.transform !== undefined) {
    if (!element.transform || typeof element.transform !== 'object' || Array.isArray(element.transform)) {
      errors.push(`${path}.transform must be an object`)
    } else {
      const transform = element.transform as unknown as Record<string, unknown>
      if ('rotation' in transform && transform.rotation !== undefined) {
        validateFiniteNumber(transform.rotation, `${path}.transform.rotation`, errors, Number.isInteger, 'must be an integer')
      }
      if ('flipH' in transform && transform.flipH !== undefined && typeof transform.flipH !== 'boolean') errors.push(`${path}.transform.flipH must be a boolean`)
      if ('flipV' in transform && transform.flipV !== undefined && typeof transform.flipV !== 'boolean') errors.push(`${path}.transform.flipV must be a boolean`)
    }
  }

  if (element.sourceCrop !== undefined) {
    if (!element.sourceCrop || typeof element.sourceCrop !== 'object' || Array.isArray(element.sourceCrop)) {
      errors.push(`${path}.sourceCrop must be an object`)
    } else {
      const crop = element.sourceCrop as unknown as Record<string, unknown>
      for (const side of ['left', 'top', 'right', 'bottom']) {
        const value = crop[side]
        if (value !== undefined) validateFiniteNumber(value, `${path}.sourceCrop.${side}`, errors, (number) => Number.isInteger(number) && number >= 0 && number <= 100000, 'must be between 0 and 100000')
      }
    }
  }

  if (element.maskPreset !== undefined && !new Set<PresetGeometry>(['rect', 'roundRect', 'ellipse', 'triangle']).has(element.maskPreset)) {
    errors.push(`${path}.maskPreset must be a supported image mask preset`)
  }

  if (element.effects !== undefined) {
    if (!Array.isArray(element.effects)) {
      errors.push(`${path}.effects must be an array`)
    } else element.effects.forEach((effect, index) => {
      const effectPath = `${path}.effects[${index}]`
      if (!effect || typeof effect !== 'object' || Array.isArray(effect)) {
        errors.push(`${effectPath} must be an object`)
        return
      }
      const effectValue = effect as unknown as Record<string, unknown>
      if (typeof effectValue.type !== 'string' || !imageEffects.has(effectValue.type)) {
        errors.push(`${effectPath}.type must be a supported image effect type`)
      } else if (effectValue.type === 'alphaModFix') {
        validateFiniteNumber(effectValue.amount, `${effectPath}.amount`, errors, (number) => Number.isInteger(number) && number >= 0 && number <= 100000, 'must be between 0 and 100000')
      }
    })
  }
}

function validateTextMarks(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const marks = value as Record<string, unknown>
  if ('fontFamily' in marks && typeof marks.fontFamily !== 'string') errors.push(`${path}.fontFamily must be a string`)
  if ('fontSize' in marks) validateFiniteNumber(marks.fontSize, `${path}.fontSize`, errors, (number) => number > 0, 'must be positive')
  for (const key of ['bold', 'italic']) {
    if (key in marks && typeof marks[key] !== 'boolean') errors.push(`${path}.${key} must be boolean`)
  }
  if ('underline' in marks && (typeof marks.underline !== 'string' || !underlines.has(marks.underline))) errors.push(`${path}.underline must be none or single`)
  if ('baseline' in marks) validateFiniteNumber(marks.baseline, `${path}.baseline`, errors, () => true, 'must be finite')
}

function validateTextParagraph(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const paragraph = value as Record<string, unknown>
  if (!Array.isArray(paragraph.runs)) {
    errors.push(`${path}.runs must be an array`)
  } else {
    paragraph.runs.forEach((run, index) => {
      const runPath = `${path}.runs[${index}]`
      if (!run || typeof run !== 'object' || Array.isArray(run)) {
        errors.push(`${runPath} must be an object`)
        return
      }
      const runValue = run as Record<string, unknown>
      if (typeof runValue.text !== 'string' || runValue.text.length === 0) errors.push(`${runPath}.text must be non-empty`)
      if ('marks' in runValue && runValue.marks !== undefined) validateTextMarks(runValue.marks, `${runPath}.marks`, errors)
    })
  }
  if (!('attrs' in paragraph) || paragraph.attrs === undefined) return
  if (!paragraph.attrs || typeof paragraph.attrs !== 'object' || Array.isArray(paragraph.attrs)) {
    errors.push(`${path}.attrs must be an object`)
    return
  }
  const attrs = paragraph.attrs as Record<string, unknown>
  if ('align' in attrs && (typeof attrs.align !== 'string' || !textAlignments.has(attrs.align))) errors.push(`${path}.attrs.align must be left, center, or right`)
  if ('level' in attrs) {
    validateFiniteNumber(attrs.level, `${path}.attrs.level`, errors, (number) => number >= 0 && Number.isInteger(number), 'must be non-negative integer')
  }
  // OOXML writes a hanging indent as a negative value against a positive marL, so `indent` is
  // signed while the other three measurements are not.
  if ('indent' in attrs) validateFiniteNumber(attrs.indent, `${path}.attrs.indent`, errors, () => true, 'must be finite')
  for (const key of ['marginLeft', 'spaceBefore', 'spaceAfter']) {
    if (key in attrs) validateFiniteNumber(attrs[key], `${path}.attrs.${key}`, errors, (number) => number >= 0, 'must be non-negative')
  }
  if ('lineSpacing' in attrs) validateFiniteNumber(attrs.lineSpacing, `${path}.attrs.lineSpacing`, errors, (number) => number > 0, 'must be positive')
  if ('bullet' in attrs && attrs.bullet !== undefined) validateTextBullet(attrs.bullet, `${path}.attrs.bullet`, errors)
}

function validateTextBullet(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const bullet = value as Record<string, unknown>
  if (bullet.type === 'char') {
    if (typeof bullet.char !== 'string' || Array.from(bullet.char).length !== 1) errors.push(`${path}.char must contain exactly one Unicode code point`)
    if ('fontFamily' in bullet && (typeof bullet.fontFamily !== 'string' || bullet.fontFamily.length === 0)) errors.push(`${path}.fontFamily must be non-empty`)
    return
  }
  if (bullet.type === 'autoNum') {
    if (typeof bullet.scheme !== 'string' || !bulletSchemes.has(bullet.scheme)) errors.push(`${path}.scheme must be arabic, alphaLower, or alphaUpper`)
    if ('startAt' in bullet && (typeof bullet.startAt !== 'number' || !Number.isFinite(bullet.startAt) || !Number.isInteger(bullet.startAt) || bullet.startAt <= 0)) errors.push(`${path}.startAt must be a positive integer`)
    return
  }
  errors.push(`${path}.type must be char or autoNum`)
}

function validateTableBorder(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const border = value as Record<string, unknown>
  const color = border.color
  if (!color || typeof color !== 'object' || Array.isArray(color)) errors.push(`${path}.color must be an object`)
  else validateColor(color, `${path}.color`, errors)
  if ('width' in border) validateFiniteNumber(border.width, `${path}.width`, errors, (number) => number >= 0, 'must be non-negative')
  if ('style' in border && (typeof border.style !== 'string' || !tableBorderStyles.has(border.style))) errors.push(`${path}.style must be solid, dash, dot, or none`)
}

function validateFill(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const color = (value as Record<string, unknown>).color
  if (!color || typeof color !== 'object' || Array.isArray(color)) {
    errors.push(`${path}.color must be an object`)
    return
  }
  const colorValue = color as Record<string, unknown>
  validateColor(colorValue, `${path}.color`, errors)
}

function validateTableCellBorders(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const borders = value as Record<string, unknown>
  for (const side of ['left', 'right', 'top', 'bottom']) if (side in borders && borders[side] !== undefined) validateTableBorder(borders[side], `${path}.${side}`, errors)
}

function validateTableStyleRegion(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const region = value as Record<string, unknown>
  if ('fill' in region && region.fill !== undefined) validateFill(region.fill, `${path}.fill`, errors)
  if ('borders' in region && region.borders !== undefined) validateTableCellBorders(region.borders, `${path}.borders`, errors)
  if ('text' in region && region.text !== undefined) {
    if (!region.text || typeof region.text !== 'object' || Array.isArray(region.text)) errors.push(`${path}.text must be an object`)
    else {
      const text = region.text as Record<string, unknown>
      if ('color' in text && text.color !== undefined) validateColor(text.color, `${path}.text.color`, errors)
      for (const key of ['bold', 'italic']) if (key in text && text[key] !== undefined && typeof text[key] !== 'boolean') errors.push(`${path}.text.${key} must be a boolean`)
    }
  }
}

function validateTableStyleReference(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const style = value as Record<string, unknown>
  if ('styleId' in style && (typeof style.styleId !== 'string' || style.styleId.length === 0)) errors.push(`${path}.styleId must be a non-empty string`)
  for (const flag of ['firstRow', 'lastRow', 'firstColumn', 'lastColumn', 'bandRow', 'bandColumn']) {
    if (flag in style && typeof style[flag] !== 'boolean') errors.push(`${path}.${flag} must be a boolean`)
  }
  if ('regions' in style && style.regions !== undefined) {
    if (!style.regions || typeof style.regions !== 'object' || Array.isArray(style.regions)) errors.push(`${path}.regions must be an object`)
    else for (const regionName of Object.keys(style.regions)) {
      if (!tableStyleRegions.has(regionName as TableStyleRegionName)) errors.push(`${path}.regions.${regionName} is not a supported table style region`)
    }
  }
}

function validateTableStyle(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const style = value as Record<string, unknown>
  if (typeof style.id !== 'string' || style.id.length === 0) errors.push(`${path}.id must be a non-empty string`)
  if ('regions' in style && style.regions !== undefined) {
    if (!style.regions || typeof style.regions !== 'object' || Array.isArray(style.regions)) errors.push(`${path}.regions must be an object`)
    else for (const [regionName, region] of Object.entries(style.regions)) {
      if (!tableStyleRegions.has(regionName as TableStyleRegionName)) errors.push(`${path}.regions.${regionName} is not a supported table style region`)
      else validateTableStyleRegion(region, `${path}.regions.${regionName}`, errors)
    }
  }
}

function validateTableCell(value: unknown, path: string, rowIndex: number, rowCount: number, columnCount: number, occupied: Map<string, string>, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const cell = value as Record<string, unknown>
  const column = cell.column
  const rowSpan = cell.rowSpan ?? 1
  const colSpan = cell.colSpan ?? 1
  const validColumn = typeof column === 'number' && Number.isInteger(column) && column >= 0
  const validRowSpan = typeof rowSpan === 'number' && Number.isInteger(rowSpan) && rowSpan > 0
  const validColSpan = typeof colSpan === 'number' && Number.isInteger(colSpan) && colSpan > 0
  if (!validColumn) errors.push(`${path}.column must be a non-negative integer`)
  if (!validRowSpan) errors.push(`${path}.rowSpan must be a positive integer`)
  if (!validColSpan) errors.push(`${path}.colSpan must be a positive integer`)
  if (validColumn && validColSpan && column + colSpan > columnCount) errors.push(`${path} exceeds table columns`)
  if (validRowSpan && rowIndex + rowSpan > rowCount) errors.push(`${path} exceeds table rows`)
  if (validColumn && validRowSpan && validColSpan && column + colSpan <= columnCount) {
    for (let row = rowIndex; row < rowIndex + rowSpan; row += 1) {
      for (let gridColumn = column; gridColumn < column + colSpan; gridColumn += 1) {
        const key = `${row}:${gridColumn}`
        const existing = occupied.get(key)
        if (existing) errors.push(`${path} overlaps another cell`)
        else occupied.set(key, path)
      }
    }
  }
  if (!('body' in cell)) errors.push(`${path}.body must be an object`)
  else if (!validateTextBody(cell.body).valid) {
    const result = validateTextBody(cell.body)
    if (!result.valid) for (const error of result.errors) errors.push(`${path}.body.${error}`)
  }
  if ('fill' in cell && cell.fill !== undefined) validateFill(cell.fill, `${path}.fill`, errors)
  if ('borders' in cell && cell.borders !== undefined) {
    validateTableCellBorders(cell.borders, `${path}.borders`, errors)
  }
}

function validateTableElement(value: TableElement, path: string, errors: string[]): void {
  if (value.style !== undefined) validateTableStyleReference(value.style, `${path}.style`, errors)
  if (!Array.isArray(value.columns) || value.columns.length === 0) errors.push(`${path}.columns must be non-empty`)
  else value.columns.forEach((column, index) => validateFiniteNumber(column, `${path}.columns[${index}]`, errors, (number) => number > 0, 'must be positive'))
  if (!Array.isArray(value.rows) || value.rows.length === 0) {
    errors.push(`${path}.rows must be non-empty`)
    return
  }
  const occupied = new Map<string, string>()
  value.rows.forEach((row, rowIndex) => {
    const rowPath = `${path}.rows[${rowIndex}]`
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`${rowPath} must be an object`)
      return
    }
    validateFiniteNumber(row.height, `${rowPath}.height`, errors, (number) => number > 0, 'must be positive')
    if (!Array.isArray(row.cells)) {
      errors.push(`${rowPath}.cells must be an array`)
      return
    }
    row.cells.forEach((cell, cellIndex) => validateTableCell(cell, `${rowPath}.cells[${cellIndex}]`, rowIndex, value.rows.length, value.columns.length, occupied, errors))
  })
}

export function validateTextBody(value: unknown): TextModelValidation {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['body must be an object'] }
  const body = value as Record<string, unknown>
  if (!Array.isArray(body.paragraphs)) errors.push('paragraphs must be an array')
  else {
    if (body.paragraphs.length === 0) errors.push('paragraphs must be non-empty')
    body.paragraphs.forEach((paragraph, index) => validateTextParagraph(paragraph, `paragraphs[${index}]`, errors))
  }
  if ('bodyPr' in body && body.bodyPr !== undefined) {
    if (!body.bodyPr || typeof body.bodyPr !== 'object' || Array.isArray(body.bodyPr)) errors.push('bodyPr must be an object')
    else {
      const bodyPr = body.bodyPr as Record<string, unknown>
      if ('insets' in bodyPr) {
        if (!bodyPr.insets || typeof bodyPr.insets !== 'object' || Array.isArray(bodyPr.insets)) errors.push('bodyPr.insets must be an object')
        else {
          const insets = bodyPr.insets as Record<string, unknown>
          for (const key of ['left', 'top', 'right', 'bottom']) validateFiniteNumber(insets[key], `bodyPr.insets.${key}`, errors, (number) => number >= 0, 'must be non-negative')
        }
      }
      if ('verticalAlign' in bodyPr && (typeof bodyPr.verticalAlign !== 'string' || !verticalAlignments.has(bodyPr.verticalAlign))) errors.push('bodyPr.verticalAlign must be top, middle, or bottom')
      if ('vertical' in bodyPr && (typeof bodyPr.vertical !== 'string' || !writingModes.has(bodyPr.vertical))) errors.push('bodyPr.vertical must be horizontal or vertical')
      if ('wrap' in bodyPr && (typeof bodyPr.wrap !== 'string' || !wraps.has(bodyPr.wrap))) errors.push('bodyPr.wrap must be square or none')
      if ('autofit' in bodyPr) {
        if (!bodyPr.autofit || typeof bodyPr.autofit !== 'object' || Array.isArray(bodyPr.autofit)) errors.push('bodyPr.autofit must be an object')
        else {
          const autofit = bodyPr.autofit as Record<string, unknown>
          if (autofit.type !== 'none' && autofit.type !== 'shrink' && autofit.type !== 'resize') errors.push('bodyPr.autofit.type must be none, shrink, or resize')
          if (autofit.type === 'shrink' && 'minFontScale' in autofit) validateFiniteNumber(autofit.minFontScale, 'bodyPr.autofit.minFontScale', errors, (number) => number >= 1 && number <= 100000, 'must be between 1 and 100000')
          if (autofit.type === 'resize' && 'maxHeight' in autofit) validateFiniteNumber(autofit.maxHeight, 'bodyPr.autofit.maxHeight', errors, (number) => number > 0, 'must be positive')
        }
      }
    }
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}

export function validateDocument(value: Ppt4aiDocument): DocumentValidation {
  const errors: string[] = []

  if (value.format !== 'ppt4ai') errors.push('format must be ppt4ai')
  if (value.version !== 1) errors.push('version must be 1')
  if (!Number.isFinite(value.page.w) || value.page.w <= 0) errors.push('page.w must be positive')
  if (!Number.isFinite(value.page.h) || value.page.h <= 0) errors.push('page.h must be positive')
  if (value.source !== undefined) {
    if (!value.source || typeof value.source !== 'object' || Array.isArray(value.source)) errors.push('source must be an object')
    else {
      if ('packageFingerprint' in value.source && value.source.packageFingerprint !== undefined
        && (typeof value.source.packageFingerprint !== 'string' || value.source.packageFingerprint.length === 0)) {
        errors.push('source.packageFingerprint must be a non-empty string')
      }
      if ('modelFingerprint' in value.source && value.source.modelFingerprint !== undefined
        && (typeof value.source.modelFingerprint !== 'string' || value.source.modelFingerprint.length === 0)) {
        errors.push('source.modelFingerprint must be a non-empty string')
      }
    }
  }

  const slideOrderIds = new Set<string>()
  for (const slideId of value.slideOrder) {
    if (slideOrderIds.has(slideId)) errors.push(`slideOrder references duplicate slide: ${slideId}`)
    slideOrderIds.add(slideId)
    if (!value.slides[slideId]) errors.push(`slideOrder references missing slide: ${slideId}`)
  }

  for (const [slideId, slide] of Object.entries(value.slides)) {
    if (slide.id !== slideId) errors.push(`slide key does not match id: ${slideId}`)
    if (slide.source !== undefined) {
      const source = slide.source as unknown as Record<string, unknown>
      if (!source || typeof source !== 'object' || Array.isArray(source)) errors.push(`slide ${slideId} source must be an object`)
      else {
        for (const field of ['originId', 'partPath', 'relationshipId', 'presentationId']) {
          if (typeof source[field] !== 'string' || source[field].length === 0) errors.push(`slide ${slideId} source.${field} must be a non-empty string`)
        }
      }
    }
    const elementIds = new Set<string>()
    for (const elementId of slide.elementIds) {
      if (elementIds.has(elementId)) errors.push(`slide ${slideId} references duplicate element: ${elementId}`)
      elementIds.add(elementId)
      if (!value.elements[elementId]) errors.push(`slide ${slideId} references missing element: ${elementId}`)
    }
  }

  if (value.assets !== undefined) {
    if (!value.assets || typeof value.assets !== 'object' || Array.isArray(value.assets)) errors.push('assets must be an object')
    else for (const [assetId, assetValue] of Object.entries(value.assets)) {
      const assetPath = `assets.${assetId}`
      if (!assetValue || typeof assetValue !== 'object' || Array.isArray(assetValue)) {
        errors.push(`${assetPath} must be an object`)
        continue
      }
      const asset = assetValue as unknown as Record<string, unknown>
      if (asset.id !== assetId) errors.push(`${assetPath}.id must match asset key`)
      if (!imageMimeTypes.has(asset.mimeType as ImageMimeType)) errors.push(`${assetPath}.mimeType must be a supported image MIME type`)
      if ('pixelWidth' in asset && asset.pixelWidth !== undefined) validateFiniteNumber(asset.pixelWidth, `${assetPath}.pixelWidth`, errors, (number) => number > 0, 'must be positive')
      if ('pixelHeight' in asset && asset.pixelHeight !== undefined) validateFiniteNumber(asset.pixelHeight, `${assetPath}.pixelHeight`, errors, (number) => number > 0, 'must be positive')
      if ('originalFilename' in asset && asset.originalFilename !== undefined && (typeof asset.originalFilename !== 'string' || asset.originalFilename.length === 0)) errors.push(`${assetPath}.originalFilename must be a non-empty string`)
    }
  }

  if (value.tableStyles !== undefined) {
    if (!value.tableStyles || typeof value.tableStyles !== 'object' || Array.isArray(value.tableStyles)) errors.push('tableStyles must be an object')
    else for (const [styleId, style] of Object.entries(value.tableStyles)) validateTableStyle(style, `tableStyles.${styleId}`, errors)
  }

  if (value.themes !== undefined) {
    if (!value.themes || typeof value.themes !== 'object' || Array.isArray(value.themes)) errors.push('themes must be an object')
    else for (const [themeId, themeValue] of Object.entries(value.themes)) {
      const themePath = `themes.${themeId}`
      if (!themeValue || typeof themeValue !== 'object' || Array.isArray(themeValue)) {
        errors.push(`${themePath} must be an object`)
        continue
      }
      const theme = themeValue as unknown as Record<string, unknown>
      if (theme.id !== themeId) errors.push(`theme key does not match id: ${themeId}`)
      if ('source' in theme && theme.source !== undefined) {
        if (!theme.source || typeof theme.source !== 'object' || Array.isArray(theme.source)) errors.push(`${themePath}.source must be an object`)
        else {
          const source = theme.source as Record<string, unknown>
          if (typeof source.partPath !== 'string' || source.partPath.length === 0) errors.push(`${themePath}.source.partPath must be a non-empty string`)
        }
      }
      if (!theme.colors || typeof theme.colors !== 'object' || Array.isArray(theme.colors)) errors.push(`${themePath}.colors must be an object`)
      else for (const [slot, color] of Object.entries(theme.colors)) {
        const colorPath = `${themePath}.colors.${slot}`
        if (!themeColorSlots.has(slot as ThemeColorSlot)) errors.push(`${colorPath} is not a supported theme color slot`)
        if (color !== null) validateColor(color, colorPath, errors)
      }
    }
  }

  if (value.masters !== undefined) {
    if (!value.masters || typeof value.masters !== 'object' || Array.isArray(value.masters)) errors.push('masters must be an object')
    else for (const [masterId, masterValue] of Object.entries(value.masters)) {
      const masterPath = `masters.${masterId}`
      if (!masterValue || typeof masterValue !== 'object' || Array.isArray(masterValue)) {
        errors.push(`${masterPath} must be an object`)
        continue
      }
      const master = masterValue as unknown as Record<string, unknown>
      if (master.id !== masterId) errors.push(`master key does not match id: ${masterId}`)
      if ('source' in master && master.source !== undefined) {
        if (!master.source || typeof master.source !== 'object' || Array.isArray(master.source)) errors.push(`${masterPath}.source must be an object`)
        else {
          const source = master.source as Record<string, unknown>
          if (typeof source.partPath !== 'string' || source.partPath.length === 0) errors.push(`${masterPath}.source.partPath must be a non-empty string`)
        }
      }
      if ('themeId' in master && master.themeId !== undefined && (typeof master.themeId !== 'string' || master.themeId.length === 0)) errors.push(`${masterPath}.themeId must be a non-empty string`)
      if ('colorMap' in master && master.colorMap !== undefined) validateColorMap(master.colorMap, `${masterPath}.colorMap`, errors)
      if ('defaults' in master && master.defaults !== undefined) validateDefaultRotations(master.defaults, `${masterPath}.defaults`, errors)
    }
  }

  if (value.layouts !== undefined) {
    if (!value.layouts || typeof value.layouts !== 'object' || Array.isArray(value.layouts)) errors.push('layouts must be an object')
    else for (const [layoutId, layoutValue] of Object.entries(value.layouts)) {
      const layoutPath = `layouts.${layoutId}`
      if (!layoutValue || typeof layoutValue !== 'object' || Array.isArray(layoutValue)) {
        errors.push(`${layoutPath} must be an object`)
        continue
      }
      const layout = layoutValue as unknown as Record<string, unknown>
      if (layout.id !== layoutId) errors.push(`layout key does not match id: ${layoutId}`)
      if ('source' in layout && layout.source !== undefined) {
        if (!layout.source || typeof layout.source !== 'object' || Array.isArray(layout.source)) errors.push(`${layoutPath}.source must be an object`)
        else {
          const source = layout.source as Record<string, unknown>
          if (typeof source.partPath !== 'string' || source.partPath.length === 0) errors.push(`${layoutPath}.source.partPath must be a non-empty string`)
        }
      }
      if ('colorMapOverride' in layout && layout.colorMapOverride !== undefined) validateColorMap(layout.colorMapOverride, `${layoutPath}.colorMapOverride`, errors)
      if ('defaults' in layout && layout.defaults !== undefined) validateDefaultRotations(layout.defaults, `${layoutPath}.defaults`, errors)
    }
  }

  for (const [slideId, slide] of Object.entries(value.slides)) {
    if (slide.colorMapOverride !== undefined) validateColorMap(slide.colorMapOverride, `slides.${slideId}.colorMapOverride`, errors)
  }

  for (const [elementId, element] of Object.entries(value.elements)) {
    if (element.id !== elementId) errors.push(`element key does not match id: ${elementId}`)
    if (element.bounds.w <= 0 || element.bounds.h <= 0) errors.push(`element ${elementId} bounds must be positive`)
    if (element.kind !== 'image' && element.rotation !== undefined) {
      validateFiniteNumber(element.rotation, `elements.${elementId}.rotation`, errors, Number.isInteger, 'must be an integer')
    }
    if (element.kind !== 'image') {
      for (const axis of ['flipH', 'flipV'] as const) {
        const value = element[axis]
        if (value !== undefined && typeof value !== 'boolean') errors.push(`elements.${elementId}.${axis} must be a boolean`)
      }
    }
    if (element.kind === 'group') {
      if (element.childSpace !== undefined) {
        const space = element.childSpace
        const path = `elements.${elementId}.childSpace`
        validateFiniteNumber(space.x, `${path}.x`, errors, Number.isFinite, 'must be a finite number')
        validateFiniteNumber(space.y, `${path}.y`, errors, Number.isFinite, 'must be a finite number')
        validateFiniteNumber(space.w, `${path}.w`, errors, (value) => value > 0, 'must be positive')
        validateFiniteNumber(space.h, `${path}.h`, errors, (value) => value > 0, 'must be positive')
      }
      const childIds = new Set<string>()
      for (const childId of element.childIds) {
        if (childIds.has(childId)) errors.push(`group ${elementId} references duplicate child: ${childId}`)
        childIds.add(childId)
        if (!value.elements[childId]) errors.push(`group ${elementId} references missing child: ${childId}`)
      }
    } else if (element.kind === 'table') {
      validateTableElement(element, `elements.${elementId}`, errors)
    } else if (element.kind === 'image') {
      if (typeof element.assetId !== 'string' || element.assetId.length === 0) errors.push(`image element ${elementId} assetId must be a non-empty string`)
      else if (!value.assets?.[element.assetId]) errors.push(`image element ${elementId} references missing asset: ${element.assetId}`)
      validateImageAppearance(element, `elements.${elementId}`, errors)
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const path: string[] = []
  const visitGroup = (groupId: string): void => {
    if (visiting.has(groupId)) {
      const cycleStart = path.indexOf(groupId)
      errors.push(`group cycle detected: ${[...path.slice(cycleStart), groupId].join(' -> ')}`)
      return
    }
    if (visited.has(groupId)) return
    const element = value.elements[groupId]
    if (!element || element.kind !== 'group') return
    visiting.add(groupId)
    path.push(groupId)
    for (const childId of element.childIds) {
      const child = value.elements[childId]
      if (child?.kind === 'group') visitGroup(childId)
    }
    path.pop()
    visiting.delete(groupId)
    visited.add(groupId)
  }
  for (const [elementId, element] of Object.entries(value.elements)) {
    if (element.kind === 'group') visitGroup(elementId)
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}
