import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const fixedTime = new Date('2026-11-20T12:00:00');

test('real work and expense lifecycle, snapshots, monthly totals and CSV download', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: fixedTime });
  await page.goto('/entry');
  await page.getByLabel('开始时间').fill('22:00');
  await page.getByLabel('结束时间', { exact: true }).fill('02:00');
  await page.getByLabel('结束时间在次日（跨午夜）').check();
  await page.getByLabel('备注（选填）').fill('夜班');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.getByText('夜班', { exact: true })).toBeVisible();
  await expect(page.getByText('本机账本')).toBeVisible();
  await page.reload();
  await expect(page.getByText('夜班', { exact: true })).toBeVisible();
  await expect(page.getByText('¥ 80.00')).toHaveCount(2);
  await page.goto('/entry');
  await page.getByRole('tab', { name: '记支出' }).click();
  await page.getByLabel('支出金额（元）').fill('30');
  await page.getByLabel('备注（选填）').fill('测试午饭');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.getByRole('link', { name: '编辑 测试午饭', exact: true }).click();
  await page.getByLabel('支出金额（元）').fill('20');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText('¥ 60.00')).toBeVisible();
  await page.goto('/monthly');
  await expect(page.getByText('¥ 60.00')).toBeVisible();
  await page.getByLabel('选择月份').fill('2026-10');
  await expect(page.getByText('这一页，还是空白的')).toBeVisible();
  await page.goto('/workplaces');
  await page.getByRole('button', { name: '编辑单位 校园奶茶店' }).click();
  await page.getByLabel('单位时薪（元）').fill('40');
  await page.getByRole('button', { name: '保存单位' }).click();
  await expect(page.getByRole('button', { name: '删除单位 校园奶茶店' })).toBeDisabled();
  await page.goto('/');
  await expect(page.getByTestId('week-net')).toContainText('60.00');
  await page.screenshot({ path: 'test-results/real-ledger-desktop.png', fullPage: true });
  await page.goto('/settings');
  const downloadPending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV' }).click();
  const download = await downloadPending;
  expect(download.suggestedFilename()).toBe('顺手账单-2026-11-20.csv');
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('"夜班","22:00","02:00","240","80.00","20.00"');
  expect(csv).toContain('"测试午饭"');
  expect(csv).toContain('"20.00"');
  await page.goto('/ledger');
  await page.getByRole('button', { name: '删除 测试午饭', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByText('测试午饭', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除 测试午饭', exact: true }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText('测试午饭', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '删除 夜班', exact: true }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText('这一页，还是空白的')).toBeVisible();
  await page.goto('/workplaces');
  await page.getByRole('button', { name: '删除单位 校园奶茶店' }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('heading', { name: '校园奶茶店' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: '校园奶茶店' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('mobile can start empty, create a unit and save real records offline', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/settings');
  await page.getByRole('button', { name: '清空示例数据' }).click();
  await page.getByRole('button', { name: '确认清空示例' }).click();
  await expect(page.getByText('示例数据已清空。', { exact: true })).toBeVisible();
  await page.goto('/workplaces');
  await page.getByRole('button', { name: '新增单位' }).click();
  await page.getByLabel('单位名称').fill('图书馆的一个很长很长但仍然合法的兼职单位名称');
  await page.getByLabel('单位时薪（元）').fill('25');
  await page.getByRole('button', { name: '保存单位' }).click();
  await expect(page.getByRole('heading', { name: '图书馆的一个很长很长但仍然合法的兼职单位名称' })).toBeVisible();
  await page.goto('/entry');
  await expect(page.getByLabel('每小时时薪（元）')).toHaveValue('25.00');
  await context.setOffline(true);
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.getByText('¥ 75.00')).toHaveCount(2);
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText('¥ 75.00')).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'test-results/real-ledger-mobile.png', fullPage: true });
});

test('corrupted storage is preserved until backed up and explicitly reset', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('corruption-seeded')) {
      localStorage.setItem('shunshou.ledger.v1', '{broken original data');
      sessionStorage.setItem('corruption-seeded', 'yes');
    }
  });
  await page.goto('/settings');
  await expect(page.getByRole('alert')).toContainText('已暂停写入');
  await expect(page.getByRole('button', { name: '保存时薪' })).toBeDisabled();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载原始备份' }).click();
  const download = await pending;
  expect(await readFile((await download.path())!, 'utf8')).toBe('{broken original data');
  await page.getByRole('button', { name: '重置账本', exact: true }).click();
  await page.getByRole('button', { name: '确认重置全部数据' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '保存时薪' })).toBeEnabled();
  await expect(page.getByText('本机账本')).toBeVisible();
});

