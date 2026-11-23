// 本地冒烟：用内存数据库模拟 Sites 注入的 db client，验证云端 Function 的主要路由。
// 运行：node --test tools/function-smoke.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { application } from '../functions/routes.mjs';

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
        return { data: this.columns === 'key' ? [{ key: this.payload.key }] : [{ ...this.payload }], error: null };
      }
      if (this.op === 'insertIfAbsent') {
        const key = this.options?.onConflict ?? 'key';
        if (rows.some((row) => row[key] === this.payload[key])) return { data: [], error: null };
        rows.push({ ...this.payload });
        return { data: this.columns === 'key' ? [{ key: this.payload.key }] : [{ ...this.payload }], error: null };
      }
      if (this.op === 'update') {
        const changed = rows.filter((row) => matches(row, this.filters));
        for (const row of changed) Object.assign(row, this.payload);
        return { data: changed.length ? changed.map((row) => ({ key: row.key })) : [], error: null };
      }
      if (this.op === 'delete') {
        const kept = rows.filter((row) => !matches(row, this.filters));
        tables.set(this.name, kept);
        return { data: [], error: null };
      }
      throw new Error(`unsupported operation ${this.op}`);
    }
  }

  return { from: (name) => new Query(name) };
}

function call(handle, path, { method = 'GET', token, body, origin } = {}) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (origin) headers.set('origin', origin);
  let payload;
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
    payload = JSON.stringify(body);
  }
  const request = new Request(`https://site.example/functions/v1/app${path}`, { method, headers, body: payload });
  return handle({ request });
}

const ledger = {
  version: 1,
  records: [{ id: 'r1', type: 'expense', date: '2026-11-22', title: '午饭', amountCents: 1850, category: '吃饭' }],
  workplaces: [],
  settings: { hourlyRateCents: 3000 },
};

