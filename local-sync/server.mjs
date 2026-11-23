import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createPlannerStore } from './plannerStore.mjs';
import { createCalendarStore } from './calendarStore.mjs';
import { AgentError, createAgentApi } from './agentApi.mjs';
import { AssistantError, createAssistant } from './assistant.mjs';
import { createCampusApi } from './campusRoutes.mjs';
import { CONFIG_PATH as MCP_CONFIG_DEFAULT, getResolvedConfigs, listServiceStatus, readMcpStore, removeServiceConfig, saveServiceConfig } from './mcpConfig.mjs';
import { createAuditSink, createMcpGateway } from './mcpGateway.mjs';
import { callReadOnlyTool } from './mcpToolbox.mjs';

const PORT = Number(process.env.PORT || 18787);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.SHUNSHOU_DATA_DIR || path.join(process.cwd(), 'local-sync', 'data');
const SAMPLES_FILE = path.join(DATA_DIR, 'samples.json');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const AUDIT_FILE = path.join(DATA_DIR, 'agent-audit.json');
const HDU_TARGET = new URL(process.env.HDU_HELPER_URL ?? 'http://127.0.0.1:8000');
const MAX_BODY = 2_000_000;
const MAX_SAMPLES = 500;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AGENT_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_AGENT_TOKENS = 20;
const MAX_AUDIT = 200;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LIMIT = 8;
const PAIR_TTL_MS = Number(process.env.SHUNSHOU_PAIR_TTL_MS || 2 * 60 * 1000);
const PAIR_WINDOW_MS = 5 * 60 * 1000;
const PAIR_LIMIT = 10;
const MAX_PAIR_CODES = 10;

// 网页部署在别处时，用 ALLOWED_ORIGINS 追加，逗号分隔。
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  ...String(process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
]);

function readJson(file, fallback) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const scrypt = (password, salt) => crypto.scryptSync(password, salt, 32).toString('hex');

function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(10), (byte) => alphabet[byte % alphabet.length]).join('');
}

function normalizeAgentToken(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.id !== 'string' || typeof item.hash !== 'string' || (item.scope !== 'read' && item.scope !== 'write')) return null;
  if (!Number.isSafeInteger(item.expiresAt)) return null;
  return {
    id: item.id,
    name: typeof item.name === 'string' ? item.name.slice(0, 40) : 'agent',
    scope: item.scope,
    hash: item.hash,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(item.expiresAt - AGENT_TOKEN_TTL_MS).toISOString(),
    lastUsedAt: typeof item.lastUsedAt === 'string' ? item.lastUsedAt : null,
    expiresAt: item.expiresAt,
  };
}

function loadAuthFile() {
  const value = readJson(AUTH_FILE, null);
  if (!value || typeof value !== 'object' || typeof value.passwordHash !== 'string' || typeof value.salt !== 'string') return null;
  return {
    salt: value.salt,
    passwordHash: value.passwordHash,
    tokens: Array.isArray(value.tokens) ? value.tokens : [],
    agentTokens: Array.isArray(value.agentTokens) ? value.agentTokens.map(normalizeAgentToken).filter(Boolean) : [],
  };
}

function ensurePassword() {
  const auth = loadAuthFile();
  const fromEnv = String(process.env.SHUNSHOU_PASSWORD ?? '');
  if (fromEnv.length >= 8) {
    const salt = crypto.randomBytes(16).toString('hex');
    const next = { salt, passwordHash: scrypt(fromEnv, salt), tokens: auth?.tokens ?? [], agentTokens: auth?.agentTokens ?? [] };
    writeJson(AUTH_FILE, next);
    return next;
  }
  if (auth) return auth;
  const password = randomPassword();
  const salt = crypto.randomBytes(16).toString('hex');
  const next = { salt, passwordHash: scrypt(password, salt), tokens: [], agentTokens: [] };
  writeJson(AUTH_FILE, next);
  console.log(`首次启动访问口令: ${password}`);
  console.log('口令只在这里显示一次，已按哈希保存在 local-sync/data/auth.json；忘记可删除该文件重新生成。');
  return next;
}

