export type GatewayUser = { id: string; username: string };
export type GatewaySession = { url: string; token: string; expiresAt: number; user?: GatewayUser };
export type GatewayPairingCode = { code: string; expiresAt: number; urls: Array<{ label: string; url: string }> };

const URL_KEY = 'shunshou.gateway.url';
const TOKEN_KEY = 'shunshou.gateway.token';
const EXPIRES_KEY = 'shunshou.gateway.expiresAt';
const USERNAME_KEY = 'shunshou.gateway.username';
const LAST_USER_KEY = 'shunshou.gateway.lastUsername';
const ACCOUNT_CHANGED_KEY = 'shunshou.gateway.accountChanged';

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

export function isHostedSite(): boolean {
  try {
    const { protocol, hostname } = window.location;
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return /(^|\.)qoder\.(zone|site)$/.test(hostname);
  } catch {
    return false;
  }
}

export function defaultGatewayUrl(): string {
  const stored = gatewayUrl();
  if (stored) return stored;
  if (!isHostedSite()) return '';
  return `${window.location.origin}/functions/v1/app`;
}

/** 地址是否指向 Qoder Sites 云端函数（/functions/v1/app）。 */
export function isCloudBackendUrl(raw: string): boolean {
  return /\/functions\/v1\/app\/?$/.test(raw.trim());
}

/**
 * 云端网关会剥离 Authorization 头，只认 X-Shunshou-Session；
 * 本机网关只认 Authorization。两处都带上，才能同一套代码跑两种后端。
 */
export function applyAuthHeaders(headers: Headers, base: string, token: string): Headers {
  headers.set('Authorization', `Bearer ${token}`);
  if (isCloudBackendUrl(base)) headers.set('X-Shunshou-Session', token);
  return headers;
}

export type BackendMode = 'off' | 'cloud' | 'local';

/** 已连接按网关地址判定；未连接时托管站点按云端口径、本机开发按电脑口径。 */
export function backendMode(): BackendMode {
  const url = gatewayUrl();
  if (isGatewayConnected()) return isCloudBackendUrl(url) ? 'cloud' : 'local';
  if (url) return isCloudBackendUrl(url) ? 'cloud' : 'local';
  return isHostedSite() ? 'cloud' : 'local';
}

/** 云端叫「云端」，本机网关叫「电脑」，用于拼装提示文案。 */
export function backendNoun(): '云端' | '电脑' {
  return backendMode() === 'cloud' ? '云端' : '电脑';
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

export function gatewayUsername(): string {
  return read(USERNAME_KEY);
}

export function isGatewayConnected(): boolean {
  return Boolean(gatewayToken());
}

export function gatewayAccountChanged(): boolean {
  return read(ACCOUNT_CHANGED_KEY) === '1';
}

export function clearGatewayAccountChanged(): void {
  write(ACCOUNT_CHANGED_KEY, '0');
}

export function clearGatewaySession(): void {
  write(TOKEN_KEY, null);
  write(EXPIRES_KEY, null);
  write(USERNAME_KEY, null);
}

function applySession(base: string, body: Record<string, unknown>, fallbackUsername = ''): GatewaySession {
  const rawUser = body.user && typeof body.user === 'object' ? body.user as { id?: unknown; username?: unknown } : null;
  const username = typeof rawUser?.username === 'string' ? rawUser.username : fallbackUsername;
  const previous = read(LAST_USER_KEY);
  write(ACCOUNT_CHANGED_KEY, previous && (!username || previous.toLowerCase() !== username.toLowerCase()) ? '1' : '0');
  const session: GatewaySession = { url: base, token: body.token as string, expiresAt: Number(body.expiresAt) };
  if (username) session.user = { id: typeof rawUser?.id === 'string' ? rawUser.id : '', username };
  write(URL_KEY, base);
  write(TOKEN_KEY, session.token);
  write(EXPIRES_KEY, String(session.expiresAt));
  if (username) {
    write(USERNAME_KEY, username);
    write(LAST_USER_KEY, username);
  } else {
    write(USERNAME_KEY, null);
  }
  window.dispatchEvent(new Event('shunshou-gateway-change'));
  return session;
}

export async function gatewayLogin(url: string, password: string, username = ''): Promise<GatewaySession> {
  const base = normalizeGatewayUrl(url);
  if (password.length < 8) throw new GatewayError('密码至少 8 个字符。', 'invalid_input');
  let response: Response;
  try {
    response = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(username ? { username, password } : { password }),
      credentials: 'same-origin',
    });
  } catch {
    throw new GatewayError('连不上后端，请检查地址和服务是否正常。', 'network');
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || body?.ok !== true || typeof body.token !== 'string' || !Number.isFinite(Number(body.expiresAt))) {
    if (response.status === 401) throw new GatewayError(username ? '账号或密码不对。' : '口令不对。', 'unauthorized');
    if (response.status === 429) throw new GatewayError('尝试次数过多，请稍后再试。', 'too_many_attempts');
    const message = typeof body?.message === 'string' ? body.message : '后端返回异常。';
    throw new GatewayError(message, 'invalid_response');
  }
  return applySession(base, body, username);
}

