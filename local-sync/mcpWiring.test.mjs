import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPlannerState } from '../src/domain/planner.ts';
import { createAgentApi } from './agentApi.mjs';
import { createMcpGateway } from './mcpGateway.mjs';

/** 假 MCP 服务：只实现 initialize / initialized / tools/list / tools/call。 */
async function fakeMcpServer({ tools, onCall }) {
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      let message;
      try { message = JSON.parse(raw); } catch { response.writeHead(400); response.end(); return; }
      response.setHeader('Content-Type', 'application/json');
      if (message.method === 'initialize') {
        response.end(JSON.stringify({
          jsonrpc: '2.0', id: message.id,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'fake', version: '1.0.0' } },
        }));
        return;
      }
      if (message.method === 'notifications/initialized') {
        response.writeHead(202);
        response.end();
        return;
      }
      if (message.method === 'tools/list') {
        response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools } }));
        return;
      }
      if (message.method === 'tools/call') {
        const output = onCall(message.params?.name, message.params?.arguments ?? {});
        response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: output }));
        return;
      }
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  return { url, close: () => new Promise((resolve) => server.close(resolve)) };
}

function apiFor(gateway) {
  return createAgentApi({
    readPlanner: () => ({ state: createPlannerState(), revision: 0, serverId: 'test-server' }),
    execute: () => { throw new Error('planner not used in MCP wiring tests'); },
    readCalendars: () => [],
    readLedger: () => null,
    writeLedger: () => { throw new Error('ledger not used in MCP wiring tests'); },
    campus: () => { throw new Error('campus not used in MCP wiring tests'); },
    mcp: () => gateway,
  });
}

test('没有配置生活服务时，manifest 只包含内置工具，不报错', async () => {
  const gateway = createMcpGateway({ configs: [] });
  const api = apiFor(gateway);
  const manifest = await api.manifest({ kind: 'session', name: '测试', scope: 'write' });
  assert.ok(manifest.tools.some((tool) => tool.name === 'day_overview'));
  assert.equal(manifest.tools.some((tool) => tool.name.startsWith('amap_')), false);
  assert.deepEqual(manifest.mcp.errors, []);
});

test('已启用服务会把带前缀的 MCP 工具合并进 manifest，内置工具保持原样', async (t) => {
  const mcp = await fakeMcpServer({
    tools: [
      { name: 'maps_textsearch', description: '关键词搜索地点', inputSchema: { type: 'object', properties: { keywords: { type: 'string' } } } },
      { name: 'maps_weather', description: '查询天气', inputSchema: { type: 'object', properties: {} } },
    ],
    onCall: () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true, city: '杭州' }) }] }),
  });
  t.after(() => mcp.close());
  const gateway = createMcpGateway({ configs: [{ name: 'amap', url: mcp.url, enabled: true }] });
  const api = apiFor(gateway);
  const manifest = await api.manifest({ kind: 'session', name: '测试', scope: 'write' });
  const builtinNames = new Set(['day_overview', 'schedule_list', 'schedule_create', 'services_search']);
  for (const name of builtinNames) assert.ok(manifest.tools.some((tool) => tool.name === name), `缺少内置工具 ${name}`);
  const amapTools = manifest.tools.filter((tool) => tool.name.startsWith('amap_'));
  assert.deepEqual(amapTools.map((tool) => tool.name).sort(), ['amap_maps_textsearch', 'amap_maps_weather']);
  assert.ok(amapTools.every((tool) => tool.scope === 'read'));
});

