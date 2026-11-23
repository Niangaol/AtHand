/**
 * 生活服务 MCP 网关（Streamable HTTP，零新依赖）。
 *
 * 只依赖 Node 内置的 fetch / AbortController / crypto，不引入
 * @modelcontextprotocol/sdk。实现 JSON-RPC 2.0 的 initialize（协议版本协商 +
 * notifications/initialized）、tools/list（含 nextCursor 翻页）、tools/call。
 *
 * 安全约定（与 docs/life-service-mcp-catalog.md 第五节一致）：
 *   read  只读工具：允许执行，传输失败可以自动重试；
 *   order 下单工具：必须调用方显式传 confirmed:true（上游由用户下一句确认），
 *                   且默认不自动重试，避免重复下单；同 requestId 幂等去重；
 *   pay   支付工具：一律不执行，提前拦下，不发任何网络请求。
 *
 * 未配置（url 为空 / 开关关闭 / CLI 未检测到）时只返回可读提示，绝不发请求，
 * 绝不假装可用。
 *
 * 审计：server.mjs 里的 recordAudit 没有导出（文件内私有），所以本模块导出
 * 同字段风格的 createAuditSink：{ at, actor, actorKind, tool, summary, ok,
 * error, revision } + MCP 专有字段 service/risk/durationMs/truncated。
 * server.mjs 接线时把 recordAudit 作为 write 回调传入即可，字段完全对得上。
 */

import crypto from 'node:crypto';
import {
  MCP_SERVICES,
  MAX_TOOL_DESCRIPTION,
  prefixFor,
  resolveConfigs,
  riskForTool,
  serviceState,
  toolNameFor,
} from './mcpServices.mjs';

export const MCP_DEFAULTS = Object.freeze({
  // 握手用的协议版本；服务端返回版本在 SUPPORTED_PROTOCOL_VERSIONS 内即接受。
  protocolVersion: '2025-06-18',
  clientName: 'shunshou-local-sync',
  clientVersion: '0.1.0',
  // 单次 HTTP 请求超时。
  timeoutMs: 15_000,
  // 首次失败之后的重试次数（总尝试 = retries + 1，默认 3 次）。
  retries: 2,
  retryDelayMs: 300,
  retryMaxDelayMs: 4_000,
  // 一次操作的重试总时长预算，超预算就放弃。
  retryBudgetMs: 20_000,
  // tools/list 与 tools/call 各自独立的截断上限（字符数）。
  listMaxChars: 16_000,
  callMaxChars: 16_000,
  // 响应体读取上限，防止异常服务把内存打爆。
  maxResponseChars: 200_000,
  // 工具清单缓存时间。
  listTtlMs: 5 * 60_000,
  maxListPages: 4,
  // 下单请求去重窗口。
  orderDedupeMs: 10 * 60_000,
  auditLimit: 200,
});

/** 认识的协议版本；服务端报别的版本仍继续，但记 warning，不静默当成支持。 */
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
]);

/** 网关统一错误类型：带机器可读 code、HTTP status、是否可重试。 */
export class McpError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.status = Number.isFinite(options.status) ? options.status : 0;
    this.retryable = options.retryable === true;
    this.details = options.details ?? null;
  }
}

/**
 * 审计缓冲区：默认留最近 200 条，字段与 server.mjs 的 recordAudit 一致。
 * write 回调用于把记录落到 agent-audit.json（server 侧注入）。
 */
export function createAuditSink({ limit = MCP_DEFAULTS.auditLimit, write = null, actor = '内置助手', now = Date.now } = {}) {
  const entries = [];
  function record(partial = {}) {
    const entry = {
      at: new Date(now()).toISOString(),
      actor,
      actorKind: 'mcp',
      tool: String(partial.tool ?? '').slice(0, 200),
      summary: String(partial.summary ?? '').slice(0, 240),
      ok: partial.ok === true,
      error: partial.ok === true ? null : (typeof partial.error === 'string' && partial.error ? partial.error : 'mcp_error'),
      revision: null,
      service: typeof partial.service === 'string' ? partial.service : '',
      risk: typeof partial.risk === 'string' ? partial.risk : '',
      durationMs: Number.isFinite(partial.durationMs) ? Math.max(0, Math.round(partial.durationMs)) : null,
      truncated: partial.truncated === true,
    };
    if (typeof write === 'function') {
      try { write(entry); } catch { /* 审计写入失败不影响本次调用。 */ }
    }
    entries.push(entry);
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    return entry;
  }
  return {
    record,
    list: () => entries.slice(),
    clear: () => { entries.length = 0; },
  };
}

