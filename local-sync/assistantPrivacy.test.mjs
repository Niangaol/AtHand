import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAssistant } from './assistant.mjs';

function tempAssistant(tools = [], callTool = async () => ({ ok: true, result: {} })) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-privacy-'));
  return { directory, assistant: createAssistant({ directory, getTools: () => tools, callTool }) };
}

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('cloud models receive tokens, tool arguments are restored, and the reply is rehydrated', async (t) => {
  const calls = [];
  const requests = [];
  const tool = { name: 'demo', description: 'demo', input: { type: 'object', properties: {} } };
  const { assistant } = tempAssistant([tool], async ({ args }) => {
    calls.push(args);
    return { ok: true, result: { title: '高等数学', phone: '13800138000' } };
  });
  await assistant.updateSettings({ baseUrl: 'https://cloud.example/v1', model: 'cloud-model', privacyMode: 'redact' });

  const restore = stubFetch(async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (requests.length === 1) {
      const user = body.messages.at(-1).content;
      const phone = user.match(/\[\[PHONE:[0-9a-f]{10}\]\]/)?.[0];
      const course = user.match(/\[\[COURSE:[0-9a-f]{10}\]\]/)?.[0];
      assert.ok(phone && course, 'user message must be tokenized');
      assert.equal(user.includes('13800138000'), false);
      assert.equal(user.includes('高等数学'), false);
      return json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'demo', arguments: JSON.stringify({ phone, course }) } }] } }] });
    }
    return json({ choices: [{ message: { role: 'assistant', content: `已记下 ${requests[0].messages.at(-1).content.match(/\[\[PHONE:[0-9a-f]{10}\]\]/)[0]}` } }] });
  });
  t.after(restore);

  const result = await assistant.chat([{ role: 'user', content: '记一下手机 13800138000，课程：高等数学' }]);

  assert.deepEqual(calls, [{ phone: '13800138000', course: '高等数学' }]);
  assert.equal(JSON.stringify(requests[1]).includes('13800138000'), false);
  assert.equal(JSON.stringify(requests[1]).includes('高等数学'), false);
  assert.equal(result.reply, '已记下 13800138000');
});

test('local-only refuses a cloud model before any provider request', async (t) => {
  let fetched = false;
  const restore = stubFetch(async () => { fetched = true; return json({}); });
  t.after(restore);
  const { assistant } = tempAssistant();
  await assistant.updateSettings({ baseUrl: 'https://cloud.example/v1', model: 'cloud-model', privacyMode: 'local-only' });

  await assert.rejects(
    assistant.chat([{ role: 'user', content: '今天有什么安排？' }]),
    (error) => error.code === 'privacy_local_only',
  );
  assert.equal(fetched, false);
});

test('a loopback model reads raw data even in redact mode', async (t) => {
  const requests = [];
  const restore = stubFetch(async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return json({ choices: [{ message: { role: 'assistant', content: '收到 13800138000' } }] });
  });
  t.after(restore);
  const { assistant } = tempAssistant();
  await assistant.updateSettings({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-model', privacyMode: 'redact' });

  const result = await assistant.chat([{ role: 'user', content: '我的手机是 13800138000' }]);

  assert.equal(requests[0].messages.at(-1).content.includes('13800138000'), true);
  assert.equal(result.reply, '收到 13800138000');
});

test('privacy settings round-trip with redact as the default', async () => {
  const { assistant } = tempAssistant();
  const initial = assistant.publicSettings();
  assert.equal(initial.privacyMode, 'redact');
  const saved = assistant.updateSettings({ privacyMode: 'off' });
  assert.equal(saved.privacyMode, 'off');
  assert.equal(assistant.publicSettings().privacyMode, 'off');
});
