import { createDemoRecords, demoWorkplaces } from './demo.ts';
import { isDateKey } from '../domain/ledger.ts';
import { expenseCategories } from '../domain/records.ts';
import type { LedgerState } from '../domain/records.ts';

export const STORAGE_KEY = 'shunshou.ledger.v1';
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;

export function createInitialState(today: string, examples = true): LedgerState {
  return { version: 1, records: examples ? createDemoRecords(today) : [], workplaces: examples ? [...demoWorkplaces] : [], settings: { hourlyRateCents: 2000 } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
export function isLedgerState(value: unknown): value is LedgerState {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.records) || !Array.isArray(value.workplaces)
    || !isObject(value.settings) || !positiveInteger(value.settings.hourlyRateCents) || value.settings.hourlyRateCents > 999999999) return false;
  const units = value.workplaces;
  if (!units.every((unit) => isObject(unit) && text(unit.id, 100) && text(unit.name, 60)
    && positiveInteger(unit.hourlyRateCents) && unit.hourlyRateCents <= 999999999 && typeof unit.description === 'string'
    && ['demo', 'manual'].includes(String(unit.source)))) return false;
  if (new Set(units.map((unit) => unit.id)).size !== units.length) return false;
  const records = value.records;
  if (!records.every((record) => {
    if (!isObject(record) || !text(record.id, 100) || !text(record.title, 100)
      || typeof record.date !== 'string' || !isDateKey(record.date)
      || !Number.isSafeInteger(record.amountCents) || Number(record.amountCents) < 0
      || !['demo', 'manual', 'school', 'import'].includes(String(record.source))) return false;
    if (record.type === 'expense') return Number(record.amountCents) > 0 && Number(record.amountCents) <= 999999999 && expenseCategories.includes(record.category as typeof expenseCategories[number]);
    if (record.type !== 'work') return false;
    return units.some((unit) => unit.id === record.workplaceId)
      && positiveInteger(record.hourlyRateCents) && record.hourlyRateCents <= 999999999
      && positiveInteger(record.durationMinutes) && record.durationMinutes <= 1440
      && record.amountCents === Math.round(record.durationMinutes * record.hourlyRateCents / 60)
      && [record.startTime, record.endTime].every((time) => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
  })) return false;
  return new Set(records.map((record) => record.id)).size === records.length;
}

export function loadLedger(storage: StoragePort, today: string): { state: LedgerState; raw: string | null; error: string } {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return { state: createInitialState(today), raw, error: '' };
    const parsed: unknown = JSON.parse(raw);
    if (!isLedgerState(parsed)) throw new Error('invalid ledger');
    return { state: parsed, raw, error: '' };
  } catch {
    return { state: createInitialState(today, false), raw, error: '无法读取本地账本，已暂停写入以保护原数据。请先到设置下载原始备份，再重置账本；也可尝试刷新。' };
  }
}

export function saveLedger(storage: StoragePort, state: LedgerState, expectedRaw: string | null): string {
  let current: string | null;
  try { current = storage.getItem(STORAGE_KEY); }
  catch { throw new Error('无法访问浏览器存储，请检查隐私设置后重试。'); }
  if (current !== expectedRaw) throw new Error('其他窗口已更新账本，请刷新页面后重试，避免覆盖新记录。');
  const serialized = JSON.stringify(state);
  try { storage.setItem(STORAGE_KEY, serialized); }
  catch { throw new Error('本地保存失败，可能是空间不足或存储权限被禁用。内容尚未保存，请勿关闭页面。'); }
  return serialized;
}
