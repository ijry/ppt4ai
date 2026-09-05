import { boundsCentre, cascadeTransform, createCustomPath, createPresetPath, mapChildSpace, type GroupTransform, type PathCommand } from '@ppt4ai/geometry'
import { layoutTable, type TableLayout, type TableLayoutCell } from '@ppt4ai/layout'
import { mergeColorMaps, resolveColor, resolveInheritedElement, resolveSlideBackground, resolveStyleFill, resolveStyleFillGradient, resolveStyleFillPattern, resolveStyleEffect, resolveStyleFontColor, resolveStyleFontFamily, resolveStyleLine, resolveStyleLineStroke, resolveTableCellStyle, resolveThemeFontFamily, type AssetMetadata, type ColorMap, type CustomGeometry, type DashSegment, type Element, type ElementTransform, type Fill, type ImageCrop, type ImageEffect, type LevelDefaults, type OuterShadow, type Ppt4aiDocument, type PictureFill, type PictureStretch, type PictureTile, type PresetGeometry, type Rect, type ResolvedColor, type ResolvedGradient, type ResolvedPattern, type ResolvedShadow, type ResolvedTableCellStyle, type ShapeStyleReference, type SlideLayout, type SlideMaster, type StrokeAlign, type StrokeCap, type StrokeCompound, type StrokeJoin, type StrokeStyle, type TableCellBorders, type TableStyleText, type TextBody, type TextMarks, type Theme } from '@ppt4ai/model'
import { layoutText, normalizeTextElement, type TextLayout, type TextLayoutLine, type TextLayoutMarker, type TextLayoutRun } from '@ppt4ai/text'

export interface SceneGraph {
  slideId: string
  page: {
    w: number
    h: number
  }
  nodes: SceneNode[]
  groups?: SceneGroup[]
  /** Resolved from the slide, its layout or its master, whichever declares one first. */
  background?: ResolvedColor
  /** Present only for a linear gradient background; `background` stays set as the flat fallback. */
  backgroundGradient?: ResolvedGradient
  /** A photo background (`p:bg/a:blipFill`); painting draws it across the page before any node. */
  backgroundPicture?: ScenePictureFill
}

export interface SceneGroup {
  id: string
  bounds: Rect
  childIds: string[]
  ancestorIds: string[]
  paintOrder: number
  rotation?: number
  flipH?: boolean
  flipV?: boolean
}

export interface SceneShapeNode {
  id: string
  kind: 'shape'
  bounds: Rect
  path: PathCommand[]
  fill?: Fill
  stroke?: Fill
  /** An `a:blipFill`: painting clips it to `path`, and no resolved colour comes with it. */
  pictureFill?: ScenePictureFill
  /** `a:outerShdw` with its colour resolved; painting casts it once, under the shape's silhouette. */
  shadow?: ResolvedShadow
  resolvedFillColor?: ResolvedColor
  /** Present only for a linear gradient fill; `resolvedFillColor` stays set as the flat fallback. */
  resolvedFillGradient?: ResolvedGradient
  /** Present only for an `a:pattFill`; `resolvedFillColor` stays set to the foreground as the fallback. */
  resolvedFillPattern?: ResolvedPattern
  resolvedStrokeColor?: ResolvedColor
  /** Present only for a linear gradient outline; `resolvedStrokeColor` stays set as the flat fallback. */
  resolvedStrokeGradient?: ResolvedGradient
  /** `a:ln/@w` in EMU, carried through so paint can set a real line width. */
  strokeWidth?: number
  strokeStyle?: StrokeStyle | { custom: DashSegment[] }
  strokeCap?: StrokeCap
  strokeJoin?: StrokeJoin
  /** `a:ln/@cmpd`, carried for consumers that write files; painting draws a single line regardless. */
  strokeCompound?: StrokeCompound
  /** `a:ln/@algn`, same: held for the file, not yet honoured by paint. */
  strokeAlign?: StrokeAlign
  transform?: ElementTransform
}

export interface SceneTextLayoutRun extends TextLayoutRun {
  resolvedColor?: ResolvedColor
  resolvedFontFamily?: string
}

/** Present only when the theme resolved the run's `+mj-lt`-style reference into a real typeface. */
export interface SceneTextLayoutMarker extends TextLayoutMarker {
  resolvedFontFamily?: string
}

export interface SceneTextLayoutLine extends Omit<TextLayoutLine, 'runs' | 'marker'> {
  runs: SceneTextLayoutRun[]
  marker?: SceneTextLayoutMarker
}

