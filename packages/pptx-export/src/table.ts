import type {
  Color,
  Fill,
  TableBorder,
  TableCell,
  TableCellBorders,
  TableElement,
  TextBody,
  TextMarks,
  TextParagraph,
  TextAutofit,
} from '@ppt4ai/model'

const namespace = 'http://schemas.openxmlformats.org/drawingml/2006/main'

function escapeXml(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function attrs(values: Array<[string, string | number | boolean | undefined]>): string {
  return values
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeXml(value as string | number)}"`)
    .join('')
}

function booleanAttribute(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? '1' : '0'
}

function serializeColor(color: Color): string {
  const transformXml = (color.transforms ?? [])
    .map((transform) => `<a:${transform.type}${attrs([['val', transform.value]])}/>`)
    .join('')
  if (color.type === 'scrgb') {
    const channels = color.v.split(',')
    const colorAttributes = attrs([['r', channels[0]], ['g', channels[1]], ['b', channels[2]]])
    return transformXml ? `<a:scrgbClr${colorAttributes}>${transformXml}</a:scrgbClr>` : `<a:scrgbClr${colorAttributes}/>`
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
    ? `<a:${element}${colorAttributes}>${transformXml}</a:${element}>`
    : `<a:${element}${colorAttributes}/>`
}

function serializeFill(fill: Fill | undefined): string {
  return fill ? `<a:solidFill>${serializeColor(fill.color)}</a:solidFill>` : ''
}

function serializeBorder(name: string, border: TableBorder | undefined): string {
  if (!border) return ''
  if (border.style === 'none') return `<a:${name}${attrs([['w', border.width]])}><a:noFill/></a:${name}>`
  const dash = border.style === 'dash' || border.style === 'dot'
    ? `<a:prstDash${attrs([['val', border.style]])}/>`
    : ''
  return `<a:${name}${attrs([['w', border.width]])}>${serializeFill({ color: border.color })}${dash}</a:${name}>`
}

function serializeBorders(borders: TableCellBorders | undefined): string {
  if (!borders) return ''
  return serializeBorder('lnL', borders.left)
    + serializeBorder('lnR', borders.right)
    + serializeBorder('lnT', borders.top)
    + serializeBorder('lnB', borders.bottom)
}

function serializeBodyProperties(body: TextBody): string {
  const properties = body.bodyPr
  const verticalAlign = properties?.verticalAlign === 'middle' ? 'ctr' : properties?.verticalAlign === 'bottom' ? 'b' : undefined
  const vertical = properties?.vertical === 'vertical' ? 'vert' : undefined
  const inset = properties?.insets
  const bodyPrAttributes = attrs([
    ['lIns', inset?.left], ['tIns', inset?.top], ['rIns', inset?.right], ['bIns', inset?.bottom],
    ['wrap', properties?.wrap], ['anchor', verticalAlign], ['vert', vertical],
  ])
  const autofit = serializeAutofit(properties?.autofit)
  return autofit ? `<a:bodyPr${bodyPrAttributes}>${autofit}</a:bodyPr>` : `<a:bodyPr${bodyPrAttributes}/>`
}

function serializeAutofit(autofit: TextAutofit | undefined): string {
  if (!autofit) return ''
  if (autofit.type === 'shrink') return `<a:normAutofit${attrs([['fontScale', autofit.minFontScale]])}/>`
  if (autofit.type === 'resize') return `<a:spAutoFit${attrs([['lnSpcReduction', autofit.maxHeight]])}/>`
  return '<a:noAutofit/>'
}

function serializeMarks(marks: TextMarks | undefined): string {
  if (!marks) return ''
  return `<a:rPr${attrs([
    ['sz', marks.fontSize === undefined ? undefined : Math.round(marks.fontSize * 100)],
    ['b', booleanAttribute(marks.bold)],
    ['i', booleanAttribute(marks.italic)],
    ['u', marks.underline === undefined ? undefined : marks.underline === 'single' ? 'sng' : 'none'],
    ['baseline', marks.baseline],
  ])}>${serializeFill(marks.color)}${marks.fontFamily ? `<a:latin${attrs([['typeface', marks.fontFamily]])}/>` : ''}</a:rPr>`
}

function serializeParagraph(paragraph: TextParagraph): string {
  const attrsXml = attrs([
    ['algn', paragraph.attrs?.align === 'center' ? 'ctr' : paragraph.attrs?.align],
    ['lvl', paragraph.attrs?.level],
    ['marL', paragraph.attrs?.marginLeft],
    ['indent', paragraph.attrs?.indent],
  ])
  const paragraphProperties = attrsXml ? `<a:pPr${attrsXml}/>` : ''
  const runs = paragraph.runs.map((run) => `<a:r>${serializeMarks(run.marks)}<a:t>${escapeXml(run.text)}</a:t></a:r>`).join('')
  const content = paragraphProperties + runs
  return content ? `<a:p>${content}</a:p>` : '<a:p/>'
}

function serializeTextBody(body: TextBody): string {
  return `<a:txBody>${serializeBodyProperties(body)}${body.paragraphs.map(serializeParagraph).join('')}</a:txBody>`
}

function serializeCellProperties(cell: TableCell, continuation: 'horizontal' | 'vertical' | undefined): string {
  const properties = attrs([
    ['gridSpan', !continuation && cell.colSpan && cell.colSpan > 1 ? cell.colSpan : undefined],
    ['rowSpan', !continuation && cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined],
    ['hMerge', continuation === 'horizontal' ? '1' : undefined],
    ['vMerge', continuation === 'vertical' ? '1' : undefined],
  ])
  const content = continuation ? '' : serializeFill(cell.fill) + serializeBorders(cell.borders)
  return content ? `<a:tcPr${properties}>${content}</a:tcPr>` : `<a:tcPr${properties}/>`
}

function emptyCell(): TableCell {
  return { column: 0, body: { paragraphs: [{ runs: [] }] } }
}

function serializeCell(cell: TableCell, continuation: 'horizontal' | 'vertical' | undefined): string {
  const body = continuation ? serializeTextBody(emptyCell().body) : serializeTextBody(cell.body)
  return `<a:tc>${body}${serializeCellProperties(cell, continuation)}</a:tc>`
}

function serializeRow(table: TableElement, rowIndex: number): string {
  const row = table.rows[rowIndex]
  if (!row) return ''
  const origins = new Map<number, TableCell>()
  for (const cell of row.cells) origins.set(cell.column, cell)
  const previousOrigins = new Map<number, { cell: TableCell; row: number }>()
  for (let priorRow = 0; priorRow < rowIndex; priorRow += 1) {
    for (const cell of table.rows[priorRow]?.cells ?? []) {
      const rowSpan = cell.rowSpan ?? 1
      const colSpan = cell.colSpan ?? 1
      if (priorRow + rowSpan > rowIndex) {
        for (let column = cell.column; column < cell.column + colSpan; column += 1) previousOrigins.set(column, { cell, row: priorRow })
      }
    }
  }
  const cells: string[] = []
  let column = 0
  while (column < table.columns.length) {
    const origin = origins.get(column)
    if (origin) {
      const colSpan = origin.colSpan ?? 1
      cells.push(serializeCell(origin, undefined))
      column += colSpan
      continue
    }
    const previous = previousOrigins.get(column)
    if (previous && previous.cell.column === column) {
      const colSpan = previous.cell.colSpan ?? 1
      cells.push(serializeCell(previous.cell, 'vertical'))
      column += colSpan
      continue
    }
    cells.push(serializeCell(emptyCell(), undefined))
    column += 1
  }
  return `<a:tr${attrs([['h', row.height]])}>${cells.join('')}</a:tr>`
}

function serializeTableProperties(table: TableElement): string {
  const style = table.style
  return `<a:tblPr${attrs([
    ['tableStyleId', style?.styleId],
    ['firstRow', booleanAttribute(style?.firstRow)],
    ['lastRow', booleanAttribute(style?.lastRow)],
    ['firstCol', booleanAttribute(style?.firstColumn)],
    ['lastCol', booleanAttribute(style?.lastColumn)],
    ['bandRow', booleanAttribute(style?.bandRow)],
    ['bandCol', booleanAttribute(style?.bandColumn)],
  ])}>${serializeFill(table.fill)}</a:tblPr>`
}

export function serializeTableXml(table: TableElement): string {
  const grid = `<a:tblGrid>${table.columns.map((width) => `<a:gridCol${attrs([['w', width]])}/>`).join('')}</a:tblGrid>`
  return `<a:tbl xmlns:a="${namespace}">${serializeTableProperties(table)}${grid}${table.rows.map((_, rowIndex) => serializeRow(table, rowIndex)).join('')}</a:tbl>`
}
