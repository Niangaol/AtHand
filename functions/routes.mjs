// 顺手云端后端：账本、生活记录、日历、采集样本与校园助手。
// 运行在 Qoder Sites Edge Function，数据库通过平台注入的 client 访问。
import { applyCommand, canonical, commandKey, createPlannerState } from './planner.mjs';
import { reconcileCalendar } from './calendar.mjs';
import { createCampus } from './campus.mjs';
import { createAccount } from './account.mjs';
import { createAssistant } from './assistant.mjs';
import {
  ApiError, DOCS, fail, json, storageError, readJson, rowsOf, createDocs,
  sha256Hex,
} from './lib.mjs';

const MAX_SAMPLES = 500;
const MAX_RECEIPTS = 100_000;
const MAX_ASSISTANTS = 20;

// 云端跑在 Deno Edge Function（index.ts 里直接调 Deno.serve），但本地 `node --test` 里
// 没有 Deno 全局，直接写 Deno.env.get 会抛 ReferenceError。这里做成安全包装：
// 优先读平台注入的 Secret，本地退到 process.env，再退到 git 忽略的本地凭据文件。
// 本地凭据文件随 functions/ 目录一起打包进 Function，但不会进入版本库。
let localSecrets = {};
try {
  localSecrets = (await import('./assistant-secrets.local.mjs')).default ?? {};
} catch { /* 没有本地凭据文件时只依赖平台 Secret。 */ }

function readEnv(key) {
  try {
    return globalThis.Deno?.env?.get(key) ?? globalThis.process?.env?.[key] ?? localSecrets[key] ?? '';
  } catch {
    return localSecrets[key] ?? '';
  }
}

function validLedger(value) {
  return Boolean(value) && typeof value === 'object' && value.version === 1
    && Array.isArray(value.records) && Array.isArray(value.workplaces)
    && value.records.length <= 20000 && value.workplaces.length <= 2000
    && Boolean(value.settings) && typeof value.settings === 'object'
    && Number.isSafeInteger(value.settings.hourlyRateCents);
}

