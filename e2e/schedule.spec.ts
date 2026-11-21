import { test, expect } from '@playwright/test';

test('an open schedule editor cannot overwrite a change received from another tab', async ({ page, context }) => {
  await page.goto('/schedule');
  await page.getByRole('button', { name: '添加日程', exact: true }).click();
  await page.getByLabel('日程标题').fill('原始日程');
  await page.getByRole('button', { name: '保存日程' }).click();
  await expect(page.getByRole('button', { name: '编辑日程 原始日程' })).toBeVisible();
  await page.getByRole('button', { name: '编辑日程 原始日程' }).click();
  await page.getByLabel('日程标题').fill('尚未保存的旧草稿');
  const other = await context.newPage();
  await other.goto('/schedule');
  await other.getByRole('button', { name: '编辑日程 原始日程' }).click();
  await other.getByLabel('日程标题').fill('新版本');
  await other.getByRole('button', { name: '保存日程' }).click();
  await expect(page.getByRole('button', { name: '编辑日程 新版本' })).toBeVisible();
  await page.getByRole('button', { name: '保存日程' }).click();
  await expect(page.getByLabel('日程标题')).toHaveValue('尚未保存的旧草稿');
  await expect(page.getByText(/编辑期间已被修改或删除/).first()).toBeVisible();
  await other.reload();
  await expect(other.getByRole('button', { name: '编辑日程 新版本' })).toBeVisible();
});

test('a planned shift can be linked to actual work without a duplicate timeline item', async ({ page }) => {
  await page.goto('/entry');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('记录已保存到本机');
  await page.goto('/schedule');
  await page.getByRole('button', { name: '添加日程', exact: true }).click();
  await page.getByLabel('日程标题').fill('已完成的排班');
  await page.getByLabel('日程类型').selectOption('shift');
  await page.getByLabel('关联已记工时').selectOption({ index: 1 });
  await page.getByRole('button', { name: '保存日程' }).click();
  await expect(page.getByText('已保存到生活记录。', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '本周日程' }).getByText('已完成的排班', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '编辑工时' })).toHaveCount(1);
});

