/**
 * `a:prstGeom/@prst` verbatim. ECMA-376 defines 187 presets whose outlines come from a guide formula
 * table this project cannot verify, so the model records the word and painting draws the four it knows
 * — a `chevron` keeps its name in the file instead of being rewritten as a rectangle. Unknown words
 * paint as a rectangle, which is exactly what they did before the word was preserved.
 */
export type PresetGeometry = string

/**
 * One `a:custGeom` command. `arc` keeps `a:arcTo`'s own shape — radii plus start and swing angles in
 * 60000ths of a degree — because the centre it needs comes from the pen position, which only the path
 * builder knows.
 */
export type CustomGeometryCommand =
  | { type: 'move' | 'line'; x: number; y: number }
  | { type: 'cubic'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'quad'; x1: number; y1: number; x: number; y: number }
  | { type: 'arc'; widthRadius: number; heightRadius: number; startAngle: number; swingAngle: number }
  | { type: 'close' }

export interface CustomGeometryPath {
  /** `a:path/@w`/`@h`: the coordinate space these commands are expressed in. */
  width?: number
  height?: number
  commands: CustomGeometryCommand[]
}

/**
 * `a:custGeom`'s path list, but only when every coordinate is a literal number. A path whose points come
 * from `a:gdLst` formulas is not modeled at all — the formula language is the same unverifiable table the
 * 187 presets need — and the shape falls back to its `preset`, which is what it drew before.
 */
export interface CustomGeometry {
  paths: CustomGeometryPath[]
}

/** The four `prst` words `createPresetPath` has a real outline for. */
export const PAINTED_PRESET_GEOMETRIES: readonly string[] = ['rect', 'roundRect', 'ellipse', 'triangle']

/**
 * The shape of an OOXML enumeration word (`prst`, `buAutoNum/@type`, …). These are enumerations in the
 * schema, and the model's job is to preserve the word rather than to police the enumeration — the lists
 * are long, versioned, and not verifiable here, while a rewritten word damages the user's file.
 */
export function isOoxmlToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9]*$/u.test(value)
}

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

/**
 * A colour transform's element name verbatim (`lumMod`, `satMod`, `comp`, …). The model keeps whatever
 * the file lists so nothing is dropped on the way out; `applyColorTransforms` does the maths for the
 * families it understands and carries the rest through untouched.
 */
export type ColorTransformType = string

/** Percentages bounded 0..100000 by the schema (`ST_PositiveFixedPercentage`). */
const FIXED_PERCENTAGE_TRANSFORMS: readonly string[] = ['tint', 'shade', 'alpha', 'alphaMod', 'alphaOff']

/**
 * The range a transform's value may take, by type. `satMod val="160000"` is Office's own value, so the
 * `*Mod` family cannot be capped at 100000 — capping it is the second reason `satMod` used to vanish.
 */
export function colorTransformValueIsValid(type: string, value: number): boolean {
  if (!Number.isInteger(value)) return false
  if (FIXED_PERCENTAGE_TRANSFORMS.includes(type)) return value >= 0 && value <= 100000
  if (type.endsWith('Mod')) return value >= 0
  return true
}

