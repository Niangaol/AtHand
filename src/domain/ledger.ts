import { toDateKey } from './dates.ts';
import { expenseCategories } from './records.ts';
import type { ExpenseCategory, RecordEntry, Workplace } from './records.ts';

export type RecordDraft = {
  type: 'work' | 'expense'; date: string; title: string; workplaceId: string;
  startTime: string; endTime: string; nextDay: boolean; duration: string;
  hourlyRate: string; amount: string; category: ExpenseCategory;
};

export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '2000-01-01' && value <= '2100-12-31'
    && toDateKey(new Date(`${value}T12:00:00`)) === value;
}

export function parseAmount(value: string): number {
  const normalized = value.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(normalized)) throw new Error('金额需大于 0，最多两位小数，不超过 9999999.99 元。');
  const [yuan, decimal = ''] = normalized.split('.');
  const cents = Number(yuan) * 100 + Number(decimal.padEnd(2, '0'));
  if (cents <= 0) throw new Error('金额需大于 0。');
  return cents;
}

export function buildWorkplace(name: string, rate: string, id: string): Workplace {
  if (!name.trim() || name.trim().length > 60) throw new Error('单位名称需为 1 至 60 个字符。');
  return { id, name: name.trim(), hourlyRateCents: parseAmount(rate), description: '', source: 'manual' };
}

export function buildRecord(draft: RecordDraft, workplaces: readonly Workplace[], id: string): RecordEntry {
  if (!isDateKey(draft.date)) throw new Error('请填写 2000 至 2100 年之间的有效日期。');
  if (draft.title.trim().length > 100) throw new Error('备注不能超过 100 个字符。');
  const base = { id, date: draft.date, source: 'manual' as const };
  if (draft.type === 'expense') {
    if (!expenseCategories.includes(draft.category)) throw new Error('请选择支出分类。');
    return { ...base, type: 'expense', title: draft.title.trim() || draft.category, category: draft.category, amountCents: parseAmount(draft.amount) };
  }
  const workplace = workplaces.find((item) => item.id === draft.workplaceId);
  if (!workplace) throw new Error('请先选择或添加兼职单位。');
  if (![draft.startTime, draft.endTime].every((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value))) throw new Error('请填写开始和结束时间。');
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const elapsed = minutes(draft.endTime) - minutes(draft.startTime) + (draft.nextDay ? 1440 : 0);
  if (elapsed <= 0 || elapsed > 1440) throw new Error('结束时间须晚于开始时间；跨午夜请勾选次日，单次不超过 24 小时。');
  const durationMinutes = draft.duration === '' ? elapsed : Number(draft.duration);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) throw new Error('计薪时长需为 1 至 1440 分钟的整数。');
  const hourlyRateCents = parseAmount(draft.hourlyRate);
  return { ...base, type: 'work', title: draft.title.trim() || workplace.name, workplaceId: workplace.id,
    startTime: draft.startTime, endTime: draft.endTime, durationMinutes, hourlyRateCents,
    amountCents: Math.round(durationMinutes * hourlyRateCents / 60) };
}

export function canShowTimeCost(records: readonly RecordEntry[], today: string): boolean {
  return new Set(records.filter((record) => record.source !== 'demo' && record.date <= today).map((record) => record.date)).size >= 3;
}
