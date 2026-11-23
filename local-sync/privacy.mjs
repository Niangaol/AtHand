import crypto from 'node:crypto';

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

function hashToken(category, value) {
  const digest = crypto.createHash('sha256').update(`${category}\u0000${value}`, 'utf8').digest('hex').slice(0, 10);
  return `[[${category}:${digest}]]`;
}

export function createRedactor() {
  const map = new Map();

  function tokenFor(category, value) {
    const token = hashToken(category, value);
    if (!map.has(token)) map.set(token, value);
    return token;
  }

  function redactText(value) {
    if (typeof value !== 'string' || !value) return value;
    let text = value;
    text = text.replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, (match) => tokenFor('ID', match));
    text = text.replace(/(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g, (match) => tokenFor('CARD', match));
    text = text.replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, (match) => tokenFor('PHONE', match));
    text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (match) => tokenFor('EMAIL', match));
    text = text.replace(/(?<!\d)\d{10}(?!\d)/g, (match) => tokenFor('ID', match));
    text = text.replace(/((?:学号|工号)\s*[:：]\s*)([A-Za-z0-9]{4,30})/g, (_match, label, value) => `${label}${tokenFor('ID', value)}`);
    text = text.replace(/((?:姓名|名字|联系人|收件人|客户)\s*[:：]\s*)([\u4e00-\u9fa5·]{2,8})/g, (_match, label, value) => `${label}${tokenFor('NAME', value)}`);
    text = text.replace(/((?:宿舍|寝室|住址|地址|收货地址)\s*[:：]\s*)([^\s，。；;、]{2,40})/g, (_match, label, value) => `${label}${tokenFor('ADDR', value)}`);
    text = text.replace(/((?:课程|科目)\s*[:：]\s*)([^\s，。；;、]{2,40})/g, (_match, label, value) => `${label}${tokenFor('COURSE', value)}`);
    text = text.replace(/((?:任课教师|老师|教师)\s*[:：]\s*)([^\s，。；;、]{2,40})/g, (_match, label, value) => `${label}${tokenFor('NAME', value)}`);
    return text;
  }

  function redactValue(value) {
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map(redactValue);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (PERSONAL_KEYS.has(key) && (typeof item === 'string' || typeof item === 'number') && String(item).trim()) {
        output[key] = tokenFor(KEY_CATEGORY[key], String(item));
      } else {
        output[key] = redactValue(item);
      }
    }
    return output;
  }

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
