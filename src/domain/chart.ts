/**
 * 「双轨账本柱」的纯计算层：分隔线、上下半轴高度、刻度与直标规则都在这里，
 * 组件只负责把数值放到 DOM 上。所有输出都保证有限（全 0 周也不会出现 NaN）。
 */

export const dayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

export type DayPoint = {
  date: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  workMinutes: number;
};

export type ChartTick = {
  side: 'income' | 'expense';
  /** 刻度对应的元值 */
  yuan: number;
  /** 距中间基线的像素距离：收入为正、支出为负 */
  offset: number;
};

export type ChartColumn = {
  date: string;
  incomeHeight: number;
  expenseHeight: number;
  incomeLabel: string | null;
  expenseLabel: string | null;
};

export type WeekChart = {
  halfHeight: number;
  topYuan: number;
  ticks: ChartTick[];
  columns: ChartColumn[];
};

/** 柱高低于 14px 不直标（图例里已有单位：元） */
export const LABEL_MIN_HEIGHT = 14;

/** 上半轴最低 1 元：全 0 周也按 1 元刻度，避免除零 */
const MIN_TOP_YUAN = 1;

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function negate(value: number): number {
  return value === 0 ? 0 : -value;
}

function trimZeros(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

/**
 * 把金额（元）向上取整到 1 / 2 / 5 × 10^n 的刻度上，最低 1 元。
 * 例如 18.5 → 20，80 → 100，2000 万 → 2000 万。
 */
export function niceCeiling(yuan: number): number {
  const safe = finite(yuan);
  if (safe <= MIN_TOP_YUAN) return MIN_TOP_YUAN;
  const magnitude = 10 ** Math.floor(Math.log10(safe));
  const normalized = safe / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return round2(step * magnitude);
}

/**
 * 短金额（分 → 元字符串）：80 / 18.5 / 0 / 1.2万。
 * 千元以上不引入「亿」，统一用「万」，最多保留一位小数。
 */
export function formatYuanShort(cents: number): string {
  const safe = finite(cents);
  const sign = safe < 0 ? '-' : '';
  const yuan = Math.abs(safe) / 100;
  if (yuan === 0) return '0';
  if (yuan >= 10000) return `${sign}${trimZeros((yuan / 10000).toFixed(1))}万`;
  return `${sign}${trimZeros(yuan.toFixed(2))}`;
}

/** 直标文案：0 元或不足 14px 的柱子返回 null */
export function barLabel(valueCents: number, height: number): string | null {
  const safe = finite(valueCents);
  if (safe <= 0) return null;
  if (!Number.isFinite(height) || height < LABEL_MIN_HEIGHT) return null;
  return formatYuanShort(safe);
}

/**
 * 双轨账本柱：上轴收入、下轴支出，上下半轴同一元/像素比。
 * days 顺序即周一至周日；不足 7 天时只返回已有的列。
 */
export function buildWeekChart(days: DayPoint[], plotHeight: number): WeekChart {
  const safeHeight = Number.isFinite(plotHeight) && plotHeight > 0 ? plotHeight : 0;
  const halfHeight = round2(safeHeight / 2);

  let maxCents = 0;
  let maxIncome = 0;
  let maxExpense = 0;
  let maxIncomeIndex = -1;
  let maxExpenseIndex = -1;

  days.forEach((day, index) => {
    const income = Math.max(0, finite(day.incomeCents));
    const expense = Math.max(0, finite(day.expenseCents));
    maxCents = Math.max(maxCents, income, expense);
    if (income > maxIncome) {
      maxIncome = income;
      maxIncomeIndex = index;
    }
    if (expense > maxExpense) {
      maxExpense = expense;
      maxExpenseIndex = index;
    }
  });

  const topYuan = maxCents > 0 ? niceCeiling(maxCents / 100) : MIN_TOP_YUAN;
  const heightOf = (valueCents: number) => {
    if (halfHeight <= 0) return 0;
    const ratio = valueCents / (topYuan * 100);
    return round2(Math.min(1, Math.max(0, ratio)) * halfHeight);
  };

  const columns: ChartColumn[] = days.map((day, index) => {
    const incomeCents = Math.max(0, finite(day.incomeCents));
    const expenseCents = Math.max(0, finite(day.expenseCents));
    const incomeHeight = heightOf(incomeCents);
    const expenseHeight = heightOf(expenseCents);
    return {
      date: day.date,
      incomeHeight,
      expenseHeight,
      incomeLabel: index === maxIncomeIndex ? barLabel(incomeCents, incomeHeight) : null,
      expenseLabel: index === maxExpenseIndex ? barLabel(expenseCents, expenseHeight) : null,
    };
  });

  // 上半轴 100% / 50%，下半轴 50% / 100%，offset 以像素计、位于基线两侧同距。
  const ticks: ChartTick[] = [
    { side: 'income', yuan: round2(topYuan), offset: halfHeight },
    { side: 'income', yuan: round2(topYuan / 2), offset: round2(halfHeight / 2) },
    { side: 'expense', yuan: round2(topYuan / 2), offset: negate(round2(halfHeight / 2)) },
    { side: 'expense', yuan: round2(topYuan), offset: negate(halfHeight) },
  ];

  return { halfHeight, topYuan, ticks, columns };
}
