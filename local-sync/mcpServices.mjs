/**
 * 生活服务 MCP 目录常量。
 *
 * 依据 docs/life-service-mcp-catalog.md（2026-11-22 调研）整理，只登记
 * 「服务名 / 工具前缀 / 风险档 / 环境变量名 / 默认场景」，不写死任何真实
 * Key、Token 或二维码。默认 url 为空、enabled 为 false，表示「未配置」；
 * 真正的地址与凭据由设置页写入，或由环境变量在运行时填充。
 *
 * 风险三档（接入约定见 local-sync/mcpGateway.mjs）：
 *   read  只读查询，可以直接执行；
 *   order 会产生真实订单（打车、点单、取消订单），必须用户下一句明确确认；
 *   pay   支付/退款/充值，一律不执行，只把支付链接或二维码交给用户。
 */

/** 风险档，顺序即「越往后越危险」。 */
export const MCP_RISK_LEVELS = Object.freeze(['read', 'order', 'pay']);

/** 风险档的中文标签，供设置页与助手提示复用。 */
export const MCP_RISK_LABELS = Object.freeze({
  read: '只读',
  order: '下单（需用户确认）',
  pay: '支付（不执行）',
});

/** 场景标签：工具按场景懒加载，避免一次把几十个工具塞进上下文。 */
export const MCP_SCENARIO_LABELS = Object.freeze({
  trip: '出行',
  map: '地图',
  route: '路线',
  weather: '天气',
  schedule: '日程',
  hotel: '酒店',
  flight: '机票',
  train: '火车票',
  flightStatus: '航班动态',
  parcel: '快递',
  food: '点单',
});

/**
 * 服务目录。字段说明：
 *   name        服务标识，配置与缓存键的一部分
 *   label       中文名
 *   prefix      工具名前缀（OpenAI function 只允许 [A-Za-z0-9_-]）
 *   risk        该服务的默认风险档；单个工具可被 riskForTool 覆写
 *   transport   http（Streamable HTTP）/ stdio（需要本地启动器）/ cli（命令行包装）
 *   envKey      只登记环境变量名，不登记值
 *   url         默认空字符串：未配置
 *   urlTemplate 仅作填写提示（{key} 由环境变量替换），不是运行时的真实地址
 *   headerTemplate 同上，{key} 由环境变量替换
 *   enabled     默认 false：未启用
 *   scenarios   适用场景，供按场景懒加载
 *   setup       设置页要显示的「怎么配」一句提示
 */
