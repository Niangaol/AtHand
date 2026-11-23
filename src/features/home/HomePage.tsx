import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, Check, MessageSquare, MessageSquarePlus, NotebookPen, Send, Timer, X } from 'lucide-react';
import { useRecords } from '../../data/RecordsProvider';
import { usePlanner } from '../../data/PlannerProvider';
import { useCalendar } from '../../data/CalendarProvider';
import { isGatewayConnected } from '../../data/gateway';
import { listAgentAudit } from '../../data/agentTokens';
import type { AgentAuditEntry } from '../../data/agentTokens';
import { sendAssistantMessage } from '../../data/assistant';
import type { AssistantTrace } from '../../data/assistant';
import { toolLabel } from '../../data/agentToolLabels';
import { getWeekRange, shortDate, toDateKey } from '../../domain/dates';
import { buildTimeline } from '../../domain/schedule';
import { focusedSeconds } from '../../domain/focus';
import { mergeActivity } from '../../domain/activity';
import type { ActivityItem } from '../../domain/activity';
import { nextTrip, tripCountdown } from '../../domain/tripPlan';
import { useCampus } from '../../data/CampusProvider';
import { courseWhen, nextCourse } from '../campus/campusSummary';
import { money, summarize } from '../../domain/summary';

const sourceLabels: Record<ActivityItem['source'], string> = { assistant: '电脑', focus: '专注', ledger: '账本' };

