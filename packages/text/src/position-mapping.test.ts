import type { TextBody } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { layoutText } from './layout'
import { mapTextPosition, mapTextSelection, textPositionAtPoint } from './position-mapping'
import { textBodyToProseMirror } from './editor/model'

const bounds = { x: 0, y: 0, w: 500000, h: 1000000 }

function createFixture(body: TextBody) {
  const document = textBodyToProseMirror(body)
  const layout = layoutText({ bounds, body })
  return { document, layout }
}

describe('text position mapping', () => {
  it('maps positions on a single line to caret rectangles', () => {
    const { document, layout } = createFixture({ paragraphs: [{ runs: [{ text: 'A中B' }] }] })
    expect(mapTextPosition(layout, document, 1)).toEqual({ x: 0, y: 0, width: 1, height: 228600 })
    expect(mapTextPosition(layout, document, 3).x).toBe(370332)
    expect(mapTextPosition(layout, document, 99)).toEqual(mapTextPosition(layout, document, 4))
  })

  it('maps soft-wrapped text and explicit paragraph boundaries', () => {
    const body: TextBody = { paragraphs: [{ runs: [{ text: '中文' }] }, { runs: [{ text: 'AB' }] }] }
    const { document, layout } = createFixture(body)
    expect(layout.lines).toHaveLength(2)
    expect(mapTextPosition(layout, document, 3).y).toBe(layout.lines[0]?.y)
    expect(mapTextPosition(layout, document, 5).y).toBe(layout.lines[1]?.y)
  })

  it('maps an empty paragraph to a zero-width caret line', () => {
    const { document, layout } = createFixture({ paragraphs: [{ runs: [] }] })
    expect(mapTextPosition(layout, document, 1)).toEqual({ x: 0, y: 0, width: 1, height: 228600 })
  })

  it('returns ordered selection rectangles for reverse cross-line selections', () => {
    const { document, layout } = createFixture({ paragraphs: [{ runs: [{ text: '中文测试' }] }] })
    const rectangles = mapTextSelection(layout, document, 5, 2)
    expect(rectangles.length).toBeGreaterThan(1)
    expect(rectangles[0]?.from).toBe(2)
    expect(rectangles.at(-1)?.to).toBe(5)
    expect(rectangles.every((rect) => rect.width > 0 && rect.height > 0)).toBe(true)
  })

  it('hits the nearest document position from layout coordinates', () => {
    const { document, layout } = createFixture({ paragraphs: [{ runs: [{ text: 'AB' }] }] })
    const line = layout.lines[0]!
    expect(textPositionAtPoint(layout, document, { x: line.x - 1, y: line.y + 1 })).toBe(1)
    expect(textPositionAtPoint(layout, document, { x: line.x + line.width, y: line.y + 1 })).toBe(3)
  })

  it('returns structured-clone-safe plain geometry', () => {
    const { document, layout } = createFixture({ paragraphs: [{ runs: [{ text: 'A' }] }] })
    const caret = mapTextPosition(layout, document, 1)
    expect(structuredClone(caret)).toEqual(caret)
    expect(Object.getPrototypeOf(caret)).toBe(Object.prototype)
  })
})
