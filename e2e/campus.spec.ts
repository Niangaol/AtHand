import { test, expect } from '@playwright/test';

const password = 'p'.repeat(32);
const answer = {
  request_id: 'r', state: 'COMPLETED', route: 'timetable_today',
  text: '今天第 1-2 节 高等数学，第 3-4 节 大学物理。',
  sources: [{ title: '杭电助手课表', publisher: 'HDU-Help', url: 'https://example.com/timetable' }],
  notices: [], warnings: ['hduhelp_cli_missing'], is_demo: true, truncated: false,
};

test('asks the campus helper and surfaces demo data and warnings', async ({ page }) => {
  await page.route('**/web/api/login', (route) => route.fulfill({ json: { csrf_token: 'c'.repeat(32), mode: 'demo' } }));
  await page.route('**/web/api/messages', (route) => route.fulfill({ json: answer }));
  await page.goto('/campus');
  await page.getByLabel('HDU-Helper 访问口令').fill(password);
  await page.getByRole('button', { name: '今天有什么课' }).click();
  await expect(page.getByText(answer.text)).toBeVisible();
  await expect(page.getByText('演示数据')).toBeVisible();
  await expect(page.getByText('hduhelp_cli_missing')).toBeVisible();
  await expect(page.getByRole('link', { name: '杭电助手课表' })).toHaveAttribute('href', 'https://example.com/timetable');
  await expect(page.getByText(/只接受本机请求/)).toBeVisible();
  await page.screenshot({ path: 'test-results/campus-stub.png', fullPage: true });
});

test('shows a clear error for a wrong campus password and keeps it out of localStorage', async ({ page }) => {
  await page.route('**/web/api/login', (route) => route.fulfill({ status: 401, json: { detail: '口令无效' } }));
  await page.goto('/campus');
  await page.getByLabel('HDU-Helper 访问口令').fill(password);
  await page.getByRole('button', { name: '今天有什么课' }).click();
  await expect(page.getByRole('alert')).toContainText('口令无效');
  expect(await page.evaluate(() => localStorage.getItem('shunshou.hduPassword'))).toBeNull();
});
