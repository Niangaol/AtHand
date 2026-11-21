import { describe, expect, it } from 'vitest';
import { probeSamplesToRecords } from './probeImport';

const base = { id: 's1', at: new Date(2026, 10, 20, 12).getTime(), amountCents: 500, direction: 'EXPENSE', merchant: '校园奶茶店' };

describe('probe import', () => {
  it('maps a confirmed expense to a ledger record', () => {
    const result = probeSamplesToRecords([base]);
    expect(result.records).toEqual([{
      id: 'probe-s1', type: 'expense', date: '2026-11-20', title: '校园奶茶店',
      amountCents: 500, category: '吃饭', source: 'import',
    }]);
    expect(result.invalid).toBe(0);
  });
  it('skips income, refunds, pending confirmations and invalid rows', () => {
    const result = probeSamplesToRecords([
      { ...base, id: 'income', direction: 'INCOME' },
      { ...base, id: 'refund', direction: 'REFUND' },
      { ...base, id: 'pending', note: 'pending_confirm' },
      { ...base, id: 'zero', amountCents: 0 },
      { ...base, id: '', amountCents: 100 },
      null,
    ]);
    expect(result.records).toEqual([]);
    expect(result.skippedIncome).toBe(2);
    expect(result.skippedPending).toBe(1);
    expect(result.invalid).toBe(3);
  });
  it('guesses categories from the merchant and skips unknown text to 其他', () => {
    expect(probeSamplesToRecords([{ ...base, merchant: '地铁通勤' }]).records[0]).toMatchObject({ category: '交通' });
    expect(probeSamplesToRecords([{ ...base, merchant: '某商店' }]).records[0]).toMatchObject({ category: '其他' });
  });
  it('ignores non-array input instead of throwing', () => {
    expect(probeSamplesToRecords({ samples: [base] }).records).toHaveLength(0);
  });
});
