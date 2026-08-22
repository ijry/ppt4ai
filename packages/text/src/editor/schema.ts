import { Schema } from 'prosemirror-model'

export const textEditorSchema = new Schema({
  nodes: {
    doc: {
      content: 'paragraph+',
      attrs: { bodyPr: { default: null } },
    },
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: {
        align: { default: null },
        level: { default: null },
        indent: { default: null },
        marginLeft: { default: null },
        lineSpacing: { default: null },
        spaceBefore: { default: null },
        spaceAfter: { default: null },
        bullet: { default: null },
      },
    },
    text: { group: 'inline' },
  },
  marks: {
    pptText: {
      attrs: { marks: { default: null } },
    },
  },
})
