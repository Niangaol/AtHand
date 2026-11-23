// 账号管理：密码哈希、7 天会话签发/校验，以及改密、设备会话、退出全部与账号注销。
// 会话行沿用 shunshou_sessions；设备信息是新增的展示字段，旧行没有时展示「未知设备」。
import {
  DOCS, createDocs, json, readJson, rowsOf,
  base64, base64url, fromBase64, pbkdf2, sha256Hex, storageError, timingSafeEqual,
} from './lib.mjs';

export const USERS = 'shunshou_users';
export const SESSIONS = 'shunshou_sessions';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const LAST_SEEN_TOUCH_MS = 10 * 60 * 1000;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const MAX_DEVICE_LABEL = 80;
const MAX_USER_AGENT = 300;
const DELETE_CONFIRMATIONS = new Set(['delete-account', '注销账号', 'DELETE']);
// 账号数据全部落在 `${userId}:*` 文档里；这些是当前代码会创建的文档名，
// 即使全表扫描被 limit 截断，也会逐个删除，避免漏掉账本/课表/校园 PAT。
const ACCOUNT_DOC_NAMES = ['ledger', 'planner', 'calendar', 'samples', 'campus-auth', 'assistant'];

function sessionToken(request) {
  const custom = (request.headers.get('x-shunshou-session') ?? '').trim();
  if (custom) return custom;
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function browserName(ua) {
  if (/MicroMessenger/i.test(ua)) return '微信';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua)) return 'Opera';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua)) return 'Safari';
  return '';
}

function platformName(ua) {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return '';
}

export function deviceLabelOf(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  const composed = [browserName(ua), platformName(ua)].filter(Boolean).join(' · ');
  if (composed) return composed;
  if (/curl|wget|node|undici|python-requests/i.test(ua)) return '命令行客户端';
  return '未知设备';
}

function requestDevice(request) {
  const explicit = (request.headers.get('x-device-name') ?? '').trim();
  const userAgent = (request.headers.get('user-agent') ?? '').slice(0, MAX_USER_AGENT);
  const label = explicit ? explicit.slice(0, MAX_DEVICE_LABEL) : deviceLabelOf(userAgent);
  return { deviceLabel: label, userAgent };
}

function sessionView(row, currentSessionId, now) {
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  const createdAt = typeof row.created_at === 'string' ? row.created_at : null;
  const lastSeenAt = typeof row.last_seen_at === 'string' ? row.last_seen_at : createdAt;
  return {
    id: typeof row.id === 'string' ? row.id : '',
    deviceLabel: typeof row.device_label === 'string' && row.device_label
      ? row.device_label
      : deviceLabelOf(row.user_agent),
    createdAt,
    lastSeenAt,
    expiresAt: new Date(expiresAt).toISOString(),
    current: Boolean(currentSessionId) && row.id === currentSessionId,
  };
}