function formatClock(stamp: number) {
  return new Date(stamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function HomePage() {
  const { records, today } = useRecords();
  const { state: planner } = usePlanner();
  const { sources } = useCalendar();
  const connected = isGatewayConnected();
  const agenda = buildTimeline(planner, records, sources, today, today);
  const day = summarize(records, today, today);
  const { start, end } = getWeekRange(today);
  const week = summarize(records, start, end);
  const weekday = new Date(`${today}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'long' });
  const upcomingTrip = nextTrip(planner.trips, today);
  const { status: campusStatus, summary: campusSummary } = useCampus();
  const campusCourse = campusStatus?.connected ? nextCourse(campusSummary.courses) : null;
  const focusMinutes = Math.floor(planner.focusSessions
    .filter((session) => toDateKey(new Date(session.startedAt)) === today)
    .reduce((total, session) => total + focusedSeconds(session, Date.now()), 0) / 60);

  const [audit, setAudit] = useState<AgentAuditEntry[]>([]);
  const [auditState, setAuditState] = useState<'off' | 'loading' | 'ready' | 'error'>(connected ? 'loading' : 'off');
  const [askOpen, setAskOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [askError, setAskError] = useState('');
  const [turns, setTurns] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [lastReply, setLastReply] = useState<{ reply: string; trace: AssistantTrace[] } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    listAgentAudit()
      .then((entries) => { if (active) { setAudit(entries); setAuditState('ready'); } })
      .catch(() => { if (active) setAuditState('error'); });
    return () => { active = false; };
  }, [connected]);

  useEffect(() => {
    if (askOpen) inputRef.current?.focus();
  }, [askOpen]);

  const feed = mergeActivity({
    today,
    assistant: audit.map((entry, index) => {
      const stamp = Date.parse(entry.at);
      return {
        id: `audit:${entry.at}:${entry.tool}:${index}`,
        at: Number.isFinite(stamp) ? stamp : Number.NaN,
        title: toolLabel(entry.tool),
        detail: entry.ok ? (entry.summary || '完成') : (entry.error || '没有完成'),
        ok: entry.ok,
      };
    }),
    focusSessions: planner.focusSessions,
    records,
  });

  function openAsk(seed = '') {
    setAskOpen(true);
    setAskError('');
    if (seed) setDraft(seed);
  }

  function closeAsk() {
    if (sending) return;
    setAskOpen(false);
    setAskError('');
  }

  async function refreshAudit() {
    try {
      setAudit(await listAgentAudit());
      setAuditState('ready');
    } catch {
      setAuditState('error');
    }
  }

  async function ask() {
    const content = draft.trim();
    if (!content || sending) return;
    if (!connected) { setAskError('还没有连接电脑，助手暂时不能执行。'); return; }
    const next = [...turns, { role: 'user' as const, content }].slice(-8);
    setSending(true);
    setAskError('');
    try {
      const result = await sendAssistantMessage(next);
      setTurns([...next, { role: 'assistant' as const, content: result.reply }].slice(-8));
      setLastReply(result);
      setDraft('');
      void refreshAudit();
    } catch (reason) {
      setAskError(reason instanceof Error ? reason.message : '这次没有成功，请稍后再试。');
    } finally {
      setSending(false);
    }
  }

  return <div className="home-stage">
    <header className="home-head">
      <span className="home-date">{shortDate(today)} · {weekday}</span>
      <h1>今天，顺手就好。</h1>
      <p className="home-lede">先做眼前这一件事。说一句，或者点一个入口。</p>
      <dl className="home-glance">
        <div><dt>安排</dt><dd>{agenda.length} 件</dd></div>
        <div><dt>今天花费</dt><dd>¥ {money(day.expenseCents)}</dd></div>
        <div><dt>专注</dt><dd>{focusMinutes} 分钟</dd></div>
        <div><dt>下一趟</dt><dd>{upcomingTrip ? `${upcomingTrip.title} · ${tripCountdown(upcomingTrip, today)}` : '未安排'}</dd></div>
        <div><dt>下一节</dt><dd>{campusStatus?.connected ? (campusCourse ? `${campusCourse.name} · ${courseWhen(campusCourse)}` : '课表还没有数据') : '未连接校园'}</dd></div>
      </dl>
    </header>

    {!askOpen ? <button type="button" className="home-ask" aria-expanded="false" aria-controls="home-assistant" onClick={() => openAsk()}>
      <span className="home-ask-mark"><MessageSquare size={17} strokeWidth={1.7} /></span>
      <span className="home-ask-copy"><strong>说一句，顺手去做</strong><small>查安排、记账、排日程、开专注</small></span>
      <span className="home-ask-example">比如：明晚七点安排复习一小时</span>
      <ArrowUpRight size={18} />
    </button> : <section id="home-assistant" className="home-assistant" aria-label="问助手">
      <div className="home-assistant-head">
        <span className="assistant-kicker"><MessageSquare size={13} strokeWidth={1.7} /> 顺手助手</span>
        <button type="button" className="home-assistant-close" aria-label="收起输入框" onClick={closeAsk} disabled={sending}><X size={16} /></button>
      </div>
      <form className="assistant-composer home-composer" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <div className="composer-field">
          <textarea ref={inputRef} aria-label="告诉助手要做什么" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="比如：明晚七点安排复习一小时" rows={2} maxLength={4000} disabled={sending}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); }
              if (event.key === 'Escape') { event.preventDefault(); closeAsk(); }
            }} />
          <span className="composer-hint">Enter 发送 · Shift + Enter 换行<span className="composer-hint-esc"> · Esc 收起</span></span>
        </div>
        <button className="assistant-send" type="submit" disabled={sending || !draft.trim()}><Send size={18} /><span>{sending ? '处理中' : '发送'}</span></button>
      </form>
      {askError ? <div className="home-ask-error" role="alert"><span>{askError}</span><Link to="/settings">{connected ? '检查模型设置' : '去连接电脑'}</Link></div> : null}
      {sending ? <p className="assistant-thinking" role="status"><span /><span /><span />正在查你的数据，并调用顺手的工具…</p> : null}
      {lastReply ? <div className="home-answer" role="status">
        <div className="home-answer-head"><span>顺手</span><Link to="/assistant">打开完整工作台 <ArrowUpRight size={13} /></Link></div>
        <p>{lastReply.reply}</p>
        {lastReply.trace.length ? <details className="assistant-trace">
          <summary><Check size={13} />{lastReply.trace.length} 个操作</summary>
          <ul>{lastReply.trace.map((item, index) => <li key={`${item.tool}-${index}`}><strong>{toolLabel(item.tool)}</strong><span>{item.ok ? (item.summary || '完成') : (item.message || item.error || '失败')}</span></li>)}</ul>
        </details> : null}
      </div> : null}
    </section>}

    <nav className="home-intents" aria-label="核心入口">
      <Link className="home-intent" to="/today">
        <span className="home-intent-icon"><CalendarDays size={20} strokeWidth={1.7} /></span>
        <span className="home-intent-copy"><strong>看看今天</strong><span>{agenda.length ? `${agenda.length} 个安排` : '今天还很空'}</span></span>
        <ArrowUpRight size={16} />
      </Link>
      <button type="button" className="home-intent is-ai" onClick={() => openAsk('帮我安排：')}>
        <span className="home-intent-icon"><MessageSquarePlus size={19} strokeWidth={1.6} /></span>
        <span className="home-intent-copy"><strong>说个安排</strong><span>一句话写进日程</span></span>
        <ArrowUpRight size={16} />
      </button>
      <Link className="home-intent" to="/entry">
        <span className="home-intent-icon"><NotebookPen size={20} strokeWidth={1.7} /></span>
        <span className="home-intent-copy"><strong>记一笔</strong><span>支出和工时</span></span>
        <ArrowUpRight size={16} />
      </Link>
      <Link className="home-intent" to="/focus">
        <span className="home-intent-icon"><Timer size={20} strokeWidth={1.7} /></span>
        <span className="home-intent-copy"><strong>开始专注</strong><span>{planner.preferences.focusMinutes} 分钟</span></span>
        <ArrowUpRight size={16} />
      </Link>
    </nav>

    <section className="home-feed" aria-label="今日记录">
      <div className="home-feed-head">
        <div><span className="home-kicker">今天</span><h2>顺手做过的事</h2></div>
        <span className="home-sync">{!connected ? '连接电脑后显示同步记录'
          : auditState === 'loading' ? '正在读取电脑记录…'
            : auditState === 'error' ? '电脑记录暂时读不到'
              : '电脑记录已同步'}</span>
      </div>
      {feed.length ? <ol className="home-feed-list">{feed.map((item) => <li key={item.id} className={`home-feed-item ${item.source}`}>
        <time dateTime={item.at !== null ? new Date(item.at).toISOString() : undefined}>{item.at !== null ? formatClock(item.at) : '今天'}</time>
        <span className="home-feed-mark" aria-hidden="true" />
        <div className="home-feed-copy">
          <div className="home-feed-title"><strong>{item.title}</strong><span className="home-feed-source">{sourceLabels[item.source]}</span>{item.ok === false ? <span className="home-feed-failed">失败</span> : null}</div>
          <p>{item.detail}</p>
        </div>
      </li>)}</ol> : <div className="home-feed-empty"><p>今天还没有留下记录。</p><span>点上面的入口，或者说一句话，做过的事会留在这里。</span></div>}
    </section>

    <footer className="home-foot">
      <span>本周净剩 <strong data-testid="week-net">¥ {money(week.netCents)}</strong></span>
      <Link to="/ledger">看周账单 <ArrowUpRight size={13} /></Link>
      <span className="home-foot-sync">{connected ? '已连接电脑，记录两端共用' : '记录保存在本机'}</span>
    </footer>
  </div>;
}
