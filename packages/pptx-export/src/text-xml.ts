import type { Color, Fill, LevelDefaults, TextAutofit, TextBody, TextBullet, TextMarks, TextParagraph } from '@ppt4ai/model'

export type XmlAttribute = [string, string | number | boolean | undefined]

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

export function escapeXml(value: string | number): string {
  const source = String(value)
  assertXmlCharacters(source)
  return source
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function attrs(values: readonly XmlAttribute[]): string {
  return values
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeXml(value as string | number)}"`)
    .join('')
}

export function booleanAttribute(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? '1' : '0'
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

/**
 * A gradient fill writes `a:gradFill`, not the flat `a:solidFill` its `color` would produce. Both
 * export paths and the writeback replacement go through here, so the gradient reaches all of them.
 * Stops keep model order, which is the source's own order.
 */
export function serializeFillXml(fill: Fill | undefined): string {
  if (!fill) return ''
  const gradient = fill.gradient
  if (!gradient) {
    // `a:pattFill` is the same `EG_FillProperties` choice as the other two, so exactly one is written.
    // A gradient still wins when a hand-built model states both, which is the precedence painting uses.
    const pattern = fill.pattern
    if (pattern) {
      return `<a:pattFill${attrs([['prst', pattern.preset]])}>`
        + `<a:fgClr>${serializeColorXml(pattern.foreground)}</a:fgClr>`
        + `<a:bgClr>${serializeColorXml(pattern.background)}</a:bgClr>`
        + '</a:pattFill>'
    }
    return `<a:solidFill>${serializeColorXml(fill.color)}</a:solidFill>`
  }
  const stops = gradient.stops
    .map((stop) => `<a:gs${attrs([['pos', stop.pos]])}>${serializeColorXml(stop.color)}</a:gs>`)
    .join('')
  // `a:lin` and `a:path` are a choice, and the path form wins when a hand-built model states both —
  // the same precedence painting uses.
  const rect = gradient.fillToRect
  const form = gradient.path
    ? `<a:path${attrs([['path', gradient.path]])}>`
      + `${rect ? `<a:fillToRect${attrs([['l', rect.left], ['t', rect.top], ['r', rect.right], ['b', rect.bottom]])}/>` : ''}`
      + '</a:path>'
    : `<a:lin${attrs([['ang', gradient.angle], ['scaled', booleanAttribute(gradient.scaled)]])}/>`
  return `<a:gradFill><a:gsLst>${stops}</a:gsLst>${form}</a:gradFill>`
}

/**
 * `a:spAutoFit` carries no attributes in ECMA-376 -- `lnSpcReduction` belongs to `a:normAutofit`.
 * `maxHeight` therefore cannot be persisted; it stays in the model because the layout engine caps
 * the resized height with it.
 */
function serializeAutofit(autofit: TextAutofit | undefined): string {
  if (!autofit) return ''
  if (autofit.type === 'shrink') return `<a:normAutofit${attrs([['fontScale', autofit.minFontScale]])}/>`
  if (autofit.type === 'resize') return '<a:spAutoFit/>'
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

/** `CT_TextCharacterProperties` orders the typefaces latin, ea, cs, so they are emitted in that order. */
function serializeTypefaces(marks: TextMarks): string {
  return ([['latin', marks.fontFamily], ['ea', marks.fontFamilyEa], ['cs', marks.fontFamilyCs]] as const)
    .filter(([, typeface]) => Boolean(typeface))
    .map(([element, typeface]) => `<a:${element}${attrs([['typeface', typeface]])}/>`)
    .join('')
}

/** `tag` is `a:rPr` on a run and `a:defRPr` in a level default: the same attributes either way. */
function serializeMarks(marks: TextMarks | undefined, tag = 'a:rPr'): string {
  if (!marks) return ''
  return `<${tag}${attrs([
    ['sz', marks.fontSize === undefined ? undefined : Math.round(marks.fontSize * 100)],
    ['b', booleanAttribute(marks.bold)],
    ['i', booleanAttribute(marks.italic)],
    ['u', marks.underline],
    ['baseline', marks.baseline],
  ])}>${serializeFillXml(marks.color)}${serializeTypefaces(marks)}</${tag}>`
}

function serializeBullet(bullet: TextBullet): string {
  if (bullet.type === 'char') {
    const runProperties = bullet.fontFamily ? `<a:rPr${attrs([['typeface', bullet.fontFamily]])}/>` : ''
    return runProperties
      ? `<a:buChar char="${escapeXml(bullet.char)}">${runProperties}</a:buChar>`
      : `<a:buChar char="${escapeXml(bullet.char)}"/>`
  }
  // The model holds the file's own word, so it writes back verbatim — mapping three families onto three
  // words used to turn every roman-numeral or parenthesised list into `arabicPeriod`.
  return `<a:buAutoNum${attrs([['type', bullet.scheme], ['startAt', bullet.startAt]])}/>`
}

function toPointHundredths(value: number): number {
  return Math.round(value / 127)
}

function serializeParagraphProperties(paragraph: TextParagraph, tag = 'a:pPr', defaultMarks?: TextMarks): string {
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
  // `a:defRPr` closes the `CT_TextParagraphProperties` sequence, after the bullet elements.
  if (defaultMarks) children.push(serializeMarks(defaultMarks, 'a:defRPr'))
  if (!paragraphAttributes && children.length === 0) return ''
  return children.length > 0
    ? `<${tag}${paragraphAttributes}>${children.join('')}</${tag}>`
    : `<${tag}${paragraphAttributes}/>`
}

/**
 * An `a:lstStyle` or a `p:txStyles` entry: `a:lvl1pPr`…`a:lvl9pPr` in ascending level order, each the
 * same paragraph properties a paragraph writes plus the level's own `a:defRPr`. Sharing the paragraph
 * serializer is the point — a level's `algn` or `marL` cannot drift from a paragraph's.
 */
export function serializeLevelDefaultsXml(levels: readonly LevelDefaults[]): string {
  return [...levels]
    .sort((first, second) => first.level - second.level)
    .map((level) => serializeParagraphProperties(
      { ...(level.attrs ? { attrs: level.attrs } : {}), runs: [] },
      `a:lvl${level.level + 1}pPr`,
      level.marks,
    ))
    .join('')
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
  // The paragraph's own `a:defRPr`. Only the `a:lstStyle` path used to pass it, so a paragraph-level one
  // was read on import and then dropped by every sourceless export.
  const properties = serializeParagraphProperties(paragraph, 'a:pPr', paragraph.attrs?.defaultMarks)
  const runs = paragraph.runs.map((run) => serializeRun(run.text, run.marks)).join('')
  const content = properties + runs
  return content ? `<a:p>${content}</a:p>` : '<a:p/>'
}

/**
 * `prefix` applies to the outer `txBody` tag only: a shape needs `p:txBody` while a table cell
 * needs `a:txBody`, but everything inside is `a:` in both contexts. `listStyle` fills the `a:lstStyle`
 * this always emitted empty — a master or layout placeholder carries its level defaults there.
 */
export function serializeTextBodyXml(body: TextBody, prefix = 'p:', listStyle?: readonly LevelDefaults[]): string {
  const paragraphs = body.paragraphs.length > 0 ? body.paragraphs : [{ runs: [] }]
  const levels = listStyle && listStyle.length > 0 ? `<a:lstStyle>${serializeLevelDefaultsXml(listStyle)}</a:lstStyle>` : '<a:lstStyle/>'
  return `<${prefix}txBody>${serializeBodyProperties(body)}${levels}${paragraphs.map(serializeParagraph).join('')}</${prefix}txBody>`
}
