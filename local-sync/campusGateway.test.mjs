import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HELPER_PASSWORD = 'helper-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CSRF = 'csrf-token-0123456789';

function fakeHelper() {
  const hits = { login: 0, notices: 0, calendar: 0, courses: 0, exams: 0, card: 0, ask: 0 };
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    const cookie = String(request.headers.cookie ?? '');
    const reply = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (request.method === 'POST' && request.url === '/web/api/login') {
      hits.login += 1;
      if (body?.password !== HELPER_PASSWORD) return reply(401, { detail: '口令无效' });
      response.setHeader('Set-Cookie', 'hdu_web_session=helper-session-cookie; Path=/web; HttpOnly; SameSite=strict');
      return reply(200, { authenticated: true, csrf_token: CSRF, capabilities: { personal_queries: true },
        expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    if (!cookie.includes('hdu_web_session=helper-session-cookie')) return reply(401, { detail: '请先登录' });
    if (request.method === 'GET' && request.url === '/web/api/campus/calendar') {
      hits.calendar += 1;
      return reply(200, { ok: true, capability: 'calendar', fetchedAt: new Date().toISOString(), stale: false, demo: true, warnings: [],
        data: { schoolYear: '2026-2027', semester: '1', startDate: '2026-09-07', endDate: '2027-01-17', weekNow: 10, termWeeks: 18 } });
    }
    if (request.method === 'GET' && request.url === '/web/api/campus/courses') {
      hits.courses += 1;
      return reply(200, { ok: true, capability: 'courses', fetchedAt: new Date().toISOString(), stale: false, demo: false, warnings: ['missing_semester'],
        data: { semester: null, courses: [{ id: 'hdu:course:abc', name: '高等数学', teacher: '王老师', location: '六教422', weekday: 2, startTime: null, endTime: null, sections: '1-2', weeks: '1-16', parity: 'all' }] } });
    }
    if (request.method === 'GET' && request.url === '/web/api/campus/exams') {
      hits.exams += 1;
      return reply(200, { ok: true, capability: 'exams', fetchedAt: new Date().toISOString(), stale: false, demo: false, warnings: [],
        data: { exams: [{ id: 'hdu:exam:abc', course: '线性代数', date: '2026-12-20', startTime: '09:00', endTime: '11:00', location: 'A101', seat: '12' }] } });
    }
    if (request.method === 'GET' && request.url === '/web/api/campus/card') {
      hits.card += 1;
      return reply(200, { ok: true, capability: 'card', fetchedAt: new Date().toISOString(), stale: false, demo: false, warnings: [],
        data: { balanceCents: 12345, maskedNo: '**** 6789', recent: [] } });
    }
    if (request.method === 'GET' && request.url.startsWith('/web/api/notices')) {
      hits.notices += 1;
      return reply(200, { items: [{ title: '教务处通知' }], page: 1, page_size: 12, has_more: false, source_states: [], mode: 'demo', warnings: [] });
    }
    if (request.method === 'POST' && request.url === '/web/api/messages') {
      if (request.headers['x-csrf-token'] !== CSRF) return reply(403, { detail: 'CSRF 校验失败' });
      hits.ask += 1;
      return reply(200, { request_id: body?.request_id, state: 'DONE', route: 'kb_question', text: '下一节课在六教422。', sources: [], warnings: [], is_demo: true, truncated: false });
    }
    return reply(404, { detail: 'missing' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
    hits,
  })));
}

async function spawnGateway(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-campus-gateway-'));
  const helper = await fakeHelper();
  const password = crypto.randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    cwd: dir,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', SHUNSHOU_DATA_DIR: dir, SHUNSHOU_PASSWORD: password, HDU_HELPER_URL: helper.origin },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; }
    helper.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('gateway startup timeout')), 10000);
    child.stdout.on('data', (chunk) => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('gateway exited')); });
  });
  return { dir, helper, password, url };
}

