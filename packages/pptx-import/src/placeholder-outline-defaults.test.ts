import { describe, expect, it } from 'vitest'
import { resolveInheritedElement, type ElementDefaults } from '@ppt4ai/model'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const outline = '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>'
  + '<a:ln w="76200" cap="sq" cmpd="dbl" algn="in">'
  + '<a:solidFill><a:srgbClr val="203864"/></a:solidFill>'
  + '<a:prstDash val="lgDashDot"/><a:miter lim="800000"/>'
  + '</a:ln>'

function layoutWith(shapeProperties: string): string {
  return '<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm>'
    + `${shapeProperties}</p:spPr></p:sp>`
    + '</p:spTree></p:cSld></p:sldLayout>'
}

function slideWith(shapeProperties = ''): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm>'
    + `${shapeProperties}</p:spPr>`
    + '<p:txBody><a:p><a:r><a:t>Inherited</a:t></a:r></a:p></p:txBody>'
    + '</p:sp></p:spTree></p:cSld></p:sld>'
}

async function imported(layoutProperties: string, slideProperties = '') {
  const document = await importPptx(createStoredZip({
    ...files,
    'ppt/slides/slide1.xml': slideWith(slideProperties),
    'ppt/slideLayouts/slideLayout1.xml': layoutWith(layoutProperties),
  }))
  const element = Object.values(document.elements)[0]
  if (!element) throw new Error('the placeholder did not import')
  const layout = Object.values(document.layouts ?? {})[0]
  const master = Object.values(document.masters ?? {})[0]
  const defaults: ElementDefaults = layout?.defaults?.title ?? {}
  const resolved = resolveInheritedElement(element, layout, master)
  if (resolved.kind !== 'text' && resolved.kind !== 'shape') throw new Error('unexpected kind')
  return { defaults, resolved }
}

describe('placeholder outline defaults', () => {
  /** Before this the default held only bounds, preset and the stroke colour. */
  it('reads the whole outline vocabulary into the layout default', async () => {
    const { defaults } = await imported(outline)

    expect(defaults).toMatchObject({
      preset: 'roundRect',
      adjustValues: [{ name: 'adj', formula: 'val 25000' }],
      strokeWidth: 76200,
      strokeStyle: 'lgDashDot',
      strokeCap: 'sq',
      strokeJoin: 'miter',
      strokeMiterLimit: 800000,
      strokeCompound: 'dbl',
      strokeAlign: 'in',
    })
  })

  /** The visible bug: a layout's thick dashed border became a hairline solid one on the slide. */
  it('hands the whole vocabulary to the inheriting shape', async () => {
    const { resolved } = await imported(outline)

    expect(resolved).toMatchObject({
      strokeWidth: 76200,
      strokeStyle: 'lgDashDot',
      strokeCap: 'sq',
      strokeCompound: 'dbl',
      strokeAlign: 'in',
      strokeMiterLimit: 800000,
      adjustValues: [{ name: 'adj', formula: 'val 25000' }],
    })
  })

  /** `solid` is the default, so it stays out of the model here exactly as it does on an element. */
  it('leaves a solid dash out of the default', async () => {
    const { defaults } = await imported('<a:prstGeom prst="rect"/>'
      + '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="solid"/></a:ln>')

    expect(defaults.strokeWidth).toBe(12700)
    expect(defaults.strokeStyle).toBeUndefined()
  })

  it('omits a field the layout does not state', async () => {
    const { defaults } = await imported('<a:prstGeom prst="rect"/>'
      + '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>')

    expect(defaults.strokeCap).toBeUndefined()
    expect(defaults.strokeCompound).toBeUndefined()
    expect(defaults.adjustValues).toBeUndefined()
  })

  /** The shape's own declaration wins, which is the direction the shallow merge runs. */
  it('lets the shape override the default', async () => {
    const { resolved } = await imported(
      outline,
      '<a:ln w="6350"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="sysDot"/></a:ln>',
    )

    expect(resolved).toMatchObject({ strokeWidth: 6350, strokeStyle: 'sysDot' })
    // Not restated by the shape, so the layout's value still comes through.
    expect(resolved).toMatchObject({ strokeCompound: 'dbl' })
  })
})
