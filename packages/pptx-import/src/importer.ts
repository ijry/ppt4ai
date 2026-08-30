import { fingerprintBytes, fingerprintDocument, parseBitmapMetadata as parseSharedBitmapMetadata, type AssetAdapter, type AssetMetadata, type Color, type ColorMap, type ColorMapKey, type ColorTransform, type ColorTransformType, type Element, type ElementDefaults, type ElementTransform, type Fill, type ImageCrop, type ImageEffect, type Ppt4aiDocument, type PresetGeometry, type Rect, type SlideLayout, type SlideMaster, type TableBorder, type TableCell, type TableCellBorders, type TableElement, type TableStyle, type TableStyleReference, type TableStyleRegion, type TableStyleRegionName, type TableStyleText, type TextBody, type TextBullet, type TextParagraph, type TextRun, type Theme, type ThemeColorSlot } from '@ppt4ai/model'
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

export interface ImportPptxOptions {
  assetAdapter?: AssetAdapter
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

const colorTransformTypes = new Set<ColorTransformType>(['tint', 'shade', 'lumMod', 'lumOff', 'alpha', 'alphaMod', 'alphaOff'])
const themeColorSlots = new Set<ThemeColorSlot>(['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'])
const colorMapKeys = new Set<ColorMapKey>(['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'])

function parsePercentage(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const number = parseNumber(value)
  return number !== undefined && Number.isInteger(number) && number >= 0 && number <= 100000 ? number : undefined
}

function parseHexColor(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^[0-9A-F]{6}$/.test(normalized) ? normalized : undefined
}

function parseColorTransforms(node: XmlNode): ColorTransform[] | undefined {
  const transforms: ColorTransform[] = []
  for (const transformNode of node.children) {
    const type = localName(transformNode.name) as ColorTransformType
    if (!colorTransformTypes.has(type)) continue
    const value = parsePercentage(attribute(transformNode, 'val'))
    if (value !== undefined) transforms.push({ type, value })
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

function parseTheme(xml: string, id: string): Theme | undefined {
  let root: XmlNode
  try {
    root = parseXml(xml)
  } catch {
    return undefined
  }
  const scheme = findDescendants(root, 'clrScheme')[0]
  if (!scheme) return undefined
  const colors: Theme['colors'] = {}
  for (const slotNode of scheme.children) {
    const slot = localName(slotNode.name) as ThemeColorSlot
    if (!themeColorSlots.has(slot)) continue
    const color = parseColor(slotNode)
    if (color) colors[slot] = color
  }
  return Object.keys(colors).length > 0 ? { id, colors } : undefined
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

function parseTableBorder(line: XmlNode | undefined): TableBorder | undefined {
  if (!line) return undefined
  const color = parseColor(child(line, 'solidFill'))
  if (!color) return undefined
  const widthValue = parseNumber(attribute(line, 'w'))
  const width = widthValue !== undefined && widthValue > 0 ? widthValue : undefined
  const dash = child(line, 'prstDash')
  const dashValue = dash && attribute(dash, 'val')
  const style = dashValue === 'dot' ? 'dot' : dashValue && dashValue !== 'solid' ? 'dash' : 'solid'
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

function parseDirectFill(node: XmlNode | undefined): Fill | undefined {
  if (!node) return undefined
  const fill = child(node, 'solidFill')
  const color = parseColor(fill)
  return color ? { color } : undefined
}

function shapeProperties(shape: XmlNode): XmlNode | undefined {
  return findDescendants(shape, 'spPr')[0]
}

function parseShapeFill(shape: XmlNode): Fill | undefined {
  return parseDirectFill(shapeProperties(shape))
}

function parseStroke(shape: XmlNode): Fill | undefined {
  const line = child(shapeProperties(shape) ?? shape, 'ln')
  return parseDirectFill(line)
}

function parseStyleBorder(line: XmlNode | undefined): TableBorder | undefined {
  if (!line) return undefined
  const widthAttribute = attribute(line, 'w')
  const width = widthAttribute === undefined ? undefined : parsePositiveInteger(widthAttribute)
  if (widthAttribute !== undefined && width === undefined) return undefined
  const color = parseColor(child(line, 'solidFill'))
  if (!color) return undefined
  const dashValue = attribute(child(line, 'prstDash') ?? line, 'val')
  const style = dashValue === 'dot' ? 'dot' : dashValue && dashValue !== 'solid' ? 'dash' : 'solid'
  return { color, ...(width === undefined ? {} : { width }), style }
}

function parseStyleText(node: XmlNode | undefined): TableStyleText | undefined {
  if (!node) return undefined
  const color = parseColor(node)
  const boldValue = attribute(node, 'b')
  const italicValue = attribute(node, 'i')
  const bold = boldValue === '1' ? true : boldValue === '0' ? false : undefined
  const italic = italicValue === '1' ? true : italicValue === '0' ? false : undefined
  if (!color && bold === undefined && italic === undefined) return undefined
  return {
    ...(color ? { color } : {}),
    ...(bold === undefined ? {} : { bold }),
    ...(italic === undefined ? {} : { italic }),
  }
}

function parseStyleBorders(node: XmlNode | undefined): TableCellBorders | undefined {
  if (!node) return undefined
  const borders: TableCellBorders = {}
  const left = parseStyleBorder(child(node, 'lnL'))
  const right = parseStyleBorder(child(node, 'lnR'))
  const top = parseStyleBorder(child(node, 'lnT'))
  const bottom = parseStyleBorder(child(node, 'lnB'))
  if (left) borders.left = left
  if (right) borders.right = right
  if (top) borders.top = top
  if (bottom) borders.bottom = bottom
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

function parseTable(frame: XmlNode, id: string): TableElement | undefined {
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
  return {
    id,
    kind: 'table',
    bounds,
    columns,
    rows: parsedRows,
    ...(tableFill ? { fill: tableFill } : {}),
    ...(style ? { style } : {}),
  }
}

function findSlideElements(node: XmlNode): XmlNode[] {
  const result: XmlNode[] = []
  for (const current of node.children) {
    const name = localName(current.name)
    if (name === 'sp' || name === 'graphicFrame' || name === 'pic') result.push(current)
    result.push(...findSlideElements(current))
  }
  return result
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
  const preset = geometry && attribute(geometry, 'prst')
  return preset === 'rect' || preset === 'roundRect' || preset === 'ellipse' || preset === 'triangle' ? preset : undefined
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
): { element: Extract<Element, { kind: 'image' }>; metadata: AssetMetadata; bytes: Uint8Array } | undefined {
  const bounds = parseBounds(picture)
  const blip = findDescendants(picture, 'blip')[0]
  const relationshipId = blip && attribute(blip, 'embed')
  const mediaPath = relationshipTarget(slidePath, slideRelations, relationshipId, 'image')
  const bytes = mediaPath && entries[mediaPath]
  if (!bounds || !mediaPath || !bytes) return undefined
  const assetId = stableAssetId(mediaPath)
  const metadata = parseBitmapMetadata(mediaPath, bytes, assetId)
  if (!metadata) return undefined
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

function parsePreset(shape: XmlNode): PresetGeometry {
  const geometry = findDescendants(shape, 'prstGeom')[0]
  const preset = geometry && attribute(geometry, 'prst')
  if (preset === 'roundRect' || preset === 'ellipse' || preset === 'triangle') return preset
  return 'rect'
}

function parsePlaceholder(shape: XmlNode): string | undefined {
  const placeholder = findDescendants(shape, 'ph')[0]
  if (!placeholder) return undefined
  const type = attribute(placeholder, 'type') ?? 'body'
  const index = attribute(placeholder, 'idx')
  return index ? `${type}:${index}` : type
}

function parseText(shape: XmlNode): { present: boolean; value: string } {
  const body = findDescendants(shape, 'txBody')[0]
  if (!body) return { present: false, value: '' }
  const parts: string[] = []
  for (const node of findDescendants(body, 't')) parts.push(textContent(node))
  const lineBreaks = findDescendants(body, 'br').length
  return { present: true, value: parts.join('') + '\n'.repeat(lineBreaks) }
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
  const type = attribute(autoNumber, 'type')
  const scheme = type === 'alphaLcPeriod' || type === 'alphaLcParenRight'
    ? 'alphaLower'
    : type === 'alphaUcPeriod' || type === 'alphaUcParenRight'
      ? 'alphaUpper'
      : 'arabic'
  const rawStart = attribute(autoNumber, 'startAt')
  const startAt = rawStart === undefined ? undefined : parseNumber(rawStart)
  if (startAt !== undefined && (!Number.isInteger(startAt) || startAt <= 0)) return undefined
  return startAt === undefined ? { type: 'autoNum', scheme } : { type: 'autoNum', scheme, startAt }
}

function parseTextBody(shape: XmlNode): TextBody | undefined {
  const body = findDescendants(shape, 'txBody')[0]
  if (!body) return undefined
  const bodyProperties = child(body, 'bodyPr')
  const verticalValue = bodyProperties && attribute(bodyProperties, 'vert')
  const vertical = verticalValue === 'vert270' || verticalValue === 'vert' || verticalValue === 'wordArtVert' ? 'vertical' as const : undefined
  const paragraphs: TextParagraph[] = children(body, 'p').map((paragraphNode) => {
    const runs: TextRun[] = []
    for (const runNode of children(paragraphNode, 'r')) {
      const textNode = child(runNode, 't')
      if (!textNode) continue
      const text = textContent(textNode)
      if (text) runs.push({ text })
    }
    const attrs = parseBullet(child(paragraphNode, 'pPr'))
    return attrs ? { runs, attrs: { bullet: attrs } } : { runs }
  })
  if (paragraphs.length === 0) return undefined
  return vertical ? { bodyPr: { vertical }, paragraphs } : { paragraphs }
}

function parseElement(shape: XmlNode, id: string, requireBounds: boolean): Element | undefined {
  const bounds = parseBounds(shape)
  if (requireBounds && !bounds) return undefined
  const placeholder = parsePlaceholder(shape)
  const text = parseText(shape)
  if (text.present) {
    if (!bounds) return undefined
    const element: Extract<Element, { kind: 'text' }> = { id, kind: 'text', bounds, text: text.value }
    const body = parseTextBody(shape)
    if (body) element.body = body
    if (placeholder) element.placeholder = placeholder
    const fill = parseShapeFill(shape)
    if (fill) element.fill = fill
    const stroke = parseStroke(shape)
    if (stroke) element.stroke = stroke
    return element
  }
  if (!bounds) return undefined
  const element: Extract<Element, { kind: 'shape' }> = {
    id,
    kind: 'shape',
    preset: parsePreset(shape),
    bounds,
  }
  if (placeholder) element.placeholder = placeholder
  const fill = parseShapeFill(shape)
  if (fill) element.fill = fill
  const stroke = parseStroke(shape)
  if (stroke) element.stroke = stroke
  return element
}

function parseDefaults(shape: XmlNode): [string, ElementDefaults] | undefined {
  const placeholder = parsePlaceholder(shape)
  if (!placeholder) return undefined
  const defaults: ElementDefaults = {}
  const bounds = parseBounds(shape)
  if (bounds) defaults.bounds = bounds
  defaults.preset = parsePreset(shape)
  const fill = parseShapeFill(shape)
  if (fill) defaults.fill = fill
  const stroke = parseStroke(shape)
  if (stroke) defaults.stroke = stroke
  const text = parseText(shape)
  if (text.present && text.value) defaults.text = text.value
  return [placeholder, defaults]
}

function parseMaster(xml: string, id: string, themeId?: string): SlideMaster {
  const root = parseXml(xml)
  const defaults: Record<string, ElementDefaults> = {}
  for (const shape of findDescendants(root, 'sp')) {
    const parsed = parseDefaults(shape)
    if (parsed) defaults[parsed[0]] = parsed[1]
  }
  const colorMap = parseColorMap(findDescendants(root, 'clrMap')[0])
  return { id, defaults, ...(themeId ? { themeId } : {}), ...(colorMap ? { colorMap } : {}) }
}

function parseLayout(xml: string, id: string, masterId: string): SlideLayout {
  const root = parseXml(xml)
  const defaults: Record<string, ElementDefaults> = {}
  for (const shape of findDescendants(root, 'sp')) {
    const parsed = parseDefaults(shape)
    if (parsed) defaults[parsed[0]] = parsed[1]
  }
  const colorMapOverride = parseColorMapOverride(root)
  return { id, masterId, defaults, ...(colorMapOverride ? { colorMapOverride } : {}) }
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
                  const theme = themeBytes ? parseTheme(new TextDecoder().decode(themeBytes), candidateId) : undefined
                  if (theme) {
                    themeCounter += 1
                    themeId = candidateId
                    themes[themeId] = theme
                  }
                  themeIdsByPath.set(themePath, themeId)
                }
              }
              masters[masterId] = parseMaster(new TextDecoder().decode(entries[masterPath]!), masterId, themeId)
            }
          }
        }
        if (layoutPart) layouts[layoutId] = parseLayout(new TextDecoder().decode(entries[layoutPath]!), layoutId, masterId ?? '')
      }
    }

    const elementIds: string[] = []
    for (const shape of findSlideElements(slidePart.xml)) {
      const id = `el_${elementCounter++}`
      if (localName(shape.name) === 'pic') {
        const picture = parsePicture(shape, id, slidePath, slideRelations, entries)
        if (!picture) continue
        elements[id] = picture.element
        elementIds.push(id)
        if (!assets[picture.metadata.id]) {
          assets[picture.metadata.id] = picture.metadata
          await options.assetAdapter?.put(picture.metadata.id, new Uint8Array(picture.bytes), picture.metadata)
        }
        continue
      }
      const element = localName(shape.name) === 'graphicFrame' ? parseTable(shape, id) : parseElement(shape, id, true)
      if (!element) continue
      elements[id] = element
      elementIds.push(id)
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
    slides[slideId] = { id: slideId, elementIds, ...(layoutId ? { layoutId } : {}), ...(masterId ? { masterId } : {}), ...(colorMapOverride ? { colorMapOverride } : {}), ...(source ? { source } : {}) }
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
