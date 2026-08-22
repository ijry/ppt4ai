// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImeInputBridge } from './create-ime-input-bridge'

describe('createImeInputBridge', () => {
  let host: HTMLElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('creates a hidden plaintext contenteditable at the caret anchor', () => {
    const bridge = createImeInputBridge({ host, onEvent: vi.fn() })

    bridge.setCaretRect({ x: 50, y: 80, width: 1, height: 24 })

    const input = getInput(host)
    expect(input.getAttribute('contenteditable')).toBe('plaintext-only')
    expect(input.getAttribute('aria-hidden')).toBe('true')
    expect(input.style.position).toBe('fixed')
    expect(input.style.left).toBe('50px')
    expect(input.style.top).toBe('80px')
    expect(input.style.width).toBe('1px')
    expect(input.style.height).toBe('24px')
    expect(input.style.minHeight).toBe('1px')
    expect(input.style.opacity).toBe('0')
    expect(input.style.overflow).toBe('hidden')
    expect(input.style.whiteSpace).toBe('pre')
    expect(input.style.caretColor).toBe('transparent')
    expect(input.style.zIndex).toBe('-1')
  })

  it('clamps the caret anchor to the viewport', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(200)
    const bridge = createImeInputBridge({ host, onEvent: vi.fn() })

    bridge.setCaretRect({ x: -20, y: -10, width: 1, height: 24 })
    expect(getInput(host).style.left).toBe('0px')
    expect(getInput(host).style.top).toBe('0px')

    bridge.setCaretRect({ x: 500, y: 300, width: 1, height: 24 })
    expect(getInput(host).style.left).toBe('319px')
    expect(getInput(host).style.top).toBe('176px')
  })

  it('maps composition and committed input in exact order', () => {
    const onEvent = vi.fn()
    createImeInputBridge({ host, onEvent })
    const input = getInput(host)

    input.dispatchEvent(new CompositionEvent('compositionstart'))
    input.dispatchEvent(compositionEvent('compositionupdate', 'zhong'))
    dispatchBeforeInput(input, 'insertText', 'duplicate')
    dispatchBeforeInput(input, 'insertCompositionText', 'duplicate')
    input.dispatchEvent(compositionEvent('compositionend', '中'))
    dispatchBeforeInput(input, 'insertText', '中')

    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: 'composition-start' },
      { type: 'composition-update', text: 'zhong' },
      { type: 'composition-end', text: '中' },
      { type: 'text-input', text: '中' },
    ])
  })

  it('ignores empty insertion data and maps backward deletion', () => {
    const onEvent = vi.fn()
    createImeInputBridge({ host, onEvent })
    const input = getInput(host)

    dispatchBeforeInput(input, 'insertText', null)
    dispatchBeforeInput(input, 'insertText', '')
    dispatchBeforeInput(input, 'insertCompositionText', '')
    dispatchBeforeInput(input, 'deleteContentBackward', null)

    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: 'delete-backward' },
    ])
  })

  it('maps line breaks from beforeinput and Enter fallback', () => {
    const onEvent = vi.fn()
    createImeInputBridge({ host, onEvent })
    const input = getInput(host)

    dispatchBeforeInput(input, 'insertLineBreak', null)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))

    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: 'insert-line-break' },
      { type: 'insert-line-break' },
    ])
  })

  it('clears committed DOM text and restores a collapsed selection', () => {
    createImeInputBridge({ host, onEvent: vi.fn() })
    const input = getInput(host)
    input.textContent = 'browser text'

    dispatchBeforeInput(input, 'insertText', '中')

    const selection = window.getSelection()
    expect(input.textContent).toBe('')
    expect(selection?.isCollapsed).toBe(true)
    expect(selection?.anchorNode).toBe(input)
  })

  it('focuses the hidden input', () => {
    const bridge = createImeInputBridge({ host, onEvent: vi.fn() })

    bridge.focus()

    expect(document.activeElement).toBe(getInput(host))
  })

  it('destroys idempotently and detaches event listeners', () => {
    const onEvent = vi.fn()
    const bridge = createImeInputBridge({ host, onEvent })
    const input = getInput(host)

    bridge.destroy()
    bridge.destroy()
    input.dispatchEvent(new CompositionEvent('compositionstart'))

    expect(host.querySelector('[data-ppt4ai-ime-input]')).toBeNull()
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('cleans up multiple bridge instances without leaking elements', () => {
    const first = createImeInputBridge({ host, onEvent: vi.fn() })
    const second = createImeInputBridge({ host, onEvent: vi.fn() })
    expect(host.querySelectorAll('[data-ppt4ai-ime-input]')).toHaveLength(2)

    first.destroy()
    expect(host.querySelectorAll('[data-ppt4ai-ime-input]')).toHaveLength(1)

    second.destroy()
    expect(host.querySelectorAll('[data-ppt4ai-ime-input]')).toHaveLength(0)
  })
})

function getInput(host: HTMLElement): HTMLElement {
  const input = host.querySelector<HTMLElement>('[data-ppt4ai-ime-input]')
  if (!input) {
    throw new Error('IME input was not created')
  }
  return input
}

function dispatchBeforeInput(
  input: HTMLElement,
  inputType: string,
  data: string | null,
): void {
  input.dispatchEvent(new InputEvent('beforeinput', { inputType, data, cancelable: true }))
}

function compositionEvent(type: 'compositionupdate' | 'compositionend', data: string): CompositionEvent {
  const event = new CompositionEvent(type)
  Object.defineProperty(event, 'data', { configurable: true, value: data })
  return event
}