function passwordMatches(auth, password) {
  const candidate = Buffer.from(scrypt(password, auth.salt), 'hex');
  const expected = Buffer.from(auth.passwordHash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function issueToken(auth) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  auth.tokens = auth.tokens.filter((item) => item && item.expiresAt > now).slice(-20);
  auth.tokens.push({ hash: sha256(token), expiresAt: now + TOKEN_TTL_MS });
  writeJson(AUTH_FILE, auth);
  return { token, expiresAt: now + TOKEN_TTL_MS };
}

function revokeToken(auth, token) {
  const hash = sha256(token);
  auth.tokens = auth.tokens.filter((item) => item.hash !== hash);
  writeJson(AUTH_FILE, auth);
}

function publicAgent(item) {
  return { id: item.id, name: item.name, scope: item.scope, createdAt: item.createdAt, lastUsedAt: item.lastUsedAt, expiresAt: item.expiresAt };
}

function issueAgentToken(auth, name, scope) {
  const now = Date.now();
  const existing = (auth.agentTokens ?? []).filter((item) => item.expiresAt > now);
  if (existing.length >= MAX_AGENT_TOKENS) throw new Error('too_many_tokens');
  const token = crypto.randomBytes(32).toString('base64url');
  const record = {
    id: crypto.randomUUID(), name, scope, hash: sha256(token),
    createdAt: new Date(now).toISOString(), lastUsedAt: null, expiresAt: now + AGENT_TOKEN_TTL_MS,
  };
  auth.agentTokens = [...existing, record];
  writeJson(AUTH_FILE, auth);
  return { token, agent: publicAgent(record) };
}

function revokeAgentToken(auth, id) {
  const before = auth.agentTokens?.length ?? 0;
  auth.agentTokens = (auth.agentTokens ?? []).filter((item) => item.id !== id);
  if (auth.agentTokens.length === before) return false;
  writeJson(AUTH_FILE, auth);
  return true;
}

const authState = ensurePassword();

function authorized(request) {
  const header = String(request.headers.authorization ?? '');
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const hash = sha256(token);
  const now = Date.now();
  const session = authState.tokens.find((item) => item && item.hash === hash && item.expiresAt > now);
  if (session) return { kind: 'session', token };
  const agent = (authState.agentTokens ?? []).find((item) => item.hash === hash && item.expiresAt > now);
  if (!agent) return null;
  const previous = agent.lastUsedAt ? Date.parse(agent.lastUsedAt) : 0;
  agent.lastUsedAt = new Date(now).toISOString();
  if (!Number.isFinite(previous) || now - previous > 5 * 60_000) {
    try { writeJson(AUTH_FILE, authState); } catch { /* 最近使用时间写入失败不影响本次认证。 */ }
  }
  return { kind: 'agent', id: agent.id, name: agent.name, scope: agent.scope, token };
}

function loadAudit() {
  const value = readJson(AUDIT_FILE, []);
  return Array.isArray(value) ? value : [];
}

function recordAudit(entry) {
  try { writeJson(AUDIT_FILE, [...loadAudit(), entry].slice(-MAX_AUDIT)); } catch { /* 记录失败不影响接口结果。 */ }
}

const loginAttempts = new Map();
function loginBlocked(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= LOGIN_LIMIT;
}
function recordFail(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else entry.count += 1;
}

const pairCodes = new Map();
const pairAttempts = new Map();

function issuePairCode() {
  const now = Date.now();
  for (const [code, entry] of pairCodes) if (entry.expiresAt <= now) pairCodes.delete(code);
  while (pairCodes.size >= MAX_PAIR_CODES) pairCodes.delete(pairCodes.keys().next().value);
  const code = crypto.randomBytes(5).toString('hex');
  pairCodes.set(code, { expiresAt: now + PAIR_TTL_MS });
  return { code, expiresAt: now + PAIR_TTL_MS };
}

function pairBlocked(ip) {
  const entry = pairAttempts.get(ip);
  if (!entry || entry.resetAt <= Date.now()) return false;
  return entry.count >= PAIR_LIMIT;
}

function recordPairFail(ip) {
  const now = Date.now();
  const entry = pairAttempts.get(ip);
  if (!entry || entry.resetAt <= now) pairAttempts.set(ip, { count: 1, resetAt: now + PAIR_WINDOW_MS });
  else entry.count += 1;
}

function lanCandidates() {
  if (HOST !== '0.0.0.0' && HOST !== '::') return [];
  const list = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const item of addresses ?? []) {
      if (item.family === 'IPv4' && !item.internal) list.push({ label: name, url: `http://${item.address}:${PORT}` });
    }
  }
  return list;
}

function cors(request, response) {
  const origin = request.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, Idempotency-Key');
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body_too_large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function loadSamples() {
  const value = readJson(SAMPLES_FILE, []);
  return Array.isArray(value) ? value : [];
}

function validLedger(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) return false;
  if (!Array.isArray(value.records) || !Array.isArray(value.workplaces)) return false;
  if (value.records.length > 20000 || value.workplaces.length > 2000) return false;
  return Boolean(value.settings) && typeof value.settings === 'object' && Number.isSafeInteger(value.settings.hourlyRateCents);
}

