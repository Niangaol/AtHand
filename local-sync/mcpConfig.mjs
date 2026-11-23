/**
 * 生活服务 MCP 配置的读写与脱敏视图。
 *
 * 落盘位置：local-sync/data/mcp-servers.json（可用 SHUNSHOU_MCP_CONFIG 覆盖，
 * 测试可传 path 参数）。文件不存在、为空或损坏时一律按「未配置」降级，
 * 不抛异常、不影响服务启动。
 *
 * 文件结构（version 1）：
 *   {
 *     "version": 1,
 *     "services": {
 *       "amap": { "enabled": true, "url": "https://…", "headers": { "X-API-Key": "…" } }
 *     }
 *   }
 *
 * 约定：
 *   - 本模块不写死任何 Key/Token；默认地址与凭据全部来自 mcpServices。
 *   - 合成只调用 mcpServices.resolveConfigs({ stored, env })，不复制那套优先级逻辑。
 *   - readMcpStore / saveServiceConfig / removeServiceConfig / listServiceStatus
 *     的返回值是**脱敏视图**：url 用 maskUrl，headers 只给键名。
 *   - getResolvedConfigs 是进程内运行时配置（含真实 url/headers，仅供
 *     createMcpGateway/agentApi 使用），不要把它的返回值直接序列化给前端。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  MCP_SERVICES,
  MCP_SERVICE_BY_NAME,
  isHttpUrl,
  maskUrl,
  resolveConfigs,
  serviceState,
} from './mcpServices.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** 配置文件格式版本。 */
export const CONFIG_VERSION = 1;

/** 配置目录：默认 local-sync/data，可用 SHUNSHOU_MCP_DIR 覆盖。 */
export const CONFIG_DIR = process.env.SHUNSHOU_MCP_DIR
  ? path.resolve(process.env.SHUNSHOU_MCP_DIR)
  : path.join(MODULE_DIR, 'data');

/** 配置文件绝对路径：默认 local-sync/data/mcp-servers.json。 */
export const CONFIG_PATH = process.env.SHUNSHOU_MCP_CONFIG
  ? path.resolve(process.env.SHUNSHOU_MCP_CONFIG)
  : path.join(CONFIG_DIR, 'mcp-servers.json');

const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_URL_LENGTH = 4096;
const MAX_HEADERS = 64;
const MAX_HEADER_NAME = 100;
const MAX_HEADER_VALUE = 4000;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_ISSUES = 20;
const FORBIDDEN_HEADER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const HEADER_NAME_RE = /^[A-Za-z0-9_-]+$/;

