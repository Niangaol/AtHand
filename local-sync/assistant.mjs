import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRedactor, normalizePrivacyMode } from './privacy.mjs';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const TIMEOUT_MS = 90_000;
const MAX_MESSAGES = 20;
const MAX_ITERATIONS = 5;
const MAX_TOOL_RESULT = 12_000;

export class AssistantError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function normalizeBaseUrl(value) {
  const raw = String(value ?? '').trim().replace(/\/+$/, '');
  if (!raw) return DEFAULT_BASE_URL;
  let url;
  try { url = new URL(raw); } catch { throw new AssistantError(400, 'invalid_base_url', '模型地址需要是完整的 http:// 或 https:// 地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new AssistantError(400, 'invalid_base_url', '模型地址不能带账号、查询参数或锚点。');
  }
  return raw;
}

function normalizeSettings(value) {
  return {
    baseUrl: normalizeBaseUrl(value?.baseUrl),
    model: typeof value?.model === 'string' ? value.model.trim().slice(0, 200) : '',
    apiKey: typeof value?.apiKey === 'string' ? value.apiKey.trim().slice(0, 500) : '',
    privacyMode: normalizePrivacyMode(value?.privacyMode),
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
  };
}

function isLoopback(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch { return false; }
}

function systemPrompt(redacting) {
  const now = new Date();
  const stamp = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full', timeStyle: 'short', hour12: false }).format(now);
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const zone = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return [
    `你是「顺手」的内置助手，一个校园个人助理。现在：${stamp}（UTC${zone}）。`,
    '规则：',
    '1. 任何关于日程、账本、专注、倒计时、校园服务、兼职单位、旅记的数据，先调用工具再回答，不要凭空编造。',
    `2. 写时间用带时区的 ISO，例如 ${date}T19:00:00${zone}。`,
    '3. 安全写操作可以直接执行：新建/修改日程、记支出/工时、开始或控制专注、新建/修改倒计时、新建/修改课程、旅记和打包清单。',
    '4. 你没有删除工具。用户要删除日程、记录、单位、课程、倒计时或旅记时，告诉用户到对应页面删除。',
    '5. 账本金额参数用元（amountYuan、hourlyRateYuan）；工具返回的 amountCents 是分，回答时除以 100。',
    '6. 校园数据先连接杭电助手，个人数据需用户开启只读；同步课表/考试只新增或更新 hdu: 条目，不删除，删除仍去日程页。不要编造政策、材料、地点，也不要替用户提交、签字或付款。',
    '7. 日期、金额、单位不明确时先问一句，不要猜。',
    '8. 工具失败就如实说明，同一个失败调用不要反复尝试。',
    '9. 回答用简体中文，先给结果，再给必要细节；不要向用户输出工具调用的 JSON。',
    ...(redacting ? ['10. 个人数据已用 [[类别:哈希]] 占位符替换；必须原样保留这些占位符，不要猜测、翻译或改写。调用工具时参数可以直接使用占位符，本机执行前会还原。'] : []),
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
  if (name === 'campus_notices') return `${result.data?.items?.length ?? 0} 条通知`;
  if (name === 'campus_courses') return `${result.data?.courses?.length ?? 0} 条课表记录`;
  if (name === 'campus_exams') return `${result.data?.exams?.length ?? 0} 场考试`;
  if (name === 'campus_calendar') return result.data?.weekNow ? `第 ${result.data.weekNow} 周` : '校历';
  if (name === 'campus_life') return '饭卡、电费、图书馆';
  if (name === 'campus_sync_courses' || name === 'campus_sync_exams') return `写入 ${result.written ?? 0} 条`;
  if (name === 'campus_status') return result.connected ? '杭电助手已连接' : '杭电助手未连接';
  return '';
}

export function createAssistant({ directory, getTools, callTool }) {
  const file = path.join(directory, 'assistant.json');

  function readSettings() {
    try { return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch (error) {
      if (error instanceof AssistantError) return normalizeSettings({});
      return normalizeSettings({});
    }
  }
  function writeSettings(value) {
    fs.mkdirSync(directory, { recursive: true });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
      fs.renameSync(temp, file);
      try { fs.chmodSync(file, 0o600); } catch { /* Windows 可能忽略权限位。 */ }
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  function publicSettings() {
    const settings = readSettings();
    return { baseUrl: settings.baseUrl, model: settings.model, hasApiKey: Boolean(settings.apiKey), privacyMode: settings.privacyMode, updatedAt: settings.updatedAt };
  }
  function updateSettings(input) {
    const current = readSettings();
    const baseUrl = input?.baseUrl !== undefined ? normalizeBaseUrl(input.baseUrl) : current.baseUrl;
    const model = input?.model !== undefined ? String(input.model).trim().slice(0, 200) : current.model;
    const privacyMode = input?.privacyMode !== undefined ? normalizePrivacyMode(input.privacyMode) : current.privacyMode;
    let apiKey = current.apiKey;
    if (input?.clearApiKey === true) apiKey = '';
    else if (typeof input?.apiKey === 'string' && input.apiKey.trim()) apiKey = input.apiKey.trim().slice(0, 500);
    const next = { baseUrl, model, apiKey, privacyMode, updatedAt: new Date().toISOString() };
    writeSettings(next);
    return { baseUrl, model, hasApiKey: Boolean(apiKey), privacyMode, updatedAt: next.updatedAt };
  }

  async function providerFetch(settings, pathName, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(`${settings.baseUrl}${pathName}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}), ...(init.headers ?? {}) },
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new AssistantError(504, 'provider_timeout', '模型响应超时，请稍后再试。');
      throw new AssistantError(502, 'provider_unreachable', '连不上模型服务，请检查地址和本机模型是否在运行。');
    } finally {
      clearTimeout(timer);
    }
  }

  async function test() {
    const settings = readSettings();
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

  async function chat(history) {
    const settings = readSettings();
    if (!settings.model) throw new AssistantError(409, 'provider_not_configured', '还没有配置模型。请先到设置里填写模型地址和名称。');
    const loopback = isLoopback(settings.baseUrl);
    if (!loopback && settings.privacyMode === 'local-only') {
      throw new AssistantError(409, 'privacy_local_only', '当前是“只在本机”隐私模式，但模型地址不是本机。请改用本机 Ollama，或把隐私模式改为“云端脱敏”。');
    }
    const redacting = !loopback && settings.privacyMode === 'redact';
    const redactor = redacting ? createRedactor() : null;
    const messages = [
      { role: 'system', content: systemPrompt(redacting) },
      ...cleanMessages(history).map((message) => redacting ? { ...message, content: redactor.redactText(message.content) } : message),
    ];
    const tools = (await getTools()).map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input } }));
    const trace = [];
    let lastContent = '';
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const data = await providerChat(settings, { model: settings.model, messages, tools, temperature: 0.2, stream: false, ...(loopback ? { reasoning_effort: 'none' } : {}) });
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
        const protectedContent = redacting ? redactor.redactValue(toolContent) : toolContent;
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(protectedContent).slice(0, MAX_TOOL_RESULT) });
      }
    }
    const reply = lastContent || (trace.length ? '已经执行完这些操作。' : '模型没有返回内容，请再试一次。');
    return { reply: redacting ? redactor.rehydrateText(reply) : reply, trace };
  }

  return { publicSettings, updateSettings, test, chat };
}