function loadLedgerDoc() {
  const value = readJson(LEDGER_FILE, null);
  if (!value || typeof value !== 'object' || typeof value.updatedAt !== 'string' || !validLedger(value.ledger)) return null;
  return { ledger: value.ledger, updatedAt: value.updatedAt };
}

function rewriteCookie(cookie, secure, crossSite) {
  let value = String(cookie)
    .replace(/;\s*domain=[^;]*/gi, '')
    .replace(/;\s*samesite=[^;]*/gi, '')
    .replace(/;\s*secure/gi, '');
  if (!/;\s*path=/i.test(value)) value += '; Path=/';
  if (secure && crossSite) return `${value}; SameSite=None; Secure`;
  if (secure) return `${value}; Secure`;
  return value;
}

function proxyCampus(request, response, url) {
  const headers = { ...request.headers };
  delete headers.connection;
  delete headers.host;
  delete headers.origin;
  headers.host = HDU_TARGET.host;
  headers.origin = HDU_TARGET.origin;
  headers['sec-fetch-site'] = 'same-origin';
  const proxyRequest = http.request({
    hostname: HDU_TARGET.hostname,
    port: HDU_TARGET.port || 80,
    path: `${url.pathname}${url.search}`,
    method: request.method,
    headers,
  }, (proxyResponse) => {
    const outHeaders = { ...proxyResponse.headers };
    const cookies = proxyResponse.headers['set-cookie'];
    if (cookies) {
      const forwarded = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
      const origin = String(request.headers.origin ?? '');
      let crossSite = false;
      try { crossSite = Boolean(origin) && new URL(origin).host !== String(request.headers.host ?? ''); } catch { /* 非法 Origin 按同站处理。 */ }
      const secure = forwarded === 'https' || origin.startsWith('https://') || Boolean(request.socket.encrypted);
      outHeaders['set-cookie'] = cookies.map((cookie) => rewriteCookie(cookie, secure, crossSite));
    }
    response.writeHead(proxyResponse.statusCode ?? 502, outHeaders);
    proxyResponse.pipe(response);
  });
  proxyRequest.setTimeout(70_000, () => proxyRequest.destroy(new Error('campus_timeout')));
  proxyRequest.on('error', () => {
    if (!response.headersSent) json(response, 502, { ok: false, error: 'campus_unavailable' });
    else response.end();
  });
  request.pipe(proxyRequest);
}

let plannerStore;
// 生活服务 MCP：配置在 local-sync/data/mcp-servers.json，凭据只进进程内配置，
// 状态接口只返回脱敏地址与请求头名称。保存后重建网关，让新地址立即生效。
const MCP_CONFIG_FILE = process.env.SHUNSHOU_MCP_CONFIG || path.join(DATA_DIR, 'mcp-servers.json');

