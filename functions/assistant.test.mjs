import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssistant } from './assistant.mjs';
import { createPlannerState, eventSchema } from './vendor/domain.mjs';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const shanghaiDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

// 与 functions/lib.mjs 的 createDocs 同签名：ensure(name, makeValue)、replace(doc, value)。
function memoryDocs() {
  const store = new Map();
  return {
    async get(name) { const v = store.get(name); return v ? { name, value: v.value, revision: v.revision } : null; },
    async ensure(name, make) { if (!store.has(name)) store.set(name, { value: make(), revision: 0 }); const v = store.get(name); return { name, value: v.value, revision: v.revision }; },
    async replace(doc, next) {
      const current = store.get(doc.name);
      if (current && current.revision !== doc.revision) throw Object.assign(new Error('conflict'), { code: 'conflict' });
      const revision = doc.revision + 1;
      store.set(doc.name, { value: next, revision });
      return revision;
    },
    _store: store,
  };
}

const env = (extra = {}) => ({ get: (key) => extra[key] });

// 所有出网调用必须走这个注入的 transport；calls 里留档，便于断言发往模型的内容。
function fakeFetch(responses) {
  const calls = [];
  const transport = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  transport.calls = calls;
  return transport;
}

const configured = { ASSISTANT_BASE_URL: 'https://api.test/v1', ASSISTANT_MODEL: 'm1', ASSISTANT_API_KEY: 'k' };

test('settings come from env and never expose the key', async () => {
  const assistant = createAssistant({
    docs: memoryDocs(), userId: 'u1',
    env: env({ ASSISTANT_BASE_URL: 'https://api.test/v1', ASSISTANT_MODEL: 'm1', ASSISTANT_API_KEY: 'sk-secret' }),
    fetch: fakeFetch([{ body: {} }]),
  });
  const settings = await assistant.readSettings();
  assert.equal(settings.baseUrl, 'https://api.test/v1');
  assert.equal(settings.model, 'm1');
  assert.equal(settings.hasApiKey, true);
  assert.equal(settings.managedBy, 'site');
  assert.equal(settings.privacyMode, 'redact');
  assert.equal(settings.updatedAt, null);
  assert.equal(JSON.stringify(settings).includes('sk-secret'), false);
});

test('writeSettings only accepts privacyMode and stores it without a user prefix', async () => {
  const docs = memoryDocs();
  const assistant = createAssistant({ docs, userId: 'u1', env: env(configured), fetch: fakeFetch([{ body: {} }]) });
  await assert.rejects(
    () => assistant.writeSettings({ model: 'other' }),
    (error) => error.status === 400 && error.code === 'settings_readonly',
  );
  await assert.rejects(
    () => assistant.writeSettings({ privacyMode: 'off', baseUrl: 'https://evil.test/v1' }),
    (error) => error.code === 'settings_readonly',
  );
  const saved = await assistant.writeSettings({ privacyMode: 'off' });
  assert.equal(saved.privacyMode, 'off');
  assert.equal(typeof saved.updatedAt, 'string');
  assert.equal(saved.managedBy, 'site');
  // createDocs 已按 owner 加前缀；文档名写 `u1:assistant` 会变成 `u1:u1:assistant`。
  assert.ok(docs._store.has('assistant'));
  assert.equal(docs._store.has('u1:assistant'), false);
  assert.equal((await assistant.readSettings()).privacyMode, 'off');
});

test('missing key makes chat fail with assistant_not_configured', async () => {
  const assistant = createAssistant({ docs: memoryDocs(), userId: 'u1', env: env({}), fetch: fakeFetch([{ body: {} }]) });
  await assert.rejects(
    () => assistant.chat([{ role: 'user', content: '你好' }]),
    (error) => error.code === 'assistant_not_configured' && error.status === 503,
  );
});

test('local-only privacy refuses a remote model', async () => {
  const assistant = createAssistant({ docs: memoryDocs(), userId: 'u1', env: env(configured), fetch: fakeFetch([{ body: {} }]) });
  await assistant.writeSettings({ privacyMode: 'local-only' });
  await assert.rejects(
    () => assistant.chat([{ role: 'user', content: '你好' }]),
    (error) => error.status === 409 && error.code === 'privacy_local_only',
  );
});

