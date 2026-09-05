import type { CustomGeometry, CustomGeometryCommand, CustomGeometryPath } from '@ppt4ai/model'
import type { XmlElement } from './xml-range.js'

function numberAttribute(element: XmlElement, name: string): number | undefined {
  const raw = element.attributes[name]
  if (raw === undefined || raw.trim() === '') return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function points(command: XmlElement): Array<{ x: number; y: number }> | undefined {
  const result: Array<{ x: number; y: number }> = []
  for (const child of command.children) {
    if (child.localName !== 'pt') continue
    const x = numberAttribute(child, 'x')
    const y = numberAttribute(child, 'y')
    if (x === undefined || y === undefined) return undefined
    result.push({ x, y })
  }
  return result
}

/**
 * The source's `a:custGeom/a:pathLst` as the model would have imported it, mirroring
 * `parseCustomGeometry` the way `sourceFill` mirrors `parseDirectFill`.
 *
 * A mirror can drift from the parser it mirrors, and drift here shows up as either a needless rewrite or
 * a swallowed edit — both quiet. `custom-geometry-writeback.test.ts` therefore feeds one piece of XML to
 * both readers and asserts they agree, which the older mirrors in this package do not yet have.
 */
export function sourceCustomGeometry(geometry: XmlElement | undefined): CustomGeometry | undefined {
  const list = geometry?.children.find((child) => child.localName === 'pathLst')
  if (!list) return undefined
  const paths: CustomGeometryPath[] = []
  for (const pathNode of list.children) {
    if (pathNode.localName !== 'path') continue
    const commands: CustomGeometryCommand[] = []
    for (const command of pathNode.children) {
      const name = command.localName
      if (name === 'close') {
        commands.push({ type: 'close' })
        continue
      }
      if (name === 'arcTo') {
        const widthRadius = numberAttribute(command, 'wR')
        const heightRadius = numberAttribute(command, 'hR')
        const startAngle = numberAttribute(command, 'stAng')
        const swingAngle = numberAttribute(command, 'swAng')
        if (widthRadius === undefined || heightRadius === undefined || startAngle === undefined || swingAngle === undefined) {
          return undefined
        }
        commands.push({ type: 'arc', widthRadius, heightRadius, startAngle, swingAngle })
        continue
      }
      const list = points(command)
      if (!list) return undefined
      if ((name === 'moveTo' || name === 'lnTo') && list.length === 1) {
        commands.push({ type: name === 'moveTo' ? 'move' : 'line', x: list[0]!.x, y: list[0]!.y })
      } else if (name === 'cubicBezTo' && list.length === 3) {
        commands.push({
          type: 'cubic',
          x1: list[0]!.x, y1: list[0]!.y,
          x2: list[1]!.x, y2: list[1]!.y,
          x: list[2]!.x, y: list[2]!.y,
        })
      } else if (name === 'quadBezTo' && list.length === 2) {
        commands.push({ type: 'quad', x1: list[0]!.x, y1: list[0]!.y, x: list[1]!.x, y: list[1]!.y })
      } else {
        return undefined
      }
    }
    if (commands.length === 0) continue
    const width = numberAttribute(pathNode, 'w')
    const height = numberAttribute(pathNode, 'h')
    paths.push({
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      commands,
    })
  }
  return paths.length > 0 ? { paths } : undefined
}
