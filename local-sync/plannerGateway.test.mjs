import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

test('isolated gateway requires auth and exposes persisted planner operations', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-gateway-'));
  const password = crypto.randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    cwd: dir, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', SHUNSHOU_DATA_DIR: dir, SHUNSHOU_PASSWORD: password }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = new Promise((r) => child.once('exit', r)); child.kill(); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('gateway startup timeout')), 10000);
    child.stdout.on('data', (chunk) => { const m = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(timer); resolve(m[0]); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('gateway exited')); });
  });
  const denied = await fetch(`${url}/api/planner`);
  assert.equal(denied.status, 401);
  const login = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const response = await fetch(`${url}/api/planner`, { headers });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 0);
  const command = { kind: 'put', collection: 'countdowns', value: { id: 'one', title: '证件', kind: 'document', date: '2026-12-01' } };
  const body = JSON.stringify({ operationId: 'request-a', baseRevision: 0, command });
  const put = await fetch(`${url}/api/planner/operations`, { method: 'POST', headers, body });
  assert.equal(put.status, 200);
  assert.equal((await put.json()).state.countdowns.length, 1);
  assert.equal((await fetch(`${url}/api/planner/operations`, { method: 'POST', headers, body })).status, 200);
  const bad = await fetch(`${url}/api/planner/operations`, { method: 'POST', headers, body: JSON.stringify({ operationId: 'bad', baseRevision: 1, command: { kind: 'delete', collection: '../auth', id: 'one' } }) });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(`${url}/api/calendar`)).status, 401);
  const calendars = await fetch(`${url}/api/calendar`, { headers });
  assert.equal(calendars.status, 200);
  assert.deepEqual((await calendars.json()).sources, []);
  const timestamp = Date.now();
  const snapshot = await fetch(`${url}/api/calendar/snapshot`, { method: 'PUT', headers, body: JSON.stringify({ sourceId: 'test-device', requestId: 'snap-one', baseRevision: 0, rangeStart: timestamp, rangeEnd: timestamp + 86400_000, fetchedAt: timestamp, calendarAvailable: false, complete: false, events: [] }) });
  assert.equal(snapshot.status, 200);
  assert.equal((await snapshot.json()).revision, 1);
  const foreign = await fetch(`${url}/api/planner`, { headers: { ...headers, Origin: 'https://untrusted.example' } });
  assert.equal(foreign.status, 403);
});
