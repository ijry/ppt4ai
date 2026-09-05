import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

function slideWith(line: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Dashed"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>'
    + `<a:prstGeom prst="rect"/>${line}</p:spPr>`
    + '</p:sp></p:spTree></p:cSld></p:sld>'
}

const navy = '<a:solidFill><a:srgbClr val="203864"/></a:solidFill>'

async function strokeStyleOf(line: string) {
  const document = await importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideWith(line) }))
  const shape = document.elements.el_1
  if (shape?.kind !== 'shape') throw new Error('fixture did not import as a shape')
  return shape.strokeStyle
}

describe('custom dash on import', () => {
  /** Before this the segment list was dropped and the outline came back as a plain solid line. */
  it('reads every segment in order', async () => {
    expect(await strokeStyleOf(`<a:ln w="38100">${navy}<a:custDash>`
      + '<a:ds d="800000" sp="300000"/><a:ds d="100000" sp="300000"/>'
      + '</a:custDash></a:ln>')).toEqual({
      custom: [{ dash: 800000, space: 300000 }, { dash: 100000, space: 300000 }],
    })
  })

  it('reads a single segment', async () => {
    expect(await strokeStyleOf(`<a:ln w="38100">${navy}<a:custDash><a:ds d="50000" sp="25000"/></a:custDash></a:ln>`))
      .toEqual({ custom: [{ dash: 50000, space: 25000 }] })
  })

  it('drops a segment missing either percentage', async () => {
    expect(await strokeStyleOf(`<a:ln w="38100">${navy}<a:custDash>`
      + '<a:ds d="50000"/><a:ds sp="25000"/><a:ds d="60000" sp="20000"/>'
      + '</a:custDash></a:ln>')).toEqual({ custom: [{ dash: 60000, space: 20000 }] })
  })

  it('drops a segment whose percentage is unusable', async () => {
    expect(await strokeStyleOf(`<a:ln w="38100">${navy}<a:custDash>`
      + '<a:ds d="-5" sp="25000"/><a:ds d="thick" sp="1"/><a:ds d="40000" sp="10000"/>'
      + '</a:custDash></a:ln>')).toEqual({ custom: [{ dash: 40000, space: 10000 }] })
  })

  /**
   * These percentages are relative to the line width and `ST_PositivePercentage` has no ceiling, so a
   * segment longer than the width is ordinary. A draft of this parser clamped at 100000 and dropped it.
   */
  it('keeps a segment longer than the line width', async () => {
    expect(await strokeStyleOf(`<a:ln w="38100">${navy}<a:custDash>`
      + '<a:ds d="400000" sp="300000"/></a:custDash></a:ln>'))
      .toEqual({ custom: [{ dash: 400000, space: 300000 }] })
  })

  /** No usable segment is the same as no dash at all, so the outline stays solid rather than empty. */
  it('leaves the style unset when no segment survives', async () => {
    expect(await strokeStyleOf(`<a:ln w="38100">${navy}<a:custDash/></a:ln>`)).toBeUndefined()
    expect(await strokeStyleOf(`<a:ln w="38100">${navy}<a:custDash><a:ds d="1"/></a:custDash></a:ln>`)).toBeUndefined()
  })

  /**
   * `EG_LineDashProperties` is a choice, so a file stating both is malformed. The preset wins rather
   * than the parser throwing — the tolerance `parseDirectFill` already shows for stacked fills.
   */
  it('prefers the preset when a malformed line states both', async () => {
    expect(await strokeStyleOf(`<a:ln w="38100">${navy}<a:prstDash val="lgDash"/>`
      + '<a:custDash><a:ds d="50000" sp="25000"/></a:custDash></a:ln>')).toBe('lgDash')
  })

  it('still reads a preset dash and still drops solid', async () => {
    expect(await strokeStyleOf(`<a:ln w="38100">${navy}<a:prstDash val="sysDot"/></a:ln>`)).toBe('sysDot')
    expect(await strokeStyleOf(`<a:ln w="38100">${navy}<a:prstDash val="solid"/></a:ln>`)).toBeUndefined()
    expect(await strokeStyleOf(`<a:ln w="38100">${navy}</a:ln>`)).toBeUndefined()
  })
})