test('an older tab cannot silently overwrite another tab and retains its draft', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto('/entry');
  await second.goto('/entry');
  for (const page of [first, second]) {
    await page.getByRole('tab', { name: '记支出' }).click();
    await page.getByLabel('支出金额（元）').fill('18');
  }
  await first.getByLabel('备注（选填）').fill('第一个窗口');
  await first.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(first.getByRole('region', { name: '账单明细' })).toContainText('第一个窗口');
  await second.getByLabel('备注（选填）').fill('第二个窗口未保存');
  await second.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(second.getByTestId('entry-error')).toContainText('其他窗口');
  await expect(second.getByLabel('备注（选填）')).toHaveValue('第二个窗口未保存');
  await first.reload();
  await expect(first.getByText('第一个窗口', { exact: true })).toBeVisible();
  await expect(first.getByText('第二个窗口未保存', { exact: true })).toHaveCount(0);
});

test('two queued saves are serialized by the real browser lock', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  const holder = await context.newPage();
  await first.goto('/entry');
  await second.goto('/entry');
  await holder.goto('/settings');
  await holder.evaluate(() => new Promise<void>((ready) => {
    void navigator.locks.request('shunshou.ledger.v1', async () => {
      ready();
      await new Promise<void>((resolve) => { (window as Window & { releaseLedgerLock?: () => void }).releaseLedgerLock = resolve; });
    });
  }));
  for (const [page, title] of [[first, '并发第一笔'], [second, '并发第二笔']] as const) {
    await page.getByRole('tab', { name: '记支出' }).click();
    await page.getByLabel('支出金额（元）').fill('12');
    await page.getByLabel('备注（选填）').fill(title);
    await page.getByRole('button', { name: '保存记录', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存记录', exact: true })).toBeDisabled();
    await expect(page).toHaveURL('/entry');
  }
  await holder.evaluate(() => (window as Window & { releaseLedgerLock?: () => void }).releaseLedgerLock?.());
  await expect(first.getByText('并发第一笔', { exact: true })).toBeVisible();
  await expect(second.getByTestId('entry-error')).toContainText('其他窗口');
  await expect(second.getByLabel('备注（选填）')).toHaveValue('并发第二笔');
  await first.reload();
  await expect(first.getByText('并发第一笔', { exact: true })).toBeVisible();
  await expect(first.getByText('并发第二笔', { exact: true })).toHaveCount(0);
});

test('time cost appears after three actual dates and tracks the chosen base rate', async ({ page }) => {
  await page.clock.install({ time: fixedTime });
  for (const date of ['2026-11-18', '2026-11-19', '2026-11-20']) {
    await page.goto('/entry');
    await page.getByRole('tab', { name: '记支出' }).click();
    await page.getByLabel('消费日期').fill(date);
    await page.getByLabel('支出金额（元）').fill('30');
    await page.getByRole('button', { name: '保存记录', exact: true }).click();
    await expect(page).toHaveURL(/\/ledger(?:\?|$)/);
    await expect(page.getByRole('status')).toContainText('记录已保存到本机');
  }
  await expect(page.getByText('约 1.5 小时 · 基准时薪估算')).toHaveCount(3);
  await page.goto('/settings');
  await page.getByLabel('换算时薪（元/小时）').fill('30');
  await page.getByRole('button', { name: '保存时薪' }).click();
  await expect(page.getByRole('status')).toContainText('换算时薪已保存');
  await page.goto('/ledger');
  await expect(page.getByText('约 1.0 小时 · 基准时薪估算')).toHaveCount(3);
  await expect(page.getByText('¥ 90.00')).toBeVisible();
});
