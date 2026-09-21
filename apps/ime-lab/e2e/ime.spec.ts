import { expect, test, type CDPSession, type Page } from '@playwright/test'

const inputSelector = '[data-ppt4ai-ime-input]'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('ime-canvas')).toHaveJSProperty('width', 960)
  await page.locator(inputSelector).focus()
  await expect(page.locator(inputSelector)).toBeFocused()
})

test('renders native composition before committing Chinese text exactly once', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)

  await compose(cdp, 'zhong')
  await expect.poll(() => snapshot(page)).toEqual({
    committedText: '',
    compositionText: 'zhong',
    isComposing: true,
    caretOffset: 0,
    visibleText: 'zhong',
  })
  expect(await countPaintedPixels(page)).toBeGreaterThan(20)

  await commit(cdp, '中')
  await expect.poll(() => snapshot(page)).toEqual({
    committedText: '中',
    compositionText: '',
    isComposing: false,
    caretOffset: 1,
    visibleText: '中',
  })

  await compose(cdp, 'wen')
  await commit(cdp, '文')
  await expect.poll(() => snapshot(page)).toEqual({
    committedText: '中文',
    compositionText: '',
    isComposing: false,
    caretOffset: 2,
    visibleText: '中文',
  })
})

test('keeps the native caret anchor aligned while composition moves', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
  await page.evaluate(() => window.__IME_LAB__.setCaretOrigin({ x: 50, y: 80 }))
  await compose(cdp, 'zhong')

  const first = await caretRects(page)
  expectRectsNear(first.probe, first.range, 2)
  expect(await snapshot(page)).toMatchObject({ compositionText: 'zhong', isComposing: true })

  await page.evaluate(() => window.__IME_LAB__.setCaretOrigin({ x: 320, y: 240 }))
  const second = await caretRects(page)
  expectRectsNear(second.probe, second.range, 2)
  expect(second.probe.x - first.probe.x).toBeGreaterThanOrEqual(269)
  expect(second.probe.x - first.probe.x).toBeLessThanOrEqual(271)
  expect(second.probe.y - first.probe.y).toBeGreaterThanOrEqual(159)
  expect(second.probe.y - first.probe.y).toBeLessThanOrEqual(161)
  expect(await snapshot(page)).toMatchObject({ compositionText: 'zhong', isComposing: true })
})

test('inserts a newline and moves the caret to the next line', async ({ page }) => {
  const input = page.locator(inputSelector)
  await input.press('Enter')

  await expect.poll(() => snapshot(page)).toMatchObject({
    committedText: '\n',
    compositionText: '',
    isComposing: false,
    caretOffset: 1,
    visibleText: '\n',
  })
  const rect = await caretRects(page)
  const expected = await page.getByTestId('ime-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const bounds = canvas.getBoundingClientRect()
    return bounds.top + 68 * (bounds.height / 540)
  })
  expect(Math.abs(rect.probe.y - expected)).toBeLessThanOrEqual(2)
})

test('moves the Canvas caret to the clicked text position', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.insertText', { text: 'AB' })
  await expect.poll(() => snapshot(page)).toMatchObject({ committedText: 'AB', caretOffset: 2 })

  await page.getByTestId('ime-canvas').click({ position: { x: 50, y: 54 } })
  await expect.poll(() => snapshot(page)).toMatchObject({ committedText: 'AB', caretOffset: 1 })
  await expect.poll(() => inputIsFocused(page)).toBe(true)
})

test('soft-wraps long text without inserting newline characters', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
  const text = 'A'.repeat(80)
  await cdp.send('Input.insertText', { text })

  await expect.poll(() => snapshot(page)).toMatchObject({
    committedText: text,
    caretOffset: text.length,
    visibleText: text,
  })
  const inputRect = await page.evaluate(() => window.__IME_LAB__.getInputRect())
  const canvasRect = await page.getByTestId('ime-canvas').boundingBox()
  if (!canvasRect) throw new Error('Canvas bounds are unavailable')
  expect(inputRect.y).toBeGreaterThan(canvasRect.y + 40)
})

async function compose(cdp: CDPSession, text: string): Promise<void> {
  await cdp.send('Input.imeSetComposition', {
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  })
}

async function commit(cdp: CDPSession, text: string): Promise<void> {
  await cdp.send('Input.insertText', { text })
}

async function snapshot(page: Page) {
  return page.evaluate(() => window.__IME_LAB__.getSnapshot())
}

async function inputIsFocused(page: Page): Promise<boolean> {
  return page.locator(inputSelector).evaluate((input) => document.activeElement === input)
}

async function countPaintedPixels(page: Page): Promise<number> {
  return page.getByTestId('ime-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')
    if (!context) return 0
    const pixels = context.getImageData(30, 30, 160, 60).data
    let count = 0
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] ?? 255
      const green = pixels[index + 1] ?? 255
      const blue = pixels[index + 2] ?? 255
      if (red < 245 || green < 245 || blue < 245) count += 1
    }
    return count
  })
}

interface RectSnapshot {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

async function caretRects(page: Page): Promise<{ probe: RectSnapshot; range: RectSnapshot }> {
  return page.evaluate((selector) => {
    const input = document.querySelector<HTMLElement>(selector)
    const selection = window.getSelection()
    if (!input || !selection || selection.rangeCount === 0) {
      throw new Error('Native IME selection is unavailable')
    }
    const probeRect = window.__IME_LAB__.getInputRect()
    const rangeRect = selection.getRangeAt(0).getBoundingClientRect()
    const serialize = (rect: DOMRectReadOnly): RectSnapshot => ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    })
    return { probe: serialize(probeRect), range: serialize(rangeRect) }
  }, inputSelector)
}

function expectRectsNear(actual: RectSnapshot, expected: RectSnapshot, tolerance: number): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(actual.height - expected.height)).toBeLessThanOrEqual(tolerance)
}
