import { test, expect } from '@playwright/test';

import { startGateway } from './gatewayFixture';
let gateway = '';
let password = '';
let stop: () => Promise<void>;
test.beforeAll(async () => { const fixture = await startGateway(); gateway = fixture.url; password = fixture.password; stop = fixture.stop; });
test.afterAll(async () => { await stop?.(); });

test.describe('电脑作服务器的登录与同步', () => {

  test('登录、跨设备读取账本并导入手机样本', async ({ page, browser }) => {
    await page.goto('/settings');
    await page.getByLabel('电脑地址').fill(gateway);
    await page.getByLabel('访问口令').fill(password);
    await page.getByRole('button', { name: '连接', exact: true }).click();
    await expect(page.getByRole('heading', { name: '已连接电脑' })).toBeVisible();
    await expect(page.getByText(/已同步|上传到电脑|已读取电脑/)).toBeVisible();

    await page.goto('/entry');
    await page.getByRole('tab', { name: '记支出' }).click();
    await page.getByLabel('支出金额（元）').fill('12.34');
    await page.getByLabel('备注（选填）').fill('网关同步测试');
    const pushed = page.waitForResponse((response) => response.url().endsWith('/api/ledger') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: '保存记录', exact: true }).click();
    expect((await pushed).ok()).toBe(true);

    await page.goto('/settings');
    await expect(page.getByText(/已与电脑一致|已同步到电脑/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/已与电脑一致/)).toBeVisible();

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto('/settings');
    await otherPage.getByLabel('电脑地址').fill(gateway);
    await otherPage.getByLabel('访问口令').fill(password);
    await otherPage.getByRole('button', { name: '连接', exact: true }).click();
    await expect(otherPage.getByRole('heading', { name: '已连接电脑' })).toBeVisible();
    await expect(otherPage.getByText(/已读取电脑上的账本|已与电脑一致/)).toBeVisible();
    await otherPage.goto('/ledger');
    await expect(otherPage.getByText('网关同步测试', { exact: true })).toBeVisible();
    await other.close();

    const login = await page.request.post(`${gateway}/api/login`, { data: { password } });
    const session = await login.json();
    await page.request.post(`${gateway}/api/samples`, {
      headers: { Authorization: `Bearer ${session.token}` },
      data: [
        { id: 'gateway-e2e-expense', amountCents: 1234, direction: 'EXPENSE', merchant: '测试商户', at: Date.now() },
        { id: 'gateway-e2e-income', amountCents: 500, direction: 'INCOME', merchant: '测试收款', at: Date.now() },
        { id: 'gateway-e2e-pending', amountCents: 999, direction: 'EXPENSE', note: 'pending_confirm', at: Date.now() },
      ],
    });
    await page.goto('/settings');
    await page.getByRole('button', { name: '拉取并导入' }).click();
    await expect(page.getByText(/导入 1 笔支出/)).toBeVisible();
    await expect(page.getByText(/跳过收入 1、待确认 1/)).toBeVisible();
  });
});
