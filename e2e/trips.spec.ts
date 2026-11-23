import { test, expect } from '@playwright/test';

const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const plus = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return localDate(date); };
const mondayOf = (key: string) => {
  const weekday = new Date(`${key}T12:00:00`).getDay();
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() - ((weekday + 6) % 7));
  return localDate(date);
};
const weeksBetween = (from: string, to: string) => Math.round((Date.parse(`${mondayOf(to)}T00:00:00Z`) - Date.parse(`${mondayOf(from)}T00:00:00Z`)) / (7 * 86400_000));
const today = localDate(new Date());

async function newTrip(page: import('@playwright/test').Page, title: string, start: string, end: string) {
  await page.goto('/trips');
  await page.getByRole('button', { name: '新建旅行' }).click();
  await page.getByLabel('旅行名称').fill(title);
  await page.getByLabel('出发日期').fill(start);
  await page.getByLabel('结束日期').fill(end);
  await page.getByRole('button', { name: '保存旅行' }).click();
  await page.getByRole('link', { name: title, exact: true }).click();
}

async function showWeek(page: import('@playwright/test').Page, date: string) {
  const weeks = weeksBetween(today, date);
  for (let i = 0; i < weeks; i++) await page.getByRole('button', { name: '后一周日程' }).click();
}

test('a three-day trip keeps transport, lodging, itinerary and schedule in sync on mobile', async ({ page }) => {
  const start = plus(2);
  const end = plus(4);
  await page.setViewportSize({ width: 375, height: 812 });
  await newTrip(page, '上海三日', start, end);
  await expect(page.getByRole('region', { name: '行前总览' })).toContainText('距出发');

  const transport = page.getByRole('region', { name: '交通' });
  await transport.getByLabel('从哪里出发').fill('杭州东');
  await transport.getByLabel('到哪里').fill('上海虹桥');
  await transport.getByLabel('出发日期').fill(start);
  await transport.getByLabel('出发时间').fill('08:00');
  await transport.getByLabel('到达时间').fill('09:00');
  await transport.getByLabel('车次 / 航班号').fill('G7301');
  await transport.getByRole('button', { name: '添加交通' }).click();
  await expect(transport).toContainText('杭州东 → 上海虹桥');

  await transport.getByRole('button', { name: '编辑交通 杭州东 到 上海虹桥' }).click();
  await transport.getByLabel('车次 / 航班号').fill('G7302');
  await transport.getByRole('button', { name: '保存交通' }).click();
  await expect(transport).toContainText('G7302');

  const lodging = page.getByRole('region', { name: '住宿' });
  await lodging.getByLabel('住宿名称').fill('外滩附近');
  await lodging.getByLabel('地址').fill('中山东一路');
  await lodging.getByLabel('入住日期').fill(start);
  await lodging.getByLabel('退房日期').fill(end);
  await lodging.getByRole('button', { name: '添加住宿' }).click();
  await expect(lodging).toContainText('外滩附近');

  const budget = page.getByRole('region', { name: '预算' });
  await budget.getByLabel('预算项').fill('车票');
  await budget.getByLabel('金额（元）').fill('146');
  await budget.getByRole('button', { name: '添加预算项' }).click();
  await expect(budget).toContainText('¥ 146.00');
  await budget.getByLabel('整趟预算（元，可留空）').fill('800');
  await budget.getByRole('button', { name: '保存总预算' }).click();
  await expect(budget).toContainText('余量 ¥ 654.00');
  await budget.getByRole('button', { name: '编辑预算项 车票' }).click();
  await budget.getByLabel('金额（元）').fill('150');
  await budget.getByRole('button', { name: '保存预算项' }).click();
  await expect(budget).toContainText('¥ 150.00');

  const todos = page.getByRole('region', { name: '行前事项' });
  await todos.getByLabel('行前事项').fill('带身份证');
  await todos.getByRole('button', { name: '添加事项' }).click();
  await todos.getByRole('checkbox', { name: '带身份证' }).click();
  await expect(todos).toContainText('1/1 已完成');
  await todos.getByRole('button', { name: '编辑行前事项 带身份证' }).click();
  await todos.getByLabel('修改事项').fill('带身份证和充电宝');
  await todos.getByRole('button', { name: '保存', exact: true }).click();
  await expect(todos).toContainText('带身份证和充电宝');

  const day = page.getByRole('region', { name: `${start}行程` });
  await day.getByLabel('做什么').fill('西湖走走');
  await day.getByLabel('开始（选填）').fill('14:00');
  await day.getByLabel('结束（选填）').fill('16:00');
  await day.getByLabel('地点（选填）').fill('北山街');
  await day.getByRole('button', { name: '添加攻略' }).click();
  await expect(day).toContainText('14:00 — 16:00');
  await expect(day).toContainText('北山街');
  await expect(day).toContainText('杭州东 → 上海虹桥');
  await expect(day).toContainText('外滩附近');
  await day.getByRole('button', { name: '加入日程' }).click();
  await expect(day).toContainText('已加入日程');
  await transport.getByRole('button', { name: '加入日程 杭州东 到 上海虹桥' }).click();
  await lodging.getByRole('button', { name: '加入日程 住宿 外滩附近' }).click();

  await page.reload();
  await expect(page.getByRole('region', { name: `${start}行程` })).toContainText('西湖走走');

  await page.goto('/schedule');
  await showWeek(page, start);
  await expect(page.getByText('西湖走走', { exact: true })).toBeVisible();
  await expect(page.getByText('住在 外滩附近', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: '回旅记修改 西湖走走' }).click();
  await expect(page.getByRole('heading', { name: '上海三日' })).toBeVisible();

  await page.getByRole('button', { name: '取消日程' }).click();
  await expect(page.getByRole('button', { name: '加入日程', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '加入日程', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消日程' })).toBeVisible();

  const shifted = plus(3);
  await page.getByRole('button', { name: '编辑旅行' }).click();
  const rerange = page.getByRole('heading', { name: '编辑旅行' }).locator('..');
  await page.getByLabel('整体顺延：攻略、交通、住宿和城市日期一起移动').check();
  await rerange.getByLabel('出发日期').fill(shifted);
  await rerange.getByLabel('结束日期').fill(plus(5));
  await rerange.getByRole('button', { name: '保存旅行' }).click();
  await expect(page.getByRole('region', { name: `${shifted}行程` })).toBeVisible();
  await expect(page.getByRole('region', { name: `${shifted}行程` })).toContainText('西湖走走');
  await expect(page.getByRole('region', { name: `${shifted}行程` })).toContainText('外滩附近');
  await page.goto('/schedule');
  await showWeek(page, shifted);
  await expect(page.getByText('西湖走走', { exact: true })).toBeVisible();

  await page.goto('/trips');
  await page.getByRole('link', { name: '上海三日', exact: true }).click();
  await page.getByRole('button', { name: '删除旅行' }).click();
  await expect(page.getByRole('dialog')).toContainText('同步移除 3 条旅记日程');
  await page.getByRole('button', { name: '确认删除' }).click();
  await page.goto('/schedule');
  await showWeek(page, shifted);
  await expect(page.getByText('西湖走走', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a shortened range lists out-of-range plans instead of dropping them', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await newTrip(page, '杭州周末', '2026-11-01', '2026-11-03');
  await page.getByRole('button', { name: /^11-03/ }).click();
  const day = page.getByRole('region', { name: '2026-11-03行程' });
  await day.getByLabel('做什么').fill('灵隐寺');
  await day.getByRole('button', { name: '添加攻略' }).click();
  await expect(day).toContainText('灵隐寺');
  await page.getByRole('button', { name: '编辑旅行' }).click();
  const rerange = page.getByRole('heading', { name: '编辑旅行' }).locator('..');
  await rerange.getByLabel('结束日期').fill('2026-11-02');
  await rerange.getByRole('button', { name: '保存旅行' }).click();
  await expect(page.getByRole('alert')).toContainText('攻略：2026-11-03');
  await page.getByRole('button', { name: '取消', exact: true }).click();

  await page.getByRole('button', { name: /^11-03/ }).click();
  await page.getByRole('button', { name: '移到其他日期 灵隐寺' }).click();
  await page.getByLabel('移动到').fill('2026-11-02');
  await page.getByRole('button', { name: '确认移动' }).click();
  await page.getByRole('button', { name: /^11-02/ }).click();
  await expect(page.getByRole('region', { name: '2026-11-02行程' })).toContainText('灵隐寺');
});
