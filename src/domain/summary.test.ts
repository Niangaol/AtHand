import { describe, expect, it } from 'vitest';
import { summarize } from './summary';
import type { RecordEntry } from './records';

const records: RecordEntry[] = [
  { id: 'w', type: 'work', date: '2026-11-20', title: '奶茶店', source: 'demo', amountCents: 6000, durationMinutes: 180, startTime: '14:00', endTime: '17:00', hourlyRateCents: 2000, workplaceId: 'shop' },
  { id: 'e', type: 'expense', date: '2026-11-20', title: '午餐', source: 'demo', amountCents: 3000, category: '吃饭' },
  { id: 'outside', type: 'expense', date: '2026-11-23', title: '下周午餐', source: 'demo', amountCents: 9999, category: '吃饭' },
];

describe('summarize', () => {
  it('subtracts positive expenses and excludes adjacent weeks', () => {
    expect(summarize(records, '2026-11-16', '2026-11-22')).toEqual({ incomeCents: 6000, expenseCents: 3000, netCents: 3000, workMinutes: 180 });
  });
  it('includes both boundary dates', () => {
    expect(summarize(records, '2026-11-20', '2026-11-20').netCents).toBe(3000);
  });
  it('returns zero values for an empty ledger', () => {
    expect(summarize([], '2026-11-16', '2026-11-22')).toEqual({ incomeCents: 0, expenseCents: 0, netCents: 0, workMinutes: 0 });
  });
  it('keeps small currency amounts exact and allows a negative balance', () => {
    const small: RecordEntry[] = [10, 20].map((amountCents, index) => ({ id: String(index), type: 'expense', date: '2026-11-20', title: '消费', source: 'demo', amountCents, category: '其他' }));
    expect(summarize(small, '2026-11-16', '2026-11-22').netCents).toBe(-30);
  });
});
