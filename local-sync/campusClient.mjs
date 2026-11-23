import crypto from 'node:crypto';

export class CampusClientError extends Error {
  constructor(status, code, message, fields = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const REQUEST_TIMEOUT_MS = 70_000;

function cookieFrom(headers) {
  const cookies = typeof headers?.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers?.get?.('set-cookie')].filter(Boolean);
  for (const raw of cookies) {
    const first = String(raw).split(';')[0];
    if (first.startsWith('hdu_web_session=')) return first;
  }
  return '';
}

/** 内存级杭电助手 Web 会话；不保存口令，网关重启后需要重新连接。 */
export function createCampusClient({ baseUrl, fetchImpl = fetch, now = Date.now }) {
  const target = new URL(baseUrl);
  const origin = target.origin;
  let session = null;
  let lastError = null;

  function active() {
    return Boolean(session && session.expiresAt > now());
  }

  function status() {
    const online = active();
    return {
      connected: online,
      expiresAt: online ? new Date(session.expiresAt).toISOString() : null,
      personalQueries: online ? Boolean(session.capabilities?.personal_queries) : false,
      lastError,
    };
  }

  async function requestJson(path, { method = 'GET', body = null, csrf = false } = {}) {
    if (!active()) {
      session = null;
      throw new CampusClientError(409, 'not_connected', '请先重新连接杭电助手。');
    }
    const headers = {
      Accept: 'application/json',
      Cookie: session.cookie,
      Origin: origin,
    };
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (csrf) headers['X-CSRF-Token'] = session.csrf;
    let response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      lastError = 'helper_unavailable';
      throw new CampusClientError(502, 'helper_unavailable', '连不上杭电助手，请确认它已经启动。');
    }
    if (response.status === 401) {
      session = null;
      lastError = 'not_connected';
      throw new CampusClientError(409, 'not_connected', '杭电助手登录已过期，请重新连接。');
    }
    const text = await response.text();
    let value = null;
    if (text) {
      try { value = JSON.parse(text); } catch { value = null; }
    }
    if (!response.ok) {
      const code = typeof value?.error === 'string' ? value.error
        : response.status === 413 ? 'too_large'
          : response.status === 429 ? 'busy'
            : response.status === 504 ? 'timeout'
              : 'helper_error';
      const message = typeof value?.message === 'string' ? value.message
        : typeof value?.detail === 'string' ? value.detail
          : `杭电助手返回了 ${response.status}。`;
      lastError = code;
      throw new CampusClientError(response.status, code, message, Array.isArray(value?.fields) ? value.fields : null);
    }
    lastError = null;
    return value;
  }

  return {
    status,
    async connect(password) {
      if (typeof password !== 'string' || password.length < 1 || password.length > 512) {
        throw new CampusClientError(400, 'invalid_password', '请填写杭电助手的访问口令。');
      }
      let response;
      try {
        response = await fetchImpl(`${origin}/web/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: origin, Accept: 'application/json' },
          body: JSON.stringify({ password }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        lastError = 'helper_unavailable';
        throw new CampusClientError(502, 'helper_unavailable', '连不上杭电助手，请确认它已经启动。');
      }
      if (response.status === 401) throw new CampusClientError(401, 'invalid_password', '杭电助手口令无效。');
      if (response.status === 429) throw new CampusClientError(429, 'too_many_attempts', '登录尝试过多，请稍后再试。');
      if (!response.ok) throw new CampusClientError(502, 'helper_unavailable', `杭电助手登录返回了 ${response.status}。`);
      const body = await response.json().catch(() => null);
      if (!body || typeof body.csrf_token !== 'string' || body.csrf_token.length < 16) {
        throw new CampusClientError(502, 'invalid_response', '杭电助手登录响应格式异常。');
      }
      const cookie = cookieFrom(response.headers);
      if (!cookie) throw new CampusClientError(502, 'invalid_response', '杭电助手没有返回会话 Cookie。');
      const expires = typeof body.expires_at === 'string' ? Date.parse(body.expires_at) : Number.NaN;
      session = {
        cookie,
        csrf: body.csrf_token,
        expiresAt: Number.isFinite(expires) ? expires : now() + 8 * 3600_000,
        capabilities: body.capabilities && typeof body.capabilities === 'object' ? body.capabilities : {},
      };
      lastError = null;
      return status();
    },
    disconnect() {
      session = null;
      lastError = null;
    },
    get: (path) => requestJson(path),
    post: (path, body) => requestJson(path, { method: 'POST', body, csrf: true }),
    async ask(text) {
      const question = String(text ?? '').trim();
      if (question.length < 1 || question.length > 1500) {
        throw new CampusClientError(400, 'invalid_arguments', '问题需为 1 至 1500 个字符。');
      }
      const body = await requestJson('/web/api/messages', {
        method: 'POST',
        csrf: true,
        body: { text: question, request_id: crypto.randomUUID() },
      });
      if (!body || typeof body.text !== 'string' || typeof body.state !== 'string') {
        throw new CampusClientError(502, 'invalid_response', '杭电助手回答格式异常。');
      }
      return {
        requestId: typeof body.request_id === 'string' ? body.request_id : '',
        state: body.state,
        route: typeof body.route === 'string' ? body.route : '',
        text: body.text,
        sources: Array.isArray(body.sources) ? body.sources : [],
        warnings: Array.isArray(body.warnings) ? body.warnings.filter((item) => typeof item === 'string') : [],
        isDemo: body.is_demo === true,
        truncated: body.truncated === true,
      };
    },
  };
}