test('云端后端主要路由', async () => {
  const handle = application({ db: createFakeDb() });

  const health = await call(handle, '/api/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  const denied = await call(handle, '/api/ledger');
  assert.equal(denied.status, 401);

  const registration = await call(handle, '/api/register', { method: 'POST', body: { username: 'tester', password: 'test-password' } });
  assert.equal(registration.status, 200);
  const session = await registration.json();
  assert.equal(session.ok, true);
  assert.equal(typeof session.token, 'string');
  assert.equal(session.user.username, 'tester');

  const me = await (await call(handle, '/api/me', { token: session.token })).json();
  assert.equal(me.user.username, 'tester');

  const wrong = await call(handle, '/api/login', { method: 'POST', body: { username: 'tester', password: 'wrong-password' } });
  assert.equal(wrong.status, 401);

  const planner = await call(handle, '/api/planner', { token: session.token });
  assert.equal(planner.status, 200);
  const doc = await planner.json();
  assert.equal(doc.revision, 0);
  assert.equal(typeof doc.serverId, 'string');

  const event = {
    id: 'e1', title: '英语', kind: 'event', location: '', start: 1763800000000, end: 1763803600000,
    allDay: false, timeZone: 'Asia/Shanghai', source: 'manual', sourceId: '',
  };
  const op = await call(handle, '/api/planner/operations', {
    method: 'POST', token: session.token,
    body: { operationId: 'op-1', baseRevision: 0, command: { kind: 'put', collection: 'events', value: event } },
  });
  assert.equal(op.status, 200);
  const applied = await op.json();
  assert.equal(applied.revision, 1);
  assert.equal(applied.appliedRevision, 1);

  const replay = await call(handle, '/api/planner/operations', {
    method: 'POST', token: session.token,
    body: { operationId: 'op-1', baseRevision: 0, command: { kind: 'put', collection: 'events', value: event } },
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).appliedRevision, 1);

  const conflict = await call(handle, '/api/planner/operations', {
    method: 'POST', token: session.token,
    body: { operationId: 'op-2', baseRevision: 0, command: { kind: 'delete', collection: 'events', id: 'e1' } },
  });
  assert.equal(conflict.status, 409);

  const after = await (await call(handle, '/api/planner', { token: session.token })).json();
  assert.equal(after.state.events.length, 1);

  const putLedger = await call(handle, '/api/ledger', { method: 'PUT', token: session.token, body: { ledger } });
  assert.equal(putLedger.status, 200);
  const updatedAt = (await putLedger.json()).updatedAt;

  const readLedger = await (await call(handle, '/api/ledger', { token: session.token })).json();
  assert.equal(readLedger.ledger.records.length, 1);
  assert.equal(readLedger.updatedAt, updatedAt);

  const stale = await call(handle, '/api/ledger', { method: 'PUT', token: session.token, body: { ledger, baseUpdatedAt: '2000-01-01T00:00:00.000Z' } });
  assert.equal(stale.status, 409);

  const calendar = await (await call(handle, '/api/calendar', { token: session.token })).json();
  assert.deepEqual(calendar.sources, []);

  const snapshot = await call(handle, '/api/calendar/snapshot', {
    method: 'PUT', token: session.token,
    body: {
      sourceId: 'phone', requestId: 'req-1', baseRevision: 0, rangeStart: 1763740800000, rangeEnd: 1764345600000,
      fetchedAt: 1763800000000, calendarAvailable: true, complete: false, events: [],
    },
  });
  assert.equal(snapshot.status, 200);
  assert.equal((await snapshot.json()).revision, 1);

  const samples = await call(handle, '/api/samples', {
    method: 'POST', token: session.token, body: { samples: [{ id: 's1', amount: 12.5 }] },
  });
  assert.equal(samples.status, 200);
  assert.equal((await samples.json()).added, 1);
  const readSamples = await (await call(handle, '/api/samples', { token: session.token })).json();
  assert.equal(readSamples.samples.length, 1);

  const assistant = await call(handle, '/api/assistant/settings', { token: session.token });
  assert.equal(assistant.status, 200);
  assert.equal((await assistant.json()).privacyMode, 'redact');

  const campus = await (await call(handle, '/api/campus/status', { token: session.token })).json();
  assert.equal(campus.connected, false);

  const logout = await call(handle, '/api/logout', { method: 'POST', token: session.token });
  assert.equal(logout.status, 200);
  const afterLogout = await call(handle, '/api/planner', { token: session.token });
  assert.equal(afterLogout.status, 401);
});
test('云端校园授权与操作代理', async () => {
  const calls = [];
  let tokenPolls = 0;
  let requestedScope = '';
  const upstream = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : null });
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/auth/device-authorization/cancel')) return Response.json({ code: 0, msg: 'ok' });
    if (path.endsWith('/auth/device-authorization')) {
      requestedScope = JSON.parse(init.body).scope;
      tokenPolls = 0;
      return Response.json({
        device_code: 'device-code-1', user_code: 'USERCODE',
        verification_uri: 'https://neo.hduhelp.com/account/tokens/authorize',
        verification_uri_complete: 'https://neo.hduhelp.com/account/tokens/authorize?user_code=USERCODE',
        expires_in: 600, interval: 5, scope: requestedScope,
      });
    }
    if (path.endsWith('/authen/access-token')) {
      tokenPolls += 1;
      if (tokenPolls === 1) return Response.json({ error: 'authorization_pending', error_description: 'pending' }, { status: 400 });
      return Response.json({ access_token: 'pat-test', scope: requestedScope, expires_in: 3600 });
    }
    if (path.endsWith('/cli/tokens/current')) return Response.json({ code: 0, msg: 'ok' });
    if (path.endsWith('/academic/config')) return Response.json({ data: { terms: [] }, code: 0, msg: 'success' });
    if (path.endsWith('/academic/grade')) return Response.json({ data: { gpa: 3.8 }, code: 0, msg: 'success' });
    if (path.endsWith('/campuslife/electric/binding')) return Response.json({ code: 0, msg: 'success', data: { room_id: 93784 } });
    return Response.json({ code: 404, msg: 'mock_not_found' }, { status: 404 });
  };
  const db = createFakeDb();
  const handle = application({ db, fetch: upstream });

  const login = await (await call(handle, '/api/register', { method: 'POST', body: { username: 'campus-tester', password: 'test-password' } })).json();
  const token = login.token;

  const initial = await (await call(handle, '/api/campus/status', { token })).json();
  assert.equal(initial.connected, false);

  const beforeAuth = await (await call(handle, '/api/campus/run', {
    method: 'POST', token, body: { operationId: 'AcademicService_StudentGrade', query: {} },
  })).json();
  assert.equal(beforeAuth.error, 'campus_not_connected');

  const started = await (await call(handle, '/api/campus/auth/start', {
    method: 'POST', token, body: { scopes: ['identity:userprofile:read'] },
  })).json();
  assert.equal(started.ok, true);
  assert.equal(started.userCode, 'USERCODE');

  const pending = await (await call(handle, '/api/campus/auth/poll', { method: 'POST', token, body: {} })).json();
  assert.equal(pending.status, 'pending');
  const connected = await (await call(handle, '/api/campus/auth/poll', { method: 'POST', token, body: {} })).json();
  assert.equal(connected.status, 'connected');
  assert.equal(connected.connected, true);
  assert.deepEqual(connected.scopes, ['identity:userprofile:read']);

  const missing = await (await call(handle, '/api/campus/run', {
    method: 'POST', token, body: { operationId: 'AcademicService_StudentGrade', query: {} },
  })).json();
  assert.equal(missing.error, 'missing_scope');
  assert.deepEqual(missing.missingScopes, ['academic:grade:read']);

  await call(handle, '/api/campus/auth/start', { method: 'POST', token, body: { scopes: ['academic:grade:read'] } });
  await call(handle, '/api/campus/auth/poll', { method: 'POST', token, body: {} });
  const reconnected = await (await call(handle, '/api/campus/auth/poll', { method: 'POST', token, body: {} })).json();
  assert.equal(reconnected.status, 'connected');
  assert.ok(reconnected.scopes.includes('academic:grade:read'));

  const grade = await (await call(handle, '/api/campus/run', {
    method: 'POST', token, body: { operationId: 'AcademicService_StudentGrade', query: { schoolYear: '2025-2026' } },
  })).json();
  assert.equal(grade.ok, true);
  assert.equal(grade.data.gpa, 3.8);

  await call(handle, '/api/campus/auth/start', { method: 'POST', token, body: { scopes: ['campuslife:electricity:write'] } });
  await call(handle, '/api/campus/auth/poll', { method: 'POST', token, body: {} });
  await call(handle, '/api/campus/auth/poll', { method: 'POST', token, body: {} });

  const writeWithoutConfirm = await (await call(handle, '/api/campus/run', {
    method: 'POST', token, body: { operationId: 'CampusLifeService_BindRoom', body: { room_id: 93784 } },
  })).json();
  assert.equal(writeWithoutConfirm.error, 'confirmation_required');

  const write = await (await call(handle, '/api/campus/run', {
    method: 'POST', token,
    body: { operationId: 'CampusLifeService_BindRoom', body: { room_id: 93784 }, confirm: true, idempotencyKey: 'bind-room-1' },
  })).json();
  assert.equal(write.ok, true);
  const bindingCall = calls.at(-1);
  assert.equal(bindingCall.init.method, 'PUT');
  assert.equal(bindingCall.init.headers.authorization, 'Bearer pat-test');
  assert.equal(bindingCall.init.headers['idempotency-key'], 'bind-room-1');

  const publicCatalog = await (await call(handle, '/api/campus/catalog', { token })).json();
  assert.equal(publicCatalog.operations.length, 199);
  assert.equal(publicCatalog.scopes.length, 74);

  const logout = await (await call(handle, '/api/campus/auth/logout', { method: 'POST', token, body: {} })).json();
  assert.equal(logout.status, 'logged_out');
  assert.equal(logout.connected, false);

  const publicRun = await (await call(handle, '/api/campus/run', {
    method: 'POST', token, body: { operationId: 'AcademicService_AcademicConfig' },
  })).json();
  assert.equal(publicRun.ok, true);
  assert.deepEqual(publicRun.data.terms, []);
});