/** 配置校验/写入失败时抛出的错误，带稳定 code 供路由映射 HTTP 状态。 */
export class McpConfigError extends Error {
  constructor(code, message, { field = null, cause = null } = {}) {
    super(message);
    this.name = 'McpConfigError';
    this.code = code;
    this.field = field;
    if (cause) this.cause = cause;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** 只用于中文提示的短标识，挡掉控制字符。 */
function safeLabel(value) {
  const text = typeof value === 'string' ? value : typeof value;
  return text.replace(/[^A-Za-z0-9_.-]/g, '?').slice(0, 40) || '空';
}

function errorCodeOf(error) {
  return typeof error?.code === 'string' ? error.code : 'unknown';
}

/** header 名/值校验；合法返回 null，不合法返回不含值的提示。 */
function headerProblem(key, value) {
  if (typeof key !== 'string' || key === '' || key.length > MAX_HEADER_NAME || !HEADER_NAME_RE.test(key)) {
    return 'header 名不合法（只允许字母、数字、下划线和短横线，且不能为空）。';
  }
  if (FORBIDDEN_HEADER_KEYS.has(key)) {
    return `header 名「${safeLabel(key)}」不允许使用。`;
  }
  if (typeof value !== 'string') {
    return `header「${safeLabel(key)}」的值必须是字符串。`;
  }
  if (value.length > MAX_HEADER_VALUE) {
    return `header「${safeLabel(key)}」的值过长（上限 ${MAX_HEADER_VALUE} 字符）。`;
  }
  if (/[\r\n\u0000]/.test(value)) {
    return `header「${safeLabel(key)}」的值不能包含换行或空字符。`;
  }
  return null;
}

function addIssue(issues, text) {
  if (issues.length < MAX_ISSUES) issues.push(text);
}

function resolveFilePath(value) {
  return value ? path.resolve(String(value)) : CONFIG_PATH;
}

/** 按目录顺序、忽略未知名字地读取原始条目；坏条目降级为可用部分。 */
function readStoreRaw(filePath) {
  const base = {
    ok: true,
    exists: false,
    reason: 'missing',
    message: '',
    version: CONFIG_VERSION,
    services: {},
    stored: [],
    dropped: 0,
    issues: [],
  };

  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    if (errorCodeOf(error) === 'ENOENT') {
      return { ...base, message: '未配置：没有找到 MCP 配置文件，所有服务按目录默认值（未配置）处理。' };
    }
    return {
      ...base,
      ok: false,
      exists: true,
      reason: 'read_error',
      message: `读取 MCP 配置文件失败（${errorCodeOf(error)}），已按未配置处理。`,
    };
  }

  if (!stat.isFile()) {
    return {
      ...base,
      ok: false,
      exists: true,
      reason: 'read_error',
      message: 'MCP 配置路径不是普通文件，已按未配置处理。',
    };
  }
  if (stat.size > MAX_CONFIG_BYTES) {
    return {
      ...base,
      ok: false,
      exists: true,
      reason: 'too_large',
      message: 'MCP 配置文件过大，已按未配置处理；原文件未改动。',
    };
  }

  let text = '';
  try {
    text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  } catch (error) {
    return {
      ...base,
      ok: false,
      exists: true,
      reason: 'read_error',
      message: `读取 MCP 配置文件失败（${errorCodeOf(error)}），已按未配置处理。`,
    };
  }

  if (text.trim() === '') {
    return {
      ...base,
      exists: true,
      reason: 'empty',
      message: 'MCP 配置文件为空，所有服务按未配置处理。',
    };
  }

  let value = null;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      ...base,
      ok: false,
      exists: true,
      reason: 'invalid_json',
      message: 'MCP 配置文件不是合法 JSON，已按未配置处理；原文件未改动。',
    };
  }

  if (!isPlainObject(value) || !isPlainObject(value.services)) {
    return {
      ...base,
      ok: false,
      exists: true,
      reason: 'invalid_structure',
      message: 'MCP 配置文件结构不符合 {version:1, services:{…}}，已按未配置处理；原文件未改动。',
    };
  }
  if (value.version !== undefined && value.version !== CONFIG_VERSION) {
    return {
      ...base,
      ok: false,
      exists: true,
      reason: 'invalid_structure',
      message: `MCP 配置文件版本不受支持（需为 ${CONFIG_VERSION}），已按未配置处理；原文件未改动。`,
    };
  }

  const services = {};
  const stored = [];
  const issues = [];
  let dropped = 0;

  for (const service of MCP_SERVICES) {
    if (!hasOwn(value.services, service.name)) continue;
    const raw = value.services[service.name];
    if (!isPlainObject(raw)) {
      dropped += 1;
      addIssue(issues, `服务「${service.name}」的配置不是对象，已忽略。`);
      continue;
    }

    let enabled = false;
    if (hasOwn(raw, 'enabled')) {
      if (typeof raw.enabled === 'boolean') enabled = raw.enabled;
      else addIssue(issues, `服务「${service.name}」的 enabled 不是布尔值，已按关闭处理。`);
    }

    let url = '';
    if (hasOwn(raw, 'url')) {
      if (typeof raw.url === 'string') url = raw.url.trim();
      else addIssue(issues, `服务「${service.name}」的 url 不是字符串，已按未填写处理。`);
    }
    if (url !== '' && !isHttpUrl(url)) {
      addIssue(issues, `服务「${service.name}」的 url 不是合法的 http(s) 地址，状态会标记为无效。`);
    }

    const headers = {};
    if (hasOwn(raw, 'headers')) {
      if (!isPlainObject(raw.headers)) {
        addIssue(issues, `服务「${service.name}」的 headers 不是对象，已忽略这些 header。`);
      } else {
        for (const [key, item] of Object.entries(raw.headers)) {
          const problem = headerProblem(key, item);
          if (problem) addIssue(issues, `服务「${service.name}」：${problem}`);
          else headers[key] = item;
        }
      }
    }

    const entry = { enabled, url, headers };
    services[service.name] = entry;
    stored.push({ name: service.name, ...entry });
  }

  for (const name of Object.keys(value.services)) {
    if (!MCP_SERVICE_BY_NAME.has(name)) {
      dropped += 1;
      addIssue(issues, `忽略未知服务「${safeLabel(name)}」。`);
    }
  }

  const partial = dropped > 0 || issues.length > 0;
  return {
    ...base,
    exists: true,
    reason: partial ? 'partial' : 'ok',
    message: partial
      ? `已读取 ${stored.length} 个服务配置，忽略 ${dropped} 条无效记录。`
      : stored.length === 0
        ? 'MCP 配置文件存在，但还没有保存任何服务配置。'
        : `已读取 ${stored.length} 个服务配置。`,
    services,
    stored,
    dropped,
    issues,
  };
}

