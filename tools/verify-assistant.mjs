// 云端助手线上验收：发布后对一个站点依次跑 settings / test / chat / briefing 四个端点。
// 脚本里不含任何 Key —— 模型地址、模型名、Key 全部由站点 Secret 提供，这里只带用户会话令牌。
//
// 用法：
//   node tools/verify-assistant.mjs https://<站点>.qoder.zone <会话令牌>
//
// 注意：POST /api/assistant/test 在「接口通、模型连不通」时 HTTP 仍是 200，
// 真正的结论在 body.result.ok 里，所以这一项要读两层。
const [base, token] = process.argv.slice(2);

if (!base) {
  console.error('用法: node tools/verify-assistant.mjs <baseUrl> <token>');
  console.error('  baseUrl  站点根地址，例如 https://athand-qnvq63y722x.qoder.zone');
  console.error('  token    在站点登录后拿到的会话令牌（不是模型 Key，脚本不会读取也不会打印模型 Key）');
  process.exit(1);
}

if (!token) console.error('⚠ 没有传 token，四个接口大概率都会返回 401。\n');

const LIMIT = 160;
const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
const api = `${base.replace(/\/+$/, '')}/functions/v1/app`;

// 常见失败给一句可操作的提示，避免只看到一串 JSON。
const HINTS = {
  assistant_not_configured: '站点没配齐 ASSISTANT_BASE_URL / ASSISTANT_MODEL / ASSISTANT_API_KEY，先去 Qoder Sites 设置里填好 Secret。',
  privacy_local_only: '隐私模式是「只在本机」，但站点模型不在本机；改成「云端脱敏」再试。',
  provider_unreachable: '云端连不上模型地址，检查 ASSISTANT_BASE_URL 是否是公网可达的 OpenAI 兼容地址。',
  provider_timeout: '模型响应超时，稍后重试；持续超时说明模型地址不可达。',
  unauthorized: '令牌无效或已过期，重新登录站点后再取一次会话令牌。',
  not_connected: '令牌无效或已过期，重新登录站点后再取一次会话令牌。',
};

function summarize(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const flat = String(text ?? '');
  return flat.length > LIMIT ? `${flat.slice(0, LIMIT)}…` : flat;
}

let failures = 0;

// inspect(body) 返回一段字符串表示「HTTP 通了但内容不合格」，返回 null 表示合格。
async function check(label, path, init = {}, inspect = null) {
  let response;
  try {
    response = await fetch(`${api}${path}`, { ...init, headers });
  } catch (error) {
    failures += 1;
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`FAIL ${label} → 连接失败 ${summarize(reason)}`);
    console.log('  ↳ 地址/网络不通，或站点还没有发布。');
    return { pass: false, status: 0, body: null };
  }

  const text = await response.text().catch(() => '');
  let body = null;
  try { body = JSON.parse(text); } catch { /* 非 JSON 就按原文摘要。 */ }

  const problem = response.ok ? (inspect ? inspect(body) : null) : null;
  const pass = response.ok && !problem;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label} → ${response.status} ${summarize(body ?? text)}`);
  if (problem) console.log(`  ↳ ${problem}`);
  if (!pass) failures += 1;

  const hint = HINTS[body?.error];
  if (hint) console.log(`  ↳ ${hint}`);
  return { pass, status: response.status, body };
}

console.log(`验收 ${api}\n`);

const settings = await check('GET  settings', '/api/assistant/settings');
if (settings.pass) {
  const { model, hasApiKey, managedBy, privacyMode } = settings.body ?? {};
  console.log(`  模型=${model || '(空)'} 已配Key=${hasApiKey} managedBy=${managedBy || '(空)'} 隐私模式=${privacyMode || '(空)'}`);
  if (!hasApiKey) console.error('  ⚠ 站点未配置 ASSISTANT_API_KEY，chat 会返回 503，briefing 会降级为规则模板。');
  if (!model) console.error('  ⚠ 站点未配置 ASSISTANT_MODEL，chat / test 会返回 503。');
}

// HTTP 200 + result.ok=false 是很常见的「配了 Key 但模型连不上」，必须单独判。
await check('POST test', '/api/assistant/test', { method: 'POST', body: '{}' }, (body) => {
  const result = body?.result;
  if (result?.ok === true) return null;
  if (!result) return '响应里没有 result 字段，接口形态和预期不一致。';
  return `result.ok=false${result.status ? ` status=${result.status}` : ''}：${result.message ?? '(没有 message)'}`;
});

await check('POST chat', '/api/assistant/chat', {
  method: 'POST',
  body: JSON.stringify({ messages: [{ role: 'user', content: '今天有什么安排？用一句话回答。' }] }),
}, (body) => (typeof body?.reply === 'string' && body.reply.trim() ? null : '响应里没有 reply，对话没有真正跑通。'));

const briefing = await check('GET  briefing', '/api/assistant/briefing?scope=day', {}, (body) => (
  typeof body?.narrative === 'string' && body.narrative.trim() ? null : '响应里没有 narrative，简报没有返回内容。'
));
if (briefing.pass && briefing.body?.degraded === true) {
  // warning 本身一般以句号结尾，去掉尾标点再拼，避免出现「。；」。
  const warning = String(briefing.body?.warning ?? '').trim().replace(/[。.！!]\s*$/, '');
  console.error(`  ⚠ 简报是规则模板降级版（degraded=true）${warning ? `：${warning}` : ''}。若 settings 显示已配 Key，说明模型链路没通。`);
}

console.log('');
if (failures) {
  console.error(`✗ ${failures} 项未通过，线上验收不通过。`);
  process.exitCode = 1;
} else {
  console.log('✓ 四项检查全部通过。');
}
