import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const reply = (response, value, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
};

test('the built-in assistant stores a private model config and runs a tool loop', async (t) => {
  const providerRequests = [];
  let mode = 'write';
  const provider = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      providerRequests.push({ url: request.url, headers: request.headers, body });
      if (request.url === '/v1/models') {
        reply(response, { data: [{ id: 'fake-model' }, { id: 'other-model' }] });
        return;
      }
      if (request.url !== '/v1/chat/completions') {
        reply(response, { error: { message: 'not found' } }, 404);
        return;
      }
      const toolSeen = body.messages.some((message) => message.role === 'tool');
      if (!toolSeen && mode === 'write') {
        const start = new Date(Date.now() + 3600_000).toISOString();
        const end = new Date(Date.now() + 7200_000).toISOString();
        reply(response, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_schedule_1', type: 'function', function: { name: 'schedule_create', arguments: JSON.stringify({ title: '复习', start, end }) } }] }, finish_reason: 'tool_calls' }] });
        return;
      }
      if (!toolSeen && mode === 'read') {
        reply(response, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_overview_1', type: 'function', function: { name: 'day_overview', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] });
        return;
      }
      if (!toolSeen && mode === 'bad') {
        reply(response, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_delete_1', type: 'function', function: { name: 'schedule_delete', arguments: '{"id":"x"}' } }] }, finish_reason: 'tool_calls' }] });
        return;
      }
      reply(response, { choices: [{ message: { role: 'assistant', content: mode === 'bad' ? '删除不在我的权限里，请到日程页操作。' : mode === 'read' ? '今天有一项安排。' : '已经安排好了。' }, finish_reason: 'stop' }] });
    });
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const providerPort = provider.address().port;
  t.after(() => new Promise((resolve) => provider.close(resolve)));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-assistant-'));
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
  const call = async (pathName, body, method = 'POST') => {
    const response = await fetch(`${url}${pathName}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };

  const saved = await call('/api/assistant/settings', { baseUrl: `http://127.0.0.1:${providerPort}/v1`, model: 'fake-model', apiKey: 'secret-key' }, 'PUT');
  assert.equal(saved.status, 200);
  assert.equal(saved.body.hasApiKey, true);
  assert.equal('apiKey' in saved.body, false);
  const settings = await call('/api/assistant/settings', undefined, 'GET');
  assert.equal(settings.body.model, 'fake-model');
  assert.equal(settings.body.hasApiKey, true);
  assert.equal('apiKey' in settings.body, false);

  const tested = await call('/api/assistant/test', {});
  assert.equal(tested.status, 200);
  assert.equal(tested.body.result.ok, true);
  assert.equal(tested.body.result.modelFound, true);

  const invalid = await call('/api/assistant/chat', { messages: [] });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'invalid_messages');

  const chat = await call('/api/assistant/chat', { messages: [{ role: 'user', content: '明晚七点复习一小时' }] });
  assert.equal(chat.status, 200);
  assert.equal(chat.body.reply, '已经安排好了。');
  assert.equal(chat.body.trace[0].tool, 'schedule_create');
  assert.equal(chat.body.trace[0].ok, true);
  const planner = await (await fetch(`${url}/api/planner`, { headers })).json();
  assert.ok(planner.state.events.some((event) => event.title === '复习'));
  const providerChats = providerRequests.filter((request) => request.url === '/v1/chat/completions');
  assert.equal(providerChats[0].headers.authorization, 'Bearer secret-key');
  assert.equal(providerChats[0].body.reasoning_effort, 'none');
  assert.ok(providerChats[0].body.tools.some((tool) => tool.function.name === 'schedule_create'));
  assert.ok(providerChats[1].body.messages.some((message) => message.role === 'tool'));

  mode = 'read';
  const read = await call('/api/assistant/chat', { messages: [{ role: 'user', content: '今天有什么安排' }] });
  assert.equal(read.status, 200);
  assert.equal(read.body.trace[0].tool, 'day_overview');
  assert.equal(read.body.trace[0].ok, true);

  mode = 'bad';
  const bad = await call('/api/assistant/chat', { messages: [{ role: 'user', content: '删掉那个日程' }] });
  assert.equal(bad.status, 200);
  assert.equal(bad.body.trace[0].ok, false);
  assert.match(bad.body.reply, /删除/);

  const audit = await (await fetch(`${url}/api/agent/audit`, { headers })).json();
  assert.ok(audit.entries.some((entry) => entry.actor === '内置助手' && entry.tool === 'schedule_create'));
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'assistant.json'), 'utf8'));
  assert.equal(stored.apiKey, 'secret-key');
  assert.equal(JSON.stringify(await call('/api/assistant/settings', undefined, 'GET').then((result) => result.body)).includes('secret-key'), false);

  await call('/api/assistant/settings', { model: '' }, 'PUT');
  const unconfigured = await call('/api/assistant/chat', { messages: [{ role: 'user', content: '今天怎么样' }] });
  assert.equal(unconfigured.status, 409);
  assert.equal(unconfigured.body.error, 'provider_not_configured');
});