export interface SceneTextLayout extends Omit<TextLayout, 'lines'> {
  lines: SceneTextLayoutLine[]
}

export interface SceneTextNode {
  id: string
  kind: 'text'
  bounds: Rect
  text: string
  layout: SceneTextLayout
  /** Present when the element carries a fill or stroke, so the text sits on real geometry. */
  path?: PathCommand[]
  fill?: Fill
  stroke?: Fill
  pictureFill?: ScenePictureFill
  shadow?: ResolvedShadow
  resolvedFillColor?: ResolvedColor
  resolvedFillGradient?: ResolvedGradient
  resolvedFillPattern?: ResolvedPattern
  resolvedStrokeColor?: ResolvedColor
  resolvedStrokeGradient?: ResolvedGradient
  strokeWidth?: number
  strokeStyle?: StrokeStyle | { custom: DashSegment[] }
  strokeCap?: StrokeCap
  strokeJoin?: StrokeJoin
  /** `a:ln/@cmpd`, carried for consumers that write files; painting draws a single line regardless. */
  strokeCompound?: StrokeCompound
  /** `a:ln/@algn`, same: held for the file, not yet honoured by paint. */
  strokeAlign?: StrokeAlign
  transform?: ElementTransform
}

export interface SceneTableNode {
  id: string
  kind: 'table'
  bounds: Rect
  layout: SceneTableLayout
  fill?: Fill
  stroke?: Fill
  transform?: ElementTransform
}

/**
 * A shape's picture fill with its asset metadata inlined, the way `SceneImageNode` carries its own,
 * so painting can decode the media without reaching back into the document.
 */
export interface ScenePictureFill {
  assetId: string
  metadata?: AssetMetadata
  sourceCrop?: ImageCrop
  tile?: PictureTile
  stretch?: PictureStretch
  effects?: ImageEffect[]
}

export interface SceneImageNode {
  id: string
  kind: 'image'
  bounds: Rect
  assetId: string
  metadata?: AssetMetadata
  transform?: ElementTransform
  sourceCrop?: ImageCrop
  maskPreset?: PresetGeometry
  effects?: ImageEffect[]
}

export interface SceneTableLayoutCell extends TableLayoutCell {
  textLayout: SceneTextLayout
  /** `a:tcPr/a:blipFill`, with metadata inlined so painting can decode it like any other picture. */
  pictureFill?: ScenePictureFill
  resolvedStyle: ResolvedTableCellStyle
  resolvedFillColor?: ResolvedColor
  resolvedBorderColors?: Partial<Record<keyof TableCellBorders, ResolvedColor>>
  resolvedTextStyle?: SceneResolvedTableTextStyle
}

export interface SceneTableLayout extends Omit<TableLayout, 'cells'> {
  cells: SceneTableLayoutCell[]
}

export type SceneNode = SceneShapeNode | SceneTextNode | SceneTableNode | SceneImageNode

export interface SceneResolvedTableTextStyle extends Omit<TableStyleText, 'color'> {
  color?: ResolvedColor
}

interface SceneThemeContext {
  theme?: Theme
  colorMap: ColorMap
}

function resolvedFillColor(fill: Fill | undefined, context: SceneThemeContext): ResolvedColor | undefined {
  return fill ? resolveColor(fill.color, context.theme, context.colorMap) : undefined
}

/**
 * Every stop resolved through the theme. A stop whose colour will not resolve drops out, and fewer
 * than two survivors mean there is no gradient left to paint — the node keeps its resolved fill
 * colour, which is the first stop, so it paints flat rather than not at all.
 */
