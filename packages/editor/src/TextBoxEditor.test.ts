// @vitest-environment happy-dom
import type { TextBody } from '@ppt4ai/model'
import type { ImeInputBridge, ImeInputBridgeOptions, ScreenRect, TextEditorSelection } from '@ppt4ai/text'
import { createApp, h, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import TextBoxEditor from './TextBoxEditor.vue'

const bounds = { x: 0, y: 0, w: 1000000, h: 1000000 }
const transform = { originX: 0, originY: 0, scale: 1 / 9525 }
const body: TextBody = { paragraphs: [{ runs: [{ text: 'AB' }] }] }

interface BridgeHarness {
  options?: ImeInputBridgeOptions
  destroyCount: number
  caretRects: ScreenRect[]
}

function createBridgeFactory(harness: BridgeHarness) {
  return (options: ImeInputBridgeOptions): ImeInputBridge => {
    harness.options = options
    return {
      focus: () => {},
      setCaretRect: (rect) => harness.caretRects.push({ ...rect }),
      getCaretClientRect: () => new DOMRect(),
      destroy: () => { harness.destroyCount += 1 },
    }
  }
}

function pointer(type: string, x: number, y: number): Event {
  const event = new Event(type, { bubbles: true })
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    button: { value: 0 },
    pointerId: { value: 1 },
  })
  return event
}

describe('TextBoxEditor', () => {
  it('keeps inactive hosts inert and creates one controller per active lifetime', async () => {
    const active = ref(false)
    const harness: BridgeHarness = { destroyCount: 0, caretRects: [] }
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      setup: () => () => h(TextBoxEditor, {
        body,
        bounds,
        transform,
        active: active.value,
        bridgeFactory: createBridgeFactory(harness),
      }),
    })
    app.mount(host)

    expect(host.querySelector('[data-text-editor-overlay]')).toBeNull()
    active.value = true
    await nextTick()
    expect(harness.options).toBeDefined()
    expect(host.querySelector('[data-text-box-editor]')?.textContent).toBe('')
    expect(host.querySelectorAll('[data-selection-border]')).toHaveLength(1)
    expect(host.querySelectorAll('[data-selection-handle]')).toHaveLength(8)
    active.value = false
    await nextTick()
    expect(harness.destroyCount).toBe(1)
    expect(host.querySelector('[data-selection-border]')).toBeNull()

    app.unmount()
    host.remove()
  })

  it('maps a click and reverse pointer drag to controller selections', async () => {
    const harness: BridgeHarness = { destroyCount: 0, caretRects: [] }
    const selections: Array<{ anchor: number; head: number }> = []
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      setup: () => () => h(TextBoxEditor, {
        body,
        bounds,
        transform,
        active: true,
        bridgeFactory: createBridgeFactory(harness),
        'onUpdate:selection': (selection: TextEditorSelection) => selections.push({ ...selection }),
      }),
    })
    app.mount(host)
    await nextTick()
    const surface = host.querySelector('[data-text-box-surface]') as HTMLElement

    surface.dispatchEvent(pointer('pointerdown', 30, 0))
    surface.dispatchEvent(pointer('pointermove', 0, 0))
    surface.dispatchEvent(pointer('pointerup', 0, 0))

    expect(selections.at(-1)).toEqual({ anchor: 3, head: 1 })
    expect(harness.caretRects.at(-1)?.x).toBe(0)
    app.unmount()
    host.remove()
  })

  it('keeps composition provisional text out of the body and commits once', async () => {
    const harness: BridgeHarness = { destroyCount: 0, caretRects: [] }
    const bodies: TextBody[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      setup: () => () => h(TextBoxEditor, {
        body: { paragraphs: [{ runs: [] }] },
        bounds,
        transform,
        active: true,
        bridgeFactory: createBridgeFactory(harness),
        'onUpdate:body': (nextBody: TextBody) => bodies.push(nextBody),
      }),
    })
    app.mount(host)
    await nextTick()

    harness.options?.onEvent({ type: 'composition-start' })
    harness.options?.onEvent({ type: 'composition-update', text: 'zhong' })
    await nextTick()
    expect(host.querySelectorAll('[data-text-composition]').length).toBeGreaterThan(0)
    expect(bodies).toEqual([])
    expect(host.querySelector('[data-text-box-editor]')?.textContent).toBe('')

    harness.options?.onEvent({ type: 'composition-end', text: '中' })
    harness.options?.onEvent({ type: 'text-input', text: '中' })
    await nextTick()
    expect(bodies).toEqual([{ paragraphs: [{ runs: [{ text: '中' }] }] }])

    app.unmount()
    host.remove()
  })
})
