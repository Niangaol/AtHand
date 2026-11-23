import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { PageHeading } from '../../components/PageHeading';
import { PlannerStatus } from '../../components/PlannerStatus';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CountdownList } from '../../components/CountdownList';
import { CalendarStatus, useCalendar } from '../../data/CalendarProvider';
import { usePlanner } from '../../data/PlannerProvider';
import { useRecords } from '../../data/RecordsProvider';
import { getWeekRange, shiftDate, shortDate } from '../../domain/dates';
import { buildTimeline, expandCourse, scheduleWarnings } from '../../domain/schedule';
import { getCountdowns } from '../../domain/countdowns';
import type { CourseRule, Countdown, Entity, PlannerCommand, PlannerEvent } from '../../domain/planner';
import { EventEditor, CourseEditor, CountdownEditor, kindNames } from './ScheduleEditors';
import { IcsImportPanel } from './IcsImportPanel';

type Editor = { type: 'event'; value?: PlannerEvent; rule?: CourseRule; date?: string } | { type: 'course'; value?: CourseRule } | { type: 'countdown'; value?: Countdown };
export function SchedulePage() {
  const { state, dispatch, busy, blocked } = usePlanner();
  const { records, today } = useRecords();
  const { sources } = useCalendar();
  const [offset, setOffset] = useState(0);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [listView, setListView] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deletion, setDeletion] = useState<PlannerCommand | null>(null);
  const [notice, setNotice] = useState('');
  const range = getWeekRange(shiftDate(today, offset * 7));
  const timeline = useMemo(() => buildTimeline(state, records, sources, range.start, range.end), [state, records, sources, range.start, range.end]);
  const warnings = useMemo(() => scheduleWarnings(buildTimeline(state, records, sources, range.start, shiftDate(range.end, 3))), [state, records, sources, range.start, range.end]);
  const shown = timeline.filter((item) => sourceFilter === 'all' || item.sourceLabel === sourceFilter);
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(range.start, i));
  async function save(command: PlannerCommand, expected?: Entity | null) {
    const result = await dispatch(command, expected);
    if (result.ok) { setEditor(null); setNotice('已保存到生活记录。'); } else setNotice(result.message);
    return result;
  }
  return <>
    <PageHeading title="把这一周，安排在一起。" description="课程、排班、专注和重要日期共用一张时间表；安排好的学习可以直接开始专注。" />
    <PlannerStatus />
    <div className="planner-toolbar"><div className="planner-actions"><button className="button primary" disabled={blocked} onClick={() => setEditor({ type: 'event' })}><Plus size={17} />添加日程</button><button className="button secondary" disabled={blocked} onClick={() => setEditor({ type: 'course' })}>添加每周课程</button><button className="button secondary" disabled={blocked} onClick={() => setEditor({ type: 'countdown' })}>添加倒计时</button></div></div>
    {notice ? <p className="inline-notice" role="status">{notice}</p> : null}
    {editor?.type === 'event' ? <EventEditor key={`${editor.type}:${editor.value?.id ?? 'new'}`} event={editor.value} today={today} busy={busy} cancel={() => setEditor(null)} save={(value) => editor.rule && editor.date ? save({ kind: 'put', collection: 'courseRules', value: { ...editor.rule, exceptions: [...editor.rule.exceptions.filter((e) => e.date !== editor.date), { date: editor.date, replacement: value }] } }, editor.rule) : save({ kind: 'put', collection: 'events', value }, editor.value ?? null)} /> : null}
    {editor?.type === 'course' ? <CourseEditor key={`course:${editor.value?.id ?? 'new'}`} rule={editor.value} today={today} busy={busy} cancel={() => setEditor(null)} save={(value) => save({ kind: 'put', collection: 'courseRules', value }, editor.value ?? null)} /> : null}
    {editor?.type === 'countdown' ? <CountdownEditor key={`countdown:${editor.value?.id ?? 'new'}`} item={editor.value} today={today} busy={busy} cancel={() => setEditor(null)} save={(value) => save({ kind: 'put', collection: 'countdowns', value }, editor.value ?? null)} /> : null}
    <section className="panel planner-panel" aria-label="本周日程">
      <div className="planner-section-title"><div className="planner-actions"><button className="button secondary compact" aria-label="前一周日程" onClick={() => setOffset(offset - 1)}><ChevronLeft size={18} /></button><h2>{shortDate(range.start)} — {shortDate(range.end)}</h2><button className="button secondary compact" aria-label="后一周日程" onClick={() => setOffset(offset + 1)}><ChevronRight size={18} /></button><button className="button secondary compact" onClick={() => setOffset(0)}>今天</button></div>
        <label>来源筛选<select aria-label="来源筛选" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}><option value="all">全部来源</option>{['手动日程', '课程规则', 'ICS导入', '手机日历', '已记工时', '专注记录', '旅记', '杭电助手'].map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      {warnings.filter((w) => w.rule !== 'long-shift' || !state.reminderReceipts.includes(w.key)).map((warning) => <div className="schedule-warning" key={warning.key}><p>{warning.text}</p>{warning.rule === 'long-shift' ? <button className="button secondary compact" disabled={busy} onClick={() => void dispatch({ kind: 'reminder', key: warning.key })}>今天不再提醒</button> : null}</div>)}
      <button className="button secondary compact" aria-pressed={listView} onClick={() => setListView(!listView)}>{listView ? '切换周视图' : '切换列表视图'}</button>
      <div className={`schedule-week${listView ? ' schedule-list' : ''}`}>{days.map((date) => <section className={`schedule-day${date === today ? ' is-today' : ''}`} key={date} aria-label={`${date}日程`}><h3>{shortDate(date)} <small>{['日', '一', '二', '三', '四', '五', '六'][new Date(`${date}T12:00:00`).getDay()]}</small></h3>
        {!shown.some((item) => item.date === date) ? <p className="schedule-free">暂无安排</p> : shown.filter((item) => item.date === date).map((item) => <article className={`schedule-item${warnings.some((w) => w.rule === 'overlap' && w.ids.includes(item.id)) ? ' conflict' : ''}`} key={item.id}>
          <small>{item.allDay ? '全天' : `${new Date(item.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} — ${item.end === new Date(`${shiftDate(date, 1)}T00:00`).getTime() ? '24:00' : new Date(item.end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`}</small>
          <h4>{item.title}</h4><p>{item.location || kindNames[item.kind]}</p><span>{item.sourceLabel}</span>
          <div className="schedule-item-actions">
            {item.eventId ? (() => { const target = state.events.find((event) => event.id === item.eventId); return target?.source === 'trip' ? <Link aria-label={`回旅记修改 ${item.title}`} to={`/trips/${encodeURIComponent(target.sourceId)}`}>回旅记修改</Link> : null; })() : null}
            {item.eventId ? (() => { const target = state.events.find((event) => event.id === item.eventId); return target?.source === 'manual' && !target.allDay && (target.kind === 'event' || target.kind === 'course') ? <Link aria-label={`开始专注 ${item.title}`} to={`/focus?event=${encodeURIComponent(target.id)}`}>开始专注</Link> : null; })() : null}
            {item.eventId && state.events.find((e) => e.id === item.eventId)?.source !== 'trip' ? <><button aria-label={`编辑日程 ${item.title}`} onClick={() => setEditor({ type: 'event', value: state.events.find((e) => e.id === item.eventId) })}>编辑</button><button aria-label={`删除日程 ${item.title}`} onClick={() => setDeletion({ kind: 'delete', collection: 'events', id: item.eventId! })}>删除</button></> : null}
            {item.linkedEventId ? (() => { const linked = state.events.find((event) => event.id === item.linkedEventId); return linked ? <><button aria-label={`编辑关联日程 ${linked.title}`} onClick={() => setEditor({ type: 'event', value: linked })}>编辑日程</button><button aria-label={`删除关联计划 ${linked.title}`} onClick={() => setDeletion({ kind: 'delete', collection: 'events', id: linked.id })}>删除计划</button></> : null; })() : null}
            {item.calendarEvent ? <label>确认分类<select aria-label={`确认分类 ${item.title}`} disabled={busy || blocked} value={item.kind} onChange={(e) => void save({ kind: 'put', collection: 'events', value: { ...item.calendarEvent!, kind: e.target.value as PlannerEvent['kind'] } })}>{(['event', 'course', 'exam', 'deadline'] as const).map((kind) => <option key={kind} value={kind}>{kindNames[kind]}</option>)}</select></label> : null}
            {item.workId ? <Link to={`/entry/${item.workId}`}>编辑工时</Link> : null}
            {item.courseId ? <><button onClick={() => { const rule = state.courseRules.find((r) => r.id === item.courseId)!; setEditor({ type: 'course', value: rule }); }}>整组</button><button onClick={() => { const rule = state.courseRules.find((r) => r.id === item.courseId)!; const value = expandCourse(rule, date, date).find((v) => v.id === item.originId); setEditor({ type: 'event', value, rule, date: item.courseDate }); }}>调整本次</button><button onClick={() => { const rule = state.courseRules.find((r) => r.id === item.courseId)!; setDeletion({ kind: 'put', collection: 'courseRules', value: { ...rule, exceptions: [...rule.exceptions.filter((e) => e.date !== item.courseDate), { date: item.courseDate, replacement: null }] } }); }}>取消本次</button></> : null}
          </div>
        </article>)}
      </section>)}</div>
    </section>
    <section className="panel planner-panel planner-spaced" aria-label="重要日期"><div className="planner-section-title"><h2><CalendarDays size={19} />重要日期</h2><span>最近三条优先</span></div><CountdownList items={getCountdowns(state, today, sources)} onEdit={(id) => setEditor({ type: 'countdown', value: state.countdowns.find((v) => v.id === id) })} onDelete={(id) => setDeletion({ kind: 'delete', collection: 'countdowns', id })} /></section>
    <CalendarStatus />
    <IcsImportPanel today={today} />
    {state.courseRules.length ? <details className="panel planner-panel planner-spaced"><summary>管理课程规则（{state.courseRules.length}条）</summary><ul className="planner-list">{state.courseRules.map((rule) => <li key={rule.id}><div><strong>{rule.title}</strong><p>第{rule.firstWeek}—{rule.lastWeek}周 · {rule.parity === 'all' ? '每周' : rule.parity === 'odd' ? '单周' : '双周'}</p></div><div className="planner-actions"><button className="button secondary compact" onClick={() => setEditor({ type: 'course', value: rule })}>编辑规则</button><button className="button secondary compact" onClick={() => setDeletion({ kind: 'delete', collection: 'courseRules', id: rule.id })}>删除整组</button></div></li>)}</ul></details> : null}
    {deletion ? <ConfirmDialog title="移除这项安排？" description="只修改生活日程，不会删除账本中的工时或支出。" confirmLabel="确认移除" onCancel={() => setDeletion(null)} onConfirm={async () => { await save(deletion); setDeletion(null); }} /> : null}
  </>;
}