export interface ColorTransform {
  type: ColorTransformType
  /** Absent for the switch-shaped transforms (`a:comp`, `a:inv`, `a:gray`), which carry no `val`. */
  value?: number
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

export type ThemeFontSlot = 'major' | 'minor'

export type ThemeFontScript = 'latin' | 'ea' | 'cs'

/** A typeface per script. An absent value means the source said nothing usable, `null` means "reset to the built-in default". */
export type ThemeFontFace = Partial<Record<ThemeFontScript, string | null>>

export type ThemeFonts = Partial<Record<ThemeFontSlot, ThemeFontFace>>

/**
 * The Office defaults, and the single source of what a missing or reset slot serializes to.
 * `ea` and `cs` are empty because the stock Office theme leaves them empty, meaning "no override".
 */
export const DEFAULT_THEME_FONTS: Readonly<Record<ThemeFontSlot, Readonly<Record<ThemeFontScript, string>>>> = {
  major: { latin: 'Aptos Display', ea: '', cs: '' },
  minor: { latin: 'Aptos', ea: '', cs: '' },
}

export interface ThemeSource {
  partPath: string
}

/**
 * One entry of `a:fillStyleLst` or `a:bgFillStyleLst`. `null` marks an entry we cannot express — a
 * gradient, pattern or picture fill — so a shape pointing at it stays unfilled rather than being
 * painted an invented approximation.
 */
export type ThemeStyleEntry = Fill | null

/**
 * One `a:ln` of `a:lnStyleLst`: the fill plus the width and dash the entry declares. A structural
 * superset of `Fill`, so every consumer that only reads `color` treats it as one unchanged.
 *
 * Field names follow `TableBorder`'s `{ color, width?, style? }` rather than the element-level
 * `strokeWidth`/`strokeStyle`, so the two line-shaped records read alike.
 */
export interface ThemeLineStyle extends Fill {
  /** `a:ln/@w` in EMU. */
  width?: number
  /** `a:ln/a:prstDash`, narrowed the same way element strokes are. */
  style?: StrokeStyle
  /** `a:ln/@cap`, the same three words an element stroke carries. */
  cap?: StrokeCap
  /** The `a:round`/`a:bevel`/`a:miter` child, as on an element stroke. */
  join?: StrokeJoin
}

export type ThemeLineStyleEntry = ThemeLineStyle | null

/**
 * One `a:effectStyle` of `a:effectStyleLst`, reduced to the one effect that paints. `null` covers both
 * an empty `a:effectLst` — Office's first entry is empty — and effects we cannot express (`a:glow`,
 * `a:reflection`, `a:effectDag`); both resolve to "no shadow", so one value serves for both.
 */
export type ThemeEffectStyleEntry = OuterShadow | null

export interface ThemeFormatScheme {
  fillStyles?: ThemeStyleEntry[]
  lineStyles?: ThemeLineStyleEntry[]
  backgroundStyles?: ThemeStyleEntry[]
  effectStyles?: ThemeEffectStyleEntry[]
}

/**
 * A real Office theme carries exactly three entries in each `fmtScheme` list, and the three line
 * widths below are the ones it ships. These are what standalone export pads a short or missing list
 * with, so `idx="3"` still lands on an entry — the same rule `DEFAULT_THEME_COLORS` and
 * `DEFAULT_THEME_FONTS` already set for unknown colour and font slots.
 *
 * `phClr` is the placeholder the reference substitutes, so a padded entry takes the shape's own
 * colour rather than inventing one.
 */
export const DEFAULT_THEME_STYLE_COUNT = 3

export const DEFAULT_THEME_LINE_WIDTHS: readonly [number, number, number] = [6350, 12700, 19050]

export const DEFAULT_THEME_STYLE_FILL: Fill = { color: { type: 'scheme', v: 'phClr' } }

/**
 * `p:bg`. Either a direct fill from `p:bgPr` or a `p:bgRef` into the theme's `bgFillStyleLst`.
 * OOXML replaces the whole block rather than merging, so a slide either defines its background or
 * inherits its layout's or master's entirely.
 */
export interface SlideBackground {
  fill?: Fill
  styleRef?: StyleReference
  /** `p:bgPr/a:blipFill` — a photo background. Outside `Fill` for the reason `PictureFill` explains. */
  pictureFill?: PictureFill
}

export interface Theme {
  id: string
  colors: Partial<Record<ThemeColorSlot, Color | null>>
  fonts?: ThemeFonts
  formatScheme?: ThemeFormatScheme
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

/** A gradient with every stop colour already resolved through the theme and colour map. */
export interface ResolvedGradient {
  stops: { pos: number; color: ResolvedColor }[]
  angle?: number
  scaled?: boolean
  path?: GradientPath
  fillToRect?: GradientFillToRect
}

/**
 * `a:prstDash/@val` verbatim: all eleven `ST_PresetLineDashVal` tokens, so the exporter writes back
 * the word the file used. Painting groups them into four dash structures (see `dashPattern`) because
 * the spec's exact lengths are not verifiable here, but the model never loses which word it was.
 */
export type StrokeStyle =
  | 'solid'
  | 'dot'
  | 'sysDot'
  | 'dash'
  | 'lgDash'
  | 'sysDash'
  | 'dashDot'
  | 'lgDashDot'
  | 'sysDashDot'
  | 'lgDashDotDot'
  | 'sysDashDotDot'

/** `a:ln/@cap` verbatim, so the exporter writes the model value without a mapping table. */
export type StrokeCap = 'flat' | 'rnd' | 'sq'

/** The `a:ln` corner child element name: `a:round`, `a:bevel` or `a:miter`. */
export type StrokeJoin = 'round' | 'bevel' | 'miter'

/** One `a:gs` of `a:gsLst`: a colour at a position in thousandths of a percent. */
export interface GradientStop {
  /** `a:gs/@pos`, 0..100000. */
  pos: number
  color: Color
}

/** `a:path/a:fillToRect`: the rect a path gradient converges to, as thousandths of a percent inset. */
export interface GradientFillToRect {
  left?: number
  top?: number
  right?: number
  bottom?: number
}

/**
 * A `a:gradFill`. `a:lin` gives `angle`/`scaled`; `a:path` gives `path`/`fillToRect`. OOXML makes them
 * a choice and the model keeps whichever the file had — a hand-built document carrying both paints as
 * the path form, the way a shape carrying both a colour and a picture fill paints the picture. Stops
 * keep document order rather than being sorted by `pos`, because reordering would quietly repair a
 * malformed file instead of surfacing it.
 */
export interface Gradient {
  /** At least two, or the fill is a plain colour instead. */
  stops: GradientStop[]
  /** `a:lin/@ang` in 60000ths of a degree, clockwise from the positive x axis in screen space. */
  angle?: number
  /** `a:lin/@scaled`: the angle is measured in the shape's unit square and stretched to its box. */
  scaled?: boolean
  /** `a:path/@path`. All three paint as a circular gradient; the word survives the round trip. */
  path?: GradientPath
  fillToRect?: GradientFillToRect
}

export type GradientPath = 'circle' | 'rect' | 'shape'

/**
 * `color` stays required and carries the gradient's first stop, so every consumer that reads only
 * `color` keeps working and degrades to a flat approximation rather than painting nothing. That is a
 * real colour from the file, not an invented one.
 */
export interface Fill {
  color: Color
  gradient?: Gradient
}

/**
 * `a:effectLst/a:outerShdw`, narrowed to what a canvas shadow can honour. `@sx`/`@sy` (scale),
 * `@kx`/`@ky` (skew), `@algn` and `@rotWithShape` need the shape drawn again under a matrix, so they
 * stay unexpressed rather than being silently ignored on a shadow we claim to paint.
 */
export interface OuterShadow {
  color: Color
  /** `@blurRad` in EMU. */
  blurRadius?: number
  /** `@dist` in EMU. */
  distance?: number
  /** `@dir` in 60000ths of a degree, clockwise from the positive x axis — `a:lin/@ang`'s unit. */
  direction?: number
}

/** An `OuterShadow` with its colour already resolved through the theme, the way fills are. */
export interface ResolvedShadow {
  color: ResolvedColor
  blurRadius?: number
  distance?: number
  direction?: number
}

/**
 * `a:blipFill` on a shape. It stays outside `Fill` because a blip fill has no colour to put in the
 * required `color` — a gradient could donate its first stop, a picture has nothing — and because
 * `Fill` also types run colours, table cells, backgrounds and theme entries, none of which support a
 * picture. Keeping `fill` absent for a picture-filled shape also means the range writeback compares
 * "no fill" on both sides and leaves the source `a:blipFill` untouched.
 *
 * Only the `a:stretch` form is expressible: `a:tile` needs six more attributes to place its repeats,
 * so a tiled fill stays unmodeled and paints nothing, the same way `a:path` gradients do.
 */
export interface PictureFill {
  /** Key into `Ppt4aiDocument.assets`, the same asset space `ImageElement.assetId` uses. */
  assetId: string
  /** `a:srcRect`: thousandths of a percent trimmed from each side of the source, as on `p:pic`. */
  sourceCrop?: ImageCrop
  /** `a:tile`. Present means the fill repeats; absent means the `a:stretch` form. */
  tile?: PictureTile
  /** `a:stretch/a:fillRect`, which only the stretched form has. */
  stretch?: PictureStretch
  /** `a:blip`'s own effects, the same two `p:pic` models and paints. */
  effects?: ImageEffect[]
}

/**
 * `a:stretch/a:fillRect`: the target box, as thousandths of a percent inset from each side of the shape.
 * The values are **signed** — negative insets push the picture outside the frame, which is how
 * PowerPoint's "fill" crop works — so this is not `ImageCrop`, whose sides are non-negative and describe
 * a trim of the *source* rather than a target box.
 */
export interface PictureStretch {
  left?: number
  top?: number
  right?: number
  bottom?: number
}

/**
 * `a:tile`. The tile's own size is the source's natural size — pixels at 96 dpi — scaled by `sx`/`sy`,
 * which is what makes `createPattern` plus a transform enough to paint it without inventing anything.
 */
export interface PictureTile {
  /** `@tx`/`@ty` in EMU. */
  offsetX?: number
  offsetY?: number
  /** `@sx`/`@sy` in thousandths of a percent of the source's natural size. */
  scaleX?: number
  scaleY?: number
  /** `@algn` verbatim: which corner of the shape box the first tile is anchored to. */
  align?: string
  /** `@flip` verbatim. Painting does not mirror alternate tiles — a repeat pattern cannot. */
  flip?: string
}

export interface TextMarks {
  /** `a:latin`: the Latin-script typeface, and the fallback for every script we do not classify. */
  fontFamily?: string
  /** `a:ea`: the East Asian typeface, chosen per character for CJK and full-width text. */
  fontFamilyEa?: string
  /** `a:cs`: the complex-script typeface. Round-tripped but never selected for painting yet. */
  fontFamilyCs?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  /**
   * `a:rPr/@u` verbatim. `none` is an explicit value — it overrides an inherited underline — and every
   * other word (`sng`, `dbl`, `dotted`, `wavy`, …) is the file's own; painting draws three structures
   * from them (see `text-painting`), which is what keeps `dbl` from being rewritten as `sng`.
   */
  underline?: string
  color?: Fill
  baseline?: number
}

export interface TextRun {
  text: string
  marks?: TextMarks
}

/**
 * `a:buAutoNum/@type` verbatim. The word names its own format (`arabicPeriod` is `1.`, `romanUcParenR`
 * is `I)`), so layout parses it instead of consulting a table; words outside the latin families draw as
 * `arabicPeriod`, which is also OOXML's default type. Keeping the word is what stops an ordinary text
 * edit from rewriting a roman-numeral list as `1.`.
 */
export type TextBulletScheme = string

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
  /** `a:pPr/a:defRPr`: the run defaults for this paragraph, below its runs but above any list style. */
  defaultMarks?: TextMarks
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
  /** `a:custGeom`'s literal path list; when present it replaces `preset` for drawing. */
  customGeometry?: CustomGeometry
  /** An `a:blipFill`, which replaces `fill` rather than layering with it — see `PictureFill`. */
  pictureFill?: PictureFill
  /** `a:effectLst/a:outerShdw`; the only effect modeled so far. */
  shadow?: OuterShadow
  /** `a:ln/@w` in EMU. Absent means the source said nothing, so painting keeps its hairline default. */
  strokeWidth?: number
  /** `a:ln/a:prstDash`, narrowed to what painting can express. */
  strokeStyle?: StrokeStyle
  strokeCap?: StrokeCap
  strokeJoin?: StrokeJoin
  styleRef?: ShapeStyleReference
  placeholder?: string
}

/** `<a:fillRef idx>` and friends: which `fmtScheme` entry to use, and the colour its `phClr` stands for. */
export interface StyleReference {
  idx: number
  color?: Color
}

/**
 * `<p:style>`. `fill` and `line` drive painting; `effect` and `font` are kept only so a complete
 * block can be written back — `CT_ShapeStyle` requires all four.
 */
export interface ShapeStyleReference {
  fill?: StyleReference
  line?: StyleReference
  effect?: StyleReference
  font?: { idx: 'major' | 'minor' | 'none'; color?: Color }
}

export interface TextElement {
  id: string
  kind: 'text'
  bounds: Rect
  rotation?: number
  flipH?: boolean
  flipV?: boolean
  /** A shape that carries text keeps its own geometry here; plain text boxes leave it absent. */
  preset?: PresetGeometry
  text?: string
  body?: TextBody
  fill?: Fill
  stroke?: Fill
  customGeometry?: CustomGeometry
  pictureFill?: PictureFill
  shadow?: OuterShadow
  strokeWidth?: number
  strokeStyle?: StrokeStyle
  strokeCap?: StrokeCap
  strokeJoin?: StrokeJoin
  styleRef?: ShapeStyleReference
  placeholder?: string
}

export interface TableBorder {
  color: Color
  width?: number
  /** The same `a:prstDash` vocabulary element outlines use, plus `none` for an explicit `a:noFill`. */
  style?: StrokeStyle | 'none'
}

export interface TableCellBorders {
  left?: TableBorder
  right?: TableBorder
  top?: TableBorder
  bottom?: TableBorder
  /** `a:lnTlToBr` on a cell, `a:tl2br` in a style: the top-left to bottom-right diagonal. */
  tlToBr?: TableBorder
  /** `a:lnBlToTr` on a cell, `a:tr2bl` in a style: the bottom-left to top-right diagonal. */
  blToTr?: TableBorder
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

/**
 * A style region's borders. `insideH`/`insideV` describe the lines *between* the region's cells, which
 * a cell of its own has no notion of — hence a type separate from `TableCellBorders` rather than two
 * more optional fields a cell could claim.
 */
export interface TableStyleBorders extends TableCellBorders {
  /** `a:insideH`: the interior horizontal line, landing on a cell's top unless it is in the first row. */
  insideH?: TableBorder
  /** `a:insideV`: the interior vertical line, landing on a cell's left unless it is in the first column. */
  insideV?: TableBorder
}

export interface TableStyleRegion {
  fill?: Fill
  borders?: TableStyleBorders
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
  /** `a:tcPr/a:blipFill` — a photo in the cell. Outside `Fill` for the reason `PictureFill` explains. */
  pictureFill?: PictureFill
  /** `a:tcPr/@marL/@marT/@marR/@marB` and `@anchor` — margins and vertical alignment, distinct from the body's own `bodyPr`. */
  cellBodyPr?: TextBodyProperties
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
  listStyle?: LevelDefaults[]
}

/** One entry of an `a:lstStyle` or `p:txStyles` style: the level's own paragraph properties and its `a:defRPr`. */
export interface LevelDefaults {
  level: number
  attrs?: TextParagraphAttrs
  marks?: TextMarks
}

/** The master's `p:txStyles`, dispatched by placeholder type. */
export interface TextStyles {
  title?: LevelDefaults[]
  body?: LevelDefaults[]
  other?: LevelDefaults[]
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
  background?: SlideBackground
  defaults?: Record<string, ElementDefaults>
  colorMapOverride?: Partial<ColorMap>
  source?: SlideLayoutSource
}

export interface SlideMaster {
  id: string
  background?: SlideBackground
  defaults?: Record<string, ElementDefaults>
  themeId?: string
  colorMap?: Partial<ColorMap>
  textStyles?: TextStyles
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
  background?: SlideBackground
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
    // A switch-shaped transform has no value: `a:comp`, `a:inv` and `a:gray` are preserved by the model
    // but not computed (their algorithms are not verifiable here), and dividing `undefined` would turn
    // the whole colour into NaN.
    if (transform.value === undefined) continue
    const factor = transform.value / 100000
    if (transform.type === 'tint') currentRgb = currentRgb.map((channel) => channel + (255 - channel) * factor) as [number, number, number]
    else if (transform.type === 'shade') currentRgb = currentRgb.map((channel) => channel * factor) as [number, number, number]
    else if (transform.type === 'lumMod' || transform.type === 'lumOff') {
      const hsl = rgbToHsl(currentRgb)
      hsl[2] = clamp((transform.type === 'lumMod' ? hsl[2] * factor : hsl[2] + factor), 0, 1)
      currentRgb = hslToRgb(hsl)
    } else if (transform.type === 'satMod' || transform.type === 'satOff') {
      // The direct analogue of the lum pair above, in the same HSL space and with the same clamp.
      const hsl = rgbToHsl(currentRgb)
      hsl[1] = clamp((transform.type === 'satMod' ? hsl[1] * factor : hsl[1] + factor), 0, 1)
      currentRgb = hslToRgb(hsl)
    } else if (transform.type === 'hueMod') {
      // Only the percentage form: `hue` and `hueOff` are angles in the schema, a unit this project
      // could not verify, so they are preserved by the model and left out of the maths.
      const hsl = rgbToHsl(currentRgb)
      hsl[0] = ((hsl[0] * factor) % 360 + 360) % 360
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

/**
 * Substitutes the style entry's `phClr` with the colour the shape's ref supplies. The ref colour's
 * own transforms come first — they settle the base colour — and the entry's follow as modifiers.
 */
function substitutePlaceholderColor(entry: Color, placeholder: Color | undefined): Color | undefined {
  if (entry.type !== 'scheme' || entry.v !== 'phClr') return entry
  if (!placeholder) return undefined
  const transforms = [...(placeholder.transforms ?? []), ...(entry.transforms ?? [])]
  return { type: placeholder.type, v: placeholder.v, ...(transforms.length > 0 ? { transforms } : {}) }
}

/** `idx="0"` is OOXML for "none", and the list is 1-based. Shared so both resolvers count alike. */
function styleEntryAt<T>(reference: StyleReference | undefined, entries: T[] | undefined): T | undefined {
  if (!reference || reference.idx <= 0) return undefined
  return entries?.[reference.idx - 1] ?? undefined
}

function resolveStyleEntry(
  reference: StyleReference | undefined,
  entries: ThemeStyleEntry[] | undefined,
  theme: Theme | undefined,
  colorMap: ColorMap,
): ResolvedColor | undefined {
  const entry = styleEntryAt(reference, entries)
  if (!entry) return undefined
  const color = substitutePlaceholderColor(entry.color, reference?.color)
  return color ? resolveColorSource(color, theme, colorMap, new Set<string>(), 0) : undefined
}

export function resolveStyleFill(reference: StyleReference | undefined, theme?: Theme, colorMap: ColorMap = DEFAULT_COLOR_MAP): ResolvedColor | undefined {
  return resolveStyleEntry(reference, theme?.formatScheme?.fillStyles, theme, colorMap)
}

export function resolveStyleLine(reference: StyleReference | undefined, theme?: Theme, colorMap: ColorMap = DEFAULT_COLOR_MAP): ResolvedColor | undefined {
  return resolveStyleEntry(reference, theme?.formatScheme?.lineStyles, theme, colorMap)
}

/**
 * The gradient of the `a:fillStyleLst` entry a `fillRef` points at, with `phClr` substituted per
 * stop. Substituting only the entry's own `color` would leave every stop unresolved, because a stock
 * Office gradient entry is `phClr` all the way down.
 *
 * Separate from `resolveStyleFill` for the same reason `resolveStyleLineStroke` is separate from
 * `resolveStyleLine`: changing the existing return type would touch every call site.
 */
export function resolveStyleFillGradient(
  reference: StyleReference | undefined,
  theme?: Theme,
  colorMap: ColorMap = DEFAULT_COLOR_MAP,
): ResolvedGradient | undefined {
  const entry = styleEntryAt(reference, theme?.formatScheme?.fillStyles)
  const gradient = entry?.gradient
  if (!gradient) return undefined
  const stops = gradient.stops.flatMap((stop) => {
    const substituted = substitutePlaceholderColor(stop.color, reference?.color)
    const color = substituted ? resolveColorSource(substituted, theme, colorMap, new Set<string>(), 0) : undefined
    return color ? [{ pos: stop.pos, color }] : []
  })
  if (stops.length < 2) return undefined
  return {
    stops,
    ...(gradient.angle === undefined ? {} : { angle: gradient.angle }),
    ...(gradient.scaled === undefined ? {} : { scaled: gradient.scaled }),
    ...(gradient.path === undefined ? {} : { path: gradient.path }),
    ...(gradient.fillToRect === undefined ? {} : { fillToRect: structuredClone(gradient.fillToRect) }),
  }
}

/**
 * The shadow of the `a:effectStyleLst` entry an `effectRef` points at, with `phClr` substituted the
 * same way the gradient entries do it — Office's third entry is `phClr` with an alpha, so skipping the
 * substitution would resolve to no colour and drop the shadow entirely.
 */
export function resolveStyleEffect(
  reference: StyleReference | undefined,
  theme?: Theme,
  colorMap: ColorMap = DEFAULT_COLOR_MAP,
): ResolvedShadow | undefined {
  const entry = styleEntryAt(reference, theme?.formatScheme?.effectStyles)
  if (!entry) return undefined
  const substituted = substitutePlaceholderColor(entry.color, reference?.color)
  const color = substituted ? resolveColorSource(substituted, theme, colorMap, new Set<string>(), 0) : undefined
  if (!color) return undefined
  return {
    color,
    ...(entry.blurRadius === undefined ? {} : { blurRadius: entry.blurRadius }),
    ...(entry.distance === undefined ? {} : { distance: entry.distance }),
    ...(entry.direction === undefined ? {} : { direction: entry.direction }),
  }
}

/**
 * The width and dash of the `a:lnStyleLst` entry a `lnRef` points at. Separate from
 * `resolveStyleLine` because the colour needs `phClr` substitution and the colour map, while these
 * two need only the index. A `null` entry yields nothing rather than an invented width.
 */
export function resolveStyleLineStroke(
  reference: StyleReference | undefined,
  theme?: Theme,
): { width?: number; style?: StrokeStyle; cap?: StrokeCap; join?: StrokeJoin } | undefined {
  const entry = styleEntryAt(reference, theme?.formatScheme?.lineStyles)
  if (!entry) return undefined
  const stroke = {
    ...(entry.width === undefined ? {} : { width: entry.width }),
    ...(entry.style === undefined ? {} : { style: entry.style }),
    ...(entry.cap === undefined ? {} : { cap: entry.cap }),
    ...(entry.join === undefined ? {} : { join: entry.join }),
  }
  return Object.keys(stroke).length > 0 ? stroke : undefined
}

/**
 * `p:bg` replaces rather than merges, so the nearest of slide, layout and master wins whole.
 *
 * `ST_BackgroundStyleIndex` counts from 1001 for the first `bgFillStyleLst` entry, where `fillRef`
 * counts from 1 — the model keeps the file's own number, so the offset is undone here.
 */
export function resolveSlideBackground(
  slide: Slide | undefined,
  layout?: SlideLayout,
  master?: SlideMaster,
  theme?: Theme,
  colorMap: ColorMap = DEFAULT_COLOR_MAP,
): ResolvedColor | undefined {
  const background = slide?.background ?? layout?.background ?? master?.background
  if (!background) return undefined
  if (background.fill) return resolveColorSource(background.fill.color, theme, colorMap, new Set<string>(), 0)
  const reference = background.styleRef
  if (!reference || reference.idx < 1001) return undefined
  return resolveStyleEntry({ ...reference, idx: reference.idx - 1000 }, theme?.formatScheme?.backgroundStyles, theme, colorMap)
}

const themeFontReferences: Readonly<Record<string, { slot: ThemeFontSlot; script: ThemeFontScript }>> = {
  '+mj-lt': { slot: 'major', script: 'latin' },
  '+mj-ea': { slot: 'major', script: 'ea' },
  '+mj-cs': { slot: 'major', script: 'cs' },
  '+mn-lt': { slot: 'minor', script: 'latin' },
  '+mn-ea': { slot: 'minor', script: 'ea' },
  '+mn-cs': { slot: 'minor', script: 'cs' },
}

/**
 * Turns a `typeface` value into a family a font stack can use. Anything that is not one of the six
 * theme references comes back untouched; a reference falls back to `DEFAULT_THEME_FONTS`, which is
 * also what the exporter writes, so canvas and file cannot disagree. There is no font counterpart
 * to `p:clrMap`, so unlike `resolveColor` this takes no map. An empty effective typeface — the
 * stock `ea`/`cs` case — resolves to nothing rather than to an unusable empty family.
 */
export function resolveThemeFontFamily(family: string | undefined, theme?: Theme): string | undefined {
  if (family === undefined) return undefined
  const reference = themeFontReferences[family.trim().toLowerCase()]
  if (!reference) return family
  const effective = theme?.fonts?.[reference.slot]?.[reference.script] ?? DEFAULT_THEME_FONTS[reference.slot][reference.script]
  return effective.length > 0 ? effective : undefined
}

/**
 * The text colour a `<p:style><a:fontRef>` supplies for the shape's runs. It is the lowest priority
 * source — below a run's own colour and below the level defaults — because it is a shape-level entry
 * in the style matrix, not a declaration on the text.
 *
 * Unlike `fillRef`/`lnRef` this needs no list lookup: the colour sits on the reference itself, and
 * `idx` selects a font collection rather than a `fmtScheme` entry.
 */
export function resolveStyleFontColor(
  reference: ShapeStyleReference['font'] | undefined,
  theme?: Theme,
  colorMap: ColorMap = DEFAULT_COLOR_MAP,
): ResolvedColor | undefined {
  if (!reference?.color) return undefined
  return resolveColorSource(reference.color, theme, colorMap, new Set<string>(), 0)
}

/**
 * The typeface a `<p:style><a:fontRef idx>` selects. `major`/`minor` resolve through the same table
 * `+mj-lt`-style references use, so there is one mapping from a font collection to a family.
 * `none` yields nothing rather than a guess.
 */
export function resolveStyleFontFamily(
  reference: ShapeStyleReference['font'] | undefined,
  theme?: Theme,
): string | undefined {
  if (!reference || reference.idx === 'none') return undefined
  return resolveThemeFontFamily(reference.idx === 'major' ? '+mj-lt' : '+mn-lt', theme)
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

/** `title`/`ctrTitle` take `p:titleStyle`, body-like placeholders take `p:bodyStyle`, everything else `p:otherStyle`. */
function textStyleFor(styles: TextStyles | undefined, placeholder: string | undefined): LevelDefaults[] | undefined {
  if (!styles) return undefined
  const type = placeholder?.split(':')[0]
  if (type === 'title' || type === 'ctrTitle') return styles.title
  if (type === 'body' || type === 'subTitle' || type === 'obj') return styles.body
  return styles.other
}

function levelEntry(levels: LevelDefaults[] | undefined, level: number): LevelDefaults | undefined {
  return levels?.find((entry) => entry.level === level)
}

function mergeLevelChain(chain: ReadonlyArray<LevelDefaults[] | undefined>, level: number): LevelDefaults {
  const merged: LevelDefaults = { level }
  for (const levels of chain) {
    const entry = levelEntry(levels, level)
    if (!entry) continue
    if (entry.attrs) merged.attrs = { ...merged.attrs, ...structuredClone(entry.attrs) }
    if (entry.marks) merged.marks = { ...merged.marks, ...structuredClone(entry.marks) }
  }
  return merged
}

/**
 * Fills in what the three default layers say, lowest first: the master's `p:txStyles` for this
 * placeholder type, then the master and layout placeholders' `a:lstStyle`, then the paragraph's own
 * `a:pPr`/`a:defRPr`, and finally each run's own marks. Unlike `resolveInheritedElement`, which
 * overrides whole fields, this merges property by property — that is what makes a run inherit a
 * size from the master while keeping its own colour.
 *
 * Takes the element as it comes out of `resolveInheritedElement`; returns undefined for elements
 * that carry no text body.
 */
export function resolveTextBodyDefaults(element: Element, layout?: SlideLayout, master?: SlideMaster): TextBody | undefined {
  const body = element.kind === 'text' ? element.body : undefined
  if (!body) return undefined
  const placeholder = element.kind === 'group' ? undefined : element.placeholder
  const chain: Array<LevelDefaults[] | undefined> = [
    textStyleFor(master?.textStyles, placeholder),
    ...findDefaults(element, layout, master).map((defaults) => defaults.listStyle),
  ]

  return {
    ...body,
    paragraphs: body.paragraphs.map((paragraph) => {
      const defaults = mergeLevelChain(chain, paragraph.attrs?.level ?? 0)
      const attrs = { ...defaults.attrs, ...paragraph.attrs }
      const runDefaults = { ...defaults.marks, ...paragraph.attrs?.defaultMarks }
      return {
        ...paragraph,
        ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
        runs: paragraph.runs.map((run) => {
          const marks = { ...runDefaults, ...run.marks }
          return Object.keys(marks).length > 0 ? { ...run, marks } : { ...run }
        }),
      }
    }),
  }
}

/** Where a cell sits in the grid, which is what decides whether an interior line reaches its edges. */
interface CellPosition {
  firstRow: boolean
  lastRow: boolean
  firstColumn: boolean
  lastColumn: boolean
}

/**
 * A region's borders as the four sides this cell actually has. An interior line wins on an interior
 * edge, because a region's `bottom` meaning "every cell's bottom" would leave `insideH` with nothing to
 * describe. A region stating neither resolves exactly as it did before the two were modeled.
 */
function regionBordersForCell(borders: TableStyleBorders | undefined, position: CellPosition): TableCellBorders {
  if (!borders) return {}
  const sides: TableCellBorders = {
    ...(borders.left ? { left: structuredClone(borders.left) } : {}),
    ...(borders.right ? { right: structuredClone(borders.right) } : {}),
    ...(borders.top ? { top: structuredClone(borders.top) } : {}),
    ...(borders.bottom ? { bottom: structuredClone(borders.bottom) } : {}),
    // A diagonal describes the cell itself, so every cell in the region gets it — no position dispatch.
    ...(borders.tlToBr ? { tlToBr: structuredClone(borders.tlToBr) } : {}),
    ...(borders.blToTr ? { blToTr: structuredClone(borders.blToTr) } : {}),
  }
  if (borders.insideH) {
    if (!position.firstRow) sides.top = structuredClone(borders.insideH)
    if (!position.lastRow) sides.bottom = structuredClone(borders.insideH)
  }
  if (borders.insideV) {
    if (!position.firstColumn) sides.left = structuredClone(borders.insideV)
    if (!position.lastColumn) sides.right = structuredClone(borders.insideV)
  }
  return sides
}

function mergeTableStyleRegion(target: ResolvedTableCellStyle, region: TableStyleRegion | undefined, position: CellPosition): ResolvedTableCellStyle {
  if (!region) return target
  const text = region.text
    ? { ...target.text, ...structuredClone(region.text) }
    : target.text
  return {
    ...(target.fill ? { fill: target.fill } : {}),
    ...(region.fill ? { fill: structuredClone(region.fill) } : {}),
    borders: {
      ...target.borders,
      ...regionBordersForCell(region.borders, position),
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
  const position: CellPosition = {
    firstRow: row === 0,
    lastRow: row === table.rows.length - 1,
    firstColumn: column === 0,
    lastColumn: column === table.columns.length - 1,
  }
  let resolved: ResolvedTableCellStyle = { borders: {} }
  resolved = mergeTableStyleRegion(resolved, style?.regions?.wholeTable, position)
  if (table.style?.bandRow) {
    const bandRow = row - (table.style.firstRow ? 1 : 0)
    if (bandRow >= 0) resolved = mergeTableStyleRegion(resolved, style?.regions?.[bandRow % 2 === 0 ? 'band1H' : 'band2H'], position)
  }
  if (table.style?.bandColumn) {
    const bandColumn = column - (table.style.firstColumn ? 1 : 0)
    if (bandColumn >= 0) resolved = mergeTableStyleRegion(resolved, style?.regions?.[bandColumn % 2 === 0 ? 'band1V' : 'band2V'], position)
  }
  if (table.style?.firstRow && row === 0) resolved = mergeTableStyleRegion(resolved, style?.regions?.firstRow, position)
  if (table.style?.lastRow && row === table.rows.length - 1) resolved = mergeTableStyleRegion(resolved, style?.regions?.lastRow, position)
  if (table.style?.firstColumn && column === 0) resolved = mergeTableStyleRegion(resolved, style?.regions?.firstCol, position)
  if (table.style?.lastColumn && column === table.columns.length - 1) resolved = mergeTableStyleRegion(resolved, style?.regions?.lastCol, position)
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
const tableStyleRegions = new Set<TableStyleRegionName>(['wholeTable', 'band1H', 'band2H', 'band1V', 'band2V', 'firstRow', 'lastRow', 'firstCol', 'lastCol'])
const colorTypes = new Set(['srgb', 'scheme', 'preset', 'system', 'scrgb'])
const strokeStyles = new Set<StrokeStyle>(['solid', 'dot', 'sysDot', 'dash', 'lgDash', 'sysDash', 'dashDot', 'lgDashDot', 'sysDashDot', 'lgDashDotDot', 'sysDashDotDot'])
/** A table border adds `none` (an explicit `a:noFill`) to the same vocabulary. */
const tableBorderStyles = new Set<string>([...strokeStyles, 'none'])
const strokeCaps = new Set<StrokeCap>(['flat', 'rnd', 'sq'])
const strokeJoins = new Set<StrokeJoin>(['round', 'bevel', 'miter'])
const fontCollectionIndexes = new Set(['major', 'minor', 'none'])
const themeColorSlots = new Set<ThemeColorSlot>(['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'])
const themeFontSlots = new Set<ThemeFontSlot>(['major', 'minor'])
const themeFontScripts = new Set<ThemeFontScript>(['latin', 'ea', 'cs'])
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
    const def = defaultValue as Record<string, unknown>
    const rotation = def.rotation
    if (rotation !== undefined) validateFiniteNumber(rotation, `${path}.${key}.rotation`, errors, Number.isInteger, 'must be an integer')
    if ('listStyle' in def && def.listStyle !== undefined) validateLevelDefaults(def.listStyle, `${path}.${key}.listStyle`, errors)
  }
}

function validateLevelDefaults(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`)
    return
  }
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${entryPath} must be an object`)
      return
    }
    const level = (entry as Record<string, unknown>).level
    validateFiniteNumber(level, `${entryPath}.level`, errors, (n) => Number.isInteger(n) && n >= 0 && n <= 8, 'must be 0-8')
    const attrs = (entry as Record<string, unknown>).attrs
    if (attrs !== undefined) validateTextParagraphAttrs(attrs, `${entryPath}.attrs`, errors)
    const marks = (entry as Record<string, unknown>).marks
    if (marks !== undefined) validateTextMarks(marks, `${entryPath}.marks`, errors)
  })
}

function validateTextStyles(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const styles = value as Record<string, unknown>
  if ('title' in styles && styles.title !== undefined) validateLevelDefaults(styles.title, `${path}.title`, errors)
  if ('body' in styles && styles.body !== undefined) validateLevelDefaults(styles.body, `${path}.body`, errors)
  if ('other' in styles && styles.other !== undefined) validateLevelDefaults(styles.other, `${path}.other`, errors)
}

function validateColor(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const color = value as Record<string, unknown>
  if (typeof color.type !== 'string' || !colorTypes.has(color.type)) errors.push(`${path}.type must be a supported color type`)
  if (typeof color.v !== 'string' || color.v.length === 0) errors.push(`${path}.v must be a non-empty string`)
  // `srgb` and `system` carry a literal hex triplet, and painting throws on anything else. Commands
  // can now set an element's paint directly, so a loose value here would reach the canvas.
  else if ((color.type === 'srgb' || color.type === 'system') && !/^[0-9A-Fa-f]{6}$/u.test(color.v)) {
    errors.push(`${path}.v must be six hexadecimal digits`)
  }
  if ('transforms' in color && color.transforms !== undefined) {
    if (!Array.isArray(color.transforms)) errors.push(`${path}.transforms must be an array`)
    else color.transforms.forEach((transform, index) => {
      const transformPath = `${path}.transforms[${index}]`
      if (!transform || typeof transform !== 'object' || Array.isArray(transform)) {
        errors.push(`${transformPath} must be an object`)
        return
      }
      const transformValue = transform as Record<string, unknown>
      if (!isOoxmlToken(transformValue.type)) {
        errors.push(`${transformPath}.type must be a color transform token`)
      }
      const type = typeof transformValue.type === 'string' ? transformValue.type : ''
      if (transformValue.value !== undefined) {
        validateFiniteNumber(transformValue.value, `${transformPath}.value`, errors, (number) => colorTransformValueIsValid(type, number), 'must be an integer within its transform range')
      }
    })
  }
}

function validateThemeFonts(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  for (const [slot, face] of Object.entries(value as Record<string, unknown>)) {
    const facePath = `${path}.${slot}`
    if (!themeFontSlots.has(slot as ThemeFontSlot)) errors.push(`${facePath} is not a supported theme font slot`)
    if (!face || typeof face !== 'object' || Array.isArray(face)) {
      errors.push(`${facePath} must be an object`)
      continue
    }
    for (const [script, typeface] of Object.entries(face as Record<string, unknown>)) {
      const typefacePath = `${facePath}.${script}`
      if (!themeFontScripts.has(script as ThemeFontScript)) errors.push(`${typefacePath} is not a supported theme font script`)
      if (typeface !== null && (typeof typeface !== 'string' || typeface.length === 0)) errors.push(`${typefacePath} must be a non-empty string or null`)
    }
  }
}

function validateThemeStyleEntries(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`)
    return
  }
  value.forEach((entry, index) => {
    if (entry !== null) validateFill(entry, `${path}[${index}]`, errors)
  })
}

/** `null` is the modeled "nothing paintable here", so only real entries go through the shadow rules. */
function validateThemeEffectStyleEntries(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`)
    return
  }
  value.forEach((entry, index) => {
    if (entry !== null) validateOuterShadow(entry as OuterShadow, `${path}[${index}]`, errors)
  })
}

