import type { ElementDefaults, Fill } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { rewriteMasterXml } from './master-layout-writeback.js'

/**
 * A placeholder's fill is read by the element path's own `parseDirectFill`, so the model carries the
 * gradients and patterns a master or layout states. The writeback's own reader did not: it only knew a
 * `solidFill`'s colour, so an untouched gradient compared as "no fill" and every export flattened it to
 * its first stop. `rewriteMasterXml` runs on every writeback export, not only on an edited placeholder,
 * so that flattening did not need anyone to touch the deck.
 *
 * These pin the two halves of the fix: the comparison sees what the model sees, and a change within one
 * kind of fill patches the part that changed instead of the node.
 */

function master(shapeProperties: string): string {
  return '<p:sldMaster xmlns:p="p" xmlns:d="drawing"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + `<p:spPr>${shapeProperties}</p:spPr></p:sp>`
    + '</p:spTree></p:cSld></p:sldMaster>'
}

function rewritten(shapeProperties: string, fill: Fill): string {
  return rewriteMasterXml(master(shapeProperties), { title: { fill } }, undefined, 'master_1')
}

/**
 * Each source fixture spells one thing the way the serializer would not — `a:lin`'s attributes in the
 * other order, an inset in the other order, a colour in single quotes. That is what makes "unedited comes
 * back byte for byte" mean anything: a comparison that called the fill changed would rewrite that part in
 * the canonical spelling even when the values match, so byte-identity here is evidence that nothing was
 * written at all rather than that the rewrite happened to agree.
 */
const gradientNode = '<d:gradFill flip="none" rotWithShape="1"><d:gsLst>'
  + '<d:gs pos="0"><d:srgbClr val="112233"/></d:gs>'
  + '<d:gs pos="100000"><d:srgbClr val="445566"/></d:gs>'
  + '</d:gsLst><d:lin scaled="0" ang="5400000"/><d:tileRect l="10000"/></d:gradFill>'

const gradient: Fill = {
  color: { type: 'srgb', v: '112233' },
  gradient: {
    stops: [
      { pos: 0, color: { type: 'srgb', v: '112233' } },
      { pos: 100000, color: { type: 'srgb', v: '445566' } },
    ],
    angle: 5400000,
    scaled: false,
  },
}

const radialNode = '<d:gradFill rotWithShape="1"><d:gsLst>'
  + '<d:gs pos="0"><d:srgbClr val="112233"/></d:gs>'
  + '<d:gs pos="100000"><d:srgbClr val="445566"/></d:gs>'
  + '</d:gsLst><d:path path="circle"><d:fillToRect t="20000" l="50000"/></d:path></d:gradFill>'

const radial: Fill = {
  color: { type: 'srgb', v: '112233' },
  gradient: {
    stops: [
      { pos: 0, color: { type: 'srgb', v: '112233' } },
      { pos: 100000, color: { type: 'srgb', v: '445566' } },
    ],
    path: 'circle',
    fillToRect: { left: 50000, top: 20000 },
  },
}

const patternNode = '<d:pattFill prst="dashDnDiag">'
  + "<d:fgClr><d:srgbClr val='112233'/></d:fgClr><d:bgClr><d:srgbClr val='445566'/></d:bgClr>"
  + '<d:extLst data-ext="keep"/></d:pattFill>'

const pattern: Fill = {
  color: { type: 'srgb', v: '112233' },
  pattern: {
    preset: 'dashDnDiag',
    foreground: { type: 'srgb', v: '112233' },
    background: { type: 'srgb', v: '445566' },
  },
}

