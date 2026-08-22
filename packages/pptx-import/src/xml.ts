export interface XmlNode {
  name: string
  attributes: Record<string, string>
  children: XmlNode[]
  text: string
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    if (entity === 'amp') return '&'
    if (entity === 'lt') return '<'
    if (entity === 'gt') return '>'
    if (entity === 'quot') return '"'
    if (entity === 'apos') return "'"
    if (entity.toLowerCase().startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
  })
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1]
    if (name) attributes[name] = decodeEntities(match[2] ?? match[3] ?? '')
  }
  return attributes
}

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#root', attributes: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  const tokenPattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[^>]*\?>|<[^>]+>|[^<]+/g

  for (const tokenMatch of source.matchAll(tokenPattern)) {
    const token = tokenMatch[0]
    const current = stack[stack.length - 1]
    if (!current) throw new Error('invalid XML parser stack')
    if (token.startsWith('<!--') || token.startsWith('<?') || token.startsWith('<!DOCTYPE')) continue
    if (token.startsWith('<![CDATA[')) {
      current.text += token.slice(9, -3)
      continue
    }
    if (!token.startsWith('<')) {
      current.text += decodeEntities(token)
      continue
    }
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim()
      if (current.name !== name) throw new Error(`invalid XML: expected closing ${current.name}, got ${name}`)
      stack.pop()
      continue
    }

    const selfClosing = token.endsWith('/>')
    const content = token.slice(1, selfClosing ? -2 : -1).trim()
    const nameMatch = /^([^\s/>]+)/.exec(content)
    if (!nameMatch) throw new Error(`invalid XML tag: ${token}`)
    const node: XmlNode = {
      name: nameMatch[1] ?? '',
      attributes: parseAttributes(content.slice(nameMatch[0].length)),
      children: [],
      text: '',
    }
    current.children.push(node)
    if (!selfClosing) stack.push(node)
  }

  if (stack.length !== 1) throw new Error(`invalid XML: unclosed ${stack[stack.length - 1]?.name}`)
  return root
}

export function localName(name: string): string {
  const separator = name.indexOf(':')
  return separator === -1 ? name : name.slice(separator + 1)
}

export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => localName(child.name) === name)
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  return children(node, name)[0]
}

export function attribute(node: XmlNode, name: string): string | undefined {
  return Object.entries(node.attributes).find(([key]) => localName(key) === name)?.[1]
}

export function textContent(node: XmlNode): string {
  return node.text + node.children.map(textContent).join('')
}
