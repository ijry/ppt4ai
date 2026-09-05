import {
  DEFAULT_COLOR_MAP,
  DEFAULT_THEME_COLORS,
  DEFAULT_THEME_FONTS,
  DEFAULT_THEME_LINE_WIDTHS,
  DEFAULT_THEME_STYLE_COUNT,
  DEFAULT_THEME_STYLE_FILL,
  type Color,
  type ColorMap,
  type DashSegment,
  type ElementDefaults,
  type Fill,
  type GroupElement,
  type LevelDefaults,
  type OuterShadow,
  type PictureFill,
  type Rect,
  type ThemeEffectStyleEntry,
  type ShapeElement,
  type ShapeStyleReference,
  type SlideBackground,
  type SlideLayout,
  type SlideMaster,
  type StrokeStyle,
  type TableElement,
  type TableStyle,
  type TableStyleRegionName,
  type TextElement,
  type Theme,
  type ThemeColorSlot,
  type ThemeFontScript,
  type ThemeFontSlot,
  type ThemeLineStyleEntry,
  type ThemeStyleEntry,
  type TextStyles,
} from '@ppt4ai/model'
import { serializeCrop } from './image-writeback.js'
import { colorMapKeys } from './master-layout-writeback.js'
import { serializeTableXml, serializeThemeableBorderXml } from './table.js'
import { attrs, escapeXml, serializeColorXml, serializeFillXml, serializeLevelDefaultsXml, serializeTextBodyXml, type XmlAttribute } from './text-xml.js'

export { serializeColorXml, serializeFillXml, serializeTextBodyXml } from './text-xml.js'

const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const presentationNamespace = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const drawingNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const officeRelationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'
const contentTypeNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types'

function relationship(type: string, id: string, target: string): string {
  return `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`
}

function contentTypeOverride(partName: string, contentType: string): string {
  return `<Override PartName="${partName}" ContentType="${contentType}"/>`
}

/**
 * `ST_SlideMasterId` and `ST_SlideLayoutId` both start at this value; the skeleton used to write `id="1"`
 * for each, which the schema does not allow. Slide ids are a different type (`ST_SlideId`, 256 upwards).
 */
const slideMasterIdBase = 2147483648

/**
 * How many parts the package has and how they point at each other. One description, so the content
 * types, the presentation, its relationships and every master, layout and slide agree on the numbering.
 */
export interface PackageParts {
  slideCount: number
  masterCount: number
  layoutCount: number
  themeCount: number
  hasTableStyles: boolean
  /** 1-based layout part number for each slide, in slide order. */
  slideLayouts: readonly number[]
  /** 1-based layout part numbers owned by each master part, in master order. */
  masterLayouts: ReadonlyArray<readonly number[]>
  /** 1-based theme part number for each master part. */
  masterThemes: readonly number[]
}