test('账号注册、旧数据迁移与账号隔离', async () => {
  const db = createFakeDb();
  const legacyLedger = { ...ledger, records: [{ ...ledger.records[0], id: 'legacy-1', title: '旧账' }] };
  await db.from('shunshou_docs').insert({
    key: 'cloud:ledger', value: { ledger: legacyLedger, updatedAt: '2026-01-01T00:00:00.000Z' },
    revision: 0, updated_at: '2026-01-01T00:00:00.000Z',
  });
  await db.from('shunshou_docs').insert({
    key: 'cloud:planner', value: { state: { version: 1, events: [], courseRules: [], focusSessions: [], countdowns: [], trips: [], serviceEntries: [], preferences: { focusMinutes: 25 }, reminderReceipts: [] }, serverId: 'legacy-server', entityVersions: {}, receipts: [] },
    revision: 5, updated_at: '2026-01-01T00:00:00.000Z',
  });
  const handle = application({ db });

  const first = await (await call(handle, '/api/register', { method: 'POST', body: { username: '甲同学', password: 'password-a' } })).json();
  assert.equal(first.legacyMigrated, true);
  const tokenA = first.token;
  const ledgerA = await (await call(handle, '/api/ledger', { token: tokenA })).json();
  assert.equal(ledgerA.ledger.records[0].title, '旧账');
  const plannerA = await (await call(handle, '/api/planner', { token: tokenA })).json();
  assert.equal(plannerA.serverId, 'legacy-server');
  assert.equal(plannerA.revision, 5);

  const duplicate = await call(handle, '/api/register', { method: 'POST', body: { username: '甲同学', password: 'password-a' } });
  assert.equal(duplicate.status, 409);

  const second = await (await call(handle, '/api/register', { method: 'POST', body: { username: '乙同学', password: 'password-b' } })).json();
  assert.equal(second.legacyMigrated, false);
  const tokenB = second.token;
  const ledgerB = await (await call(handle, '/api/ledger', { token: tokenB })).json();
  assert.equal(ledgerB.ledger, null);
  const plannerB = await (await call(handle, '/api/planner', { token: tokenB })).json();
  assert.notEqual(plannerB.serverId, plannerA.serverId);

  const ownLedger = { ...ledger, records: [{ ...ledger.records[0], id: 'b-1', title: '乙的账' }] };
  await call(handle, '/api/ledger', { method: 'PUT', token: tokenB, body: { ledger: ownLedger } });
  const ledgerAAfter = await (await call(handle, '/api/ledger', { token: tokenA })).json();
  assert.equal(ledgerAAfter.ledger.records[0].title, '旧账');
  const ledgerBAfter = await (await call(handle, '/api/ledger', { token: tokenB })).json();
  assert.equal(ledgerBAfter.ledger.records[0].title, '乙的账');

  const meA = await (await call(handle, '/api/me', { token: tokenA })).json();
  const meB = await (await call(handle, '/api/me', { token: tokenB })).json();
  assert.equal(meA.user.username, '甲同学');
  assert.equal(meB.user.username, '乙同学');
  assert.notEqual(meA.user.id, meB.user.id);
});