export async function gatewayRegister(url: string, username: string, password: string): Promise<GatewaySession> {
  const base = normalizeGatewayUrl(url);
  if (!username.trim()) throw new GatewayError('请填写账号。', 'invalid_input');
  if (password.length < 8) throw new GatewayError('密码至少 8 个字符。', 'invalid_input');
  let response: Response;
  try {
    response = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
      credentials: 'same-origin',
    });
  } catch {
    throw new GatewayError('连不上后端，请检查地址和服务是否正常。', 'network');
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || body?.ok !== true || typeof body.token !== 'string' || !Number.isFinite(Number(body.expiresAt))) {
    if (response.status === 409) throw new GatewayError('这个账号已经被使用。', 'username_taken');
    const message = typeof body?.message === 'string' ? body.message : '注册失败。';
    throw new GatewayError(message, typeof body?.error === 'string' ? body.error : 'register_failed');
  }
  return applySession(base, body, username.trim());
}

export async function gatewayMe(): Promise<GatewayUser | null> {
  const response = await gatewayFetch('/api/me');
  const body = (await response.json().catch(() => null)) as { ok?: unknown; user?: unknown } | null;
  if (!response.ok || body?.ok !== true || !body.user || typeof body.user !== 'object') return null;
  const user = body.user as { id?: unknown; username?: unknown };
  if (typeof user.id !== 'string' || typeof user.username !== 'string') return null;
  write(USERNAME_KEY, user.username);
  return { id: user.id, username: user.username };
}

export async function gatewayLogout(): Promise<void> {
  const base = gatewayUrl();
  const token = gatewayToken();
  clearGatewaySession();
  if (!token) return;
  try {
    await fetch(`${base}/api/logout`, {
      method: 'POST',
      headers: applyAuthHeaders(new Headers(), base, token),
    });
  } catch { /* 后端离线时也允许本机退出。 */ }
}

export async function createPairingCode(): Promise<GatewayPairingCode> {
  const response = await gatewayFetch('/api/pair/code', { method: 'POST' });
  const body = (await response.json().catch(() => null)) as
    { ok?: unknown; code?: unknown; expiresAt?: unknown; urls?: unknown } | null;
  if (!response.ok || body?.ok !== true || typeof body.code !== 'string' || !Number.isFinite(Number(body.expiresAt))) {
    if (response.status === 403) throw new GatewayError('这个网页地址不在网关允许的来源里，请检查 ALLOWED_ORIGINS。', 'origin_denied');
    throw new GatewayError('后端没有生成配对码，请重试。', 'invalid_response');
  }
  const urls = Array.isArray(body.urls)
    ? body.urls
      .filter((item): item is { label?: unknown; url?: unknown } => Boolean(item) && typeof item === 'object')
      .map((item) => ({ label: typeof item.label === 'string' ? item.label : '局域网', url: typeof item.url === 'string' ? item.url : '' }))
      .filter((item) => /^https?:\/\//.test(item.url))
    : [];
  return { code: body.code, expiresAt: Number(body.expiresAt), urls };
}

export async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = gatewayUrl();
  const token = gatewayToken();
  if (!token) throw new GatewayError('还没有连接后端。', 'not_connected');
  const headers = new Headers(init.headers);
  applyAuthHeaders(headers, base, token);
  try {
    return await fetch(`${base}${path}`, { ...init, headers });
  } catch {
    throw new GatewayError('连不上后端，请检查网络或服务是否在运行。', 'network');
  }
}