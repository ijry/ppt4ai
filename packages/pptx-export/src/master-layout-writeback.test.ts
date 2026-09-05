import type { ElementDefaults } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { rewriteColorMapXml, rewriteLayoutXml, rewriteMasterXml, rewriteSlideColorMapXml } from './master-layout-writeback.js'

const sourceMaster = '<p:sldMaster xmlns:p="p" xmlns:d="drawing"><p:cSld><p:spTree><p:sp data-shape="keep"><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><d:xfrm rot="100" data-transform="keep"><d:off x="1" y="2"/><d:ext cx="3" cy="4"/></d:xfrm><d:prstGeom prst="roundRect"><d:avLst/></d:prstGeom><d:solidFill data-fill="keep"><d:srgbClr val="112233"/></d:solidFill><d:ln data-line="keep"><d:solidFill><d:srgbClr val="445566"/></d:solidFill></d:ln><d:unknown data-unknown="keep"/></p:spPr><p:txBody><d:bodyPr/><d:p><d:r><d:t>Original</d:t></d:r></d:p></p:txBody></p:sp><p:sp data-other="keep"><p:nvSpPr><p:cNvPr id="2" name="Other"/></p:nvSpPr></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" data-map="keep"/></p:sldMaster>'

const sourceLayout = '<p:sldLayout xmlns:p="p" xmlns:d="drawing"><p:cSld><p:spTree/></p:cSld><p:clrMapOvr data-override="keep"><d:masterClrMapping data-master="keep"/></p:clrMapOvr></p:sldLayout>'

const sourceSlide = '<p:sld xmlns:p="p" xmlns:d="drawing"><p:cSld><p:spTree/></p:cSld><p:clrMapOvr><d:overrideClrMapping accent1="accent1"/></p:clrMapOvr></p:sld>'

describe('master and layout XML write-back', () => {
  it('patches placeholder geometry, rotation, fill, stroke, preset, and text', () => {
    const defaults: Record<string, ElementDefaults> = {
      title: {
        bounds: { x: 11, y: 22, w: 33, h: 44 },
        rotation: 60000,
        preset: 'ellipse',
        fill: { color: { type: 'srgb', v: 'FF0000' } },
        stroke: { color: { type: 'srgb', v: '00FF00' } },
        text: 'Changed',
      },
    }

    const rewritten = rewriteMasterXml(sourceMaster, defaults, undefined, 'master_1')

    expect(rewritten).toContain('data-shape="keep"')
    expect(rewritten).toContain('data-transform="keep"')
    expect(rewritten).toContain('rot="60000"')
    expect(rewritten).toContain('<d:off x="11" y="22"/>')
    expect(rewritten).toContain('<d:ext cx="33" cy="44"/>')
    expect(rewritten).toContain('prst="ellipse"')
    // The fill node keeps its own attributes: only the colour inside it is replaced, which is what the
    // name of this test promised long before the writeback did it.
    expect(rewritten).toContain('<d:solidFill data-fill="keep"><d:srgbClr val="FF0000"/></d:solidFill>')
    expect(rewritten).toContain('<d:ln data-line="keep"><d:solidFill><d:srgbClr val="00FF00"/></d:solidFill></d:ln>')
    expect(rewritten).toContain('<d:t>Changed</d:t>')
    expect(rewritten).toContain('data-unknown="keep"')
    expect(rewritten).toContain('data-map="keep"')
    expect(rewritten).toContain('data-other="keep"')
  })

  it('writes defined map keys while preserving unknown attributes and master mapping', () => {
    const rewritten = rewriteLayoutXml(sourceLayout, {}, { accent1: 'accent3' }, 'layout_1')

    expect(rewritten).toContain('data-override="keep"')
    expect(rewritten).toContain('data-master="keep"')
    expect(rewritten).toContain('<d:overrideClrMapping accent1="accent3"/>')
  })

  it('patches slide overrides and inserts a missing override mapping', () => {
    const patched = rewriteSlideColorMapXml(sourceSlide, { accent1: 'accent4' }, 'slide_1')
    expect(patched).toContain('<d:overrideClrMapping accent1="accent4"/>')

    const inserted = rewriteSlideColorMapXml('<p:sld xmlns:p="p" xmlns:d="drawing"><p:cSld/></p:sld>', { tx1: 'lt1' }, 'slide_2')
    expect(inserted).toContain('<p:clrMapOvr><d:overrideClrMapping tx1="lt1"/></p:clrMapOvr>')
  })

  it('returns exact source when no sparse field is defined', () => {
    expect(rewriteMasterXml(sourceMaster, {}, undefined, 'master_1')).toBe(sourceMaster)
    expect(rewriteColorMapXml(sourceSlide, 'slide', {}, 'slide_1')).toBe(sourceSlide)
  })

  it('preserves single-quoted mapping attributes when changing a value', () => {
    const source = '<p:sldMaster xmlns:p="p"><p:clrMap accent1=\'accent1\' data-keep=\'yes\'/></p:sldMaster>'
    const rewritten = rewriteMasterXml(source, {}, { accent1: 'accent2' }, 'master_1')
    expect(rewritten).toContain("accent1='accent2'")
    expect(rewritten).toContain("data-keep='yes'")
  })

  it('rejects malformed source and unsupported map values with stable errors', () => {
    expect(() => rewriteMasterXml('<p:sldMaster>', {}, undefined, 'master_1')).toThrow('PPTX export')
    expect(() => rewriteMasterXml(sourceMaster, {}, { accent1: 'not-a-slot' } as never, 'master_1')).toThrow('PPTX export')
  })
})
