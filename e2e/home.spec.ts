import { test, expect } from '@playwright/test';

test('the minimal home keeps actions one tap away and the assistant tucked until called', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('今天，顺手就好。');

  const intents = page.getByRole('navigation', { name: '核心入口' });
  await expect(intents.getByRole('link', { name: /看看今天/ })).toBeVisible();
  await expect(intents.getByRole('button', { name: /说个安排/ })).toBeVisible();
  await expect(intents.getByRole('link', { name: /记一笔/ })).toBeVisible();
  await expect(intents.getByRole('link', { name: /开始专注/ })).toBeVisible();

  const input = page.getByLabel('告诉助手要做什么');
  await expect(input).toHaveCount(0);
  await page.getByRole('button', { name: /说一句，顺手去做/ }).click();
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill('今天有什么安排？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('alert')).toContainText('还没有连接电脑');
  await expect(page.getByRole('alert').getByRole('link', { name: '去连接电脑' })).toBeVisible();

  await page.getByRole('button', { name: '收起输入框' }).click();
  await expect(input).toHaveCount(0);
  await page.getByRole('button', { name: /说个安排/ }).click();
  await expect(input).toHaveValue('帮我安排：');
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);

  await intents.getByRole('link', { name: /看看今天/ }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('region', { name: '今日安排' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a quick expense appears in the home activity stream', async ({ page }) => {
  await page.goto('/entry');
  await page.getByRole('tab', { name: '记支出' }).click();
  await page.getByLabel('支出金额（元）').fill('18.5');
  await page.getByLabel('备注（选填）').fill('午饭');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.getByText('本机账本')).toBeVisible();

  await page.goto('/');
  const feed = page.getByRole('region', { name: '今日记录' });
  await expect(feed.getByText('记支出')).toBeVisible();
  await expect(feed.getByText('午饭 · ¥18.50')).toBeVisible();
});

test('the minimal home fits a phone and reveals the composer in place', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole('button', { name: /说一句，顺手去做/ }).click();
  const input = page.getByLabel('告诉助手要做什么');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
