import { describe, expect, it } from 'vitest'
import type { Rect, TextBody, TextMarks } from '@ppt4ai/model'
import { layoutText } from './layout'

const bounds: Rect = { x: 0, y: 0, w: 10000000, h: 2000000 }

function bodyWith(marks?: TextMarks): TextBody {
  return { paragraphs: [{ runs: [{ text: 'Hi 你好 ok', ...(marks ? { marks } : {}) }] }] }
}

function runsOf(body: TextBody) {
  return layoutText({ bounds, body }).lines.flatMap((line) => line.runs)
}

describe('script runs in text layout', () => {
  it('splits a run at every east asian span when the run carries an east asian typeface', () => {
    const runs = runsOf(bodyWith({ fontFamily: 'Calibri', fontFamilyEa: '宋体' }))

    expect(runs.map((run) => [run.text, run.script])).toEqual([
      ['Hi ', undefined],
      ['你好', 'ea'],
      [' ok', undefined],
    ])
  })

  /** Without an east asian typeface there is nothing to switch to, so the merge must stay as it was. */
  it('leaves runs merged when the run declares no east asian typeface', () => {
    const runs = runsOf(bodyWith({ fontFamily: 'Calibri' }))

    expect(runs.map((run) => run.text)).toEqual(['Hi 你好 ok'])
    expect(runs[0]).not.toHaveProperty('script')
  })

  it('leaves runs merged when the run has no marks at all', () => {
    const runs = runsOf(bodyWith(undefined))

    expect(runs.map((run) => run.text)).toEqual(['Hi 你好 ok'])
  })

  it('keeps the split for text that is entirely east asian', () => {
    const body: TextBody = { paragraphs: [{ runs: [{ text: '你好世界', marks: { fontFamilyEa: '宋体' } }] }] }
    const runs = runsOf(body)

    expect(runs.map((run) => [run.text, run.script])).toEqual([['你好世界', 'ea']])
  })

  it('tags a CJK bullet marker with the east asian script', () => {
    const body: TextBody = {
      paragraphs: [{
        attrs: { bullet: { type: 'char', char: '、' } },
        runs: [{ text: 'text', marks: { fontFamily: 'Calibri', fontFamilyEa: '宋体' } }],
      }],
    }

    expect(layoutText({ bounds, body }).lines[0]?.marker).toMatchObject({ script: 'ea' })
  })

  it('leaves a latin bullet marker untagged', () => {
    const body: TextBody = {
      paragraphs: [{
        attrs: { bullet: { type: 'char', char: '-' } },
        runs: [{ text: 'text', marks: { fontFamily: 'Calibri', fontFamilyEa: '宋体' } }],
      }],
    }

    expect(layoutText({ bounds, body }).lines[0]?.marker).not.toHaveProperty('script')
  })

  it('carries the script through vertical layout, one run per character', () => {
    const body: TextBody = {
      bodyPr: { vertical: 'vertical' },
      paragraphs: [{ runs: [{ text: 'A你', marks: { fontFamily: 'Calibri', fontFamilyEa: '宋体' } }] }],
    }
    const runs = runsOf(body)

    expect(runs.map((run) => [run.text, run.script])).toEqual([['A', undefined], ['你', 'ea']])
  })
})