/** A line entry is a `Fill` plus the two optional siblings, so the fill rules apply first. */
function validateThemeLineStyleEntries(value: unknown, path: string, errors: string[]): void {
  validateThemeStyleEntries(value, path, errors)
  if (!Array.isArray(value)) return
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
    const line = entry as Record<string, unknown>
    const entryPath = `${path}[${index}]`
    if (line.width !== undefined) {
      validateFiniteNumber(line.width, `${entryPath}.width`, errors, (number) => Number.isInteger(number) && number >= 0, 'must be a non-negative integer')
    }
    if (line.style !== undefined && !strokeStyles.has(line.style as StrokeStyle)) {
      errors.push(`${entryPath}.style must be a supported preset dash token`)
    }
    if (line.cap !== undefined && !strokeCaps.has(line.cap as StrokeCap)) {
      errors.push(`${entryPath}.cap must be a supported cap token`)
    }
    if (line.join !== undefined && !strokeJoins.has(line.join as StrokeJoin)) {
      errors.push(`${entryPath}.join must be a supported join token`)
    }
  })
}

function validateStyleReference(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const reference = value as Record<string, unknown>
  validateFiniteNumber(reference.idx, `${path}.idx`, errors, (number) => Number.isInteger(number) && number >= 0, 'must be a non-negative integer')
  if (reference.color !== undefined) validateColor(reference.color, `${path}.color`, errors)
}

