import {
  DEFAULT_THEME_COLORS,
  type Color,
  type Fill,
  type Rect,
  type ShapeElement,
  type TableElement,
  type TextAutofit,
  type TextBody,
  type TextElement,
  type TextMarks,
  type TextParagraph,
  type TextBullet,
  type Theme,
  type ThemeColorSlot,
} from '@ppt4ai/model'
import { serializeTableXml } from './table.js'

const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const presentationNamespace = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const drawingNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const officeRelationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'
const contentTypeNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types'

type XmlAttribute = [string, string | number | boolean | undefined]

function assertXmlCharacters(value: string): void {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined) continue
    const allowed = codePoint === 0x9
      || codePoint === 0xA
      || codePoint === 0xD
      || (codePoint >= 0x20 && codePoint <= 0xD7FF)
      || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
      || (codePoint >= 0x10000 && codePoint <= 0x10FFFF)
    if (!allowed) {
      throw new Error(`PPTX generation unsupported XML control character: U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`)
    }
  }
}

function escapeXml(value: string | number): string {
  const source = String(value)
  assertXmlCharacters(source)
  return source
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function attrs(values: readonly XmlAttribute[]): string {
  return values
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeXml(value as string | number)}"`)
    .join('')
}

function booleanAttribute(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? '1' : '0'
}

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