export const MCP_SERVICES = Object.freeze([
  {
    name: 'amap',
    label: '高德地图',
    prefix: 'amap_',
    risk: 'read',
    transport: 'http',
    envKey: 'AMAP_WEB_KEY',
    url: '',
    urlTemplate: 'https://mcp.amap.com/mcp?key={key}',
    headerTemplate: {},
    enabled: false,
    scenarios: ['trip', 'map', 'route', 'weather'],
    setup: '到高德开放平台新建「Web 服务」Key，填进设置页（或设 AMAP_WEB_KEY 环境变量）。',
    docs: 'https://lbs.amap.com/api/mcp-server/summary',
    notes: '官方 Streamable HTTP；SSE 已于 2026-03-17 下线，不要用 /sse?key=。',
  },
  {
    name: 'weather',
    label: '华风爱科天气',
    prefix: 'weather_',
    risk: 'read',
    transport: 'stdio',
    envKey: 'WEATHERCN_OPENAPI_KEY',
    url: '',
    urlTemplate: '',
    headerTemplate: {},
    enabled: false,
    scenarios: ['weather', 'trip', 'schedule'],
    launcher: Object.freeze({ kind: 'uvx', package: 'weatherwork-consumer-mcp' }),
    setup: '官方只提供 stdio 形态（uvx weatherwork-consumer-mcp），需本地启动器或自建 HTTP 桥后把地址填进设置页。',
    docs: 'https://platform.weathercn.com/doc/mcp.html',
    notes: '19 个工具，实况/预报/预警/AQI/分钟降水；个人实名每天 500 次免费。本模块不启动 stdio 进程。',
  },
  {
    name: 'fliggy',
    label: '飞猪 FlyAI',
    prefix: 'fliggy_',
    risk: 'read',
    transport: 'cli',
    envKey: 'FLYAI_API_KEY',
    url: '',
    urlTemplate: '',
    headerTemplate: {},
    enabled: false,
    scenarios: ['trip', 'hotel', 'flight', 'train'],
    cli: Object.freeze({
      // 官方包名已确认，可执行名待定：只登记检测用的环境变量名，不写死命令。
      packageName: '@fly-ai/flyai-cli',
      binEnv: 'FLYAI_CLI_BIN',
      bin: '',
      commands: Object.freeze([
        'keyword-search', 'ai-search', 'search-flight', 'search-train',
        'search-hotel', 'search-poi', 'search-marriott-hotel', 'search-marriott-package',
      ]),
    }),
    setup: '官方只有 CLI（@fly-ai/flyai-cli），不是 MCP；本模块只留检测钩子，不执行命令。',
    docs: 'https://flyai.open.fliggy.com/docs',
    notes: '只搜不下单，结果里的 jumpUrl 指向实时价格页。',
  },
  {
    name: 'variflight',
    label: '飞常准',
    prefix: 'variflight_',
    risk: 'read',
    transport: 'http',
    envKey: 'VARIFLIGHT_KEY',
    url: '',
    urlTemplate: 'https://ai.variflight.com/servers/tripmatch/mcp',
    headerTemplate: Object.freeze({ 'X-API-Key': '{key}' }),
    enabled: false,
    scenarios: ['flightStatus', 'train', 'trip'],
    setup: '到飞友 AI 开放平台注册后拿 API Key，填进设置页（或设 VARIFLIGHT_KEY 环境变量）。',
    docs: 'https://ai.variflight.com/zh',
    notes: '航班动态/火车余票/空铁联运，只读。',
  },
  {
    name: 'kd100',
    label: '快递100',
    prefix: 'kd100_',
    risk: 'read',
    transport: 'http',
    envKey: 'KD100_KEY',
    url: '',
    urlTemplate: 'https://api.kuaidi100.com/mcp/streamable?key={key}',
    headerTemplate: {},
    enabled: false,
    scenarios: ['parcel'],
    setup: '到快递100 管理后台取 Key，填进设置页（或设 KD100_KEY 环境变量）；个人身份能否开通待确认。',
    docs: 'https://api.kuaidi100.com/document/how-to-use-mcp-service',
    notes: '只查不寄；官方另有 SSE 端点，本模块只用 Streamable HTTP。',
  },
  {
    name: 'didi',
    label: '滴滴出行',
    prefix: 'didi_',
    risk: 'order',
    transport: 'http',
    envKey: 'DIDI_MCP_KEY',
    url: '',
    // 开发阶段必须用 sandbox 端点：返回 Mock 数据、不产生真实订单。
    urlTemplate: 'https://mcp.didichuxing.com/mcp-servers-sandbox?key={key}',
    productionUrlTemplate: 'https://mcp.didichuxing.com/mcp-servers?key={key}',
    headerTemplate: {},
    enabled: false,
    sandbox: true,
    scenarios: ['trip', 'route'],
    setup: '滴滴 MCP 控制台激活 Key；默认走 sandbox 端点，需要真实叫车时把地址换成非 sandbox 版本。',
    docs: 'https://mcp.didichuxing.com/api',
    notes: '经纬度必须传字符串且格式为 lng,lat；taxi_create_order 必须用户明确确认，否则上游报 -32010。',
  },
  {
    name: 'luckin',
    label: '瑞幸咖啡',
    prefix: 'luckin_',
    risk: 'order',
    transport: 'http',
    envKey: 'LUCKIN_MCP_TOKEN',
    url: '',
    urlTemplate: 'https://gwmcp.lkcoffee.com/order/user/mcp',
    headerTemplate: Object.freeze({ Authorization: 'Bearer {key}' }),
    enabled: false,
    scenarios: ['food'],
    setup: '瑞幸开放平台登录拿 OAuth token，填进设置页（写 Authorization: Bearer <token>，或设 LUCKIN_MCP_TOKEN）。',
    docs: 'https://open.lkcoffee.com/mcp',
    notes: '只支持到店自取；createOrder 返回 payOrderQrCodeUrl，由用户自己扫码付。',
  },
  {
    name: 'mcd',
    label: '麦当劳',
    prefix: 'mcd_',
    risk: 'order',
    transport: 'http',
    envKey: 'MCD_MCP_TOKEN',
    url: '',
    urlTemplate: 'https://mcp.mcd.cn',
    headerTemplate: Object.freeze({ Authorization: 'Bearer {key}' }),
    enabled: false,
    scenarios: ['food'],
    setup: '麦当劳 MCP 平台用手机号验证码换 Token，填进设置页（或设 MCD_MCP_TOKEN）。',
    docs: 'https://open.mcd.cn/mcp/doc',
    notes: '下单返回支付链接，支付由用户完成；每个 Token 600 次/分钟。',
  },
]);

