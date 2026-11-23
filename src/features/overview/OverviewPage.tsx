import { ArrowRight, ArrowUpRight, CalendarDays, Clock3, Leaf, NotebookPen, ReceiptText, RefreshCw, Timer, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import '../../styles/review-panel.css';
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
import { nextTrip, tripCountdown } from '../../domain/tripPlan';
import { useBriefing } from '../../data/useBriefing';
import { backendMode } from '../../data/gateway';
import { CampusTodayBar } from '../campus/CampusTodayBar';
import { WeeklyChart } from './WeeklyChart';

export function OverviewPage() {
  const { records, today, remote } = useRecords();
  const { state: planner } = usePlanner();
  const { sources } = useCalendar();
  const agenda = buildTimeline(planner, records, sources, today, today);
  const countdowns = getCountdowns(planner, today, sources);
  const upcomingTrip = nextTrip(planner.trips, today);
  const hasExamples = records.some((record) => record.source === 'demo');
  const { start, end } = getWeekRange(today);
  const week = summarize(records, start, end);
  const day = summarize(records, today, today);
  const daily = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(start, index);
    return { date, ...summarize(records, date, date) };
  });
  const recent = [...records].filter((record) => record.date <= today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  const review = useBriefing({ scope: 'week', state: planner, records, calendars: sources, today });
  const mode = backendMode();
  const localTag = mode === 'cloud' ? '云端记录' : '本机记录';

  return <>
    <PageHeading title="把这一周，过得心里有数。" description={`${shortDate(today)}，${new Date(`${today}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'long' })}。生活里的小事，都可以顺手记下。`} action={<Link className="button primary" to="/entry"><NotebookPen size={18} />记一笔</Link>} />
    <CampusTodayBar />
    <div className="dashboard-grid planner-home">
      <section className="panel planner-panel" aria-label="今日安排"><div className="planner-section-title"><h2><CalendarDays size={19} />今天有什么</h2><Link className="text-link" to="/schedule">查看日程</Link></div>{agenda.length ? <ul className="planner-list">{agenda.map((item) => <li key={item.id}><div><strong>{item.title}</strong><p>{item.allDay ? '全天' : new Date(item.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}{item.location ? ` · ${item.location}` : ''}</p></div><span className="subtle-tag">{item.sourceLabel}</span>{item.eventId ? (() => { const event = planner.events.find((value) => value.id === item.eventId); return event?.source === 'manual' && !event.allDay && (event.kind === 'event' || event.kind === 'course') ? <Link className="text-link" aria-label={`开始专注 ${item.title}`} to={`/focus?event=${encodeURIComponent(event.id)}`}>专注</Link> : null; })() : null}</li>)}</ul> : <div className="planner-empty"><p>今天还没有安排，添加课程或导入日历后会显示在这里。</p><Link className="text-link" to="/schedule">安排今天</Link></div>}</section>
      <section className="panel planner-panel" aria-label="最近倒计时"><div className="planner-section-title"><h2>最近要紧的事</h2><Link className="text-link" to="/schedule">管理重要日期</Link></div>{upcomingTrip ? <Link className="trip-next" to={`/trips/${encodeURIComponent(upcomingTrip.id)}`}><span className="subtle-tag">下一趟旅行</span><strong>{upcomingTrip.title}</strong><span>{tripCountdown(upcomingTrip, today)} · {upcomingTrip.startDate}</span></Link> : null}<CountdownList items={countdowns} /></section>
    </div>
    <section className="overview-band" aria-label="今天与本周概览">
      <div className="balance-panel"><div className="balance-top"><span>这一周的小结</span><Leaf size={22} strokeWidth={1.4} /></div><span className="balance-label">本周净剩</span><div className="balance-value" data-testid="week-net"><span>¥</span>{money(week.netCents)}</div><div className="balance-details"><span>收入 <strong>¥ {money(week.incomeCents)}</strong></span><span>本周花费 <strong>¥ {money(week.expenseCents)}</strong></span></div><Link to="/ledger" className="balance-link">去看看钱花在哪了 <ArrowUpRight size={17} /></Link></div>
      <div className="today-panel"><div className="today-heading"><span>今天，也在好好生活</span><span className="subtle-tag">{hasExamples ? '示例数据' : localTag}</span></div><div className="today-stats"><div><span className="stat-symbol"><Clock3 size={21} /></span><span className="stat-label">今天工时</span><strong>{(day.workMinutes / 60).toFixed(1)}<small>小时</small></strong><p>每一份付出，都有迹可循</p></div><div><span className="stat-symbol amber"><Wallet size={21} /></span><span className="stat-label">今天支出</span><strong><small className="currency">¥</small>{money(day.expenseCents)}</strong><p>吃好饭，也记得照顾自己</p></div></div><div className="gentle-note"><span />{hasExamples ? '先看看示例，找到适合自己的记录方式。' : mode === 'cloud' ? '已同步到云端账号，换设备登录也能看到。' : '已保存在本机，记得定期导出自己的账单。'}</div></div>
    </section>
    <section className="review-panel" aria-label="本周复盘">
      <div className="review-head">
        <div><span className="home-kicker">本周复盘</span><h2>{shortDate(review.facts.start)} 至 {shortDate(review.facts.end)}</h2></div>
        <div className="review-actions">
          {review.degraded ? <span className="review-tag">规则版</span> : null}
          <button type="button" className="text-link" onClick={() => void review.refresh()} disabled={review.loading}><RefreshCw size={13} />{review.loading ? '更新中' : '刷新'}</button>
        </div>
      </div>
      <p className="review-copy">{review.narrative}</p>
      <dl className="review-stats">
        <div><dt>本周支出</dt><dd>¥ {money(review.facts.thisWeek.expenseCents)}<small>上周 ¥ {money(review.facts.lastWeek.expenseCents)}</small></dd></div>
        <div><dt>本周专注</dt><dd>{review.facts.thisWeek.focusMinutes} 分钟<small>上周 {review.facts.lastWeek.focusMinutes} 分钟</small></dd></div>
        <div><dt>本周工时</dt><dd>{(review.facts.thisWeek.workMinutes / 60).toFixed(1)} 小时<small>上周 {(review.facts.lastWeek.workMinutes / 60).toFixed(1)} 小时</small></dd></div>
        <div><dt>本周净剩</dt><dd>¥ {money(review.facts.thisWeek.netCents)}<small>上周 ¥ {money(review.facts.lastWeek.netCents)}</small></dd></div>
      </dl>
      <h3 className="review-subhead">这一周的钱花在哪</h3>
      {review.facts.categories.length ? <ul className="review-categories">
        {review.facts.categories.map((item) => <li key={item.category}>
          <span>{item.category}</span>
          <span className="review-bar"><i style={{ width: `${Math.min(100, Math.max(0, item.share))}%` }} /></span>
          <strong>{item.share}%</strong>
        </li>)}
      </ul> : <p className="form-hint">本周还没有支出记录，记一笔就会出现在这里。</p>}
      <h3 className="review-subhead">每天专注了多久</h3>
      <div className="review-focus" role="list" aria-label="本周专注分布">
        {review.facts.focusByDay.map((day) => <div key={day.date} className="review-focus-day" role="listitem" aria-label={`${shortDate(day.date)} 专注 ${day.minutes} 分钟`}>
          <span className="review-focus-bar"><i style={{ height: `${Math.min(100, Math.max(0, day.minutes))}%` }} /></span>
          <small aria-hidden="true">{Number(day.date.slice(5, 7))}/{Number(day.date.slice(8))}</small>
        </div>)}
      </div>
      {review.facts.focusByDay.some((day) => day.minutes > 0) ? null : <p className="form-hint">这周还没有专注记录，去留一段专注时间试试。</p>}
      <h3 className="review-subhead">未来一周</h3>
      {review.facts.countdowns.length ? <ul className="review-countdowns">
        {review.facts.countdowns.map((item) => <li key={`${item.date}-${item.title}`}>
          <strong>{item.title}</strong>
          <span>{item.days === 0 ? '就是今天' : `还有 ${item.days} 天`}</span>
        </li>)}
      </ul> : <p className="form-hint">未来一周没有临近的考试或截止日期。</p>}
      {review.facts.warnings.length ? <ul className="review-warnings">
        {review.facts.warnings.slice(0, 3).map((text) => <li key={text}>{text}</li>)}
      </ul> : <p className="form-hint">这周的安排没有冲突，也没有排得过满的日子。</p>}
      {review.warning ? <p className="form-hint">{review.warning}</p> : null}
      {review.error ? <p className="form-hint">{review.error}</p> : null}
    </section>
    <div className="dashboard-grid">
      <WeeklyChart daily={daily} today={today} workMinutes={week.workMinutes} />
      <section className="panel recent-panel"><div className="section-heading"><div><h2>最近几笔</h2><p>一点一滴，都是生活。</p></div><Link className="text-link" to="/ledger">全部 <ArrowRight size={15} /></Link></div><RecordList records={recent} /></section>
    </div>
    <section className="next-section" aria-label="生活入口"><div className="planner-actions"><Link className="button secondary" to="/focus"><Timer size={18} />留一段专注时间</Link><Link className="button secondary" to="/schedule"><CalendarDays size={18} />安排课程与重要日期</Link><Link className="button secondary" to="/campus">查校园办事入口</Link><Link className="button secondary" to="/trips">准备下一趟旅行</Link></div></section>
    <div className="preview-note"><ReceiptText size={16} /><span>{hasExamples ? '当前账单为示例。保存第一笔真实记录后，示例账单会自动移除。' : mode === 'cloud' ? '账本同步到云端账号，换设备登录后可见。生活记录独立保存，请定期备份。' : `账本${remote.status === 'off' ? '保存在本浏览器，未连接电脑' : remote.message}。生活记录独立保存，请定期备份。`}</span></div>
  </>;
}
