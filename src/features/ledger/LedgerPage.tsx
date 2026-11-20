import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useRecords } from '../../data/RecordsProvider';
import { getWeekRange, shiftDate, shortDate } from '../../domain/dates';
import { isDateKey } from '../../domain/ledger';
import { summarize } from '../../domain/summary';
import { PageHeading } from '../../components/PageHeading';
import { RecordList } from '../../components/RecordList';
import { SummaryCards } from '../../components/SummaryCards';

export function LedgerPage() {
  const { records, today } = useRecords();
  const [params] = useSearchParams();
  const location = useLocation();
  const [selectedDate, setSelectedDate] = useState(() => isDateKey(params.get('date') ?? '') ? params.get('date')! : today);
  const [filter, setFilter] = useState<'all' | 'work' | 'expense'>('all');
  const { start, end } = getWeekRange(selectedDate);
  const weekRecords = records.filter((record) => record.date >= start && record.date <= end);
  const filtered = weekRecords.filter((record) => filter === 'all' || record.type === filter);
  const notice = typeof location.state?.notice === 'string' ? location.state.notice : '';
  return <>
    <PageHeading title="这一周，记在这里。" description="赚的、花的，摊开来看就清楚了。" action={<Link className="button primary" to="/entry"><Plus size={17} />记一笔</Link>} />
    {notice ? <p role="status" className="inline-notice page-notice">{notice}</p> : null}
    <div className="ledger-toolbar"><div className="week-picker"><button className="icon-button" aria-label="上一周" onClick={() => setSelectedDate((value) => shiftDate(value, -7))}><ChevronLeft size={20} /></button><strong>{start.slice(0, 4)} 年 · {shortDate(start)} — {end.slice(0, 4) !== start.slice(0, 4) ? `${end.slice(0, 4)} 年 ` : ''}{shortDate(end)}</strong><button className="icon-button" aria-label="下一周" onClick={() => setSelectedDate((value) => shiftDate(value, 7))}><ChevronRight size={20} /></button></div><button className="button secondary compact" onClick={() => setSelectedDate(today)} disabled={start === getWeekRange(today).start}>回到本周</button></div>
    <SummaryCards summary={summarize(records, start, end)} />
    <section className="panel ledger-panel" aria-label="账单明细"><div className="section-heading"><h2>按天看明细</h2><div className="segmented" aria-label="记录类型筛选">{([{ value: 'all', label: '全部', aria: '全部记录' }, { value: 'work', label: '收入', aria: '只看收入' }, { value: 'expense', label: '支出', aria: '只看支出' }] as const).map((item) => <button key={item.value} aria-label={item.aria} aria-pressed={filter === item.value} className={filter === item.value ? 'selected' : ''} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div></div><RecordList records={filtered} editable /></section>
    <p className="page-caption">汇总始终显示完整一周，筛选只影响下方明细。记录满三个不同日期后，支出会显示按基准时薪估算的工作时间。</p>
  </>;
}