test('MCP 只读工具会真正调用上游，并把结果返回给助手', async (t) => {
  const calls = [];
  const mcp = await fakeMcpServer({
    tools: [{ name: 'maps_textsearch', description: '搜索地点', inputSchema: { type: 'object', properties: {} } }],
    onCall: (name, args) => {
      calls.push({ name, args });
      return { content: [{ type: 'text', text: JSON.stringify({ spots: ['西湖'] }) }], structuredContent: { spots: ['西湖'] } };
    },
  });
  t.after(() => mcp.close());
  const gateway = createMcpGateway({ configs: [{ name: 'amap', url: mcp.url, enabled: true }] });
  const api = apiFor(gateway);
  const result = await api.call({ tool: 'amap_maps_textsearch', arguments: { keywords: '西湖' }, scope: 'read', actor: 'assistant' });
  assert.equal(calls.length, 1);
  assert.equal(result.revision, null);
  assert.ok(result.result);
});

test('下单类工具第一次只返回待确认，确认后才真正调用上游', async (t) => {
  const calls = [];
  const mcp = await fakeMcpServer({
    tools: [{ name: 'taxi_create_order', description: '创建打车订单', inputSchema: { type: 'object', properties: {} } }],
    onCall: (name, args) => {
      calls.push({ name, args });
      return { content: [{ type: 'text', text: JSON.stringify({ orderId: 'order-1', price: 32 }) }] };
    },
  });
  t.after(() => mcp.close());
  const gateway = createMcpGateway({ configs: [{ name: 'didi', url: mcp.url, enabled: true }] });
  const api = apiFor(gateway);

  const pending = await api.call({ tool: 'didi_taxi_create_order', arguments: { from: '宿舍' }, scope: 'write', actor: 'assistant' });
  assert.equal(calls.length, 0, '未确认时不得调用上游');
  assert.equal(pending.result.needsConfirmation, true);

  const done = await api.call({
    tool: 'didi_taxi_create_order',
    arguments: { from: '宿舍', confirmed: true, requestId: 'confirm-1' },
    scope: 'write', actor: 'assistant',
  });
  assert.equal(calls.length, 1);
  assert.ok(done.result);
});

test('只读令牌不能触发下单类工具', async (t) => {
  const mcp = await fakeMcpServer({
    tools: [{ name: 'taxi_create_order', description: '创建打车订单', inputSchema: { type: 'object', properties: {} } }],
    onCall: () => ({ content: [{ type: 'text', text: '{}' }] }),
  });
  t.after(() => mcp.close());
  const gateway = createMcpGateway({ configs: [{ name: 'didi', url: mcp.url, enabled: true }] });
  const api = apiFor(gateway);
  await assert.rejects(
    () => api.call({ tool: 'didi_taxi_create_order', arguments: {}, scope: 'read', actor: 'assistant' }),
    (error) => error.code === 'scope_read_only',
  );
});

test('支付类工具不调用上游，只返回拒绝说明', async (t) => {
  const calls = [];
  const mcp = await fakeMcpServer({
    tools: [{ name: 'payOrder', description: '支付订单', inputSchema: { type: 'object', properties: {} } }],
    onCall: () => {
      calls.push(1);
      return { content: [{ type: 'text', text: '{}' }] };
    },
  });
  t.after(() => mcp.close());
  const gateway = createMcpGateway({ configs: [{ name: 'luckin', url: mcp.url, enabled: true }] });
  const api = apiFor(gateway);
  const listed = await gateway.listTools({});
  const payTool = listed.tools.find((tool) => tool.risk === 'pay');
  assert.ok(payTool, '支付工具应在清单里，才能被网关拦下');
  const result = await api.call({ tool: payTool.name, arguments: {}, scope: 'write', actor: 'assistant' });
  assert.equal(calls.length, 0, '支付类不得调用上游');
  assert.equal(result.result.ok, false);
  assert.equal(result.result.code, 'mcp_pay_blocked');
});

test('未配置服务的工具调用返回明确降级错误，而不是假装可用', async () => {
  const gateway = createMcpGateway({ configs: [] });
  const api = apiFor(gateway);
  await assert.rejects(
    () => api.call({ tool: 'amap_maps_textsearch', arguments: {}, scope: 'read', actor: 'assistant' }),
    (error) => ['mcp_not_configured', 'mcp_disabled', 'mcp_unreachable'].includes(error.code),
  );
});
