import type { TextBody } from '@ppt4ai/model'
import { describe, expect, it } from 'vitest'
import { layoutText } from './index'

const bounds = { x: 0, y: 0, w: 4000000, h: 2000000 }

function markerFor(scheme: string, startAt?: number): string | undefined {
  const body: TextBody = {
    paragraphs: [{
      runs: [{ text: 'Item' }],
      attrs: { bullet: startAt === undefined ? { type: 'autoNum', scheme } : { type: 'autoNum', scheme, startAt } },
    }],
  }
  return layoutText({ bounds, body }).lines[0]?.marker?.text
}

/**
 * `a:buAutoNum/@type` names its own format, so these come from parsing the word rather than from a
 * table. Before the word reached the model every one of them drew as `1 ` — no family, and no period.
 */
describe('auto-number marker text', () => {
  it('formats the arabic family', () => {
    expect(markerFor('arabicPeriod')).toBe('1. ')
    expect(markerFor('arabicParenR')).toBe('1) ')
    expect(markerFor('arabicParenBoth')).toBe('(1) ')
    expect(markerFor('arabicPlain')).toBe('1 ')
  })

  it('formats the alphabetic families', () => {
    expect(markerFor('alphaLcPeriod', 3)).toBe('c. ')
    expect(markerFor('alphaUcPeriod', 3)).toBe('C. ')
    expect(markerFor('alphaLcParenR', 27)).toBe('aa) ')
    expect(markerFor('alphaUcParenBoth', 2)).toBe('(B) ')
  })

  it('formats the roman families', () => {
    expect(markerFor('romanUcPeriod', 4)).toBe('IV. ')
    expect(markerFor('romanLcPeriod', 4)).toBe('iv. ')
    expect(markerFor('romanUcParenR', 9)).toBe('IX) ')
    expect(markerFor('romanLcParenBoth', 14)).toBe('(xiv) ')
    expect(markerFor('romanUcPlain', 2026)).toBe('MMXXVI ')
  })

  /** No CJK, Hindi, Hebrew or circled glyph tables here, so those words draw as OOXML's default type. */
  it('falls back to arabicPeriod for a family it has no format for', () => {
    expect(markerFor('ea1ChsPeriod', 2)).toBe('2. ')
    expect(markerFor('hindiNumParenR', 2)).toBe('2. ')
    expect(markerFor('circleNumDbPlain', 2)).toBe('2. ')
    expect(markerFor('somethingElse', 2)).toBe('2. ')
  })

  it('keeps counting per level across families', () => {
    const layout = layoutText({
      bounds,
      body: {
        paragraphs: [
          { runs: [{ text: 'A' }], attrs: { bullet: { type: 'autoNum', scheme: 'romanUcParenR' } } },
          { runs: [{ text: 'B' }], attrs: { bullet: { type: 'autoNum', scheme: 'romanUcParenR' } } },
          { runs: [{ text: 'C' }], attrs: { bullet: { type: 'autoNum', scheme: 'romanUcParenR' } } },
        ],
      },
    })

    expect(layout.lines.map((line) => line.marker?.text)).toEqual(['I) ', 'II) ', 'III) '])
  })
})