function clipText(value, max) {
  const text = typeof value === 'string' ? value : '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** 响应体按上限读取；超出部分直接丢弃并标记 cut。 */
async function readBounded(response, cap) {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const text = await response.text();
    return { text: text.length > cap ? text.slice(0, cap) : text, cut: text.length > cap };
  }
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  let cut = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const remaining = cap - total;
      if (value.byteLength > remaining) {
        chunks.push(Buffer.from(value.subarray(0, Math.max(0, remaining))));
        total += Math.max(0, remaining);
        cut = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(Buffer.from(value));
      total += value.byteLength;
    }
  } finally {
    try { reader.releaseLock(); } catch { /* 释放失败无所谓。 */ }
  }
  return { text: Buffer.concat(chunks).toString('utf8'), cut };
}

/** 解析 text/event-stream：按空行切块，取每块的 data: 行。 */
export function parseSse(text) {
  const messages = [];
  const source = String(text ?? '');
  for (const block of source.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data.trim()) continue;
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) messages.push(...parsed);
      else messages.push(parsed);
    } catch {
      // 心跳或非 JSON 的 SSE 事件直接忽略。
    }
  }
  return messages;
}

function pickMessage(messages, id) {
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.id === id && ('result' in message || 'error' in message)) return message;
  }
  return null;
}

/**
 * tools/list 截断：先压缩描述，再丢尾部条目，保留结构化摘要。
 * 与 tools/call 的截断常量互不影响。
 */
export function truncateToolList(tools, maxChars = MCP_DEFAULTS.listMaxChars) {
  const items = (Array.isArray(tools) ? tools : []).map((tool) => ({
    ...tool,
    description: clipText(tool.description, MAX_TOOL_DESCRIPTION),
  }));
  const originalChars = JSON.stringify(items).length;
  if (originalChars <= maxChars) {
    return { tools: items, truncated: false, omittedTools: 0, originalChars, retainedChars: originalChars, oversized: false };
  }
  const lean = items.map((tool) => ({ ...tool, description: clipText(tool.description, 120) }));
  const kept = [];
  for (const tool of lean) {
    if (JSON.stringify([...kept, tool]).length > maxChars) break;
    kept.push(tool);
  }
  let oversized = false;
  if (kept.length === 0 && lean.length) {
    // 单个工具就超限：至少保留名字与入参 schema，描述清空。
    const first = { ...lean[0], description: '' };
    if (JSON.stringify([first]).length > maxChars) oversized = true;
    kept.push(first);
  }
  const retainedChars = kept.length ? JSON.stringify(kept).length : 0;
  return {
    tools: kept,
    truncated: true,
    omittedTools: items.length - kept.length,
    originalChars,
    retainedChars,
    oversized,
  };
}

function summarizeStructured(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) return { kind: 'array', length: value.length, truncated: true };
  const keys = Object.keys(value).slice(0, 20);
  return { kind: 'object', keys, truncated: true };
}

/**
 * tools/call 结果截断：正文超出上限时切片并留中文标记，图片/资源只留元信息，
 * structuredContent 超限时退化成键名摘要。返回值自带 truncated 标记。
 */