/** 原子写入：临时文件 + fsync + rename，避免半截 JSON。 */
function writeStore(filePath, data) {
  const dir = path.dirname(filePath);
  const temp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  let fd = null;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const body = `${JSON.stringify(data, null, 2)}\n`;
    fd = fs.openSync(temp, 'w', 0o600);
    fs.writeFileSync(fd, body, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temp, filePath);
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    try { fs.unlinkSync(temp); } catch { /* ignore */ }
    throw new McpConfigError(
      'mcp_config_write_failed',
      `写入 MCP 配置文件失败（${errorCodeOf(error)}），本次修改未生效。`,
      { cause: error },
    );
  }
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows 上可能不支持，忽略 */ }
}

/** 只含键名/脱敏地址的单条配置视图。 */
function publicEntry(entry) {
  return {
    enabled: entry.enabled === true,
    hasUrl: entry.url !== '',
    urlMasked: maskUrl(entry.url),
    headerKeys: Object.keys(entry.headers ?? {}),
  };
}

/**
 * 单个服务的对外状态：给设置页/GET 接口直接使用，绝不包含 url 原文与 header 值。
 * state.status 取自 mcpServices.serviceState：
 *   ready / disabled / url_missing / invalid_url / stdio_bridge_missing / cli_missing。
 * 连接成功或失败由 mcpGateway 的 publicStatus 另行叠加。
 */
export function describeService(config, { probeCli = null } = {}) {
  if (!config || typeof config !== 'object') return null;
  const state = serviceState(config, { probeCli });
  return {
    name: state.name,
    label: state.label,
    prefix: config.prefix ?? '',
    transport: state.transport,
    effectiveTransport: state.effectiveTransport,
    risk: state.risk,
    envKey: state.envKey,
    scenarios: [...(state.scenarios ?? [])],
    enabled: state.enabled === true,
    configured: state.configured === true,
    ready: state.ready === true,
    hasUrl: state.hasUrl === true,
    urlMasked: state.maskedUrl,
    headerKeys: Object.keys(config.headers ?? {}),
    source: state.source,
    sandbox: config.sandbox === true,
    setup: state.setup,
    docs: state.docs,
    notes: state.notes,
    state: {
      status: state.reason,
      message: state.message,
      ready: state.ready === true,
    },
  };
}

/**
 * 读取配置文件的脱敏视图。
 *
 * @returns {{
 *   ok: boolean, exists: boolean, path: string,
 *   reason: 'ok'|'partial'|'missing'|'empty'|'invalid_json'|'invalid_structure'|'too_large'|'read_error',
 *   message: string, version: number, count: number, dropped: number, issues: string[],
 *   entries: Array<object>
 * }}
 * entries 是已保存服务的 public 视图（urlMasked + headerKeys），绝不含原文。
 */
