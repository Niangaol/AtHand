import { STORAGE_KEY } from '../../data/storage';
import type { Workplace } from '../../domain/records';

type Result = { ok: true } | { ok: false; message: string };

/**
 * 找到或新建一个兼职单位并返回 id。
 * 注意：RecordsProvider.saveWorkplace 传入 id 会走「编辑」分支，因此新建时不能带 id，
 * 创建完成后从已落盘的账本里读回生成的 id。
 */
export async function ensureWorkplace(
  name: string,
  rateYuan: string,
  existing: readonly Workplace[],
  saveWorkplace: (name: string, rate: string) => Promise<Result>,
): Promise<string> {
  const found = existing.find((unit) => unit.name === name);
  if (found) return found.id;
  const result = await saveWorkplace(name, rateYuan);
  if (!result.ok) throw new Error(result.message);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const state = parsed as { workplaces?: Workplace[] } | null;
    const created = state?.workplaces?.find((unit) => unit.name === name);
    if (created && typeof created.id === 'string') return created.id;
  } catch { /* 读取失败时落到下面的统一报错 */ }
  throw new Error('单位创建后未能读取，请刷新页面重试。');
}
