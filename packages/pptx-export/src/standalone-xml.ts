import type { Rect } from '@ppt4ai/model'

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

export function serializeThemeXml(): string {
  return `${xmlHeader}<a:theme xmlns:a="${drawingNamespace}" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="F7F7F7"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`
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

export function serializeEmptySlideXml(): string {
  return `${xmlHeader}<p:sld xmlns:a="${drawingNamespace}" xmlns:r="${officeRelationshipNamespace}" xmlns:p="${presentationNamespace}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

export function serializeLayoutSlideRelationshipsXml(): string {
  return `${xmlHeader}<Relationships xmlns="${packageRelationshipNamespace}">${relationship(`${officeRelationshipNamespace}/slideLayout`, 'rId1', '../slideLayouts/slideLayout1.xml')}</Relationships>`
}