describe('a placeholder fill is compared and patched like a slide shape', () => {
  it('leaves an unedited gradient exactly as the source wrote it', () => {
    expect(rewritten(gradientNode, gradient)).toBe(master(gradientNode))
  })

  it('leaves an unedited radial gradient exactly as the source wrote it', () => {
    expect(rewritten(radialNode, radial)).toBe(master(radialNode))
  })

  it('leaves an unedited pattern exactly as the source wrote it', () => {
    expect(rewritten(patternNode, pattern)).toBe(master(patternNode))
  })

  it('replaces only the stop list when a stop colour changes', () => {
    const edited: Fill = {
      ...gradient,
      gradient: { ...gradient.gradient!, stops: [gradient.gradient!.stops[0]!, { pos: 100000, color: { type: 'srgb', v: '00FF00' } }] },
    }

    const output = rewritten(gradientNode, edited)

    expect(output).toContain('<d:gs pos="100000"><d:srgbClr val="00FF00"/></d:gs>')
    expect(output).toContain('<d:gradFill flip="none" rotWithShape="1">')
    expect(output).toContain('<d:lin scaled="0" ang="5400000"/>')
    expect(output).toContain('<d:tileRect l="10000"/>')
  })

  it('replaces only the foreground when a pattern colour changes', () => {
    const edited: Fill = {
      color: { type: 'srgb', v: 'FF0000' },
      pattern: { ...pattern.pattern!, foreground: { type: 'srgb', v: 'FF0000' } },
    }

    const output = rewritten(patternNode, edited)

    expect(output).toContain('<d:fgClr><d:srgbClr val="FF0000"/></d:fgClr>')
    expect(output).toContain('prst="dashDnDiag"')
    expect(output).toContain("<d:bgClr><d:srgbClr val='445566'/></d:bgClr>")
    expect(output).toContain('<d:extLst data-ext="keep"/>')
  })

  it('replaces only the colour inside a solid fill, keeping its attributes and siblings', () => {
    const source = '<d:solidFill data-fill="keep"><d:srgbClr val="112233"/><d:extLst data-ext="keep"/></d:solidFill>'

    const output = rewritten(source, { color: { type: 'srgb', v: 'FF0000' } })

    expect(output).toContain('<d:solidFill data-fill="keep"><d:srgbClr val="FF0000"/><d:extLst data-ext="keep"/></d:solidFill>')
  })

  it('swaps the whole node when the kind of fill changes', () => {
    const output = rewritten('<d:solidFill data-fill="keep"><d:srgbClr val="112233"/></d:solidFill>', gradient)

    expect(output).toContain('<d:gradFill><d:gsLst><d:gs pos="0"><d:srgbClr val="112233"/></d:gs>'
      + '<d:gs pos="100000"><d:srgbClr val="445566"/></d:gs></d:gsLst><d:lin ang="5400000" scaled="0"/></d:gradFill>')
    // The documented cost of a kind change: nothing on the old node corresponds to anything on the new one.
    expect(output).not.toContain('data-fill="keep"')
  })

  it('writes a colour into an empty self-closing fill node', () => {
    const output = rewritten('<d:solidFill/>', { color: { type: 'srgb', v: 'FF0000' } })

    expect(output).toContain('<d:solidFill><d:srgbClr val="FF0000"/></d:solidFill>')
  })

  /**
   * `a:hslClr` is a colour this project cannot read, so every part of the fill counts as changed. It has
   * to *replace* the unreadable node rather than join it — `EG_ColorChoice` is a choice, and two colours
   * inside one `a:solidFill` is XML no reader accepts — but the node around it is still only patched.
   * The source used to be reported as `placeholder fill malformed` instead, which failed the whole export.
   */
  it('replaces a colour it cannot read rather than writing a second one', () => {
    const source = '<d:solidFill data-fill="keep"><d:hslClr hue="0" sat="0" lum="0"/></d:solidFill>'

    const output = rewritten(source, { color: { type: 'srgb', v: 'FF0000' } })

    expect(output).toContain('<d:solidFill data-fill="keep"><d:srgbClr val="FF0000"/></d:solidFill>')
    expect(output).not.toContain('hslClr')
  })

  /**
   * `satMod` is outside the seven transforms the old private allowlist knew, and its value is above the
   * 100000 that allowlist also imposed — both of the mistakes `colorTransformValueIsValid`'s own comment
   * records as the reasons `satMod` used to vanish. The whole export used to throw on this document,
   * one `validateDocument` calls valid.
   */
  it('accepts the transforms the model accepts, including satMod and a valueless switch', () => {
    const source = '<d:solidFill><d:schemeClr val="accent1"><d:satMod val="160000"/><d:comp/></d:schemeClr></d:solidFill>'
    const fill: Fill = {
      color: { type: 'scheme', v: 'accent1', transforms: [{ type: 'satMod', value: 160000 }, { type: 'comp' }] },
    }

    expect(rewritten(source, fill)).toBe(master(source))
  })

  it('rejects a transform that is not an OOXML token', () => {
    const fill = { color: { type: 'srgb', v: 'FF0000', transforms: [{ type: 'not a token', value: 1 }] } } as unknown as Fill

    expect(() => rewritten('<d:solidFill><d:srgbClr val="112233"/></d:solidFill>', fill))
      .toThrow('PPTX export master unsupported color fill: master_1')
  })

  it('rejects a gradient stop colour the model would not accept', () => {
    const fill = {
      color: { type: 'srgb', v: '112233' },
      gradient: { stops: [{ pos: 0, color: { type: 'srgb', v: '112233' } }, { pos: 100000, color: { type: 'srgb', v: 'nothex' } }] },
    } as unknown as Fill

    expect(() => rewritten(gradientNode, fill)).toThrow('PPTX export master unsupported color fill: master_1')
  })

  /** The gradient's own scalars reach attributes, so they are checked by `validateGradient`'s rules too. */
  it('rejects a path word and a convergence inset the model would not accept', () => {
    const withPath = { ...radial, gradient: { ...radial.gradient!, path: 'ellipse' } } as unknown as Fill
    const withInset = { ...radial, gradient: { ...radial.gradient!, fillToRect: { left: 200000 } } } as unknown as Fill

    expect(() => rewritten(radialNode, withPath)).toThrow('PPTX export master unsupported color fill: master_1')
    expect(() => rewritten(radialNode, withInset)).toThrow('PPTX export master unsupported color fill: master_1')
  })
})

