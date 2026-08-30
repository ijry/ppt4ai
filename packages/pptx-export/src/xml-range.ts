export interface XmlElement {
  name: string
  localName: string
  attributes: Record<string, string>
  start: number
  end: number
  children: XmlElement[]
  text: string
}

interface OpenElement extends XmlElement {
  end: number
}

export interface Replacement {
  start: number
  end: number
  value: string
}

export function tagEnd(xml: string, start: number): number {
  let quote = ''
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index] ?? ''
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index + 1
    }
  }
  throw new Error('PPTX export encountered malformed XML')
}

export function decodeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const expression = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (const match of source.matchAll(expression)) {
    const name = match[1]
    if (name) attributes[name] = decodeXml(match[2] ?? match[3] ?? '')
  }
  return attributes
}

export function scanXml(xml: string): XmlElement[] {
  const roots: XmlElement[] = []
  const stack: OpenElement[] = []
  let cursor = 0
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor)
    if (start < 0) break
    const textParent = stack.at(-1)
    if (textParent && start > cursor) textParent.text += xml.slice(cursor, start)
    if (xml.startsWith('<!--', start)) {
      const end = xml.indexOf('-->', start + 4)
      if (end < 0) throw new Error('PPTX export encountered malformed XML')
      cursor = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const end = xml.indexOf(']]>', start + 9)
      if (end < 0) throw new Error('PPTX export encountered malformed XML')
      cursor = end + 3
      continue
    }
    if (xml.startsWith('<?', start)) {
      const end = xml.indexOf('?>', start + 2)
      if (end < 0) throw new Error('PPTX export encountered malformed XML')
      cursor = end + 2
      continue
    }
    if (xml.startsWith('<!', start)) {
      cursor = tagEnd(xml, start + 2)
      continue
    }

    const end = tagEnd(xml, start + 1)
    const content = xml.slice(start + 1, end - 1).trim()
    if (content.startsWith('/')) {
      const name = content.slice(1).trim().split(/\s/, 1)[0]
      const current = stack.pop()
      if (!current || current.name !== name) throw new Error('PPTX export encountered malformed XML')
      current.end = end
      cursor = end
      continue
    }

    const selfClosing = /\/\s*$/.test(content)
    const opening = selfClosing ? content.replace(/\/\s*$/, '').trimEnd() : content
    const name = opening.split(/\s/, 1)[0]
    if (!name) throw new Error('PPTX export encountered malformed XML')
    const element: OpenElement = {
      name,
      localName: name.slice(name.lastIndexOf(':') + 1),
      attributes: parseAttributes(opening.slice(name.length)),
      start,
      end,
      children: [],
      text: '',
    }
    const parent = stack.at(-1)
    if (parent) parent.children.push(element)
    else roots.push(element)
    if (!selfClosing) stack.push(element)
    cursor = end
  }
  if (stack.length > 0) throw new Error('PPTX export encountered malformed XML')
  return roots
}

export function descendants(elements: XmlElement[], localName: string): XmlElement[] {
  const result: XmlElement[] = []
  for (const element of elements) {
    if (element.localName === localName) result.push(element)
    result.push(...descendants(element.children, localName))
  }
  return result
}

export function replaceRanges(xml: string, replacements: Replacement[]): string {
  let output = xml
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end)
  }
  return output
}