export function createAccount({ db }) {
  function publicUser(user) {
    return {
      id: user.id,
      username: user.username,
      createdAt: user.created_at ?? null,
      lastLoginAt: user.last_login_at ?? null,
    };
  }

  async function findUserByUsername(lower) {
    const rows = rowsOf(await db.from(USERS)
      .select('id,username,username_lower,password_salt,password_hash,password_iterations,created_at,last_login_at')
      .eq('username_lower', lower).limit(1));
    return rows[0] ?? null;
  }

  async function findUserById(id) {
    const rows = rowsOf(await db.from(USERS)
      .select('id,username,created_at,last_login_at')
      .eq('id', id).limit(1));
    return rows[0] ?? null;
  }

  async function findUserAuthById(id) {
    const rows = rowsOf(await db.from(USERS)
      .select('id,username,password_salt,password_hash,password_iterations,created_at,last_login_at')
      .eq('id', id).limit(1));
    return rows[0] ?? null;
  }

  async function makePassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = 150_000;
    const hash = await pbkdf2(password, salt, iterations);
    return { salt: base64(salt), hash: base64(hash), iterations };
  }

  async function passwordMatches(user, password) {
    if (!user || typeof user.password_salt !== 'string' || typeof user.password_hash !== 'string'
      || !Number.isInteger(user.password_iterations) || user.password_iterations < 10_000) return false;
    const computed = await pbkdf2(password, fromBase64(user.password_salt), user.password_iterations);
    return timingSafeEqual(computed, fromBase64(user.password_hash));
  }

  async function issueSession(userId, request) {
    const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const hash = await sha256Hex(token);
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;
    const { deviceLabel, userAgent } = requestDevice(request);
    const base = {
      id: crypto.randomUUID(), token_hash: hash, user_id: userId,
      created_at: new Date(now).toISOString(), expires_at: new Date(expiresAt).toISOString(),
    };
    const withDevice = { ...base, last_seen_at: base.created_at, device_label: deviceLabel, user_agent: userAgent };
    let result = await db.from(SESSIONS).insert(withDevice);
    // 兼容不支持新增展示列的表结构：设备字段写不进去时退回最小会话行，登录不受影响。
    if (result?.error) {
      result = await db.from(SESSIONS).insert(base);
      if (result?.error) throw storageError();
    }
    return { token, expiresAt, sessionId: base.id };
  }

  async function validSession(request) {
    const token = sessionToken(request);
    if (!token) return null;
    const hash = await sha256Hex(token);
    let data;
    try {
      data = rowsOf(await db.from(SESSIONS)
        .select('id,user_id,expires_at,last_seen_at').eq('token_hash', hash).limit(1));
    } catch {
      // 兼容没有 last_seen_at 展示列的旧表结构：退回最小列，鉴权本身不受影响。
      data = rowsOf(await db.from(SESSIONS)
        .select('id,user_id,expires_at').eq('token_hash', hash).limit(1));
    }
    if (!data.length) return null;
    const row = data[0];
    const expiresAt = Date.parse(row.expires_at);
    if (typeof row.user_id !== 'string' || !row.user_id
      || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      try { await db.from(SESSIONS).delete().eq('token_hash', hash); } catch { /* 过期清理失败不影响判定。 */ }
      return null;
    }
    const lastSeen = Date.parse(row.last_seen_at);
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > LAST_SEEN_TOUCH_MS) {
      try {
        await db.from(SESSIONS).update({ last_seen_at: new Date().toISOString() }).eq('token_hash', hash);
      } catch { /* 活跃时间只是展示字段，写入失败不阻断请求。 */ }
    }
    return {
      userId: row.user_id,
      tokenHash: hash,
      sessionId: typeof row.id === 'string' ? row.id : null,
    };
  }

  async function revokeSession(request) {
    const token = sessionToken(request);
    if (!token) return;
    const hash = await sha256Hex(token);
    await db.from(SESSIONS).delete().eq('token_hash', hash);
  }

  async function activeSessions(userId, currentSessionId) {
    let rows;
    try {
      rows = rowsOf(await db.from(SESSIONS)
        .select('id,created_at,expires_at,last_seen_at,device_label,user_agent')
        .eq('user_id', userId));
    } catch {
      rows = rowsOf(await db.from(SESSIONS)
        .select('id,created_at,expires_at').eq('user_id', userId));
    }
    const now = Date.now();
    return rows
      .map((row) => sessionView(row, currentSessionId, now))
      .filter(Boolean)
      .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')));
  }

  async function summary(session) {
    const user = await findUserById(session.userId);
    if (!user) {
      try { await db.from(SESSIONS).delete().eq('token_hash', session.tokenHash); } catch { /* 失效处理失败不改变 401。 */ }
      return json({ ok: false, error: 'unauthorized', message: '账号不存在，请重新登录。' }, 401);
    }
    const sessions = await activeSessions(session.userId, session.sessionId);
    const docs = createDocs(db, session.userId);
    const ledger = await docs.get('ledger');
    const planner = await docs.get('planner');
    const samples = await docs.get('samples');
    const campus = await docs.get('campus-auth');
    const ledgerValue = ledger?.value?.ledger;
    const plannerState = planner?.value?.state;
    return json({
      ok: true,
      user: publicUser(user),
      currentSession: sessions.find((item) => item.current) ?? null,
      stats: {
        sessions: sessions.length,
        ledgerRecords: Array.isArray(ledgerValue?.records) ? ledgerValue.records.length : 0,
        plannerEvents: Array.isArray(plannerState?.events) ? plannerState.events.length : 0,
        plannerRevision: Number.isSafeInteger(planner?.revision) ? planner.revision : 0,
        samples: Array.isArray(samples?.value?.items) ? samples.value.items.length : 0,
        campusConnected: Boolean(campus?.value?.pat),
      },
    });
  }

  async function listSessions(session) {
    const sessions = await activeSessions(session.userId, session.sessionId);
    return json({ ok: true, currentSessionId: session.sessionId, sessions });
  }

  async function changePassword(request, session) {
    const body = await readJson(request);
    const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword
      : typeof body?.oldPassword === 'string' ? body.oldPassword : '';
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
    if (!currentPassword) return json({ ok: false, error: 'invalid_input', message: '请填写当前密码。' }, 400);
    if (newPassword.length < MIN_PASSWORD || newPassword.length > MAX_PASSWORD) {
      return json({ ok: false, error: 'invalid_password', message: '新密码至少 8 位。' }, 400);
    }
    if (newPassword === currentPassword) {
      return json({ ok: false, error: 'password_unchanged', message: '新密码不能和当前密码相同。' }, 400);
    }
    const user = await findUserAuthById(session.userId);
    if (!user || !(await passwordMatches(user, currentPassword))) {
      return json({ ok: false, error: 'invalid_credentials', message: '当前密码不对。' }, 401);
    }
    const passwordHash = await makePassword(newPassword);
    // 先吊销其它会话再改密：任一步失败时旧密码仍然有效，用户可原样重试，
    // 不会出现「密码已换但客户端只看到 503」的半成功状态。
    const rows = rowsOf(await db.from(SESSIONS)
      .select('id,token_hash').eq('user_id', user.id));
    let revoked = 0;
    for (const row of rows) {
      if (row.token_hash === session.tokenHash) continue;
      const result = await db.from(SESSIONS).delete().eq('id', row.id);
      if (result?.error) throw storageError();
      revoked += 1;
    }
    const updated = await db.from(USERS).update({
      password_salt: passwordHash.salt,
      password_hash: passwordHash.hash,
      password_iterations: passwordHash.iterations,
    }).eq('id', user.id);
    if (updated?.error) throw storageError();
    return json({ ok: true, revokedSessions: revoked, user: publicUser(user) });
  }

  async function revokeSessionById(session, sessionId) {
    const id = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!id) return json({ ok: false, error: 'invalid_input', message: '缺少会话标识。' }, 400);
    const rows = rowsOf(await db.from(SESSIONS).select('id,user_id').eq('id', id).limit(1));
    if (!rows.length || rows[0].user_id !== session.userId) {
      return json({ ok: false, error: 'session_not_found', message: '没有找到这个会话。' }, 404);
    }
    const result = await db.from(SESSIONS).delete().eq('id', id);
    if (result?.error) throw storageError();
    return json({ ok: true, sessionId: id, current: id === session.sessionId });
  }

  async function logoutAll(session) {
    const rows = rowsOf(await db.from(SESSIONS).select('id').eq('user_id', session.userId));
    let revoked = 0;
    for (const row of rows) {
      const result = await db.from(SESSIONS).delete().eq('id', row.id);
      if (result?.error) throw storageError();
      revoked += 1;
    }
    return json({ ok: true, revoked });
  }

  async function deleteAccount(request, session) {
    const body = await readJson(request);
    const confirmation = typeof body?.confirmation === 'string' ? body.confirmation.trim()
      : typeof body?.confirm === 'string' ? body.confirm.trim() : '';
    if (!DELETE_CONFIRMATIONS.has(confirmation)) {
      return json({
        ok: false, error: 'confirmation_required',
        message: '注销账号需要再次确认（confirmation: "delete-account"）。',
      }, 400);
    }
    const password = typeof body?.password === 'string' ? body.password
      : typeof body?.currentPassword === 'string' ? body.currentPassword : '';
    if (!password) return json({ ok: false, error: 'invalid_input', message: '请填写密码。' }, 400);
    const user = await findUserAuthById(session.userId);
    if (!user || !(await passwordMatches(user, password))) {
      return json({ ok: false, error: 'invalid_credentials', message: '密码不对。' }, 401);
    }

    const docs = createDocs(db, session.userId);
    // 平台数据库适配器不接受无过滤的大范围扫描；按当前数据模型逐个文档删除。
    const keys = new Set(ACCOUNT_DOC_NAMES.map((name) => docs.keyFor(name)));
    let documents = 0;
    for (const key of keys) {
      const existing = rowsOf(await db.from(DOCS).select('key').eq('key', key).limit(1));
      if (!existing.length) continue;
      const result = await db.from(DOCS).delete().eq('key', key);
      if (result?.error) throw storageError();
      documents += 1;
    }

    const sessionRows = rowsOf(await db.from(SESSIONS).select('id').eq('user_id', user.id));
    for (const row of sessionRows) {
      const deleted = await db.from(SESSIONS).delete().eq('id', row.id);
      if (deleted?.error) throw storageError();
    }
    const userDeleted = await db.from(USERS).delete().eq('id', user.id);
    if (userDeleted?.error) throw storageError();
    if (await findUserById(user.id)) throw storageError();
    return json({
      ok: true,
      deleted: { user: true, sessions: sessionRows.length, documents },
    });
  }

  return {
    publicUser,
    findUserByUsername,
    findUserById,
    makePassword,
    passwordMatches,
    issueSession,
    validSession,
    revokeSession,
    summary,
    listSessions,
    changePassword,
    revokeSessionById,
    logoutAll,
    deleteAccount,
  };
}
