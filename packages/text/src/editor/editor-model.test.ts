import type { TextBody } from '@ppt4ai/model'
import { Schema } from 'prosemirror-model'
import { describe, expect, it } from 'vitest'
import {
  proseMirrorToTextBody,
  TextEditorModelError,
  textBodyToProseMirror,
  textEditorSchema,
} from '../index'

const body: TextBody = {
  bodyPr: {
    insets: { left: 100, top: 200, right: 300, bottom: 400 },
    verticalAlign: 'middle',
    wrap: 'square',
    autofit: { type: 'shrink', minFontScale: 70000 },
  },
  paragraphs: [
    {
      attrs: {
        align: 'center',
        level: 1,
        indent: 120,
        marginLeft: 240,
        lineSpacing: 1.25,
        spaceBefore: 40,
        spaceAfter: 60,
        bullet: { type: 'char', char: '•', fontFamily: 'Arial' },
      },
      runs: [
        { text: 'Hello', marks: { fontFamily: 'Arial', fontSize: 24, bold: true } },
        { text: '世界', marks: { italic: true, color: { color: { type: 'srgb', v: 'FF0000' } } } },
        { text: '!' },
      ],
    },
    { runs: [] },
  ],
}

describe('TextBody ProseMirror conversion', () => {
  it('round-trips body properties, paragraph attrs, run marks, and empty paragraphs', () => {
    const document = textBodyToProseMirror(body)

    expect(document.toJSON()).toEqual({
      type: 'doc',
      attrs: { bodyPr: body.bodyPr },
      content: [
        {
          type: 'paragraph',
          attrs: {
            align: 'center',
            level: 1,
            indent: 120,
            marginLeft: 240,
            lineSpacing: 1.25,
            spaceBefore: 40,
            spaceAfter: 60,
            bullet: { type: 'char', char: '•', fontFamily: 'Arial' },
          },
          content: [
            {
              type: 'text',
              marks: [{ type: 'pptText', attrs: { marks: body.paragraphs[0]?.runs[0]?.marks } }],
              text: 'Hello',
            },
            {
              type: 'text',
              marks: [{ type: 'pptText', attrs: { marks: body.paragraphs[0]?.runs[1]?.marks } }],
              text: '世界',
            },
            { type: 'text', text: '!' },
          ],
        },
        {
          type: 'paragraph',
          attrs: {
            align: null,
            level: null,
            indent: null,
            marginLeft: null,
            lineSpacing: null,
            spaceBefore: null,
            spaceAfter: null,
            bullet: null,
          },
        },
      ],
    })

    const roundTrip = proseMirrorToTextBody(document)
    expect(roundTrip).toEqual(body)
    expect(structuredClone(roundTrip)).toEqual(roundTrip)

    roundTrip.paragraphs[0]!.runs[0]!.text = 'changed'
    expect(body.paragraphs[0]?.runs[0]?.text).toBe('Hello')
  })

  it('coalesces adjacent text nodes with deeply equal marks', () => {
    const document = textEditorSchema.nodeFromJSON({
      type: 'doc',
      attrs: { bodyPr: null },
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'A', marks: [{ type: 'pptText', attrs: { marks: { bold: true } } }] },
          { type: 'text', text: 'B', marks: [{ type: 'pptText', attrs: { marks: { bold: true } } }] },
        ],
      }],
    })

    expect(proseMirrorToTextBody(document)).toEqual({
      paragraphs: [{ runs: [{ text: 'AB', marks: { bold: true } }] }],
    })
  })

  it('rejects invalid bodies with deterministic model errors', () => {
    expect(() => textBodyToProseMirror({
      paragraphs: [{ runs: [{ text: '' }] }],
    })).toThrowError(TextEditorModelError)

    try {
      textBodyToProseMirror({ paragraphs: [{ runs: [{ text: '' }] }] })
    } catch (error) {
      expect(error).toMatchObject({
        path: 'paragraphs[0].runs[0].text',
        errors: ['paragraphs[0].runs[0].text must be non-empty'],
      })
    }
  })

  it('rejects documents from unsupported schemas', () => {
    const foreignSchema = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'text*' },
        text: {},
      },
    })
    const foreignDocument = foreignSchema.node('doc', undefined, [foreignSchema.node('paragraph')])

    expect(() => proseMirrorToTextBody(foreignDocument)).toThrowError(
      new TextEditorModelError(['document must use textEditorSchema'], 'document'),
    )
  })
})
