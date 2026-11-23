// 云端内置助手：从 local-sync/assistant.mjs 移植，去掉 fs/path/node:crypto 依赖。
// 差异：模型地址、模型名与 Key 来自站点环境变量（平台 Secret），用户只能改隐私模式；
// 工具层换成 functions/agentApi.mjs；脱敏器来自 functions/privacy.mjs（异步哈希）。
import { createAgentApi } from './agentApi.mjs';
import { createRedactor, normalizePrivacyMode } from './privacy.mjs';
import { dayBriefNarrative, weekReviewNarrative } from './vendor/domain.mjs';

// 云端运行时区通常是 UTC，提示词里的「现在」必须按用户时区算，与 agentApi.mjs 保持一致。
const TIME_ZONE = 'Asia/Shanghai';
const TIMEOUT_MS = 90_000;
const MAX_MESSAGES = 20;
const MAX_ITERATIONS = 5;
const MAX_TOOL_RESULT = 12_000;
const BRIEFING_TIMEOUT_MS = 30_000;
const BRIEFING_TTL_MS = 10 * 60_000;
const BRIEFING_MAX = 50;
const BRIEFING_MAX_CHARS = 600;
// 文档名不带用户前缀：createDocs(db, userId) 内部已按 owner 生成 `<userId>:` 键。
const PREFS_NAME = 'assistant';

export class AssistantError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isLoopback(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch { return false; }
}

// 与 agentApi.mjs 的 localIso 同一套取法：Intl 按目标时区给出日期与偏移。
function zoneDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    zone: part('timeZoneName').replace('GMT', '') || '+00:00',
  };
}

function systemPrompt(redacting) {
  const now = new Date();
  const stamp = new Intl.DateTimeFormat('zh-CN', { timeZone: TIME_ZONE, dateStyle: 'full', timeStyle: 'short', hour12: false }).format(now);
  const { date, zone } = zoneDate(now);
  return [
    `你是「顺手」的内置助手，一个校园个人助理。现在：${stamp}（UTC${zone}）。`,
    '规则：',
    '1. 任何关于日程、账本、专注、倒计时、校园服务、兼职单位、旅记的数据，先调用工具再回答，不要凭空编造。',
    `2. 写时间用带时区的 ISO，例如 ${date}T19:00:00${zone}。`,
    '3. 安全写操作可以直接执行：新建/修改日程、记支出/工时、开始或控制专注、新建/修改倒计时、新建/修改课程、旅记和打包清单。',
    '4. 你没有删除工具。用户要删除日程、记录、单位、课程、倒计时或旅记时，告诉用户到对应页面删除。',
    '5. 账本金额参数用元（amountYuan、hourlyRateYuan）；工具返回的 amountCents 是分，回答时除以 100。',
    '6. 你的工具里没有校园数据同步，也没有生活服务下单。不要编造政策、材料、地点，也不要替用户提交、签字或付款。',
    '7. 日期、金额、单位不明确时先问一句，不要猜。',
    '8. 工具失败就如实说明，同一个失败调用不要反复尝试。',
    '9. 回答用简体中文，先给结果，再给必要细节；不要向用户输出工具调用的 JSON。',
    ...(redacting ? ['10. 个人数据已用 [[类别:哈希]] 占位符替换；必须原样保留这些占位符，不要猜测、翻译或改写。调用工具时参数可以直接使用占位符，执行前会还原。'] : []),
  ].join('\n');
}

function cleanMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) throw new AssistantError(400, 'invalid_messages', '请先输入一句话。');
  const clean = messages
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string' && message.content.trim() && message.content.length <= 4000)
    .slice(-MAX_MESSAGES)
    .map((message) => ({ role: message.role, content: message.content }));
  if (!clean.length || clean.at(-1).role !== 'user') throw new AssistantError(400, 'invalid_messages', '最后一条需要是用户消息。');
  return clean;
}

