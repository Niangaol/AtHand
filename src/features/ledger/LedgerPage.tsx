import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Clock3, Eye, EyeOff, Plus, Settings2, Sparkles, Trash2, User, Wallet } from 'lucide-react';
import { useRecords } from '../../data/RecordsProvider';
import { getWeekRange, shiftDate, shortDate } from '../../domain/dates';
import { isDateKey } from '../../domain/ledger';
import { summarize } from '../../domain/summary';
import { PageHeading } from '../../components/PageHeading';
import { RecordList } from '../../components/RecordList';
import { SummaryCards } from '../../components/SummaryCards';
import { WorkTimeSheet } from './WorkTimeSheet';
import { LifeExpenseScreen } from './LifeExpenseScreen';
import { calendarSub, monthCells, shiftMonth } from './calendar';
import { categoryStyles } from './categories';
import { BALANCE_KEY, computeBalance, formatMoney, readBalanceBase } from './balance';
import type { BalanceBase } from './balance';
import { useDeviceStatus } from './device';
import { DeviceSheet, LiveStatusCard, MiniCapsule, StatusBar } from './MiniChrome';
import './weeklyBill.css';

const weekNames = ['一', '二', '三', '四', '五', '六', '日'];

type DayTotal = { income: number; expense: number; net: number };