function validateShapeStyleReference(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const styleRef = value as Record<string, unknown>
  for (const key of ['fill', 'line', 'effect'] as const) {
    if (styleRef[key] !== undefined) validateStyleReference(styleRef[key], `${path}.${key}`, errors)
  }
  if (styleRef.font === undefined) return
  if (!styleRef.font || typeof styleRef.font !== 'object' || Array.isArray(styleRef.font)) {
    errors.push(`${path}.font must be an object`)
    return
  }
  const font = styleRef.font as Record<string, unknown>
  if (typeof font.idx !== 'string' || !fontCollectionIndexes.has(font.idx)) errors.push(`${path}.font.idx must be major, minor, or none`)
  if (font.color !== undefined) validateColor(font.color, `${path}.font.color`, errors)
}

function validateSlideBackground(value: unknown, path: string, errors: string[], assets?: Ppt4aiDocument['assets']): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const background = value as Record<string, unknown>
  if (background.fill !== undefined) validateFill(background.fill, `${path}.fill`, errors)
  if (background.styleRef !== undefined) validateStyleReference(background.styleRef, `${path}.styleRef`, errors)
  if (background.pictureFill !== undefined) validatePictureFill(background.pictureFill as PictureFill, `${path}.pictureFill`, assets, errors)
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

