import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCampusCache } from './campusCache.mjs';
import { createCampusClient, CampusClientError } from './campusClient.mjs';
import { readCached } from './campusRoutes.mjs';
import { createCampusSettings } from './campusSettings.mjs';

function temp() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-campus-'));
  return { directory, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('campus settings default to off and persist without credentials', (t) => {
  const { directory, cleanup } = temp();
  t.after(cleanup);
  assert.deepEqual(createCampusSettings(directory).read(), { personalEnabled: false });
  const saved = createCampusSettings(directory).update({ personalEnabled: true });
  assert.deepEqual(saved, { version: 1, personalEnabled: true });
  assert.deepEqual(createCampusSettings(directory).read(), { personalEnabled: true });
  const raw = fs.readFileSync(path.join(directory, 'campus.json'), 'utf8');
  assert.equal(raw.includes('password'), false);
});

test('public cache survives restart while personal cache stays in memory', (t) => {
  const { directory, cleanup } = temp();
  t.after(cleanup);
  let clock = 1000;
  const first = createCampusCache({ directory, now: () => clock });
  first.write('calendar', { ok: true, data: { week: 10 } });
  first.write('courses', { ok: true, data: { courses: ['private'] } }, { personal: true });
  assert.deepEqual(first.read('courses').envelope.data, { courses: ['private'] });
  assert.equal(fs.readFileSync(path.join(directory, 'campus-cache.json'), 'utf8').includes('private'), false);

  clock = 2000;
  const second = createCampusCache({ directory, now: () => clock });
  assert.deepEqual(second.read('calendar').envelope.data, { week: 10 });
  assert.equal(second.read('courses'), null);
  second.write('courses', { ok: true, data: { courses: ['private'] } }, { personal: true });
  second.clearPersonal();
  assert.equal(second.read('courses'), null);
  assert.deepEqual(second.read('calendar').envelope.data, { week: 10 });
});

test('stale public data is returned with a warning when upstream fails after TTL', async (t) => {
  const { directory, cleanup } = temp();
  t.after(cleanup);
  const cache = createCampusCache({ directory, now: () => 1000 });
  cache.write('calendar', { ok: true, capability: 'calendar', stale: false, warnings: [], data: { weekNow: 10 } });
  const value = await readCached(cache, 'calendar', {
    ttlMs: 10,
    personal: false,
    now: () => 2000,
    loader: async () => { throw new CampusClientError(502, 'helper_unavailable', 'down'); },
  });
  assert.equal(value.stale, true);
  assert.equal(value.data.weekNow, 10);
  assert.deepEqual(value.warnings, ['helper_unavailable']);
  assert.equal(value.cachedAt, new Date(1000).toISOString());
});

function response(status, body, cookies = []) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { getSetCookie: () => cookies },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

test('campus client keeps cookie and csrf in memory, forwards them, and never stores the password', async (t) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/web/api/login')) {
      return response(200, { csrf_token: 'csrf-token-1234567890', expires_at: new Date(Date.now() + 3600_000).toISOString(), capabilities: { personal_queries: true } },
        ['hdu_web_session=session-value; Path=/web; HttpOnly; SameSite=strict']);
    }
    if (url.endsWith('/web/api/campus/courses')) return response(200, { ok: true, data: { courses: [] } });
    if (url.endsWith('/web/api/messages')) return response(200, { request_id: 'r', state: 'DONE', route: 'answer', text: '回答', sources: [], warnings: [], is_demo: true });
    return response(404, { detail: 'missing' });
  };
  const client = createCampusClient({ baseUrl: 'http://127.0.0.1:8000', fetchImpl });
  assert.equal(client.status().connected, false);
  await client.connect('helper-password-12345678901234567890');
  assert.equal(client.status().connected, true);
  assert.equal(client.status().personalQueries, true);
  assert.equal(JSON.stringify(client.status()).includes('helper-password'), false);

  await client.get('/web/api/campus/courses');
  assert.equal(calls[1].init.headers.Cookie, 'hdu_web_session=session-value');
  assert.equal(calls[1].init.headers.Origin, 'http://127.0.0.1:8000');

  const answer = await client.ask('下一节课在哪');
  assert.equal(answer.text, '回答');
  assert.equal(calls[2].init.headers['X-CSRF-Token'], 'csrf-token-1234567890');

  client.disconnect();
  assert.equal(client.status().connected, false);
  await assert.rejects(client.get('/web/api/campus/courses'), (error) => error instanceof CampusClientError && error.code === 'not_connected');
});

test('campus client drops an expired helper session instead of replaying it', async () => {
  let expired = false;
  const fetchImpl = async (url) => {
    if (url.endsWith('/web/api/login')) {
      return response(200, { csrf_token: 'csrf-token-1234567890', expires_at: new Date(Date.now() + 3600_000).toISOString(), capabilities: {} },
        ['hdu_web_session=session-value; Path=/web']);
    }
    return expired ? response(401, { detail: '请先登录' }) : response(200, { ok: true });
  };
  const client = createCampusClient({ baseUrl: 'http://127.0.0.1:8000', fetchImpl });
  await client.connect('helper-password-12345678901234567890');
  expired = true;
  await assert.rejects(client.get('/web/api/campus/courses'), (error) => error instanceof CampusClientError && error.code === 'not_connected');
  assert.equal(client.status().connected, false);
});
