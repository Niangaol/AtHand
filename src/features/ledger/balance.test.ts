import { beforeEach, describe, expect, it } from 'vitest';
import type { RecordEntry } from '../../domain/records';
import {
  BALANCE_KEY, clearBalanceBase, computeBalance, formatMoney,
  parseBalanceInput, readBalanceBase, recordsNet, writeBalanceBase,
} from './balance';
import type { BalanceBase } from './balance';

const income = (id: string, amountCents: number): RecordEntry => ({
  id, date: '2026-11-20', title: '收入', amountCents, source: 'manual', type: 'work',
  workplaceId: 'unit-income', startTime: '00:00', endTime: '01:00', durationMinutes: 60, hourlyRateCents: amountCents,
});
const expense = (id: string, amountCents: number): RecordEntry => ({
  id, date: '2026-11-21', title: '支出', amountCents, source: 'manual', type: 'expense', category: '日用品',
});
const base = (cents: number): BalanceBase => ({ cents, date: '2026-11-27', account: '现金(CNY)', note: '' });

describe('余额口径：起始余额 + 全部历史收支', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('第一次使用、还没有任何记录时余额默认为 0', () => {
    expect(computeBalance([], null)).toBe(0);
    expect(computeBalance([], null)).toBe(0);
  });

  it('没填起始余额时，历史收支也要全部算进来', () => {
    const records = [income('a', 30000), expense('b', 12050)];
    expect(recordsNet(records)).toBe(17950);
    expect(computeBalance(records, null)).toBe(17950);
  });

  it('填入起始余额后，设定之前就存在的历史记录同样叠加，不按时间截断', () => {
    const older = [income('old-1', 50000), expense('old-2', 18000)];
    const later = [expense('new-1', 2500)];
    const records = [...older, ...later];
    expect(computeBalance(records, base(100000))).toBe(129500);
    // 再记一笔支出 / 删掉一笔支出，余额实时跟着变
    expect(computeBalance([...records, expense('new-2', 1000)], base(100000))).toBe(128500);
    expect(computeBalance(older, base(100000))).toBe(132000);
  });

  it('起始余额可以为 0 或负数，历史净额为负时显示成 −¥', () => {
    const records = [expense('x', 5000)];
    expect(computeBalance(records, base(0))).toBe(-5000);
    expect(computeBalance(records, base(-20000))).toBe(-25000);
    expect(formatMoney(-5000)).toBe('−¥50.00');
  });

  it('起始余额持久化，且能读出旧版本带 settledIds 的数据', () => {
    expect(readBalanceBase()).toBeNull();
    writeBalanceBase(base(12345));
    expect(readBalanceBase()?.cents).toBe(12345);
    window.localStorage.setItem(BALANCE_KEY, JSON.stringify({ ...base(8800), settledIds: ['old-1', 'old-2'] }));
    const restored = readBalanceBase();
    expect(restored?.cents).toBe(8800);
    expect(computeBalance([expense('old-1', 200)], restored)).toBe(8600);
    clearBalanceBase();
    expect(readBalanceBase()).toBeNull();
  });

  it('输入解析允许 0、负号与两位小数', () => {
    expect(parseBalanceInput('0')).toBe(0);
    expect(parseBalanceInput('−1,905.56')).toBe(-190556);
    expect(parseBalanceInput('12.3')).toBe(1230);
    expect(parseBalanceInput('abc')).toBeNull();
  });
});