export function serializeThemeXml(theme?: Theme): string {
  const colors = themeColorSlots
    .map((slot) => {
      const color = theme?.colors[slot]
      return `<a:${slot}>${color === undefined || color === null ? defaultThemeColors[slot] : serializeColorXml(color)}</a:${slot}>`
    })
    .join('')
  return `${xmlHeader}<a:theme xmlns:a="${drawingNamespace}" name="Office"><a:themeElements><a:clrScheme name="Office">${colors}</a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`
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

export function serializeColorXml(color: Color, prefix = 'a:'): string {
  const transformXml = (color.transforms ?? [])
    .map((transform) => `<${prefix}${transform.type}${attrs([['val', transform.value]])}/>`)
    .join('')
  if (color.type === 'scrgb') {
    const channels = color.v.split(',')
    const colorAttributes = attrs([['r', channels[0]], ['g', channels[1]], ['b', channels[2]]])
    return transformXml ? `<${prefix}scrgbClr${colorAttributes}>${transformXml}</${prefix}scrgbClr>` : `<${prefix}scrgbClr${colorAttributes}/>`
  }
  const element = color.type === 'srgb'
    ? 'srgbClr'
    : color.type === 'scheme'
      ? 'schemeClr'
      : color.type === 'preset'
        ? 'prstClr'
        : 'sysClr'
  const colorAttributes = color.type === 'system'
    ? attrs([['val', 'windowText'], ['lastClr', color.v]])
    : attrs([['val', color.v]])
  return transformXml
    ? `<${prefix}${element}${colorAttributes}>${transformXml}</${prefix}${element}>`
    : `<${prefix}${element}${colorAttributes}/>`
}

export function serializeFillXml(fill: Fill | undefined): string {
  return fill ? `<a:solidFill>${serializeColorXml(fill.color)}</a:solidFill>` : ''
}

function serializeTransformContents(bounds: Rect): string {
  return `<a:off x="${bounds.x}" y="${bounds.y}"/><a:ext cx="${bounds.w}" cy="${bounds.h}"/>`
}

function serializeShapeTransform(bounds: Rect, rotation: number | undefined): string {
  return `<a:xfrm${attrs([['rot', rotation]])}>${serializeTransformContents(bounds)}</a:xfrm>`
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

function serializeAutofit(autofit: TextAutofit | undefined): string {
  if (!autofit) return ''
  if (autofit.type === 'shrink') return `<a:normAutofit${attrs([['fontScale', autofit.minFontScale]])}/>`
  if (autofit.type === 'resize') return `<a:spAutoFit${attrs([['lnSpcReduction', autofit.maxHeight]])}/>`
  return '<a:noAutofit/>'
}

function serializeBodyProperties(body: TextBody): string {
  const properties = body.bodyPr
  const inset = properties?.insets
  const verticalAlign = properties?.verticalAlign === 'middle'
    ? 'ctr'
    : properties?.verticalAlign === 'bottom'
      ? 'b'
      : properties?.verticalAlign === 'top'
        ? 't'
        : undefined
  const vertical = properties?.vertical === 'vertical' ? 'vert' : properties?.vertical === 'horizontal' ? 'horz' : undefined
  const bodyPrAttributes = attrs([
    ['lIns', inset?.left], ['tIns', inset?.top], ['rIns', inset?.right], ['bIns', inset?.bottom],
    ['wrap', properties?.wrap], ['anchor', verticalAlign], ['vert', vertical],
  ])
  const autofit = serializeAutofit(properties?.autofit)
  return autofit ? `<a:bodyPr${bodyPrAttributes}>${autofit}</a:bodyPr>` : `<a:bodyPr${bodyPrAttributes}/>`
}

function serializeMarks(marks: TextMarks | undefined): string {
  if (!marks) return ''
  return `<a:rPr${attrs([
    ['sz', marks.fontSize === undefined ? undefined : Math.round(marks.fontSize * 100)],
    ['b', booleanAttribute(marks.bold)],
    ['i', booleanAttribute(marks.italic)],
    ['u', marks.underline === undefined ? undefined : marks.underline === 'single' ? 'sng' : 'none'],
    ['baseline', marks.baseline],
  ])}>${serializeFillXml(marks.color)}${marks.fontFamily ? `<a:latin${attrs([['typeface', marks.fontFamily]])}/>` : ''}</a:rPr>`
}

function serializeBullet(bullet: TextBullet): string {
  if (bullet.type === 'char') {
    const runProperties = bullet.fontFamily ? `<a:rPr${attrs([['typeface', bullet.fontFamily]])}/>` : ''
    return runProperties
      ? `<a:buChar char="${escapeXml(bullet.char)}">${runProperties}</a:buChar>`
      : `<a:buChar char="${escapeXml(bullet.char)}"/>`
  }
  const type = bullet.scheme === 'alphaLower'
    ? 'alphaLcPeriod'
    : bullet.scheme === 'alphaUpper'
      ? 'alphaUcPeriod'
      : 'arabicPeriod'
  return `<a:buAutoNum${attrs([['type', type], ['startAt', bullet.startAt]])}/>`
}

function toPointHundredths(value: number): number {
  return Math.round(value / 127)
}

function serializeParagraphProperties(paragraph: TextParagraph): string {
  const paragraphAttributes = attrs([
    ['algn', paragraph.attrs?.align === 'center' ? 'ctr' : paragraph.attrs?.align === 'left' ? 'l' : paragraph.attrs?.align === 'right' ? 'r' : undefined],
    ['lvl', paragraph.attrs?.level],
    ['marL', paragraph.attrs?.marginLeft],
    ['indent', paragraph.attrs?.indent],
  ])
  const children: string[] = []
  if (paragraph.attrs?.lineSpacing !== undefined) children.push(`<a:lnSpc><a:spcPct${attrs([['val', paragraph.attrs.lineSpacing]])}/></a:lnSpc>`)
  if (paragraph.attrs?.spaceBefore !== undefined) children.push(`<a:spcBef><a:spcPts${attrs([['val', toPointHundredths(paragraph.attrs.spaceBefore)]])}/></a:spcBef>`)
  if (paragraph.attrs?.spaceAfter !== undefined) children.push(`<a:spcAft><a:spcPts${attrs([['val', toPointHundredths(paragraph.attrs.spaceAfter)]])}/></a:spcAft>`)
  if (paragraph.attrs?.bullet !== undefined) children.push(serializeBullet(paragraph.attrs.bullet))
  if (!paragraphAttributes && children.length === 0) return ''
  return children.length > 0
    ? `<a:pPr${paragraphAttributes}>${children.join('')}</a:pPr>`
    : `<a:pPr${paragraphAttributes}/>`
}

function needsPreserveSpace(value: string): boolean {
  return /^[\t\r\n ]/u.test(value) || /[\t\r\n ]$/u.test(value)
}

function serializeRunFragment(text: string, marks: TextMarks | undefined): string {
  const textAttributes = needsPreserveSpace(text) ? ' xml:space="preserve"' : ''
  return `<a:r>${serializeMarks(marks)}<a:t${textAttributes}>${escapeXml(text)}</a:t></a:r>`
}

function serializeRun(text: string, marks: TextMarks | undefined): string {
  const fragments = text.split('\n')
  const output: string[] = []
  for (const [index, fragment] of fragments.entries()) {
    if (fragment.length > 0) output.push(serializeRunFragment(fragment, marks))
    if (index < fragments.length - 1) output.push('<a:br/>')
  }
  return output.join('')
}

function serializeParagraph(paragraph: TextParagraph): string {
  const properties = serializeParagraphProperties(paragraph)
  const runs = paragraph.runs.map((run) => serializeRun(run.text, run.marks)).join('')
  return `<a:p>${properties}${runs}</a:p>`
}

export function serializeTextBodyXml(body: TextBody): string {
  const paragraphs = body.paragraphs.length > 0 ? body.paragraphs : [{ runs: [] }]
  return `<p:txBody>${serializeBodyProperties(body)}<a:lstStyle/>${paragraphs.map(serializeParagraph).join('')}</p:txBody>`
}

export function serializeShapeXml(element: ShapeElement | TextElement, shapeId: number): string {
  const isText = element.kind === 'text'
  const preset = isText ? 'rect' : element.preset
  const placeholder = serializePlaceholder(element.placeholder)
  const nonVisualProperties = `<p:nvSpPr><p:cNvPr id="${shapeId}" name="${escapeXml(element.id)}"/><p:cNvSpPr${isText ? ' txBox="1"' : ''}/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>`
  const shapeProperties = `<p:spPr>${serializeShapeTransform(element.bounds, element.rotation)}${serializeGeometry(preset)}${serializeFillXml(element.fill)}${element.stroke ? `<a:ln>${serializeFillXml(element.stroke)}</a:ln>` : ''}</p:spPr>`
  const textBody = isText
    ? serializeTextBodyXml(element.body ?? { paragraphs: [{ runs: element.text ? [{ text: element.text }] : [] }] })
    : ''
  return `<p:sp>${nonVisualProperties}${shapeProperties}${textBody}</p:sp>`
}

export function serializeTableFrameXml(table: TableElement, shapeId: number): string {
  const placeholder = serializePlaceholder(table.placeholder)
  const nonVisualProperties = `<p:nvGraphicFramePr><p:cNvPr id="${shapeId}" name="${escapeXml(table.id)}"/><p:cNvGraphicFramePr/><p:nvPr>${placeholder}</p:nvPr></p:nvGraphicFramePr>`
  const transform = `<p:xfrm>${serializeTransformContents(table.bounds)}</p:xfrm>`
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
