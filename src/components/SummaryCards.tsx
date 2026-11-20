import { ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react';
import type { Summary } from '../domain/records';
import { money } from '../domain/summary';

export function SummaryCards({ summary, balanceLabel = '本周净剩' }: { summary: Summary; balanceLabel?: string }) {
  return <div className="summary-strip">
    <div><span className="summary-label"><ArrowDownLeft size={17} />兼职收入</span><strong className="income">¥ {money(summary.incomeCents)}</strong></div>
    <div><span className="summary-label"><ArrowUpRight size={17} />生活支出</span><strong>¥ {money(summary.expenseCents)}</strong></div>
    <div><span className="summary-label"><Wallet size={17} />{balanceLabel}</span><strong>¥ {money(summary.netCents)}</strong></div>
  </div>;
}
