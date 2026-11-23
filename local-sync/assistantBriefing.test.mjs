import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAssistant } from './assistant.mjs';

const reply = (response, value, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
};

test('briefing returns a modeled narrative, degrades cleanly, and caches', async (t) => {
  let mode = 'ok';
  const providerRequests = [];
  const provider = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      providerRequests.push({ url: request.url, body: raw ? JSON.parse(raw) : null });
      if (mode === 'fail') { reply(response, { error: { message: 'boom' } }, 500); return; }
      reply(response, { choices: [{ message: { role: 'assistant', content: '今天两件事，先上高等数学。' } }] });
    });
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const providerPort = provider.address().port;
  t.after(() => new Promise((resolve) => provider.close(resolve)));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-briefing-'));
  const password = crypto.randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    cwd: dir, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', SHUNSHOU_DATA_DIR: dir, SHUNSHOU_PASSWORD: password }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('gateway startup timeout')), 10000);
    child.stdout.on('data', (chunk) => { const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('gateway exited')); });
  });
  const login = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const unconfigured = await fetch(`${url}/api/assistant/briefing?scope=day`, { headers });
  const unconfiguredBody = await unconfigured.json();
  assert.equal(unconfigured.status, 200);
  assert.equal(unconfiguredBody.degraded, true);
  assert.match(unconfiguredBody.warning, /还没有配置模型/);
  assert.ok(unconfiguredBody.narrative.length > 0);
  assert.ok(unconfiguredBody.facts.date);
  assert.equal(providerRequests.length, 0);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const seeded = await fetch(`${url}/api/planner/operations`, {
    method: 'POST', headers,
    body: JSON.stringify({
      operationId: 'seed-brief-event', baseRevision: 0,
      command: {
        kind: 'put', collection: 'events',
        value: { id: 'seed-brief-event', title: '高等数学', kind: 'course', location: '三教101', start: new Date(`${today}T14:00:00`).getTime(), end: new Date(`${today}T15:30:00`).getTime(), allDay: false, timeZone: 'Asia/Shanghai', source: 'manual', sourceId: '' },
      },
    }),
  });
  assert.equal(seeded.status, 200);
  const ledger = await fetch(`${url}/api/ledger`, {
    method: 'PUT', headers,
    body: JSON.stringify({ ledger: { version: 1, records: [{ id: 'seed-brief-expense', type: 'expense', date: today, title: '午饭', amountCents: 1850, category: '吃饭', source: 'manual' }], workplaces: [], settings: { hourlyRateCents: 2000 } } }),
  });
  assert.equal(ledger.status, 200);

  const privacyDenied = await fetch(`${url}/api/assistant/settings`, { method: 'PUT', headers, body: JSON.stringify({ baseUrl: 'http://192.0.2.10:11434/v1', model: 'fake-model', privacyMode: 'local-only' }) });
  assert.equal(privacyDenied.status, 200);
  const blocked = await fetch(`${url}/api/assistant/briefing?scope=day`, { headers });
  const blockedBody = await blocked.json();
  assert.equal(blocked.status, 200);
  assert.equal(blockedBody.degraded, true);
  assert.match(blockedBody.warning, /只在本机/);
  assert.ok(blockedBody.narrative.length > 0);
  assert.equal(providerRequests.length, 0, 'local-only must not call a non-loopback provider');

  await fetch(`${url}/api/assistant/settings`, { method: 'PUT', headers, body: JSON.stringify({ baseUrl: `http://127.0.0.1:${providerPort}/v1`, model: 'fake-model' }) });

  const first = await fetch(`${url}/api/assistant/briefing?scope=day`, { headers });
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.degraded, false);
  assert.equal(firstBody.narrative, '今天两件事，先上高等数学。');
  assert.equal(firstBody.model, 'fake-model');
  assert.equal(providerRequests.length, 1);
  assert.equal(firstBody.facts.expenseCents, 1850, 'API response keeps the raw facts');
  assert.equal(typeof firstBody.facts.items[0].start, 'number');
  const sentBody = JSON.stringify(providerRequests[0].body);
  const sentPrompt = providerRequests[0].body.messages[0].content;
  assert.equal(sentBody.includes('expenseCents'), false, 'prompt must not carry raw cents');
  assert.equal(sentPrompt.includes('expenseCents'), false, 'prompt must not carry raw cents');
  assert.equal(/"start":/.test(sentPrompt), false, 'prompt must not carry raw epoch fields');
  assert.equal(/"end":/.test(sentPrompt), false);
  assert.equal(/\d{13}/.test(sentPrompt), false, 'prompt must not carry any epoch-millis number');
  assert.ok(sentPrompt.includes('"expenseYuan":"18.50"'), 'prompt carries a formatted yuan amount');
  assert.match(sentPrompt, /"startClock":"14:00"/);
  assert.match(sentPrompt, /"endClock":"15:30"/);
  assert.match(sentPrompt, /"weekday":"周[一二三四五六日]"/);
  assert.match(sentPrompt, /金额和时间已经在数据里格式化好/);

  await fetch(`${url}/api/assistant/briefing?scope=day`, { headers });
  assert.equal(providerRequests.length, 1, 'second call should hit cache');

  await fetch(`${url}/api/assistant/briefing?scope=day&fresh=1`, { headers });
  assert.equal(providerRequests.length, 2, 'fresh bypasses cache');

  mode = 'fail';
  const failed = await fetch(`${url}/api/assistant/briefing?scope=week&fresh=1`, { headers });
  const failedBody = await failed.json();
  assert.equal(failed.status, 200);
  assert.equal(failedBody.degraded, true);
  assert.match(failedBody.warning, /模型/);
  assert.ok(failedBody.narrative.length > 0);
  const bad = await fetch(`${url}/api/assistant/briefing?scope=bogus`, { headers });
  assert.equal(bad.status, 400);
});

