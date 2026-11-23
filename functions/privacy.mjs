// 脱敏器：从 local-sync/privacy.mjs 移植，哈希改用 Web Crypto（crypto.subtle），
// 以便随自包含函数包跑在 Deno Edge Function 里（不依赖 node:crypto，也不依赖任何 npm 包）。
// 占位符格式与电脑网关保持一字不差：[[CATEGORY:hash10]]，两边可互相 rehydrate。

const PRIVACY_MODES = new Set(['local-only', 'redact', 'off']);

export function normalizePrivacyMode(value) {
  return PRIVACY_MODES.has(value) ? value : 'redact';
}

const KEY_CATEGORY = {
  name: 'NAME',
  studentName: 'NAME',
  teacher: 'NAME',
  teacherName: 'NAME',
  workplace: 'NAME',
  workplaceName: 'NAME',
  title: 'TITLE',
  task: 'TASK',
  course: 'COURSE',
  courseName: 'COURSE',
  location: 'LOCATION',
  locationName: 'LOCATION',
  place: 'PLACE',
  city: 'CITY',
  address: 'ADDR',
  room: 'ROOM',
  seat: 'SEAT',
  cardNo: 'CARD',
  maskedNo: 'CARD',
  phone: 'PHONE',
  email: 'EMAIL',
};

const PERSONAL_KEYS = new Set(Object.keys(KEY_CATEGORY));
const TOKEN_PATTERN = /\[\[[A-Z]+:[0-9a-f]{10}\]\]/g;

// 文本脱敏的九条规则与网关同序。顺序会改变命中结果，调整前先和 local-sync/privacy.mjs 对齐。
const ID_CARD_PATTERN = /(?<!\d)\d{17}[\dXx](?!\d)/g;
const BANK_CARD_PATTERN = /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g;
const PHONE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TEN_DIGITS_PATTERN = /(?<!\d)\d{10}(?!\d)/g;
const STUDENT_ID_PATTERN = /((?:学号|工号)\s*[:：]\s*)([A-Za-z0-9]{4,30})/g;
const NAME_PATTERN = /((?:姓名|名字|联系人|收件人|客户)\s*[:：]\s*)([\u4e00-\u9fa5·]{2,8})/g;
const ADDRESS_PATTERN = /((?:宿舍|寝室|住址|地址|收货地址)\s*[:：]\s*)([^\s，。；;、]{2,40})/g;
const COURSE_PATTERN = /((?:课程|科目)\s*[:：]\s*)([^\s，。；;、]{2,40})/g;
const TEACHER_PATTERN = /((?:任课教师|老师|教师)\s*[:：]\s*)([^\s，。；;、]{2,40})/g;

const encoder = new TextEncoder();

// 与网关的 createHash('sha256').update(`${category}\u0000${value}`, 'utf8') 逐字节等价。
async function hashToken(category, value) {
  const data = encoder.encode(`${category}\u0000${value}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `[[${category}:${hex.slice(0, 10)}]]`;
}

export function createRedactor() {
  const map = new Map();

  async function tokenFor(category, value) {
    const token = await hashToken(category, value);
    if (!map.has(token)) map.set(token, value);
    return token;
  }

  // 异步哈希拿不到同步的 replace 回调，因此每条模式先收集命中项，再逐个 await 后 replaceAll。
  async function replaceMatches(text, pattern, category) {
    for (const match of text.match(pattern) ?? []) {
      const token = await tokenFor(category, match);
      text = text.replaceAll(match, () => token);
    }
    return text;
  }

  // 带标签的模式（学号：xxx）只替换值，标签保持可读，与网关的回调式替换一致。
  async function replaceLabelledMatches(text, pattern, category) {
    for (const [whole, label, value] of text.matchAll(pattern)) {
      const token = await tokenFor(category, value);
      text = text.replaceAll(whole, () => `${label}${token}`);
    }
    return text;
  }

  async function redactText(value) {
    if (typeof value !== 'string' || !value) return value;
    let text = value;
    text = await replaceMatches(text, ID_CARD_PATTERN, 'ID');
    text = await replaceMatches(text, BANK_CARD_PATTERN, 'CARD');
    text = await replaceMatches(text, PHONE_PATTERN, 'PHONE');
    text = await replaceMatches(text, EMAIL_PATTERN, 'EMAIL');
    text = await replaceMatches(text, TEN_DIGITS_PATTERN, 'ID');
    text = await replaceLabelledMatches(text, STUDENT_ID_PATTERN, 'ID');
    text = await replaceLabelledMatches(text, NAME_PATTERN, 'NAME');
    text = await replaceLabelledMatches(text, ADDRESS_PATTERN, 'ADDR');
    text = await replaceLabelledMatches(text, COURSE_PATTERN, 'COURSE');
    text = await replaceLabelledMatches(text, TEACHER_PATTERN, 'NAME');
    return text;
  }

  // 对象与数组递归时每个键都 await，避免把 Promise 写进输出结构。
  async function redactValue(value) {
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) {
      const output = [];
      for (const item of value) output.push(await redactValue(item));
      return output;
    }
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = PERSONAL_KEYS.has(key) && (typeof item === 'string' || typeof item === 'number') && String(item).trim()
        ? await tokenFor(KEY_CATEGORY[key], String(item))
        : await redactValue(item);
    }
    return output;
  }

  // rehydrate 保持同步：下游（回复文案、工具参数回填）直接取字符串，不能返回 Promise。
  function rehydrateText(value) {
    if (typeof value !== 'string' || !value) return value;
    return value.replace(TOKEN_PATTERN, (token) => map.get(token) ?? token);
  }

  function rehydrateValue(value) {
    if (typeof value === 'string') return rehydrateText(value);
    if (Array.isArray(value)) return value.map(rehydrateValue);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = rehydrateValue(item);
    return output;
  }

  return { redactText, redactValue, rehydrateText, rehydrateValue, get size() { return map.size; } };
}
