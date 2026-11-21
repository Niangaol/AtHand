import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
  };
}

function isLoopback(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch { return false; }
}

function systemPrompt() {
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
    '6. 校园服务只读；不要编造政策、材料、地点，也不要替用户提交、签字或付款。',
    '7. 日期、金额、单位不明确时先问一句，不要猜。',
    '8. 工具失败就如实说明，同一个失败调用不要反复尝试。',
    '9. 回答用简体中文，先给结果，再给必要细节；不要向用户输出工具调用的 JSON。',
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
    return { baseUrl: settings.baseUrl, model: settings.model, hasApiKey: Boolean(settings.apiKey), updatedAt: settings.updatedAt };
  }
  function updateSettings(input) {
    const current = readSettings();
    const baseUrl = input?.baseUrl !== undefined ? normalizeBaseUrl(input.baseUrl) : current.baseUrl;
    const model = input?.model !== undefined ? String(input.model).trim().slice(0, 200) : current.model;
    let apiKey = current.apiKey;
    if (input?.clearApiKey === true) apiKey = '';
    else if (typeof input?.apiKey === 'string' && input.apiKey.trim()) apiKey = input.apiKey.trim().slice(0, 500);
    const next = { baseUrl, model, apiKey, updatedAt: new Date().toISOString() };
    writeSettings(next);
    return { baseUrl, model, hasApiKey: Boolean(apiKey), updatedAt: next.updatedAt };
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
    const messages = [{ role: 'system', content: systemPrompt() }, ...cleanMessages(history)];
    const tools = getTools().map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input } }));
    const loopback = isLoopback(settings.baseUrl);
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
        let args = {};
        let parseError = '';
        try {
          const raw = call?.function?.arguments;
          args = typeof raw === 'string' ? (raw.trim() ? JSON.parse(raw) : {}) : (raw ?? {});
        } catch {
          parseError = '工具参数不是有效 JSON。';
        }
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
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(toolContent).slice(0, MAX_TOOL_RESULT) });
      }
    }
    return { reply: lastContent || (trace.length ? '已经执行完这些操作。' : '模型没有返回内容，请再试一次。'), trace };
  }

  return { publicSettings, updateSettings, test, chat };
}