export function readMcpStore({ path: filePath = CONFIG_PATH, env = process.env, probeCli = null } = {}) {
  const resolvedPath = resolveFilePath(filePath);
  const raw = readStoreRaw(resolvedPath);
  const configs = resolveConfigs({ stored: raw.stored, env });
  const byName = new Map(configs.map((config) => [config.name, config]));
  const entries = raw.stored
    .map((item) => describeService(byName.get(item.name), { probeCli }))
    .filter(Boolean);
  return {
    ok: raw.ok,
    exists: raw.exists,
    path: resolvedPath,
    reason: raw.reason,
    message: raw.message,
    version: raw.version,
    count: entries.length,
    dropped: raw.dropped,
    issues: raw.issues,
    entries,
  };
}

/**
 * 合成运行时配置（含真实 url/headers，仅供进程内使用）。
 * stored 参数可跳过磁盘读取；否则读取 mcp-servers.json。
 */
export function getResolvedConfigs({ env = process.env, path: filePath = CONFIG_PATH, stored = null } = {}) {
  const saved = Array.isArray(stored) ? stored : readStoreRaw(resolveFilePath(filePath)).stored;
  return resolveConfigs({ stored: saved, env });
}

/** 全部服务的对外状态 + 配置文件降级原因，供 GET /api/mcp/services 使用。 */
export function listServiceStatus({ env = process.env, path: filePath = CONFIG_PATH, probeCli = null } = {}) {
  const resolvedPath = resolveFilePath(filePath);
  const raw = readStoreRaw(resolvedPath);
  const configs = resolveConfigs({ stored: raw.stored, env });
  return {
    ok: raw.ok,
    exists: raw.exists,
    path: resolvedPath,
    reason: raw.reason,
    message: raw.message,
    dropped: raw.dropped,
    issues: raw.issues,
    services: configs.map((config) => describeService(config, { probeCli })).filter(Boolean),
  };
}

/**
 * 校验并归一化单个服务的写入参数（只校验出现的字段，其余字段保持原值）。
 * 失败抛 McpConfigError：mcp_unknown_service / mcp_invalid_config。
 *
 * @returns {{name: string, enabled?: boolean, url?: string, headers?: object}}
 */