describe('a placeholder stroke fill is compared and patched the same way', () => {
  const strokeOf = (shapeProperties: string, stroke: Fill): string =>
    rewriteMasterXml(master(shapeProperties), { title: { stroke } }, undefined, 'master_1')

  it('leaves an unedited gradient stroke exactly as the source wrote it', () => {
    const source = `<d:ln w="12700">${gradientNode}<d:prstDash val="dash"/></d:ln>`

    expect(strokeOf(source, gradient)).toBe(master(source))
  })

  it('replaces only the colour inside a solid stroke fill', () => {
    const source = '<d:ln w="12700"><d:solidFill data-stroke="keep"><d:srgbClr val="112233"/></d:solidFill><d:prstDash val="dash"/></d:ln>'

    const output = strokeOf(source, { color: { type: 'srgb', v: 'FF0000' } })

    expect(output).toContain('<d:solidFill data-stroke="keep"><d:srgbClr val="FF0000"/></d:solidFill>')
    expect(output).toContain('<d:ln w="12700">')
    expect(output).toContain('<d:prstDash val="dash"/>')
  })
})

describe('a placeholder without the field is left alone', () => {
  it('returns the exact source when no fill or stroke is defined', () => {
    const source = `<d:ln w="12700">${gradientNode}</d:ln>`
    const defaults: Record<string, ElementDefaults> = { title: { rotation: 0 } }

    expect(rewriteMasterXml(master(source), defaults, undefined, 'master_1')).toBe(master(source))
  })

  /** `a:blipFill` is a fill kind neither side models, so `defaults.fill` is empty and the node stands. */
  it('leaves a picture fill node untouched', () => {
    const source = '<d:blipFill rotWithShape="1"><d:stretch><d:fillRect/></d:stretch></d:blipFill>'

    expect(rewriteMasterXml(master(source), { title: {} }, undefined, 'master_1')).toBe(master(source))
  })
})