/** name → 目录条目，供网关与设置页按名查。 */
export const MCP_SERVICE_BY_NAME = new Map(MCP_SERVICES.map((service) => [service.name, service]));

/** 全部工具前缀，顺序与目录一致。 */
export const MCP_PREFIXES = Object.freeze(MCP_SERVICES.map((service) => service.prefix));

/** OpenAI function 名上限（官方 64）。 */
export const MAX_TOOL_NAME = 64;

/** 单个工具描述进上下文的上限。 */
export const MAX_TOOL_DESCRIPTION = 400;

/** 取服务前缀；未知服务按 name 兜底。 */
export function prefixFor(serviceName) {
  const service = MCP_SERVICE_BY_NAME.get(serviceName);
  if (service) return service.prefix;
  return `${String(serviceName ?? '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp'}_`;
}

/** 远端工具名合法化（去掉点号等），并在超长时追加摘要后缀。 */
export function toolNameFor(serviceName, remoteName, prefixOverride = '') {
  const prefix = prefixOverride || prefixFor(serviceName);
  const base = String(remoteName ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const name = `${prefix}${base}`;
  if (name.length <= MAX_TOOL_NAME) return name;
  const digest = String(hashOf(name)).slice(0, 8);
  return `${name.slice(0, MAX_TOOL_NAME - 9)}_${digest}`;
}

/** 带前缀的全名反查服务；匹配最长前缀。 */
export function serviceForTool(fullName) {
  const name = String(fullName ?? '');
  let best = null;
  for (const service of MCP_SERVICES) {
    if (!name.startsWith(service.prefix)) continue;
    if (!best || service.prefix.length > best.prefix.length) best = service;
  }
  return best;
}

/** 读取类动词：工具名以这些词开头时按只读处理。 */
const READ_VERBS = new Set([
  'query', 'queries', 'get', 'list', 'search', 'find', 'check', 'preview', 'estimate',
  'calc', 'calculate', 'detail', 'details', 'route', 'routes', 'geocode', 'regeo',
  'weather', 'forecast', 'nearby', 'distance', 'textsearch', 'around', 'status',
  'info', 'describe', 'lookup', 'fetch', 'read', 'notice', 'notices', 'trend',
]);

/** 明确产生订单的动作（驼峰与下划线两种写法都已归一化）。 */
const ORDER_MARKERS = Object.freeze([
  'create_order', 'submit_order', 'place_order', 'create_taxi_order',
  'cancel_order', 'close_order', 'book', 'reserve', 'reorder',
]);

/** 支付/退款/充值/提现：一律不执行。 */
const PAY_MARKERS = Object.freeze(['pay', 'payment', 'prepay', 'refund', 'recharge', 'topup', 'withdraw', 'settle']);

function wordsOf(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .split('_')
    .filter(Boolean);
}

/**
 * 单个工具的最终风险档。规则（按顺序）：
 *   1. 名字里出现支付词 → pay
 *   2. 名字里出现下单/取消动作 → order
 *   3. 首词是查询类动词 → read
 *   4. 否则回落到服务默认档；未知服务按最保守的 order 处理
 */
export function riskForTool(serviceName, remoteName) {
  const service = MCP_SERVICE_BY_NAME.get(serviceName);
  const fallback = service?.risk ?? 'order';
  const words = wordsOf(remoteName);
  if (!words.length) return fallback;
  const joined = words.join('_');
  if (words.some((word) => PAY_MARKERS.includes(word))) return 'pay';
  if (ORDER_MARKERS.some((marker) => joined.includes(marker))) return 'order';
  // 名字里出现查询类动词（不限于首词，如 taxi_estimate / query_order_detail）按只读处理。
  if (words.some((word) => READ_VERBS.has(word))) return 'read';
  return fallback;
}

/**
 * 把目录默认值、设置页保存值、环境变量合成运行时配置。
 * 优先级：设置页保存值 > 环境变量填充 > 目录默认值。
 * 环境变量只用来填 url/headers，不自动打开开关（enabled 仍然要用户显式打开）。
 */
export function resolveConfigs({ services = MCP_SERVICES, stored = [], env = {} } = {}) {
  const storedByName = new Map();
  for (const item of Array.isArray(stored) ? stored : []) {
    if (!item || typeof item.name !== 'string') continue;
    storedByName.set(item.name, item);
  }
  return services.map((service) => {
    const saved = storedByName.get(service.name) ?? null;
    const envValue = service.envKey && typeof env?.[service.envKey] === 'string' ? env[service.envKey].trim() : '';
    const fromEnv = !saved?.url && envValue !== '';
    const url = String(saved?.url ?? '').trim() || (fromEnv ? fillTemplate(service.urlTemplate, { key: envValue }) : '');
    const headers = normalizeHeaders(saved?.headers);
    if (fromEnv) {
      const templateHeaders = fillHeaders(service.headerTemplate, { key: envValue });
      for (const [key, value] of Object.entries(templateHeaders)) {
        if (!(key in headers)) headers[key] = value;
      }
    }
    return {
      name: service.name,
      label: service.label,
      prefix: service.prefix,
      risk: service.risk,
      transport: service.transport,
      envKey: service.envKey ?? '',
      scenarios: Array.isArray(saved?.scenarios) && saved.scenarios.length
        ? saved.scenarios.filter((item) => typeof item === 'string')
        : [...service.scenarios],
      url,
      headers,
      enabled: saved?.enabled === true,
      source: saved?.url ? 'settings' : fromEnv ? 'env' : 'default',
      hasUrl: url !== '',
      invalidUrl: url !== '' && !isHttpUrl(url),
      setup: service.setup ?? '',
      docs: service.docs ?? '',
      notes: service.notes ?? '',
      urlTemplate: service.urlTemplate ?? '',
      productionUrlTemplate: service.productionUrlTemplate ?? '',
      sandbox: service.sandbox === true,
      cli: service.cli ?? null,
      launcher: service.launcher ?? null,
    };
  });
}

/** 只放行普通 header 名，挡掉 __proto__ 之类。 */
function normalizeHeaders(value) {
  const headers = {};
  if (!value || typeof value !== 'object') return headers;
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
    if (typeof item !== 'string') continue;
    if (item.length > 4000) continue;
    headers[key] = item;
  }
  return headers;
}

