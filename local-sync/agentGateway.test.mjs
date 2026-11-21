import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

test('agent tokens are scoped, revocable and operate through the tool API only', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-agent-'));
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
  assert.equal(login.status, 200);
  const { token: sessionToken } = await login.json();
  const session = { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' };
  const call = (headers, body) => fetch(`${url}/api/v1/agent/call`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  assert.equal((await fetch(`${url}/api/v1/agent/manifest`)).status, 401);

  const readCreated = await fetch(`${url}/api/agent/tokens`, { method: 'POST', headers: session, body: JSON.stringify({ name: '只读助手', scope: 'read' }) });
  assert.equal(readCreated.status, 200);
  const read = await readCreated.json();
  assert.ok(read.token);
  assert.equal(read.agent.scope, 'read');
  assert.equal('hash' in read.agent, false);

  const listed = await (await fetch(`${url}/api/agent/tokens`, { headers: session })).json();
  assert.equal(listed.agents.length, 1);
  assert.equal(listed.agents[0].name, '只读助手');
  assert.equal('hash' in listed.agents[0], false);

  const readHeaders = { Authorization: `Bearer ${read.token}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${url}/api/planner`, { headers: readHeaders })).status, 403);

  const manifest = await (await fetch(`${url}/api/v1/agent/manifest`, { headers: readHeaders })).json();
  assert.equal(manifest.api, 'shunshou-agent');
  assert.equal(manifest.caller.scope, 'read');
  assert.ok(manifest.tools.some((tool) => tool.name === 'day_overview' && tool.scope === 'read'));
  assert.ok(manifest.tools.some((tool) => tool.name === 'schedule_create' && tool.scope === 'write'));
  assert.ok(manifest.tools.some((tool) => tool.name === 'services_search'));
  assert.equal(manifest.tools.some((tool) => tool.name === 'schedule_delete'), false);

  const mintByAgent = await fetch(`${url}/api/agent/tokens`, { method: 'POST', headers: readHeaders, body: JSON.stringify({ name: '越权', scope: 'write' }) });
  assert.equal(mintByAgent.status, 403);
  assert.equal((await mintByAgent.json()).error, 'session_required');

  const overview = await call(readHeaders, { tool: 'day_overview', arguments: {} });
  assert.equal(overview.status, 200);
  const overviewBody = await overview.json();
  assert.equal(overviewBody.ok, true);
  assert.equal(overviewBody.result.date, dayKey(new Date()));

  const now = Date.now();
  const draft = { title: 'Agent 学习', start: new Date(now - 3600_000).toISOString(), end: new Date(now - 1800_000).toISOString(), kind: 'event', location: '图书馆' };
  const denied = await call({ ...readHeaders, 'Idempotency-Key': 'create-denied' }, { tool: 'schedule_create', arguments: draft });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, 'scope_read_only');

  const writeCreated = await fetch(`${url}/api/agent/tokens`, { method: 'POST', headers: session, body: JSON.stringify({ name: '可写助手', scope: 'write' }) });
  assert.equal(writeCreated.status, 200);
  const write = await writeCreated.json();
  const writeHeaders = { Authorization: `Bearer ${write.token}`, 'Content-Type': 'application/json' };

  const missingKey = await call(writeHeaders, { tool: 'schedule_create', arguments: draft });
  assert.equal(missingKey.status, 400);
  assert.equal((await missingKey.json()).error, 'missing_idempotency_key');

  const createHeaders = { ...writeHeaders, 'Idempotency-Key': 'create-event-1' };
  const created = await call(createHeaders, { tool: 'schedule_create', arguments: draft });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  const eventId = createdBody.result.event.id;
  assert.ok(eventId);
  assert.equal(createdBody.result.event.title, 'Agent 学习');
  assert.equal(createdBody.result.event.source, 'manual');

  const retried = await (await call(createHeaders, { tool: 'schedule_create', arguments: draft })).json();
  assert.equal(retried.result.event.id, eventId);
  const planner = await (await fetch(`${url}/api/planner`, { headers: session })).json();
  assert.equal(planner.state.events.length, 1);

  const updated = await (await call({ ...writeHeaders, 'Idempotency-Key': 'update-event-1' }, { tool: 'schedule_update', arguments: { id: eventId, title: 'Agent 学习（改）', location: 'A101' } })).json();
  assert.equal(updated.result.event.title, 'Agent 学习（改）');
  assert.equal(updated.result.event.location, 'A101');

  const day = await (await call(writeHeaders, { tool: 'day_overview', arguments: {} })).json();
  assert.ok(day.result.items.some((item) => item.title === 'Agent 学习（改）'));
  const week = await (await call(writeHeaders, { tool: 'schedule_list', arguments: {} })).json();
  assert.ok(week.result.items.some((item) => item.title === 'Agent 学习（改）'));

  const focused = await (await call({ ...writeHeaders, 'Idempotency-Key': 'focus-start-1' }, { tool: 'focus_start', arguments: { task: '复习', minutes: 30, eventId } })).json();
  const sessionId = focused.result.session.id;
  assert.equal(focused.result.session.status, 'running');
  const second = await call({ ...writeHeaders, 'Idempotency-Key': 'focus-start-2' }, { tool: 'focus_start', arguments: { task: '另一个', minutes: 25 } });
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error, 'focus_active');

  const cancelKey = { ...writeHeaders, 'Idempotency-Key': 'focus-cancel-1' };
  const cancelled = await (await call(cancelKey, { tool: 'focus_control', arguments: { action: 'cancel', sessionId } })).json();
  assert.equal(cancelled.result.session.status, 'cancelled');
  const cancelledAgain = await (await call(cancelKey, { tool: 'focus_control', arguments: { action: 'cancel', sessionId } })).json();
  assert.equal(cancelledAgain.result.session.status, 'cancelled');

  const future = dayKey(new Date(Date.now() + 10 * 86400_000));
  const countdown = await call({ ...writeHeaders, 'Idempotency-Key': 'countdown-create-1' }, { tool: 'countdowns_create', arguments: { title: '交材料', kind: 'document', date: future } });
  assert.equal(countdown.status, 200);
  assert.equal((await countdown.json()).result.countdown.title, '交材料');
  const countdowns = await (await call(writeHeaders, { tool: 'countdowns_list', arguments: { withinDays: 30 } })).json();
  assert.ok(countdowns.result.items.some((item) => item.title === '交材料'));
  const countdownId = countdowns.result.items.find((item) => item.title === '交材料').id;
  const updatedCountdown = await (await call({ ...writeHeaders, 'Idempotency-Key': 'countdown-update-1' }, { tool: 'countdowns_update', arguments: { id: countdownId, title: '交材料（改）' } })).json();
  assert.equal(updatedCountdown.result.countdown.title, '交材料（改）');

  const current = await (await fetch(`${url}/api/planner`, { headers: session })).json();
  const service = { id: 'agent-service', title: '补办学生证', category: '证件', entryType: 'web', entry: 'https://example.edu/service', materials: '身份证', hours: '工作日', steps: '先线上申请', sourceUrl: 'https://example.edu/notice', sourceUpdated: null, verifiedAt: null, miniProgramQr: '' };
  const putService = await fetch(`${url}/api/planner/operations`, { method: 'POST', headers: session, body: JSON.stringify({ operationId: 'service-1', baseRevision: current.revision, command: { kind: 'put', collection: 'serviceEntries', value: service } }) });
  assert.equal(putService.status, 200);
  const searched = await (await call(writeHeaders, { tool: 'services_search', arguments: { query: '学生证' } })).json();
  assert.ok(searched.result.items.some((item) => item.title === '补办学生证'));

  const focusSummary = await (await call(writeHeaders, { tool: 'focus_summary', arguments: {} })).json();
  assert.equal(typeof focusSummary.result.today.minutes, 'number');
  const ledger = await (await call(writeHeaders, { tool: 'ledger_summary', arguments: {} })).json();
  assert.equal(ledger.result.expenseCents, 0);
  const records = await (await call(writeHeaders, { tool: 'ledger_records', arguments: {} })).json();
  assert.ok(Array.isArray(records.result.items));

  const audit = await (await fetch(`${url}/api/agent/audit`, { headers: session })).json();
  assert.ok(audit.entries.some((entry) => entry.tool === 'schedule_create' && entry.ok === true));
  assert.equal((await fetch(`${url}/api/agent/audit`, { headers: readHeaders })).status, 403);

  const bad = await call({ ...writeHeaders, 'Idempotency-Key': 'bad-args' }, { tool: 'schedule_create', arguments: { title: '', start: draft.start, end: draft.end } });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'invalid_arguments');
  const unknown = await call(writeHeaders, { tool: 'nope', arguments: {} });
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, 'unknown_tool');

  const removed = await fetch(`${url}/api/agent/tokens/${read.agent.id}`, { method: 'DELETE', headers: session });
  assert.equal(removed.status, 200);
  assert.equal((await fetch(`${url}/api/v1/agent/manifest`, { headers: readHeaders })).status, 401);

  assert.equal((await fetch(`${url}/api/v1/agent/manifest`, { headers: { ...writeHeaders, Origin: 'https://untrusted.example' } })).status, 403);
});
