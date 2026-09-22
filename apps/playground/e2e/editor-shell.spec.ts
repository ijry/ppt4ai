import { expect, test } from '@playwright/test'

test('editor shell: four regions, add + select a slide', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174/')
  for (const region of ['toolbar', 'navigator', 'stage', 'inspector']) {
    await expect(page.locator(`[data-region="${region}"]`)).toBeVisible()
  }
  const before = await page.locator('[data-slide-item]').count()
  await page.locator('[data-add-slide]').click()
  await expect.poll(() => page.locator('[data-slide-item]').count()).toBeGreaterThan(before)
  await page.locator('[data-slide-item]').last().click()
  await expect(page.locator('[data-region="stage"] canvas[data-slide-canvas]')).toBeVisible()
})
