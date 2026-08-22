// @vitest-environment happy-dom

import type { TextBody } from '@ppt4ai/model'
import type { ImeBridgeEvent, ImeInputBridge, ImeInputBridgeOptions, TextEditorSnapshot } from '@ppt4ai/text'
import { describe, expect, it } from 'vitest'
import { createTextEditorController, type TextEditorControllerOptions } from './text-editor-controller'

const body: TextBody = { paragraphs: [{ runs: [{ text: 'B' }] }] }

function createFakeBridgeFactory(events: { options?: ImeInputBridgeOptions; focus: number; destroy: number }) {
  return (options: ImeInputBridgeOptions): ImeInputBridge => {
    events.options = options
    return {
      focus: () => { events.focus += 1 },
      setCaretRect: () => {},
      getCaretClientRect: () => new DOMRect(),
      destroy: () => { events.destroy += 1 },
    }
  }
}

function createRecordingBridgeFactory(events: {
  options: ImeInputBridgeOptions | undefined
  focus: number
  destroy: number
  caretRects: Array<{ x: number; y: number; width: number; height: number }>
}) {
  return (options: ImeInputBridgeOptions): ImeInputBridge => {
    events.options = options
    return {
      focus: () => { events.focus += 1 },
      setCaretRect: (rect) => { events.caretRects.push({ ...rect }) },
      getCaretClientRect: () => new DOMRect(),
      destroy: () => { events.destroy += 1 },
    }
  }
}

describe('text editor controller', () => {
  it('connects bridge events to one editor state and delegates lifecycle methods', () => {
    const events: { options?: ImeInputBridgeOptions; focus: number; destroy: number } = { focus: 0, destroy: 0 }
    const host = document.createElement('div')
    const controller = createTextEditorController({
      host,
      body,
      bridgeFactory: createFakeBridgeFactory(events),
    })

    expect(controller.getSnapshot().body).toEqual(body)
    expect(controller.getSnapshot().body).not.toBe(body)
    controller.dispatch({ type: 'text-input', text: 'A' })
    expect(controller.getSnapshot().body).toEqual({ paragraphs: [{ runs: [{ text: 'AB' }] }] })
    controller.focus()
    expect(events.focus).toBe(1)
    controller.destroy()
    controller.destroy()
    expect(events.destroy).toBe(1)
  })

  it('handles composition updates and suppresses the duplicate committed input', () => {
    const events: { options?: ImeInputBridgeOptions; focus: number; destroy: number } = { focus: 0, destroy: 0 }
    const bridgeEvents: ImeBridgeEvent[] = []
    const controller = createTextEditorController({
      host: document.createElement('div'),
      body: { paragraphs: [{ runs: [] }] },
      bridgeFactory: (options) => {
        events.options = options
        return createFakeBridgeFactory(events)(options)
      },
    })

    const callback = events.options?.onEvent
    expect(callback).toBeDefined()
    callback?.({ type: 'composition-start' })
    callback?.({ type: 'composition-update', text: 'zhong' })
    expect(controller.getSnapshot()).toMatchObject({
      body: { paragraphs: [{ runs: [] }] },
      composing: true,
      compositionText: 'zhong',
    })
    callback?.({ type: 'composition-end', text: '中' })
    callback?.({ type: 'text-input', text: '中' })
    expect(controller.getSnapshot().body).toEqual({ paragraphs: [{ runs: [{ text: '中' }] }] })
    bridgeEvents.push({ type: 'text-input', text: 'A' })
    controller.dispatch(bridgeEvents[0]!)
    expect(controller.getSnapshot().body).toEqual({ paragraphs: [{ runs: [{ text: '中A' }] }] })
  })

  it('ignores dispatch and bridge callbacks after destroy', () => {
    const events: { options?: ImeInputBridgeOptions; focus: number; destroy: number } = { focus: 0, destroy: 0 }
    const controller = createTextEditorController({
      host: document.createElement('div'),
      body,
      bridgeFactory: createFakeBridgeFactory(events),
    })
    const callback = events.options?.onEvent
    controller.destroy()
    controller.dispatch({ type: 'text-input', text: 'A' })
    callback?.({ type: 'text-input', text: 'A' })
    expect(controller.getSnapshot().body).toEqual(body)
  })

  it('forwards the latest caret rectangle and repeats it on focus', () => {
    const events = { options: undefined as ImeInputBridgeOptions | undefined, focus: 0, destroy: 0, caretRects: [] as Array<{ x: number; y: number; width: number; height: number }> }
    const controller = createTextEditorController({
      host: document.createElement('div'),
      body,
      bridgeFactory: createRecordingBridgeFactory(events),
    })
    const rect = { x: 50, y: 80, width: 1, height: 24 }

    controller.syncCaret(rect)
    rect.x = 99
    controller.focus()

    expect(events.caretRects).toEqual([
      { x: 50, y: 80, width: 1, height: 24 },
      { x: 50, y: 80, width: 1, height: 24 },
    ])
  })

  it('ignores caret synchronization after destroy', () => {
    const events = { options: undefined as ImeInputBridgeOptions | undefined, focus: 0, destroy: 0, caretRects: [] as Array<{ x: number; y: number; width: number; height: number }> }
    const controller = createTextEditorController({
      host: document.createElement('div'),
      body,
      bridgeFactory: createRecordingBridgeFactory(events),
    })
    controller.destroy()
    controller.syncCaret({ x: 1, y: 2, width: 1, height: 3 })

    expect(events.caretRects).toEqual([])
  })

  it('publishes selection transactions and stops them after destroy', () => {
    const events = { options: undefined as ImeInputBridgeOptions | undefined, focus: 0, destroy: 0, caretRects: [] as Array<{ x: number; y: number; width: number; height: number }> }
    const snapshots: TextEditorSnapshot[] = []
    const controller = createTextEditorController({
      host: document.createElement('div'),
      body,
      bridgeFactory: createRecordingBridgeFactory(events),
    })
    const unsubscribe = controller.subscribe((snapshot) => snapshots.push(snapshot))

    controller.setSelection({ anchor: 1, head: 3 })

    expect(snapshots.at(-1)?.selection).toEqual({ anchor: 1, head: 3 })
    expect(snapshots.at(-1)).not.toBe(controller.getSnapshot())
    controller.destroy()
    controller.setSelection({ anchor: 1, head: 1 })
    unsubscribe()

    expect(snapshots).toHaveLength(1)
  })
})

const _typeCheck: (options: TextEditorControllerOptions) => void = () => {}
void _typeCheck