test('briefing redacts facts for non-loopback models and restores placeholders', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-briefing-redact-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const facts = {
    date: '2026-11-23', items: [{ title: '找 13812345678 同学', start: Date.now(), end: Date.now() + 600_000, kind: 'event', location: '', source: '手动日程' }],
    next: null, countdowns: [], expenseCents: 0, workMinutes: 0, focusMinutes: 0, activeFocus: null, warnings: [],
  };
  const assistant = createAssistant({
    directory: dir,
    getTools: async () => [],
    callTool: async () => ({ ok: true }),
    getBriefFacts: async () => facts,
  });

  const sent = [];
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });

  assistant.updateSettings({ baseUrl: 'https://api.example.com/v1', model: 'cloud-model', privacyMode: 'off' });
  globalThis.fetch = async (_url, init) => {
    sent.push(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '今天先联系 13812345678。' } }] }), { status: 200 });
  };
  const raw = await assistant.briefing({ scope: 'day', fresh: true });
  assert.equal(raw.degraded, false);
  assert.ok(sent[0].includes('13812345678'), 'privacyMode off sends raw text');

  assistant.updateSettings({ privacyMode: 'redact' });
  globalThis.fetch = async (_url, init) => {
    sent.push(init.body);
    const match = String(init.body).match(/\[\[PHONE:[0-9a-f]{10}\]\]/);
    return new Response(JSON.stringify({ choices: [{ message: { content: `今天先联系 ${match ? match[0] : '某人'}。` } }] }), { status: 200 });
  };
  const redacted = await assistant.briefing({ scope: 'day', fresh: true });
  assert.equal(sent[1].includes('13812345678'), false, 'redact mode must not send the raw phone');
  assert.ok(sent[1].includes('[[PHONE:'), 'redact mode sends a placeholder');
  assert.equal(redacted.degraded, false);
  assert.ok(redacted.narrative.includes('13812345678'), 'reply placeholder is restored locally');
});

test('briefing falls back to the template when the model reply is too short', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-briefing-short-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const assistant = createAssistant({
    directory: dir,
    getTools: async () => [],
    callTool: async () => ({ ok: true }),
    getBriefFacts: async () => ({
      date: '2026-11-23', items: [], next: null, countdowns: [], expenseCents: 0,
      workMinutes: 0, focusMinutes: 0, activeFocus: null, warnings: [],
    }),
  });
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  assistant.updateSettings({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'tiny-model' });
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '好' } }] }), { status: 200 });

  const result = await assistant.briefing({ scope: 'day' });
  assert.equal(result.degraded, true);
  assert.equal(result.model, null);
  assert.match(result.warning, /模型的回复不合用/);
  assert.ok(result.narrative.length > 5, 'narrative falls back to the deterministic template');
  assert.notEqual(result.narrative, '好');
});

test('updateSettings clears the briefing cache even when the cache key is unchanged', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-briefing-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const assistant = createAssistant({
    directory: dir,
    getTools: async () => [],
    callTool: async () => ({ ok: true }),
    getBriefFacts: async () => ({
      date: '2026-11-23', items: [], next: null, countdowns: [], expenseCents: 0,
      workMinutes: 0, focusMinutes: 0, activeFocus: null, warnings: [],
    }),
  });
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: `第 ${calls} 次生成的简报内容。` } }] }), { status: 200 });
  };

  assistant.updateSettings({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'same-model' });
  const primed = await assistant.briefing({ scope: 'day' });
  assert.equal(primed.degraded, false);
  assert.equal(calls, 1);

  const cached = await assistant.briefing({ scope: 'day' });
  assert.equal(calls, 1, 'second non-fresh request hits the cache');
  assert.equal(cached.narrative, primed.narrative);

  assistant.updateSettings({ model: 'same-model' });
  const refreshed = await assistant.briefing({ scope: 'day' });
  assert.equal(calls, 2, 'updateSettings empties the cache despite the identical key');
  assert.equal(refreshed.narrative, '第 2 次生成的简报内容。');
});