function fillTemplate(template, values) {
  const text = String(template ?? '');
  if (!text) return '';
  return text.replace(/\{(\w+)\}/g, (match, key) => (typeof values[key] === 'string' ? encodeURIComponent(values[key]) : match));
}

function fillHeaders(template, values) {
  const headers = {};
  for (const [key, value] of Object.entries(template ?? {})) {
    if (!/^[A-Za-z0-9_-]+$/.test(key) || typeof value !== 'string') continue;
    headers[key] = value.replace(/\{(\w+)\}/g, (match, token) => (typeof values[token] === 'string' ? values[token] : match));
  }
  return headers;
}

export function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 展示用地址：查询串的值一律抹掉，方便设置页与日志展示。 */
export function maskUrl(value) {
  const text = String(value ?? '');
  if (!text) return '';
  try {
    const parsed = new URL(text);
    for (const key of [...parsed.searchParams.keys()]) parsed.searchParams.set(key, '***');
    return parsed.toString();
  } catch {
    return '（地址格式不正确）';
  }
}

/**
 * 单个服务的配置状态。settings 页与网关共用，避免两边各写一套判断。
 * configured 表示「填过地址（或检测到 CLI）」，ready 表示「现在真的能连」。
 */
export function serviceState(config, { probeCli = null } = {}) {
  const declaredTransport = config.transport ?? 'http';
  const base = {
    name: config.name,
    label: config.label,
    transport: declaredTransport,
    // stdio 服务填了 HTTP 桥地址时按 http 处理；cli 始终是 cli。
    effectiveTransport: declaredTransport === 'stdio' && (config.hasUrl ?? Boolean(config.url)) ? 'http' : declaredTransport,
    risk: config.risk ?? 'order',
    scenarios: config.scenarios ?? [],
    envKey: config.envKey ?? '',
    source: config.source ?? 'default',
    enabled: config.enabled === true,
    hasUrl: config.hasUrl ?? Boolean(config.url),
    maskedUrl: maskUrl(config.url),
    setup: config.setup ?? '',
    docs: config.docs ?? '',
    notes: config.notes ?? '',
  };
  if (base.transport === 'cli') {
    const detected = typeof probeCli === 'function' ? probeCli(config) === true : false;
    return {
      ...base,
      configured: detected,
      ready: detected && base.enabled,
      reason: detected ? (base.enabled ? 'ready' : 'disabled') : 'cli_missing',
      message: detected
        ? (base.enabled ? '已检测到命令行工具。' : '已检测到命令行工具，但开关是关的。')
        : '未配置：没有检测到飞猪命令行工具，本模块不会执行 CLI 命令。',
    };
  }
  if (base.transport === 'stdio' && !base.hasUrl) {
    return {
      ...base,
      configured: false,
      ready: false,
      reason: 'stdio_bridge_missing',
      message: '未配置：该服务只有 stdio 形态，需要本地启动器或自建 HTTP 桥后把地址填进来。',
    };
  }
  if (!base.hasUrl) {
    return {
      ...base,
      configured: false,
      ready: false,
      reason: 'url_missing',
      message: `未配置：${config.setup || '请先在设置页填写服务地址。'}`,
    };
  }
  if (config.invalidUrl === true || !isHttpUrl(config.url)) {
    return {
      ...base,
      configured: false,
      ready: false,
      reason: 'invalid_url',
      message: '未配置：服务地址不是合法的 http(s) 地址。',
    };
  }
  if (!base.enabled) {
    return {
      ...base,
      configured: true,
      ready: false,
      reason: 'disabled',
      message: '未启用：地址已填写，但开关是关的。',
    };
  }
  return { ...base, configured: true, ready: true, reason: 'ready', message: '已配置，可以连接。' };
}

/** 稳定短摘要，仅用于生成名字后缀，不涉及任何凭据。 */
function hashOf(value) {
  let hash = 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
