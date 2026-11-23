// 云端校园助手：设备授权、PAT 保存与 HDUHelp API 操作代理。
// PAT 只存在云端数据库，不返回浏览器；写操作必须显式确认。
import { CAMPUS_DOMAINS, CAMPUS_OPERATIONS, CAMPUS_SCOPES } from './campus-manifest.mjs';
import { fail, json, readJson } from './lib.mjs';

const API_BASE = 'https://api.hduhelp.com';
const CLIENT_ID = 'hduhelp-cli';
const AUTH_KEY = 'campus-auth';
const MAX_UPSTREAM = 2_000_000;
const UPSTREAM_TIMEOUT = 15_000;
const DEVICE_HEADER_NAME = 'shunshou-cloud';
const RISKY = new Set(['write', 'high-risk-write']);
const OPERATIONS = new Map(CAMPUS_OPERATIONS.map((operation) => [operation.id, operation]));

function upstreamError(response) {
  const data = response?.data ?? {};
  return {
    status: response?.status ?? 502,
    error: typeof data.error === 'string' ? data.error : typeof data.code === 'string' ? data.code : 'upstream_error',
    message: typeof data.error_description === 'string' ? data.error_description
      : typeof data.message === 'string' ? data.message
        : typeof data.msg === 'string' ? data.msg : 'HDUHelp 服务返回错误。',
  };
}

function parseScopes(value) {
  if (typeof value === 'string') return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  return [];
}