export function truncateCallResult(payload, maxChars = MCP_DEFAULTS.callMaxChars) {
  const content = Array.isArray(payload?.content) ? payload.content : [];
  const parts = content.map((item) => {
    const type = String(item?.type ?? 'unknown');
    if (type === 'text') return { type, text: String(item.text ?? '') };
    if (type === 'image') return { type, mimeType: String(item.mimeType ?? ''), bytes: typeof item.data === 'string' ? item.data.length : 0 };
    if (type === 'resource') {
      return {
        type,
        uri: String(item.resource?.uri ?? ''),
        mimeType: String(item.resource?.mimeType ?? ''),
        chars: typeof item.resource?.text === 'string' ? item.resource.text.length : 0,
      };
    }
    return { type };
  });
  const textParts = parts.filter((part) => part.type === 'text');
  const plain = textParts.map((part) => part.text).join('\n');
  const contentKinds = parts
    .map((part) => (part.type === 'text' ? `text:${part.text.length}` : `${part.type}${part.mimeType ? `(${part.mimeType})` : ''}`))
    .join(',');
  const originalChars = plain.length;
  const structured = payload?.structuredContent ?? null;
  const structuredJson = structured ? JSON.stringify(structured) : '';

  if (originalChars <= maxChars) {
    const fitsStructured = structuredJson.length > 0 && originalChars + structuredJson.length <= maxChars;
    return {
      text: plain,
      truncated: false,
      originalChars,
      retainedChars: originalChars,
      parts,
      contentKinds,
      structuredContent: fitsStructured ? structured : null,
      structuredSummary: fitsStructured || !structured ? null : summarizeStructured(structured),
    };
  }
  const marker = `\n……（结果已截断：原文 ${originalChars} 字符，只保留前 ${maxChars} 字符）`;
  const limit = Math.max(0, maxChars - marker.length);
  const text = `${plain.slice(0, limit)}${marker}`;
  return {
    text,
    truncated: true,
    originalChars,
    retainedChars: text.length,
    parts: [
      { type: 'text', text, truncated: true },
      ...parts.filter((part) => part.type !== 'text'),
    ],
    contentKinds,
    structuredContent: null,
    structuredSummary: structured ? summarizeStructured(structured) : null,
  };
}

function headersKeyOf(headers) {
  return Object.entries(headers ?? {})
    .map(([key, value]) => `${key.toLowerCase()}:${value}`)
    .sort()
    .join('|');
}

