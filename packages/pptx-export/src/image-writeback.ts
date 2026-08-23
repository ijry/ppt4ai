import type { ImageElement, ImageMimeType } from '@ppt4ai/model'

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function imageExtension(mimeType: ImageMimeType): string {
  switch (mimeType) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/gif': return 'gif'
    case 'image/bmp': return 'bmp'
    case 'image/webp': return 'webp'
  }
  throw new Error(`PPTX export unsupported image MIME type: ${String(mimeType)}`)
}

export function stableAssetId(mediaPath: string): string {
  return `asset_${mediaPath.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
}

export function allocateMediaPath(entryNames: Set<string>, mimeType: ImageMimeType): string {
  const extension = imageExtension(mimeType)
  for (let index = 1; ; index += 1) {
    const path = `ppt/media/image${index}.${extension}`
    const occupied = [...entryNames].some((entryName) => /^ppt\/media\/image\d+\.[^/]+$/iu.test(entryName)
      && Number(entryName.slice('ppt/media/image'.length, entryName.lastIndexOf('.'))) === index)
    if (!occupied) return path
  }
}

export function allocateRelationshipId(ids: Set<string>): string {
  for (let index = 1; ; index += 1) {
    const id = `rId${index}`
    if (!ids.has(id)) return id
  }
}

function serializeTransform(element: ImageElement): string {
  const transform = element.transform
  const attributes = [
    transform?.rotation !== undefined ? ` rot="${transform.rotation}"` : '',
    transform?.flipH === true ? ' flipH="1"' : '',
    transform?.flipV === true ? ' flipV="1"' : '',
  ].join('')
  return `<a:xfrm${attributes}><a:off x="${element.bounds.x}" y="${element.bounds.y}"/><a:ext cx="${element.bounds.w}" cy="${element.bounds.h}"/></a:xfrm>`
}

function serializeCrop(element: ImageElement): string {
  const crop = element.sourceCrop
  if (!crop) return ''
  const attributes = [
    crop.left !== undefined ? ` l="${crop.left}"` : '',
    crop.top !== undefined ? ` t="${crop.top}"` : '',
    crop.right !== undefined ? ` r="${crop.right}"` : '',
    crop.bottom !== undefined ? ` b="${crop.bottom}"` : '',
  ].join('')
  return `<a:srcRect${attributes}/>`
}

function serializeEffects(element: ImageElement): string {
  return (element.effects ?? []).map((effect) => effect.type === 'grayscl'
    ? '<a:grayscl/>'
    : `<a:alphaModFix amt="${effect.amount}"/>`).join('')
}

function serializeGeometry(element: ImageElement): string {
  const preset = element.maskPreset ?? 'rect'
  return `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>`
}

export function serializePictureXml(element: ImageElement, relationshipId: string, shapeId: number): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${shapeId}" name="${escapeXml(element.id)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${escapeXml(relationshipId)}">${serializeEffects(element)}</a:blip>${serializeCrop(element)}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${serializeTransform(element)}${serializeGeometry(element)}</p:spPr></p:pic>`
}

export function serializeImageRelationship(id: string, target: string): string {
  return `<Relationship Id="${escapeXml(id)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${escapeXml(target)}"/>`
}

export function replacePictureRelationship(xml: string, relationshipId: string): string {
  const pattern = /(<(?:[A-Za-z_][\w.-]*:)?blip\b[^>]*\br:embed\s*=\s*)(["'])[^"']*\2/iu
  if (!pattern.test(xml)) throw new Error('PPTX export image relationship missing')
  return xml.replace(pattern, (_match, prefix: string, quote: string) => (
    `${prefix}${quote}${escapeXml(relationshipId)}${quote}`
  ))
}