test('改密、会话管理与注销账号', async () => {
  const db = createFakeDb();
  const handle = application({ db });
  const first = await (await call(handle, '/api/register', { method: 'POST', body: { username: 'account-owner', password: 'password-a' } })).json();
  const token = first.token;
  const second = await (await call(handle, '/api/login', { method: 'POST', body: { username: 'account-owner', password: 'password-a' } })).json();

  const summary = await (await call(handle, '/api/account', { token })).json();
  assert.equal(summary.user.username, 'account-owner');
  assert.equal(summary.stats.sessions, 2);
  const sessions = await (await call(handle, '/api/account/sessions', { token })).json();
  assert.equal(sessions.sessions.length, 2);
  assert.equal(sessions.sessions.filter((item) => item.current).length, 1);

  const wrongOld = await call(handle, '/api/account/password', { method: 'POST', token, body: { currentPassword: 'nope-nope', newPassword: 'password-b' } });
  assert.equal(wrongOld.status, 401);

  const changed = await call(handle, '/api/account/password', { method: 'POST', token, body: { currentPassword: 'password-a', newPassword: 'password-b' } });
  assert.equal(changed.status, 200);
  const changedBody = await changed.json();
  assert.equal(changedBody.revokedSessions, 1);
  const oldLogin = await call(handle, '/api/login', { method: 'POST', body: { username: 'account-owner', password: 'password-a' } });
  assert.equal(oldLogin.status, 401);
  const newLogin = await call(handle, '/api/login', { method: 'POST', body: { username: 'account-owner', password: 'password-b' } });
  assert.equal(newLogin.status, 200);
  const secondToken = (await newLogin.json()).token;

  const revokeOther = await call(handle, `/api/account/sessions/${second.sessionId ?? 'missing'}`, { method: 'DELETE', token: secondToken });
  assert.ok(revokeOther.status === 200 || revokeOther.status === 404);

  await call(handle, '/api/ledger', { method: 'PUT', token: secondToken, body: { ledger } });
  const logoutAll = await call(handle, '/api/account/logout-all', { method: 'POST', token: secondToken });
  assert.equal(logoutAll.status, 200);
  assert.equal((await call(handle, '/api/ledger', { token: secondToken })).status, 401);

  const relogin = (await (await call(handle, '/api/login', { method: 'POST', body: { username: 'account-owner', password: 'password-b' } })).json()).token;
  const noConfirm = await call(handle, '/api/account/delete', { method: 'POST', token: relogin, body: { password: 'password-b' } });
  assert.equal(noConfirm.status, 400);
  const deleted = await call(handle, '/api/account/delete', { method: 'POST', token: relogin, body: { password: 'password-b', confirmation: 'delete-account' } });
  assert.equal(deleted.status, 200);
  assert.equal((await call(handle, '/api/login', { method: 'POST', body: { username: 'account-owner', password: 'password-b' } })).status, 401);
});
