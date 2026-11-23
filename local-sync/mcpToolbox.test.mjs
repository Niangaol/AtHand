import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  buildToolArguments, callReadOnlyTool, describeToolParams, matchToolsByScene, MCP_SCENES,
} from './mcpToolbox.mjs';
import { createMcpGateway } from './mcpGateway.mjs';

async function fakeMcpServer({ tools, onCall }) {
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const message = JSON.parse(raw);
      response.setHeader('Content-Type', 'application/json');
      if (message.method === 'initialize') {
        response.end(JSON.stringify({
          jsonrpc: '2.0', id: message.id,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } },
        }));
        return;
      }
      if (message.method === 'notifications/initialized') { response.writeHead(202); response.end(); return; }
      if (message.method === 'tools/list') {
        response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools } }));
        return;
      }
      if (message.method === 'tools/call') {
        const output = onCall(message.params?.name, message.params?.arguments ?? {});
        response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: output }));
        return;
      }
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'nope' } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const tool = (name, description, schema = { type: 'object', properties: {} }) => ({ name, description, inputSchema: schema });

test('场景匹配按工具名和描述找工具，不依赖固定工具名', () => {
  const tools = [
    tool('airport_flight_status', '查询航班动态'),
    tool('railway_tickets', '火车余票查询'),
    tool('maps_direction_driving', '驾车路线规划'),
    tool('maps_around_search', '周边 POI 搜索'),
    tool('personal_map', '生成专属地图'),
    tool('weather_now', '天气实况'),
  ];
  assert.deepEqual(matchToolsByScene('flight', tools).map((item) => item.name), ['airport_flight_status']);
  assert.deepEqual(matchToolsByScene('train', tools).map((item) => item.name), ['railway_tickets']);
  assert.deepEqual(matchToolsByScene('route', tools).map((item) => item.name), ['maps_direction_driving']);
  assert.deepEqual(matchToolsByScene('nearby', tools).map((item) => item.name), ['maps_around_search']);
  assert.deepEqual(matchToolsByScene('map', tools).map((item) => item.name), ['personal_map']);
  assert.deepEqual(matchToolsByScene('weather', tools).map((item) => item.name), ['weather_now']);
  assert.deepEqual(matchToolsByScene('unknown-scene', tools), []);
});

test('工具参数按 JSON Schema 生成表单字段，并按类型转换', () => {
  const params = describeToolParams(tool('x', 'x', {
    type: 'object',
    required: ['flightNo'],
    properties: {
      flightNo: { type: 'string', description: '航班号' },
      date: { type: 'string' },
      limit: { type: 'integer' },
      includeHistory: { type: 'boolean' },
    },
  }));
  assert.deepEqual(params.map((item) => item.name), ['flightNo', 'date', 'limit', 'includeHistory']);
  assert.equal(params[0].required, true);
  assert.equal(params[2].type, 'integer');
  const args = buildToolArguments(params, { flightNo: 'CA1702', date: ' 2026-11-23 ', limit: '5', includeHistory: 'true' });
  assert.deepEqual(args, { flightNo: 'CA1702', date: '2026-11-23', limit: 5, includeHistory: true });
  assert.throws(() => buildToolArguments(params, { limit: 'abc' }), /需要数字/);
});

test('只读直调拒绝下单类工具，未配置工具返回明确错误', async (t) => {
  const calls = [];
  const mcp = await fakeMcpServer({
    tools: [tool('taxi_create_order', '创建打车订单'), tool('maps_textsearch', '地点搜索')],
    onCall: (name) => { calls.push(name); return { content: [{ type: 'text', text: '{}' }] }; },
  });
  t.after(() => mcp.close());
  const gateway = createMcpGateway({ configs: [{ name: 'didi', url: mcp.url, enabled: true }, { name: 'amap', url: mcp.url, enabled: true }] });
  const blocked = await callReadOnlyTool(gateway, 'didi_taxi_create_order', {});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'tool_not_read_only');
  assert.equal(calls.length, 0);

  const missing = await callReadOnlyTool(gateway, 'amap_does_not_exist', {});
  assert.equal(missing.ok, false);
  assert.ok(['tool_not_found', 'mcp_not_configured', 'mcp_unavailable'].includes(missing.code));

  const ok = await callReadOnlyTool(gateway, 'amap_maps_textsearch', { keywords: '西湖' });
  assert.equal(ok.ok, true);
  assert.equal(calls.length, 1);
});

test('场景清单完整且 id 唯一', () => {
  const ids = MCP_SCENES.map((scene) => scene.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['flight', 'train', 'route', 'nearby', 'map', 'weather', 'taxi', 'parcel', 'food']) {
    assert.ok(ids.includes(id), `缺少场景 ${id}`);
  }
});
