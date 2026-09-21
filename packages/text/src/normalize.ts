import { validateTextBody, type TextBody, type TextElement } from '@ppt4ai/model'

export class TextModelError extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(errors.join('; '))
    this.name = 'TextModelError'
    this.errors = [...errors]
  }
}

export function normalizeTextElement(element: TextElement): TextBody {
  if (element.body !== undefined) {
    const validation = validateTextBody(element.body)
    if (!validation.valid) throw new TextModelError(validation.errors)
    return structuredClone(element.body)
  }
  if (element.text === undefined) throw new TextModelError(['text element must define body or text'])
  return {
    paragraphs: element.text.split('\n').map((text) => text.length === 0 ? { runs: [] } : { runs: [{ text }] }),
  }
}