/**
 * A shadow with no colour is not paintable, and the three measurements follow the same integer rules
 * their OOXML attributes do: EMU lengths are non-negative, the direction is a signed 1/60000 degree.
 */
function validateOuterShadow(value: OuterShadow, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  validateColor((value as unknown as Record<string, unknown>).color, `${path}.color`, errors)
  for (const field of ['blurRadius', 'distance'] as const) {
    if (value[field] !== undefined) {
      validateFiniteNumber(value[field], `${path}.${field}`, errors, (number) => Number.isInteger(number) && number >= 0, 'must be a non-negative integer')
    }
  }
  if (value.direction !== undefined) {
    validateFiniteNumber(value.direction, `${path}.direction`, errors, Number.isInteger, 'must be an integer')
  }
}

/**
 * `a:tile`'s numbers. The offsets are signed EMU (a tile grid can start outside the box) while the
 * scales are non-negative percentages; `align` and `flip` are OOXML words the model only preserves.
 */
function validatePictureTile(value: PictureTile, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  for (const field of ['offsetX', 'offsetY'] as const) {
    if (value[field] !== undefined) validateFiniteNumber(value[field], `${path}.${field}`, errors, Number.isInteger, 'must be an integer')
  }
  for (const field of ['scaleX', 'scaleY'] as const) {
    if (value[field] !== undefined) {
      validateFiniteNumber(value[field], `${path}.${field}`, errors, (number) => Number.isInteger(number) && number >= 0, 'must be a non-negative integer')
    }
  }
  for (const field of ['align', 'flip'] as const) {
    if (value[field] !== undefined && !isOoxmlToken(value[field])) errors.push(`${path}.${field} must be a token`)
  }
}

