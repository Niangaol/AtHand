export type GatewaySession = { url: string; token: string; expiresAt: number };

const URL_KEY = 'shunshou.gateway.url';
const TOKEN_KEY = 'shunshou.gateway.token';
const EXPIRES_KEY = 'shunshou.gateway.expiresAt';

export class GatewayError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* 存储不可用时按未连接处理。 */ }
}

export function normalizeGatewayUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '');
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) throw new GatewayError('地址需以 http:// 或 https:// 开头。', 'invalid_url');
  return value;
}

export function gatewayUrl(): string {
  try {
    return normalizeGatewayUrl(read(URL_KEY));
  } catch {
    return '';
  }
}

export function gatewayToken(): string {
  const token = read(TOKEN_KEY);
  const expiresAt = Number(read(EXPIRES_KEY));
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return '';
  return token;
}

export function gatewayExpiresAt(): number {
  const value = Number(read(EXPIRES_KEY));
  return Number.isFinite(value) ? value : 0;
}

export function isGatewayConnected(): boolean {
  return Boolean(gatewayToken());
}

export function clearGatewaySession(): void {
  write(TOKEN_KEY, null);
  write(EXPIRES_KEY, null);
}

export async function gatewayLogin(url: string, password: string): Promise<GatewaySession> {
  const base = normalizeGatewayUrl(url);
  if (password.length < 8) throw new GatewayError('访问口令至少 8 个字符。', 'invalid_input');
  let response: Response;
  try {
    response = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      credentials: 'same-origin',
    });
  } catch {
    throw new GatewayError('连不上电脑，请确认同步服务已启动、地址正确。', 'network');
  }
  const body = (await response.json().catch(() => null)) as { ok?: unknown; token?: unknown; expiresAt?: unknown } | null;
  if (!response.ok || body?.ok !== true || typeof body.token !== 'string' || !Number.isFinite(Number(body.expiresAt))) {
    if (response.status === 401) throw new GatewayError('访问口令不对。', 'unauthorized');
    if (response.status === 429) throw new GatewayError('尝试次数过多，请 10 分钟后再试。', 'too_many_attempts');
    throw new GatewayError('电脑上的服务返回异常。', 'invalid_response');
  }
  const session = { url: base, token: body.token, expiresAt: Number(body.expiresAt) };
  write(URL_KEY, base);
  write(TOKEN_KEY, session.token);
  write(EXPIRES_KEY, String(session.expiresAt));
  window.dispatchEvent(new Event('shunshou-gateway-change'));
  return session;
}

export async function gatewayLogout(): Promise<void> {
  const base = gatewayUrl();
  const token = gatewayToken();
  clearGatewaySession();
  if (!token) return;
  try {
    await fetch(`${base}/api/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  } catch { /* 电脑离线时也允许本机退出。 */ }
}

export async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = gatewayUrl();
  const token = gatewayToken();
  if (!token) throw new GatewayError('还没有连接电脑。', 'not_connected');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  try {
    return await fetch(`${base}${path}`, { ...init, headers });
  } catch {
    throw new GatewayError('连不上电脑，请检查网络或服务是否在运行。', 'network');
  }
}
