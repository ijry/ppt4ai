import {
  DEFAULT_THEME_COLORS,
  DEFAULT_THEME_FONTS,
  DEFAULT_THEME_LINE_WIDTHS,
  DEFAULT_THEME_STYLE_COUNT,
  DEFAULT_THEME_STYLE_FILL,
  type Color,
  type Fill,
  type OuterShadow,
  type PictureFill,
  type Rect,
  type ThemeEffectStyleEntry,
  type ShapeElement,
  type ShapeStyleReference,
  type SlideBackground,
  type TableElement,
  type TextElement,
  type Theme,
  type ThemeColorSlot,
  type ThemeFontScript,
  type ThemeFontSlot,
  type ThemeLineStyleEntry,
  type ThemeStyleEntry,
} from '@ppt4ai/model'
import { serializeCrop } from './image-writeback.js'
import { serializeTableXml } from './table.js'
import { attrs, escapeXml, serializeColorXml, serializeFillXml, serializeTextBodyXml, type XmlAttribute } from './text-xml.js'

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

export function serializeContentTypesXml(slideCount: number, imageExtensions: Set<string>): string {
  const defaults = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    ...[...imageExtensions].sort().map((extension) => `<Default Extension="${extension}" ContentType="image/${extension === 'jpg' ? 'jpeg' : extension}"/>`),
  ]
  const overrides = [
    contentTypeOverride('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'),
    contentTypeOverride('/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'),
    contentTypeOverride('/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'),
    contentTypeOverride('/ppt/presProps.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml'),
    contentTypeOverride('/ppt/viewProps.xml', 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml'),
    contentTypeOverride('/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'),
    contentTypeOverride('/ppt/slideMasters/slideMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml'),
    contentTypeOverride('/ppt/slideLayouts/slideLayout1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'),
    ...Array.from({ length: slideCount }, (_, index) => contentTypeOverride(
      `/ppt/slides/slide${index + 1}.xml`,
      'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
    )),
  ]
  return `${xmlHeader}<Types xmlns="${contentTypeNamespace}">${defaults.join('')}${overrides.join('')}</Types>`
}

export function serializeRootRelationshipsXml(): string {
  return `${xmlHeader}<Relationships xmlns="${packageRelationshipNamespace}">${relationship(`${officeRelationshipNamespace}/officeDocument`, 'rId1', 'ppt/presentation.xml')}</Relationships>`
}

export function serializePresentationXml(page: Pick<Rect, 'w' | 'h'>, slideCount: number): string {
  const slides = Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${3 + index}"/>`).join('')
  return `${xmlHeader}<p:presentation xmlns:a="${drawingNamespace}" xmlns:r="${officeRelationshipNamespace}" xmlns:p="${presentationNamespace}"><p:sldMasterIdLst><p:sldMasterId id="1" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides}</p:sldIdLst><p:sldSz cx="${page.w}" cy="${page.h}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr/><a:lvl1pPr><a:defRPr/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`
}

export function serializePresentationRelationshipsXml(slideCount: number): string {
  const relationships = [
    relationship(`${officeRelationshipNamespace}/slideMaster`, 'rId1', 'slideMasters/slideMaster1.xml'),
    relationship(`${officeRelationshipNamespace}/theme`, 'rId2', 'theme/theme1.xml'),
    ...Array.from({ length: slideCount }, (_, index) => relationship(
      `${officeRelationshipNamespace}/slide`,
      `rId${3 + index}`,
      `slides/slide${index + 1}.xml`,
    )),
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
  const dash = entry?.style && entry.style !== 'solid' ? `<a:prstDash val="${entry.style}"/>` : ''
  return `<a:ln${attrs([['w', entry?.width]])}>${themeStyleFillXml(entry)}${dash}</a:ln>`
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

export function serializeMasterXml(): string {
  return `${xmlHeader}<p:sldMaster xmlns:a="${drawingNamespace}" xmlns:r="${officeRelationshipNamespace}" xmlns:p="${presentationNamespace}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`
}

export function serializeMasterRelationshipsXml(): string {
  const relationships = [
    relationship(`${officeRelationshipNamespace}/slideLayout`, 'rId1', '../slideLayouts/slideLayout1.xml'),
    relationship(`${officeRelationshipNamespace}/theme`, 'rId2', '../theme/theme1.xml'),
  ]
  return `${xmlHeader}<Relationships xmlns="${packageRelationshipNamespace}">${relationships.join('')}</Relationships>`
}

export function serializeLayoutXml(): string {
  return `${xmlHeader}<p:sldLayout xmlns:a="${drawingNamespace}" xmlns:p="${presentationNamespace}" type="blank" preserve="1"><p:cSld name=""><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
}

export function serializeLayoutRelationshipsXml(): string {
  return `${xmlHeader}<Relationships xmlns="${packageRelationshipNamespace}">${relationship(`${officeRelationshipNamespace}/slideMaster`, 'rId1', '../slideMasters/slideMaster1.xml')}</Relationships>`
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
  // `dash` and `dot` are both valid `val` tokens, so the narrowed model values write out verbatim.
  const prstDash = element.strokeStyle && element.strokeStyle !== 'solid' ? `<a:prstDash val="${element.strokeStyle}"/>` : ''
  // The corner follows `prstDash` in the ECMA-376 sequence, and its element name is the model value.
  const join = element.strokeJoin ? `<a:${element.strokeJoin}/>` : ''
  const line = element.stroke
    ? `<a:ln${attrs([['w', element.strokeWidth], ['cap', element.strokeCap]])}>${serializeFillXml(element.stroke)}${prstDash}${join}</a:ln>`
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

export function serializeSlideXml(elements: string[], background?: SlideBackground, backgroundRelationshipId?: string): string {
  return `${xmlHeader}<p:sld xmlns:a="${drawingNamespace}" xmlns:r="${officeRelationshipNamespace}" xmlns:p="${presentationNamespace}"><p:cSld>${serializeBackgroundXml(background, backgroundRelationshipId)}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${elements.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

export function serializeEmptySlideXml(): string {
  return serializeSlideXml([])
}

export function serializeLayoutSlideRelationshipsXml(): string {
  return `${xmlHeader}<Relationships xmlns="${packageRelationshipNamespace}">${relationship(`${officeRelationshipNamespace}/slideLayout`, 'rId1', '../slideLayouts/slideLayout1.xml')}</Relationships>`
}

export function serializeSlideRelationshipsXml(imageRelationships: string[]): string {
  return `${xmlHeader}<Relationships xmlns="${packageRelationshipNamespace}">${relationship(`${officeRelationshipNamespace}/slideLayout`, 'rId1', '../slideLayouts/slideLayout1.xml')}${imageRelationships.join('')}</Relationships>`
}