const customGeometryCommandFields: Readonly<Record<string, readonly string[]>> = {
  move: ['x', 'y'],
  line: ['x', 'y'],
  cubic: ['x1', 'y1', 'x2', 'y2', 'x', 'y'],
  quad: ['x1', 'y1', 'x', 'y'],
  arc: ['widthRadius', 'heightRadius', 'startAngle', 'swingAngle'],
  close: [],
}

/** Every coordinate is a finite number by construction — the importer only models literal paths. */
function validateCustomGeometry(value: CustomGeometry, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.paths)) {
    errors.push(`${path}.paths must be an array`)
    return
  }
  value.paths.forEach((subPath, pathIndex) => {
    const subPathPath = `${path}.paths[${pathIndex}]`
    if (!subPath || typeof subPath !== 'object' || Array.isArray(subPath) || !Array.isArray(subPath.commands)) {
      errors.push(`${subPathPath}.commands must be an array`)
      return
    }
    for (const field of ['width', 'height'] as const) {
      if (subPath[field] !== undefined) {
        validateFiniteNumber(subPath[field], `${subPathPath}.${field}`, errors, (number) => number > 0, 'must be positive')
      }
    }
    subPath.commands.forEach((command, index) => {
      const commandPath = `${subPathPath}.commands[${index}]`
      const fields = command && typeof command === 'object' ? customGeometryCommandFields[(command as { type?: string }).type ?? ''] : undefined
      if (!fields) {
        errors.push(`${commandPath}.type must be a supported path command`)
        return
      }
      const values = command as unknown as Record<string, unknown>
      for (const field of fields) {
        validateFiniteNumber(values[field], `${commandPath}.${field}`, errors, Number.isFinite, 'must be a finite number')
      }
    })
  })
}

