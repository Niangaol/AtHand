import { test, expect } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startGateway } from './gatewayFixture';

function localStamp(hour: number, minute = 0) {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const zone = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return { date, stamp: `${date}T${pad(hour)}:${pad(minute)}:00${zone}` };
}

async function startFakeModel() {
  const requests: { url: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ url: request.url ?? '', headers: request.headers, body });
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/v1/models') {
        response.end(JSON.stringify({ data: [{ id: 'fake-model' }] }));
        return;
      }
      if (request.url !== '/v1/chat/completions') {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: { message: 'not found' } }));
        return;
      }
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const lastUser = [...messages].reverse().find((message: { role?: string }) => message.role === 'user')?.content ?? '';
      const toolSeen = messages.some((message: { role?: string }) => message.role === 'tool');
      const tool = (name: string, args: unknown, id: string) => JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });
      const content = (text: string) => JSON.stringify({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
      if (!toolSeen) {
        if (String(lastUser).includes('删')) { response.end(tool('schedule_delete', { id: 'missing' }, 'call_delete_1')); return; }
        if (String(lastUser).includes('午饭')) {
          const { date } = localStamp(12);
          response.end(tool('ledger_add_expense', { title: '午饭', amountYuan: 18.5, category: '吃饭', date }, 'call_expense_1'));
          return;
        }
        if (String(lastUser).includes('今天')) { response.end(tool('day_overview', {}, 'call_overview_1')); return; }
        const { stamp } = localStamp(9);
        const end = localStamp(10).stamp;
        response.end(tool('schedule_create', { title: '复习', start: stamp, end }, 'call_schedule_1'));
        return;
      }
      if (String(lastUser).includes('删')) { response.end(content('删除不在我的权限里，请到日程页操作。')); return; }
      if (String(lastUser).includes('午饭')) { response.end(content('已经记下了。')); return; }
      if (String(lastUser).includes('今天')) { response.end(content('今天有一项安排。')); return; }
      response.end(content('已经安排好了。'));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let gateway = '';
let password = '';
let stopGateway: () => Promise<void>;
let fake: Awaited<ReturnType<typeof startFakeModel>>;
test.beforeAll(async () => {
  const fixture = await startGateway();
  gateway = fixture.url;
  password = fixture.password;
  stopGateway = fixture.stop;
  fake = await startFakeModel();
});
test.afterAll(async () => { await stopGateway?.(); await fake?.stop(); });

test('the AI workspace is a primary entry and opens with Ctrl+K', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'AI 工作台' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page).toHaveURL(/\/assistant/);
  await expect(page.getByRole('heading', { name: '说一句，顺手去做。' })).toBeVisible();
});

test('the AI assistant configures a model and operates schedule, ledger and refuses deletes', async ({ page }) => {
  await page.goto('/settings');
  const settingsLoaded = page.waitForResponse((response) => response.url().endsWith('/api/assistant/settings') && response.request().method() === 'GET');
  await page.getByLabel('电脑地址').fill(gateway);
  await page.getByLabel('访问口令').fill(password);
  await page.getByRole('button', { name: '连接', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已连接电脑' })).toBeVisible();
  await settingsLoaded;

  const section = page.getByRole('region', { name: 'AI 助手' });
  await expect(section).toBeVisible();
  await section.getByLabel('模型地址').fill(fake.url);
  await section.getByLabel('模型名称').fill('fake-model');
  await section.getByLabel('API Key').fill('test-key');
  await section.getByRole('button', { name: '保存模型设置' }).click();
  await expect(section.getByText('助手设置已保存到电脑。')).toBeVisible();
  await section.getByRole('button', { name: '测试连接' }).click();
  await expect(section.getByText(/服务在线/)).toBeVisible();

  await page.getByRole('link', { name: '问助手' }).click();
  await expect(page).toHaveURL(/\/assistant/);
  const input = page.getByLabel('告诉助手要做什么');
  await expect(input).toBeEnabled();
  await input.fill('明晚七点复习一小时');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('已经安排好了。')).toBeVisible({ timeout: 20000 });
  await page.getByText('1 个操作').click();
  await expect(page.getByText('新建日程', { exact: true })).toBeVisible();

  await page.goto('/schedule');
  await expect(page.getByRole('region', { name: '本周日程' }).getByText('复习', { exact: true })).toBeVisible({ timeout: 15000 });

  await page.goto('/assistant');
  await expect(input).toBeEnabled();
  await input.fill('今天有什么安排？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('今天有一项安排。')).toBeVisible({ timeout: 20000 });
  await page.getByText('1 个操作').last().click();
  await expect(page.getByText('查看当天安排', { exact: true })).toBeVisible();

  await input.fill('午饭花了18块5，记吃饭');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('已经记下了。')).toBeVisible({ timeout: 20000 });
  await page.getByText('1 个操作').last().click();
  await expect(page.getByText('记支出', { exact: true })).toBeVisible();
  await page.goto('/ledger');
  await expect(page.getByText('午饭', { exact: true })).toBeVisible({ timeout: 15000 });

  await page.goto('/assistant');
  await expect(input).toBeEnabled();
  await input.fill('删掉复习日程');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('删除不在我的权限里，请到日程页操作。')).toBeVisible({ timeout: 20000 });
  await page.getByText('1 个操作').last().click();
  await expect(page.getByText('schedule_delete', { exact: true })).toBeVisible();

  const chats = fake.requests.filter((request) => request.url === '/v1/chat/completions');
  expect(chats[0].headers.authorization).toBe('Bearer test-key');
  const toolNames = chats[0].body.tools.map((tool: { function: { name: string } }) => tool.function.name);
  expect(toolNames).toEqual(expect.arrayContaining(['schedule_create', 'ledger_add_expense', 'courses_create', 'trips_create']));

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/assistant');
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
