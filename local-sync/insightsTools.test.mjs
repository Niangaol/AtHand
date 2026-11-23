import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

test('insight tools are listed and answer read-only summaries', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-insights-'));
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
  const created = await fetch(`${url}/api/agent/tokens`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '洞察', scope: 'read' }) });
  const { token: agent } = await created.json();
  const headers = { Authorization: `Bearer ${agent}`, 'Content-Type': 'application/json' };

  const manifest = await (await fetch(`${url}/api/v1/agent/manifest`, { headers })).json();
  for (const name of ['day_brief', 'week_review', 'ledger_insights', 'focus_insights']) {
    const tool = manifest.tools.find((item) => item.name === name);
    assert.ok(tool, `${name} missing`);
    assert.equal(tool.scope, 'read');
  }

  const call = async (tool, args = {}) => {
    const response = await fetch(`${url}/api/v1/agent/call`, { method: 'POST', headers, body: JSON.stringify({ tool, arguments: args }) });
    return { status: response.status, body: await response.json() };
  };
  const brief = await call('day_brief');
  assert.equal(brief.status, 200);
  assert.equal(brief.body.result.expenseCents, 0);
  assert.ok(Array.isArray(brief.body.result.items));
  const week = await call('week_review');
  assert.equal(week.status, 200);
  assert.equal(week.body.result.thisWeek.expenseCents, 0);
  const ledger = await call('ledger_insights', { days: 7 });
  assert.equal(ledger.status, 200);
  assert.equal(ledger.body.result.range.days, 7);
  const focus = await call('focus_insights', { days: 7 });
  assert.equal(focus.status, 200);
  assert.equal(focus.body.result.sessions, 0);
});
