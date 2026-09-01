import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

/**
 * A group scaled in PowerPoint: the child coordinate space (chOff/chExt) is twice the on-slide
 * extent (off/ext). Import stores both as authored -- the scene graph composes them -- so that
 * bounds writeback keeps comparing model values against the same numbers the XML holds.
 */
function scaledGroupSlide(childSpace: string): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + `<p:grpSpPr><a:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="2000000" cy="1000000"/>${childSpace}</a:xfrm></p:grpSpPr>`
    + '<p:sp><p:nvSpPr><p:cNvPr id="11" name="Inner"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="5000000" y="6000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>'
    + '<p:txBody><a:p><a:r><a:t>Inner</a:t></a:r></a:p></p:txBody></p:sp>'
    + '</p:grpSp>'
    + '</p:spTree></p:cSld></p:sld>'
}

const childSpace = '<a:chOff x="5000000" y="6000000"/><a:chExt cx="4000000" cy="2000000"/>'

async function importSlide(slideXml: string) {
  return importPptx(createStoredZip({ ...files, 'ppt/slides/slide1.xml': slideXml }))
}

describe('group child coordinate space', () => {
  it('records chOff/chExt on the group as authored', async () => {
    const document = await importSlide(scaledGroupSlide(childSpace))
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('expected a group element')

    expect(group.childSpace).toEqual({ x: 5000000, y: 6000000, w: 4000000, h: 2000000 })
    expect(group.bounds).toEqual({ x: 1000000, y: 2000000, w: 2000000, h: 1000000 })
  })

  it('leaves descendant bounds in the authored child space so writeback stays byte-honest', async () => {
    const document = await importSlide(scaledGroupSlide(childSpace))

    expect(document.elements.el_1?.bounds).toEqual({ x: 5000000, y: 6000000, w: 4000000, h: 2000000 })
  })

  it('omits childSpace when the group declares none', async () => {
    const document = await importSlide(scaledGroupSlide(''))
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('expected a group element')

    expect(group.childSpace).toBeUndefined()
    expect(document.elements.el_1?.bounds).toEqual({ x: 5000000, y: 6000000, w: 4000000, h: 2000000 })
  })

  it('ignores a degenerate zero-sized child space rather than storing an unusable divisor', async () => {
    const document = await importSlide(scaledGroupSlide('<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/>'))
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('expected a group element')

    expect(group.childSpace).toBeUndefined()
  })

  it('records childSpace even when it matches the group bounds', async () => {
    const identity = '<a:chOff x="1000000" y="2000000"/><a:chExt cx="2000000" cy="1000000"/>'
    const document = await importSlide(scaledGroupSlide(identity))
    const group = document.elements.grp_1
    if (group?.kind !== 'group') throw new Error('expected a group element')

    expect(group.childSpace).toEqual({ x: 1000000, y: 2000000, w: 2000000, h: 1000000 })
  })

  it('records a child space on each level of nested groups', async () => {
    const nested = '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
      + '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Outer"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
      + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/>'
      + '<a:chOff x="0" y="0"/><a:chExt cx="2000000" cy="2000000"/></a:xfrm></p:grpSpPr>'
      + '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="11" name="Inner"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
      + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/>'
      + '<a:chOff x="0" y="0"/><a:chExt cx="2000000" cy="2000000"/></a:xfrm></p:grpSpPr>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="12" name="Leaf"/><p:nvPr/></p:nvSpPr>'
      + '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>'
      + '<p:txBody><a:p><a:r><a:t>Leaf</a:t></a:r></a:p></p:txBody></p:sp>'
      + '</p:grpSp></p:grpSp>'
      + '</p:spTree></p:cSld></p:sld>'

    const document = await importSlide(nested)
    const outer = document.elements.grp_1
    const inner = document.elements.grp_2
    if (outer?.kind !== 'group' || inner?.kind !== 'group') throw new Error('expected nested groups')

    expect(outer.childSpace).toEqual({ x: 0, y: 0, w: 2000000, h: 2000000 })
    expect(inner.childSpace).toEqual({ x: 0, y: 0, w: 2000000, h: 2000000 })
    expect(inner.bounds).toEqual({ x: 0, y: 0, w: 1000000, h: 1000000 })
    expect(document.elements.el_1?.bounds).toEqual({ x: 0, y: 0, w: 2000000, h: 2000000 })
  })
})
