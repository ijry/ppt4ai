import { describe, expect, it } from 'vitest'
import { resolveColor, validateDocument, type Color, type Ppt4aiDocument } from './index'

/**
 * `a:sysClr` names the colour a reader looks up and caches the resolved value beside it. The model kept
 * only the cached value, so every system colour written back said `windowText` — a theme's light slot
 * ended up naming the system's dark colour. `systemName` holds the word; `v` still holds the hex, because
 * that is the only thing a canvas can paint.
 */

function documentWith(color: unknown): Ppt4aiDocument {
  return {
    format: 'ppt4ai',
    version: 1,
    id: 'dck_system',
    page: { w: 12192000, h: 6858000 },
    slides: { sld_1: { id: 'sld_1', elementIds: ['el_shape'] } },
    slideOrder: ['sld_1'],
    elements: {
      el_shape: {
        id: 'el_shape',
        kind: 'shape',
        preset: 'rect',
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        fill: { color },
      },
    },
  } as unknown as Ppt4aiDocument
}

function errorsFor(color: unknown): string[] {
  const result = validateDocument(documentWith(color))
  return result.valid ? [] : result.errors
}

describe('a system colour keeps its name', () => {
  it('accepts the name beside the cached value', () => {
    expect(errorsFor({ type: 'system', v: 'FFFFFF', systemName: 'window' })).toEqual([])
  })

  it('accepts a name this build has never heard of, because the enumeration is not the model\'s to police', () => {
    expect(errorsFor({ type: 'system', v: 'FFFFFF', systemName: 'gradientActiveCaption' })).toEqual([])
  })

  it('rejects a name that is not an OOXML token', () => {
    expect(errorsFor({ type: 'system', v: 'FFFFFF', systemName: '' }).length).toBeGreaterThan(0)
    expect(errorsFor({ type: 'system', v: 'FFFFFF', systemName: 'window text' }).length).toBeGreaterThan(0)
    expect(errorsFor({ type: 'system', v: 'FFFFFF', systemName: 42 }).length).toBeGreaterThan(0)
  })

  /** The name is for persistence only: a canvas cannot ask the OS what `window` is today. */
  it('still paints from the cached hex', () => {
    const color: Color = { type: 'system', v: '112233', systemName: 'window' }

    expect(resolveColor(color)?.rgb).toBe('112233')
  })
})
