import { test, expect } from '@playwright/test';

test('desktop navigation, filters, empty week and preview boundaries', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('把这一周，过得心里有数。');
  await page.screenshot({ path: 'test-results/desktop-home.png', fullPage: true });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '周账单' }).click();
  await expect(page.getByRole('main')).toBeFocused();
  await page.getByRole('button', { name: '只看支出' }).click();
  await expect(page.getByRole('region', { name: '账单明细' }).getByText('奶茶店排班')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '账单明细' }).getByText('食堂午饭')).toBeVisible();
  await page.getByRole('button', { name: '上一周' }).click();
  await expect(page.getByText('这一页，还是空白的')).toBeVisible();
  await page.getByRole('button', { name: '回到本周' }).click();
  await expect(page.getByText('食堂午饭')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '这一周，记在这里。' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: '记一笔' }).click();
  await page.getByRole('tab', { name: '记工时' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '记支出' })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('支出金额');
  await expect(page.getByRole('button', { name: '保存记录' })).toBeEnabled();
  await page.getByRole('navigation').getByRole('link', { name: '单位管理' }).click();
  await expect(page.getByRole('heading', { name: '校园奶茶店' })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: '月度汇总' }).click();
  await expect(page.getByText('本月净剩')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: '设置' }).click();
  await expect(page.getByRole('heading', { name: '本地数据' })).toBeVisible();
  await page.goBack();
  await expect(page.getByText('本月净剩')).toBeVisible();
  await page.goto('/missing');
  await page.getByRole('link', { name: '回到今天' }).click();
  await expect(page).toHaveURL('/');
  expect(errors).toEqual([]);
});

test('small ledger labels meet readable text contrast', async ({ page }) => {
  await page.goto('/ledger');
  const ratios = await page.evaluate(() => {
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    return ['.record-day > h3', '.record-day > h3 span', '.record-description > span'].map((selector) => {
      const element = document.querySelector(selector)!;
      const foreground = luminance(getComputedStyle(element).color);
      return { selector, ratio: 1.05 / (foreground + 0.05) };
    });
  });
  for (const item of ratios) expect(item.ratio, item.selector).toBeGreaterThanOrEqual(4.5);
});

test('mobile pages fit 375px and navigation stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/', '/ledger', '/entry', '/workplaces', '/monthly', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const sizes = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
    expect(sizes.content, `${path} must not overflow horizontally`).toBeLessThanOrEqual(sizes.viewport);
  }
  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('link', { name: '今天', exact: true }).click();
  await expect(page).toHaveURL('/');
  const positions = await page.evaluate(() => ({ headingTop: document.querySelector('h1')!.getBoundingClientRect().top, navBottom: document.querySelector('.sidebar')!.getBoundingClientRect().bottom }));
  expect(positions.headingTop).toBeGreaterThanOrEqual(positions.navBottom);
  await page.screenshot({ path: 'test-results/mobile-home.png', fullPage: true });
  await nav.getByRole('link', { name: '设置' }).click();
  await expect(page.getByRole('heading', { name: '按自己的节奏来。' })).toBeVisible();
});
