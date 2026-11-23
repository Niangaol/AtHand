/**
 * mcpGateway 离线测试：用 Node 内置 http 起本地假 MCP server，
 * 不依赖外网与真实密钥。
 *
 * 运行：node --test local-sync/mcpGateway.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  MCP_SERVICES,
  MCP_SERVICE_BY_NAME,
  MCP_PREFIXES,
  MCP_RISK_LEVELS,
  maskUrl,
  resolveConfigs,
  riskForTool,
  serviceState,
  toolNameFor,
} from './mcpServices.mjs';
import {
  MCP_DEFAULTS,
  createAuditSink,
  createMcpGateway,
  parseSse,
  truncateCallResult,
  truncateToolList,
} from './mcpGateway.mjs';

const BASE_TOOLS = [
  {
    name: 'maps_weather',
    description: '查询指定城市的实时天气与未来预报。',
    inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  },
  {
    name: 'maps_textsearch',
    description: '按关键词搜索地点。',
    inputSchema: { type: 'object', properties: { keywords: { type: 'string' } } },
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 本地假 MCP server。路径即场景：
 *   /mcp      正常握手与调用
 *   /sse      tools/list 用 text/event-stream 返回
 *   /slow     tools/call 延迟响应（测超时）
 *   /flaky    tools/list 先返回 state.failures 次 503
 *   /huge     tools/call 返回超长文本
 *   /many     tools/list 返回 80 个工具（测清单截断）
 *   /rpc-error tools/call 返回 JSON-RPC error
 */
