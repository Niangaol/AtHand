import { test, expect } from '@playwright/test';
import { startGateway } from './gatewayFixture';

let gateway = '';
let password = '';
let stop: () => Promise<void>;
test.beforeAll(async () => { const fixture = await startGateway(); gateway = fixture.url; password = fixture.password; stop = fixture.stop; });
test.afterAll(async () => { await stop?.(); });

test('a token created in Settings can write through the agent API and is revoked in place', async ({ page, request }) => {
  await page.goto('/settings');
  await page.getByLabel('电脑地址').fill(gateway);
  await page.getByLabel('访问口令').fill(password);
  await page.getByRole('button', { name: '连接', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已连接电脑' })).toBeVisible();

  const section = page.getByRole('region', { name: 'Agent 接口' });
  await expect(section).toBeVisible();
  await section.getByLabel('令牌名称').fill('只读助手');
  await section.getByRole('button', { name: '生成 Agent 令牌' }).click();
  const readToken = await section.getByLabel('新令牌（只显示一次）').inputValue();
  expect(readToken.length).toBeGreaterThan(20);
  await expect(section.getByText('只读助手', { exact: true })).toBeVisible();

  const manifest = await request.get(`${gateway}/api/v1/agent/manifest`, { headers: { Authorization: `Bearer ${readToken}` } });
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).api).toBe('shunshou-agent');
  const denied = await request.post(`${gateway}/api/v1/agent/call`, {
    headers: { Authorization: `Bearer ${readToken}`, 'Idempotency-Key': 'e2e-read-denied' },
    data: { tool: 'schedule_create', arguments: { title: '不应写入', start: new Date().toISOString(), end: new Date(Date.now() + 60000).toISOString() } },
  });
  expect(denied.status()).toBe(403);

  await section.getByLabel('令牌名称').fill('可写助手');
  await section.getByLabel('权限').selectOption('write');
  await section.getByRole('button', { name: '生成 Agent 令牌' }).click();
  const writeToken = await section.getByLabel('新令牌（只显示一次）').inputValue();
  expect(writeToken.length).toBeGreaterThan(20);
  await expect(section.getByText('可写助手', { exact: true })).toBeVisible();

  const start = new Date(Date.now() - 3600_000).toISOString();
  const end = new Date(Date.now() - 1800_000).toISOString();
  const headers = { Authorization: `Bearer ${writeToken}`, 'Idempotency-Key': 'e2e-create-1' };
  const created = await request.post(`${gateway}/api/v1/agent/call`, { headers, data: { tool: 'schedule_create', arguments: { title: 'E2E Agent 安排', start, end } } });
  expect(created.status()).toBe(200);
  const eventId = (await created.json()).result.event.id;
  expect(eventId).toBeTruthy();
  const retried = await request.post(`${gateway}/api/v1/agent/call`, { headers, data: { tool: 'schedule_create', arguments: { title: 'E2E Agent 安排', start, end } } });
  expect((await retried.json()).result.event.id).toBe(eventId);

  await page.goto('/schedule');
  await expect(page.getByRole('region', { name: '本周日程' }).getByText('E2E Agent 安排', { exact: true })).toBeVisible({ timeout: 15000 });

  await page.goto('/settings');
  const again = page.getByRole('region', { name: 'Agent 接口' });
  await expect(again.getByText('新建日程', { exact: true }).first()).toBeVisible();
  await again.getByRole('button', { name: '吊销 Agent 令牌 可写助手' }).click();
  await page.getByRole('button', { name: '确认吊销' }).click();
  await expect(again.getByText('可写助手', { exact: true })).toHaveCount(0);

  const revoked = await request.get(`${gateway}/api/v1/agent/manifest`, { headers: { Authorization: `Bearer ${writeToken}` } });
  expect(revoked.status()).toBe(401);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(again.getByRole('button', { name: '生成 Agent 令牌' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