export function validateServiceInput(name, input) {
  if (typeof name !== 'string' || !MCP_SERVICE_BY_NAME.has(name)) {
    throw new McpConfigError(
      'mcp_unknown_service',
      `未知的生活服务「${safeLabel(name)}」。可选：${[...MCP_SERVICE_BY_NAME.keys()].join('、')}。`,
      { field: 'name' },
    );
  }
  if (!isPlainObject(input)) {
    throw new McpConfigError('mcp_invalid_config', '请求体必须是对象。', { field: 'body' });
  }

  const normalized = { name };
  let fields = 0;

  if (hasOwn(input, 'enabled')) {
    fields += 1;
    if (typeof input.enabled !== 'boolean') {
      throw new McpConfigError('mcp_invalid_config', 'enabled 必须是布尔值。', { field: 'enabled' });
    }
    normalized.enabled = input.enabled;
  }

  if (hasOwn(input, 'url')) {
    fields += 1;
    if (typeof input.url !== 'string') {
      throw new McpConfigError('mcp_invalid_config', 'url 必须是字符串。', { field: 'url' });
    }
    const url = input.url.trim();
    if (url.length > MAX_URL_LENGTH) {
      throw new McpConfigError('mcp_invalid_config', `url 过长（上限 ${MAX_URL_LENGTH} 字符）。`, { field: 'url' });
    }
    if (/[\u0000-\u001f\u007f]/.test(url)) {
      throw new McpConfigError('mcp_invalid_config', 'url 不能包含控制字符。', { field: 'url' });
    }
    if (url !== '' && (!/^https?:\/\//i.test(url) || !isHttpUrl(url))) {
      throw new McpConfigError(
        'mcp_invalid_config',
        'url 必须以 http:// 或 https:// 开头，或留空。',
        { field: 'url' },
      );
    }
    normalized.url = url;
  }

  if (hasOwn(input, 'headers')) {
    fields += 1;
    if (!isPlainObject(input.headers)) {
      throw new McpConfigError(
        'mcp_invalid_config',
        'headers 必须是对象，且键和值都是字符串（不能是数组或 null）。',
        { field: 'headers' },
      );
    }
    const entries = Object.entries(input.headers);
    if (entries.length > MAX_HEADERS) {
      throw new McpConfigError('mcp_invalid_config', `headers 数量过多（上限 ${MAX_HEADERS} 个）。`, { field: 'headers' });
    }
    const headers = {};
    let bytes = 0;
    for (const [key, value] of entries) {
      const problem = headerProblem(key, value);
      if (problem) throw new McpConfigError('mcp_invalid_config', problem, { field: 'headers' });
      bytes += key.length + value.length;
      if (bytes > MAX_HEADER_BYTES) {
        throw new McpConfigError('mcp_invalid_config', 'headers 总长度过大。', { field: 'headers' });
      }
      headers[key] = value;
    }
    normalized.headers = headers;
  }

  if (fields === 0) {
    throw new McpConfigError(
      'mcp_invalid_config',
      '至少提供 enabled、url、headers 中的一个字段。',
      { field: 'body' },
    );
  }
  return normalized;
}

/**
 * 保存单个服务配置（未提供的字段沿用已保存值）。
 * 保存后返回脱敏的新状态；真实地址不会出现在返回值里。
 */
export function saveServiceConfig(name, input, { path: filePath = CONFIG_PATH, env = process.env } = {}) {
  const patch = validateServiceInput(name, input);
  const resolvedPath = resolveFilePath(filePath);
  const store = readStoreRaw(resolvedPath);
  const previous = store.services[name] ?? null;
  const entry = {
    enabled: hasOwn(patch, 'enabled') ? patch.enabled : (previous?.enabled ?? false),
    url: hasOwn(patch, 'url') ? patch.url : (previous?.url ?? ''),
    headers: hasOwn(patch, 'headers') ? patch.headers : (previous?.headers ?? {}),
  };

  const services = { ...store.services };
  // 全为默认值时不留空条目，文件保持干净。
  if (entry.enabled === false && entry.url === '' && Object.keys(entry.headers).length === 0) {
    delete services[name];
  } else {
    services[name] = entry;
  }

  writeStore(resolvedPath, { version: CONFIG_VERSION, services });
  const config = getResolvedConfigs({ path: resolvedPath, env }).find((item) => item.name === name) ?? null;
  return {
    ok: true,
    name,
    entry: publicEntry(entry),
    status: describeService(config),
    store: readMcpStore({ path: resolvedPath, env }),
  };
}

/** 删除单个服务的保存值（恢复目录默认/环境变量，但仍需用户显式启用）。 */
export function removeServiceConfig(name, { path: filePath = CONFIG_PATH, env = process.env } = {}) {
  if (typeof name !== 'string' || !MCP_SERVICE_BY_NAME.has(name)) {
    throw new McpConfigError(
      'mcp_unknown_service',
      `未知的生活服务「${safeLabel(name)}」。可选：${[...MCP_SERVICE_BY_NAME.keys()].join('、')}。`,
      { field: 'name' },
    );
  }
  const resolvedPath = resolveFilePath(filePath);
  const store = readStoreRaw(resolvedPath);
  const existed = hasOwn(store.services, name);
  const services = { ...store.services };
  delete services[name];

  // 文件损坏/不可读时也允许用 DELETE 把它重置成空配置（显式修复）。
  if (existed || (!store.ok && store.exists)) {
    writeStore(resolvedPath, { version: CONFIG_VERSION, services });
  }

  const config = getResolvedConfigs({ path: resolvedPath, env }).find((item) => item.name === name) ?? null;
  return {
    ok: true,
    name,
    removed: existed,
    status: describeService(config),
    store: readMcpStore({ path: resolvedPath, env }),
  };
}
