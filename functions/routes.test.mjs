// 助手路由单测：/api/assistant/* 已从「无条件 503 占位」换成真实路由，
// 这里验证三件事——未登录不再拿到 200 假数据、AssistantError 能映射成正确状态码、
// 同一用户的助手实例跨请求复用（否则 briefCache 的 10 分钟 TTL 全部失效）。
// 直接运行：node --test functions/routes.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { application } from './routes.mjs';

// 内存数据库：语义与 functions/lib.mjs 的 createDocs 对齐——
// select/eq/limit 返回行数组，insertIfAbsent 带 onConflict，
// update+eq(revision) 命中时返回恰好 1 行（createDocs.replace 靠这个判冲突）。
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
    }
    select() { if (!this.op) this.op = 'select'; return this; }
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

  return { from: (name) => new Query(name), rows: (name) => table(name) };
}

// readEnv 在本地 Node 下回落到 process.env；清掉这些键，测试才不会被机器上的
// 真实 ASSISTANT_* 环境变量影响（否则「没有配置模型」这一类断言会随机失败）。
const ENV_KEYS = ['ASSISTANT_BASE_URL', 'ASSISTANT_MODEL', 'ASSISTANT_API_KEY'];
const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
for (const key of ENV_KEYS) delete process.env[key];
after(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function call(handle, path, { method = 'GET', token, body } = {}) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return handle({
    request: new Request(`https://site.example/functions/v1/app${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }),
  });
}

async function register(handle, username = 'assistant-tester') {
  const response = await call(handle, '/api/register', {
    method: 'POST', body: { username, password: 'password-1' },
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('未登录请求 /api/assistant/settings 返回 401，不再返回 200 假数据', async () => {
  const handle = application({ db: createFakeDb() });
  const response = await call(handle, '/api/assistant/settings');
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'unauthorized');
});

test('登录后 settings 只给站点托管信息，不回传 Key', async () => {
  // 显式传空 env：本机存在 assistant-secrets.local.mjs 时不能靠默认值断言「未配置」。
  const handle = application({ db: createFakeDb(), env: { get: () => '' } });
  const { token } = await register(handle);
  const response = await call(handle, '/api/assistant/settings', { token });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.managedBy, 'site');
  assert.equal(body.baseUrl, '');
  assert.equal(body.model, '');
  assert.equal(body.hasApiKey, false);
  assert.equal(body.privacyMode, 'redact');
  assert.equal(body.updatedAt, null);
  // 字段面就是这 7 个：没有 apiKey，也没有任何能把 Key 带出来的字段。
  assert.deepEqual(Object.keys(body).sort(),
    ['baseUrl', 'hasApiKey', 'managedBy', 'model', 'ok', 'privacyMode', 'updatedAt']);
});

test('settings 只允许改 privacyMode，其它字段返回 400 settings_readonly', async () => {
  const handle = application({ db: createFakeDb() });
  const { token } = await register(handle);

  const readonly = await call(handle, '/api/assistant/settings', {
    method: 'PUT', token, body: { model: 'gpt-other', baseUrl: 'https://evil.test/v1' },
  });
  assert.equal(readonly.status, 400);
  const readonlyBody = await readonly.json();
  assert.equal(readonlyBody.ok, false);
  assert.equal(readonlyBody.error, 'settings_readonly');

  const updated = await call(handle, '/api/assistant/settings', { method: 'PUT', token, body: { privacyMode: 'off' } });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).privacyMode, 'off');

  const reread = await call(handle, '/api/assistant/settings', { token });
  assert.equal((await reread.json()).privacyMode, 'off');
});

test('站点没有配置模型时 chat 返回 503 assistant_not_configured', async () => {
  const handle = application({ db: createFakeDb(), env: { get: () => '' } });
  const { token } = await register(handle);
  const response = await call(handle, '/api/assistant/chat', {
    method: 'POST', token, body: { messages: [{ role: 'user', content: '今天有什么' }] },
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'assistant_not_configured');
});

test('没有模型时 briefing 仍返回规则版，且同一用户的助手实例跨请求复用', async () => {
  const handle = application({ db: createFakeDb() });
  const { token } = await register(handle);

  const first = await call(handle, '/api/assistant/briefing?scope=day', { token });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.scope, 'day');
  assert.equal(firstBody.degraded, true);
  assert.equal(firstBody.model, null);
  assert.ok(firstBody.narrative.length > 5);
  assert.equal(typeof firstBody.generatedAt, 'string');

  // 每请求新建 assistant 会让 briefCache 失效，generatedAt 就会变成新的时间戳。
  await new Promise((resolve) => { setTimeout(resolve, 5); });
  const second = await call(handle, '/api/assistant/briefing?scope=day', { token });
  const secondBody = await second.json();
  assert.equal(secondBody.generatedAt, firstBody.generatedAt);

  // fresh=1 必须绕过缓存重新生成。
  await new Promise((resolve) => { setTimeout(resolve, 5); });
  const fresh = await call(handle, '/api/assistant/briefing?scope=day&fresh=1', { token });
  assert.notEqual((await fresh.json()).generatedAt, firstBody.generatedAt);
});

test('未识别的助手接口返回 404，方法不对返回 405', async () => {
  const handle = application({ db: createFakeDb() });
  const { token } = await register(handle);

  const missing = await call(handle, '/api/assistant/nope', { token });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'not_found');

  const wrongMethod = await call(handle, '/api/assistant/settings', { method: 'DELETE', token });
  assert.equal(wrongMethod.status, 405);
  assert.equal((await wrongMethod.json()).error, 'method_not_allowed');
});
