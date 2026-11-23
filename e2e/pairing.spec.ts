import { test, expect } from '@playwright/test';

import { startGateway } from './gatewayFixture';
let gateway = '';
let password = '';
let stop: () => Promise<void>;
test.beforeAll(async () => { const fixture = await startGateway(); gateway = fixture.url; password = fixture.password; stop = fixture.stop; });
test.afterAll(async () => { await stop?.(); });

test('手机扫码配对后自动导入样本', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('服务地址').fill(gateway);
  await page.getByLabel('访问口令').fill(password);
  await page.getByRole('button', { name: '连接', exact: true }).click();
  await expect(page.getByRole('heading', { name: /已登录|登录账号或连接网关/ })).toBeVisible();

  const issued = page.waitForResponse((response) => response.url().endsWith('/api/pair/code'));
  await page.getByRole('button', { name: '手机扫码配对' }).click();
  const pairing = await (await issued).json();
  await expect(page.getByLabel('手机配对二维码')).toBeVisible();
  await expect(page.getByText(`目标地址：${gateway}`)).toBeVisible();

  const exchanged = await page.request.post(`${gateway}/api/pair`, { data: { code: pairing.code } });
  expect(exchanged.ok()).toBe(true);
  const session = await exchanged.json();
  const uploaded = await page.request.post(`${gateway}/api/samples`, {
    headers: { Authorization: `Bearer ${session.token}` },
    data: [{ id: 'pairing-e2e-expense', amountCents: 680, direction: 'EXPENSE', merchant: '扫码奶茶店', at: Date.now() }],
  });
  expect(uploaded.ok()).toBe(true);

  await expect(page.getByText(/已从手机导入 1 笔支出/)).toBeVisible({ timeout: 15000 });
  await page.goto('/ledger');
  await expect(page.getByText('扫码奶茶店', { exact: true })).toBeVisible();
});
