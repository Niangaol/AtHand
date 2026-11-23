import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentApi } from './agentApi.mjs';

function memoryDocs() {
  const store = new Map();
  return {
    async get(name) {
      const value = store.get(name);
      return value ? { name, value: value.value, revision: value.revision } : null;
    },
    async ensure(name, makeValue) {
      if (!store.has(name)) store.set(name, { value: makeValue(), revision: 0 });
      const value = store.get(name);
      return { name, value: value.value, revision: value.revision };
    },
    async replace(doc, next) {
      const current = store.get(doc.name);
      if (current && current.revision !== doc.revision) throw Object.assign(new Error('conflict'), { code: 'conflict' });
      const revision = doc.revision + 1;
      store.set(doc.name, { value: next, revision });
      return revision;
    },
  };
}

test('manifest lists read and write tools', async () => {
  const api = createAgentApi({ docs: memoryDocs(), userId: 'u1' });
  const { tools } = await api.manifest({ scope: 'write' });
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes('day_overview'));
  assert.ok(names.includes('ledger_add_expense'));
  assert.ok(names.includes('schedule_create'));
  for (const tool of tools) assert.equal(typeof tool.input, 'object');
});

test('read scope excludes write tools', async () => {
  const api = createAgentApi({ docs: memoryDocs(), userId: 'u1' });
  const { tools } = await api.manifest({ scope: 'read' });
  assert.equal(tools.some((tool) => tool.name === 'ledger_add_expense'), false);
});

test('ledger_add_expense writes once for a repeated requestId', async () => {
  const api = createAgentApi({ docs: memoryDocs(), userId: 'u1' });
  const args = { title: '午饭', amountYuan: 18.5, category: '吃饭', date: '2026-11-23' };
  await api.call({ tool: 'ledger_add_expense', arguments: args, requestId: 'req-1' });
  await api.call({ tool: 'ledger_add_expense', arguments: args, requestId: 'req-1' });
  const records = await api.call({ tool: 'ledger_records', arguments: { from: '2026-11-23', to: '2026-11-23' }, requestId: 'req-2' });
  assert.equal(records.result.total, 1);
});

test('day_overview returns today facts', async () => {
  const api = createAgentApi({ docs: memoryDocs(), userId: 'u1' });
  const out = await api.call({ tool: 'day_overview', arguments: {}, requestId: 'req-3' });
  assert.equal(typeof out.result.date, 'string');
});

test('unknown tool raises a 404 AgentError', async () => {
  const api = createAgentApi({ docs: memoryDocs(), userId: 'u1' });
  await assert.rejects(
    () => api.call({ tool: 'nope', arguments: {}, requestId: 'req-4' }),
    (error) => error.code === 'unknown_tool' && error.status === 404,
  );
});
