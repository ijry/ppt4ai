import { expect, test, type Locator } from '@playwright/test'

/**
 * The per-slide thumbnail list, which is what the playground actually renders. The original spec
 * targeted a single `thumbnail-canvas` plus a "next" button; `3b7a2e0` replaced that UI with this
 * list and updated the unit test but not this one, so the only browser-side guardrail went dead.
 */
test('renders a thumbnail per slide in chromium and switches the active slide', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174')

  const thumbnails = page.locator('[data-testid="slide-thumbnail-list"] > button')
  // `createPageEntries` seeds exactly two pages.
  await expect(thumbnails).toHaveCount(2)

  const first = thumbnails.first().locator('canvas[data-thumbnail-canvas]')
  await expect(first).toHaveJSProperty('width', 240)
  await expect(first).toHaveJSProperty('height', 135)

  // The one assertion that proves the worker painted something in a real browser rather than just
  // sizing a canvas. Everything above it is already covered by App.test.ts.
  await expect.poll(() => nonEmptyPixels(first), { timeout: 15_000 }).toBeGreaterThan(0)

  await expect(thumbnails.first()).toHaveAttribute('aria-current', 'page')
  await thumbnails.nth(1).click()
  await expect(thumbnails.nth(1)).toHaveAttribute('aria-current', 'page')
  await expect(thumbnails.first()).not.toHaveAttribute('aria-current', 'page')

  const second = thumbnails.nth(1).locator('canvas[data-thumbnail-canvas]')
  await expect.poll(() => nonEmptyPixels(second), { timeout: 15_000 }).toBeGreaterThan(0)
})

async function nonEmptyPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((element) => {
    const source = element as HTMLCanvasElement
    if (!source.width || !source.height) return 0
    const sample = document.createElement('canvas')
    sample.width = source.width
    sample.height = source.height
    const context = sample.getContext('2d')
    if (!context) return 0
    context.drawImage(source, 0, 0)
    const pixels = context.getImageData(0, 0, source.width, source.height).data
    let count = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if ((pixels[index] ?? 0) > 0 || (pixels[index + 1] ?? 0) > 0 || (pixels[index + 2] ?? 0) > 0 || (pixels[index + 3] ?? 0) > 0) count += 1
    }
    return count
  })
}