function summarizeTool(name, result) {
  if (!result) return '';
  if (name === 'schedule_create' || name === 'schedule_update') return result.event?.title ?? '';
  if (name === 'day_overview') return `${result.date} · ${result.items?.length ?? 0} 项安排`;
  if (name === 'schedule_list') return `${result.from} 至 ${result.to} · ${result.items?.length ?? 0} 项`;
  if (name === 'focus_start' || name === 'focus_control') return result.session?.task ?? '';
  if (name === 'focus_summary') return `今天 ${result.today?.minutes ?? 0} 分钟`;
  if (name === 'countdowns_create' || name === 'countdowns_update') return result.countdown?.title ?? '';
  if (name === 'ledger_add_expense' || name === 'ledger_update_expense') return result.record ? `${result.record.title} ¥${(result.record.amountCents / 100).toFixed(2)}` : '';
  if (name === 'ledger_add_work' || name === 'ledger_update_work') return result.record ? `${result.record.title} ${result.record.durationMinutes} 分钟` : '';
  if (name === 'ledger_summary') return `支出 ¥${(result.expenseCents / 100).toFixed(2)} · 收入 ¥${(result.incomeCents / 100).toFixed(2)}`;
  if (name === 'ledger_records') return `${result.total ?? 0} 笔`;
  if (name === 'ledger_monthly') return `${result.month} · 支出 ¥${(result.expenseCents / 100).toFixed(2)}`;
  if (name === 'workplaces_add' || name === 'workplaces_update') return result.workplace?.name ?? '';
  if (name === 'courses_create' || name === 'courses_update') return result.course?.title ?? '';
  if (name === 'trips_create' || name === 'trips_update') return result.trip?.title ?? '';
  if (name === 'trips_add_day_item' || name === 'trips_add_packing') return result.item?.text ?? '';
  if (name === 'trips_add_visit') return result.visit?.city ?? '';
  if (name === 'services_search') return `${result.items?.length ?? 0} 条服务`;
  return '';
}

function briefingPrompt(scope, factsText) {
  return [
    `你是「顺手」的简报助手。下面是代码算好的${scope === 'day' ? '今日简报' : '本周复盘'}数据（JSON）。`,
    '规则：',
    '1. 只根据这些数据写 3 到 5 句简体中文，不要编造数据里没有的事。',
    '2. 金额和时间已经在数据里格式化好，直接引用，不要自己换算。',
    '3. 先给结论，再给一两句提醒；不确定就不提。',
    '4. 不要输出 JSON、列表符号或标题。',
    factsText,
  ].join('\n');
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const EPOCH_MIN = 946684800000;

const isStamp = (value) => typeof value === 'number' && Number.isFinite(value) && value >= EPOCH_MIN;

const yuanText = (cents) => (Number(cents) / 100).toFixed(2);
const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function clockText(stamp) {
  return clockFormat.format(new Date(stamp));
}

function weekdayOf(stamp) {
  const { date } = zoneDate(new Date(stamp));
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

// 模型只负责措辞，不做算术：分换元、时间戳换 HH:MM 都在这里做完，
// 发往模型的投影里不再出现分或原始毫秒时间戳。
function promptFacts(value) {
  if (Array.isArray(value)) return value.map((item) => promptFacts(item));
  if (!value || typeof value !== 'object') return value;
  const output = {};
  let startStamp = null;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' && key.endsWith('Cents')) {
      output[`${key.slice(0, -'Cents'.length)}Yuan`] = yuanText(item);
      continue;
    }
    if (typeof item === 'number' && key === 'cents') {
      output.yuan = yuanText(item);
      continue;
    }
    // 任何够大的整数都只可能是毫秒时间戳，一律换成 HH:MM。
    if (isStamp(item)) {
      output[`${key}Clock`] = clockText(item);
      if (startStamp === null && /(^|interval)start$/i.test(key)) startStamp = item;
      continue;
    }
    output[key] = promptFacts(item);
  }
  if (startStamp !== null) output.weekday = weekdayOf(startStamp);
  return output;
}

