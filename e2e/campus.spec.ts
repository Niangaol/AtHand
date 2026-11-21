import { test, expect } from '@playwright/test';

test('maintains a sourced service directory from a mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/campus');
  await page.getByRole('button', { name: '新增事项' }).click();
  await page.getByLabel('事项名称', { exact: true }).fill('我的图书续借路径');
  await page.getByLabel('事项分类').fill('图书馆');
  await page.getByLabel('入口形式').selectOption('wechat');
  await page.getByLabel('入口地址或名称').fill('测试图书馆');
  await page.getByLabel('办理步骤').fill('打开公众号，进入我的借阅。');
  await page.getByRole('button', { name: '保存事项' }).click();
  await page.getByRole('link', { name: '我的图书续借路径', exact: true }).click();
  await expect(page.getByRole('heading', { name: '结论', exact: true })).toBeVisible();
  await expect(page.getByText('能否现在办理未确认', { exact: true })).toBeVisible();
  await expect(page.getByText('缺少公开出处，请先核实再办理。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑事项' }).click();
  await page.getByLabel('来源网址').fill('https://example.com/official');
  await page.getByLabel('核实日期').fill('2020-01-01');
  await page.getByRole('button', { name: '保存事项' }).click();
  await expect(page.getByText(/超过30天未核实/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: '查看原始出处' })).toHaveAttribute('href', 'https://example.com/official');
  await page.getByRole('button', { name: '删除事项' }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('link', { name: '我的图书续借路径', exact: true })).toHaveCount(0);
});

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
  await expect(page.getByText(/仍只监听本机/)).toBeVisible();
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