function startFakeMcp() {
  const hits = {
    initialize: 0,
    initialized: 0,
    list: 0,
    call: 0,
    listByPath: {},
    callByPath: {},
    sessions: [],
    protocolHeaders: [],
    authHeaders: [],
    lastCallArgs: null,
  };
  const state = {
    failures: 0,
    callFailures: 0,
    callDelayMs: 0,
    hugeText: '',
    tools: BASE_TOOLS,
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }

    const reply = (status, payload, headers = {}) => {
      const content = payload === undefined ? '' : JSON.stringify(payload);
      response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      response.end(content);
    };
    const method = body?.method;
    const id = body?.id;

    if (method === 'initialize') {
      hits.initialize += 1;
      return reply(200, {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'fake-mcp', version: '0.1.0' },
        },
      }, { 'Mcp-Session-Id': 'session-abc' });
    }
    if (method === 'notifications/initialized') {
      hits.initialized += 1;
      response.writeHead(202);
      return response.end();
    }
    if (method === 'tools/list') {
      hits.list += 1;
      hits.listByPath[path] = (hits.listByPath[path] ?? 0) + 1;
      hits.sessions.push(request.headers['mcp-session-id'] ?? null);
      hits.protocolHeaders.push(request.headers['mcp-protocol-version'] ?? null);
      hits.authHeaders.push(request.headers.authorization ?? null);
      if (path === '/flaky' && hits.listByPath[path] <= state.failures) {
        return reply(503, { error: 'temporarily_unavailable' });
      }
      const tools = path === '/many'
        ? Array.from({ length: 80 }, (_value, index) => ({
          name: `maps_tool_${index}`,
          description: `第 ${index} 个工具。${'说明'.repeat(120)}`,
          inputSchema: { type: 'object', properties: {} },
        }))
        : state.tools;
      if (path === '/sse') {
        body = null;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(': heartbeat\n\n');
        response.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: { tools } })}\n\n`);
        return response.end();
      }
      return reply(200, { jsonrpc: '2.0', id, result: { tools } });
    }
    if (method === 'tools/call') {
      hits.call += 1;
      hits.callByPath[path] = (hits.callByPath[path] ?? 0) + 1;
      hits.lastCallArgs = body?.params?.arguments ?? null;
      if (path === '/slow') await sleep(state.callDelayMs);
      if (path === '/call-flaky' && hits.callByPath[path] <= state.callFailures) {
        return reply(503, { error: 'temporarily_unavailable' });
      }
      if (path === '/expire' && hits.callByPath[path] === 1) {
        return reply(404, { error: 'session_not_found' });
      }
      if (path === '/rpc-error') {
        return reply(200, { jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown tool' } });
      }
      const textContent = path === '/huge' ? state.hugeText : `已处理 ${body?.params?.name ?? ''}`;
      return reply(200, {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: textContent }],
          structuredContent: { ok: true, echo: body?.params?.name ?? '' },
        },
      });
    }
    return reply(400, { error: 'unsupported_method', method });
  });
  server.on('clientError', (_error, socket) => { try { socket.destroy(); } catch { /* ignore */ } });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        hits,
        state,
        origin: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

function makeGateway(fake, overrides = {}) {
  const { name = 'amap', path = '/mcp', enabled = true, ...rest } = overrides;
  return createMcpGateway({
    configs: [{
      name,
      url: `${fake.origin}${path}`,
      enabled,
      headers: { Authorization: 'Bearer test-token' },
    }],
    retryDelayMs: 10,
    retryMaxDelayMs: 40,
    retryBudgetMs: 2000,
    listTtlMs: 60_000,
    ...rest,
  });
}

test('服务目录：默认全部未配置，只登记环境变量名，不写死真实 Key', () => {
  assert.equal(MCP_SERVICES.length, 8);
  assert.deepEqual(MCP_SERVICES.map((service) => service.name), [
    'amap', 'weather', 'fliggy', 'variflight', 'kd100', 'didi', 'luckin', 'mcd',
  ]);
  for (const service of MCP_SERVICES) {
    assert.equal(service.url, '', `${service.name} 默认 url 必须为空`);
    assert.equal(service.enabled, false, `${service.name} 默认 enabled 必须为 false`);
    assert.ok(MCP_RISK_LEVELS.includes(service.risk), `${service.name} 风险档非法`);
    assert.match(service.envKey, /^[A-Z][A-Z0-9_]*$/, `${service.name} 只登记环境变量名`);
    assert.match(service.prefix, /^(amap|weather|fliggy|variflight|kd100|didi|luckin|mcd)_$/);
    assert.ok(Array.isArray(service.scenarios) && service.scenarios.length > 0);
    assert.ok(service.setup.length > 0, `${service.name} 需要给设置页一句配置提示`);
  }
  assert.equal(new Set(MCP_PREFIXES).size, MCP_PREFIXES.length, '前缀不能重复');
  const blob = JSON.stringify(MCP_SERVICES);
  assert.equal(/key=[A-Za-z0-9]{8,}/.test(blob), false, '不允许出现真实 key 值');
  assert.equal(/Bearer\s+[A-Za-z0-9_-]{8,}/i.test(blob), false, 'Bearer 后面只能是占位符');

  const byName = Object.fromEntries(MCP_SERVICES.map((service) => [service.name, service.risk]));
  assert.equal(byName.amap, 'read');
  assert.equal(byName.weather, 'read');
  assert.equal(byName.variflight, 'read');
  assert.equal(byName.kd100, 'read');
  assert.equal(byName.didi, 'order');
  assert.equal(byName.luckin, 'order');
  assert.equal(byName.mcd, 'order');
  assert.equal(byName.fliggy, 'read');
  assert.equal(MCP_SERVICE_BY_NAME.get('didi').sandbox, true, '滴滴默认走 sandbox');
});

test('风险三档：查询词降为 read、下单/取消为 order、支付词一律 pay', () => {
  assert.equal(riskForTool('amap', 'maps_weather'), 'read');
  assert.equal(riskForTool('didi', 'taxi_estimate'), 'read');
  assert.equal(riskForTool('didi', 'taxi_create_order'), 'order');
  assert.equal(riskForTool('didi', 'taxi_cancel_order'), 'order');
  assert.equal(riskForTool('luckin', 'createOrder'), 'order');
  assert.equal(riskForTool('luckin', 'previewOrder'), 'read');
  assert.equal(riskForTool('luckin', 'queryOrderDetailInfo'), 'read');
  assert.equal(riskForTool('mcd', 'create-order'), 'order');
  assert.equal(riskForTool('mcd', 'payOrder'), 'pay');
  assert.equal(riskForTool('luckin', 'refund_order'), 'pay');
  assert.equal(riskForTool('unknown-service', 'createOrder'), 'order', '未知服务按保守档处理');
  assert.equal(toolNameFor('amap', 'maps.weather'), 'amap_maps_weather');
  assert.ok(toolNameFor('amap', 'a'.repeat(120)).length <= 64);
});

test('配置合成与状态：环境变量只填地址、不自动开开关，未配置有可读原因', () => {
  const fromEnv = resolveConfigs({ env: { AMAP_WEB_KEY: 'env-key-123456' } });
  const amap = fromEnv.find((config) => config.name === 'amap');
  assert.match(amap.url, /^https:\/\/mcp\.amap\.com\/mcp\?key=env-key-123456$/);
  assert.equal(amap.enabled, false, '环境变量不自动打开开关');
  assert.equal(serviceState(amap).reason, 'disabled');
  assert.equal(maskUrl(amap.url).includes('env-key-123456'), false, '展示地址必须脱敏');
  assert.match(maskUrl(amap.url), /key=\*\*\*/);

  const luckin = resolveConfigs({ env: { LUCKIN_MCP_TOKEN: 'token-xyz' } })
    .find((config) => config.name === 'luckin');
  assert.equal(luckin.headers.Authorization, 'Bearer token-xyz');
  assert.equal(luckin.transport, 'http');

  const empty = resolveConfigs({ env: {} }).find((config) => config.name === 'kd100');
  assert.equal(empty.enabled, false);
  assert.equal(empty.url, '');
  assert.equal(serviceState(empty).reason, 'url_missing');
  assert.equal(serviceState(empty).configured, false);

  const enabledNoUrl = resolveConfigs({ stored: [{ name: 'kd100', enabled: true }], env: {} })
    .find((config) => config.name === 'kd100');
  assert.equal(serviceState(enabledNoUrl).reason, 'url_missing');

  const ready = serviceState({ ...empty, url: 'https://api.kuaidi100.com/mcp/streamable?key=k', enabled: true, hasUrl: true });
  assert.equal(ready.reason, 'ready');
  assert.equal(ready.ready, true);

  // CLI / stdio 形态：没有检测到就不算配置，也不会去发 HTTP 请求
  const fliggy = resolveConfigs({ env: { FLYAI_API_KEY: 'x' } }).find((config) => config.name === 'fliggy');
  assert.equal(serviceState(fliggy).reason, 'cli_missing');
  assert.equal(serviceState(fliggy, { probeCli: () => true }).reason, 'disabled');
  assert.equal(serviceState(fliggy, { probeCli: () => true, enabled: false }).ready, false);
  const weather = resolveConfigs({ env: {} }).find((config) => config.name === 'weather');
  assert.equal(serviceState(weather).reason, 'stdio_bridge_missing');
  assert.equal(MCP_DEFAULTS.timeoutMs, 15_000);
  assert.equal(MCP_DEFAULTS.listMaxChars, 16_000);
  assert.equal(MCP_DEFAULTS.callMaxChars, 16_000);
});

test('initialize 握手 + tools/list：带 session、协议版本、前缀命名', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  const gateway = makeGateway(fake);

  const listed = await gateway.listTools({ scenario: 'trip' });
  assert.equal(listed.truncated, false);
  assert.equal(listed.errors.length, 0, JSON.stringify(listed.errors));
  assert.equal(listed.tools.length, 2);
  assert.deepEqual(listed.tools.map((tool) => tool.name), ['amap_maps_weather', 'amap_maps_textsearch']);
  assert.equal(listed.tools[0].remoteName, 'maps_weather');
  assert.equal(listed.tools[0].risk, 'read');
  assert.equal(listed.tools[0].inputSchema.required[0], 'city');
  assert.equal(fake.hits.initialize, 1);
  assert.equal(fake.hits.initialized, 1, '握手后必须发 notifications/initialized');
  assert.deepEqual(fake.hits.sessions, ['session-abc']);
  assert.equal(fake.hits.authHeaders[0], 'Bearer test-token');
  assert.ok(fake.hits.protocolHeaders[0], '后续请求要带 MCP-Protocol-Version');

  const status = gateway.status().services[0];
  assert.equal(status.connected, true);
  assert.equal(status.toolCount, 2);
  assert.equal(status.protocolVersion, '2025-03-26', '协议版本以服务端协商结果为准');
  assert.equal(status.maskedUrl.includes('test-token'), false);
  assert.equal(JSON.stringify(gateway.configs()).includes('test-token'), false, 'configs() 不能带出凭据');
  assert.equal(JSON.stringify(gateway.status()).includes('test-token'), false, 'status() 不能带出凭据');
});

test('tools/call 成功并写审计（字段风格与 recordAudit 一致）', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  const audit = createAuditSink({ now: () => Date.parse('2026-11-22T12:00:00.000Z') });
  const gateway = makeGateway(fake, { audit });

  const result = await gateway.callTool('amap_maps_weather', { city: '杭州' });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'ok');
  assert.equal(result.requestSent, true);
  assert.equal(result.text, '已处理 maps_weather');
  assert.equal(result.truncated, false);
  assert.deepEqual(fake.hits.lastCallArgs, { city: '杭州' });

  const entries = audit.list();
  assert.equal(entries.length, 1);
  const entry = entries[0];
  for (const field of ['at', 'actor', 'actorKind', 'tool', 'summary', 'ok', 'error', 'revision']) {
    assert.ok(field in entry, `审计缺少字段 ${field}`);
  }
  assert.equal(entry.at, '2026-11-22T12:00:00.000Z');
  assert.equal(entry.actor, '内置助手');
  assert.equal(entry.actorKind, 'mcp');
  assert.equal(entry.tool, 'amap_maps_weather');
  assert.equal(entry.ok, true);
  assert.equal(entry.error, null);
  assert.equal(entry.revision, null);
  assert.equal(entry.service, 'amap');
  assert.equal(entry.risk, 'read');
  assert.equal(typeof entry.durationMs, 'number');
});

test('text/event-stream 响应能解析，且容忍心跳与非 JSON 事件', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  const gateway = makeGateway(fake, { path: '/sse' });
  const listed = await gateway.listTools();
  assert.equal(listed.errors.length, 0, JSON.stringify(listed.errors));
  assert.equal(listed.tools.length, 2);

  const parsed = parseSse([
    ': keep-alive',
    '',
    'event: message',
    'data: {"jsonrpc":"2.0","id":"1","result":{"tools":[]}}',
    '',
    'data: not-json',
    '',
    'data: {"jsonrpc":"2.0","method":"notifications/progress"}',
    '',
  ].join('\n'));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, '1');
  assert.equal(parsed[1].method, 'notifications/progress');
});

test('请求超时：返回 mcp_timeout，不挂死并落审计', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  fake.state.callDelayMs = 400;
  const audit = createAuditSink();
  const gateway = makeGateway(fake, { path: '/slow', timeoutMs: 80, retries: 0, audit });

  const started = Date.now();
  const result = await gateway.callTool('amap_maps_weather', { city: '杭州' });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'mcp_timeout');
  assert.equal(result.retryable, true);
  assert.ok(elapsed < 2000, `超时应当很快返回，实际 ${elapsed}ms`);
  const entry = audit.list().at(-1);
  assert.equal(entry.ok, false);
  assert.equal(entry.error, 'mcp_timeout');
});

test('失败重试：指数退避后成功，重试次数可配', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  fake.state.failures = 2;
  const gateway = makeGateway(fake, { path: '/flaky', retries: 2, retryDelayMs: 5 });
  const listed = await gateway.listTools();
  assert.equal(listed.errors.length, 0, JSON.stringify(listed.errors));
  assert.equal(listed.tools.length, 2);
  assert.equal(fake.hits.listByPath['/flaky'], 3, '首次 + 两次重试');
});

test('重试耗尽：返回可操作错误，不无限重试', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  fake.state.failures = 9;
  const gateway = makeGateway(fake, { path: '/flaky', retries: 1, retryDelayMs: 5 });
  const listed = await gateway.listTools();
  assert.equal(listed.tools.length, 0);
  assert.equal(listed.errors.length, 1);
  assert.equal(listed.errors[0].code, 'mcp_http_error');
  assert.equal(listed.errors[0].retryable, true);
  assert.equal(fake.hits.listByPath['/flaky'], 2, '总尝试次数 = retries + 1');
});

test('tools/call 超长结果按 callMaxChars 独立截断，保留原文长度与标记', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  fake.state.hugeText = 'x'.repeat(5000);
  const audit = createAuditSink();
  const gateway = makeGateway(fake, { path: '/huge', callMaxChars: 500, audit });
  const result = await gateway.callTool('amap_maps_weather', { city: '杭州' });
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.equal(result.originalChars, 5000);
  assert.ok(result.retainedChars <= 500, `截断后 ${result.retainedChars} 字符`);
  assert.match(result.text, /结果已截断/);
  assert.equal(audit.list().at(-1).truncated, true);

  const small = truncateCallResult({ content: [{ type: 'text', text: '短结果' }] }, 100);
  assert.equal(small.truncated, false);
  assert.equal(small.text, '短结果');

  const structured = truncateCallResult({
    content: [{ type: 'text', text: 'ok' }],
    structuredContent: { list: Array.from({ length: 300 }, (_value, index) => index) },
  }, 100);
  assert.equal(structured.truncated, false);
  assert.equal(structured.structuredContent, null, '放不下的结构化结果不硬塞');
  assert.equal(structured.structuredSummary.kind, 'object');
  assert.deepEqual(structured.structuredSummary.keys, ['list']);
});

test('tools/list 用 listMaxChars 独立截断，与 call 上限互不影响', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  const gateway = makeGateway(fake, { path: '/many', listMaxChars: 2000 });
  const listed = await gateway.listTools();
  assert.equal(listed.truncated, true);
  assert.ok(listed.omittedTools > 0);
  assert.ok(listed.retainedChars <= 2000, `清单保留 ${listed.retainedChars} 字符`);
  assert.ok(listed.tools.length < 80);
  assert.ok(listed.tools.every((tool) => tool.name.startsWith('amap_')));
  assert.equal(MCP_DEFAULTS.callMaxChars, 16_000, 'call 上限不受 list 截断影响');

  const fitted = truncateToolList([{ name: 'amap_one', description: 'y'.repeat(500), inputSchema: { type: 'object' } }], 300);
  assert.equal(fitted.truncated, true);
  assert.equal(fitted.oversized, false);
  assert.ok(JSON.stringify(fitted.tools).length <= 300 || fitted.tools[0].description === '');
  assert.ok(fitted.tools[0].description.length <= 120, '描述先被压缩');
});

test('未配置降级：url 为空或开关关闭时不发任何请求', async () => {
  let fetchCalls = 0;
  const fetchImpl = () => { fetchCalls += 1; throw new Error('不该发请求'); };
  const missing = createMcpGateway({
    configs: [{ name: 'amap', url: '', enabled: true }],
    fetchImpl,
  });
  const listed = await missing.listTools();
  assert.equal(listed.skipped.length, 1);
  assert.equal(listed.skipped[0].reason, 'url_missing');
  assert.match(listed.skipped[0].message, /未配置/);
  assert.equal(listed.errors.length, 0);

  const call = await missing.callTool('amap_maps_weather', {});
  assert.equal(call.ok, false);
  assert.equal(call.code, 'mcp_not_configured');
  assert.equal(call.requestSent, false);

  const disabled = createMcpGateway({
    configs: [{ name: 'amap', url: 'https://mcp.amap.com/mcp?key=abc', enabled: false }],
    fetchImpl,
  });
  const disabledCall = await disabled.callTool('amap_maps_weather', {});
  assert.equal(disabledCall.code, 'mcp_disabled');
  assert.equal(disabledCall.reason, 'disabled');
  assert.equal(disabledCall.requestSent, false);

  const cli = createMcpGateway({ configs: [{ name: 'fliggy', url: '', enabled: true }], fetchImpl });
  const cliCall = await cli.callTool('fliggy_search_hotel', {});
  assert.equal(cliCall.code, 'mcp_not_configured');
  assert.equal(cliCall.reason, 'cli_missing');
  assert.equal(fetchCalls, 0, '未配置时一次网络请求都不能发');
});

test('三档闸门：pay 直接拒绝、order 无确认不发请求、未知工具可读报错', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  const gateway = createMcpGateway({
    configs: [
      { name: 'mcd', url: `${fake.origin}/mcp`, enabled: true },
      { name: 'didi', url: `${fake.origin}/mcp`, enabled: true },
    ],
    retryDelayMs: 5,
  });

  const paid = await gateway.callTool('mcd_payOrder', { orderId: 'x' });
  assert.equal(paid.ok, false);
  assert.equal(paid.code, 'mcp_pay_blocked');
  assert.equal(paid.requestSent, false);
  assert.match(paid.message, /不代做/);

  const unconfirmed = await gateway.callTool('didi_taxi_create_order', { from: 'a', to: 'b' });
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.code, 'mcp_order_confirmation_required');
  assert.equal(unconfirmed.needsConfirmation, true);
  assert.equal(unconfirmed.requestSent, false);
  assert.equal(fake.hits.call, 0, '未确认的下单不能发请求');

  const unknown = await gateway.callTool('amap_missing_tool', {});
  assert.equal(unknown.code, 'mcp_unknown_tool');

  const readCall = await gateway.callTool('mcd_query_shop_list', {});
  assert.equal(readCall.ok, true);
  assert.equal(fake.hits.call, 1);

  const confirmed = await gateway.callTool('didi_taxi_create_order', { from: 'a', to: 'b' }, {
    confirmed: true,
    requestId: 'req-didi-1',
  });
  assert.equal(confirmed.ok, true);
  assert.equal(fake.hits.call, 2);
});

test('order 幂等：同 requestId 只发一次请求', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  const gateway = makeGateway(fake, { name: 'luckin' });
  const [first, second] = await Promise.all([
    gateway.callTool('luckin_createOrder', { product: '生椰拿铁' }, { confirmed: true, requestId: 'req-1' }),
    gateway.callTool('luckin_createOrder', { product: '生椰拿铁' }, { confirmed: true, requestId: 'req-1' }),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(fake.hits.call, 1, '同 requestId 不能重复下单');
  assert.equal(second.deduplicated, true);

  const other = await gateway.callTool('luckin_createOrder', { product: '美式' }, { confirmed: true, requestId: 'req-2' });
  assert.equal(other.ok, true);
  assert.equal(fake.hits.call, 2, '换 requestId 才会真的再下一单');
});

test('连接缓存与工具清单 TTL：重复 listTools 不重复握手', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  const gateway = makeGateway(fake);
  await gateway.listTools();
  await gateway.listTools();
  assert.equal(fake.hits.initialize, 1);
  assert.equal(fake.hits.list, 1, '清单在 TTL 内走缓存');
  await gateway.listTools({ refresh: true });
  assert.equal(fake.hits.list, 2);
  assert.equal(fake.hits.initialize, 1);

  gateway.invalidate('amap');
  await gateway.listTools();
  assert.equal(fake.hits.initialize, 2, 'invalidate 后重新握手');
});

test('JSON-RPC error 原样暴露为 mcp_rpc_error，不当成成功', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  const gateway = makeGateway(fake, { path: '/rpc-error' });
  const result = await gateway.callTool('amap_maps_weather', { city: '杭州' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'mcp_rpc_error');
  assert.match(result.message, /unknown tool/);
  assert.equal(result.retryable, false);
});

test('只读调用失败会重试，下单调用不自动重试（避免重复下单）', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  fake.state.callFailures = 2;
  const readGateway = makeGateway(fake, { path: '/call-flaky', retries: 2, retryDelayMs: 5 });
  const readCall = await readGateway.callTool('amap_maps_weather', { city: '杭州' });
  assert.equal(readCall.ok, true, JSON.stringify(readCall));
  assert.equal(fake.hits.callByPath['/call-flaky'], 3, '只读工具允许退避重试');

  fake.state.callFailures = 99;
  const orderGateway = makeGateway(fake, { name: 'luckin', path: '/call-flaky', retries: 2, retryDelayMs: 5 });
  const bad = await orderGateway.callTool('luckin_createOrder', { product: '生椰拿铁' }, {
    confirmed: true,
    requestId: 'req-retry',
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'mcp_http_error');
  assert.equal(bad.retryable, true, '错误本身标记可重试，但下单不自动重试');
  assert.equal(fake.hits.callByPath['/call-flaky'], 4, '下单失败只尝试一次');
});

test('会话过期（HTTP 404）自动重新握手再试一次', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  const gateway = makeGateway(fake, { path: '/expire' });
  const result = await gateway.callTool('amap_maps_weather', { city: '杭州' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fake.hits.initialize, 2, '404 后要重新 initialize');
  assert.equal(fake.hits.callByPath['/expire'], 2);
});

test('stdio 服务填了 HTTP 桥地址后可以正常连接（weather 走桥）', async (t) => {
  const fake = await startFakeMcp();
  t.after(() => closeServer(fake.server));
  const gateway = createMcpGateway({
    configs: [{ name: 'weather', url: `${fake.origin}/mcp`, enabled: true }],
    retryDelayMs: 5,
  });
  const listed = await gateway.listTools({ scenario: 'weather' });
  assert.equal(listed.errors.length, 0, JSON.stringify(listed.errors));
  assert.deepEqual(listed.tools.map((tool) => tool.name), ['weather_maps_weather', 'weather_maps_textsearch']);
  const status = gateway.status().services[0];
  assert.equal(status.transport, 'stdio', '目录里仍是 stdio 形态');
  assert.equal(status.effectiveTransport, 'http', '但走 HTTP 桥时按 http 处理');
  assert.equal(status.connected, true);
});