function sanitizeNarrative(text) {
  let value = String(text ?? '').replace(/```[a-z]*\n?/gi, '').trim();
  const quoted = value.match(/^["'“”‘’「」『』](.*)["'“”‘’「」『』]$/s);
  if (quoted) value = quoted[1].trim();
  if (value.length < 5 || value.length > BRIEFING_MAX_CHARS) return '';
  return value;
}

function templateNarrative(scope, facts) {
  return scope === 'day' ? dayBriefNarrative(facts) : weekReviewNarrative(facts);
}

export function createAssistant({ docs, userId, env, fetch: transport = globalThis.fetch }) {
  void userId; // 保留参数供上层调用（owner 前缀由 createDocs 负责）。
  const briefCache = new Map();
  const api = createAgentApi({ docs, userId });

  const emptyPrefs = () => ({ privacyMode: 'redact', updatedAt: null });

  function siteSettings() {
    return {
      baseUrl: String(env.get('ASSISTANT_BASE_URL') ?? '').trim().replace(/\/+$/, ''),
      model: String(env.get('ASSISTANT_MODEL') ?? '').trim(),
      apiKey: String(env.get('ASSISTANT_API_KEY') ?? '').trim(),
    };
  }

  async function readPrefs() {
    const doc = await docs.ensure(PREFS_NAME, emptyPrefs);
    const value = doc?.value && typeof doc.value === 'object' ? doc.value : emptyPrefs();
    return { doc, value, revision: doc.revision };
  }

  async function readSettings() {
    const site = siteSettings();
    const { value } = await readPrefs();
    return {
      baseUrl: site.baseUrl,
      model: site.model,
      hasApiKey: Boolean(site.apiKey),
      privacyMode: normalizePrivacyMode(value.privacyMode),
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
      managedBy: 'site',
    };
  }

  async function writeSettings(input) {
    const keys = Object.keys(input && typeof input === 'object' ? input : {});
    if (keys.some((key) => key !== 'privacyMode')) {
      throw new AssistantError(400, 'settings_readonly', '模型地址与 Key 由站点统一配置，只能修改隐私模式。');
    }
    const { doc } = await readPrefs();
    const next = { privacyMode: normalizePrivacyMode(input?.privacyMode), updatedAt: new Date().toISOString() };
    await docs.replace(doc, next);
    return readSettings();
  }

  // chat / test 共用：站点没配齐或隐私模式不允许出网时抛 AssistantError。
  async function resolveModel() {
    const site = siteSettings();
    if (!site.baseUrl || !site.model || !site.apiKey) {
      throw new AssistantError(503, 'assistant_not_configured', '站点还没有配置模型，请联系管理员。');
    }
    const { value } = await readPrefs();
    const privacyMode = normalizePrivacyMode(value.privacyMode);
    const loopback = isLoopback(site.baseUrl);
    if (!loopback && privacyMode === 'local-only') {
      throw new AssistantError(409, 'privacy_local_only', '当前是“只在本机”隐私模式，但站点模型不在本机。请改为“云端脱敏”。');
    }
    return { ...site, privacyMode, loopback, redacting: !loopback && privacyMode === 'redact' };
  }

  async function providerFetch(settings, pathName, init = {}, timeoutMs = TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await transport(`${settings.baseUrl}${pathName}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}), ...(init.headers ?? {}) },
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new AssistantError(504, 'provider_timeout', '模型响应超时，请稍后再试。');
      throw new AssistantError(502, 'provider_unreachable', '连不上站点模型服务，请稍后再试或联系管理员。');
    } finally {
      clearTimeout(timer);
    }
  }

  async function test() {
    const settings = await resolveModel();
    const response = await providerFetch(settings, '/models');
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* 由下面统一处理。 */ }
    if (!response.ok) {
      const detail = typeof data?.error?.message === 'string' ? data.error.message : text.slice(0, 200);
      return { ok: false, status: response.status, message: `模型服务返回 ${response.status}${detail ? `：${detail}` : ''}` };
    }
    const models = Array.isArray(data?.data) ? data.data.map((item) => item?.id).filter((id) => typeof id === 'string') : [];
    return { ok: true, models: models.slice(0, 50), modelFound: settings.model ? models.includes(settings.model) : null, message: models.length ? `服务在线，发现 ${models.length} 个模型。` : '服务在线，但没有列出模型。' };
  }

  async function providerChat(settings, body) {
    const response = await providerFetch(settings, '/chat/completions', { method: 'POST', body: JSON.stringify(body) });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { throw new AssistantError(502, 'provider_invalid_response', '模型返回的不是有效 JSON。'); }
    if (!response.ok) {
      const detail = typeof data?.error?.message === 'string' ? data.error.message : text.slice(0, 200);
      throw new AssistantError(502, 'provider_error', `模型服务返回 ${response.status}${detail ? `：${detail}` : ''}`);
    }
    return data;
  }

  async function getTools() {
    return (await api.manifest({ scope: 'write' })).tools;
  }

  async function callTool({ tool, args, requestId }) {
    try {
      const out = await api.call({ tool, arguments: args, requestId });
      return { ok: true, result: out.result, revision: out.revision };
    } catch (error) {
      return {
        ok: false,
        error: error?.code ?? 'agent_error',
        message: error instanceof Error ? error.message : '操作未完成。',
      };
    }
  }

  async function getBriefFacts(scope) {
    const tool = scope === 'week' ? 'week_review' : 'day_brief';
    const out = await api.call({ tool, arguments: {}, requestId: `brief-${scope}-${Date.now()}` });
    return out.result;
  }

  async function chat(history) {
    const settings = await resolveModel();
    const { redacting } = settings;
    const redactor = redacting ? createRedactor() : null;
    const messages = [{ role: 'system', content: systemPrompt(redacting) }];
    for (const message of cleanMessages(history)) {
      messages.push(redacting ? { ...message, content: await redactor.redactText(message.content) } : message);
    }
    const tools = (await getTools()).map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input } }));
    const trace = [];
    let lastContent = '';
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const data = await providerChat(settings, { model: settings.model, messages, tools, temperature: 0.2, stream: false, ...(settings.loopback ? { reasoning_effort: 'none' } : {}) });
      const message = data?.choices?.[0]?.message;
      if (!message) throw new AssistantError(502, 'provider_invalid_response', '模型没有返回可用的消息。');
      const content = typeof message.content === 'string' ? message.content : '';
      const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (content) lastContent = content;
      if (!rawCalls.length) break;
      const calls = rawCalls.map((call) => ({ ...call, id: call?.id || `call_${crypto.randomUUID()}` }));
      messages.push({ role: 'assistant', content: content || null, tool_calls: calls });
      for (const call of calls) {
        const name = call?.function?.name;
        let requested = {};
        let parseError = '';
        try {
          const raw = call?.function?.arguments;
          requested = typeof raw === 'string' ? (raw.trim() ? JSON.parse(raw) : {}) : (raw ?? {});
        } catch {
          parseError = '工具参数不是有效 JSON。';
        }
        const args = redacting && !parseError ? redactor.rehydrateValue(requested) : requested;
        const result = parseError
          ? { ok: false, error: 'invalid_arguments', message: parseError }
          : await callTool({ tool: name, args, requestId: `assistant-${call.id}`.slice(0, 100) });
        trace.push({
          tool: name, arguments: args, ok: result.ok,
          ...(result.ok ? { summary: summarizeTool(name, result.result) } : { error: result.error, message: result.message }),
        });
        const toolContent = result.ok
          ? { ok: true, result: result.result }
          : { ok: false, error: result.error, message: result.message };
        const protectedContent = redacting ? await redactor.redactValue(toolContent) : toolContent;
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(protectedContent).slice(0, MAX_TOOL_RESULT) });
      }
    }
    const reply = lastContent || (trace.length ? '已经执行完这些操作。' : '模型没有返回内容，请再试一次。');
    return { reply: redacting ? redactor.rehydrateText(reply) : reply, trace };
  }

  function cacheKey(scope, facts) {
    return `${scope}:${scope === 'week' ? facts.start : facts.date}`;
  }

  const factsDate = (scope, facts) => (scope === 'week' ? facts.end : facts.date);

  // 简报事实里地点类字段整字段脱敏；其余字符串按内容脱敏，保留可读的标题，
  // 这样模型仍能写出像样的句子，手机号、证件号、邮箱不会离开服务器。
  async function redactFacts(redactor, value) {
    if (typeof value === 'string') return redactor.redactText(value);
    if (Array.isArray(value)) {
      const output = [];
      for (const item of value) output.push(await redactFacts(redactor, item));
      return output;
    }
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = (key === 'location' || key === 'address' || key === 'room') && typeof item === 'string' && item.trim()
        ? (await redactor.redactValue({ [key]: item }))[key]
        : await redactFacts(redactor, item);
    }
    return output;
  }

  async function briefing({ scope = 'day', fresh = false } = {}) {
    const facts = await getBriefFacts(scope);
    // 简报是增强功能：站点没配模型或隐私模式不允许出网时给规则版，不阻塞首页。
    let settings = null;
    let warning = '';
    try {
      settings = await resolveModel();
    } catch (error) {
      if (!(error instanceof AssistantError)) throw error;
      warning = error.message;
    }

    const key = `${cacheKey(scope, facts)}:${settings?.model ?? 'none'}`;
    const cached = briefCache.get(key);
    if (!fresh && cached && Date.now() - cached.at < BRIEFING_TTL_MS) return cached.value;

    const finish = (value) => {
      briefCache.set(key, { at: Date.now(), value });
      if (briefCache.size > BRIEFING_MAX) briefCache.delete(briefCache.keys().next().value);
      return value;
    };
    const degraded = (reason) => finish({
      scope, date: factsDate(scope, facts), facts,
      narrative: templateNarrative(scope, facts), degraded: true, warning: reason, model: null, generatedAt: new Date().toISOString(),
    });

    if (!settings) return degraded(warning);

    const { redacting } = settings;
    const redactor = redacting ? createRedactor() : null;
    const projected = promptFacts(facts);
    const factsText = JSON.stringify(redacting ? await redactFacts(redactor, projected) : projected);
    const body = {
      model: settings.model,
      messages: [
        { role: 'system', content: briefingPrompt(scope, factsText) },
        { role: 'user', content: scope === 'day' ? '写今天的简报。' : '写本周的复盘。' },
      ],
      temperature: 0.3, max_tokens: 400, stream: false,
      ...(settings.loopback ? { reasoning_effort: 'none' } : {}),
    };
    try {
      const response = await providerFetch(settings, '/chat/completions', { method: 'POST', body: JSON.stringify(body) }, BRIEFING_TIMEOUT_MS);
      const data = await response.json().catch(() => null);
      if (!response.ok) return degraded('模型没有正常回应，先给你规则版。');
      const raw = data?.choices?.[0]?.message?.content;
      const narrative = sanitizeNarrative(redacting ? redactor.rehydrateText(raw) : raw);
      if (!narrative) return degraded('模型的回复不合用，先给你规则版。');
      return finish({
        scope, date: factsDate(scope, facts), facts,
        narrative, degraded: false, warning: null, model: settings.model, generatedAt: new Date().toISOString(),
      });
    } catch {
      return degraded('模型没有及时回应，先给你规则版。');
    }
  }

  return { readSettings, writeSettings, test, chat, briefing };
}