test('a scheduled study block starts a linked focus and returns after cancellation', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-21T10:00:00+08:00') });
  await page.goto('/schedule');
  await page.getByRole('button', { name: '添加日程', exact: true }).click();
  await page.getByLabel('日程标题').fill('晚间复习');
  await page.getByLabel('开始日期时间').fill('2026-11-21T19:00');
  await page.getByLabel('结束日期时间').fill('2026-11-21T19:30');
  await page.getByRole('button', { name: '保存日程', exact: true }).click();
  await expect(page.getByText('已保存到生活记录。', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '开始专注 晚间复习' }).click();
  await expect(page).toHaveURL(/\/focus\?event=/);
  await expect(page.getByLabel('正在做什么')).toHaveValue('晚间复习');
  await expect(page.getByLabel('计划分钟')).toHaveValue('30');
  await expect(page.getByText(/来自日程「晚间复习」/)).toBeVisible();
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await expect(page.getByText('正在专注', { exact: true })).toBeVisible();
  await page.goto('/schedule');
  await expect(page.getByRole('region', { name: '本周日程' }).getByText('晚间复习', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '开始专注 晚间复习' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑关联日程 晚间复习' })).toBeVisible();
  await page.goto('/focus');
  await page.getByRole('button', { name: '在此窗口接管' }).click();
  await page.getByRole('button', { name: '结束本次' }).click();
  await page.getByRole('button', { name: '确认结束' }).click();
  await expect(page.getByRole('region', { name: '专注记录' }).getByText('已结束（未完成）')).toBeVisible();
  await page.goto('/schedule');
  await expect(page.getByRole('link', { name: '开始专注 晚间复习' })).toBeVisible();
});

test('manual schedule, course conflicts and countdowns persist and appear on Today', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-21T08:00:00+08:00') });
  await page.goto('/schedule');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('把这一周，安排在一起。');
  await page.getByRole('button', { name: '添加日程', exact: true }).click();
  await page.getByLabel('日程标题').fill('高等数学');
  await page.getByLabel('日程类型').selectOption('course');
  await page.getByLabel('开始日期时间').fill('2026-11-21T09:00');
  await page.getByLabel('结束日期时间').fill('2026-11-21T10:00');
  await page.getByLabel('地点').fill('A101');
  await page.getByRole('button', { name: '保存日程', exact: true }).click();
  await expect(page.getByRole('region', { name: '本周日程' }).getByText('高等数学', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加日程', exact: true }).click();
  await page.getByLabel('日程标题').fill('兼职排班');
  await page.getByLabel('日程类型').selectOption('shift');
  await page.getByLabel('开始日期时间').fill('2026-11-21T09:30');
  await page.getByLabel('结束日期时间').fill('2026-11-21T12:00');
  await page.getByRole('button', { name: '保存日程', exact: true }).click();
  await expect(page.getByText(/兼职排班与高等数学重叠30分钟/)).toBeVisible();
  await page.getByRole('button', { name: '添加日程', exact: true }).click();
  await page.getByLabel('日程标题').fill('数学考试');
  await page.getByLabel('日程类型').selectOption('exam');
  await page.getByLabel('开始日期时间').fill('2026-11-23T09:00');
  await page.getByLabel('结束日期时间').fill('2026-11-23T11:00');
  await page.getByRole('button', { name: '保存日程', exact: true }).click();
  await page.getByRole('navigation').getByRole('link', { name: '今天', exact: true }).click();
  await expect(page.getByRole('region', { name: '今日安排' })).toContainText('高等数学');
  await expect(page.getByRole('region', { name: '最近倒计时' })).toContainText('数学考试');
  await expect(page.getByRole('region', { name: '最近倒计时' })).toContainText('还有2天');
  await page.reload();
  await expect(page.getByRole('region', { name: '今日安排' })).toContainText('兼职排班');
});

test('ICS previews before importing and repeated imports do not duplicate events', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-21T08:00:00+08:00') });
  await page.goto('/schedule');
  await page.getByText('从ICS文件导入', { exact: true }).click();
  const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:english\r\nDTSTART;TZID=Asia/Shanghai:20261121T130000\r\nDTEND;TZID=Asia/Shanghai:20261121T140000\r\nSUMMARY:导入英语课\r\nEND:VEVENT\r\nEND:VCALENDAR';
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('ICS文件').setInputFiles({ name: 'school.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics) });
    await expect(page.getByRole('region', { name: 'ICS导入预览' })).toContainText('导入英语课');
    await page.getByRole('button', { name: '确认导入ICS' }).click();
    await expect(page.getByRole('region', { name: 'ICS导入预览' })).toHaveCount(0);
  }
  await expect(page.getByRole('region', { name: '本周日程' }).getByText('导入英语课', { exact: true })).toHaveCount(1);
});

test('recurring course and birthday can be created from a mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.clock.install({ time: new Date('2026-11-21T08:00:00+08:00') });
  await page.goto('/schedule');
  await page.getByRole('button', { name: '添加每周课程', exact: true }).click();
  await page.getByLabel('课程名称').fill('英语');
  await page.getByLabel('学期首周周一').fill('2026-11-02');
  await page.getByLabel('星期').selectOption('6');
  await page.getByLabel('上课时间').fill('14:00');
  await page.getByLabel('下课时间').fill('16:00');
  await page.getByRole('button', { name: '保存课程规则', exact: true }).click();
  await expect(page.getByRole('region', { name: '本周日程' }).getByText('英语', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加倒计时', exact: true }).click();
  await page.getByLabel('倒计时标题').fill('朋友生日');
  await page.getByLabel('倒计时类型').selectOption('birthday');
  await page.getByLabel('日期', { exact: true }).fill('2000-11-22');
  await page.getByRole('button', { name: '保存倒计时', exact: true }).click();
  await expect(page.getByText('朋友生日', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
