import { createCampusCache } from './campusCache.mjs';
import { createCampusClient, CampusClientError } from './campusClient.mjs';
import { createCampusSettings } from './campusSettings.mjs';

const MAX_BODY = 32_768;
const TTL = {
  notices: 10 * 60_000,
  calendar: 12 * 3_600_000,
  courses: 6 * 3_600_000,
  exams: 6 * 3_600_000,
  card: 5 * 60_000,
  electric: 30 * 60_000,
  library: 30 * 60_000,
};
const PERSONAL_PATHS = {
  courses: '/web/api/campus/courses',
  exams: '/web/api/campus/exams',
  card: '/web/api/campus/card',
  electric: '/web/api/campus/electric',
  library: '/web/api/campus/library',
};

function send(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('body_too_large'), { code: 'body_too_large' });
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('invalid_json'), { code: 'invalid_json' });
  }
}

function upstreamEnvelope(value, capability) {
  if (!value || typeof value !== 'object') {
    throw new CampusClientError(502, 'invalid_response', '杭电助手返回了无法识别的结果。');
  }
  return { ...value, ok: true, capability, stale: false };
}

export async function readCached(cache, key, { ttlMs, personal, loader, now = Date.now }) {
  const hit = cache.read(key);
  if (hit && now() - hit.at < ttlMs) return hit.envelope;
  try {
    const value = await loader();
    cache.write(key, value, { personal });
    return value;
  } catch (error) {
    if (!hit) throw error;
    const code = error instanceof CampusClientError ? error.code : 'helper_unavailable';
    const warnings = Array.isArray(hit.envelope.warnings) ? hit.envelope.warnings : [];
    return {
      ...hit.envelope,
      stale: true,
      cachedAt: new Date(hit.at).toISOString(),
      warnings: warnings.includes(code) ? warnings : [...warnings, code],
    };
  }
}

