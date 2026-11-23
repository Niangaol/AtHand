import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

test('pairing codes are single-use, expire, and require a session', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-pair-'));
  const password = crypto.randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    cwd: dir,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', SHUNSHOU_DATA_DIR: dir, SHUNSHOU_PASSWORD: password, SHUNSHOU_PAIR_TTL_MS: '800' },
    stdio: ['ignore', 'pipe', 'pipe'],
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

  const issueUnauthorized = await fetch(`${url}/api/pair/code`, { method: 'POST' });
  assert.equal(issueUnauthorized.status, 401);

  const login = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const issued = await fetch(`${url}/api/pair/code`, { method: 'POST', headers });
  assert.equal(issued.status, 200);
  const first = await issued.json();
  assert.match(first.code, /^[0-9a-f]{10}$/);
  assert.ok(first.expiresAt > Date.now());
  assert.deepEqual(first.urls, []);

  const exchange = (code) => fetch(`${url}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });

  assert.equal((await exchange('ffffffffffff')).status, 401);

  const paired = await exchange(first.code);
  assert.equal(paired.status, 200);
  const session = await paired.json();
  assert.equal(typeof session.token, 'string');
  assert.ok(session.expiresAt > Date.now());
  assert.equal((await fetch(`${url}/api/samples`, { headers: { Authorization: `Bearer ${session.token}` } })).status, 200);

  assert.equal((await exchange(first.code)).status, 401);

  const second = await (await fetch(`${url}/api/pair/code`, { method: 'POST', headers })).json();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal((await exchange(second.code)).status, 401);

  const agentCreated = await fetch(`${url}/api/agent/tokens`, { method: 'POST', headers, body: JSON.stringify({ name: 'probe', scope: 'read' }) });
  assert.equal(agentCreated.status, 200);
  const agent = await agentCreated.json();
  const agentDenied = await fetch(`${url}/api/pair/code`, { method: 'POST', headers: { Authorization: `Bearer ${agent.token}` } });
  assert.equal(agentDenied.status, 403);
});