test('chat executes tool calls and records trace', async () => {
  const transport = fakeFetch([
    { body: { choices: [{ message: { content: '', tool_calls: [{ id: 'call_1', function: { name: 'day_overview', arguments: '{}' } }] } }] } },
    { body: { choices: [{ message: { content: '今天有 0 项安排。' } }] } },
  ]);
  const assistant = createAssistant({ docs: memoryDocs(), userId: 'u1', env: env(configured), fetch: transport });
  const out = await assistant.chat([{ role: 'user', content: '今天有什么' }]);
  assert.equal(out.reply, '今天有 0 项安排。');
  assert.equal(out.trace.length, 1);
  assert.equal(out.trace[0].tool, 'day_overview');
  assert.equal(out.trace[0].ok, true);

  // 出网只走注入的 transport，且工具定义直接是 manifest 给的 JSON Schema。
  assert.equal(transport.calls.length, 2);
  assert.equal(transport.calls[0].url, 'https://api.test/v1/chat/completions');
  assert.equal(transport.calls[0].init.headers.Authorization, 'Bearer k');
  const body = JSON.parse(transport.calls[0].init.body);
  assert.equal(body.tools.length, 36);
  assert.equal(body.tools.every((tool) => tool.type === 'function' && tool.function.parameters?.type === 'object'), true);
  assert.equal(body.messages[0].role, 'system');
  // 云端运行时时区可能是 UTC，提示词里的「现在」必须按用户时区给出。
  assert.match(body.messages[0].content, /UTC\+08:00/);
  assert.equal(body.messages[1].content, '今天有什么');
  // 第二轮的 tool 消息必须带 tool_call_id，模型才能对上。
  assert.equal(JSON.parse(transport.calls[1].init.body).messages.at(-1).tool_call_id, 'call_1');
});

test('chat redacts personal data before it leaves the server', async () => {
  const transport = fakeFetch([{ body: { choices: [{ message: { content: '收到。' } }] } }]);
  const assistant = createAssistant({ docs: memoryDocs(), userId: 'u1', env: env(configured), fetch: transport });
  await assistant.chat([{ role: 'user', content: '联系人：张三，手机 13800138000' }]);
  const body = JSON.parse(transport.calls[0].init.body);
  assert.equal(JSON.stringify(body.messages).includes('13800138000'), false);
  assert.equal(JSON.stringify(body.messages).includes('张三'), false);
  assert.match(body.messages[1].content, /\[\[PHONE:[0-9a-f]{10}\]\]/);
});

test('briefing degrades to template when model fails', async () => {
  const assistant = createAssistant({ docs: memoryDocs(), userId: 'u1', env: env(configured), fetch: fakeFetch([{ status: 500, body: {} }]) });
  const out = await assistant.briefing({ scope: 'day' });
  assert.equal(out.degraded, true);
  assert.ok(out.narrative.length > 5);
  assert.equal(out.scope, 'day');
  assert.equal(typeof out.date, 'string');
  assert.equal(typeof out.warning, 'string');
  assert.equal(out.model, null);
});

test('briefing degrades instead of failing when the site has no model', async () => {
  const assistant = createAssistant({ docs: memoryDocs(), userId: 'u1', env: env({}), fetch: fakeFetch([{ body: {} }]) });
  const out = await assistant.briefing({ scope: 'week' });
  assert.equal(out.degraded, true);
  assert.equal(out.scope, 'week');
  assert.ok(out.narrative.length > 5);
  assert.match(out.warning, /配置模型/);
});

test('briefing projects clock times in the user time zone', async () => {
  const docs = memoryDocs();
  const today = shanghaiDate();
  const event = eventSchema.parse({
    id: 'evt-test', title: '复习', kind: 'event', location: '',
    start: Date.parse(`${today}T15:00:00+08:00`), end: Date.parse(`${today}T16:00:00+08:00`),
    allDay: false, timeZone: 'Asia/Shanghai', source: 'manual', sourceId: '',
  });
  const state = createPlannerState();
  docs._store.set('planner', {
    value: { state: { ...state, events: [...state.events, event] }, serverId: crypto.randomUUID(), entityVersions: {}, receipts: [] },
    revision: 0,
  });

  const transport = fakeFetch([{ body: { choices: [{ message: { content: '下午三点复习一小时。' } }] } }]);
  const assistant = createAssistant({ docs, userId: 'u1', env: env(configured), fetch: transport });
  const out = await assistant.briefing({ scope: 'day' });
  assert.equal(out.degraded, false);
  assert.equal(out.model, 'm1');
  const prompt = JSON.parse(transport.calls[0].init.body).messages[0].content;
  assert.match(prompt, /"startClock":"15:00"/);
  assert.match(prompt, new RegExp(`"weekday":"${WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()]}"`));
});

test('test() reports model presence', async () => {
  const transport = fakeFetch([{ body: { data: [{ id: 'm1' }, { id: 'm2' }] } }]);
  const assistant = createAssistant({ docs: memoryDocs(), userId: 'u1', env: env(configured), fetch: transport });
  const out = await assistant.test();
  assert.equal(out.ok, true);
  assert.equal(out.modelFound, true);
  assert.deepEqual(out.models, ['m1', 'm2']);
  assert.equal(transport.calls[0].url, 'https://api.test/v1/models');
});
