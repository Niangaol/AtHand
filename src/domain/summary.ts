import type { RecordEntry, Summary } from './records';

export function summarize(records: readonly RecordEntry[], start: string, end: string): Summary {
  const summary: Summary = { incomeCents: 0, expenseCents: 0, netCents: 0, workMinutes: 0 };
  for (const record of records) {
    if (record.date < start || record.date > end) continue;
    if (record.type === 'work') {
      summary.incomeCents += record.amountCents;
      summary.workMinutes += record.durationMinutes;
    } else {
      summary.expenseCents += record.amountCents;
    }
  }
  summary.netCents = summary.incomeCents - summary.expenseCents;
  return summary;
}

export function money(cents: number): string {
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
