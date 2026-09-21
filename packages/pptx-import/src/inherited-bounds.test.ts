import { describe, expect, it } from 'vitest'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const positioned = '<a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm>'

function slideWith(shapeProperties: string, placeholder = '<p:ph type="title"/>'): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>`
    + `<p:spPr>${shapeProperties}</p:spPr>`
    + '<p:txBody><a:p><a:r><a:t>Inherited</a:t></a:r></a:p></p:txBody>'
    + '</p:sp></p:spTree></p:cSld></p:sld>'
}

function partWith(root: string, shapeProperties: string): string {
  return `<p:${root} xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>`
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + `<p:spPr>${shapeProperties}</p:spPr></p:sp>`
    + `</p:spTree></p:cSld></p:${root}>`
}

async function elementOf(options: {
  slide: string
  layout?: string
  master?: string
  placeholder?: string
}) {
  const document = await importPptx(createStoredZip({
    ...files,
    'ppt/slides/slide1.xml': slideWith(options.slide, options.placeholder),
    ...(options.layout === undefined ? {} : { 'ppt/slideLayouts/slideLayout1.xml': partWith('sldLayout', options.layout) }),
    ...(options.master === undefined ? {} : { 'ppt/slideMasters/slideMaster1.xml': partWith('sldMaster', options.master) }),
  }))
  return Object.values(document.elements)[0]
}

describe('a placeholder that inherits its position', () => {
  /** Before this the element was dropped entirely — invisible and unselectable, not just misplaced. */
  it('imports with the layout placeholder bounds', async () => {
    const element = await elementOf({ slide: '', layout: positioned })

    expect(element?.bounds).toEqual({ x: 838200, y: 365125, w: 10515600, h: 1325563 })
  })

  it('falls back to the master when the layout states no position', async () => {
    const element = await elementOf({
      slide: '',
      layout: '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>',
      master: '<a:xfrm><a:off x="100000" y="200000"/><a:ext cx="300000" cy="400000"/></a:xfrm>',
    })

    expect(element?.bounds).toEqual({ x: 100000, y: 200000, w: 300000, h: 400000 })
  })

  /** The direction `findDefaults` runs: the master is pushed first and the layout overwrites it. */
  it('prefers the layout over the master', async () => {
    const element = await elementOf({
      slide: '',
      layout: positioned,
      master: '<a:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm>',
    })

    expect(element?.bounds).toEqual({ x: 838200, y: 365125, w: 10515600, h: 1325563 })
  })

  it('uses its own position when it states one', async () => {
    const element = await elementOf({
      slide: '<a:xfrm><a:off x="500000" y="600000"/><a:ext cx="700000" cy="800000"/></a:xfrm>',
      layout: positioned,
    })

    expect(element?.bounds).toEqual({ x: 500000, y: 600000, w: 700000, h: 800000 })
  })

  /**
   * No position anywhere is still no position. A zero rect would pile invisible elements into the corner,
   * which is worse than not importing and much harder to diagnose.
   */
  it('is still skipped when nothing states a position', async () => {
    expect(await elementOf({ slide: '', layout: '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' }))
      .toBeUndefined()
  })

  /** A shape that is not a placeholder has no key to inherit through, so nothing changes for it. */
  it('is still skipped for a shape that is not a placeholder', async () => {
    expect(await elementOf({ slide: '', layout: positioned, placeholder: '' })).toBeUndefined()
  })
})
