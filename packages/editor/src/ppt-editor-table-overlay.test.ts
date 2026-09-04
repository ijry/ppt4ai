// @vitest-environment happy-dom
import type { AssetAdapter } from '@ppt4ai/model'
import type { SceneGraph, SceneTableLayoutCell } from '@ppt4ai/render'
import { createApp, h, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { createPpt4aiI18n } from './i18n'
import PptEditor from './PptEditor.vue'

const adapter: AssetAdapter = { get: async () => undefined, put: async () => {} }

function cell(row: number, column: number, x: number, y: number): SceneTableLayoutCell {
  const bounds = { x, y, w: 914400, h: 457200 }
  return {
    row,
    column,
    rowSpan: 1,
    colSpan: 1,
    bounds,
    body: { paragraphs: [] },
    borders: {},
    textLayout: { bounds, fontScale: 100000, overflow: false, contentBounds: bounds, lines: [] },
    resolvedStyle: { borders: {} },
  }
}

const tableBounds = { x: 914400, y: 914400, w: 1828800, h: 914400 }

const scene: SceneGraph = {
  slideId: 'slide-1',
  page: { w: 9144000, h: 5143500 },
  nodes: [
    {
      id: 'table-1',
      kind: 'table',
      bounds: tableBounds,
      layout: {
        bounds: tableBounds,
        columns: [914400, 914400],
        rows: [457200, 457200],
        borders: [],
        cells: [
          cell(0, 0, 914400, 914400),
          cell(0, 1, 1828800, 914400),
          cell(1, 0, 914400, 1371600),
          cell(1, 1, 1828800, 1371600),
        ],
      },
    },
    { id: 'shape-1', kind: 'shape', bounds: { x: 0, y: 2743200, w: 914400, h: 914400 }, path: [] },
  ],
}

const mounted: App[] = []

interface Events {
  selects: unknown[]
  edits: unknown[]
}

function mountEditor(selectedElementIds: string[]) {
  const events: Events = { selects: [], edits: [] }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(PptEditor, {
      scene,
      adapter,
      selectedElementIds,
      'onSelect-table-cell': (payload: unknown) => { events.selects.push(payload) },
      'onEdit-table-cell': (payload: unknown) => { events.edits.push(payload) },
    }),
  })
  app.use(createPpt4aiI18n())
  app.mount(host)
  mounted.push(app)
  return { host, events }
}

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function cellAt(host: HTMLElement, row: number, column: number): HTMLElement {
  const element = host.querySelector(`[data-table-cell-row="${row}"][data-table-cell-column="${column}"]`)
  if (!element) throw new Error(`missing table cell ${row}:${column}`)
  return element as HTMLElement
}

const EMU_PER_CSS_PIXEL = 9525

/**
 * The overlay hit-tests `event.clientX/clientY` against its own model, so the click needs real
 * coordinates rather than just the right target. Cell centres come from the scene bounds: the table
 * starts at EMU (914400, 914400) and each cell is 914400 x 457200.
 */
function cellCentre(row: number, column: number): { clientX: number; clientY: number } {
  const x = (914400 + column * 914400 + 914400 / 2) / EMU_PER_CSS_PIXEL
  const y = (914400 + row * 457200 + 457200 / 2) / EMU_PER_CSS_PIXEL
  return { clientX: x, clientY: y }
}

/**
 * The table cell overlay existed with unit tests but no app ever mounted it. This wires it into the
 * editor, which is the prerequisite for the table formatting toolbar: the toolbar needs to know
 * which cells are selected, and the engine only learns that through `selectTableCell`.
 */
describe('PptEditor table cell overlay', () => {
  it('shows the overlay for a single selected table', () => {
    const { host } = mountEditor(['table-1'])

    expect(host.querySelector('[data-table-editor-overlay]')).not.toBeNull()
  })

  it('hides the overlay with no selection', () => {
    const { host } = mountEditor([])

    expect(host.querySelector('[data-table-editor-overlay]')).toBeNull()
  })

  it('hides the overlay for a non-table selection', () => {
    const { host } = mountEditor(['shape-1'])

    expect(host.querySelector('[data-table-editor-overlay]')).toBeNull()
  })

  /** The overlay owns its cell selection; the editor reports it so the engine can hold the truth. */
  it('reports a clicked cell with the table element id', () => {
    const { host, events } = mountEditor(['table-1'])

    const grid = host.querySelector('[data-table-editor-overlay]') as HTMLElement
    grid.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, ...cellCentre(1, 1) }))

    expect(events.selects).toHaveLength(1)
    // The overlay's `TableCellSelection` is anchor/focus points, not the engine's flat row/column
    // record of the same name — two different types, one name, in two modules.
    expect(events.selects[0]).toMatchObject({
      elementId: 'table-1',
      selection: { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } },
    })
  })

  it('reports a double-clicked cell as an edit intent', () => {
    const { host, events } = mountEditor(['table-1'])

    cellAt(host, 0, 1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))

    expect(events.edits).toEqual([{ elementId: 'table-1', point: { row: 0, column: 1 } }])
  })
})