export function createCampusApi({ directory, helperUrl, fetchImpl, now = Date.now }) {
  const settings = createCampusSettings(directory);
  const cache = createCampusCache({ directory, now });
  const client = createCampusClient({ baseUrl: helperUrl, fetchImpl, now });

  function state() {
    const current = client.status();
    const stored = settings.read();
    return {
      ok: true,
      ...current,
      personalEnabled: stored.personalEnabled,
      personalAvailable: current.personalQueries,
    };
  }

  async function loadCached(key, { ttlMs, personal, loader }) {
    return readCached(cache, key, { ttlMs, personal, loader, now });
  }

  function requireConnected() {
    const current = client.status();
    if (!current.connected) throw new CampusClientError(409, 'not_connected', '请先重新连接杭电助手。');
    return current;
  }

  function requirePersonal() {
    const current = requireConnected();
    if (!settings.read().personalEnabled) throw new CampusClientError(403, 'personal_disabled', '个人校园数据只读开关未开启。');
    if (!current.personalQueries) throw new CampusClientError(403, 'owner_binding_required', '杭电助手未开启本人绑定，个人数据不可用。');
    return current;
  }

  async function readNotices(params = {}) {
    requireConnected();
    const query = new URLSearchParams();
    for (const [key, limit] of [['q', 200], ['source_key', 100]]) {
      const value = params[key];
      if (value) query.set(key, String(value).slice(0, limit));
    }
    for (const key of ['page', 'page_size']) {
      if (params[key]) query.set(key, String(params[key]));
    }
    const suffix = query.toString() ? `?${query}` : '';
    return loadCached(`notices:${suffix}`, {
      ttlMs: TTL.notices,
      personal: false,
      loader: async () => {
        const upstream = await client.get(`/web/api/notices${suffix}`);
        return {
          ok: true,
          capability: 'notices',
          fetchedAt: new Date(now()).toISOString(),
          stale: false,
          demo: upstream?.mode === 'demo',
          warnings: Array.isArray(upstream?.warnings) ? upstream.warnings.filter((item) => typeof item === 'string') : [],
          data: upstream,
        };
      },
    });
  }

  async function readCalendar() {
    requireConnected();
    return loadCached('calendar', {
      ttlMs: TTL.calendar,
      personal: false,
      loader: async () => upstreamEnvelope(await client.get('/web/api/campus/calendar'), 'calendar'),
    });
  }

  async function readPersonal(kind) {
    requirePersonal();
    return loadCached(kind, {
      ttlMs: TTL[kind],
      personal: true,
      loader: async () => upstreamEnvelope(await client.get(PERSONAL_PATHS[kind]), kind),
    });
  }

  async function read(kind, params = {}) {
    if (kind === 'notices') return readNotices(params);
    if (kind === 'calendar') return readCalendar();
    if (kind === 'card' || kind === 'electric' || kind === 'library' || kind === 'courses' || kind === 'exams') return readPersonal(kind);
    throw new CampusClientError(400, 'unsupported', '不支持的校园数据类型。');
  }

  async function readLife() {
    requirePersonal();
    const entries = await Promise.all(['card', 'electric', 'library'].map(async (kind) => {
      try {
        return [kind, await readPersonal(kind)];
      } catch (error) {
        return [kind, { ok: false, error: error?.code ?? 'helper_unavailable', message: error instanceof Error ? error.message : '暂时不可用。' }];
      }
    }));
    return Object.fromEntries(entries);
  }

  async function handle(request, response, url, { session, allowedOrigin }) {
    if (!url.pathname.startsWith('/api/campus/')) return false;
    if (session.kind !== 'session') {
      send(response, 403, { ok: false, error: 'session_required', message: '校园数据只允许网页登录后访问。' });
      return true;
    }
    const write = request.method !== 'GET';
    if (write && !allowedOrigin) {
      send(response, 403, { ok: false, error: 'origin_denied', message: '拒绝跨源写入。' });
      return true;
    }
    try {
      if (request.method === 'GET' && url.pathname === '/api/campus/status') {
        send(response, 200, state());
        return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/campus/connect') {
        const body = await readBody(request);
        await client.connect(body?.password);
        cache.clearPersonal();
        send(response, 200, state());
        return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/campus/disconnect') {
        client.disconnect();
        cache.clearPersonal();
        send(response, 200, state());
        return true;
      }
      if (request.method === 'PUT' && url.pathname === '/api/campus/personal') {
        const body = await readBody(request);
        if (typeof body?.enabled !== 'boolean') {
          send(response, 400, { ok: false, error: 'invalid_arguments', message: 'enabled 必须是布尔值。' });
          return true;
        }
        settings.update({ personalEnabled: body.enabled });
        if (!body.enabled) cache.clearPersonal();
        send(response, 200, state());
        return true;
      }
      if (request.method === 'GET' && url.pathname === '/api/campus/notices') {
        const value = await readNotices(Object.fromEntries(url.searchParams));
        send(response, 200, value);
        return true;
      }
      if (request.method === 'GET' && url.pathname === '/api/campus/calendar') {
        const value = await readCalendar();
        send(response, 200, value);
        return true;
      }
      const kind = url.pathname.match(/^\/api\/campus\/(courses|exams|card|electric|library)$/)?.[1];
      if (request.method === 'GET' && kind) {
        const value = await readPersonal(kind);
        send(response, 200, value);
        return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/campus/ask') {
        if (!client.status().connected) {
          send(response, 409, { ok: false, error: 'not_connected', message: '请先重新连接杭电助手。' });
          return true;
        }
        const body = await readBody(request);
        const answer = await client.ask(body?.text);
        send(response, 200, { ok: true, answer });
        return true;
      }
      send(response, 404, { ok: false, error: 'not_found' });
      return true;
    } catch (error) {
      if (error?.code === 'body_too_large') {
        send(response, 413, { ok: false, error: 'body_too_large', message: '请求体过大。' });
      } else if (error?.code === 'invalid_json') {
        send(response, 400, { ok: false, error: 'invalid_json', message: '请求不是合法 JSON。' });
      } else if (error instanceof CampusClientError) {
        send(response, error.status, { ok: false, error: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) });
      } else {
        send(response, 502, { ok: false, error: 'helper_unavailable', message: '校园助手暂时不可用。' });
      }
      return true;
    }
  }

  return { handle, state, read, readLife };
}