function validParamValue(value, type) {
  if (value === undefined || value === null || value === '') return false;
  if (type === 'integer' || type === 'number') return Number.isFinite(Number(value));
  if (type === 'boolean') return value === true || value === false || value === 'true' || value === 'false';
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return typeof value === 'object' && !Array.isArray(value);
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function validBodyValue(value, type) {
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export function createCampus({ docs, fetch: transport = globalThis.fetch }) {
  async function authDoc() {
    return docs.ensure(AUTH_KEY, () => ({
      deviceId: crypto.randomUUID(),
      deviceName: '顺手云端',
      pat: '',
      scopes: [],
      patId: '',
      connectedAt: null,
      expiresAt: null,
      pending: null,
    }));
  }

  function publicStatus(doc) {
    const value = doc.value ?? {};
    const pending = value.pending && Date.now() < value.pending.expiresAt ? {
      userCode: value.pending.userCode,
      verificationUri: value.pending.verificationUri,
      verificationUriComplete: value.pending.verificationUriComplete,
      expiresAt: value.pending.expiresAt,
      interval: value.pending.interval,
      scopes: value.pending.scopes,
    } : null;
    return {
      ok: true,
      connected: Boolean(value.pat),
      expired: Boolean(value.pat && value.expiresAt && Date.now() >= value.expiresAt),
      scopes: Array.isArray(value.scopes) ? value.scopes : [],
      patId: value.patId ?? '',
      connectedAt: value.connectedAt ?? null,
      expiresAt: value.expiresAt ?? null,
      deviceName: value.deviceName ?? '顺手云端',
      pending,
    };
  }

  async function callUpstream(path, { method = 'GET', token, body, headers = {}, timeout = UPSTREAM_TIMEOUT } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await transport(`${API_BASE}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > MAX_UPSTREAM) fail(502, 'upstream_too_large', '上游返回内容过大。');
      let data = null;
      try { data = JSON.parse(text); } catch { /* 非 JSON 由调用方按文本处理。 */ }
      return { status: response.status, ok: response.ok, data, text, contentType: response.headers.get('content-type') ?? '' };
    } catch (error) {
      if (error?.status) throw error;
      if (error?.name === 'AbortError') fail(504, 'upstream_timeout', 'HDUHelp 服务响应超时。');
      fail(502, 'upstream_unreachable', '暂时连不上 HDUHelp 服务。');
    } finally {
      clearTimeout(timer);
    }
  }

  async function startAuth(request) {
    const body = await readJson(request);
    const requested = Array.isArray(body?.scopes) ? body.scopes.filter((scope) => CAMPUS_SCOPES.includes(scope)) : CAMPUS_SCOPES;
    const doc = await authDoc();
    const current = Array.isArray(doc.value.scopes) ? doc.value.scopes : [];
    const scopes = [...new Set([...current, ...requested])];
    if (!scopes.length) fail(400, 'invalid_scope', '至少选择一个校园权限。');
    const deviceId = doc.value.deviceId || crypto.randomUUID();
    const deviceName = typeof doc.value.deviceName === 'string' && doc.value.deviceName ? doc.value.deviceName : '顺手云端';
    if (doc.value.pending?.deviceCode) {
      await callUpstream('/hduhelp-neo/open-apis/auth/device-authorization/cancel', {
        method: 'POST',
        headers: { 'x-device-id': deviceId, 'x-device-name': DEVICE_HEADER_NAME },
        body: { client_id: CLIENT_ID, device_code: doc.value.pending.deviceCode },
      }).catch(() => null);
    }
    const response = await callUpstream('/hduhelp-neo/open-apis/auth/device-authorization', {
      method: 'POST',
      headers: { 'x-device-id': deviceId, 'x-device-name': DEVICE_HEADER_NAME },
      body: { client_id: CLIENT_ID, device_id: deviceId, device_name: deviceName, scope: scopes.join(' ') },
    });
    const data = response.data?.data ?? response.data;
    if (!response.ok || !data || typeof data.device_code !== 'string' || typeof data.user_code !== 'string') {
      const failure = upstreamError(response);
      fail(failure.status >= 400 && failure.status < 500 ? 400 : 502, failure.error, failure.message);
    }
    const expiresIn = Number.isSafeInteger(Number(data.expires_in)) ? Number(data.expires_in) : 600;
    const interval = Number.isSafeInteger(Number(data.interval)) ? Number(data.interval) : 5;
    const pending = {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: typeof data.verification_uri === 'string' ? data.verification_uri : '',
      verificationUriComplete: typeof data.verification_uri_complete === 'string' ? data.verification_uri_complete : '',
      expiresAt: Date.now() + expiresIn * 1000,
      interval,
      scopes,
    };
    await docs.replace(doc, { ...doc.value, deviceId, deviceName, pending });
    return json({
      ok: true,
      userCode: pending.userCode,
      verificationUri: pending.verificationUri,
      verificationUriComplete: pending.verificationUriComplete,
      expiresAt: pending.expiresAt,
      interval,
      scopes,
    });
  }

  async function pollAuth(request) {
    await readJson(request).catch(() => ({}));
    const doc = await authDoc();
    const pending = doc.value.pending;
    if (!pending) return json({ ...publicStatus(doc), status: 'not_pending' });
    if (Date.now() >= pending.expiresAt) {
      await docs.replace(doc, { ...doc.value, pending: null });
      return json({ ...publicStatus({ ...doc, value: { ...doc.value, pending: null } }), status: 'expired' });
    }
    const response = await callUpstream('/hduhelp-neo/open-apis/authen/access-token', {
      method: 'POST',
      headers: { 'x-device-id': doc.value.deviceId, 'x-device-name': DEVICE_HEADER_NAME },
      body: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: pending.deviceCode, client_id: CLIENT_ID },
    });
    const data = response.data?.data ?? response.data;
    if (response.ok && data && typeof data.access_token === 'string' && data.access_token) {
      const scopes = parseScopes(data.scope);
      const expiresIn = Number(data.expires_in);
      const next = {
        ...doc.value,
        pat: data.access_token,
        scopes: scopes.length ? scopes : pending.scopes,
        patId: typeof data.pat_id === 'string' ? data.pat_id : doc.value.patId ?? '',
        connectedAt: new Date().toISOString(),
        expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
        pending: null,
      };
      await docs.replace(doc, next);
      return json({ ...publicStatus({ ...doc, value: next }), status: 'connected' });
    }
    const error = typeof data?.error === 'string' ? data.error : '';
    if (error === 'authorization_pending') {
      return json({ ...publicStatus(doc), status: 'pending' });
    }
    if (error === 'slow_down') {
      const next = { ...doc.value, pending: { ...pending, interval: (pending.interval ?? 5) + 5 } };
      await docs.replace(doc, next);
      return json({ ...publicStatus({ ...doc, value: next }), status: 'pending' });
    }
    await docs.replace(doc, { ...doc.value, pending: null });
    const failure = upstreamError(response);
    return json({ ...publicStatus({ ...doc, value: { ...doc.value, pending: null } }), ok: false, status: 'failed', error: error || failure.error, message: failure.message });
  }

  async function cancelAuth() {
    const doc = await authDoc();
    const pending = doc.value.pending;
    if (pending?.deviceCode) {
      await callUpstream('/hduhelp-neo/open-apis/auth/device-authorization/cancel', {
        method: 'POST',
        headers: { 'x-device-id': doc.value.deviceId, 'x-device-name': DEVICE_HEADER_NAME },
        body: { client_id: CLIENT_ID, device_code: pending.deviceCode },
      }).catch(() => null);
    }
    const next = { ...doc.value, pending: null };
    await docs.replace(doc, next);
    return json({ ...publicStatus({ ...doc, value: next }), status: 'cancelled' });
  }

  async function logout(request) {
    const body = await readJson(request).catch(() => ({}));
    const doc = await authDoc();
    const token = doc.value.pat;
    let revoked = true;
    if (token && body?.localOnly !== true) {
      const response = await callUpstream('/hduhelp-neo/cli/tokens/current', { method: 'DELETE', token });
      revoked = response.ok || response.status === 401 || response.status === 404;
    }
    if (!revoked) {
      return json({ ok: false, error: 'revoke_failed', message: '没能撤销校园授权；PAT 仍保留，请稍后重试。' });
    }
    const next = {
      ...doc.value,
      pat: '',
      scopes: [],
      patId: '',
      connectedAt: null,
      expiresAt: null,
      pending: null,
    };
    await docs.replace(doc, next);
    return json({ ...publicStatus({ ...doc, value: next }), status: 'logged_out', revoked: Boolean(token) && body?.localOnly !== true });
  }

  async function run(request) {
    const body = await readJson(request);
    const operation = OPERATIONS.get(body?.operationId);
    if (!operation) fail(404, 'unknown_operation', '找不到这个校园操作。');
    const doc = await authDoc();
    const token = doc.value.pat;
    if (operation.auth === 'bearer' && !token) {
      return json({ ok: false, error: 'campus_not_connected', message: '还没有连接校园助手，请先完成授权。' });
    }
    const missing = operation.scopes.filter((scope) => !(doc.value.scopes ?? []).includes(scope));
    if (missing.length) {
      return json({ ok: false, error: 'missing_scope', missingScopes: missing, message: `需要重新授权：${missing.join('、')}` });
    }
    const risky = RISKY.has(operation.risk);
    if (risky && body?.confirm !== true) {
      return json({ ok: false, error: 'confirmation_required', risk: operation.risk, message: '这是写操作，需要先确认。' });
    }

    let path = operation.path;
    const pathInput = body?.path && typeof body.path === 'object' ? body.path : {};
    for (const param of operation.params.filter((item) => item.in === 'path')) {
      const value = pathInput[param.name];
      if (value === undefined || value === null || value === '') {
        if (param.required) fail(400, 'invalid_arguments', `缺少路径参数 ${param.name}。`);
        continue;
      }
      if (!validParamValue(value, param.type) || String(value).length > 512) fail(400, 'invalid_arguments', `路径参数 ${param.name} 格式不对。`);
      path = path.replace(`{${param.name}}`, encodeURIComponent(String(value)));
    }
    if (/[{}]/.test(path)) fail(400, 'invalid_arguments', '路径参数不完整。');

    const query = new URLSearchParams();
    const queryInput = body?.query && typeof body.query === 'object' ? body.query : {};
    for (const param of operation.params.filter((item) => item.in === 'query')) {
      const value = queryInput[param.name];
      if (value === undefined || value === null || value === '') {
        if (param.required) fail(400, 'invalid_arguments', `缺少查询参数 ${param.name}。`);
        continue;
      }
      if (!validParamValue(value, param.type)) fail(400, 'invalid_arguments', `查询参数 ${param.name} 格式不对。`);
      for (const item of Array.isArray(value) ? value : [value]) query.append(param.name, String(item));
    }

    let payload;
    if (operation.body) {
      if (operation.body.contentType !== 'application/json') {
        fail(400, 'not_supported', '这个操作需要文件上传，请在 CLI 中完成。');
      }
      const input = body?.body && typeof body.body === 'object' && !Array.isArray(body.body) ? body.body : {};
      if (operation.body.fields.length) {
        payload = {};
        for (const field of operation.body.fields) {
          const value = input[field.name];
          if (value === undefined || value === null) {
            if (field.required) fail(400, 'invalid_arguments', `缺少请求体字段 ${field.name}。`);
            continue;
          }
          if (!validBodyValue(value, field.type)) fail(400, 'invalid_arguments', `请求体字段 ${field.name} 格式不对。`);
          payload[field.name] = value;
        }
      } else {
        payload = input;
      }
    }

    const headers = { 'x-device-id': doc.value.deviceId, 'x-device-name': DEVICE_HEADER_NAME };
    if (risky) {
      const key = typeof body.idempotencyKey === 'string' && body.idempotencyKey.length >= 8 && body.idempotencyKey.length <= 100
        ? body.idempotencyKey : crypto.randomUUID();
      headers['idempotency-key'] = key;
    }

    const response = await callUpstream(`${path}${query.toString() ? `?${query}` : ''}`, {
      method: operation.method,
      token: token || undefined,
      body: payload,
      headers,
    });
    const data = response.data?.data !== undefined ? response.data.data : response.data;
    const requestId = response.data?.request_id ?? response.data?.requestId ?? null;
    if (response.ok) {
      return json({
        ok: true,
        status: response.status,
        operationId: operation.id,
        data,
        envelope: response.data,
        requestId,
      });
    }
    const failure = upstreamError(response);
    if (response.status === 401) {
      return json({
        ok: false,
        status: 401,
        error: 'campus_pat_invalid',
        message: '校园授权已失效，请重新授权。',
        requestId,
      });
    }
    return json({ ok: false, status: response.status, error: failure.error, message: failure.message, data: response.data, requestId });
  }

  return {
    async handle(request) {
      const pathname = new URL(request.url).pathname;
      const marker = '/api/campus';
      const index = pathname.indexOf(marker);
      const path = index >= 0 ? pathname.slice(index + marker.length) || '/' : '/';
      if (path === '/status' && request.method === 'GET') return json(publicStatus(await authDoc()));
      if (path === '/catalog' && request.method === 'GET') {
        return json({ ok: true, operations: CAMPUS_OPERATIONS, scopes: CAMPUS_SCOPES, domains: CAMPUS_DOMAINS });
      }
      if (path === '/auth/start' && request.method === 'POST') return startAuth(request);
      if (path === '/auth/poll' && request.method === 'POST') return pollAuth(request);
      if (path === '/auth/cancel' && request.method === 'POST') return cancelAuth(request);
      if (path === '/auth/logout' && request.method === 'POST') return logout(request);
      if (path === '/run' && request.method === 'POST') return run(request);
      return json({ ok: false, error: 'not_found' }, 404);
    },
  };
}