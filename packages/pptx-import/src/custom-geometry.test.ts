import { describe, expect, it } from 'vitest'
import { importPptx } from './importer'
import { createStoredZip, files } from './test-fixtures'
import type { Ppt4aiDocument } from '@ppt4ai/model'

function shapeWith(geometry: string, body = ''): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Freeform"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>${geometry}</p:spPr>${body}</p:sp>`
}

async function elementOf(markup: string): Promise<Ppt4aiDocument['elements'][string]> {
  const document = await importPptx(createStoredZip({
    ...files,
    'ppt/slides/slide1.xml': `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>${markup}</p:spTree></p:cSld></p:sld>`,
  }))
  const element = document.elements.el_1
  if (!element) throw new Error('fixture produced no element')
  return element
}

function geometryOf(element: Ppt4aiDocument['elements'][string]) {
  if (element.kind !== 'shape' && element.kind !== 'text') throw new Error('element cannot carry geometry')
  return element.customGeometry
}

function path(commands: string, attributes = ' w="100" h="100"'): string {
  return `<a:custGeom><a:avLst/><a:pathLst><a:path${attributes}>${commands}</a:path></a:pathLst></a:custGeom>`
}

describe('custom geometry on import', () => {
  it('reads a literal triangle with its coordinate space', async () => {
    const commands = '<a:moveTo><a:pt x="0" y="100"/></a:moveTo><a:lnTo><a:pt x="50" y="0"/></a:lnTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:close/>'

    expect(geometryOf(await elementOf(shapeWith(path(commands))))).toEqual({
      paths: [{
        width: 100,
        height: 100,
        commands: [
          { type: 'move', x: 0, y: 100 },
          { type: 'line', x: 50, y: 0 },
          { type: 'line', x: 100, y: 100 },
          { type: 'close' },
        ],
      }],
    })
  })

  it('reads both Bézier forms and the arc', async () => {
    const commands = '<a:moveTo><a:pt x="0" y="0"/></a:moveTo>'
      + '<a:cubicBezTo><a:pt x="10" y="20"/><a:pt x="30" y="40"/><a:pt x="50" y="60"/></a:cubicBezTo>'
      + '<a:quadBezTo><a:pt x="70" y="80"/><a:pt x="90" y="100"/></a:quadBezTo>'
      + '<a:arcTo wR="25" hR="15" stAng="0" swAng="5400000"/>'

    expect(geometryOf(await elementOf(shapeWith(path(commands))))?.paths[0]?.commands).toEqual([
      { type: 'move', x: 0, y: 0 },
      { type: 'cubic', x1: 10, y1: 20, x2: 30, y2: 40, x: 50, y: 60 },
      { type: 'quad', x1: 70, y1: 80, x: 90, y: 100 },
      { type: 'arc', widthRadius: 25, heightRadius: 15, startAngle: 0, swingAngle: 5400000 },
    ])
  })

  it('reads several subpaths, each with its own space', async () => {
    const geometry = '<a:custGeom><a:pathLst>'
      + '<a:path w="10" h="10"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="10" y="10"/></a:lnTo></a:path>'
      + '<a:path><a:moveTo><a:pt x="5" y="5"/></a:moveTo><a:close/></a:path>'
      + '</a:pathLst></a:custGeom>'

    expect(geometryOf(await elementOf(shapeWith(geometry)))?.paths).toEqual([
      { width: 10, height: 10, commands: [{ type: 'move', x: 0, y: 0 }, { type: 'line', x: 10, y: 10 }] },
      { commands: [{ type: 'move', x: 5, y: 5 }, { type: 'close' }] },
    ])
  })

  /**
   * Decision 1: guide names need `a:gdLst`'s formula language, which is as unverifiable here as the
   * preset outlines. Half a path would join lines to invented places, so the whole geometry drops.
   */
  it('drops the whole geometry when a coordinate is a guide name', async () => {
    const commands = '<a:moveTo><a:pt x="adj1" y="100"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo>'

    expect(geometryOf(await elementOf(shapeWith(path(commands))))).toBeUndefined()
  })

  it('drops the geometry when a command it cannot express appears', async () => {
    const commands = '<a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:someFutureCommand/>'

    expect(geometryOf(await elementOf(shapeWith(path(commands))))).toBeUndefined()
  })

  it('leaves the field absent for a preset shape and keeps the preset itself', async () => {
    const element = await elementOf(shapeWith('<a:prstGeom prst="chevron"><a:avLst/></a:prstGeom>'))

    expect(geometryOf(element)).toBeUndefined()
    if (element.kind !== 'shape') throw new Error('expected a shape')
    expect(element.preset).toBe('chevron')
  })

  it('reads the geometry of a shape that carries text', async () => {
    const commands = '<a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:close/>'
    const element = await elementOf(shapeWith(path(commands), '<p:txBody><a:p><a:r><a:t>Labelled</a:t></a:r></a:p></p:txBody>'))

    expect(element.kind).toBe('text')
    expect(geometryOf(element)?.paths[0]?.commands).toHaveLength(3)
  })
})