/** 日历上放得下的紧凑金额：超过一万用「w」，有小数保留一位。 */
function compactCents(cents: number): string {
  const value = Math.abs(cents) / 100;
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function greeting(hour: number) {
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/** 图 1：打开周账单即进入的小程序式月历界面。 */
function WeeklyBill({ onExit }: { onExit: () => void }) {
  const { records, workplaces, today, deleteRecord } = useRecords();
  const [selectedDate, setSelectedDate] = useState(today);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [showAmounts, setShowAmounts] = useState(true);
  const [workOpen, setWorkOpen] = useState(false);
  const [lifeOpen, setLifeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [balanceBase, setBalanceBase] = useState<BalanceBase | null>(readBalanceBase);
  const device = useDeviceStatus();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);
  // 其它标签页改动余额时同步过来。
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === BALANCE_KEY) setBalanceBase(readBalanceBase()); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const [year, number] = month.split('-').map(Number);
  const cells = useMemo(() => monthCells(year, number), [year, number]);
  const monthRecords = useMemo(() => records.filter((record) => record.date.startsWith(month)), [records, month]);
  const incomeUnitIds = useMemo(() => new Set(workplaces.filter((unit) => unit.name === '生活收入').map((unit) => unit.id)), [workplaces]);
  // 「生活收入」是收入记录的载体，不计入工时总时长，避免统计被虚增。
  const totalMinutes = monthRecords.reduce((sum, record) => sum + (record.type === 'work' && !incomeUnitIds.has(record.workplaceId) ? record.durationMinutes : 0), 0);
  const incomeCents = monthRecords.reduce((sum, record) => sum + (record.type === 'work' ? record.amountCents : 0), 0);
  const dayRecords = useMemo(() => records.filter((record) => record.date === selectedDate), [records, selectedDate]);
  // 每天的「生活收入 − 生活支出」净额：写入记录后随 Context 实时重算。
  const dayTotals = useMemo(() => {
    const map = new Map<string, DayTotal>();
    for (const record of records) {
      const total = map.get(record.date) ?? { income: 0, expense: 0, net: 0 };
      if (record.type === 'work') total.income += record.amountCents;
      else total.expense += record.amountCents;
      total.net = total.income - total.expense;
      map.set(record.date, total);
    }
    return map;
  }, [records]);
  const selectedTotal = dayTotals.get(selectedDate) ?? { income: 0, expense: 0, net: 0 };
  // 起始余额（首次默认 0）+ 账本里全部历史收支，随每笔收入 / 支出实时重算。
  const balanceCents = useMemo(() => computeBalance(records, balanceBase), [records, balanceBase]);

  function changeMonth(delta: number) {
    const next = shiftMonth(month, delta);
    setMonth(next);
    setSelectedDate(next === today.slice(0, 7) ? today : `${next}-01`);
    setMenuOpen(false);
  }
  function goToday() {
    setMonth(today.slice(0, 7));
    setSelectedDate(today);
    setMenuOpen(false);
  }
  function notify(message: string) { setToast(message); }

  return <div className="wb-mini-app">
    <div className="wb-mini-backdrop" aria-hidden="true"><span className="wb-bg-word">顺手</span><span className="wb-bg-sub">校园生活助理 · 让日子少一点零散</span></div>
    <div className="wb-phone">
      <StatusBar status={device} onInfo={() => setDeviceOpen(true)} />

      {/* 图 1 主界面 */}
      <section className={`wb-screen${lifeOpen ? '' : ' active'}`} aria-label="周账单">
        <div className="wb-scroll">
          <div className="wb-hd">
            <button type="button" className="wb-today" onClick={goToday} aria-label="回到今天">今</button>
            <div className="wb-month"><button type="button" onClick={() => changeMonth(-1)} aria-label="上一个月">‹</button><span>{year}年{number}月</span><button type="button" onClick={() => changeMonth(1)} aria-label="下一个月">›</button></div>
            <MiniCapsule onMenu={() => setMenuOpen((value) => !value)} onHome={() => { goToday(); notify('已回到今天'); }} menuOpen={menuOpen} />
          </div>

          <div className="wb-greet"><span className="wb-greet-ico"><Sparkles size={17} /></span><div><b>{greeting(new Date().getHours())}，今天也顺手记一笔</b><small>{device.dateText} · 这月已记 {monthRecords.length} 笔</small></div></div>
          <LiveStatusCard status={device} onInfo={() => setDeviceOpen(true)} />

          <div className="wb-summary">
            <div className="wb-sum-item"><span>工时总时长</span><b>{showAmounts ? `${Number((totalMinutes / 60).toFixed(1))}h` : '•••'}</b></div>
            <div className="wb-sum-item"><span>本月收入</span><b className="green">{showAmounts ? `¥${(incomeCents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '•••'}</b></div>
            <button type="button" className="wb-eye" onClick={() => setShowAmounts((value) => !value)} aria-label={showAmounts ? '隐藏金额' : '显示金额'}>{showAmounts ? <Eye size={17} /> : <EyeOff size={17} />}</button>
          </div>

          <div className="wb-day-stat" aria-label={`${selectedDate} 收支统计`}>
            <span className="wb-ds-date">{selectedDate === today ? '今日' : selectedDate.slice(5).replace('-', '/')}</span>
            <span className="wb-ds-item plus">收入 +¥{(selectedTotal.income / 100).toFixed(2)}</span>
            <span className="wb-ds-item minus">支出 −¥{(selectedTotal.expense / 100).toFixed(2)}</span>
            <span className={`wb-ds-item net${selectedTotal.net >= 0 ? ' plus' : ' minus'}`}>结余 {selectedTotal.net >= 0 ? '+' : '−'}¥{(Math.abs(selectedTotal.net) / 100).toFixed(2)}</span>
            <div className="wb-ds-balance">
              <span>当前余额</span>
              <b className={balanceCents < 0 ? 'minus' : ''}>{showAmounts ? formatMoney(balanceCents) : '•••'}</b>
              <small>{balanceBase ? `起始 ${formatMoney(balanceBase.cents)} · 叠加全部历史收支` : '起始余额默认 ¥0.00，可在「余额」里填'}</small>
            </div>
          </div>

          <div className="wb-week">{weekNames.map((name, index) => <span key={name} className={index > 4 ? 'wk' : ''}>{name}</span>)}</div>
          <div className="wb-cal">{cells.map((cell) => {
            const sub = calendarSub(cell.date);
            const isToday = cell.key === today;
            const isWeekend = [0, 6].includes(cell.date.getDay());
            const net = dayTotals.get(cell.key)?.net ?? 0;
            const netText = net > 0 ? `+${compactCents(net)}` : net < 0 ? `−${compactCents(net)}` : '';
            return <button type="button" key={cell.key} className={`wb-cell${cell.out ? ' out' : ''}${isWeekend ? ' wk' : ''}${cell.key === selectedDate ? ' sel' : ''}`} onClick={() => { setSelectedDate(cell.key); if (cell.out) setMonth(cell.key.slice(0, 7)); }} aria-label={`${cell.key}${sub.term ? ` ${sub.text}` : ''}${net ? ` 当日结余 ${net > 0 ? '+' : '−'}${(Math.abs(net) / 100).toFixed(2)} 元` : ''}`}>
              <span className="wb-num">{isToday ? '今' : cell.date.getDate()}</span>
              <span className={`wb-sub${sub.term ? ' term' : ''}`}>{sub.text}</span>
              {netText ? <span className={`wb-net${net > 0 ? ' plus' : ' minus'}`}>{netText}</span> : null}
            </button>;
          })}</div>

          <div className="wb-quick">
            <button type="button" className="wb-quick-card" onClick={() => setLifeOpen(true)}>
              <span className="wb-qc-ico orange"><Wallet size={18} /></span>
              <span className="wb-qc-txt long"><b>生活的收入与支出</b><small>记一笔 · 收支分类</small></span>
              <span className="wb-qc-arrow">›</span>
            </button>
            <button type="button" className="wb-quick-card primary" onClick={() => setWorkOpen(true)}>
              <span className="wb-qc-ico"><Clock3 size={18} /></span>
              <span className="wb-qc-txt"><b>记工时</b><small>手动录入</small></span>
              <span className="wb-qc-arrow">›</span>
            </button>
          </div>

          <div className="wb-records">
            <div className="wb-rec-head"><b>{selectedDate.replace(/-/g, '/')}</b><span>{dayRecords.length ? `${dayRecords.length} 笔记录` : '暂无记录'}</span><button type="button" onClick={() => setWorkOpen(true)} aria-label="添加记录"><Plus size={17} /></button></div>
            <div className="wb-rec-list">{dayRecords.map((record) => {
              const style = record.type === 'work' ? null : (categoryStyles[record.category] ?? categoryStyles['其他']);
              const Icon = record.type === 'work' ? Clock3 : style!.icon;
              return <div className="wb-rec-item" key={record.id}>
                <span className={`wb-ri-ico${record.type === 'expense' ? ' orange' : ''}`}><Icon size={17} /></span>
                <div className="wb-ri-txt"><b>{record.type === 'work' ? '工时记录' : record.category}</b><small>{record.type === 'work' ? `${record.startTime}–${record.endTime} · ${(record.durationMinutes / 60).toFixed(1)} 小时 · ${record.title}` : `备注：${record.title}${record.photos?.length ? ` · ${record.photos.length} 张照片` : ''}`}</small>
                  {record.photos?.length ? <div className="wb-photo-strip">{record.photos.slice(0, 4).map((src, index) => <img src={src} key={index} alt={`照片 ${index + 1}`} />)}</div> : null}
                </div>
                <span className={`wb-ri-amt${record.type === 'expense' ? ' out' : ''}`}>{record.type === 'expense' ? '−' : '+'}{showAmounts ? `¥${(record.amountCents / 100).toFixed(2)}` : '•••'}</span>
                <button type="button" className="wb-ri-del" onClick={() => void deleteRecord(record.id)} aria-label={`删除 ${record.title}`}><Trash2 size={14} /></button>
              </div>;
            })}</div>
          </div>
        </div>
        <nav className="wb-tabbar" aria-label="底部导航">
          <Link className="wb-tab active" to="/ledger"><CalendarDays size={19} />日历</Link>
          <Link className="wb-tab" to="/monthly"><BarChart3 size={19} />统计</Link>
          <Link className="wb-tab" to="/workplaces"><Wallet size={19} />薪资</Link>
          <Link className="wb-tab" to="/settings"><User size={19} />我的</Link>
        </nav>
      </section>

      {/* 图 3 + 图 4 */}
      <LifeExpenseScreen date={selectedDate} open={lifeOpen} onClose={() => setLifeOpen(false)} onSaved={notify} notify={notify}
        balanceBase={balanceBase} onBalanceChange={setBalanceBase} />
      {/* 图 2 */}
      <WorkTimeSheet date={selectedDate} open={workOpen} onClose={() => setWorkOpen(false)} onSaved={notify} />

      {/* 小程序 ··· 菜单：原菜单功能全部保留 */}
      {menuOpen ? <div className="wb-menu-mask" onClick={() => setMenuOpen(false)} /> : null}
      <div className={`wb-menu${menuOpen ? ' show' : ''}`} aria-hidden={!menuOpen}>
        <Link to="/entry" onClick={() => setMenuOpen(false)}>记一笔</Link>
        <Link to="/monthly" onClick={() => setMenuOpen(false)}>月度汇总</Link>
        <Link to="/workplaces" onClick={() => setMenuOpen(false)}>单位管理</Link>
        <Link to="/settings" aria-label="设置" onClick={() => setMenuOpen(false)}><Settings2 size={15} />数据与设置</Link>
        <button type="button" onClick={() => { setMenuOpen(false); setDeviceOpen(true); }}>本机信息</button>
        <button type="button" onClick={() => { setMenuOpen(false); onExit(); }}>切回桌面版</button>
      </div>

      <DeviceSheet status={device} open={deviceOpen} onClose={() => setDeviceOpen(false)} />
      <div className={`wb-toast${toast ? ' show' : ''}`} role="status">{toast}</div>
      <div className="wb-home-bar" />
    </div>
  </div>;
}

/** 软件原有的周账单明细与筛选，功能保持不变。 */
function LegacyLedger() {
  const { records, today } = useRecords();
  const [params] = useSearchParams();
  const location = useLocation();
  const [selectedDate, setSelectedDate] = useState(() => isDateKey(params.get('date') ?? '') ? params.get('date')! : today);
  const [filter, setFilter] = useState<'all' | 'work' | 'expense'>('all');
  const { start, end } = getWeekRange(selectedDate);
  const weekRecords = records.filter((record) => record.date >= start && record.date <= end);
  const filtered = weekRecords.filter((record) => filter === 'all' || record.type === filter);
  const notice = typeof location.state?.notice === 'string' ? location.state.notice : '';
  return <section className="wb-legacy-section" aria-label="周账单一周明细">
    <PageHeading title="这一周，记在这里。" description="赚的、花的，摊开来看就清楚了。" action={<Link className="button primary" to="/entry"><Plus size={17} />记一笔</Link>} />
    {notice ? <p role="status" className="inline-notice page-notice">{notice}</p> : null}
    <div className="ledger-toolbar"><div className="week-picker"><button className="icon-button" aria-label="上一周" onClick={() => setSelectedDate((value) => shiftDate(value, -7))}><ChevronLeft size={20} /></button><strong>{start.slice(0, 4)} 年 · {shortDate(start)} — {end.slice(0, 4) !== start.slice(0, 4) ? `${end.slice(0, 4)} 年 ` : ''}{shortDate(end)}</strong><button className="icon-button" aria-label="下一周" onClick={() => setSelectedDate((value) => shiftDate(value, 7))}><ChevronRight size={20} /></button></div><button className="button secondary compact" onClick={() => setSelectedDate(today)} disabled={start === getWeekRange(today).start}>回到本周</button></div>
    <SummaryCards summary={summarize(records, start, end)} />
    <section className="panel ledger-panel" aria-label="账单明细"><div className="section-heading"><h2>按天看明细</h2><div className="segmented" aria-label="记录类型筛选">{([{ value: 'all', label: '全部', aria: '全部记录' }, { value: 'work', label: '收入', aria: '只看收入' }, { value: 'expense', label: '支出', aria: '只看支出' }] as const).map((item) => <button key={item.value} aria-label={item.aria} aria-pressed={filter === item.value} className={filter === item.value ? 'selected' : ''} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div></div><RecordList records={filtered} editable /></section>
    <p className="page-caption">汇总始终显示完整一周，筛选只影响下方明细。记录满三个不同日期后，支出会显示按基准时薪估算的工作时间。</p>
  </section>;
}

export function LedgerPage() {
  const [miniMode, setMiniMode] = useState(true);
  return <>
    {miniMode ? <WeeklyBill onExit={() => setMiniMode(false)} /> : <div className="wb-back-bar"><span>已切回桌面版 · 原有周明细</span><button type="button" className="button primary compact" onClick={() => setMiniMode(true)}>回到小程序界面</button></div>}
    <LegacyLedger />
  </>;
}
