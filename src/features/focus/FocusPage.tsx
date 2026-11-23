import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, Pause, Play, Timer } from 'lucide-react';
import { PageHeading } from '../../components/PageHeading';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { usePlanner } from '../../data/PlannerProvider';
import { focusedSeconds, focusedSecondsBetween, remainingSeconds } from '../../domain/focus';
import type { FocusAction } from '../../domain/focus';
import { getWeekRange, toDateKey } from '../../domain/dates';
import { PlannerStatus } from '../../components/PlannerStatus';

export function FocusPage() {
  const { state, owner, busy, blocked, dispatch, serverBound } = usePlanner();
  const [params] = useSearchParams();
  const [task, setTask] = useState('');
  const [minutes, setMinutes] = useState(state.preferences.focusMinutes);
  const [now, setNow] = useState(Date.now);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState('');
  const completing = useRef('');
  const lastSource = useRef<string | null>(null);
  const active = state.focusSessions.find((session) => session.status === 'running' || session.status === 'paused');
  const sourceEvent = state.events.find((event) => event.id === params.get('event') && event.source === 'manual' && !event.allDay);
  const sourceSession = sourceEvent ? state.focusSessions.find((session) => session.eventId === sourceEvent.id && session.status !== 'cancelled') : undefined;
  const sourceOpen = !sourceSession;
  const sourceMinutes = sourceEvent ? Math.min(180, Math.max(1, Math.round((sourceEvent.end - sourceEvent.start) / 60_000))) : 0;
  const remaining = active ? remainingSeconds(active, now) : minutes * 60;
  const own = active?.owner === owner;
  const today = toDateKey(new Date(now));
  const week = getWeekRange(today);
  const history = state.focusSessions.filter((session) => session.status === 'completed' || session.status === 'cancelled').sort((a, b) => b.startedAt - a.startedAt);
  const dayStart = new Date(`${today}T00:00:00`).getTime();
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const weekEnd = new Date(`${week.end}T00:00:00`); weekEnd.setDate(weekEnd.getDate() + 1);
  const weekSeconds = focusedSecondsBetween(history, new Date(`${week.start}T00:00:00`).getTime(), weekEnd.getTime(), now);
  const todaySeconds = focusedSecondsBetween(history, dayStart, dayEnd.getTime(), now);
  const studyBlocks = state.events
    .filter((event) => event.source === 'manual' && !event.allDay && (event.kind === 'event' || event.kind === 'course'))
    .filter((event) => toDateKey(new Date(event.start)) === today && event.end > now && !state.focusSessions.some((session) => session.eventId === event.id && session.status !== 'cancelled'))
    .sort((a, b) => a.start - b.start)
    .slice(0, 5);
  const timeLabel = (event: { start: number; end: number }) => `${new Date(event.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}–${new Date(event.end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  useEffect(() => {
    if (!sourceEvent || !sourceOpen || lastSource.current === sourceEvent.id) return;
    lastSource.current = sourceEvent.id;
    setTask(sourceEvent.title);
    setMinutes(sourceMinutes);
  }, [sourceEvent, sourceOpen, sourceMinutes]);
  useEffect(() => {
    if (!active || !own || remaining > 0 || busy || blocked || completing.current === active.id) return;
    completing.current = active.id;
    void dispatch({ kind: 'focus.control', id: active.id, action: 'complete', owner, epoch: active.epoch }).then((result) => {
      if (result.ok) setNotice('这段专注已完成，休息一下吧。');
      else setNotice(result.message);
    });
  }, [active, own, remaining, busy, blocked, dispatch, owner]);

  async function control(action: FocusAction) {
    if (!active) return;
    const result = await dispatch({ kind: 'focus.control', id: active.id, action, owner, epoch: active.epoch });
    if (!result.ok) setNotice(result.message);
    setNow(Date.now());
  }
  return <>
    <PageHeading title="一次，只做好一件事。" description="记下这段时间在做什么；日程里安排好的学习，也可以直接从这里开始。" />
    <PlannerStatus />
    <div className="focus-layout">
      <section className="panel focus-panel" aria-label="专注计时">
        <div className="focus-label"><Timer size={18} />{serverBound ? '已同步的专注' : '仅本机计时'}</div>
        <h2>{active?.task || '留一段时间给自己'}</h2>
        <div className="focus-clock" role="timer" aria-label="剩余时间" aria-live="off">{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</div>
        {active ? <>
          <p className="focus-state">{active.status === 'paused' ? '已暂停' : remaining === 0 ? '等待保存完成记录' : '正在专注'}</p>
          <div className="planner-actions">
            {!own ? <button className="button primary" disabled={busy || blocked} onClick={() => void control('takeover')}>在此窗口接管</button>
              : <><button className="button primary" disabled={busy || blocked || remaining === 0} onClick={() => void control(active.status === 'paused' ? 'resume' : 'pause')}>{active.status === 'paused' ? <Play size={17} /> : <Pause size={17} />}{active.status === 'paused' ? '继续专注' : '暂停'}</button><button className="button secondary" disabled={busy || blocked} onClick={() => setConfirm(true)}>结束本次</button></>}
            {own && remaining === 0 ? <button className="button primary" disabled={busy || blocked} onClick={() => void control('complete')}>保存完成记录</button> : null}
          </div>
          {!own ? <p className="form-hint">计时由另一窗口发起；接管后，旧窗口无法继续控制。</p> : null}
        </> : <form className="planner-form focus-form" onSubmit={async (event) => {
          event.preventDefault();
          const result = await dispatch({ kind: 'focus.start', id: crypto.randomUUID(), task, minutes, owner, ...(sourceOpen && sourceEvent ? { eventId: sourceEvent.id } : {}) });
          setNotice(result.ok ? '' : result.message);
          completing.current = '';
          setNow(Date.now());
        }}>
          <label>正在做什么<input value={task} onChange={(e) => setTask(e.target.value)} maxLength={100} required placeholder="例如：复习高等数学" /></label>
          <label>计划分钟<input type="number" min={1} max={180} step={1} required value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></label>
          {sourceEvent ? <p className="form-hint">来自日程「{sourceEvent.title}」· {timeLabel(sourceEvent)}{sourceOpen ? '' : ' · 已有专注记录，可再次开始'}</p> : null}
          <button className="button primary" disabled={busy || blocked}><Play size={17} />开始专注</button>
        </form>}
        {notice ? <p className="inline-notice" role="status">{notice}</p> : null}
        <p className="form-hint">刷新或切到后台不会清零。关闭页面后不会响铃，重新打开可恢复记录。</p>
        <section className="focus-study" aria-label="今天的学习安排">
          <div className="planner-section-title"><h3>今天的学习安排</h3><Link className="text-link" to="/schedule">去日程安排</Link></div>
          {studyBlocks.length ? <ul className="planner-list">{studyBlocks.map((event) => <li key={event.id}><div><strong>{event.title}</strong><p>{timeLabel(event)}</p></div>{active ? <span className="form-hint">先结束当前专注</span> : <Link className="button secondary compact" aria-label={`从日程开始专注 ${event.title}`} to={`/focus?event=${encodeURIComponent(event.id)}`}>开始专注</Link>}</li>)}</ul> : <p className="form-hint">今天还没有学习安排。到日程里加一段时间，回来就能直接开始专注。</p>}
        </section>
      </section>
      <section className="panel planner-panel" aria-label="专注记录">
        <div className="planner-section-title"><h2><BookOpen size={19} />专注记录</h2><span>今日 {Math.floor(todaySeconds / 60)} 分钟 · 本周 {Math.floor(weekSeconds / 60)} 分钟</span></div>
        {history.length ? <ol className="planner-list">{history.slice(0, 100).map((session) => <li key={session.id}>
          <div><strong>{session.task}</strong><p>{new Date(session.startedAt).toLocaleString('zh-CN')} · {Math.floor(focusedSeconds(session, now) / 60)} 分钟</p></div>
          <span className="subtle-tag">{session.status === 'completed' ? '已完成' : '已结束（未完成）'}</span>
        </li>)}</ol> : <div className="planner-empty"><Timer size={30} /><h3>还没有专注记录</h3><p>开始一段专注，记录会留在这里。</p></div>}
      </section>
    </div>
    {confirm ? <ConfirmDialog title="结束本次专注？" description="保留已经投入的时间，标为未完成；不会计入已完成次数。" confirmLabel="确认结束" onCancel={() => setConfirm(false)} onConfirm={async () => { await control('cancel'); setConfirm(false); }} /> : null}
  </>;
}
