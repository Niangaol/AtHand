import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 18787);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.join(process.cwd(), 'local-sync', 'data');
const SAMPLES_FILE = path.join(DATA_DIR, 'samples.json');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const HDU_TARGET = new URL(process.env.HDU_HELPER_URL ?? 'http://127.0.0.1:8000');
const MAX_BODY = 2_000_000;
const MAX_SAMPLES = 500;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LIMIT = 8;

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

function loadAuthFile() {
  const value = readJson(AUTH_FILE, null);
  if (!value || typeof value !== 'object' || typeof value.passwordHash !== 'string' || typeof value.salt !== 'string') return null;
  return { salt: value.salt, passwordHash: value.passwordHash, tokens: Array.isArray(value.tokens) ? value.tokens : [] };
}

function ensurePassword() {
  const auth = loadAuthFile();
  const fromEnv = String(process.env.SHUNSHOU_PASSWORD ?? '');
  if (fromEnv.length >= 8) {
    const salt = crypto.randomBytes(16).toString('hex');
    const next = { salt, passwordHash: scrypt(fromEnv, salt), tokens: auth?.tokens ?? [] };
    writeJson(AUTH_FILE, next);
    return next;
  }
  if (auth) return auth;
  const password = randomPassword();
  const salt = crypto.randomBytes(16).toString('hex');
  const next = { salt, passwordHash: scrypt(password, salt), tokens: [] };
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

const authState = ensurePassword();

function authorized(request) {
  const header = String(request.headers.authorization ?? '');
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const hash = sha256(token);
  const now = Date.now();
  const found = authState.tokens.find((item) => item.hash === hash && item.expiresAt > now);
  return found ? { token } : null;
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

function cors(request, response) {
  const origin = request.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
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

  const session = authorized(request);
  if (!session) {
    json(response, 401, { ok: false, error: 'unauthorized' });
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
  console.log(`顺手网关: http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
  console.log('网页填这个地址 + 访问口令；远程访问用 HTTPS 隧道地址。');
  console.log(`如需手机走局域网直连，用 HOST=0.0.0.0 npm run sync（不建议长期开放）。`);
});
