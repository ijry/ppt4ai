import type { ImeBridgeEvent, ScreenRect } from './types'

export interface ImeInputBridgeOptions {
  readonly host: HTMLElement
  readonly onEvent: (event: ImeBridgeEvent) => void
}

export interface ImeInputBridge {
  focus(): void
  setCaretRect(rect: ScreenRect): void
  getCaretClientRect(): DOMRectReadOnly
  destroy(): void
}

const inputSelector = '[data-ppt4ai-ime-input]'

export function createImeInputBridge(
  options: ImeInputBridgeOptions,
): ImeInputBridge {
  const input = document.createElement('div')
  input.setAttribute('contenteditable', 'plaintext-only')
  input.setAttribute('aria-hidden', 'true')
  input.setAttribute('data-ppt4ai-ime-input', '')
  input.setAttribute('role', 'textbox')
  input.tabIndex = -1
  input.spellcheck = false
  input.style.position = 'fixed'
  input.style.left = '0px'
  input.style.top = '0px'
  input.style.width = '1px'
  input.style.height = '1px'
  input.style.minHeight = '1px'
  input.style.opacity = '0'
  input.style.overflow = 'hidden'
  input.style.whiteSpace = 'pre'
  input.style.caretColor = 'transparent'
  input.style.zIndex = '-1'
  options.host.append(input)

  let isComposing = false
  let suppressedTextInput: string | undefined
  let suppressNextLineBreak = false
  let destroyed = false

  const handleCompositionStart = (): void => {
    if (destroyed) return
    isComposing = true
    options.onEvent({ type: 'composition-start' })
  }

  const handleCompositionUpdate = (event: CompositionEvent): void => {
    if (destroyed) return
    isComposing = true
    options.onEvent({ type: 'composition-update', text: event.data ?? '' })
  }

  const handleCompositionEnd = (event: CompositionEvent): void => {
    if (destroyed) return
    isComposing = false
    const committedText = event.data ?? ''
    options.onEvent({ type: 'composition-end', text: committedText })
    if (committedText) {
      suppressedTextInput = committedText
      options.onEvent({ type: 'text-input', text: committedText })
      resetInput()
      queueMicrotask(() => {
        suppressedTextInput = undefined
      })
    }
  }

  const handleBeforeInput = (event: InputEvent): void => {
    if (destroyed) return

    if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
      event.preventDefault()
      if (suppressNextLineBreak) {
        suppressNextLineBreak = false
      } else if (!isComposing) {
        options.onEvent({ type: 'insert-line-break' })
      }
      resetInput()
      return
    }

    if (event.inputType === 'deleteContentBackward') {
      event.preventDefault()
      options.onEvent({ type: 'delete-backward' })
      resetInput()
      return
    }

    if (
      (event.inputType === 'insertText' || event.inputType === 'insertCompositionText') &&
      event.data
    ) {
      if (isComposing) return
      event.preventDefault()
      if (suppressedTextInput === event.data) {
        suppressedTextInput = undefined
        resetInput()
        return
      }
      suppressedTextInput = undefined
      options.onEvent({ type: 'text-input', text: event.data })
      resetInput()
    }
  }

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (destroyed || event.key !== 'Enter' || isComposing) return
    event.preventDefault()
    suppressNextLineBreak = true
    options.onEvent({ type: 'insert-line-break' })
    queueMicrotask(() => {
      suppressNextLineBreak = false
    })
    resetInput()
  }

  input.addEventListener('compositionstart', handleCompositionStart)
  input.addEventListener('compositionupdate', handleCompositionUpdate)
  input.addEventListener('compositionend', handleCompositionEnd)
  input.addEventListener('beforeinput', handleBeforeInput)
  input.addEventListener('keydown', handleKeyDown)

  return {
    focus(): void {
      if (destroyed) return
      input.focus()
      resetSelection()
    },

    setCaretRect(rect: ScreenRect): void {
      if (destroyed) return
      const width = Math.max(1, finiteOrZero(rect.width))
      const height = Math.max(1, finiteOrZero(rect.height))
      input.style.left = `${clampToViewport(rect.x, width, window.innerWidth)}px`
      input.style.top = `${clampToViewport(rect.y, height, window.innerHeight)}px`
      input.style.height = `${height}px`
    },

    getCaretClientRect(): DOMRectReadOnly {
      const selection = document.getSelection()
      if (selection && selection.rangeCount > 0 && input.contains(selection.anchorNode)) {
        const rect = selection.getRangeAt(0).getBoundingClientRect()
        if (rect.width || rect.height || rect.x || rect.y) {
          return rect
        }
      }
      return input.getBoundingClientRect()
    },

    destroy(): void {
      if (destroyed) return
      destroyed = true
      input.removeEventListener('compositionstart', handleCompositionStart)
      input.removeEventListener('compositionupdate', handleCompositionUpdate)
      input.removeEventListener('compositionend', handleCompositionEnd)
      input.removeEventListener('beforeinput', handleBeforeInput)
      input.removeEventListener('keydown', handleKeyDown)
      input.remove()
    },
  }

  function resetInput(): void {
    input.textContent = ''
    resetSelection()
  }

  function resetSelection(): void {
    const selection = document.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(input)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function clampToViewport(value: number, size: number, viewport: number): number {
  const max = Math.max(0, finiteOrZero(viewport) - size)
  return Math.min(max, Math.max(0, finiteOrZero(value)))
}
