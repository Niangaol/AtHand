import { describe, expect, it } from 'vitest';
import { buildWeekChart, dayLabels, formatYuanShort, niceCeiling, type DayPoint } from './chart';

/** 2026-11-16 是周一，和现有 summarize() 的周区间一致 */
function week(overrides: Partial<DayPoint>[] = []): DayPoint[] {
  return Array.from({ length: 7 }, (_, index) => ({
    date: `2026-11-${String(16 + index).padStart(2, '0')}`,
    incomeCents: 0,
    expenseCents: 0,
    netCents: 0,
    workMinutes: 0,
    ...(overrides[index] ?? {}),
  }));
}

describe('dayLabels', () => {
  it('labels the week from Monday to Sunday', () => {
    expect([...dayLabels]).toEqual(['周一', '周二', '周三', '周四', '周五', '周六', '周日']);
  });
});

describe('niceCeiling', () => {
  it('never drops below the fixed 1 yuan floor', () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(-5)).toBe(1);
    expect(niceCeiling(Number.NaN)).toBe(1);
    expect(niceCeiling(Number.POSITIVE_INFINITY)).toBe(1);
    expect(niceCeiling(0.01)).toBe(1);
    expect(niceCeiling(1)).toBe(1);
  });

  it('rounds up to the 1 / 2 / 5 step ladder', () => {
    expect(niceCeiling(1.2)).toBe(2);
    expect(niceCeiling(3)).toBe(5);
    expect(niceCeiling(6)).toBe(10);
    expect(niceCeiling(18.5)).toBe(20);
    expect(niceCeiling(80)).toBe(100);
    expect(niceCeiling(1000)).toBe(1000);
    expect(niceCeiling(12000)).toBe(20000);
    expect(niceCeiling(20000000)).toBe(20000000);
  });

  it('is never smaller than the input it has to cover', () => {
    for (const value of [0.01, 1, 3.4, 18.5, 80, 12000, 20000000]) {
      expect(niceCeiling(value)).toBeGreaterThanOrEqual(value);
    }
  });
});

describe('formatYuanShort', () => {
  it('prints whole, fractional and zero amounts', () => {
    expect(formatYuanShort(0)).toBe('0');
    expect(formatYuanShort(1)).toBe('0.01');
    expect(formatYuanShort(8000)).toBe('80');
    expect(formatYuanShort(1850)).toBe('18.5');
    expect(formatYuanShort(1855)).toBe('18.55');
    expect(formatYuanShort(999999)).toBe('9999.99');
  });

  it('switches to 万 above ten thousand yuan without introducing 亿', () => {
    expect(formatYuanShort(1000000)).toBe('1万');
    expect(formatYuanShort(1200000)).toBe('1.2万');
    expect(formatYuanShort(2000000000)).toBe('2000万');
    expect(formatYuanShort(200000000000)).toBe('200000万');
  });

  it('keeps the sign and never returns NaN', () => {
    expect(formatYuanShort(-1850)).toBe('-18.5');
    expect(formatYuanShort(Number.NaN)).toBe('0');
    expect(formatYuanShort(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('buildWeekChart', () => {
  it('keeps an empty week finite and ticks it at 1 yuan', () => {
    const chart = buildWeekChart(week(), 200);
    expect(chart.halfHeight).toBe(100);
    expect(chart.topYuan).toBe(1);
    expect(chart.ticks.map((tick) => [tick.side, tick.yuan, tick.offset])).toEqual([
      ['income', 1, 100],
      ['income', 0.5, 50],
      ['expense', 0.5, -50],
      ['expense', 1, -100],
    ]);
    expect(chart.columns).toHaveLength(7);
    for (const column of chart.columns) {
      expect(column.incomeHeight).toBe(0);
      expect(column.expenseHeight).toBe(0);
      expect(column.incomeLabel).toBeNull();
      expect(column.expenseLabel).toBeNull();
    }
  });

  it('renders a single cent as a 1px sliver with no floating label', () => {
    const chart = buildWeekChart(week([{ incomeCents: 1, netCents: 1 }]), 200);
    expect(chart.topYuan).toBe(1);
    expect(chart.columns[0].incomeHeight).toBe(1);
    expect(chart.columns[0].incomeLabel).toBeNull();
    expect(chart.columns[0].expenseHeight).toBe(0);
  });

  it('renders tens of millions of yuan with a 万 scale label', () => {
    const chart = buildWeekChart(week([{ incomeCents: 2000000000, netCents: 2000000000 }]), 200);
    expect(chart.topYuan).toBe(20000000);
    expect(chart.columns[0].incomeHeight).toBe(100);
    expect(chart.columns[0].incomeLabel).toBe('2000万');
    expect(chart.ticks[0].yuan).toBe(20000000);
    expect(chart.ticks[1].yuan).toBe(10000000);
    chart.columns.forEach((column) => expect(Number.isFinite(column.expenseHeight)).toBe(true));
  });

  it('uses one yuan per pixel ratio on both halves', () => {
    const chart = buildWeekChart(week([{ incomeCents: 5000, expenseCents: 2500, netCents: 2500 }]), 200);
    const [column] = chart.columns;
    expect(chart.topYuan).toBe(50);
    expect(column.incomeHeight).toBe(100);
    expect(column.expenseHeight).toBe(50);
    expect(column.incomeHeight / column.expenseHeight).toBe(2);
  });

  it('labels only the weekly maximum income and expense', () => {
    const chart = buildWeekChart(week([
      { incomeCents: 8000, netCents: 8000 },
      { incomeCents: 2000, netCents: 2000 },
      { expenseCents: 1850, netCents: -1850 },
      { expenseCents: 250, netCents: -250 },
    ]), 200);
    expect(chart.columns.map((column) => column.incomeLabel)).toEqual(['80', null, null, null, null, null, null]);
    expect(chart.columns.map((column) => column.expenseLabel)).toEqual([null, null, '18.5', null, null, null, null]);
  });

  it('skips the direct label when a maximum bar is under 14px', () => {
    const chart = buildWeekChart(week([
      { incomeCents: 10, netCents: 10 },
      { expenseCents: 100000, netCents: -100000 },
    ]), 200);
    expect(chart.topYuan).toBe(1000);
    expect(chart.columns[0].incomeHeight).toBe(0.01);
    expect(chart.columns[0].incomeLabel).toBeNull();
    expect(chart.columns[1].expenseHeight).toBe(100);
    expect(chart.columns[1].expenseLabel).toBe('1000');
  });

  it('renders a shorter week without inventing columns', () => {
    const chart = buildWeekChart(week().slice(0, 3), 200);
    expect(chart.columns).toHaveLength(3);
    expect(chart.ticks).toHaveLength(4);
    expect(chart.columns.map((column) => column.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18']);
  });

  it('clamps broken and negative input to zero', () => {
    const chart = buildWeekChart(week([{ incomeCents: -500, expenseCents: Number.NaN, netCents: 0 }]), 200);
    expect(chart.topYuan).toBe(1);
    expect(chart.columns[0].incomeHeight).toBe(0);
    expect(chart.columns[0].expenseHeight).toBe(0);
  });

  it('stays finite when the plot has no height', () => {
    const chart = buildWeekChart(week([{ incomeCents: 8000, netCents: 8000 }]), 0);
    expect(chart.halfHeight).toBe(0);
    chart.ticks.forEach((tick) => expect(Number.isFinite(tick.offset)).toBe(true));
    chart.columns.forEach((column) => {
      expect(column.incomeHeight).toBe(0);
      expect(column.expenseHeight).toBe(0);
    });
  });
});
