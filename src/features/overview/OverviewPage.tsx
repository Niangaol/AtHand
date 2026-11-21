import { ArrowRight, ArrowUpRight, CalendarDays, Clock3, Leaf, NotebookPen, ReceiptText, Timer, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useRecords } from '../../data/RecordsProvider';
import { getWeekRange, shiftDate, shortDate } from '../../domain/dates';
import { money, summarize } from '../../domain/summary';
import { RecordList } from '../../components/RecordList';
import { PageHeading } from '../../components/PageHeading';
import { useCalendar } from '../../data/CalendarProvider';
import { usePlanner } from '../../data/PlannerProvider';
import { buildTimeline } from '../../domain/schedule';
import { getCountdowns } from '../../domain/countdowns';
import { CountdownList } from '../../components/CountdownList';

export function OverviewPage() {
  const { records, today, remote } = useRecords();
  const { state: planner } = usePlanner();
  const { sources } = useCalendar();
  const agenda = buildTimeline(planner, records, sources, today, today);
  const countdowns = getCountdowns(planner, today, sources);
  const hasExamples = records.some((record) => record.source === 'demo');
  const { start, end } = getWeekRange(today);
  const week = summarize(records, start, end);
  const day = summarize(records, today, today);
  const daily = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(start, index);
    return { date, ...summarize(records, date, date) };
  });
  const max = Math.max(100, ...daily.flatMap((item) => [item.incomeCents, item.expenseCents]));
  const recent = [...records].filter((record) => record.date <= today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);

  return <>
    <PageHeading title="把这一周，过得心里有数。" description={`${shortDate(today)}，${new Date(`${today}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'long' })}。生活里的小事，都可以顺手记下。`} action={<Link className="button primary" to="/entry"><NotebookPen size={18} />记一笔</Link>} />
    <div className="dashboard-grid planner-home">
      <section className="panel planner-panel" aria-label="今日安排"><div className="planner-section-title"><h2><CalendarDays size={19} />今天有什么</h2><Link className="text-link" to="/schedule">查看日程</Link></div>{agenda.length ? <ul className="planner-list">{agenda.map((item) => <li key={item.id}><div><strong>{item.title}</strong><p>{item.allDay ? '全天' : new Date(item.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}{item.location ? ` · ${item.location}` : ''}</p></div><span className="subtle-tag">{item.sourceLabel}</span>{item.eventId ? (() => { const event = planner.events.find((value) => value.id === item.eventId); return event?.source === 'manual' && !event.allDay && (event.kind === 'event' || event.kind === 'course') ? <Link className="text-link" aria-label={`开始专注 ${item.title}`} to={`/focus?event=${encodeURIComponent(event.id)}`}>专注</Link> : null; })() : null}</li>)}</ul> : <div className="planner-empty"><p>今天还没有安排，添加课程或导入日历后会显示在这里。</p><Link className="text-link" to="/schedule">安排今天</Link></div>}</section>
      <section className="panel planner-panel" aria-label="最近倒计时"><div className="planner-section-title"><h2>最近要紧的事</h2><Link className="text-link" to="/schedule">管理重要日期</Link></div><CountdownList items={countdowns} /></section>
    </div>
    <section className="overview-band" aria-label="今天与本周概览">
      <div className="balance-panel"><div className="balance-top"><span>这一周的小结</span><Leaf size={22} strokeWidth={1.4} /></div><span className="balance-label">本周净剩</span><div className="balance-value" data-testid="week-net"><span>¥</span>{money(week.netCents)}</div><div className="balance-details"><span>收入 <strong>¥ {money(week.incomeCents)}</strong></span><span>本周花费 <strong>¥ {money(week.expenseCents)}</strong></span></div><Link to="/ledger" className="balance-link">去看看钱花在哪了 <ArrowUpRight size={17} /></Link></div>
      <div className="today-panel"><div className="today-heading"><span>今天，也在好好生活</span><span className="subtle-tag">{hasExamples ? '示例数据' : '本机记录'}</span></div><div className="today-stats"><div><span className="stat-symbol"><Clock3 size={21} /></span><span className="stat-label">今天工时</span><strong>{(day.workMinutes / 60).toFixed(1)}<small>小时</small></strong><p>每一份付出，都有迹可循</p></div><div><span className="stat-symbol amber"><Wallet size={21} /></span><span className="stat-label">今天支出</span><strong><small className="currency">¥</small>{money(day.expenseCents)}</strong><p>吃好饭，也记得照顾自己</p></div></div><div className="gentle-note"><span />{hasExamples ? '先看看示例，找到适合自己的记录方式。' : '已保存在本机，记得定期导出自己的账单。'}</div></div>
    </section>
    <div className="dashboard-grid">
      <section className="panel chart-panel"><div className="section-heading"><div><h2>钱与时间的一周</h2><p>{shortDate(start)} — {shortDate(end)}</p></div><Link className="icon-link" to="/ledger" aria-label="查看完整周账单"><ArrowUpRight size={20} /></Link></div><div className="chart-legend"><span><i className="income-dot" />收入</span><span><i className="expense-dot" />支出</span><span className="chart-unit">单位：元</span></div><div className="weekly-chart" role="img" aria-label={`本周收入 ${money(week.incomeCents)} 元，支出 ${money(week.expenseCents)} 元。按天明细可在周账单查看。`}><div className="chart-gridlines"><span>{Math.ceil(max / 100)}</span><span>{Math.ceil(max / 200)}</span><span>0</span></div><div className="chart-columns">{daily.map((item, index) => <div className={`chart-day${item.date === today ? ' is-today' : ''}`} key={item.date}><div className="bar-pair" title={`${shortDate(item.date)}：收入 ${money(item.incomeCents)} 元，支出 ${money(item.expenseCents)} 元`}><div className="chart-bar income-bar" style={{ height: `${item.incomeCents / max * 100}%` }} /><div className="chart-bar expense-bar" style={{ height: `${item.expenseCents / max * 100}%` }} /></div><span>{['一', '二', '三', '四', '五', '六', '日'][index]}</span></div>)}</div></div><div className="chart-footnote"><Clock3 size={15} /><span>本周累计工作 <strong>{(week.workMinutes / 60).toFixed(1)} 小时</strong></span><span>周一至周日</span></div></section>
      <section className="panel recent-panel"><div className="section-heading"><div><h2>最近几笔</h2><p>一点一滴，都是生活。</p></div><Link className="text-link" to="/ledger">全部 <ArrowRight size={15} /></Link></div><RecordList records={recent} /></section>
    </div>
    <section className="next-section" aria-label="生活入口"><div className="planner-actions"><Link className="button secondary" to="/focus"><Timer size={18} />留一段专注时间</Link><Link className="button secondary" to="/schedule"><CalendarDays size={18} />安排课程与重要日期</Link><Link className="button secondary" to="/campus">查校园办事入口</Link><Link className="button secondary" to="/trips">准备下一趟旅行</Link></div></section>
    <div className="preview-note"><ReceiptText size={16} /><span>{hasExamples ? '当前账单为示例。保存第一笔真实记录后，示例账单会自动移除。' : `账本${remote.status === 'off' ? '保存在本浏览器，未连接电脑' : remote.message}。生活记录独立保存，请定期备份。`}</span></div>
  </>;
}
