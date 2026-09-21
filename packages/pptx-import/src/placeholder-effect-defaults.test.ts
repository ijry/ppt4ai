import { describe, expect, it } from 'vitest'
import { resolveInheritedElement } from '@ppt4ai/model'
import { importPptx } from './index'
import { createStoredZip, files } from './test-fixtures'

const position = '<a:xfrm><a:off x="100000" y="100000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm>'
const custGeom = '<a:custGeom><a:avLst/><a:pathLst><a:path w="100" h="100">'
  + '<a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:close/>'
  + '</a:path></a:pathLst></a:custGeom>'
const effect = '<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000">'
  + '<a:srgbClr val="000000"/></a:outerShdw></a:effectLst>'
const style = '<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef>'
  + '<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>'
  + '<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>'
  + '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>'

function layoutWith(shapeProperties: string, shapeStyle = ''): string {
  return '<p:sldLayout xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + `<p:spPr>${shapeProperties}</p:spPr>${shapeStyle}</p:sp>`
    + '</p:spTree></p:cSld></p:sldLayout>'
}

function slideWith(shapeProperties = position): string {
  return '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>'
    + `<p:spPr>${shapeProperties}</p:spPr>`
    + '<p:txBody><a:p><a:r><a:t>Inherited</a:t></a:r></a:p></p:txBody>'
    + '</p:sp></p:spTree></p:cSld></p:sld>'
}

async function inherited(layoutProperties: string, layoutStyle = '', slideProperties = position) {
  const document = await importPptx(createStoredZip({
    ...files,
    'ppt/slides/slide1.xml': slideWith(slideProperties),
    'ppt/slideLayouts/slideLayout1.xml': layoutWith(layoutProperties, layoutStyle),
  }))
  const element = Object.values(document.elements)[0]
  if (!element) throw new Error('the placeholder did not import')
  const layout = Object.values(document.layouts ?? {})[0]
  const resolved = resolveInheritedElement(element, layout, Object.values(document.masters ?? {})[0])
  return { defaults: layout?.defaults?.title ?? {}, resolved }
}

describe('placeholder shadow, custom geometry and style defaults', () => {
  /** All three were dropped: a layout's shadowed custom shape inherited as an unshadowed rectangle. */
  it('reads the shadow into the default and hands it on', async () => {
    const { defaults, resolved } = await inherited(`${position}${effect}`)
    const shadow = { color: { type: 'srgb', v: '000000' }, blurRadius: 50800, distance: 38100, direction: 2700000 }

    expect(defaults.shadow).toEqual(shadow)
    expect(resolved).toMatchObject({ shadow })
  })

  it('reads the custom geometry into the default and hands it on', async () => {
    const { defaults, resolved } = await inherited(`${position}${custGeom}`)
    const commands = [
      { type: 'move', x: 0, y: 0 },
      { type: 'line', x: 100, y: 100 },
      { type: 'close' },
    ]

    expect(defaults.customGeometry?.paths[0]?.commands).toEqual(commands)
    expect(resolved).toMatchObject({ customGeometry: { paths: [{ width: 100, height: 100, commands }] } })
  })

  /** `a:effectRef` is the other half of how a placeholder states an effect, so the references belong too. */
  it('reads the style references into the default and hands them on', async () => {
    const { defaults, resolved } = await inherited(position, style)

    expect(defaults.styleRef).toEqual({
      line: { idx: 2, color: { type: 'scheme', v: 'accent1' } },
      fill: { idx: 1, color: { type: 'scheme', v: 'accent1' } },
      effect: { idx: 0, color: { type: 'scheme', v: 'accent1' } },
      font: { idx: 'minor', color: { type: 'scheme', v: 'lt1' } },
    })
    expect(resolved).toMatchObject({ styleRef: { fill: { idx: 1 } } })
  })

  it('omits each field the layout does not state', async () => {
    const { defaults } = await inherited(position)

    expect(defaults.shadow).toBeUndefined()
    expect(defaults.customGeometry).toBeUndefined()
    expect(defaults.styleRef).toBeUndefined()
  })

  /** The shallow merge runs one way: what the shape states wins. */
  it('lets the shape override the inherited shadow', async () => {
    const { resolved } = await inherited(
      `${position}${effect}`,
      '',
      `${position}<a:effectLst><a:outerShdw blurRad="12700"><a:srgbClr val="FF0000"/></a:outerShdw></a:effectLst>`,
    )

    expect(resolved).toMatchObject({ shadow: { color: { type: 'srgb', v: 'FF0000' }, blurRadius: 12700 } })
  })

  /**
   * `parsePreset` falls back to `rect` with no `a:prstGeom`, so a custom-geometry placeholder keeps a
   * misleading `preset`. Harmless because drawing prefers the path, and pinned so the fallback is visible.
   */
  it('still records the rect fallback beside a custom geometry', async () => {
    const { defaults } = await inherited(`${position}${custGeom}`)

    expect(defaults.preset).toBe('rect')
    expect(defaults.customGeometry).toBeDefined()
  })
})
