import { expect, test, type Locator } from '@playwright/test'

/**
 * The editor canvas, which the playground reaches through `PptEditor` -> `SlideCanvas`. Nothing
 * asserted anything about it before.
 *
 * The assertion is the spread of the painted pixels, not how many there are. The defect it guards
 * against applied zoom twice and crammed every node into a fraction of one pixel at the origin, so
 * what distinguishes broken from working is geometry — an ink-density threshold would only encode
 * how busy this particular seeded page happens to be.
 */
test('paints the editor canvas across its own area', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174')

  const canvas = page.locator('canvas[data-slide-canvas]')
  await expect(canvas).toBeVisible()

  // Before the fix this box was about one pixel wide at the origin.
  await expect.poll(() => widthRatio(canvas), { timeout: 15_000 }).toBeGreaterThan(0.5)

  const spread = await paintedSpread(canvas)
  expect(spread.canvasWidth).toBeGreaterThan(0)
  expect(spread.canvasHeight).toBeGreaterThan(0)
  expect(spread.height / spread.canvasHeight).toBeGreaterThan(0.5)
})

async function widthRatio(canvas: Locator): Promise<number> {
  const spread = await paintedSpread(canvas)
  return spread.canvasWidth ? spread.width / spread.canvasWidth : 0
}

interface PaintedSpread {
  width: number
  height: number
  canvasWidth: number
  canvasHeight: number
}

/** The bounding box of every non-transparent pixel, in device pixels. */
async function paintedSpread(canvas: Locator): Promise<PaintedSpread> {
  return canvas.evaluate((element) => {
    const source = element as HTMLCanvasElement
    const empty = { width: 0, height: 0, canvasWidth: source.width, canvasHeight: source.height }
    if (!source.width || !source.height) return empty
    const sample = document.createElement('canvas')
    sample.width = source.width
    sample.height = source.height
    const context = sample.getContext('2d')
    if (!context) return empty
    context.drawImage(source, 0, 0)
    const pixels = context.getImageData(0, 0, source.width, source.height).data
    let minX = source.width
    let minY = source.height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        if ((pixels[(y * source.width + x) * 4 + 3] ?? 0) === 0) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (maxX < 0) return empty
    return {
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      canvasWidth: source.width,
      canvasHeight: source.height,
    }
  })
}
