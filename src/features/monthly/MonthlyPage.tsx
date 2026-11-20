import { useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { PageHeading } from '../../components/PageHeading';
import { SummaryCards } from '../../components/SummaryCards';
import { RecordList } from '../../components/RecordList';
import { useRecords } from '../../data/RecordsProvider';
import { getMonthRange, shiftDate } from '../../domain/dates';
import { summarize } from '../../domain/summary';

export function MonthlyPage() {
  const { records, today } = useRecords();
  const [month, setMonth] = useState(today.slice(0, 7));
  const { start, end } = getMonthRange(month);
  const summary = summarize(records, start, end);
  const monthlyRecords = records.filter((record) => record.date >= start && record.date <= end);
  return <>
    <PageHeading title="把时间拉长一点看。" description="一个月的收入、支出和努力，在这里汇成一页。" />
    <div className="ledger-toolbar"><div className="week-picker"><button className="icon-button" aria-label="上个月" disabled={month === '2000-01'} onClick={() => setMonth(shiftDate(start, -1).slice(0, 7))}><ChevronLeft size={20} /></button><input className="month-input" type="month" aria-label="选择月份" min="2000-01" max="2100-12" value={month} onChange={(event) => { const value = event.target.value; if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= '2000-01' && value <= '2100-12') setMonth(value); }} /><button className="icon-button" aria-label="下个月" disabled={month === '2100-12'} onClick={() => setMonth(shiftDate(end, 1).slice(0, 7))}><ChevronRight size={20} /></button></div><button className="button secondary compact" disabled={month === today.slice(0, 7)} onClick={() => setMonth(today.slice(0, 7))}>回到本月</button></div>
    <SummaryCards summary={summary} balanceLabel="本月净剩" />
    <div className="month-totals"><span><Clock3 size={14} /> 累计工作 {(summary.workMinutes / 60).toFixed(1)} 小时</span><span>共 {monthlyRecords.length} 笔记录</span></div>
    <section className="panel ledger-panel" aria-label="月度明细"><div className="section-heading"><h2>{Number(month.slice(5))} 月明细</h2><span className="subtle-tag">按记录日期统计</span></div><RecordList records={monthlyRecords} editable /></section>
    <p className="page-caption">跨午夜工时计入开始日期所在月份。净剩为收入减支出，不是账户余额。</p>
  </>;
}