function resolvedFillGradient(fill: Fill | undefined, context: SceneThemeContext): ResolvedGradient | undefined {
  const gradient = fill?.gradient
  if (!gradient) return undefined
  const stops = gradient.stops.flatMap((stop) => {
    const color = resolveColor(stop.color, context.theme, context.colorMap)
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
 * Both pattern colours resolved through the theme, so a `phClr` in a theme `fillStyleLst` entry lands
 * as a real colour. Either colour failing to resolve drops the pattern — the node keeps its resolved
 * fill colour, which is the foreground, so it paints flat rather than not at all.
 */
function resolvedFillPattern(fill: Fill | undefined, context: SceneThemeContext): ResolvedPattern | undefined {
  const pattern = fill?.pattern
  if (!pattern) return undefined
  const foreground = resolveColor(pattern.foreground, context.theme, context.colorMap)
  const background = resolveColor(pattern.background, context.theme, context.colorMap)
  if (!foreground || !background) return undefined
  return { preset: pattern.preset, foreground, background }
}

/**
 * Picks the typeface slot the layout asked for, then lets the theme resolve any `+mj-lt`-style
 * reference. Only set when the result differs from what paint would use anyway (`marks.fontFamily`),
 * so text with neither a script font nor a theme reference keeps the same scene shape as before.
 */
function resolvedFontFamily(marks: TextMarks | undefined, script: 'ea' | undefined, context: SceneThemeContext): string | undefined {
  const requested = script === 'ea' ? marks?.fontFamilyEa ?? marks?.fontFamily : marks?.fontFamily
  const resolved = resolveThemeFontFamily(requested, context.theme)
  return resolved === marks?.fontFamily ? undefined : resolved
}

/**
 * `styleFallback` carries what `<p:style><a:fontRef>` supplies for the shape. It is applied last, so
 * a run's own colour or family — including one that came from the level defaults — always wins.
 */
function toSceneTextLayout(
  layout: TextLayout,
  context: SceneThemeContext,
  styleFallback: { color?: ResolvedColor; fontFamily?: string } = {},
): SceneTextLayout {
  return {
    ...layout,
    lines: layout.lines.map((line) => {
      const markerFontFamily = line.marker ? resolvedFontFamily(line.marker.marks, line.marker.script, context) : undefined
      const markerFamily = markerFontFamily ?? (line.marker?.marks?.fontFamily ? undefined : styleFallback.fontFamily)
      return {
        ...line,
        ...(line.marker ? { marker: { ...line.marker, ...(markerFamily ? { resolvedFontFamily: markerFamily } : {}) } } : {}),
        runs: line.runs.map((run) => {
          const resolvedColor = resolvedFillColor(run.marks?.color, context) ?? styleFallback.color
          const fontFamily = resolvedFontFamily(run.marks, run.script, context)
            ?? (run.marks?.fontFamily ? undefined : styleFallback.fontFamily)
          return { ...run, ...(resolvedColor ? { resolvedColor } : {}), ...(fontFamily ? { resolvedFontFamily: fontFamily } : {}) }
        }),
      }
    }),
  }
}

function mergeTableTextDefaults(body: TextBody, text: TableStyleText | undefined): TextBody {
  const clonedBody = structuredClone(body)
  if (!text) return clonedBody
  const defaults: TextMarks = {
    ...(text.color ? { color: { color: structuredClone(text.color) } } : {}),
    ...(text.bold === undefined ? {} : { bold: text.bold }),
    ...(text.italic === undefined ? {} : { italic: text.italic }),
  }
  return {
    ...clonedBody,
    paragraphs: clonedBody.paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: paragraph.runs.map((run) => ({
        ...run,
        marks: { ...defaults, ...run.marks },
      })),
    })),
  }
}

/**
 * A cell's `a:tcPr` framing folded into the body the layout receives. The cell's own `a:bodyPr` wins
 * where it states something, because it is the more specific of the two; a cell stating neither lays
 * out exactly as it did before `cellBodyPr` existed.
 */
function mergeCellBodyProperties(body: TextBody, cellBodyPr: TextBody['bodyPr'] | undefined): TextBody {
  if (!cellBodyPr) return body
  return { ...body, bodyPr: { ...structuredClone(cellBodyPr), ...body.bodyPr } }
}

function mergeLevelDefaults(
  body: TextBody,
  element: Extract<Element, { kind: 'text' }>,
  layout: SlideLayout | undefined,
  master: SlideMaster | undefined,
): TextBody {
  const clonedBody = structuredClone(body)
  const placeholderType = element.placeholder
  const textStyleKey: 'title' | 'body' | 'other' = placeholderType === 'title' || placeholderType === 'subTitle' || placeholderType === 'ctrTitle'
    ? 'title'
    : placeholderType === 'body'
      ? 'body'
      : 'other'

  return {
    ...clonedBody,
    paragraphs: clonedBody.paragraphs.map((paragraph) => {
      const level = paragraph.attrs?.level ?? 0
      const defaults = paragraph.attrs?.defaultMarks
      const listStyle = layout?.defaults?.[placeholderType ?? 'body']?.listStyle
      const textStyles = master?.textStyles?.[textStyleKey]

      const levelListStyle = listStyle?.find((item: LevelDefaults) => item.level === level)
      const levelTextStyle = textStyles?.find((item: LevelDefaults) => item.level === level)

      const merged: TextMarks = {
        ...levelTextStyle?.marks,
        ...levelListStyle?.marks,
        ...defaults,
      }

      return {
        ...paragraph,
        runs: paragraph.runs.map((run) => ({
          ...run,
          marks: { ...merged, ...run.marks },
        })),
      }
    }),
  }
}

