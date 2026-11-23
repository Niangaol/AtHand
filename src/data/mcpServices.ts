import { GatewayError, gatewayFetch } from './gateway';

/** 生活服务 MCP：本机网关上的服务目录、配置与状态。
 *
 * 这些服务都跑在电脑上的 local-sync 网关里（Streamable HTTP / stdio 桥 / CLI），
 * 云端 Qoder Sites 没有它们的路由，所以设置页只在「本机网关」模式下显示。
 * 网页永远拿不到真实 Key：读取只拿到脱敏地址与请求头名称，写入时留空表示保持原值。
 */

export type McpStateStatus =
  | 'ready'
  | 'unconfigured'
  | 'disabled'
  | 'cli_missing'
  | 'stdio_bridge_missing'
  | 'error'
  | 'unknown';

const RAW_STATUS: Record<string, McpStateStatus> = {
  ready: 'ready',
  url_missing: 'unconfigured',
  invalid_url: 'unconfigured',
  unconfigured: 'unconfigured',
  disabled: 'disabled',
  cli_missing: 'cli_missing',
  stdio_bridge_missing: 'stdio_bridge_missing',
  error: 'error',
};

export function normalizeMcpStatus(raw: string): McpStateStatus {
  return RAW_STATUS[raw] ?? 'unknown';
}

export type McpServiceView = {
  name: string;
  label: string;
  prefix: string;
  transport: 'http' | 'stdio' | 'cli' | string;
  enabled: boolean;
  configured: boolean;
  urlMasked: string;
  headerNames: string[];
  scenarios: string[];
  setup: string;
  state: { status: McpStateStatus | string; message: string };
};

export type McpServicePatch = {
  enabled?: boolean;
  url?: string;
  headers?: Record<string, string>;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

async function readJson(response: Response): Promise<UnknownRecord> {
  const body = await response.json().catch(() => null);
  const record = asRecord(body);
  if (!record) throw new GatewayError('服务返回的不是有效 JSON。', 'bad_response');
  if (!response.ok || record.ok === false) {
    throw new GatewayError(
      asString(record.message, '生活服务请求失败。'),
      asString(record.error, `http_${response.status}`),
    );
  }
  return record;
}

export function parseMcpService(value: unknown): McpServiceView | null {
  const record = asRecord(value);
  if (!record) return null;
  const name = asString(record.name);
  if (!/^[a-z0-9_-]{1,40}$/.test(name)) return null;
  const state = asRecord(record.state);
  const scenarios = Array.isArray(record.scenarios)
    ? record.scenarios.filter((item): item is string => typeof item === 'string')
    : [];
  const headerNames = Array.isArray(record.headerNames)
    ? record.headerNames.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    name,
    label: asString(record.label, name),
    prefix: asString(record.prefix),
    transport: asString(record.transport, 'http'),
    enabled: record.enabled === true,
    configured: record.configured === true,
    urlMasked: asString(record.urlMasked),
    headerNames,
    scenarios,
    setup: asString(record.setup),
    state: {
      status: normalizeMcpStatus(asString(state?.status, 'unknown')),
      message: asString(state?.message),
    },
  };
}

function parseServices(record: UnknownRecord): McpServiceView[] {
  const list = Array.isArray(record.services) ? record.services : [];
  return list.map(parseMcpService).filter((item): item is McpServiceView => item !== null);
}

/** 读取服务目录与当前状态（未配置/已连接/错误）。 */
export async function listMcpServices(): Promise<McpServiceView[]> {
  const response = await gatewayFetch('/api/mcp/services');
  return parseServices(await readJson(response));
}

/** 保存单个服务的启用开关、地址与请求头；headers 省略表示保持原值。 */
export async function saveMcpService(name: string, patch: McpServicePatch): Promise<McpServiceView> {
  const response = await gatewayFetch(`/api/mcp/services/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await readJson(response);
  const service = parseMcpService(body.service);
  if (!service) throw new GatewayError('服务返回了无法识别的配置。', 'bad_response');
  return service;
}

export type McpProbeResult = { toolCount: number; message: string; tools: string[] };

/** 探测一个服务：真正连一次 MCP 并列出工具。未配置时后端直接拒绝，不发请求。 */
export async function probeMcpService(name: string): Promise<McpProbeResult> {
  const response = await gatewayFetch(`/api/mcp/services/${encodeURIComponent(name)}/probe`, { method: 'POST' });
  const body = await readJson(response);
  const toolCount = typeof body.toolCount === 'number' && Number.isFinite(body.toolCount) ? body.toolCount : 0;
  const tools = Array.isArray(body.tools)
    ? body.tools.filter((item): item is string => typeof item === 'string').slice(0, 200)
    : [];
  return { toolCount, message: asString(body.message), tools };
}

export function parseHeadersText(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const index = line.indexOf(':');
    if (index <= 0) throw new GatewayError(`请求头「${line}」缺少冒号，格式应为 Name: value。`, 'invalid_header');
    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) throw new GatewayError(`请求头名称「${name}」不合法。`, 'invalid_header');
    if (!value) throw new GatewayError(`请求头「${name}」的值为空。`, 'invalid_header');
    headers[name] = value;
  }
  return headers;
}

export function maskHeadersText(headerNames: string[]): string {
  return headerNames.length ? headerNames.map((name) => `${name}: 已保存（留空保持不变）`).join('\n') : '';
}

export function mcpStateLabel(status: string): { text: string; tone: 'ok' | 'warn' | 'idle' } {
  switch (normalizeMcpStatus(status)) {
    case 'ready':
      return { text: '已连接', tone: 'ok' };
    case 'cli_missing':
      return { text: '未安装', tone: 'warn' };
    case 'stdio_bridge_missing':
      return { text: '需要本地桥', tone: 'warn' };
    case 'error':
      return { text: '连接失败', tone: 'warn' };
    case 'disabled':
      return { text: '已停用', tone: 'idle' };
    case 'unconfigured':
      return { text: '未配置', tone: 'idle' };
    default:
      return { text: '待检测', tone: 'idle' };
  }
}