export function serializeContentTypesXml(parts: PackageParts, imageExtensions: Set<string>): string {
  const defaults = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    ...[...imageExtensions].sort().map((extension) => `<Default Extension="${extension}" ContentType="image/${extension === 'jpg' ? 'jpeg' : extension}"/>`),
  ]
  const numbered = (count: number, path: (number: number) => string, contentType: string): string[] =>
    Array.from({ length: count }, (_, index) => contentTypeOverride(path(index + 1), contentType))
  const overrides = [
    contentTypeOverride('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'),
    contentTypeOverride('/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'),
    contentTypeOverride('/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'),
    contentTypeOverride('/ppt/presProps.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml'),
    contentTypeOverride('/ppt/viewProps.xml', 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml'),
    ...numbered(parts.themeCount, (number) => `/ppt/theme/theme${number}.xml`, 'application/vnd.openxmlformats-officedocument.theme+xml'),
    ...(parts.hasTableStyles ? [contentTypeOverride('/ppt/tableStyles.xml', 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml')] : []),
    ...numbered(parts.masterCount, (number) => `/ppt/slideMasters/slideMaster${number}.xml`, 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml'),
    ...numbered(parts.layoutCount, (number) => `/ppt/slideLayouts/slideLayout${number}.xml`, 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'),
    ...numbered(parts.slideCount, (number) => `/ppt/slides/slide${number}.xml`, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'),
  ]
  return `${xmlHeader}<Types xmlns="${contentTypeNamespace}">${defaults.join('')}${overrides.join('')}</Types>`
}

export function serializeRootRelationshipsXml(): string {
  return `${xmlHeader}<Relationships xmlns="${packageRelationshipNamespace}">${relationship(`${officeRelationshipNamespace}/officeDocument`, 'rId1', 'ppt/presentation.xml')}</Relationships>`
}

/** The masters take `rId1..N`, so a slide's relationship id starts after them and after the theme. */
function slideRelationshipId(parts: PackageParts, index: number): string {
  return `rId${parts.masterCount + 2 + index}`
}

export function serializePresentationXml(page: Pick<Rect, 'w' | 'h'>, parts: PackageParts): string {
  const masters = Array.from({ length: parts.masterCount }, (_, index) => `<p:sldMasterId id="${slideMasterIdBase + index}" r:id="rId${1 + index}"/>`).join('')
  const slides = Array.from({ length: parts.slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="${slideRelationshipId(parts, index)}"/>`).join('')
  return `${xmlHeader}<p:presentation xmlns:a="${drawingNamespace}" xmlns:r="${officeRelationshipNamespace}" xmlns:p="${presentationNamespace}"><p:sldMasterIdLst>${masters}</p:sldMasterIdLst><p:sldIdLst>${slides}</p:sldIdLst><p:sldSz cx="${page.w}" cy="${page.h}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr/><a:lvl1pPr><a:defRPr/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`
}

/**
 * Masters first, then the presentation's own theme, then the slides, then the table styles. The order is
 * what keeps a single-master package numbered exactly as it was before several became possible: adding
 * a master shifts the slides, which is why `p:sldIdLst` asks this function's helper for the id.
 */
export function serializePresentationRelationshipsXml(parts: PackageParts): string {
  const relationships = [
    ...Array.from({ length: parts.masterCount }, (_, index) => relationship(
      `${officeRelationshipNamespace}/slideMaster`,
      `rId${1 + index}`,
      `slideMasters/slideMaster${index + 1}.xml`,
    )),
    relationship(`${officeRelationshipNamespace}/theme`, `rId${parts.masterCount + 1}`, 'theme/theme1.xml'),
    ...Array.from({ length: parts.slideCount }, (_, index) => relationship(
      `${officeRelationshipNamespace}/slide`,
      slideRelationshipId(parts, index),
      `slides/slide${index + 1}.xml`,
    )),
    ...(parts.hasTableStyles ? [relationship(`${officeRelationshipNamespace}/tableStyles`, slideRelationshipId(parts, parts.slideCount), 'tableStyles.xml')] : []),
  ]
  return `${xmlHeader}<Relationships xmlns="${packageRelationshipNamespace}">${relationships.join('')}</Relationships>`
}

export function serializeCorePropertiesXml(): string {
  return `${xmlHeader}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>ppt4ai presentation</dc:title><dc:creator>ppt4ai</dc:creator><cp:lastModifiedBy>ppt4ai</cp:lastModifiedBy></cp:coreProperties>`
}

export function serializeAppPropertiesXml(): string {
  return `${xmlHeader}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ppt4ai</Application><AppVersion>1.0</AppVersion></Properties>`
}

export function serializePresentationSupportXml(): { presProps: string; viewProps: string } {
  return {
    presProps: `${xmlHeader}<p:presProps xmlns:p="${presentationNamespace}"/>`,
    viewProps: `${xmlHeader}<p:viewPr xmlns:p="${presentationNamespace}"/>`,
  }
}

const themeColorSlots: readonly ThemeColorSlot[] = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']

/** `CT_TableStyle`'s element sequence, paired with the model's region names. */
const tableStyleSequence: ReadonlyArray<readonly [string, TableStyleRegionName]> = [
  ['wholeTbl', 'wholeTable'],
  ['band1H', 'band1H'],
  ['band2H', 'band2H'],
  ['band1V', 'band1V'],
  ['band2V', 'band2V'],
  ['lastCol', 'lastCol'],
  ['firstCol', 'firstCol'],
  ['lastRow', 'lastRow'],
  ['firstRow', 'firstRow'],
]

/** `a:tcTxStyle/@b` and `@i` are `ST_OnOffStyleType`: `on`/`off`/`def`, not the `0`/`1` of `a:rPr`. */
function styleFlag(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? 'on' : 'off'
}

const defaultThemeColors: Record<ThemeColorSlot, string> = {
  dk1: `<a:sysClr val="windowText" lastClr="${DEFAULT_THEME_COLORS.dk1.v}"/>`,
  lt1: `<a:sysClr val="window" lastClr="${DEFAULT_THEME_COLORS.lt1.v}"/>`,
  dk2: `<a:srgbClr val="${DEFAULT_THEME_COLORS.dk2.v}"/>`,
  lt2: `<a:srgbClr val="${DEFAULT_THEME_COLORS.lt2.v}"/>`,
  accent1: `<a:srgbClr val="${DEFAULT_THEME_COLORS.accent1.v}"/>`,
  accent2: `<a:srgbClr val="${DEFAULT_THEME_COLORS.accent2.v}"/>`,
  accent3: `<a:srgbClr val="${DEFAULT_THEME_COLORS.accent3.v}"/>`,
  accent4: `<a:srgbClr val="${DEFAULT_THEME_COLORS.accent4.v}"/>`,
  accent5: `<a:srgbClr val="${DEFAULT_THEME_COLORS.accent5.v}"/>`,
  accent6: `<a:srgbClr val="${DEFAULT_THEME_COLORS.accent6.v}"/>`,
  hlink: `<a:srgbClr val="${DEFAULT_THEME_COLORS.hlink.v}"/>`,
  folHlink: `<a:srgbClr val="${DEFAULT_THEME_COLORS.folHlink.v}"/>`,
}

const themeFontScripts: readonly ThemeFontScript[] = ['latin', 'ea', 'cs']

/** A slot the model says nothing about falls back to `DEFAULT_THEME_FONTS`, the same values the renderer resolves references against. */
function themeFontXml(theme: Theme | undefined, slot: ThemeFontSlot): string {
  const face = theme?.fonts?.[slot]
  const scripts = themeFontScripts
    .map((script) => `<a:${script}${attrs([['typeface', face?.[script] ?? DEFAULT_THEME_FONTS[slot][script]]])}/>`)
    .join('')
  return `<a:${slot}Font>${scripts}</a:${slot}Font>`
}

/**
 * Pads a modeled list up to the three entries a real Office theme carries, so a common `idx="3"`
 * reference still lands on something. Never truncates: a longer list is written whole, because
 * dropping a modeled entry loses data while padding only adds a placeholder.
 */
function paddedEntries<T>(entries: readonly T[] | undefined, fallback: (index: number) => T): T[] {
  const present = entries ?? []
  const padded = [...present]
  for (let index = present.length; index < DEFAULT_THEME_STYLE_COUNT; index += 1) padded.push(fallback(index))
  return padded
}

function themeEffectStyleXml(entry: ThemeEffectStyleEntry): string {
  return `<a:effectStyle>${entry === null ? '<a:effectLst/>' : serializeShadowXml(entry)}</a:effectStyle>`
}

/**
 * A `null` entry is one the model cannot express — a gradient, pattern or picture. It still has to
 * occupy its slot, because references are positional and skipping it would shift every later index.
 * `a:noFill` is what it writes: `resolveStyleFill` already resolves a null entry to nothing and the
 * canvas already paints nothing, so the file and the canvas say the same thing.
 */
function themeStyleFillXml(entry: ThemeStyleEntry): string {
  return entry ? serializeFillXml(entry) : '<a:noFill/>'
}

/**
 * A modeled entry is written exactly as modeled: an entry with no `width` gets no `w`, because
 * omitting `w` in OOXML means "inherit", and inventing one here would be subtly wrong on every
 * shape pointing at it. Only the padded entries carry a default width, and they are invented whole.
 */
function themeLineStyleXml(entry: ThemeLineStyleEntry): string {
  const dash = serializeDashXml(entry?.style)
  const join = entry?.join ? `<a:${entry.join}/>` : ''
  const openAttrs = attrs([['w', entry?.width], ['cap', entry?.cap], ['cmpd', entry?.compound], ['algn', entry?.align]])
  return `<a:ln${openAttrs}>${themeStyleFillXml(entry)}${dash}${join}</a:ln>`
}

/**
 * `EG_LineDashProperties`: a preset token or a custom segment list, never both. `solid` is the OOXML
 * default, so it writes nothing — the same rule the writeback comparison uses.
 */
function serializeDashXml(style: StrokeStyle | { custom: DashSegment[] } | undefined): string {
  if (!style || style === 'solid') return ''
  if (typeof style === 'string') return `<a:prstDash val="${style}"/>`
  const segments = style.custom.map((segment) => `<a:ds${attrs([['d', segment.dash], ['sp', segment.space]])}/>`).join('')
  return segments === '' ? '' : `<a:custDash>${segments}</a:custDash>`
}

/**
 * The four `fmtScheme` lists. Before this they were written empty while slides kept emitting
 * `lnRef`/`fillRef`/`bgRef` indexes, so every style reference in a generated package dangled.
 *
 * `a:effectStyleLst` is written as three empty effect styles: effects are not modeled, and an
 * `effectRef` still needs an entry to land on. Resolving to "no effect" is what the renderer does.
 */
function serializeFormatSchemeXml(theme: Theme | undefined): string {
  const scheme = theme?.formatScheme
  const fills = paddedEntries(scheme?.fillStyles, () => DEFAULT_THEME_STYLE_FILL).map(themeStyleFillXml).join('')
  const lines = paddedEntries<ThemeLineStyleEntry>(
    scheme?.lineStyles,
    (index) => ({ ...DEFAULT_THEME_STYLE_FILL, width: DEFAULT_THEME_LINE_WIDTHS[index] ?? DEFAULT_THEME_LINE_WIDTHS[0] }),
  ).map(themeLineStyleXml).join('')
  const backgrounds = paddedEntries(scheme?.backgroundStyles, () => DEFAULT_THEME_STYLE_FILL).map(themeStyleFillXml).join('')
  // A `null` entry writes an empty `a:effectLst`, which is exactly what Office's first entry is, and
  // padding uses the same value — until this wrote real entries, an `effectRef idx="2"` in a generated
  // package pointed at an empty slot, the last corner of the dangling-reference bug the other three
  // lists already fixed.
  const effects = paddedEntries<ThemeEffectStyleEntry>(scheme?.effectStyles, () => null).map(themeEffectStyleXml).join('')
  return `<a:fmtScheme name="Office"><a:fillStyleLst>${fills}</a:fillStyleLst><a:lnStyleLst>${lines}</a:lnStyleLst>`
    + `<a:effectStyleLst>${effects}</a:effectStyleLst><a:bgFillStyleLst>${backgrounds}</a:bgFillStyleLst></a:fmtScheme>`
}

export function serializeThemeXml(theme?: Theme): string {
  const colors = themeColorSlots
    .map((slot) => {
      const color = theme?.colors[slot]
      return `<a:${slot}>${color === undefined || color === null ? defaultThemeColors[slot] : serializeColorXml(color)}</a:${slot}>`
    })
    .join('')
  const fonts = `<a:fontScheme name="Office">${themeFontXml(theme, 'major')}${themeFontXml(theme, 'minor')}</a:fontScheme>`
  return `${xmlHeader}<a:theme xmlns:a="${drawingNamespace}" name="Office"><a:themeElements><a:clrScheme name="Office">${colors}</a:clrScheme>${fonts}${serializeFormatSchemeXml(theme)}</a:themeElements></a:theme>`
}

/**
 * `ppt/tableStyles.xml`. Region order is the `CT_TableStyle` sequence, which is not the obvious one —
 * `lastCol`/`firstCol`/`lastRow` come before `firstRow` — so the model's key order cannot be used.
 * `styleName` is required by the schema and the model has no name for a style, so the id serves as one.
 * `def` names the style a reader offers for the next inserted table; the model does not carry the
 * source's value, so the first id in sorted order is used rather than an invented GUID.
 */
export function serializeTableStylesXml(styles: Record<string, TableStyle>): string {
  const ids = Object.keys(styles).sort()
  const serialized = ids.map((id) => {
    const style = styles[id]
    if (!style) return ''
    const regions = tableStyleSequence.map(([element, region]) => {
      const entry = style.regions?.[region]
      if (!entry) return ''
      const text = entry.text
        ? `<a:tcTxStyle${attrs([['b', styleFlag(entry.text.bold)], ['i', styleFlag(entry.text.italic)]])}>${entry.text.color ? serializeColorXml(entry.text.color) : ''}</a:tcTxStyle>`
        : ''
      const borders = entry.borders
        ? `<a:tcBdr>${serializeThemeableBorderXml('left', entry.borders.left)}${serializeThemeableBorderXml('right', entry.borders.right)}`
          + `${serializeThemeableBorderXml('top', entry.borders.top)}${serializeThemeableBorderXml('bottom', entry.borders.bottom)}`
          // `CT_TableCellBorderStyle` puts the interior lines after the four outer ones, then the diagonals.
          + `${serializeThemeableBorderXml('insideH', entry.borders.insideH)}${serializeThemeableBorderXml('insideV', entry.borders.insideV)}`
          + `${serializeThemeableBorderXml('tl2br', entry.borders.tlToBr)}${serializeThemeableBorderXml('tr2bl', entry.borders.blToTr)}</a:tcBdr>`
        : ''
      const fill = entry.fill ? `<a:fill>${serializeFillXml(entry.fill)}</a:fill>` : ''
      const cellStyle = borders || fill ? `<a:tcStyle>${borders}${fill}</a:tcStyle>` : ''
      return `<a:${element}>${text}${cellStyle}</a:${element}>`
    }).join('')
    return `<a:tblStyle styleId="${escapeXml(style.id)}" styleName="${escapeXml(style.id)}">${regions}</a:tblStyle>`
  }).join('')
  return `${xmlHeader}<a:tblStyleLst xmlns:a="${drawingNamespace}" def="${escapeXml(ids[0] ?? '')}">${serialized}</a:tblStyleLst>`
}

/**
 * `p:clrMap` on a master and `a:overrideClrMapping` on a layout or slide: the same twelve required
 * attributes of `CT_ColorMapping`, which is why an override is written whole. The model's override is
 * partial ("these slots, inherit the rest"), so the caller merges before writing.
 */
function serializeColorMappingXml(tag: string, map: ColorMap): string {
  return `<${tag}${attrs(colorMapKeys.map((key) => [key, map[key]]))}/>`
}

/** `p:clrMapOvr`: a stated override replaces the inherited map whole, an absent one inherits. */
function serializeColorMapOverrideXml(map: ColorMap | undefined): string {
  return `<p:clrMapOvr>${map ? serializeColorMappingXml('a:overrideClrMapping', map) : '<a:masterClrMapping/>'}</p:clrMapOvr>`
}

function serializeTextStylesXml(styles: TextStyles | undefined): string {
  if (!styles) return ''
  const entries: Array<[string, readonly LevelDefaults[] | undefined]> = [
    ['titleStyle', styles.title],
    ['bodyStyle', styles.body],
    ['otherStyle', styles.other],
  ]
  const serialized = entries
    .map(([element, levels]) => levels && levels.length > 0 ? `<p:${element}>${serializeLevelDefaultsXml(levels)}</p:${element}>` : '')
    .join('')
  return serialized ? `<p:txStyles>${serialized}</p:txStyles>` : ''
}

/**
 * One `defaults` entry as a `p:sp` carrying its `p:ph`. Neither `serializeShapeXml` branch fits — a text
 * element writes `txBox="1"`, which a placeholder is not, and a shape writes no `p:txBody`, which is
 * where `a:lstStyle` has to live — so the pieces are composed here from the same helpers.
 */
function serializePlaceholderShapeXml(placeholder: string, defaults: ElementDefaults, shapeId: number): string {
  const nonVisualProperties = `<p:nvSpPr><p:cNvPr id="${shapeId}" name="${escapeXml(placeholder)}"/><p:cNvSpPr/>`
    + `<p:nvPr>${serializePlaceholder(placeholder)}</p:nvPr></p:nvSpPr>`
  const transform = defaults.bounds
    ? `<a:xfrm${attrs([['rot', defaults.rotation]])}>${serializeTransformContents(defaults.bounds)}</a:xfrm>`
    : ''
  const geometry = defaults.preset ? serializeGeometry(defaults.preset) : ''
  const line = defaults.stroke ? `<a:ln>${serializeFillXml(defaults.stroke)}</a:ln>` : ''
  const shapeProperties = `<p:spPr>${transform}${geometry}${serializeFillXml(defaults.fill)}${line}</p:spPr>`
  // `body` wins over the legacy flat `text`, the rule elements already follow; the importer derives
  // `text` back from whichever was written.
  const body = defaults.body ?? { paragraphs: [{ runs: defaults.text ? [{ text: defaults.text }] : [] }] }
  return `<p:sp>${nonVisualProperties}${shapeProperties}${serializeTextBodyXml(body, 'p:', defaults.listStyle)}</p:sp>`
}

/**
 * The `p:spTree` of a master or layout. Keys are walked in sorted order, not insertion order: two
 * structurally equal documents have to produce the same bytes, which the determinism test pins.
 */
function serializeSpTreeXml(defaults: Record<string, ElementDefaults> | undefined): string {
  const placeholders = Object.keys(defaults ?? {}).sort()
    .map((placeholder, index) => {
      const entry = defaults?.[placeholder]
      return entry ? serializePlaceholderShapeXml(placeholder, entry, index + 2) : ''
    })
    .join('')
  return `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${placeholders}</p:spTree>`
}

/**
 * The one `slideMaster1.xml`, now filled from the model. `p:txStyles` closes `CT_SlideMaster`, after
 * `p:sldLayoutIdLst`; a master with no modeled background writes none rather than inventing white.
 */
export function serializeMasterXml(
  master: SlideMaster | undefined,
  colorMap: ColorMap = DEFAULT_COLOR_MAP,
  layoutNumbers: readonly number[] = [1],
  masterCount = 1,
  backgroundRelationshipId?: string,
): string {
  // Layout ids sit above the master ids so the two lists cannot collide, and a layout keeps the same id
  // whichever master owns it. A master owning no layout writes no list: `p:sldLayoutIdLst` is optional,
  // and inventing a layout for it would be worse than saying nothing.
  const layoutIds = layoutNumbers
    .map((number, index) => `<p:sldLayoutId id="${slideMasterIdBase + masterCount + number}" r:id="rId${1 + index}"/>`)
    .join('')
  return `${xmlHeader}<p:sldMaster xmlns:a="${drawingNamespace}" xmlns:r="${officeRelationshipNamespace}" xmlns:p="${presentationNamespace}">`
    + `<p:cSld>${serializeBackgroundXml(master?.background, backgroundRelationshipId)}${serializeSpTreeXml(master?.defaults)}</p:cSld>`
    + `${serializeColorMappingXml('p:clrMap', colorMap)}`
    + `${layoutIds ? `<p:sldLayoutIdLst>${layoutIds}</p:sldLayoutIdLst>` : ''}`
    + `${serializeTextStylesXml(master?.textStyles)}</p:sldMaster>`
}

/** Image relationships come last, so a background picture never renumbers the layouts or the theme. */
export function serializeMasterRelationshipsXml(layoutNumbers: readonly number[] = [1], themeNumber = 1, imageRelationships: readonly string[] = []): string {
  const relationships = [
    ...layoutNumbers.map((number, index) => relationship(
      `${officeRelationshipNamespace}/slideLayout`,
      `rId${1 + index}`,
      `../slideLayouts/slideLayout${number}.xml`,
    )),
    relationship(`${officeRelationshipNamespace}/theme`, `rId${layoutNumbers.length + 1}`, `../theme/theme${themeNumber}.xml`),
    ...imageRelationships,
  ]
  return `${xmlHeader}<Relationships xmlns="${packageRelationshipNamespace}">${relationships.join('')}</Relationships>`
}

/**
 * The one `slideLayout1.xml`. A layout carrying placeholders is not `blank`, and the model has no
 * `ST_SlideLayoutType` to name instead, so it says `cust`; one with no placeholders keeps writing
 * `blank`, which is what a document with no masters at all produced before any of this was written.
 */
export function serializeLayoutXml(layout?: SlideLayout, colorMapOverride?: ColorMap, backgroundRelationshipId?: string): string {
  const type = layout?.defaults && Object.keys(layout.defaults).length > 0 ? 'cust' : 'blank'
  return `${xmlHeader}<p:sldLayout xmlns:a="${drawingNamespace}" xmlns:r="${officeRelationshipNamespace}" xmlns:p="${presentationNamespace}" type="${type}" preserve="1">`
    + `<p:cSld name="">${serializeBackgroundXml(layout?.background, backgroundRelationshipId)}${serializeSpTreeXml(layout?.defaults)}</p:cSld>`
    + `${serializeColorMapOverrideXml(colorMapOverride)}</p:sldLayout>`
}

export function serializeLayoutRelationshipsXml(masterNumber = 1, imageRelationships: readonly string[] = []): string {
  const relationships = [
    relationship(`${officeRelationshipNamespace}/slideMaster`, 'rId1', `../slideMasters/slideMaster${masterNumber}.xml`),
    ...imageRelationships,
  ]
  return `${xmlHeader}<Relationships xmlns="${packageRelationshipNamespace}">${relationships.join('')}</Relationships>`
}

function serializeTransformContents(bounds: Rect): string {
  return `<a:off x="${bounds.x}" y="${bounds.y}"/><a:ext cx="${bounds.w}" cy="${bounds.h}"/>`
}

function serializeShapeTransform(element: ShapeElement | TextElement): string {
  return `<a:xfrm${serializeTransformAttributes(element)}>${serializeTransformContents(element.bounds)}</a:xfrm>`
}

/** Flips are written only when set: `flipH="0"` and an absent attribute mean the same thing. */
function serializeTransformAttributes(element: { rotation?: number; flipH?: boolean; flipV?: boolean }): string {
  return attrs([
    ['rot', element.rotation],
    ['flipH', element.flipH === true ? '1' : undefined],
    ['flipV', element.flipV === true ? '1' : undefined],
  ])
}

/** The preset is an arbitrary `prst` word now, so it is escaped like any other model string. */
function serializeGeometry(preset: ShapeElement['preset']): string {
  return `<a:prstGeom prst="${escapeXml(preset)}"><a:avLst/></a:prstGeom>`
}

/**
 * `a:custGeom` from the literal path list. Written instead of `a:prstGeom`, because a shape that carries
 * custom geometry is not the preset — before this it was exported as `prst="rect"`, which threw the path
 * away. `a:avLst` stays empty: the adjust values belong to the guide language the model does not read.
 */
function serializeCustomGeometry(geometry: NonNullable<ShapeElement['customGeometry']>): string {
  const paths = geometry.paths.map((path) => {
    const commands = path.commands.map((command) => {
      switch (command.type) {
        case 'close':
          return '<a:close/>'
        case 'move':
          return `<a:moveTo><a:pt x="${command.x}" y="${command.y}"/></a:moveTo>`
        case 'line':
          return `<a:lnTo><a:pt x="${command.x}" y="${command.y}"/></a:lnTo>`
        case 'cubic':
          return `<a:cubicBezTo><a:pt x="${command.x1}" y="${command.y1}"/><a:pt x="${command.x2}" y="${command.y2}"/><a:pt x="${command.x}" y="${command.y}"/></a:cubicBezTo>`
        case 'quad':
          return `<a:quadBezTo><a:pt x="${command.x1}" y="${command.y1}"/><a:pt x="${command.x}" y="${command.y}"/></a:quadBezTo>`
        default:
          return `<a:arcTo wR="${command.widthRadius}" hR="${command.heightRadius}" stAng="${command.startAngle}" swAng="${command.swingAngle}"/>`
      }
    }).join('')
    return `<a:path${attrs([['w', path.width], ['h', path.height]])}>${commands}</a:path>`
  }).join('')
  return `<a:custGeom><a:avLst/><a:pathLst>${paths}</a:pathLst></a:custGeom>`
}

function serializePlaceholder(placeholder: string | undefined): string {
  if (placeholder === undefined) return ''
  const separator = placeholder.indexOf(':')
  const type = separator === -1 ? placeholder : placeholder.slice(0, separator)
  const index = separator === -1 ? undefined : placeholder.slice(separator + 1)
  return `<p:ph${attrs([['type', type], ['idx', index || undefined]])}/>`
}

/**
 * `CT_ShapeStyle` requires all four references, so an incomplete model emits nothing rather than a
 * fabricated `idx` that would paint a colour we never resolved.
 */
function serializeShapeStyleXml(styleRef: ShapeStyleReference | undefined): string {
  if (!styleRef?.fill || !styleRef.line || !styleRef.effect || !styleRef.font) return ''
  const reference = (name: string, idx: number | string, color: Color | undefined): string =>
    `<a:${name} idx="${idx}">${color ? serializeColorXml(color) : ''}</a:${name}>`
  return '<p:style>'
    + reference('lnRef', styleRef.line.idx, styleRef.line.color)
    + reference('fillRef', styleRef.fill.idx, styleRef.fill.color)
    + reference('effectRef', styleRef.effect.idx, styleRef.effect.color)
    + reference('fontRef', styleRef.font.idx, styleRef.font.color)
    + '</p:style>'
}

/**
 * `a:effectLst/a:outerShdw`, written after `a:ln` — the ECMA-376 sequence in `CT_ShapeProperties`.
 * Only the four modeled values are emitted; a source file's `sx`/`kx`/`algn` never reach the model, so
 * this is the whole shadow as far as the model is concerned.
 */
function serializeShadowXml(shadow: OuterShadow | undefined): string {
  if (!shadow) return ''
  const attributes = attrs([['blurRad', shadow.blurRadius], ['dist', shadow.distance], ['dir', shadow.direction]])
  return `<a:effectLst><a:outerShdw${attributes}>${serializeColorXml(shadow.color)}</a:outerShdw></a:effectLst>`
}

/**
 * A shape's `a:blipFill`. `relationshipId` comes from the caller because the media part and its
 * relationship are allocated per slide, exactly as `p:pic` does; the child order is the ECMA one
 * (`a:blip`, then `a:srcRect`, then the fill mode).
 */
function serializeBlipEffectsXml(effects: PictureFill['effects']): string {
  return (effects ?? []).map((effect) => effect.type === 'grayscl'
    ? '<a:grayscl/>'
    : `<a:alphaModFix amt="${effect.amount}"/>`).join('')
}

/** `a:tile` and `a:stretch` are a choice in `CT_BlipFillProperties`, so exactly one of them is written. */
function serializeFillModeXml(fill: PictureFill): string {
  const tile = fill.tile
  if (!tile) {
    const stretch = fill.stretch
    const rect = stretch
      ? `<a:fillRect${attrs([['l', stretch.left], ['t', stretch.top], ['r', stretch.right], ['b', stretch.bottom]])}/>`
      : '<a:fillRect/>'
    return `<a:stretch>${rect}</a:stretch>`
  }
  const attributes = attrs([
    ['tx', tile.offsetX],
    ['ty', tile.offsetY],
    ['sx', tile.scaleX],
    ['sy', tile.scaleY],
    ['flip', tile.flip],
    ['algn', tile.align],
  ])
  return `<a:tile${attributes}/>`
}

function serializePictureFillXml(element: ShapeElement | TextElement, relationshipId: string | undefined): string {
  const fill = element.pictureFill
  if (!fill || !relationshipId) return ''
  const effects = serializeBlipEffectsXml(fill.effects)
  const blip = effects
    ? `<a:blip r:embed="${escapeXml(relationshipId)}">${effects}</a:blip>`
    : `<a:blip r:embed="${escapeXml(relationshipId)}"/>`
  return `<a:blipFill>${blip}${serializeCrop(fill.sourceCrop)}${serializeFillModeXml(fill)}</a:blipFill>`
}

export function serializeShapeXml(element: ShapeElement | TextElement, shapeId: number, pictureRelationshipId?: string): string {
  const isText = element.kind === 'text'
  // A text element only has a preset when it came from a shape that carried text; `rect` is what a
  // plain text box writes, and what PowerPoint reads for a box with no geometry of its own.
  const preset = isText ? element.preset ?? 'rect' : element.preset
  const placeholder = serializePlaceholder(element.placeholder)
  const nonVisualProperties = `<p:nvSpPr><p:cNvPr id="${shapeId}" name="${escapeXml(element.id)}"/><p:cNvSpPr${isText ? ' txBox="1"' : ''}/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>`
  // `a:prstDash` is a child of `a:ln` and follows the fill in the ECMA-376 sequence, not an attribute.
  // `a:custDash` is the other half of that choice, so exactly one of the two is written.
  const dash = serializeDashXml(element.strokeStyle)
  // The corner follows the dash in the ECMA-376 sequence, and its element name is the model value.
  const join = element.strokeJoin ? `<a:${element.strokeJoin}/>` : ''
  const line = element.stroke
    ? `<a:ln${attrs([['w', element.strokeWidth], ['cap', element.strokeCap], ['cmpd', element.strokeCompound], ['algn', element.strokeAlign]])}>${serializeFillXml(element.stroke)}${dash}${join}</a:ln>`
    : ''
  // One fill node per shape: the picture replaces the colour, the way the scene and the command do.
  const pictureFill = serializePictureFillXml(element, pictureRelationshipId)
  const fill = pictureFill === '' ? serializeFillXml(element.fill) : pictureFill
  const geometry = element.customGeometry ? serializeCustomGeometry(element.customGeometry) : serializeGeometry(preset)
  const shapeProperties = `<p:spPr>${serializeShapeTransform(element)}${geometry}${fill}${line}${serializeShadowXml(element.shadow)}</p:spPr>`
  const textBody = isText
    ? serializeTextBodyXml(element.body ?? { paragraphs: [{ runs: element.text ? [{ text: element.text }] : [] }] })
    : ''
  return `<p:sp>${nonVisualProperties}${shapeProperties}${serializeShapeStyleXml(element.styleRef)}${textBody}</p:sp>`
}

/**
 * `p:grpSp`, children already serialized by the caller so the shape id cursor stays shared across
 * the whole tree — `p:cNvPr/@id` is unique per slide, not per nesting level.
 *
 * `a:chOff`/`a:chExt` are written even when the model has no `childSpace`: a child's `a:off` inside a
 * group is in the child coordinate space, and a model without `childSpace` means its children carry
 * plain slide coordinates — which OOXML states as a child space identical to the group's own box.
 * Omitting the pair would leave the mapping to whatever a reader decides, and identity is not an
 * invented number: it is `bounds`.
 */
export function serializeGroupXml(group: GroupElement, shapeId: number, children: readonly string[]): string {
  const nonVisualProperties = `<p:nvGrpSpPr><p:cNvPr id="${shapeId}" name="${escapeXml(group.id)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
  const space = group.childSpace ?? group.bounds
  const childSpace = `<a:chOff x="${space.x}" y="${space.y}"/><a:chExt cx="${space.w}" cy="${space.h}"/>`
  const transform = `<a:xfrm${serializeTransformAttributes(group)}>${serializeTransformContents(group.bounds)}${childSpace}</a:xfrm>`
  return `<p:grpSp>${nonVisualProperties}<p:grpSpPr>${transform}</p:grpSpPr>${children.join('')}</p:grpSp>`
}

export function serializeTableFrameXml(table: TableElement, shapeId: number, pictureRelationships?: (assetId: string) => string | undefined): string {
  const placeholder = serializePlaceholder(table.placeholder)
  const nonVisualProperties = `<p:nvGraphicFramePr><p:cNvPr id="${shapeId}" name="${escapeXml(table.id)}"/><p:cNvGraphicFramePr/><p:nvPr>${placeholder}</p:nvPr></p:nvGraphicFramePr>`
  const transform = `<p:xfrm${serializeTransformAttributes(table)}>${serializeTransformContents(table.bounds)}</p:xfrm>`
  const graphic = `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">${serializeTableXml(table, pictureRelationships)}</a:graphicData></a:graphic>`
  return `<p:graphicFrame>${nonVisualProperties}${transform}${graphic}</p:graphicFrame>`
}

/** `p:bg` comes before `p:spTree` inside `p:cSld`, and `p:bgPr` needs an effect list to be valid. */
function serializeBackgroundXml(background: SlideBackground | undefined, pictureRelationshipId?: string): string {
  if (background?.pictureFill && pictureRelationshipId) {
    const fill = background.pictureFill
    const effects = serializeBlipEffectsXml(fill.effects)
    const blip = effects
      ? `<a:blip r:embed="${escapeXml(pictureRelationshipId)}">${effects}</a:blip>`
      : `<a:blip r:embed="${escapeXml(pictureRelationshipId)}"/>`
    return `<p:bg><p:bgPr><a:blipFill>${blip}${serializeCrop(fill.sourceCrop)}${serializeFillModeXml(fill)}</a:blipFill><a:effectLst/></p:bgPr></p:bg>`
  }
  if (background?.fill) return `<p:bg><p:bgPr>${serializeFillXml(background.fill)}<a:effectLst/></p:bgPr></p:bg>`
  if (background?.styleRef) {
    const color = background.styleRef.color
    return `<p:bg><p:bgRef idx="${background.styleRef.idx}">${color ? serializeColorXml(color) : ''}</p:bgRef></p:bg>`
  }
  return ''
}

export function serializeSlideXml(elements: string[], background?: SlideBackground, backgroundRelationshipId?: string, colorMapOverride?: ColorMap): string {
  return `${xmlHeader}<p:sld xmlns:a="${drawingNamespace}" xmlns:r="${officeRelationshipNamespace}" xmlns:p="${presentationNamespace}"><p:cSld>${serializeBackgroundXml(background, backgroundRelationshipId)}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${elements.join('')}</p:spTree></p:cSld>${serializeColorMapOverrideXml(colorMapOverride)}</p:sld>`
}

export function serializeEmptySlideXml(): string {
  return serializeSlideXml([])
}

export function serializeLayoutSlideRelationshipsXml(): string {
  return `${xmlHeader}<Relationships xmlns="${packageRelationshipNamespace}">${relationship(`${officeRelationshipNamespace}/slideLayout`, 'rId1', '../slideLayouts/slideLayout1.xml')}</Relationships>`
}

export function serializeSlideRelationshipsXml(imageRelationships: string[], layoutNumber = 1): string {
  return `${xmlHeader}<Relationships xmlns="${packageRelationshipNamespace}">${relationship(`${officeRelationshipNamespace}/slideLayout`, 'rId1', `../slideLayouts/slideLayout${layoutNumber}.xml`)}${imageRelationships.join('')}</Relationships>`
}