test('campus gateway connects, caches public data, gates personal data and clears on disconnect', async (t) => {
  const { dir, helper, password, url } = await spawnGateway(t);
  const login = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  let status = await (await fetch(`${url}/api/campus/status`, { headers })).json();
  assert.equal(status.connected, false);
  assert.equal((await fetch(`${url}/api/campus/calendar`, { headers })).status, 409);

  const wrong = await fetch(`${url}/api/campus/connect`, { method: 'POST', headers, body: JSON.stringify({ password: 'wrong' }) });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, 'invalid_password');

  const connected = await fetch(`${url}/api/campus/connect`, { method: 'POST', headers, body: JSON.stringify({ password: HELPER_PASSWORD }) });
  const connectedText = await connected.text();
  assert.equal(connected.status, 200, connectedText);
  status = JSON.parse(connectedText);
  assert.equal(status.connected, true);
  assert.equal(status.personalEnabled, false);
  assert.equal(status.personalAvailable, true);

  const notices = await (await fetch(`${url}/api/campus/notices`, { headers })).json();
  assert.equal(notices.ok, true);
  assert.equal(notices.capability, 'notices');
  assert.equal(notices.data.items[0].title, '教务处通知');
  await fetch(`${url}/api/campus/notices`, { headers });
  assert.equal(helper.hits.notices, 1, 'fresh notices should be served from cache');

  const calendar = await (await fetch(`${url}/api/campus/calendar`, { headers })).json();
  assert.equal(calendar.data.weekNow, 10);
  await fetch(`${url}/api/campus/calendar`, { headers });
  assert.equal(helper.hits.calendar, 1, 'fresh calendar should be served from cache');

  assert.equal((await fetch(`${url}/api/campus/courses`, { headers })).status, 403);
  assert.equal(helper.hits.courses, 0, 'personal data must not be requested while disabled');

  const enable = await fetch(`${url}/api/campus/personal`, { method: 'PUT', headers, body: JSON.stringify({ enabled: true }) });
  assert.equal(enable.status, 200);
  assert.equal((await enable.json()).personalEnabled, true);

  const courses = await (await fetch(`${url}/api/campus/courses`, { headers })).json();
  assert.equal(courses.data.courses[0].name, '高等数学');
  await fetch(`${url}/api/campus/courses`, { headers });
  assert.equal(helper.hits.courses, 1, 'fresh personal data should be served from memory cache');
  assert.equal(fs.readFileSync(path.join(dir, 'campus-cache.json'), 'utf8').includes('高等数学'), false);

  const ask = await fetch(`${url}/api/campus/ask`, { method: 'POST', headers, body: JSON.stringify({ text: '下一节课在哪' }) });
  const askText = await ask.text();
  assert.equal(ask.status, 200, askText);
  assert.equal(JSON.parse(askText).answer.text, '下一节课在六教422。');
  assert.equal(helper.hits.ask, 1);

  assert.equal((await fetch(`${url}/api/campus/personal`, { method: 'PUT', headers, body: JSON.stringify({ enabled: false }) })).status, 200);
  assert.equal((await fetch(`${url}/api/campus/courses`, { headers })).status, 403);
  await fetch(`${url}/api/campus/personal`, { method: 'PUT', headers, body: JSON.stringify({ enabled: true }) });
  await fetch(`${url}/api/campus/courses`, { headers });
  assert.equal(helper.hits.courses, 2, 'disabling personal data must clear the memory cache');

  assert.equal((await fetch(`${url}/api/campus/disconnect`, { method: 'POST', headers, body: '{}' })).status, 200);
  assert.equal((await fetch(`${url}/api/campus/calendar`, { headers })).status, 409);
  assert.equal(JSON.stringify(fs.readFileSync(path.join(dir, 'campus.json'), 'utf8')).includes(HELPER_PASSWORD), false);
  assert.equal(fs.readFileSync(path.join(dir, 'campus-cache.json'), 'utf8').includes('helper-session-cookie'), false);
});

test('campus agent tools read personal data, keep life errors separate and sync only hdu entries', async (t) => {
  const { url, password } = await spawnGateway(t);
  const login = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const { token: session } = await login.json();
  const sessionHeaders = { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' };
  await fetch(`${url}/api/campus/connect`, { method: 'POST', headers: sessionHeaders, body: JSON.stringify({ password: HELPER_PASSWORD }) });
  await fetch(`${url}/api/campus/personal`, { method: 'PUT', headers: sessionHeaders, body: JSON.stringify({ enabled: true }) });
  const created = await fetch(`${url}/api/agent/tokens`, { method: 'POST', headers: sessionHeaders, body: JSON.stringify({ name: '校园测试', scope: 'write' }) });
  const { token } = await created.json();
  const call = async (tool, args = {}, key) => {
    const response = await fetch(`${url}/api/v1/agent/call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify({ tool, arguments: args }),
    });
    return { status: response.status, body: await response.json() };
  };
  const ok = async (tool, args, key) => {
    const result = await call(tool, args, key);
    assert.equal(result.status, 200, `${tool}: ${JSON.stringify(result.body)}`);
    return result.body.result;
  };

  const manifest = await (await fetch(`${url}/api/v1/agent/manifest`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.ok(manifest.tools.some((tool) => tool.name === 'campus_sync_courses'));
  assert.ok(manifest.tools.some((tool) => tool.name === 'campus_life'));

  assert.equal((await ok('campus_status')).connected, true);
  assert.equal((await ok('campus_calendar')).data.weekNow, 10);
  assert.equal((await ok('campus_notices')).data.items[0].title, '教务处通知');
  assert.equal((await ok('campus_courses')).data.courses[0].name, '高等数学');
  assert.equal((await ok('campus_exams')).data.exams[0].course, '线性代数');
  const life = await ok('campus_life');
  assert.equal(life.card.data.balanceCents, 12345);
  assert.equal(life.electric.ok, false);
  assert.ok(typeof life.electric.error === 'string');

  const synced = await ok('campus_sync_courses', {}, 'campus-sync-courses-1');
  assert.equal(synced.written, 1);
  const first = await ok('courses_list');
  assert.equal(first.courses.length, 1);
  assert.equal(first.courses[0].id, 'hdu:course:abc');
  assert.equal(first.courses[0].semesterStart, '2026-09-07');
  assert.equal(first.courses[0].startTime, '08:05');
  const again = await ok('campus_sync_courses', {}, 'campus-sync-courses-2');
  assert.equal(again.written, 0);
  assert.equal(again.unchanged, 1);

  const exams = await ok('campus_sync_exams', {}, 'campus-sync-exams-1');
  assert.equal(exams.written, 1);
  const day = await ok('schedule_list', { from: '2026-12-19', to: '2026-12-21' });
  const exam = day.items.find((item) => item.id === 'hdu:exam:abc:2026-12-20');
  assert.equal(exam?.title, '考试：线性代数');
  assert.equal(exam?.source, '杭电助手');
});