export function application({ db, fetch: transport = globalThis.fetch, env = { get: readEnv } }) {
  const USERS = 'shunshou_users';
  const USERNAME_RE = /^[\p{L}\p{N}_-]{3,32}$/u;
  const MAX_PASSWORD = 200;
  const account = createAccount({ db });
  const {
    publicUser, findUserByUsername, findUserById, makePassword, passwordMatches,
    issueSession, validSession, revokeSession,
  } = account;

  // 助手实例按用户缓存：briefCache 的 10 分钟 TTL 全靠实例常驻，每请求新建会让它完全失效，
  // 平台统一 Key 下还会重复计费。docs 是按用户创建的（内含 owner 前缀），必须跟实例一起缓存，
  // 不能跨用户复用。db 是应用级稳定的（index.ts 只创建一次），所以整个 application 作用域内缓存是安全的。
  // 上限 MAX_ASSISTANTS，命中时移到队尾，超出时淘汰最久未使用的那个。
  const assistants = new Map();
  function assistantFor(userId, docs) {
    const cached = assistants.get(userId);
    if (cached) {
      assistants.delete(userId);
      assistants.set(userId, cached);
      return cached;
    }
    const assistant = createAssistant({ docs, userId, env, fetch: transport });
    assistants.set(userId, assistant);
    while (assistants.size > MAX_ASSISTANTS) {
      assistants.delete(assistants.keys().next().value);
    }
    return assistant;
  }

  async function migrateLegacyDocs(userId) {
    const now = new Date().toISOString();
    const lock = await db.from(DOCS).insertIfAbsent({
      key: 'system:accounts-migrated', value: { at: now }, revision: 0, updated_at: now,
    }, { onConflict: 'key' }).select('key');
    if (lock?.error && lock.error.code !== '23505') throw storageError();
    if (!Array.isArray(lock?.data) || lock.data.length === 0) return false;
    const legacyNames = ['ledger', 'planner', 'calendar', 'samples', 'campus-auth', 'assistant'];
    for (const name of legacyNames) {
      const rows = rowsOf(await db.from(DOCS).select('key,value,revision').eq('key', `cloud:${name}`).limit(1));
      if (!rows.length) continue;
      const row = rows[0];
      await db.from(DOCS).insertIfAbsent({
        key: `${userId}:${name}`, value: row.value, revision: Number.isSafeInteger(row.revision) ? row.revision : 0, updated_at: now,
      }, { onConflict: 'key' });
    }
    return true;
  }

  async function register(request) {
    const body = await readJson(request);
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!USERNAME_RE.test(username)) {
      return json({ ok: false, error: 'invalid_username', message: '账号需为 3–32 位字母、数字、下划线、短横线或中文。' }, 400);
    }
    if (password.length < 8 || password.length > MAX_PASSWORD) {
      return json({ ok: false, error: 'invalid_password', message: '密码至少 8 位。' }, 400);
    }
    const lower = username.toLowerCase();
    if (await findUserByUsername(lower)) {
      return json({ ok: false, error: 'username_taken', message: '这个账号已经被使用。' }, 409);
    }
    const passwordHash = await makePassword(password);
    const user = {
      id: crypto.randomUUID(), username, username_lower: lower,
      password_salt: passwordHash.salt, password_hash: passwordHash.hash, password_iterations: passwordHash.iterations,
      created_at: new Date().toISOString(), last_login_at: new Date().toISOString(),
    };
    const inserted = await db.from(USERS).insert(user);
    if (inserted?.error) {
      if (inserted.error.code === '23505') {
        return json({ ok: false, error: 'username_taken', message: '这个账号已经被使用。' }, 409);
      }
      throw storageError();
    }
    let migrated = false;
    try { migrated = await migrateLegacyDocs(user.id); } catch { /* 旧数据仍保留在云端，可稍后迁移。 */ }
    const session = await issueSession(user.id, request);
    return json({ ok: true, ...session, user: publicUser(user), legacyMigrated: migrated });
  }

  async function login(request) {
    const body = await readJson(request);
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!username || !password) {
      return json({ ok: false, error: 'invalid_credentials', message: '请填写账号和密码。' }, 400);
    }
    const user = await findUserByUsername(username.toLowerCase());
    if (!user || !(await passwordMatches(user, password))) {
      return json({ ok: false, error: 'invalid_credentials', message: '账号或密码不对。' }, 401);
    }
    const now = new Date().toISOString();
    await db.from(USERS).update({ last_login_at: now }).eq('id', user.id);
    user.last_login_at = now;
    const session = await issueSession(user.id, request);
    return json({ ok: true, ...session, user: publicUser(user) });
  }

  return async function handle(ctx) {
    const request = ctx?.request ?? ctx;
    try {
      const url = new URL(request.url);
      const match = url.pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
      const path = match ? (match[1] || '/') : url.pathname.startsWith('/api/') ? url.pathname : null;
      if (!path) return json({ ok: false, error: 'not_found' }, 404);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

      if (path === '/api/health' && request.method === 'GET') {
        return json({ ok: true, service: 'shunshou-cloud' });
      }

      if (path === '/api/register' && request.method === 'POST') {
        return register(request);
      }

      if (path === '/api/login' && request.method === 'POST') {
        return login(request);
      }

      if (path === '/api/logout' && request.method === 'POST') {
        await revokeSession(request);
        return json({ ok: true });
      }

      const session = await validSession(request);
      if (!session) {
        return json({ ok: false, error: 'unauthorized', message: '登录已失效，请重新登录。' }, 401);
      }

      if (path === '/api/account' && request.method === 'GET') {
        return account.summary(session);
      }

      if (path === '/api/account/password' && request.method === 'POST') {
        return account.changePassword(request, session);
      }

      if (path === '/api/account/sessions' && request.method === 'GET') {
        return account.listSessions(session);
      }

      const sessionMatch = path.match(/^\/api\/account\/sessions\/([A-Za-z0-9_-]{1,80})$/);
      if (sessionMatch && request.method === 'DELETE') {
        return account.revokeSessionById(session, sessionMatch[1]);
      }

      if (path === '/api/account/logout-all' && request.method === 'POST') {
        return account.logoutAll(session);
      }

      if (path === '/api/account/delete' && request.method === 'POST') {
        return account.deleteAccount(request, session);
      }

      if (path.startsWith('/api/account')) {
        return json({ ok: false, error: 'not_found' }, 404);
      }

      if (path === '/api/me' && request.method === 'GET') {
        const user = await findUserById(session.userId);
        if (!user) {
          await revokeSession(request);
          return json({ ok: false, error: 'unauthorized', message: '账号不存在，请重新登录。' }, 401);
        }
        return json({ ok: true, user: publicUser(user) });
      }

      const docs = createDocs(db, session.userId);
      const getDoc = (name) => docs.get(name);
      const ensureDoc = (name, makeValue) => docs.ensure(name, makeValue);
      const replaceDoc = (doc, value) => docs.replace(doc, value);
      const campus = createCampus({ docs, fetch: transport });
      const plannerDoc = () => ensureDoc('planner', () => ({
        state: createPlannerState(),
        serverId: crypto.randomUUID(),
        entityVersions: {},
        receipts: [],
      }));
      const publicPlanner = (doc) => {
        const value = doc.value ?? {};
        return {
          state: value.state,
          revision: doc.revision,
          serverId: value.serverId,
          entityVersions: value.entityVersions ?? {},
        };
      };

      if (path === '/api/planner' && request.method === 'GET') {
        return json(publicPlanner(await plannerDoc()));
      }

      if (path === '/api/planner/operations' && request.method === 'POST') {
        const body = await readJson(request);
        if (!body || typeof body !== 'object'
          || typeof body.operationId !== 'string' || !body.operationId || body.operationId.length > 160
          || !Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0
          || !body.command || typeof body.command !== 'object') {
          fail(400, 'invalid_input', '同步操作格式不对。');
        }
        const doc = await plannerDoc();
        const receipts = Array.isArray(doc.value.receipts) ? doc.value.receipts : [];
        const hash = await sha256Hex(JSON.stringify(canonical(body.command)));
        const previous = receipts.find((receipt) => receipt.id === body.operationId);
        if (previous) {
          if (previous.hash !== hash) fail(409, 'request_id_reused', '这个操作标识已经用于另一个不同操作。');
          return json({ ...publicPlanner(doc), appliedRevision: previous.revision });
        }
        if (doc.revision !== body.baseRevision) fail(409, 'conflict', '生活记录在另一处被修改，请重试。');
        const state = applyCommand(doc.value.state, body.command, Date.now());
        const revision = doc.revision + 1;
        const key = commandKey(body.command);
        const nextValue = {
          ...doc.value,
          state,
          entityVersions: { ...(doc.value.entityVersions ?? {}), [key]: revision },
          receipts: [...receipts, { id: body.operationId, hash, revision }].slice(-MAX_RECEIPTS),
        };
        await replaceDoc(doc, nextValue);
        return json({
          state,
          revision,
          serverId: doc.value.serverId,
          entityVersions: nextValue.entityVersions,
          appliedRevision: revision,
        });
      }

      if (path === '/api/ledger' && request.method === 'GET') {
        const doc = await getDoc('ledger');
        return json({
          ok: true,
          ledger: doc?.value?.ledger ?? null,
          updatedAt: doc?.value?.updatedAt ?? null,
        });
      }

      if (path === '/api/ledger' && request.method === 'PUT') {
        const body = await readJson(request);
        if (!validLedger(body?.ledger)) return json({ ok: false, error: 'invalid_ledger' }, 400);
        const force = body?.force === true;
        const base = typeof body?.baseUpdatedAt === 'string' ? body.baseUpdatedAt : null;
        const current = await getDoc('ledger');
        if (!force && current && base !== current.value?.updatedAt) {
          return json({
            ok: false, error: 'conflict',
            ledger: current.value?.ledger ?? null,
            updatedAt: current.value?.updatedAt ?? null,
          }, 409);
        }
        const updatedAt = new Date().toISOString();
        if (!current) {
          const inserted = await db.from(DOCS).insertIfAbsent({
            key: docs.keyFor('ledger'), value: { ledger: body.ledger, updatedAt }, revision: 0, updated_at: updatedAt,
          }, { onConflict: 'key' }).select('key');
          if (inserted?.error && inserted.error.code !== '23505') throw storageError();
          const after = await getDoc('ledger');
          if (!after) throw storageError();
          if (after.value?.updatedAt !== updatedAt && !force) {
            return json({
              ok: false, error: 'conflict',
              ledger: after.value?.ledger ?? null,
              updatedAt: after.value?.updatedAt ?? null,
            }, 409);
          }
          return json({ ok: true, updatedAt: after.value?.updatedAt ?? updatedAt });
        }
        await replaceDoc(current, { ledger: body.ledger, updatedAt });
        return json({ ok: true, updatedAt });
      }

      if (path === '/api/calendar' && request.method === 'GET') {
        const planner = await plannerDoc();
        const doc = await ensureDoc('calendar', () => ({ sources: [], receipts: [] }));
        return json({
          sources: Array.isArray(doc.value.sources) ? doc.value.sources : [],
          serverId: planner.value.serverId,
        });
      }

      if (path === '/api/calendar/snapshot' && request.method === 'PUT') {
        const body = await readJson(request);
        const doc = await ensureDoc('calendar', () => ({ sources: [], receipts: [] }));
        const sources = Array.isArray(doc.value.sources) ? doc.value.sources : [];
        const receipts = Array.isArray(doc.value.receipts) ? doc.value.receipts : [];
        const hash = await sha256Hex(JSON.stringify(body));
        const receipt = receipts.find((item) => item.sourceId === body?.sourceId && item.requestId === body?.requestId);
        const previous = sources.find((source) => source.sourceId === body?.sourceId) ?? null;
        if (receipt) {
          if (receipt.hash !== hash) fail(409, 'request_id_reused', '这个日历请求标识已经用于另一个不同操作。');
          return json(previous);
        }
        const snapshot = reconcileCalendar(previous, body);
        const nextSources = [...sources.filter((source) => source.sourceId !== snapshot.sourceId), snapshot];
        const nextReceipts = [...receipts, {
          sourceId: snapshot.sourceId, requestId: body.requestId, hash, revision: snapshot.revision,
        }].slice(-MAX_RECEIPTS);
        await replaceDoc(doc, { ...doc.value, sources: nextSources, receipts: nextReceipts });
        return json(snapshot);
      }

      if (path === '/api/samples' && request.method === 'GET') {
        const doc = await ensureDoc('samples', () => ({ items: [] }));
        return json({ ok: true, samples: Array.isArray(doc.value.items) ? doc.value.items : [] });
      }

      if (path === '/api/samples' && request.method === 'POST') {
        const body = await readJson(request);
        const incoming = Array.isArray(body) ? body : body?.samples;
        if (!Array.isArray(incoming)) return json({ ok: false, error: 'expected_sample_array' }, 400);
        const doc = await ensureDoc('samples', () => ({ items: [] }));
        const current = Array.isArray(doc.value.items) ? doc.value.items : [];
        const byId = new Map(current.map((item) => [String(item?.id ?? ''), item]));
        let added = 0;
        for (const item of incoming.slice(0, MAX_SAMPLES)) {
          if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) continue;
          if (!byId.has(item.id)) added += 1;
          byId.set(item.id, item);
        }
        const merged = [...byId.values()];
        await replaceDoc(doc, { ...doc.value, items: merged });
        return json({ ok: true, added, total: merged.length });
      }

      if (path.startsWith('/api/assistant/')) {
        const assistant = assistantFor(session.userId, docs);

        if (path === '/api/assistant/settings') {
          if (request.method === 'GET') return json({ ok: true, ...(await assistant.readSettings()) });
          if (request.method === 'PUT') {
            const body = await readJson(request);
            return json({ ok: true, ...(await assistant.writeSettings(body)) });
          }
          fail(405, 'method_not_allowed', '不支持这个请求方法。');
        }

        if (path === '/api/assistant/test' && request.method === 'POST') {
          return json({ ok: true, result: await assistant.test() });
        }

        if (path === '/api/assistant/chat' && request.method === 'POST') {
          const body = await readJson(request);
          const messages = Array.isArray(body?.messages) ? body.messages : [];
          return json({ ok: true, ...(await assistant.chat(messages)) });
        }

        if (path === '/api/assistant/briefing' && request.method === 'GET') {
          const params = new URL(request.url).searchParams;
          const scope = params.get('scope') === 'week' ? 'week' : 'day';
          const fresh = params.get('fresh') === '1';
          return json({ ok: true, ...(await assistant.briefing({ scope, fresh })) });
        }

        fail(404, 'not_found', '没有这个助手接口。');
      }

      if (path.startsWith('/api/campus/')) {
        return campus.handle(request);
      }

      if (path.startsWith('/api/agent/')) {
        return json({ ok: false, error: 'not_supported', message: 'Agent 令牌只在电脑网关上可用。' }, 404);
      }

      if (path === '/api/pair/code') {
        return json({ ok: false, error: 'not_supported', message: '配对口令只在电脑网关上可用。' }, 503);
      }

      return json({ ok: false, error: 'not_found' }, 404);
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ ok: false, error: error.code, message: error.message }, error.status);
      }
      // AssistantError / AgentError 都是普通 Error 带 status + code，
      // 必须排在 conflict 等按 code 分流的旧分支之前，否则会被兜底成 503 storage_unavailable。
      if (error instanceof Error && typeof error.code === 'string' && Number.isInteger(error.status)) {
        return json({ ok: false, error: error.code, message: error.message }, error.status);
      }
      if (error?.code === 'conflict') return json({ ok: false, error: 'conflict', message: '数据冲突，请重试。' }, 409);
      if (error?.code === 'operation_reused' || error?.code === 'request_id_reused') {
        return json({ ok: false, error: 'request_id_reused', message: '这个操作标识已经用于另一个不同操作。' }, 409);
      }
      if (error?.code === 'invalid_input') return json({ ok: false, error: 'invalid_input', message: error.message || '参数格式不对。' }, 400);
      if (error?.name === 'SyntaxError') return json({ ok: false, error: 'invalid_json' }, 400);
      return json({ ok: false, error: 'storage_unavailable', message: '云端数据暂时不可用，请稍后重试。' }, 503);
    }
  };
}