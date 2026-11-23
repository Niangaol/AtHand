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
  requestId: 'r', state: 'COMPLETED', route: 'timetable_today',
  text: '今天第 1-2 节 高等数学，第 3-4 节 大学物理。',
  sources: [{ title: '杭电助手课表', publisher: 'HDU-Help', url: 'https://example.com/timetable' }],
  warnings: ['hduhelp_cli_missing'], isDemo: true, truncated: false,
};
const notice = { notice_id: 'n1', source_key: 'portal', title: '教务处选课通知', published_at: '2026-11-20T08:00:00Z', url: 'https://example.com/notice' };
const statusOff = { ok: true, connected: false, expiresAt: null, personalQueries: false, lastError: null, personalEnabled: false, personalAvailable: false };
const statusOn = { ok: true, connected: true, expiresAt: new Date(Date.now() + 3600_000).toISOString(), personalQueries: true, lastError: null, personalEnabled: false, personalAvailable: true };
const envelope = (capability: string, data: unknown) => ({ ok: true, capability, fetchedAt: new Date().toISOString(), stale: false, demo: true, warnings: [], data });

async function gatewaySession(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('shunshou.gateway.url', 'http://127.0.0.1:18787');
    localStorage.setItem('shunshou.gateway.token', 'e2e-session');
    localStorage.setItem('shunshou.gateway.expiresAt', String(Date.now() + 3600_000));
  });
}

test('connects the helper through the gateway, shows public data and answers campus questions', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gatewaySession(page);
  await page.route('**/api/campus/status', (route) => route.fulfill({ json: statusOff }));
  await page.route('**/api/campus/connect', (route) => route.fulfill({ json: statusOn }));
  await page.route('**/api/campus/notices**', (route) => route.fulfill({ json: envelope('notices', { items: [notice], page: 1, has_more: false, source_states: [{ source_key: 'portal', name: '杭电门户' }], mode: 'demo', warnings: [] }) }));
  await page.route('**/api/campus/calendar', (route) => route.fulfill({ json: envelope('calendar', { schoolYear: '2026-2027', semester: '1', startDate: '2026-09-07', endDate: '2027-01-17', weekNow: 10, termWeeks: 18 }) }));
  await page.route('**/api/campus/ask', (route) => route.fulfill({ json: { ok: true, answer } }));
  await page.goto('/campus');
  await page.getByLabel('杭电助手访问口令').fill(password);
  await page.getByRole('button', { name: '连接杭电助手' }).click();
  await expect(page.getByText(notice.title)).toBeVisible();
  await expect(page.getByText(/第 10 周/)).toBeVisible();
  await page.getByText(/问校园（展开）/).click();
  await page.getByRole('button', { name: '今天有什么课' }).click();
  await expect(page.getByText(answer.text)).toBeVisible();
  await expect(page.getByText('演示数据')).toBeVisible();
  await expect(page.getByText('hduhelp_cli_missing')).toBeVisible();
  await expect(page.getByRole('link', { name: '杭电助手课表' })).toHaveAttribute('href', 'https://example.com/timetable');
  await expect(page.getByText(/仍只监听本机/)).toBeVisible();
  expect(await page.evaluate(() => [sessionStorage.length, localStorage.getItem('shunshou.hduPassword')])).toEqual([0, null]);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'test-results/campus-gateway.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('shows a clear error for a wrong campus password and keeps it out of storage', async ({ page }) => {
  await gatewaySession(page);
  await page.route('**/api/campus/status', (route) => route.fulfill({ json: statusOff }));
  await page.route('**/api/campus/connect', (route) => route.fulfill({ status: 401, json: { ok: false, error: 'invalid_password', message: '杭电助手口令无效。' } }));
  await page.goto('/campus');
  await page.getByLabel('杭电助手访问口令').fill(password);
  await page.getByRole('button', { name: '连接杭电助手' }).click();
  await expect(page.getByText('杭电助手口令无效。')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('shunshou.hduPassword'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('shunshou.hduPassword'))).toBeNull();
});

