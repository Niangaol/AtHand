// 账号管理单测：改密、设备会话、吊销、退出全部与注销。
// 直接运行：node functions/account.test.mjs
// 或用测试运行器（本机沙箱禁止 spawn 子进程时需加 --test-isolation=none）：
//   node --test --test-isolation=none functions/account.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { application } from './routes.mjs';

function createFakeDb() {
  const tables = new Map();
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  const matches = (row, filters) => filters.every(([column, value]) => row[column] === value);

  class Query {
    constructor(name) {
      this.name = name;
      this.op = null;
      this.payload = null;
      this.options = null;
      this.filters = [];
      this.columns = '*';
    }
    select(columns = '*') { if (!this.op) this.op = 'select'; this.columns = columns; return this; }
    insert(payload) { this.op = 'insert'; this.payload = payload; return this; }
    insertIfAbsent(payload, options) { this.op = 'insertIfAbsent'; this.payload = payload; this.options = options; return this; }
    update(payload) { this.op = 'update'; this.payload = payload; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    limit() { return this; }
    then(resolve, reject) { return this.run().then(resolve, reject); }
    async run() {
      const rows = table(this.name);
      if (this.op === 'select') {
        return { data: rows.filter((row) => matches(row, this.filters)).map((row) => ({ ...row })), error: null };
      }
      if (this.op === 'insert') {
        rows.push({ ...this.payload });
        return { data: [{ ...this.payload }], error: null };
      }
      if (this.op === 'insertIfAbsent') {
        const key = this.options?.onConflict ?? 'key';
        if (rows.some((row) => row[key] === this.payload[key])) return { data: [], error: null };
        rows.push({ ...this.payload });
        return { data: [{ ...this.payload }], error: null };
      }
      if (this.op === 'update') {
        const changed = rows.filter((row) => matches(row, this.filters));
        for (const row of changed) Object.assign(row, this.payload);
        return { data: changed.map((row) => ({ id: row.id })), error: null };
      }
      if (this.op === 'delete') {
        table(this.name).splice(0, rows.length, ...rows.filter((row) => !matches(row, this.filters)));
        return { data: [], error: null };
      }
      throw new Error(`unsupported operation ${this.op}`);
    }
  }

  return {
    from: (name) => new Query(name),
    rows: (name) => table(name),
  };
}

function call(handle, path, { method = 'GET', token, body, device } = {}) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (device) headers.set('x-device-name', device);
  const request = new Request(`https://site.example/functions/v1/app${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle({ request });
}

async function register(handle, username, password, device = 'test-device') {
  const response = await call(handle, '/api/register', {
    method: 'POST', device, body: { username, password },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  return body;
}

async function login(handle, username, password, device = 'test-device') {
  return call(handle, '/api/login', { method: 'POST', device, body: { username, password } });
}

function userRow(db, username) {
  return db.rows('shunshou_users').find((row) => row.username === username) ?? null;
}

test('修改密码：旧密码错误被拒，成功后重哈希且只保留当前会话', async () => {
  const db = createFakeDb();
  const handle = application({ db });
  const first = await register(handle, 'alice', 'old-password-1', 'dorm-pc');
  const second = await (await login(handle, 'alice', 'old-password-1', 'phone')).json();
  assert.equal(second.ok, true);
  const before = { ...userRow(db, 'alice') };

  const wrong = await call(handle, '/api/account/password', {
    method: 'POST', token: first.token,
    body: { currentPassword: 'not-the-password', newPassword: 'new-password-2' },
  });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, 'invalid_credentials');

  const tooShort = await call(handle, '/api/account/password', {
    method: 'POST', token: first.token,
    body: { currentPassword: 'old-password-1', newPassword: '1234567' },
  });
  assert.equal(tooShort.status, 400);
  assert.equal((await tooShort.json()).error, 'invalid_password');

  const unchanged = await call(handle, '/api/account/password', {
    method: 'POST', token: first.token,
    body: { currentPassword: 'old-password-1', newPassword: 'old-password-1' },
  });
  assert.equal(unchanged.status, 400);
  assert.equal((await unchanged.json()).error, 'password_unchanged');

  const changed = await call(handle, '/api/account/password', {
    method: 'POST', token: first.token,
    body: { currentPassword: 'old-password-1', newPassword: 'new-password-2' },
  });
  assert.equal(changed.status, 200);
  const changedBody = await changed.json();
  assert.equal(changedBody.ok, true);
  assert.equal(changedBody.revokedSessions, 1);

  const after = userRow(db, 'alice');
  assert.notEqual(after.password_hash, before.password_hash);
  assert.notEqual(after.password_salt, before.password_salt);
  assert.equal(after.password_iterations, 150_000);

  const oldLogin = await login(handle, 'alice', 'old-password-1');
  assert.equal(oldLogin.status, 401);
  const newLogin = await login(handle, 'alice', 'new-password-2');
  assert.equal(newLogin.status, 200);

  const currentSession = await call(handle, '/api/me', { token: first.token });
  assert.equal(currentSession.status, 200);
  const revokedSession = await call(handle, '/api/me', { token: second.token });
  assert.equal(revokedSession.status, 401);
});

test('会话列表：只返回本人会话，标记当前设备且不泄露令牌', async () => {
  const db = createFakeDb();
  const handle = application({ db });
  const alice = await register(handle, 'alice', 'password-1', 'dorm-pc');
  const alicePhone = await (await login(handle, 'alice', 'password-1', 'phone')).json();
  const bob = await register(handle, 'bob', 'password-2', 'library-pc');

  const response = await call(handle, '/api/account/sessions', { token: alice.token });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.sessions.length, 2);
  assert.equal(body.currentSessionId, alice.sessionId);

  const current = body.sessions.filter((session) => session.current);
  assert.equal(current.length, 1);
  assert.equal(current[0].id, alice.sessionId);
  const labels = body.sessions.map((session) => session.deviceLabel).sort();
  assert.deepEqual(labels, ['dorm-pc', 'phone'].sort());
  for (const session of body.sessions) {
    assert.match(session.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(session.lastSeenAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(session.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal('token_hash' in session, false);
    assert.equal('user_id' in session, false);
  }
  assert.ok(body.sessions.some((session) => session.id === alicePhone.sessionId));

  const bobSessions = await (await call(handle, '/api/account/sessions', { token: bob.token })).json();
  assert.equal(bobSessions.sessions.length, 1);
  assert.equal(bobSessions.sessions[0].id, bob.sessionId);
  assert.equal(bobSessions.sessions[0].current, true);
  assert.equal(bobSessions.sessions[0].deviceLabel, 'library-pc');
});

test('吊销单个会话：该令牌失效，其它设备与他人不受影响', async () => {
  const db = createFakeDb();
  const handle = application({ db });
  const alice = await register(handle, 'alice', 'password-1', 'dorm-pc');
  const alicePhone = await (await login(handle, 'alice', 'password-1', 'phone')).json();
  const bob = await register(handle, 'bob', 'password-2', 'library-pc');

  const revoked = await call(handle, `/api/account/sessions/${alicePhone.sessionId}`, {
    method: 'DELETE', token: alice.token,
  });
  assert.equal(revoked.status, 200);
  const revokedBody = await revoked.json();
  assert.equal(revokedBody.ok, true);
  assert.equal(revokedBody.current, false);

  assert.equal((await call(handle, '/api/me', { token: alicePhone.token })).status, 401);
  assert.equal((await call(handle, '/api/me', { token: alice.token })).status, 200);
  assert.equal((await call(handle, '/api/me', { token: bob.token })).status, 200);

  const foreign = await call(handle, `/api/account/sessions/${bob.sessionId}`, {
    method: 'DELETE', token: alice.token,
  });
  assert.equal(foreign.status, 404);
  assert.equal((await foreign.json()).error, 'session_not_found');
  assert.equal((await call(handle, '/api/me', { token: bob.token })).status, 200);

  const current = await call(handle, `/api/account/sessions/${alice.sessionId}`, {
    method: 'DELETE', token: alice.token,
  });
  assert.equal(current.status, 200);
  assert.equal((await current.json()).current, true);
  assert.equal((await call(handle, '/api/me', { token: alice.token })).status, 401);
  assert.equal((await login(handle, 'alice', 'password-1')).status, 200);
});

test('退出全部设备：该账号全部令牌失效，其他账号不受影响', async () => {
  const db = createFakeDb();
  const handle = application({ db });
  const alice = await register(handle, 'alice', 'password-1', 'dorm-pc');
  const alicePhone = await (await login(handle, 'alice', 'password-1', 'phone')).json();
  const bob = await register(handle, 'bob', 'password-2', 'library-pc');

  const response = await call(handle, '/api/account/logout-all', { method: 'POST', token: alice.token });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.revoked, 2);

  assert.equal((await call(handle, '/api/me', { token: alice.token })).status, 401);
  assert.equal((await call(handle, '/api/me', { token: alicePhone.token })).status, 401);
  assert.equal((await call(handle, '/api/me', { token: bob.token })).status, 200);
  assert.equal(db.rows('shunshou_sessions').filter((row) => row.user_id === alice.user.id).length, 0);

  const again = await login(handle, 'alice', 'password-1');
  assert.equal(again.status, 200);
  assert.equal((await call(handle, '/api/me', { token: (await again.json()).token })).status, 200);
});

test('账号注销：缺二次确认被拒，密码错误被拒，确认后清理本人数据', async () => {
  const db = createFakeDb();
  const handle = application({ db });
  const alice = await register(handle, 'alice', 'password-1', 'dorm-pc');
  const bob = await register(handle, 'bob', 'password-2', 'library-pc');
  const aliceLedger = {
    version: 1,
    records: [{ id: 'alice-1', type: 'expense', date: '2026-11-22', title: '午饭', amountCents: 1850, category: '吃饭' }],
    workplaces: [],
    settings: { hourlyRateCents: 3000 },
  };
  const bobLedger = { ...aliceLedger, records: [{ ...aliceLedger.records[0], id: 'bob-1', title: '乙的账' }] };
  assert.equal((await call(handle, '/api/ledger', { method: 'PUT', token: alice.token, body: { ledger: aliceLedger } })).status, 200);
  assert.equal((await call(handle, '/api/ledger', { method: 'PUT', token: bob.token, body: { ledger: bobLedger } })).status, 200);
  const aliceDocKeys = db.rows('shunshou_docs').map((row) => row.key).filter((key) => key.startsWith(`${alice.user.id}:`));
  assert.ok(aliceDocKeys.length >= 1);

  const noConfirm = await call(handle, '/api/account/delete', {
    method: 'POST', token: alice.token, body: { password: 'password-1' },
  });
  assert.equal(noConfirm.status, 400);
  assert.equal((await noConfirm.json()).error, 'confirmation_required');
  assert.equal((await call(handle, '/api/me', { token: alice.token })).status, 200);

  const badConfirm = await call(handle, '/api/account/delete', {
    method: 'POST', token: alice.token, body: { password: 'password-1', confirmation: 'yes' },
  });
  assert.equal(badConfirm.status, 400);

  const badPassword = await call(handle, '/api/account/delete', {
    method: 'POST', token: alice.token,
    body: { password: 'wrong-password', confirmation: 'delete-account' },
  });
  assert.equal(badPassword.status, 401);
  assert.equal((await call(handle, '/api/me', { token: alice.token })).status, 200);

  const deleted = await call(handle, '/api/account/delete', {
    method: 'POST', token: alice.token,
    body: { password: 'password-1', confirmation: 'delete-account' },
  });
  assert.equal(deleted.status, 200);
  const deletedBody = await deleted.json();
  assert.equal(deletedBody.ok, true);
  assert.equal(deletedBody.deleted.user, true);
  assert.equal(deletedBody.deleted.sessions, 1);
  assert.equal(deletedBody.deleted.documents, aliceDocKeys.length);

  assert.equal((await call(handle, '/api/me', { token: alice.token })).status, 401);
  assert.equal(userRow(db, 'alice'), null);
  assert.equal(db.rows('shunshou_sessions').filter((row) => row.user_id === alice.user.id).length, 0);
  assert.equal(db.rows('shunshou_docs').filter((row) => row.key.startsWith(`${alice.user.id}:`)).length, 0);
  assert.equal((await login(handle, 'alice', 'password-1')).status, 401);

  const bobToken = await call(handle, '/api/me', { token: bob.token });
  assert.equal(bobToken.status, 200);
  const bobData = await (await call(handle, '/api/ledger', { token: bob.token })).json();
  assert.equal(bobData.ledger.records[0].title, '乙的账');
});

test('账号信息与数据统计：返回账号、创建时间和当前会话', async () => {
  const db = createFakeDb();
  const handle = application({ db });
  const alice = await register(handle, 'alice', 'password-1', 'dorm-pc');
  const event = {
    id: 'e1', title: '英语', kind: 'event', location: '', start: 1763800000000, end: 1763803600000,
    allDay: false, timeZone: 'Asia/Shanghai', source: 'manual', sourceId: '',
  };
  const ledger = {
    version: 1,
    records: [
      { id: 'r1', type: 'expense', date: '2026-11-22', title: '午饭', amountCents: 1850, category: '吃饭' },
      { id: 'r2', type: 'expense', date: '2026-11-22', title: '晚饭', amountCents: 2100, category: '吃饭' },
    ],
    workplaces: [],
    settings: { hourlyRateCents: 3000 },
  };
  assert.equal((await call(handle, '/api/ledger', { method: 'PUT', token: alice.token, body: { ledger } })).status, 200);
  assert.equal((await call(handle, '/api/planner/operations', {
    method: 'POST', token: alice.token,
    body: { operationId: 'op-1', baseRevision: 0, command: { kind: 'put', collection: 'events', value: event } },
  })).status, 200);
  assert.equal((await call(handle, '/api/samples', {
    method: 'POST', token: alice.token, body: { samples: [{ id: 's1', amount: 12.5 }] },
  })).status, 200);

  const response = await call(handle, '/api/account', { token: alice.token });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.user.id, alice.user.id);
  assert.equal(body.user.username, 'alice');
  assert.match(body.user.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(body.user.lastLoginAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(body.currentSession.id, alice.sessionId);
  assert.equal(body.currentSession.current, true);
  assert.equal(body.currentSession.deviceLabel, 'dorm-pc');
  assert.equal(body.stats.sessions, 1);
  assert.equal(body.stats.ledgerRecords, 2);
  assert.equal(body.stats.plannerEvents, 1);
  assert.equal(body.stats.plannerRevision, 1);
  assert.equal(body.stats.samples, 1);
  assert.equal(body.stats.campusConnected, false);
});