function resolveBorderColors(borders: TableCellBorders, context: SceneThemeContext): Partial<Record<keyof TableCellBorders, ResolvedColor>> | undefined {
  const colors: Partial<Record<keyof TableCellBorders, ResolvedColor>> = {}
  for (const side of ['left', 'right', 'top', 'bottom', 'tlToBr', 'blToTr'] as const) {
    const color = borders[side] ? resolveColor(borders[side].color, context.theme, context.colorMap) : undefined
    if (color) colors[side] = color
  }
  return Object.keys(colors).length > 0 ? colors : undefined
}

function resolveTableTextStyle(text: TableStyleText | undefined, context: SceneThemeContext): SceneResolvedTableTextStyle | undefined {
  if (!text) return undefined
  const color = text.color ? resolveColor(text.color, context.theme, context.colorMap) : undefined
  const resolved = {
    ...(color ? { color } : {}),
    ...(text.bold === undefined ? {} : { bold: text.bold }),
    ...(text.italic === undefined ? {} : { italic: text.italic }),
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined
}

/** Builds the scene-level transform from the bare model fields, omitted when nothing is set. */
function elementTransform(element: { rotation?: number; flipH?: boolean; flipV?: boolean }): ElementTransform | undefined {
  const transform: ElementTransform = {
    ...(element.rotation ? { rotation: element.rotation } : {}),
    ...(element.flipH ? { flipH: true } : {}),
    ...(element.flipV ? { flipV: true } : {}),
  }
  return Object.keys(transform).length > 0 ? transform : undefined
}

/**
 * Direct formatting wins; the shape style matrix is the fallback, which is what a shape built from
 * PowerPoint's style gallery relies on. The resolved colour stays in the scene — writing it into
 * `element.fill` would turn "follows the theme style" into a pinned colour on the next writeback.
 */
function shapeFillColor(element: { fill?: Fill; styleRef?: ShapeStyleReference }, context: SceneThemeContext): ResolvedColor | undefined {
  return resolvedFillColor(element.fill, context) ?? resolveStyleFill(element.styleRef?.fill, context.theme, context.colorMap)
}

/** Direct formatting wins, then the theme entry — the same order the fill colour follows. */
function shapeFillGradient(element: { fill?: Fill; styleRef?: ShapeStyleReference }, context: SceneThemeContext): ResolvedGradient | undefined {
  return resolvedFillGradient(element.fill, context)
    ?? resolveStyleFillGradient(element.styleRef?.fill, context.theme, context.colorMap)
}

/** Symmetric with `shapeFillGradient`: direct formatting first, then the theme entry. */
function shapeFillPattern(element: { fill?: Fill; styleRef?: ShapeStyleReference }, context: SceneThemeContext): ResolvedPattern | undefined {
  return resolvedFillPattern(element.fill, context)
    ?? resolveStyleFillPattern(element.styleRef?.fill, context.theme, context.colorMap)
}

function shapeStrokeColor(element: { stroke?: Fill; styleRef?: ShapeStyleReference }, context: SceneThemeContext): ResolvedColor | undefined {
  return resolvedFillColor(element.stroke, context) ?? resolveStyleLine(element.styleRef?.line, context.theme, context.colorMap)
}

/** Symmetric with `shapeFillGradient`; theme line entries carry no gradient, so there is no fallback. */
function shapeStrokeGradient(element: { stroke?: Fill }, context: SceneThemeContext): ResolvedGradient | undefined {
  return resolvedFillGradient(element.stroke, context)
}

/**
 * `spPr/a:ln` and `p:style/a:lnRef` merge per property in OOXML: a direct line overrides only what
 * it declares, so a shape that recoloured its outline without restating the width still gets the
 * theme's. Falling back whole would knock every such outline back to a hairline.
 */
function shapeStroke(
  element: { strokeWidth?: number; strokeStyle?: StrokeStyle | { custom: DashSegment[] }; strokeCap?: StrokeCap; strokeJoin?: StrokeJoin; strokeCompound?: StrokeCompound; strokeAlign?: StrokeAlign; styleRef?: ShapeStyleReference },
  context: SceneThemeContext,
): { width?: number; style?: StrokeStyle | { custom: DashSegment[] }; cap?: StrokeCap; join?: StrokeJoin; compound?: StrokeCompound; align?: StrokeAlign } {
  const themeLine = resolveStyleLineStroke(element.styleRef?.line, context.theme)
  const width = element.strokeWidth ?? themeLine?.width
  const style = element.strokeStyle ?? themeLine?.style
  const cap = element.strokeCap ?? themeLine?.cap
  const join = element.strokeJoin ?? themeLine?.join
  const compound = element.strokeCompound ?? themeLine?.compound
  const align = element.strokeAlign ?? themeLine?.align
  return { ...(width === undefined ? {} : { width }), ...(style === undefined ? {} : { style }), ...(cap === undefined ? {} : { cap }), ...(join === undefined ? {} : { join }), ...(compound === undefined ? {} : { compound }), ...(align === undefined ? {} : { align }) }
}

/**
 * A picture fill is the whole fill: neither the element's own colour nor the style matrix entry paints
 * under it. Compositing a transparent PNG over a fallback colour would show a colour the file never
 * asked for, and the file said the fill is this picture.
 */
/**
 * `a:custGeom` wins over `prst` when the file gave us a literal path: the preset is only the fallback
 * OOXML itself uses when a shape has no custom geometry, and unknown presets already draw a rectangle.
 */
function shapePath(element: { preset?: PresetGeometry; customGeometry?: CustomGeometry }, bounds: Rect, fallbackPreset = 'rect'): PathCommand[] {
  const custom = element.customGeometry
  if (custom) return createCustomPath(custom.paths, bounds)
  return createPresetPath(element.preset ?? fallbackPreset, bounds)
}

function scenePictureFill(element: { pictureFill?: PictureFill }, assets?: Ppt4aiDocument['assets']): ScenePictureFill | undefined {
  const fill = element.pictureFill
  if (!fill) return undefined
  const metadata = assets?.[fill.assetId]
  return {
    assetId: fill.assetId,
    ...(metadata ? { metadata: structuredClone(metadata) } : {}),
    ...(fill.sourceCrop ? { sourceCrop: structuredClone(fill.sourceCrop) } : {}),
    ...(fill.tile ? { tile: structuredClone(fill.tile) } : {}),
    ...(fill.stretch ? { stretch: structuredClone(fill.stretch) } : {}),
    ...(fill.effects ? { effects: structuredClone(fill.effects) } : {}),
  }
}

/**
 * Direct formatting wins whole, which is deliberately unlike the outline: `a:ln`'s properties merge per
 * attribute, but an `a:effectLst` is one unit — a source that wrote its own list means "use this list,
 * not the gallery's", and mixing the two would invent an effect the file never described.
 */
function shapeShadow(
  element: { shadow?: OuterShadow; styleRef?: ShapeStyleReference },
  context: SceneThemeContext,
): ResolvedShadow | undefined {
  return resolvedShadow(element.shadow, context)
    ?? resolveStyleEffect(element.styleRef?.effect, context.theme, context.colorMap)
}

/** The shadow's colour goes through the theme like any other; an unresolvable colour drops it. */
function resolvedShadow(shadow: OuterShadow | undefined, context: SceneThemeContext): ResolvedShadow | undefined {
  if (!shadow) return undefined
  const color = resolveColor(shadow.color, context.theme, context.colorMap)
  if (!color) return undefined
  return {
    color,
    ...(shadow.blurRadius === undefined ? {} : { blurRadius: shadow.blurRadius }),
    ...(shadow.distance === undefined ? {} : { distance: shadow.distance }),
    ...(shadow.direction === undefined ? {} : { direction: shadow.direction }),
  }
}

function createShapeNode(element: Extract<Element, { kind: 'shape' }>, context: SceneThemeContext, assets?: Ppt4aiDocument['assets']): SceneShapeNode {
  const node: SceneShapeNode = {
    id: element.id,
    kind: 'shape',
    bounds: element.bounds,
    path: shapePath(element, element.bounds),
  }

  if (element.fill) node.fill = element.fill
  if (element.stroke) node.stroke = element.stroke
  const pictureFill = scenePictureFill(element, assets)
  if (pictureFill) node.pictureFill = pictureFill
  const fillColor = pictureFill ? undefined : shapeFillColor(element, context)
  const strokeColor = shapeStrokeColor(element, context)
  if (fillColor) node.resolvedFillColor = fillColor
  const fillGradient = pictureFill ? undefined : shapeFillGradient(element, context)
  if (fillGradient) node.resolvedFillGradient = fillGradient
  const fillPattern = pictureFill ? undefined : shapeFillPattern(element, context)
  if (fillPattern) node.resolvedFillPattern = fillPattern
  if (strokeColor) node.resolvedStrokeColor = strokeColor
  const strokeGradient = shapeStrokeGradient(element, context)
  if (strokeGradient) node.resolvedStrokeGradient = strokeGradient
  const stroke = shapeStroke(element, context)
  if (stroke.width !== undefined) node.strokeWidth = stroke.width
  if (stroke.style !== undefined) node.strokeStyle = stroke.style
  if (stroke.cap !== undefined) node.strokeCap = stroke.cap
  if (stroke.join !== undefined) node.strokeJoin = stroke.join
  if (stroke.compound !== undefined) node.strokeCompound = stroke.compound
  if (stroke.align !== undefined) node.strokeAlign = stroke.align
  const shadow = shapeShadow(element, context)
  if (shadow) node.shadow = shadow
  const transform = elementTransform(element)
  if (transform) node.transform = transform
  return node
}

function createTextNode(
  element: Extract<Element, { kind: 'text' }>,
  context: SceneThemeContext,
  layout: SlideLayout | undefined,
  master: SlideMaster | undefined,
  assets?: Ppt4aiDocument['assets'],
): SceneTextNode {
  const normalized = normalizeTextElement(element)
  const body = mergeLevelDefaults(normalized, element, layout, master)
  const styleFontColor = resolveStyleFontColor(element.styleRef?.font, context.theme, context.colorMap)
  const styleFontFamily = resolveStyleFontFamily(element.styleRef?.font, context.theme)
  const node: SceneTextNode = {
    id: element.id,
    kind: 'text',
    bounds: element.bounds,
    text: element.text ?? body.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n'),
    layout: toSceneTextLayout(layoutText({ bounds: element.bounds, body }), context, {
      ...(styleFontColor ? { color: styleFontColor } : {}),
      ...(styleFontFamily ? { fontFamily: styleFontFamily } : {}),
    }),
  }
  if (element.fill) node.fill = element.fill
  if (element.stroke) node.stroke = element.stroke
  const pictureFill = scenePictureFill(element, assets)
  if (pictureFill) node.pictureFill = pictureFill
  const fillColor = pictureFill ? undefined : shapeFillColor(element, context)
  const strokeColor = shapeStrokeColor(element, context)
  // A shape that carries text still paints its own geometry, whether the colour came from the shape
  // or from the theme style matrix. Plain text keeps the scene shape it had before, and `rect`
  // covers a filled text box whose source declared no geometry. A picture fill needs the path too —
  // it is what the picture gets clipped to.
  if (fillColor || strokeColor || pictureFill) node.path = shapePath(element, element.bounds)
  if (fillColor) node.resolvedFillColor = fillColor
  const fillGradient = pictureFill ? undefined : shapeFillGradient(element, context)
  if (fillGradient) node.resolvedFillGradient = fillGradient
  const fillPattern = pictureFill ? undefined : shapeFillPattern(element, context)
  if (fillPattern) node.resolvedFillPattern = fillPattern
  if (strokeColor) node.resolvedStrokeColor = strokeColor
  const strokeGradient = shapeStrokeGradient(element, context)
  if (strokeGradient) node.resolvedStrokeGradient = strokeGradient
  const stroke = shapeStroke(element, context)
  if (stroke.width !== undefined) node.strokeWidth = stroke.width
  if (stroke.style !== undefined) node.strokeStyle = stroke.style
  if (stroke.cap !== undefined) node.strokeCap = stroke.cap
  if (stroke.join !== undefined) node.strokeJoin = stroke.join
  if (stroke.compound !== undefined) node.strokeCompound = stroke.compound
  if (stroke.align !== undefined) node.strokeAlign = stroke.align
  const shadow = shapeShadow(element, context)
  if (shadow) node.shadow = shadow
  const transform = elementTransform(element)
  if (transform) node.transform = transform
  return node
}

function createTableNode(element: Extract<Element, { kind: 'table' }>, context: SceneThemeContext, tableStyles?: Ppt4aiDocument['tableStyles'], assets?: Ppt4aiDocument['assets']): SceneTableNode {
  const tableLayout = layoutTable(element)
  const node: SceneTableNode = {
    id: element.id,
    kind: 'table',
    bounds: { ...element.bounds },
    layout: {
      ...tableLayout,
      cells: tableLayout.cells.map((cell) => {
        const sourceCell = element.rows[cell.row]?.cells.find((candidate) => candidate.column === cell.column)
        if (!sourceCell) throw new Error(`table layout references missing cell: ${element.id}[${cell.row},${cell.column}]`)
        const resolvedStyle = resolveTableCellStyle(element, sourceCell, cell.row, cell.column, tableStyles)
        const cellPicture = scenePictureFill(sourceCell, assets)
        // A picture in the cell is the cell's fill, so no colour paints under it — the rule shapes follow.
        const fillColor = cellPicture ? undefined : resolvedFillColor(resolvedStyle.fill, context)
        const borderColors = resolveBorderColors(resolvedStyle.borders, context)
        const textStyle = resolveTableTextStyle(resolvedStyle.text, context)
        const body = mergeCellBodyProperties(mergeTableTextDefaults(cell.body, resolvedStyle.text), sourceCell.cellBodyPr)
        return {
          ...cell,
          resolvedStyle,
          textLayout: toSceneTextLayout(layoutText({ bounds: cell.bounds, body }), context),
          ...(cellPicture ? { pictureFill: cellPicture } : {}),
          ...(fillColor ? { resolvedFillColor: fillColor } : {}),
          ...(borderColors ? { resolvedBorderColors: borderColors } : {}),
          ...(textStyle ? { resolvedTextStyle: textStyle } : {}),
        }
      }),
    },
  }
  if (element.fill) node.fill = structuredClone(element.fill)
  if (element.stroke) node.stroke = structuredClone(element.stroke)
  const transform = elementTransform(element)
  if (transform) node.transform = transform
  return node
}

function createImageNode(element: Extract<Element, { kind: 'image' }>, assets?: Ppt4aiDocument['assets']): SceneImageNode {
  const metadata = assets?.[element.assetId]
  return {
    id: element.id,
    kind: 'image',
    bounds: structuredClone(element.bounds),
    assetId: element.assetId,
    ...(metadata ? { metadata: structuredClone(metadata) } : {}),
    ...(element.transform ? { transform: structuredClone(element.transform) } : {}),
    ...(element.sourceCrop ? { sourceCrop: structuredClone(element.sourceCrop) } : {}),
    ...(element.maskPreset ? { maskPreset: element.maskPreset } : {}),
    ...(element.effects ? { effects: structuredClone(element.effects) } : {}),
  }
}

/**
 * A group's own space mapping plus the rotation pivot it contributes to descendants. Child space
 * mappings apply innermost-first, same as rotation, so the array is ordered outermost first.
 */
interface GroupSpace {
  childSpace?: Rect
  target: Rect
}

function applyChildSpaces(bounds: Rect, spaces: readonly GroupSpace[]): Rect {
  let mapped = bounds
  for (let index = spaces.length - 1; index >= 0; index -= 1) {
    const space = spaces[index]!
    if (space.childSpace) mapped = mapChildSpace(mapped, space.childSpace, space.target)
  }
  return mapped
}

/**
 * Cascade before the node is built, not after: text and table layouts hold absolute coordinates
 * derived from bounds, so moving bounds afterwards would leave their lines and cells behind.
 */
function cascadeElement(element: Element, ancestors: readonly GroupTransform[], spaces: readonly GroupSpace[]): Element {
  if (element.kind === 'group') return element
  const mapped = applyChildSpaces(element.bounds, spaces)
  if (element.kind === 'image') {
    const cascaded = cascadeTransform(mapped, element.transform ?? {}, ancestors)
    const transform: ElementTransform = {
      ...element.transform,
      ...(cascaded.rotation ? { rotation: cascaded.rotation } : {}),
      ...(cascaded.flipH ? { flipH: true } : {}),
      ...(cascaded.flipV ? { flipV: true } : {}),
    }
    if (!cascaded.rotation) delete transform.rotation
    if (!cascaded.flipH) delete transform.flipH
    if (!cascaded.flipV) delete transform.flipV
    return {
      ...element,
      bounds: cascaded.bounds,
      ...(Object.keys(transform).length > 0 ? { transform } : {}),
    }
  }
  const cascaded = cascadeTransform(mapped, element, ancestors)
  const flipped = { ...element, bounds: cascaded.bounds, rotation: cascaded.rotation }
  if (cascaded.flipH) flipped.flipH = true
  else delete flipped.flipH
  if (cascaded.flipV) flipped.flipV = true
  else delete flipped.flipV
  return flipped
}

function createNode(
  element: Element,
  context: SceneThemeContext,
  layout: SlideLayout | undefined,
  master: SlideMaster | undefined,
  tableStyles?: Ppt4aiDocument['tableStyles'],
  assets?: Ppt4aiDocument['assets'],
): SceneNode | undefined {
  switch (element.kind) {
    case 'shape':
      return createShapeNode(element, context, assets)
    case 'text':
      return createTextNode(element, context, layout, master, assets)
    case 'table':
      return createTableNode(element, context, tableStyles, assets)
    case 'image':
      return createImageNode(element, assets)
    case 'group':
      return undefined
    default:
      return undefined
  }
}

export function documentToSceneGraph(value: Ppt4aiDocument): SceneGraph {
  const slideId = value.slideOrder[0]
  if (!slideId) throw new Error('input must contain at least one slide')

  const slide = value.slides[slideId]
  if (!slide) throw new Error(`input references missing slide: ${slideId}`)

  const nodes: SceneNode[] = []
  const layout = slide.layoutId ? value.layouts?.[slide.layoutId] : undefined
  const masterId = slide.masterId ?? layout?.masterId
  const master = masterId ? value.masters?.[masterId] : undefined
  const theme = master?.themeId ? value.themes?.[master.themeId] : undefined
  const context: SceneThemeContext = {
    colorMap: mergeColorMaps(master?.colorMap, layout?.colorMapOverride, slide.colorMapOverride),
    ...(theme ? { theme } : {}),
  }
  const visited = new Set<string>()
  const groups: SceneGroup[] = []
  const appendElement = (
    elementId: string,
    ancestorIds: string[] = [],
    ancestors: readonly GroupTransform[] = [],
    spaces: readonly GroupSpace[] = [],
  ): void => {
    if (visited.has(elementId)) return
    visited.add(elementId)
    const element = value.elements[elementId]
    if (!element) return
    if (element.kind === 'group') {
      const mappedBounds = applyChildSpaces(element.bounds, spaces)
      const cascaded = cascadeTransform(mappedBounds, element, ancestors)
      const groupIndex = groups.push({
        id: element.id,
        bounds: cascaded.bounds === element.bounds ? structuredClone(element.bounds) : cascaded.bounds,
        childIds: [...element.childIds],
        ancestorIds: [...ancestorIds],
        paintOrder: nodes.length - 1,
        ...(cascaded.rotation ? { rotation: cascaded.rotation } : {}),
        ...(cascaded.flipH ? { flipH: true } : {}),
        ...(cascaded.flipV ? { flipV: true } : {}),
      }) - 1
      // Descendants are mapped into this group's on-slide box before any outer mapping applies.
      const childSpaces: GroupSpace[] = [
        ...spaces,
        { ...(element.childSpace ? { childSpace: element.childSpace } : {}), target: element.bounds },
      ]
      // The pivot is the group's mapped centre: child space applies before rotation and mirroring.
      const childAncestors = element.rotation || element.flipH || element.flipV
        ? [...ancestors, {
            pivot: boundsCentre(mappedBounds),
            ...(element.rotation ? { rotation: element.rotation } : {}),
            ...(element.flipH ? { flipH: true } : {}),
            ...(element.flipV ? { flipV: true } : {}),
          }]
        : ancestors
      for (const childId of element.childIds) appendElement(childId, [...ancestorIds, element.id], childAncestors, childSpaces)
      groups[groupIndex]!.paintOrder = nodes.length - 1
      return
    }
    const inherited = resolveInheritedElement(element, layout, master)
    const cascaded = ancestors.length > 0 || spaces.length > 0
      ? cascadeElement(inherited, ancestors, spaces)
      : inherited
    const node = createNode(cascaded, context, layout, master, value.tableStyles, value.assets)
    if (node) nodes.push(node)
  }
  for (const elementId of slide.elementIds) appendElement(elementId)

  const background = resolveSlideBackground(slide, layout, master, theme, context.colorMap)
  const backgroundFill = slide.background?.fill ?? layout?.background?.fill ?? master?.background?.fill
  const backgroundGradient = backgroundFill?.gradient ? resolvedFillGradient(backgroundFill, context) : undefined
  // The whole `p:bg` replaces its inherited counterpart in OOXML, so the picture comes from the first
  // background in the chain that declares one — the same order `resolveSlideBackground` walks.
  const declared = slide.background ?? layout?.background ?? master?.background
  const backgroundPicture = scenePictureFill({ ...(declared?.pictureFill ? { pictureFill: declared.pictureFill } : {}) }, value.assets)

  return {
    slideId,
    page: { ...value.page },
    nodes,
    ...(background ? { background } : {}),
    ...(backgroundGradient ? { backgroundGradient } : {}),
    ...(backgroundPicture ? { backgroundPicture } : {}),
    ...(groups.length > 0 ? { groups } : {}),
  }
}