test('previews and writes the timetable and exams into the planner', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gatewaySession(page);
  const personalOn = { ...statusOn, personalEnabled: true };
  await page.route('**/api/campus/status', (route) => route.fulfill({ json: statusOff }));
  await page.route('**/api/campus/connect', (route) => route.fulfill({ json: personalOn }));
  await page.route('**/api/campus/calendar', (route) => route.fulfill({ json: envelope('calendar', { schoolYear: '2026-2027', semester: '1', startDate: '2026-09-07', endDate: '2027-01-17', weekNow: 10, termWeeks: 18 }) }));
  await page.route('**/api/campus/courses', (route) => route.fulfill({ json: envelope('courses', { semester: null, courses: [{ id: 'hdu:course:abc', name: '高等数学', teacher: '王老师', location: '六教422', weekday: 2, startTime: null, endTime: null, sections: '1-2', weeks: '1-16', parity: 'all' }] }) }));
  await page.route('**/api/campus/exams', (route) => route.fulfill({ json: envelope('exams', { exams: [{ id: 'hdu:exam:abc', course: '线性代数', date: '2026-12-20', startTime: '09:00', endTime: '11:00', location: 'A101', seat: '12' }] }) }));
  await page.route('**/api/campus/notices**', (route) => route.fulfill({ json: envelope('notices', { items: [], page: 1, has_more: false, source_states: [] }) }));
  for (const kind of ['card', 'electric', 'library']) {
    await page.route(`**/api/campus/${kind}`, (route) => route.fulfill({ status: 502, json: { ok: false, error: 'helper_unavailable', message: '暂不可用。' } }));
  }
  await page.goto('/campus');
  await page.getByLabel('杭电助手访问口令').fill(password);
  await page.getByRole('button', { name: '连接杭电助手' }).click();
  await expect(page.getByRole('heading', { name: '课表与考试' })).toBeVisible();
  await expect(page.getByText(/新增 1 · 更新 0 · 未变 0/).first()).toBeVisible();
  await page.getByRole('button', { name: '写入 2 条' }).click();
  await expect(page.getByText(/已写入 2 条/)).toBeVisible();
  await expect(page.getByRole('button', { name: '写入 0 条' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/campus-sync.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// 云端校园页的降级路径：授权缺失、待授权、PAT 失效、上游超时都要给出可操作提示。
// 注意：本用例依赖 /api/campus/status|/catalog|/run 三个云端接口的 mock，不需要真实 HDUHelp 账号。
test('shows recoverable hints when campus authorization is missing or upstream fails', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await gatewaySession(page);
  const status = { ok: true, connected: true, expired: false, scopes: [], patId: 'pat', connectedAt: null, expiresAt: null, deviceName: '顺手云端', pending: null };
  const catalog = {
    ok: true, scopes: ['academic:grade:read'],
    domains: [{ name: 'academic', label: '教务', operations: 1 }],
    operations: [{
      id: 'AcademicService_StudentGrade', domain: 'academic', command: 'academic grades',
      summary: '成绩与绩点', description: '查询本人成绩', method: 'GET', path: '/hduhelp-neo/academic/grades',
      auth: 'bearer', scopes: ['academic:grade:read'], risk: 'sensitive-read', sensitive: true, requiresUser: false,
      params: [], body: null,
    }],
  };
  await page.route('**/api/campus/status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/campus/catalog', (route) => route.fulfill({ json: catalog }));
  await page.route('**/api/campus/run', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.operationId === 'AcademicService_StudentGrade') {
      await route.fulfill({ json: { ok: false, error: 'missing_scope', missingScopes: ['academic:grade:read'], message: '缺少权限。' } });
      return;
    }
    await route.fulfill({ json: { ok: false, error: 'upstream_timeout', message: '上游超时。' } });
  });
  await page.route('**/api/campus/**', (route) => route.fulfill({ status: 404, json: { ok: false, error: 'not_found' } }));

  await page.goto('/campus');
  await expect(page.getByRole('tab', { name: '全部', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '全部', exact: true }).click();
  await page.getByRole('button', { name: /成绩与绩点/ }).click();
  await page.getByRole('button', { name: '执行' }).click();

  await expect(page.getByText(/当前授权缺少权限/)).toBeVisible();
  await expect(page.getByText(/academic:grade:read/)).toBeVisible();
  await expect(page.getByRole('button', { name: '授权缺少的权限' })).toBeVisible();

  await page.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByText(/操作没有完成/).or(page.getByText(/上游超时/))).toBeVisible();
});