/** Shared by shapes, text and slide backgrounds: one asset reference, one crop, one tile, one effect list. */
function validatePictureFill(
  value: PictureFill,
  path: string,
  assets: Ppt4aiDocument['assets'],
  errors: string[],
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const assetId = value.assetId
  if (typeof assetId !== 'string' || assetId.length === 0) errors.push(`${path}.assetId must be a non-empty string`)
  else if (!assets?.[assetId]) errors.push(`${path} references missing asset: ${assetId}`)
  if (value.sourceCrop !== undefined) validateImageCrop(value.sourceCrop, `${path}.sourceCrop`, errors)
  if (value.tile !== undefined) validatePictureTile(value.tile, `${path}.tile`, errors)
  if (value.stretch !== undefined) {
    const stretch = value.stretch as unknown as Record<string, unknown>
    if (!value.stretch || typeof value.stretch !== 'object' || Array.isArray(value.stretch)) {
      errors.push(`${path}.stretch must be an object`)
    } else for (const side of ['left', 'top', 'right', 'bottom']) {
      // Signed: `a:fillRect` uses negatives to outset, unlike `a:srcRect`.
      if (stretch[side] !== undefined) validateFiniteNumber(stretch[side], `${path}.stretch.${side}`, errors, Number.isInteger, 'must be an integer')
    }
  }
  if (value.effects !== undefined) validateImageEffects(value.effects, `${path}.effects`, errors)
}