function cacheKeyOf(config) {
  return crypto
    .createHash('sha256')
    .update(`${config.name}\u0000${config.url}\u0000${headersKeyOf(config.headers)}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * 创建网关。
 *
 * options：
 *   configs   直接给运行时配置数组（[{name,url,headers,enabled,scenarios,prefix}]），
 *             测试与 server 手工接线用；给了就不再读 stored/env。
 *   services  替换目录（默认 MCP_SERVICES）
 *   stored    设置页保存的配置数组
 *   env       环境变量（默认 process.env），只用来填 Key，不自动打开开关
 *   fetchImpl 注入 fetch（默认全局 fetch）
 *   audit     审计 sink（默认 createAuditSink）
 *   probeCli  飞猪 CLI 检测钩子，默认恒为 false
 *   其余 tuning 字段见 MCP_DEFAULTS
 */
export function createMcpGateway(options = {}) {
  const tuning = { ...MCP_DEFAULTS };
  for (const key of Object.keys(MCP_DEFAULTS)) {
    if (options[key] !== undefined) tuning[key] = options[key];
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new McpError('mcp_fetch_unavailable', '当前 Node 运行时没有 fetch，无法连接 MCP 服务。');
  }
  const now = options.now ?? Date.now;
  const probeCli = options.probeCli ?? (() => false);
  const audit = options.audit ?? createAuditSink({ limit: tuning.auditLimit, now });
  const env = options.env ?? process.env;

  const configs = Array.isArray(options.configs)
    ? options.configs.map((item) => normalizeConfig(item))
    : resolveConfigs({ services: options.services ?? MCP_SERVICES, stored: options.stored ?? [], env });

  const connections = new Map();
  const inflight = new Map();
  const lastErrors = new Map();
  const orderCalls = new Map();

  function normalizeConfig(item = {}) {
    const catalog = (options.services ?? MCP_SERVICES).find((service) => service.name === item.name) ?? null;
    const url = String(item.url ?? catalog?.url ?? '').trim();
    const headers = {};
    if (item.headers && typeof item.headers === 'object') {
      for (const [key, value] of Object.entries(item.headers)) {
        if (/^[A-Za-z0-9_-]+$/.test(key) && typeof value === 'string' && value.length <= 4000) headers[key] = value;
      }
    }
    return {
      name: String(item.name ?? catalog?.name ?? 'mcp'),
      label: String(item.label ?? catalog?.label ?? item.name ?? 'MCP 服务'),
      prefix: String(item.prefix ?? catalog?.prefix ?? prefixFor(item.name)),
      risk: item.risk ?? catalog?.risk ?? 'order',
      transport: item.transport ?? catalog?.transport ?? 'http',
      envKey: item.envKey ?? catalog?.envKey ?? '',
      scenarios: Array.isArray(item.scenarios) && item.scenarios.length
        ? item.scenarios.filter((value) => typeof value === 'string')
        : [...(catalog?.scenarios ?? [])],
      url,
      headers,
      enabled: item.enabled === true,
      source: item.source ?? 'config',
      setup: item.setup ?? catalog?.setup ?? '',
      docs: item.docs ?? catalog?.docs ?? '',
      notes: item.notes ?? catalog?.notes ?? '',
      urlTemplate: item.urlTemplate ?? catalog?.urlTemplate ?? '',
      productionUrlTemplate: item.productionUrlTemplate ?? catalog?.productionUrlTemplate ?? '',
      sandbox: item.sandbox ?? catalog?.sandbox === true,
      cli: item.cli ?? catalog?.cli ?? null,
      launcher: item.launcher ?? catalog?.launcher ?? null,
      hasUrl: url !== '',
      invalidUrl: url !== '' && !isHttpUrlLoose(url),
    };
  }

  function isHttpUrlLoose(value) {
    try {
      const parsed = new URL(String(value));
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function stateOf(config) {
    return serviceState(config, { probeCli });
  }

  function publicStatus() {
    return {
      services: configs.map((config) => {
        const state = stateOf(config);
        const key = cacheKeyOf(config);
        const conn = connections.get(key);
        const error = lastErrors.get(key);
        return {
          ...state,
          connected: Boolean(conn?.sessionId),
          protocolVersion: conn?.protocolVersion ?? null,
          toolCount: Array.isArray(conn?.tools) ? conn.tools.length : 0,
          lastError: error?.code ?? null,
          lastErrorMessage: error?.message ?? null,
        };
      }),
    };
  }

  function recordAuditEntry(partial) {
    return audit.record(partial);
  }

  function auditFailure(config, tool, risk, error, started, phase) {
    recordAuditEntry({
      tool,
      service: config.name,
      risk,
      ok: false,
      error: typeof error?.code === 'string' ? error.code : 'mcp_error',
      summary: `${config.label} · ${phase} · ${error?.message ?? '失败'}`,
      durationMs: now() - started,
    });
  }

  function withRetry(config, operation, { retries = tuning.retries, retryable = true } = {}) {
    const started = now();
    return (async () => {
      let attempt = 0;
      for (;;) {
        try {
          return await operation(attempt);
        } catch (error) {
          const canRetry = retryable
            && error instanceof McpError
            && error.retryable === true
            && attempt < retries;
          if (!canRetry) throw error;
          const delay = Math.min(tuning.retryMaxDelayMs, tuning.retryDelayMs * 2 ** attempt);
          if (now() - started + delay > tuning.retryBudgetMs) throw error;
          attempt += 1;
          await sleep(delay);
        }
      }
    })();
  }

  /** 发一次 JSON-RPC HTTP 请求，返回 { messages, sessionId, cut }。 */
  async function send(config, body, sendOptions = {}) {
    const timeoutMs = Number.isFinite(sendOptions.timeoutMs) ? sendOptions.timeoutMs : tuning.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { controller.abort(new Error('mcp_timeout')); } catch { controller.abort(); }
    }, timeoutMs);
    timer.unref?.();
    const label = config.label || config.name;
    try {
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(config.headers ?? {}),
      };
      const sessionId = typeof sendOptions.sessionId === 'string' ? sendOptions.sessionId : '';
      if (sessionId) headers['Mcp-Session-Id'] = sessionId;
      if (sendOptions.protocolVersion) headers['MCP-Protocol-Version'] = sendOptions.protocolVersion;
      let response;
      try {
        response = await fetchImpl(config.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
          redirect: 'follow',
        });
      } catch (error) {
        if (timedOut) {
          throw new McpError('mcp_timeout', `${label} 超过 ${timeoutMs}ms 没有响应。`, { retryable: true });
        }
        throw new McpError('mcp_unreachable', `连不上 ${label}：${error?.message ?? '网络错误'}`, { retryable: true });
      }
      const rawSession = String(response.headers?.get?.('mcp-session-id') ?? sessionId ?? '');
      const nextSession = /^[\x21-\x7E]{1,200}$/.test(rawSession) ? rawSession : String(sessionId ?? '');
      if (response.status === 202 || response.status === 204) {
        return { messages: [], sessionId: nextSession, cut: false, status: response.status };
      }
      const { text, cut } = await readBounded(response, tuning.maxResponseChars);
      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
        const code = response.status === 401 || response.status === 403 ? 'mcp_auth_failed' : 'mcp_http_error';
        const hint = response.status === 401 || response.status === 403
          ? '请检查 Key/Token 是否有效、是否已过期。'
          : response.status === 429
            ? '上游限流，请稍后再试。'
            : '上游返回了错误状态。';
        throw new McpError(code, `${label} 返回 HTTP ${response.status}。${hint}`, {
          status: response.status,
          retryable,
        });
      }
      const contentType = String(response.headers?.get?.('content-type') ?? '');
      let messages = [];
      if (contentType.includes('text/event-stream')) {
        messages = parseSse(text);
      } else if (text.trim()) {
        try {
          const parsed = JSON.parse(text);
          messages = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          throw new McpError('mcp_invalid_response', `${label} 返回的内容不是合法 JSON。`, { retryable: true });
        }
      }
      return { messages, sessionId: nextSession, cut, status: response.status };
    } finally {
      clearTimeout(timer);
    }
  }

  async function rpc(config, method, params, rpcOptions = {}) {
    const id = rpcOptions.id ?? crypto.randomUUID();
    const body = { jsonrpc: '2.0', id, method, params: params ?? {} };
    const response = await send(config, body, rpcOptions);
    const message = pickMessage(response.messages, id);
    if (!message) {
      throw new McpError('mcp_invalid_response', `${config.label || config.name} 没有返回与请求匹配的 JSON-RPC 结果。`, {
        retryable: true,
        details: { method },
      });
    }
    if (message.error) {
      throw new McpError(
        'mcp_rpc_error',
        `${config.label || config.name} 的 ${method} 失败：${String(message.error.message ?? '上游错误')}`,
        { details: { rpcCode: message.error.code ?? null, data: message.error.data ?? null }, retryable: false },
      );
    }
    return { result: message.result ?? null, sessionId: response.sessionId, cut: response.cut };
  }

  async function notify(config, method, params, notifyOptions = {}) {
    const body = { jsonrpc: '2.0', method };
    if (params !== undefined) body.params = params;
    return send(config, body, notifyOptions);
  }

  async function performHandshake(config) {
    const handshake = await rpc(config, 'initialize', {
      protocolVersion: tuning.protocolVersion,
      capabilities: { tools: {} },
      clientInfo: { name: tuning.clientName, version: tuning.clientVersion },
    });
    const protocolVersion = typeof handshake.result?.protocolVersion === 'string'
      ? handshake.result.protocolVersion
      : tuning.protocolVersion;
    const sessionId = handshake.sessionId ?? '';
    const supported = SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion);
    // 握手后的通知是「尽力而为」：服务端返回 202 或直接忽略都不算失败。
    await notify(config, 'notifications/initialized', undefined, { sessionId, protocolVersion })
      .catch(() => { /* 通知失败不影响后续工具调用。 */ });
    return {
      sessionId,
      protocolVersion,
      protocolVersionSupported: supported,
      serverInfo: handshake.result?.serverInfo ?? null,
      capabilities: handshake.result?.capabilities ?? null,
      lastError: null,
    };
  }

  async function ensureConnection(config) {
    const key = cacheKeyOf(config);
    const cached = connections.get(key);
    if (cached) return cached;
    const running = inflight.get(key);
    if (running) return running;
    const promise = (async () => {
      const handshake = await withRetry(config, () => performHandshake(config));
      const connection = { ...handshake, key, tools: null, toolsAt: 0 };
      connections.set(key, connection);
      lastErrors.delete(key);
      return connection;
    })().catch((error) => {
      lastErrors.set(key, error);
      throw error;
    }).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  }

  /** 丢掉某个服务缓存的会话与错误，下次调用会重新握手。 */
  function invalidateKey(config) {
    const key = cacheKeyOf(config);
    connections.delete(key);
    lastErrors.delete(key);
  }

  function normalizeRemoteTool(config, item) {
    const remoteName = String(item?.name ?? '').trim();
    if (!remoteName) return null;
    return {
      name: toolNameFor(config.name, remoteName, config.prefix),
      remoteName,
      service: config.name,
      serviceLabel: config.label,
      risk: riskForTool(config.name, remoteName),
      description: clipText(item?.description, MAX_TOOL_DESCRIPTION),
      inputSchema: item?.inputSchema ?? { type: 'object', properties: {} },
      annotations: item?.annotations ?? null,
    };
  }

  async function fetchTools(config, connection, { refresh = false } = {}) {
    if (!refresh && Array.isArray(connection.tools) && now() - connection.toolsAt < tuning.listTtlMs) {
      return connection.tools;
    }
    let conn = connection;
    const collected = [];
    let cursor = null;
    let pagesOmitted = 0;
    for (let page = 0; page < tuning.maxListPages; page += 1) {
      const params = cursor ? { cursor } : {};
      // 会话过期（HTTP 404）时重新握手再试一次，其它错误交给 withRetry 退避。
      const fetchPage = async () => {
        try {
          return await rpc(config, 'tools/list', params, {
            sessionId: conn.sessionId,
            protocolVersion: conn.protocolVersion,
          });
        } catch (error) {
          if (!(error instanceof McpError) || error.status !== 404) throw error;
          invalidateKey(config);
          conn = await ensureConnection(config);
          return rpc(config, 'tools/list', params, {
            sessionId: conn.sessionId,
            protocolVersion: conn.protocolVersion,
          });
        }
      };
      const { result } = await withRetry(config, fetchPage);
      const list = Array.isArray(result?.tools) ? result.tools : [];
      for (const item of list) {
        const tool = normalizeRemoteTool(config, item);
        if (tool) collected.push(tool);
      }
      cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null;
      if (!cursor) break;
      if (page === tuning.maxListPages - 1) pagesOmitted = 1;
    }
    conn.tools = collected;
    conn.toolsAt = now();
    conn.pagesTruncated = pagesOmitted > 0;
    return collected;
  }

  function scenarioMatches(config, scenario) {
    if (!scenario) return true;
    return Array.isArray(config.scenarios) && config.scenarios.includes(scenario);
  }

  function identify(fullName) {
    const name = String(fullName ?? '');
    const matches = configs
      .map((config) => ({ config, prefix: config.prefix ?? prefixFor(config.name) }))
      .filter(({ prefix }) => prefix && name.startsWith(prefix))
      .sort((left, right) => right.prefix.length - left.prefix.length);
    if (!matches.length) return null;
    const { config, prefix } = matches[0];
    const stripped = name.slice(prefix.length);
    if (!stripped) return null;
    const connection = connections.get(cacheKeyOf(config));
    const known = Array.isArray(connection?.tools)
      ? connection.tools.find((tool) => tool.name === name)
      : null;
    return { config, remoteName: known?.remoteName ?? stripped };
  }

  /**
   * 列出工具。按服务聚集，单个服务失败不影响其它服务。
   * 返回的 tools 已被 listMaxChars 独立截断。
   */
  async function listTools(listOptions = {}) {
    const scenario = typeof listOptions.scenario === 'string' ? listOptions.scenario : '';
    const only = typeof listOptions.service === 'string' ? listOptions.service : '';
    const refresh = listOptions.refresh === true;
    const selected = configs.filter((config) => (!only || config.name === only) && scenarioMatches(config, scenario));
    const results = await Promise.all(selected.map(async (config) => {
      const state = stateOf(config);
      if (state.effectiveTransport !== 'http' || state.reason !== 'ready') {
        return { config, state, tools: [], skipped: true };
      }
      const started = now();
      try {
        const connection = await ensureConnection(config);
        const tools = await fetchTools(config, connection, { refresh });
        return { config, state, tools, skipped: false };
      } catch (error) {
        lastErrors.set(cacheKeyOf(config), error);
        auditFailure(config, `${config.prefix}*`, config.risk, error, started, 'tools/list');
        return { config, state, tools: [], skipped: false, error };
      }
    }));

    const all = results.flatMap((item) => item.tools);
    const fitted = truncateToolList(all, tuning.listMaxChars);
    return {
      tools: fitted.tools,
      truncated: fitted.truncated,
      omittedTools: fitted.omittedTools,
      originalChars: fitted.originalChars,
      retainedChars: fitted.retainedChars,
      oversized: fitted.oversized,
      paginationTruncated: results.some((item) => item.config && connections.get(cacheKeyOf(item.config))?.pagesTruncated === true),
      skipped: results.filter((item) => item.skipped).map((item) => ({
        name: item.config.name,
        label: item.config.label,
        reason: item.state.reason,
        message: item.state.message,
      })),
      errors: results.filter((item) => item.error).map((item) => ({
        name: item.config.name,
        label: item.config.label,
        code: item.error?.code ?? 'mcp_error',
        message: item.error?.message ?? '连接失败。',
        retryable: item.error?.retryable === true,
      })),
      services: publicStatus().services,
    };
  }

  async function executeCall(config, remoteName, risk, args, callOptions, started) {
    let phase = 'initialize';
    // 一次工具调用：握手 → tools/call。会话过期（404）时重建会话再试一次。
    async function attempt() {
      phase = 'initialize';
      let connection = await ensureConnection(config);
      phase = 'tools/call';
      const callOnce = (conn) => rpc(config, 'tools/call', { name: remoteName, arguments: args ?? {} }, {
        sessionId: conn.sessionId,
        protocolVersion: conn.protocolVersion,
      });
      try {
        return await callOnce(connection);
      } catch (error) {
        if (risk !== 'read' || !(error instanceof McpError) || error.status !== 404) throw error;
        invalidateKey(config);
        connection = await ensureConnection(config);
        phase = 'tools/call';
        return callOnce(connection);
      }
    }
    // 只有只读工具自动重试；下单/支付类失败一律不重试，避免重复下单。
    const retries = risk === 'read' && callOptions.retry !== false ? tuning.retries : 0;
    try {
      const { result } = await withRetry(config, attempt, { retries });
      const payload = result ?? {};
      const isError = payload.isError === true;
      const truncated = truncateCallResult(payload, tuning.callMaxChars);
      const clean = !isError;
      recordAuditEntry({
        tool: `${config.prefix}${remoteName}`,
        service: config.name,
        risk,
        ok: clean,
        error: clean ? null : 'mcp_tool_error',
        summary: `${config.label} · ${remoteName} · ${clean ? '成功' : '工具返回错误'} · ${truncated.originalChars} 字符${truncated.truncated ? '（已截断）' : ''}`,
        durationMs: now() - started,
        truncated: truncated.truncated,
      });
      return {
        ok: clean,
        code: clean ? 'ok' : 'mcp_tool_error',
        service: config.name,
        label: config.label,
        tool: remoteName,
        fullName: `${config.prefix}${remoteName}`,
        risk,
        requestSent: true,
        isError,
        truncated: truncated.truncated,
        originalChars: truncated.originalChars,
        retainedChars: truncated.retainedChars,
        contentKinds: truncated.contentKinds,
        text: truncated.text,
        parts: truncated.parts,
        structuredContent: truncated.structuredContent,
        structuredSummary: truncated.structuredSummary,
        durationMs: now() - started,
      };
    } catch (error) {
      lastErrors.set(cacheKeyOf(config), error);
      auditFailure(config, `${config.prefix}${remoteName}`, risk, error, started, phase);
      return {
        ok: false,
        code: error instanceof McpError ? error.code : 'mcp_error',
        message: error instanceof Error ? error.message : 'MCP 调用失败。',
        service: config.name,
        label: config.label,
        tool: remoteName,
        fullName: `${config.prefix}${remoteName}`,
        risk,
        requestSent: phase === 'tools/call',
        phase,
        retryable: error instanceof McpError && error.retryable === true,
        durationMs: now() - started,
      };
    }
  }

  /**
   * 调用一个带前缀的工具。
   *
   * options.confirmed   order 类必须为 true（表示用户已确认），否则不发请求
   * options.requestId   order 类用来做本地幂等去重
   * options.retry       read 类默认允许传输层重试；order 类默认不重试
   *
   * 返回对象永远带 ok 与 code，不抛异常（网络类失败也落成对象），
   * 方便 agentApi 直接翻译成助手可读结果。
   */
  async function callTool(fullName, args = {}, callOptions = {}) {
    const started = now();
    const target = identify(fullName);
    if (!target) {
      return {
        ok: false,
        code: 'mcp_unknown_tool',
        message: `没有「${fullName}」这个生活服务工具。`,
        requestSent: false,
      };
    }
    const { config, remoteName } = target;
    const risk = riskForTool(config.name, remoteName);
    const fullToolName = `${config.prefix}${remoteName}`;
    const state = stateOf(config);
    if (state.effectiveTransport !== 'http' || state.reason !== 'ready') {
      const code = state.reason === 'disabled' ? 'mcp_disabled' : 'mcp_not_configured';
      recordAuditEntry({
        tool: fullToolName,
        service: config.name,
        risk,
        ok: false,
        error: code,
        summary: `${config.label} · 未配置/未启用，未发起请求 · ${state.message}`,
        durationMs: now() - started,
      });
      return {
        ok: false,
        code,
        reason: state.reason,
        message: state.message,
        service: config.name,
        label: config.label,
        tool: remoteName,
        fullName: fullToolName,
        risk,
        requestSent: false,
      };
    }
    if (risk === 'pay') {
      recordAuditEntry({
        tool: fullToolName,
        service: config.name,
        risk,
        ok: false,
        error: 'mcp_pay_blocked',
        summary: `${config.label} · 支付类工具被拦下，未发起请求`,
        durationMs: now() - started,
      });
      return {
        ok: false,
        code: 'mcp_pay_blocked',
        message: '支付/退款类操作不代做，请到官方 App 自行完成支付。',
        service: config.name,
        label: config.label,
        tool: remoteName,
        fullName: fullToolName,
        risk,
        requestSent: false,
      };
    }
    if (risk === 'order' && callOptions.confirmed !== true) {
      recordAuditEntry({
        tool: fullToolName,
        service: config.name,
        risk,
        ok: false,
        error: 'mcp_order_confirmation_required',
        summary: `${config.label} · 下单类工具缺少用户确认，未发起请求`,
        durationMs: now() - started,
      });
      return {
        ok: false,
        code: 'mcp_order_confirmation_required',
        message: '这是会产生真实订单的操作，需要用户下一句明确确认后才执行。',
        needsConfirmation: true,
        service: config.name,
        label: config.label,
        tool: remoteName,
        fullName: fullToolName,
        risk,
        requestSent: false,
      };
    }

    const execute = () => executeCall(config, remoteName, risk, args, callOptions, started);
    if (risk === 'order') {
      const requestId = String(callOptions.requestId ?? '').trim();
      if (requestId) {
        const dedupeKey = `${config.name}\u0000${remoteName}\u0000${requestId}`;
        const prior = orderCalls.get(dedupeKey);
        if (prior) {
          const replay = await prior;
          return { ...replay, deduplicated: true };
        }
        const running = execute();
        orderCalls.set(dedupeKey, running);
        const timer = setTimeout(() => orderCalls.delete(dedupeKey), tuning.orderDedupeMs);
        timer.unref?.();
        const result = await running;
        return result;
      }
    }
    return execute();
  }

  function invalidate(name = '') {
    if (!name) {
      connections.clear();
      lastErrors.clear();
      return;
    }
    for (const config of configs) {
      if (config.name === name) invalidateKey(config);
    }
  }

  return {
    listTools,
    callTool,
    status: publicStatus,
    invalidate,
    audit,
    // 对外只给脱敏视图：不返回原始 url 与 headers，避免设置页/日志把 Key 带出去。
    configs: () => configs.map((config) => ({
      name: config.name,
      label: config.label,
      prefix: config.prefix,
      risk: config.risk,
      transport: config.transport,
      effectiveTransport: config.transport === 'stdio' && config.hasUrl ? 'http' : config.transport,
      scenarios: config.scenarios,
      enabled: config.enabled,
      source: config.source,
      hasUrl: config.hasUrl === true,
      maskedUrl: config.url ? mask(config.url) : '',
      setup: config.setup,
      docs: config.docs,
    })),
  };
}

function mask(url) {
  try {
    const parsed = new URL(String(url));
    for (const key of [...parsed.searchParams.keys()]) parsed.searchParams.set(key, '***');
    return parsed.toString();
  } catch {
    return '（地址格式不正确）';
  }
}
