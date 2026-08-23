import { expect, test, type Locator } from '@playwright/test'

test('renders an image thumbnail and keeps the latest scene', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174')
  const canvas = page.locator('[data-testid="thumbnail-canvas"]')
  await expect(canvas).toHaveJSProperty('width', 320)
  await expect(canvas).toHaveJSProperty('height', 180)
  await expect.poll(() => page.getByTestId('thumbnail-result').textContent()).toContain('image-red')
  expect(await nonEmptyPixels(canvas)).toBeGreaterThan(0)

  await page.getByTestId('thumbnail-next').click()
  await expect.poll(() => page.getByTestId('thumbnail-result').textContent()).toContain('image-blue')
  await expect.poll(() => page.getByTestId('thumbnail-result').textContent()).not.toContain('image-red')
  expect(await nonEmptyPixels(canvas)).toBeGreaterThan(0)
})

async function nonEmptyPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((element) => {
    const source = element as HTMLCanvasElement
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