/** `a:srcRect` sides, shared by `ImageElement.sourceCrop` and `PictureFill.sourceCrop`. */
function validateImageCrop(value: ImageCrop, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const crop = value as unknown as Record<string, unknown>
  for (const side of ['left', 'top', 'right', 'bottom']) {
    const number = crop[side]
    if (number !== undefined) validateFiniteNumber(number, `${path}.${side}`, errors, (candidate) => Number.isInteger(candidate) && candidate >= 0 && candidate <= 100000, 'must be between 0 and 100000')
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

  if (element.sourceCrop !== undefined) validateImageCrop(element.sourceCrop, `${path}.sourceCrop`, errors)

  if (element.maskPreset !== undefined && !isOoxmlToken(element.maskPreset)) {
    errors.push(`${path}.maskPreset must be a preset geometry token`)
  }

  if (element.effects !== undefined) validateImageEffects(element.effects, `${path}.effects`, errors)
}

/** Shared by `ImageElement.effects` and `PictureFill.effects`: the same two effects, the same rules. */
function validateImageEffects(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`)
    return
  }
  value.forEach((effect, index) => {
    const effectPath = `${path}[${index}]`
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

function validateTextMarks(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const marks = value as Record<string, unknown>
  if ('fontFamily' in marks && typeof marks.fontFamily !== 'string') errors.push(`${path}.fontFamily must be a string`)
  for (const key of ['fontFamilyEa', 'fontFamilyCs']) {
    if (key in marks && (typeof marks[key] !== 'string' || (marks[key] as string).length === 0)) errors.push(`${path}.${key} must be a non-empty string`)
  }
  if ('fontSize' in marks) validateFiniteNumber(marks.fontSize, `${path}.fontSize`, errors, (number) => number > 0, 'must be positive')
  for (const key of ['bold', 'italic']) {
    if (key in marks && typeof marks[key] !== 'boolean') errors.push(`${path}.${key} must be boolean`)
  }
  if ('underline' in marks && !isOoxmlToken(marks.underline)) errors.push(`${path}.underline must be an underline token`)
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
  validateTextParagraphAttrs(paragraph.attrs, `${path}.attrs`, errors)
}

function validateTextParagraphAttrs(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const attrs = value as Record<string, unknown>
  if ('align' in attrs && (typeof attrs.align !== 'string' || !textAlignments.has(attrs.align))) errors.push(`${path}.align must be left, center, or right`)
  if ('level' in attrs) {
    validateFiniteNumber(attrs.level, `${path}.level`, errors, (number) => number >= 0 && Number.isInteger(number), 'must be non-negative integer')
  }
  // OOXML writes a hanging indent as a negative value against a positive marL, so `indent` is
  // signed while the other three measurements are not.
  if ('indent' in attrs) validateFiniteNumber(attrs.indent, `${path}.indent`, errors, () => true, 'must be finite')
  for (const key of ['marginLeft', 'spaceBefore', 'spaceAfter']) {
    if (key in attrs) validateFiniteNumber(attrs[key], `${path}.${key}`, errors, (number) => number >= 0, 'must be non-negative')
  }
  if ('lineSpacing' in attrs) validateFiniteNumber(attrs.lineSpacing, `${path}.lineSpacing`, errors, (number) => number > 0, 'must be positive')
  if ('bullet' in attrs && attrs.bullet !== undefined) validateTextBullet(attrs.bullet, `${path}.bullet`, errors)
  if ('defaultMarks' in attrs && attrs.defaultMarks !== undefined) validateTextMarks(attrs.defaultMarks, `${path}.defaultMarks`, errors)
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
    if (!isOoxmlToken(bullet.scheme)) errors.push(`${path}.scheme must be an auto-number token`)
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
  if ('style' in border && (typeof border.style !== 'string' || !tableBorderStyles.has(border.style))) errors.push(`${path}.style must be a supported preset dash token or none`)
}

const gradientPaths = new Set<GradientPath>(['circle', 'rect', 'shape'])

function validateGradient(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const gradient = value as Record<string, unknown>
  if (!Array.isArray(gradient.stops)) {
    errors.push(`${path}.stops must be an array`)
    return
  }
  // Fewer than two stops is a plain colour, so the gradient form is not the way to express it.
  if (gradient.stops.length < 2) errors.push(`${path}.stops must have at least two entries`)
  gradient.stops.forEach((stop, index) => {
    const stopPath = `${path}.stops[${index}]`
    if (!stop || typeof stop !== 'object' || Array.isArray(stop)) {
      errors.push(`${stopPath} must be an object`)
      return
    }
    const entry = stop as Record<string, unknown>
    validateFiniteNumber(entry.pos, `${stopPath}.pos`, errors, (number) => Number.isInteger(number) && number >= 0 && number <= 100000, 'must be an integer between 0 and 100000')
    if (!entry.color || typeof entry.color !== 'object' || Array.isArray(entry.color)) errors.push(`${stopPath}.color must be an object`)
    else validateColor(entry.color as Record<string, unknown>, `${stopPath}.color`, errors)
  })
  if (gradient.angle !== undefined) {
    validateFiniteNumber(gradient.angle, `${path}.angle`, errors, (number) => Number.isInteger(number), 'must be an integer')
  }
  if (gradient.scaled !== undefined && typeof gradient.scaled !== 'boolean') errors.push(`${path}.scaled must be a boolean`)
  if (gradient.path !== undefined && !gradientPaths.has(gradient.path as GradientPath)) {
    errors.push(`${path}.path must be circle, rect, or shape`)
  }
  if (gradient.fillToRect !== undefined) {
    if (!gradient.fillToRect || typeof gradient.fillToRect !== 'object' || Array.isArray(gradient.fillToRect)) {
      errors.push(`${path}.fillToRect must be an object`)
    } else {
      const rect = gradient.fillToRect as Record<string, unknown>
      // The same range `a:srcRect` insets get: a percentage of the box, and never negative.
      for (const side of ['left', 'top', 'right', 'bottom']) {
        if (rect[side] === undefined) continue
        validateFiniteNumber(rect[side], `${path}.fillToRect.${side}`, errors, (number) => Number.isInteger(number) && number >= 0 && number <= 100000, 'must be an integer between 0 and 100000')
      }
    }
  }
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
  const gradient = (value as Record<string, unknown>).gradient
  if (gradient !== undefined) validateGradient(gradient, `${path}.gradient`, errors)
}

function validateTableCellBorders(value: unknown, path: string, errors: string[], sides: readonly string[] = ['left', 'right', 'top', 'bottom', 'tlToBr', 'blToTr']): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const borders = value as Record<string, unknown>
  for (const side of sides) if (side in borders && borders[side] !== undefined) validateTableBorder(borders[side], `${path}.${side}`, errors)
}

/** A region may also state the two interior lines; a cell's own borders may not. */
const tableStyleBorderSides = ['left', 'right', 'top', 'bottom', 'tlToBr', 'blToTr', 'insideH', 'insideV'] as const

function validateTableStyleRegion(value: unknown, path: string, errors: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  const region = value as Record<string, unknown>
  if ('fill' in region && region.fill !== undefined) validateFill(region.fill, `${path}.fill`, errors)
  if ('borders' in region && region.borders !== undefined) validateTableCellBorders(region.borders, `${path}.borders`, errors, tableStyleBorderSides)
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

function validateTableCell(value: unknown, path: string, rowIndex: number, rowCount: number, columnCount: number, occupied: Map<string, string>, errors: string[], assets?: Ppt4aiDocument['assets']): void {
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
  if ('pictureFill' in cell && cell.pictureFill !== undefined) {
    validatePictureFill(cell.pictureFill as PictureFill, `${path}.pictureFill`, assets, errors)
  }
  if ('borders' in cell && cell.borders !== undefined) {
    validateTableCellBorders(cell.borders, `${path}.borders`, errors)
  }
  if ('cellBodyPr' in cell && cell.cellBodyPr !== undefined) {
    if (!cell.cellBodyPr || typeof cell.cellBodyPr !== 'object' || Array.isArray(cell.cellBodyPr)) errors.push(`${path}.cellBodyPr must be an object`)
    else {
      const bodyPr = cell.cellBodyPr as Record<string, unknown>
      if ('insets' in bodyPr) {
        if (!bodyPr.insets || typeof bodyPr.insets !== 'object' || Array.isArray(bodyPr.insets)) errors.push(`${path}.cellBodyPr.insets must be an object`)
        else {
          const insets = bodyPr.insets as Record<string, unknown>
          for (const key of ['left', 'top', 'right', 'bottom']) validateFiniteNumber(insets[key], `${path}.cellBodyPr.insets.${key}`, errors, (number) => number >= 0, 'must be non-negative')
        }
      }
      if ('verticalAlign' in bodyPr && (typeof bodyPr.verticalAlign !== 'string' || !verticalAlignments.has(bodyPr.verticalAlign))) errors.push(`${path}.cellBodyPr.verticalAlign must be top, middle, or bottom`)
    }
  }
}

function validateTableElement(value: TableElement, path: string, errors: string[], assets?: Ppt4aiDocument['assets']): void {
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
    row.cells.forEach((cell, cellIndex) => validateTableCell(cell, `${rowPath}.cells[${cellIndex}]`, rowIndex, value.rows.length, value.columns.length, occupied, errors, assets))
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
      if ('fonts' in theme && theme.fonts !== undefined) validateThemeFonts(theme.fonts, `${themePath}.fonts`, errors)
      if ('formatScheme' in theme && theme.formatScheme !== undefined) {
        const scheme = theme.formatScheme
        if (!scheme || typeof scheme !== 'object' || Array.isArray(scheme)) errors.push(`${themePath}.formatScheme must be an object`)
        else for (const key of ['fillStyles', 'lineStyles', 'backgroundStyles', 'effectStyles'] as const) {
          const entries = (scheme as Record<string, unknown>)[key]
          if (entries === undefined) continue
          if (key === 'lineStyles') validateThemeLineStyleEntries(entries, `${themePath}.formatScheme.${key}`, errors)
          else if (key === 'effectStyles') validateThemeEffectStyleEntries(entries, `${themePath}.formatScheme.${key}`, errors)
          else validateThemeStyleEntries(entries, `${themePath}.formatScheme.${key}`, errors)
        }
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
      if ('textStyles' in master && master.textStyles !== undefined) validateTextStyles(master.textStyles, `${masterPath}.textStyles`, errors)
      if ('background' in master && master.background !== undefined) validateSlideBackground(master.background, `${masterPath}.background`, errors, value.assets)
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
      if ('background' in layout && layout.background !== undefined) validateSlideBackground(layout.background, `${layoutPath}.background`, errors, value.assets)
    }
  }

  for (const [slideId, slide] of Object.entries(value.slides)) {
    if (slide.colorMapOverride !== undefined) validateColorMap(slide.colorMapOverride, `slides.${slideId}.colorMapOverride`, errors)
    if (slide.background !== undefined) validateSlideBackground(slide.background, `slides.${slideId}.background`, errors, value.assets)
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
      validateTableElement(element, `elements.${elementId}`, errors, value.assets)
    } else if (element.kind === 'image') {
      if (typeof element.assetId !== 'string' || element.assetId.length === 0) errors.push(`image element ${elementId} assetId must be a non-empty string`)
      else if (!value.assets?.[element.assetId]) errors.push(`image element ${elementId} references missing asset: ${element.assetId}`)
      validateImageAppearance(element, `elements.${elementId}`, errors)
    } else if (element.kind === 'text' && element.preset !== undefined && !isOoxmlToken(element.preset)) {
      errors.push(`elements.${elementId}.preset must be a preset geometry token`)
    } else if (element.kind === 'shape' && !isOoxmlToken(element.preset)) {
      errors.push(`elements.${elementId}.preset must be a preset geometry token`)
    }
    if ((element.kind === 'shape' || element.kind === 'text') && element.styleRef !== undefined) {
      validateShapeStyleReference(element.styleRef, `elements.${elementId}.styleRef`, errors)
    }
    if ((element.kind === 'shape' || element.kind === 'text') && element.strokeStyle !== undefined && !strokeStyles.has(element.strokeStyle)) {
      errors.push(`elements.${elementId}.strokeStyle must be a supported preset dash token`)
    }
    if ((element.kind === 'shape' || element.kind === 'text') && element.strokeCap !== undefined && !strokeCaps.has(element.strokeCap)) {
      errors.push(`elements.${elementId}.strokeCap must be flat, rnd, or sq`)
    }
    if ((element.kind === 'shape' || element.kind === 'text') && element.strokeJoin !== undefined && !strokeJoins.has(element.strokeJoin)) {
      errors.push(`elements.${elementId}.strokeJoin must be round, bevel, or miter`)
    }
    if ((element.kind === 'shape' || element.kind === 'text') && element.strokeWidth !== undefined) {
      validateFiniteNumber(element.strokeWidth, `elements.${elementId}.strokeWidth`, errors, (number) => Number.isInteger(number) && number >= 0, 'must be a non-negative integer')
    }
    // An element's own paint went unvalidated until commands could set it; the background, table cell
    // and theme entry paths already ran the same rules through `validateFill`.
    if (element.kind === 'shape' || element.kind === 'text') {
      if (element.fill !== undefined) validateFill(element.fill, `elements.${elementId}.fill`, errors)
      if (element.stroke !== undefined) validateFill(element.stroke, `elements.${elementId}.stroke`, errors)
      if (element.shadow !== undefined) validateOuterShadow(element.shadow, `elements.${elementId}.shadow`, errors)
      if (element.customGeometry !== undefined) validateCustomGeometry(element.customGeometry, `elements.${elementId}.customGeometry`, errors)
      // Same rule an image's `assetId` gets: a reference the asset map cannot answer paints nothing,
      // and finding that out at paint time would only surface as a silently empty shape.
      if (element.pictureFill !== undefined) {
        validatePictureFill(element.pictureFill, `elements.${elementId}.pictureFill`, value.assets, errors)
      }
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
