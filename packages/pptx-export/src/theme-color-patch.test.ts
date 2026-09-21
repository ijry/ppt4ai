import type { Color, Theme } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { rewriteThemeXml } from './theme-writeback.js'

/**
 * A theme colour slot is patched, not rebuilt. Replacing the whole `a:srgbClr` cost every attribute this
 * project does not model — `a:sysClr/@val`, the system colour name, was overwritten with a hardcoded
 * `windowText`, which is the opposite colour of `window` at the OS level — and looking for the old colour
 * by a name set that omitted `a:hslClr` appended the new one beside it, leaving two colours inside one
 * slot, which `EG_ColorChoice` forbids and no reader accepts.
 */

function theme(slot: string): string {
  return '<a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Custom">'
    + `<a:accent1 data-slot="keep">${slot}<a:extLst data-ext="keep"/></a:accent1>`
    + '</a:clrScheme><a:fontScheme/></a:themeElements></a:theme>'
}

function rewritten(slot: string, accent1: Color | null): string {
  return rewriteThemeXml(theme(slot), { id: 'theme_1', colors: { accent1 } } satisfies Theme)
}

function accentOf(xml: string): string {
  return xml.match(/<a:accent1[^>]*>.*?<\/a:accent1>/u)?.[0] ?? xml
}

const withTransforms = '<a:srgbClr val="336699" data-keep="yes"><a:lumMod val="80000" data-t="keep"/><a:satMod val="160000"/></a:srgbClr>'
const sameTransforms: Color['transforms'] = [{ type: 'lumMod', value: 80000 }, { type: 'satMod', value: 160000 }]

describe('a theme colour slot is patched in place', () => {
  it('changes only the value attribute when just the colour differs', () => {
    const output = rewritten(withTransforms, { type: 'srgb', v: 'FF0000', transforms: sameTransforms })

    expect(accentOf(output)).toBe('<a:accent1 data-slot="keep">'
      + '<a:srgbClr val="FF0000" data-keep="yes"><a:lumMod val="80000" data-t="keep"/><a:satMod val="160000"/></a:srgbClr>'
      + '<a:extLst data-ext="keep"/></a:accent1>')
  })

  it('keeps the quote character the source used, and writes one value only', () => {
    const output = rewritten("<a:srgbClr val='336699'/>", { type: 'srgb', v: 'FF0000' })

    expect(output).toContain("<a:srgbClr val='FF0000'/>")
    expect(output.split('val=').length - 1).toBe(1)
  })

  /** The system colour name is not modeled, so the only safe thing to do with it is leave it alone. */
  it('leaves a:sysClr/@val alone and patches only lastClr', () => {
    const output = rewritten('<a:sysClr val="window" lastClr="FFFFFF"/>', { type: 'system', v: '112233' })

    expect(output).toContain('<a:sysClr val="window" lastClr="112233"/>')
  })

  it('supplies the required val a source omitted', () => {
    const output = rewritten('<a:sysClr lastClr="FFFFFF"/>', { type: 'system', v: '112233' })

    expect(output).toContain('<a:sysClr val="windowText" lastClr="112233"/>')
  })

  it('patches one scrgb channel and leaves the others', () => {
    const output = rewritten('<a:scrgbClr r="20000" g="30000" b="40000" data-keep="yes"/>', { type: 'scrgb', v: '20000,30000,50000' })

    expect(output).toContain('<a:scrgbClr r="20000" g="30000" b="50000" data-keep="yes"/>')
  })

  it('swaps the children when the transform list changes, keeping the element attributes', () => {
    const output = rewritten(withTransforms, { type: 'srgb', v: '336699', transforms: [{ type: 'alpha', value: 50000 }] })

    expect(output).toContain('<a:srgbClr val="336699" data-keep="yes"><a:alpha val="50000"/></a:srgbClr>')
  })

  it('collapses to the self-closing form when the transforms are cleared', () => {
    const output = rewritten(withTransforms, { type: 'srgb', v: '336699' })

    expect(output).toContain('<a:srgbClr val="336699" data-keep="yes"/>')
  })

  it('writes a valueless switch transform without a val attribute', () => {
    const output = rewritten('<a:srgbClr val="336699"/>', { type: 'srgb', v: '336699', transforms: [{ type: 'comp' }] })

    expect(output).toContain('<a:srgbClr val="336699"><a:comp/></a:srgbClr>')
  })

  it('swaps the element when the kind of colour changes, keeping the slot around it', () => {
    const output = rewritten(withTransforms, { type: 'scheme', v: 'accent2' })

    expect(accentOf(output)).toBe('<a:accent1 data-slot="keep"><a:schemeClr val="accent2"/><a:extLst data-ext="keep"/></a:accent1>')
  })

  /** Two colours in one slot is what appending beside an unreadable one produced. */
  it('replaces a colour it cannot read rather than writing a second one', () => {
    const output = rewritten('<a:hslClr hue="0" sat="0" lum="0"/>', { type: 'srgb', v: 'FF0000' })

    expect(accentOf(output)).toBe('<a:accent1 data-slot="keep"><a:srgbClr val="FF0000"/><a:extLst data-ext="keep"/></a:accent1>')
  })

  /** This used to throw `theme source malformed` and take the whole export down with it. */
  it('repairs a value it cannot read instead of failing the export', () => {
    const output = rewritten('<a:srgbClr val="zz" data-keep="yes"/>', { type: 'srgb', v: 'FF0000' })

    expect(output).toContain('<a:srgbClr val="FF0000" data-keep="yes"/>')
  })

  it('still expands an empty slot and writes the colour into it', () => {
    const output = rewriteThemeXml(
      '<a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Custom"><a:accent1/></a:clrScheme><a:fontScheme/></a:themeElements></a:theme>',
      { id: 'theme_1', colors: { accent1: { type: 'srgb', v: 'FF0000' } } },
    )

    expect(output).toContain('<a:accent1><a:srgbClr val="FF0000"/></a:accent1>')
  })

  /**
   * `val='050000'` is the same number the model carries and a spelling the serializer would not produce,
   * so byte-identity here says the transform list compared equal rather than being rewritten to itself.
   */
  it('writes nothing at all when the slot already says what the model says', () => {
    const source = theme("<a:srgbClr val='336699'><a:alpha val='050000'/></a:srgbClr>")

    expect(rewriteThemeXml(source, {
      id: 'theme_1',
      colors: { accent1: { type: 'srgb', v: '336699', transforms: [{ type: 'alpha', value: 50000 }] } },
    })).toBe(source)
  })
})