function mcpCliProbe(config) {
  const bin = typeof config?.cli?.bin === 'string' ? config.cli.bin : typeof config?.bin === 'string' ? config.bin : '';
  if (!bin) return false;
  const directories = String(process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? [`${bin}.cmd`, `${bin}.exe`, `${bin}.bat`, bin] : [bin];
  for (const directory of directories) {
    for (const name of names) {
      try { if (fs.existsSync(path.join(directory, name))) return true; } catch { /* 读不到这个目录就继续找。 */ }
    }
  }
  return false;
}

let mcpGateway;
function resetMcpGateway() { mcpGateway = null; }
function getMcpGateway() {
  if (!mcpGateway) {
    mcpGateway = createMcpGateway({
      configs: getResolvedConfigs({ path: MCP_CONFIG_FILE }),
      audit: createAuditSink({ write: (entry) => recordAudit(entry) }),
      probeCli: mcpCliProbe,
    });
  }
  return mcpGateway;
}

function mcpServiceView(service, gateway) {
  const live = gateway?.status()?.services?.find((item) => item.name === service.name) ?? null;
  const status = live?.connected ? 'ready' : (service.state?.status ?? 'unknown');
  return {
    name: service.name,
    label: service.label,
    prefix: service.prefix,
    transport: service.transport,
    enabled: service.enabled,
    configured: service.configured,
    urlMasked: service.urlMasked,
    headerNames: Array.isArray(service.headerKeys) ? service.headerKeys : [],
    scenarios: Array.isArray(service.scenarios) ? service.scenarios : [],
    setup: service.setup ?? '',
    state: {
      status,
      message: live?.connected ? (live.toolCount ? `已连接，${live.toolCount} 个工具。` : '已连接。')
        : (live?.lastErrorMessage || service.state?.message || ''),
    },
  };
}

const getPlannerStore = () => plannerStore ??= createPlannerStore(DATA_DIR);
let calendarStore;
const getCalendarStore = () => calendarStore ??= createCalendarStore(DATA_DIR);
let agentApi;
const getAgentApi = () => agentApi ??= createAgentApi({
  readPlanner: () => getPlannerStore().read(),
  execute: (input) => getPlannerStore().execute(input),
  readCalendars: () => getCalendarStore().read(),
  readLedger: () => {
    if (!fs.existsSync(LEDGER_FILE)) return null;
    const doc = loadLedgerDoc();
    if (!doc) throw Object.assign(new Error('ledger_storage_corrupt'), { code: 'ledger_storage_corrupt' });
    return doc.ledger;
  },
  writeLedger: (ledger) => {
    if (!validLedger(ledger)) throw new Error('invalid_ledger');
    writeJson(LEDGER_FILE, { ledger, updatedAt: new Date().toISOString() });
  },
  campus: () => getCampusApi(),
  mcp: () => getMcpGateway(),
});
let assistant;
const getAssistant = () => assistant ??= createAssistant({
  directory: DATA_DIR,
  getTools: async () => (await getAgentApi().manifest({ kind: 'assistant', name: '内置助手', scope: 'write' })).tools,
  getBriefFacts: async (scope) => {
    const tool = scope === 'week' ? 'week_review' : 'day_brief';
    const result = await getAgentApi().call({ tool, arguments: {}, scope: 'read', actor: 'assistant', caller: { kind: 'assistant', name: '内置助手', scope: 'write' } });
    return result.result;
  },
  callTool: async ({ tool, args, requestId }) => {
    const summary = JSON.stringify(args ?? {}).slice(0, 500);
    try {
      const result = await getAgentApi().call({ tool, arguments: args, requestId, scope: 'write', actor: 'assistant', caller: { kind: 'assistant', name: '内置助手', scope: 'write' } });
      recordAudit({ at: new Date().toISOString(), actor: '内置助手', actorKind: 'session', tool, summary, ok: true, error: null, revision: result.revision ?? null });
      return { ok: true, ...result };
    } catch (error) {
      recordAudit({ at: new Date().toISOString(), actor: '内置助手', actorKind: 'session', tool, summary, ok: false, error: error?.code ?? 'agent_error', revision: null });
      return { ok: false, error: error?.code ?? 'agent_error', message: error instanceof Error ? error.message : '操作未完成。' };
    }
  },
});
let campusApi;
const getCampusApi = () => campusApi ??= createCampusApi({ directory: DATA_DIR, helperUrl: HDU_TARGET });

const server = http.createServer(async (request, response) => {
  cors(request, response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    json(response, 200, { ok: true, service: 'shunshou-gateway' });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/login') {
    const ip = request.socket.remoteAddress ?? 'unknown';
    if (loginBlocked(ip)) {
      json(response, 429, { ok: false, error: 'too_many_attempts' });
      return;
    }
    try {
      const body = JSON.parse(await readBody(request));
      const password = typeof body?.password === 'string' ? body.password : '';
      if (!password || !passwordMatches(authState, password)) {
        recordFail(ip);
        json(response, 401, { ok: false, error: 'invalid_password' });
        return;
      }
      loginAttempts.delete(ip);
      const issued = issueToken(authState);
      json(response, 200, { ok: true, token: issued.token, expiresAt: issued.expiresAt });
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'body_too_large';
      json(response, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'body_too_large' : 'invalid_json' });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/pair') {
    const ip = request.socket.remoteAddress ?? 'unknown';
    if (pairBlocked(ip)) {
      json(response, 429, { ok: false, error: 'too_many_attempts' });
      return;
    }
    try {
      const body = JSON.parse(await readBody(request));
      const code = typeof body?.code === 'string' ? body.code.trim().toLowerCase() : '';
      const entry = code ? pairCodes.get(code) : null;
      if (!entry || entry.expiresAt <= Date.now()) {
        recordPairFail(ip);
        json(response, 401, { ok: false, error: 'invalid_code' });
        return;
      }
      pairCodes.delete(code);
      pairAttempts.delete(ip);
      const issued = issueToken(authState);
      json(response, 200, { ok: true, token: issued.token, expiresAt: issued.expiresAt });
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'body_too_large';
      json(response, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'body_too_large' : 'invalid_json' });
    }
    return;
  }

  const session = authorized(request);
  if (!session) {
    json(response, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  const allowedOrigin = !request.headers.origin || ALLOWED_ORIGINS.has(request.headers.origin);

  if (request.method === 'POST' && url.pathname === '/api/pair/code') {
    if (session.kind !== 'session') {
      json(response, 403, { ok: false, error: 'session_required' });
      return;
    }
    if (!allowedOrigin) {
      json(response, 403, { ok: false, error: 'origin_denied' });
      return;
    }
    json(response, 200, { ok: true, ...issuePairCode(), urls: lanCandidates() });
    return;
  }

  if (url.pathname === '/api/mcp/tools' && request.method === 'GET') {
    if (session.kind !== 'session') { json(response, 403, { ok: false, error: 'session_required' }); return; }
    if (!allowedOrigin) { json(response, 403, { ok: false, error: 'origin_denied' }); return; }
    try {
      const listing = await getMcpGateway().listTools({});
      json(response, 200, {
        ok: true,
        tools: listing.tools.map((tool) => ({
          name: tool.name, service: tool.service, risk: tool.risk,
          description: tool.description, inputSchema: tool.inputSchema,
        })),
        skipped: listing.skipped ?? [],
        errors: listing.errors ?? [],
        omittedTools: listing.omittedTools ?? 0,
      });
    } catch (error) {
      json(response, 502, { ok: false, error: error?.code ?? 'mcp_error', message: error instanceof Error ? error.message : '读取工具列表失败。' });
    }
    return;
  }

  if (url.pathname === '/api/mcp/call' && request.method === 'POST') {
    if (session.kind !== 'session') { json(response, 403, { ok: false, error: 'session_required' }); return; }
    if (!allowedOrigin) { json(response, 403, { ok: false, error: 'origin_denied' }); return; }
    let body;
    try { body = JSON.parse(await readBody(request)); } catch {
      json(response, 400, { ok: false, error: 'invalid_json', message: '请求体不是合法 JSON。' });
      return;
    }
    const tool = typeof body?.tool === 'string' ? body.tool.trim() : '';
    if (!tool) { json(response, 400, { ok: false, error: 'invalid_tool', message: '请提供工具名。' }); return; }
    const args = body?.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};
    const result = await callReadOnlyTool(getMcpGateway(), tool, args);
    json(response, result.ok ? 200 : result.code === 'tool_not_read_only' ? 400 : 502, { ...result });
    return;
  }

  if (url.pathname === '/api/mcp/services' && request.method === 'GET') {
    if (session.kind !== 'session') { json(response, 403, { ok: false, error: 'session_required' }); return; }
    if (!allowedOrigin) { json(response, 403, { ok: false, error: 'origin_denied' }); return; }
    const listing = listServiceStatus({ path: MCP_CONFIG_FILE, probeCli: mcpCliProbe });
    json(response, 200, {
      ok: true,
      services: listing.services.map((service) => mcpServiceView(service, getMcpGateway())),
      store: { exists: listing.exists, reason: listing.reason },
    });
    return;
  }

  const mcpMatch = url.pathname.match(/^\/api\/mcp\/services\/([a-z0-9_-]{1,40})(?:\/(probe))?$/);
  if (mcpMatch) {
    if (session.kind !== 'session') { json(response, 403, { ok: false, error: 'session_required' }); return; }
    if (!allowedOrigin) { json(response, 403, { ok: false, error: 'origin_denied' }); return; }
    const name = mcpMatch[1];
    const isProbe = mcpMatch[2] === 'probe';
    try {
      if (isProbe && request.method === 'POST') {
        const gateway = getMcpGateway();
        const listed = await gateway.listTools({ service: name, refresh: true });
        if (!listed.tools.length) {
          const failure = listed.errors.find((item) => item.name === name) ?? listed.errors[0];
          throw new AgentError(400, failure?.code ?? 'mcp_not_configured', failure?.message ?? '这个服务现在连不上。');
        }
        json(response, 200, {
          ok: true, toolCount: listed.tools.length, tools: listed.tools.map((item) => item.name),
          truncated: listed.truncated, omittedTools: listed.omittedTools,
          message: `连接成功，发现 ${listed.tools.length} 个工具。`,
        });
        return;
      }
      if (request.method === 'PUT') {
        const body = JSON.parse(await readBody(request));
        saveServiceConfig(name, body, { path: MCP_CONFIG_FILE });
        resetMcpGateway();
        const entry = listServiceStatus({ path: MCP_CONFIG_FILE, probeCli: mcpCliProbe }).services.find((item) => item.name === name);
        json(response, 200, { ok: true, service: mcpServiceView(entry, getMcpGateway()) });
        return;
      }
      if (request.method === 'DELETE') {
        const removed = removeServiceConfig(name, { path: MCP_CONFIG_FILE });
        resetMcpGateway();
        const entry = listServiceStatus({ path: MCP_CONFIG_FILE, probeCli: mcpCliProbe }).services.find((item) => item.name === name);
        json(response, 200, { ok: true, removed: removed.removed === true, service: mcpServiceView(entry, getMcpGateway()) });
        return;
      }
      json(response, 405, { ok: false, error: 'method_not_allowed' });
    } catch (error) {
      if (error?.code === 'mcp_unknown_service') { json(response, 404, { ok: false, error: error.code, message: error.message }); return; }
      if (error?.code === 'mcp_invalid_config') { json(response, 400, { ok: false, error: error.code, message: error.message }); return; }
      if (error?.code === 'mcp_config_write_failed') { json(response, 500, { ok: false, error: error.code, message: error.message }); return; }
      json(response, error instanceof AgentError ? error.status : 502, { ok: false, error: error?.code ?? 'mcp_error', message: error instanceof Error ? error.message : '生活服务请求失败。' });
    }
    return;
  }

  if (url.pathname.startsWith('/api/campus/')) {
    await getCampusApi().handle(request, response, url, { session, allowedOrigin });
    return;
  }

  if (url.pathname === '/api/agent/tokens' || url.pathname.startsWith('/api/agent/tokens/')) {
    if (session.kind !== 'session') {
      json(response, 403, { ok: false, error: 'session_required' });
      return;
    }
    if (!allowedOrigin) {
      json(response, 403, { ok: false, error: 'origin_denied' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/agent/tokens') {
      json(response, 200, { ok: true, agents: (authState.agentTokens ?? []).filter((item) => item.expiresAt > Date.now()).map(publicAgent) });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/agent/tokens') {
      try {
        const body = JSON.parse(await readBody(request));
        const name = typeof body?.name === 'string' ? body.name.trim() : '';
        if (name.length < 1 || name.length > 40) {
          json(response, 400, { ok: false, error: 'invalid_name' });
          return;
        }
        if (body?.scope !== 'read' && body?.scope !== 'write') {
          json(response, 400, { ok: false, error: 'invalid_scope' });
          return;
        }
        json(response, 200, { ok: true, ...issueAgentToken(authState, name, body.scope) });
      } catch (error) {
        const tooLarge = error instanceof Error && error.message === 'body_too_large';
        const tooMany = error instanceof Error && error.message === 'too_many_tokens';
        json(response, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'body_too_large' : tooMany ? 'too_many_tokens' : 'invalid_json' });
      }
      return;
    }
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/agent/tokens/')) {
      let id = url.pathname.slice('/api/agent/tokens/'.length);
      try { id = decodeURIComponent(id); } catch { /* 非法编码按无效令牌处理。 */ }
      if (!id || id.includes('/') || !revokeAgentToken(authState, id)) {
        json(response, 404, { ok: false, error: 'token_not_found' });
        return;
      }
      json(response, 200, { ok: true });
      return;
    }
    json(response, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/agent/audit') {
    if (session.kind !== 'session') {
      json(response, 403, { ok: false, error: 'session_required' });
      return;
    }
    if (!allowedOrigin) {
      json(response, 403, { ok: false, error: 'origin_denied' });
      return;
    }
    json(response, 200, { ok: true, entries: loadAudit().slice(-50).reverse() });
    return;
  }

  if (url.pathname.startsWith('/api/assistant/')) {
    if (session.kind !== 'session') {
      json(response, 403, { ok: false, error: 'session_required' });
      return;
    }
    if (!allowedOrigin) {
      json(response, 403, { ok: false, error: 'origin_denied' });
      return;
    }
    try {
      if (request.method === 'GET' && url.pathname === '/api/assistant/settings') {
        json(response, 200, { ok: true, ...getAssistant().publicSettings() });
        return;
      }
      if (request.method === 'PUT' && url.pathname === '/api/assistant/settings') {
        const body = JSON.parse(await readBody(request));
        json(response, 200, { ok: true, ...getAssistant().updateSettings(body) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/assistant/test') {
        json(response, 200, { ok: true, result: await getAssistant().test() });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/assistant/briefing') {
        const scope = url.searchParams.get('scope') ?? 'day';
        if (scope !== 'day' && scope !== 'week') {
          json(response, 400, { ok: false, error: 'invalid_scope', message: 'scope 只能是 day 或 week。' });
          return;
        }
        const fresh = url.searchParams.get('fresh') === '1';
        json(response, 200, { ok: true, ...(await getAssistant().briefing({ scope, fresh })) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/assistant/chat') {
        const body = JSON.parse(await readBody(request));
        json(response, 200, { ok: true, ...(await getAssistant().chat(body?.messages)) });
        return;
      }
      json(response, 405, { ok: false, error: 'method_not_allowed' });
      return;
    } catch (error) {
      if (error instanceof AssistantError) {
        json(response, error.status, { ok: false, error: error.code, message: error.message });
      } else if (error?.message === 'body_too_large') {
        json(response, 413, { ok: false, error: 'body_too_large', message: '内容太长，请分段发送。' });
      } else if (error instanceof SyntaxError) {
        json(response, 400, { ok: false, error: 'invalid_json', message: '请求格式不正确。' });
      } else if (typeof error?.code === 'string') {
        json(response, 503, { ok: false, error: 'storage_unavailable', message: '电脑上的数据暂时不可用。' });
      } else {
        json(response, 500, { ok: false, error: 'assistant_error', message: '助手执行失败。' });
      }
      return;
    }
  }

  if (session.kind === 'agent' && !url.pathname.startsWith('/api/v1/agent/')) {
    json(response, 403, { ok: false, error: 'agent_token_restricted' });
    return;
  }

  if (url.pathname === '/api/v1/agent/manifest') {
    if (request.method !== 'GET') {
      json(response, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }
    if (!allowedOrigin) {
      json(response, 403, { ok: false, error: 'origin_denied' });
      return;
    }
    const caller = session.kind === 'agent'
      ? { kind: 'agent', name: session.name, scope: session.scope }
      : { kind: 'session', name: '网页登录', scope: 'write' };
    json(response, 200, { ok: true, ...(await getAgentApi().manifest(caller)) });
    return;
  }

  if (url.pathname === '/api/v1/agent/call') {
    if (request.method !== 'POST') {
      json(response, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }
    if (!allowedOrigin) {
      json(response, 403, { ok: false, error: 'origin_denied' });
      return;
    }
    let body;
    try { body = JSON.parse(await readBody(request)); }
    catch (error) {
      const tooLarge = error instanceof Error && error.message === 'body_too_large';
      json(response, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'body_too_large' : 'invalid_json' });
      return;
    }
    const tool = typeof body?.tool === 'string' ? body.tool : '';
    const caller = session.kind === 'agent'
      ? { kind: 'agent', name: session.name, scope: session.scope }
      : { kind: 'session', name: '网页登录', scope: 'write' };
    const actor = session.kind === 'agent' ? session.id : 'web-session';
    const audit = { at: new Date().toISOString(), actor: caller.name, actorKind: session.kind, tool, summary: JSON.stringify(body?.arguments ?? {}).slice(0, 500) };
    if (!tool) {
      recordAudit({ ...audit, ok: false, error: 'invalid_request', revision: null });
      json(response, 400, { ok: false, error: 'invalid_request', message: '缺少 tool。' });
      return;
    }
    try {
      const requestId = String(request.headers['idempotency-key'] ?? body?.requestId ?? '');
      const result = await getAgentApi().call({
        tool, arguments: body?.arguments ?? {}, requestId, actor,
        scope: session.kind === 'agent' ? session.scope : 'write', caller,
      });
      recordAudit({ ...audit, ok: true, error: null, revision: result.revision });
      json(response, 200, { ok: true, result: result.result, revision: result.revision, serverId: result.serverId });
    } catch (error) {
      const failure = error instanceof AgentError
        ? { status: error.status, body: { ok: false, error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }
        : error?.name === 'ZodError'
          ? { status: 400, body: { ok: false, error: 'invalid_arguments', message: '参数格式不正确。' } }
          : error?.message === 'operation_reused'
            ? { status: 409, body: { ok: false, error: 'request_id_reused', message: '这个 Idempotency-Key 已经用于另一个不同操作。' } }
            : error?.message === 'conflict'
              ? { status: 409, body: { ok: false, error: 'conflict', message: '数据正在被另一处修改，请重试。' } }
              : (typeof error?.code === 'string' || error?.message === 'planner_storage_corrupt' || error?.message === 'calendar_storage_corrupt')
                ? { status: 503, body: { ok: false, error: 'storage_unavailable', message: '电脑上的数据暂时不可用。' } }
                : { status: 500, body: { ok: false, error: 'agent_error', message: '助手接口执行失败。' } };
      recordAudit({ ...audit, ok: false, error: failure.body.error, revision: null });
      json(response, failure.status, failure.body);
    }
    return;
  }

  if (url.pathname === '/api/planner' || url.pathname === '/api/planner/operations') {
    if (request.headers.origin && !ALLOWED_ORIGINS.has(request.headers.origin)) {
      json(response, 403, { ok: false, error: 'origin_denied' });
      return;
    }
    try {
      if (request.method === 'GET' && url.pathname === '/api/planner') {
        json(response, 200, getPlannerStore().read());
      } else if (request.method === 'POST' && url.pathname === '/api/planner/operations') {
        const input = JSON.parse(await readBody(request));
        json(response, 200, getPlannerStore().execute(input));
      } else json(response, 405, { ok: false, error: 'method_not_allowed' });
    } catch (error) {
      const conflict = error.message === 'conflict' || error.message === 'operation_reused';
      const badInput = error.name === 'ZodError' || error instanceof SyntaxError;
      const storage = error.message === 'planner_storage_corrupt' || typeof error.code === 'string';
      json(response, conflict ? 409 : error.message === 'body_too_large' ? 413 : storage ? 503 : 400,
        { ok: false, error: conflict ? 'conflict' : storage ? 'storage_unavailable' : badInput ? 'invalid_input' : 'operation_rejected' });
    }
    return;
  }

  if (url.pathname === '/api/calendar' || url.pathname === '/api/calendar/snapshot') {
    if (request.headers.origin && !ALLOWED_ORIGINS.has(request.headers.origin)) {
      json(response, 403, { ok: false, error: 'origin_denied' });
      return;
    }
    try {
      if (request.method === 'GET' && url.pathname === '/api/calendar') json(response, 200, { sources: getCalendarStore().read(), serverId: getPlannerStore().read().serverId });
      else if (request.method === 'PUT' && url.pathname === '/api/calendar/snapshot') json(response, 200, getCalendarStore().upload(JSON.parse(await readBody(request))));
      else json(response, 405, { ok: false, error: 'method_not_allowed' });
    } catch (error) {
      const conflict = error.message === 'conflict' || error.message === 'operation_reused';
      const unavailable = error.message === 'calendar_storage_corrupt' || typeof error.code === 'string';
      json(response, conflict ? 409 : unavailable ? 503 : 400, { ok: false, error: conflict ? 'conflict' : unavailable ? 'storage_unavailable' : 'invalid_input' });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/logout') {
    revokeToken(authState, session.token);
    json(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/ledger') {
    const doc = loadLedgerDoc();
    json(response, 200, { ok: true, ledger: doc?.ledger ?? null, updatedAt: doc?.updatedAt ?? null });
    return;
  }

  if (request.method === 'PUT' && url.pathname === '/api/ledger') {
    try {
      const body = JSON.parse(await readBody(request));
      if (!validLedger(body?.ledger)) {
        json(response, 400, { ok: false, error: 'invalid_ledger' });
        return;
      }
      const current = loadLedgerDoc();
      const force = body?.force === true;
      const base = typeof body?.baseUpdatedAt === 'string' ? body.baseUpdatedAt : null;
      if (!force && current && base !== current.updatedAt) {
        json(response, 409, { ok: false, error: 'conflict', ledger: current.ledger, updatedAt: current.updatedAt });
        return;
      }
      const updatedAt = new Date().toISOString();
      writeJson(LEDGER_FILE, { ledger: body.ledger, updatedAt });
      json(response, 200, { ok: true, updatedAt });
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'body_too_large';
      json(response, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'body_too_large' : 'invalid_json' });
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/samples') {
    const samples = loadSamples();
    json(response, 200, { ok: true, samples });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/samples') {
    try {
      const body = JSON.parse(await readBody(request));
      const incoming = Array.isArray(body) ? body : body?.samples;
      if (!Array.isArray(incoming)) {
        json(response, 400, { ok: false, error: 'expected_sample_array' });
        return;
      }
      const current = loadSamples();
      const byId = new Map(current.map((item) => [String(item?.id ?? ''), item]));
      let added = 0;
      for (const item of incoming.slice(0, MAX_SAMPLES)) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) continue;
        if (!byId.has(item.id)) added += 1;
        byId.set(item.id, item);
      }
      const merged = [...byId.values()];
      writeJson(SAMPLES_FILE, merged);
      json(response, 200, { ok: true, added, total: merged.length });
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'body_too_large';
      json(response, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'body_too_large' : 'invalid_json' });
    }
    return;
  }

  if (url.pathname.startsWith('/web/')) {
    proxyCampus(request, response, url);
    return;
  }

  json(response, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, HOST, () => {
  console.log(`顺手网关: http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${server.address().port}`);
  console.log('网页填这个地址 + 访问口令；远程访问用 HTTPS 隧道地址。');
  console.log(`如需手机走局域网直连，用 HOST=0.0.0.0 npm run sync（不建议长期开放）。`);
});
