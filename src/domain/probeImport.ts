import { toDateKey } from './dates';
import type { ExpenseCategory, RecordEntry } from './records';

export type ProbeSample = {
  id: string;
  amountCents?: number | null;
  direction?: string;
  merchant?: string;
  title?: string;
  at?: number;
  note?: string;
  packageName?: string;
};

export type ProbeImportResult = {
  records: RecordEntry[];
  skippedIncome: number;
  skippedPending: number;
  invalid: number;
};

const categoryRules: Array<[RegExp, ExpenseCategory]> = [
  [/食堂|饭|餐|奶茶|咖啡|外卖|烧烤|火锅/, '吃饭'],
  [/地铁|公交|打车|滴滴|高铁|火车|机票|交通/, '交通'],
  [/超市|日用|纸巾|洗衣|理发/, '日用'],
  [/电影|游戏|KTV|演出|门票|娱乐/, '娱乐'],
  [/书|文具|打印|课程|学习|考试/, '学习'],
];

function guessCategory(text: string): ExpenseCategory {
  return categoryRules.find(([pattern]) => pattern.test(text))?.[1] ?? '其他';
}

export function probeSamplesToRecords(input: unknown): ProbeImportResult {
  const samples = Array.isArray(input) ? input : [];
  const records: RecordEntry[] = [];
  let skippedIncome = 0;
  let skippedPending = 0;
  let invalid = 0;

  for (const raw of samples) {
    if (!raw || typeof raw !== 'object') {
      invalid += 1;
      continue;
    }
    const sample = raw as ProbeSample;
    if (sample.direction !== 'EXPENSE') {
      if (sample.direction === 'INCOME' || sample.direction === 'REFUND') skippedIncome += 1;
      else invalid += 1;
      continue;
    }
    if (sample.note === 'pending_confirm' || sample.note === 'not_payment') {
      skippedPending += 1;
      continue;
    }
    const amountCents = sample.amountCents;
    const at = sample.at;
    if (typeof sample.id !== 'string' || !sample.id || !Number.isSafeInteger(amountCents) || Number(amountCents) <= 0
      || typeof at !== 'number' || !Number.isFinite(at)) {
      invalid += 1;
      continue;
    }
    const date = toDateKey(new Date(at));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      invalid += 1;
      continue;
    }
    const title = (sample.merchant?.trim() || sample.title?.trim() || '手机支付').slice(0, 100);
    records.push({
      id: `probe-${sample.id}`,
      type: 'expense',
      date,
      title,
      amountCents: Number(amountCents),
      category: guessCategory(`${title} ${sample.title ?? ''}`),
      source: 'import',
    });
  }

  return { records, skippedIncome, skippedPending, invalid };
}
