import type { RecordEntry } from '../../domain/records';

/** 余额单独存一个键，不动 shunshou.ledger.v1，避免影响账本校验与同步。 */
export const BALANCE_KEY = 'shunshou.balance.v1';

export type BalanceBase = {
  /** 用户亲手填入的「起始余额」（分，可为负、可为 0）；第一次使用没填过时按 0 处理。 */
  cents: number;
  /** 设定日期，用于展示。 */
  date: string;
  account: string;
  note: string;
};

export function readBalanceBase(): BalanceBase | null {
  try {
    const raw = window.localStorage.getItem(BALANCE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const item = value as Record<string, unknown>;
    if (typeof item.cents !== 'number' || !Number.isSafeInteger(item.cents) || Math.abs(item.cents) > 999999999) return null;
    if (typeof item.date !== 'string') return null;
    // 旧版本存过 settledIds，这里只取需要的字段，老数据照常能读出来。
    return {
      cents: item.cents,
      date: item.date,
      account: typeof item.account === 'string' ? item.account : '现金(CNY)',
      note: typeof item.note === 'string' ? item.note : '',
    };
  } catch { return null; }
}

export function writeBalanceBase(base: BalanceBase): void {
  try { window.localStorage.setItem(BALANCE_KEY, JSON.stringify(base)); }
  catch { throw new Error('余额保存失败，请检查浏览器存储空间或隐私设置。'); }
}

export function clearBalanceBase(): void {
  try { window.localStorage.removeItem(BALANCE_KEY); } catch { /* 存储不可用时只影响提示 */ }
}

/** 余额允许负数与 0，也允许键盘输入的千分位、全角减号。 */
export function parseBalanceInput(raw: string): number | null {
  const normalized = raw.trim().replace(/,/g, '').replace(/[−–—]/g, '-').replace(/＋/g, '+').replace(/\s/g, '');
  if (!/^[+-]?\d{1,7}(\.\d{1,2})?$/.test(normalized)) return null;
  const negative = normalized.startsWith('-');
  const digits = normalized.replace(/^[+-]/, '');
  const [yuan, decimal = ''] = digits.split('.');
  const cents = Number(yuan) * 100 + Number(decimal.padEnd(2, '0'));
  if (cents > 999999999) return null;
  return negative ? -cents : cents;
}

/** 账本里「全部」历史收支的净额：收入为正、支出为负。 */
export function recordsNet(records: readonly RecordEntry[]): number {
  return records.reduce((sum, record) => sum + (record.type === 'work' ? record.amountCents : -record.amountCents), 0);
}

/**
 * 当前余额 = 起始余额（用户填入；第一次用默认 0）+ 账本里全部历史收支。
 * 不按设定时间截断：填入之前记过的收入 / 支出一样算进来。
 * records 来自 RecordsProvider，任何一笔写入 / 删除都会触发重新计算，实现「每次自动变化」。
 */
export function computeBalance(records: readonly RecordEntry[], base: BalanceBase | null): number {
  return (base?.cents ?? 0) + recordsNet(records);
}

/** 显示成截图里的 −1,905.56 形式。 */
export function formatBalance(cents: number): string {
  const text = (Math.abs(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? '−' : ''}${text}`;
}

/** 带货币符号：负数写成 −¥50.00，而不是 ¥−50.00。 */
export function formatMoney(cents: number): string {
  return `${cents < 0 ? '−¥' : '¥'}${formatBalance(Math.abs(cents))}`;
}
