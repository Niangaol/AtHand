import { test, expect } from '@playwright/test';

const READ_POINT = '.chart-day[tabindex="0"]';

test('hovering a read point opens the 168px detail card and leaving closes it', async ({ page }) => {
  await page.goto('/today');
  const days = page.locator(READ_POINT);
  await expect(days).toHaveCount(7);

  const third = days.nth(2);
  await third.hover();
  const tip = third.locator('.chart-tip');
  await expect(tip).toBeVisible();
  for (const label of ['收入', '支出', '净额', '工时']) await expect(tip).toContainText(label);
  expect(await tip.evaluate((element) => getComputedStyle(element).width)).toBe('168px');

  await page.mouse.move(0, 0);
  await expect(page.locator('.chart-tip')).toHaveCount(0);
});

test('keyboard focus opens the detail card and Escape closes it', async ({ page }) => {
  await page.goto('/today');
  const fourth = page.locator(READ_POINT).nth(3);
  await fourth.focus();
  await expect(fourth).toBeFocused();
  await expect(fourth.locator('.chart-tip')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.chart-tip')).toHaveCount(0);
});

test('the details block holds the real seven row table', async ({ page }) => {
  await page.goto('/today');
  await page.locator('.chart-details summary').click();
  const table = page.locator('.chart-table');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveText(['日期', '收入', '支出', '净额', '工时']);
  await expect(table.locator('tbody tr')).toHaveCount(7);
});

test('the chart does not overflow 375px horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/today');
  await expect(page.locator(READ_POINT)).toHaveCount(7);
  const sizes = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(sizes.content, '/today must not overflow horizontally').toBeLessThanOrEqual(sizes.viewport);
});

test('captures the desktop and mobile chart screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/today');
  await expect(page.locator(READ_POINT)).toHaveCount(7);
  // 柱生长 420ms + 列间 30ms × 6 错峰，等动画落定再截
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'test-results/chart-desktop.png' });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/today');
  await expect(page.locator(READ_POINT)).toHaveCount(7);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'test-results/chart-mobile.png' });
});
