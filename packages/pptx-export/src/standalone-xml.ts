import {
  DEFAULT_THEME_COLORS,
  DEFAULT_THEME_FONTS,
  type Color,
  type Fill,
  type Rect,
  type ShapeElement,
  type TableElement,
  type TextElement,
  type Theme,
  type ThemeColorSlot,
  type ThemeFontScript,
  type ThemeFontSlot,
} from '@ppt4ai/model'
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

export function serializeThemeXml(theme?: Theme): string {
  const colors = themeColorSlots
    .map((slot) => {
      const color = theme?.colors[slot]
      return `<a:${slot}>${color === undefined || color === null ? defaultThemeColors[slot] : serializeColorXml(color)}</a:${slot}>`
    })
    .join('')
  const fonts = `<a:fontScheme name="Office">${themeFontXml(theme, 'major')}${themeFontXml(theme, 'minor')}</a:fontScheme>`
  return `${xmlHeader}<a:theme xmlns:a="${drawingNamespace}" name="Office"><a:themeElements><a:clrScheme name="Office">${colors}</a:clrScheme>${fonts}<a:fmtScheme name="Office"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`
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

function serializeGeometry(preset: ShapeElement['preset']): string {
  return `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>`
}

function serializePlaceholder(placeholder: string | undefined): string {
  if (placeholder === undefined) return ''
  const separator = placeholder.indexOf(':')
  const type = separator === -1 ? placeholder : placeholder.slice(0, separator)
  const index = separator === -1 ? undefined : placeholder.slice(separator + 1)
  return `<p:ph${attrs([['type', type], ['idx', index || undefined]])}/>`
}

export function serializeShapeXml(element: ShapeElement | TextElement, shapeId: number): string {
  const isText = element.kind === 'text'
  // A text element only has a preset when it came from a shape that carried text; `rect` is what a
  // plain text box writes, and what PowerPoint reads for a box with no geometry of its own.
  const preset = isText ? element.preset ?? 'rect' : element.preset
  const placeholder = serializePlaceholder(element.placeholder)
  const nonVisualProperties = `<p:nvSpPr><p:cNvPr id="${shapeId}" name="${escapeXml(element.id)}"/><p:cNvSpPr${isText ? ' txBox="1"' : ''}/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>`
  const shapeProperties = `<p:spPr>${serializeShapeTransform(element)}${serializeGeometry(preset)}${serializeFillXml(element.fill)}${element.stroke ? `<a:ln>${serializeFillXml(element.stroke)}</a:ln>` : ''}</p:spPr>`
  const textBody = isText
    ? serializeTextBodyXml(element.body ?? { paragraphs: [{ runs: element.text ? [{ text: element.text }] : [] }] })
    : ''
  return `<p:sp>${nonVisualProperties}${shapeProperties}${textBody}</p:sp>`
}

export function serializeTableFrameXml(table: TableElement, shapeId: number): string {
  const placeholder = serializePlaceholder(table.placeholder)
  const nonVisualProperties = `<p:nvGraphicFramePr><p:cNvPr id="${shapeId}" name="${escapeXml(table.id)}"/><p:cNvGraphicFramePr/><p:nvPr>${placeholder}</p:nvPr></p:nvGraphicFramePr>`
  const transform = `<p:xfrm${serializeTransformAttributes(table)}>${serializeTransformContents(table.bounds)}</p:xfrm>`
  const graphic = `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">${serializeTableXml(table)}</a:graphicData></a:graphic>`
  return `<p:graphicFrame>${nonVisualProperties}${transform}${graphic}</p:graphicFrame>`
}

export function serializeSlideXml(elements: string[]): string {
  return `${xmlHeader}<p:sld xmlns:a="${drawingNamespace}" xmlns:r="${officeRelationshipNamespace}" xmlns:p="${presentationNamespace}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${elements.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
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
