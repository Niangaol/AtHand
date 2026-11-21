import { test, expect } from '@playwright/test';
import { startGateway } from './gatewayFixture';

test('calendar source data reaches Today and revoked permission hides stale courses', async ({ page }) => {
  const gateway = await startGateway();
  try {
    const login = await page.request.post(`${gateway.url}/api/login`, { data: { password: gateway.password } });
    const session = await login.json();
    const at = Date.parse('2026-11-21T00:00:00+08:00');
    const headers = { Authorization: `Bearer ${session.token}` };
    const snapshot = { sourceId: 'phone-a', requestId: 'one', baseRevision: 0, fetchedAt: at + 1000, calendarAvailable: true, complete: true, rangeStart: at, rangeEnd: at + 14 * 86400_000,
      events: [{ id: 'phone-a:course', title: '手机日历课程', kind: 'event', location: 'A101', start: at + 9 * 3600_000, end: at + 10 * 3600_000, timeZone: 'Asia/Shanghai', allDay: false, source: 'calendar', sourceId: 'phone-a' }] };
    expect((await page.request.put(`${gateway.url}/api/calendar/snapshot`, { headers, data: snapshot })).ok()).toBe(true);
    await page.clock.install({ time: new Date('2026-11-21T08:00:00+08:00') });
    await page.goto('/schedule');
    await page.evaluate(({ url, session }) => { localStorage.setItem('shunshou.gateway.url', url); localStorage.setItem('shunshou.gateway.token', session.token); localStorage.setItem('shunshou.gateway.expiresAt', String(session.expiresAt)); }, { url: gateway.url, session });
    await page.reload();
    await expect(page.getByRole('region', { name: '本周日程' })).toContainText('手机日历课程');
    await page.getByLabel('确认分类 手机日历课程').selectOption('exam');
    await expect(page.getByRole('region', { name: '重要日期' })).toContainText('手机日历课程');
    await page.getByRole('navigation').getByRole('link', { name: '今天', exact: true }).click();
    await expect(page.getByRole('region', { name: '今日安排' })).toContainText('手机日历课程');
    await page.request.put(`${gateway.url}/api/calendar/snapshot`, { headers, data: { ...snapshot, baseRevision: 1, requestId: 'two', calendarAvailable: false, complete: false, events: [] } });
    await page.getByRole('navigation').getByRole('link', { name: '日程', exact: true }).click();
    await page.getByRole('button', { name: '刷新手机日历' }).click();
    await expect(page.getByText(/日历权限已撤销/)).toBeVisible();
    await expect(page.getByRole('region', { name: '本周日程' }).getByText('手机日历课程', { exact: true })).toHaveCount(0);
  } finally { await gateway.stop(); }
});

test('switching planner sources needs confirmation and restores the previous source', async ({ page }) => {
  const a = await startGateway(); const b = await startGateway();
  try {
    const auth = async (gateway: typeof a) => (await (await page.request.post(`${gateway.url}/api/login`, { data: { password: gateway.password } })).json());
    const sa = await auth(a); const sb = await auth(b);
    await page.request.post(`${a.url}/api/planner/operations`, { headers: { Authorization: `Bearer ${sa.token}` }, data: { operationId: 'seed-a', baseRevision: 0, command: { kind: 'put', collection: 'countdowns', value: { id: 'a', title: '仅属于来源A', kind: 'document', date: '2027-01-01' } } } });
    await page.goto('/schedule');
    const connect = async (url: string, session: { token: string; expiresAt: number }) => page.evaluate(({ url, session }) => { localStorage.setItem('shunshou.gateway.url', url); localStorage.setItem('shunshou.gateway.token', session.token); localStorage.setItem('shunshou.gateway.expiresAt', String(session.expiresAt)); window.dispatchEvent(new Event('shunshou-gateway-change')); }, { url, session });
    await connect(a.url, sa);
    await expect(page.getByRole('region', { name: '重要日期' })).toContainText('仅属于来源A');
    await connect(b.url, sb);
    await page.getByRole('button', { name: '切换生活记录来源' }).click();
    await expect(page.getByRole('dialog')).toContainText('不上传到新服务器');
    await page.getByRole('button', { name: '确认切换来源' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('region', { name: '重要日期' }).getByText('仅属于来源A')).toHaveCount(0);
    const remoteB = await (await page.request.get(`${b.url}/api/planner`, { headers: { Authorization: `Bearer ${sb.token}` } })).json();
    expect(remoteB.state.countdowns).toHaveLength(0);
    await connect(a.url, sa);
    await page.getByRole('button', { name: '切换生活记录来源' }).click();
    await page.getByRole('button', { name: '确认切换来源' }).click();
    await expect(page.getByRole('region', { name: '重要日期' })).toContainText('仅属于来源A');
  } finally { await a.stop(); await b.stop(); }
});

test('two browsers share focus ownership and old controls cannot change a taken-over timer', async ({ browser }) => {
  const gateway = await startGateway();
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    for (const page of pages) {
      const login = await page.request.post(`${gateway.url}/api/login`, { data: { password: gateway.password } });
      const session = await login.json();
      await page.goto('/focus');
      await page.evaluate(({ url, session }) => {
        localStorage.setItem('shunshou.gateway.url', url);
        localStorage.setItem('shunshou.gateway.token', session.token);
        localStorage.setItem('shunshou.gateway.expiresAt', String(session.expiresAt));
      }, { url: gateway.url, session });
      await page.reload();
      await expect(page.getByText('生活记录已同步', { exact: true })).toBeVisible();
    }
    const [first, second] = pages;
    await first.getByLabel('正在做什么').fill('共享专注');
    await first.getByRole('button', { name: '开始专注', exact: true }).click();
    await expect(first.getByText('正在专注', { exact: true })).toBeVisible();
    await second.getByRole('button', { name: '同步生活记录' }).click();
    await second.getByRole('button', { name: '在此窗口接管' }).click();
    await expect(second.getByRole('button', { name: '暂停', exact: true })).toBeEnabled();
    await first.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(first.getByRole('button', { name: '在此窗口接管' })).toBeVisible();
    await expect(second.getByText('正在专注', { exact: true })).toBeVisible();
    await second.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(second.getByText('已暂停', { exact: true })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await gateway.stop();
  }
});
