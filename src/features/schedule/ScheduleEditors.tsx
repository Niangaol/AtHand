import { useState } from 'react';
import { useRecords } from '../../data/RecordsProvider';
import type { CourseRule, Countdown, PlannerEvent } from '../../domain/planner';
import { buildEvent, localTimeZone, zonedInput } from '../../domain/schedule';
import { getWeekRange, shiftDate } from '../../domain/dates';

type Save<T> = (value: T) => Promise<{ ok: boolean; message?: string }>;
export const kindNames = { course: '课程', shift: '排班', exam: '考试', deadline: '截止日期', event: '普通日程', focus: '专注' };
function errorText(error: unknown) { return error instanceof Error && error.name !== 'ZodError' ? error.message : '请检查日期、时间和必填内容。'; }

export function EventEditor({ event, today, save, cancel, busy }: { event?: PlannerEvent; today: string; save: Save<PlannerEvent>; cancel: () => void; busy: boolean }) {
  const { records } = useRecords();
  const work = records.filter((r) => r.type === 'work' && r.source !== 'demo');
  const [linkedWorkRecordId, setLinkedWorkRecordId] = useState(event?.linkedWorkRecordId ?? '');
  const zone = event?.timeZone ?? localTimeZone();
  const [title, setTitle] = useState(event?.title ?? '');
  const [kind, setKind] = useState<PlannerEvent['kind']>(event?.kind ?? 'event');
  const [location, setLocation] = useState(event?.location ?? '');
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [start, setStart] = useState(event ? zonedInput(event.start, zone) : `${today}T09:00`);
  const [end, setEnd] = useState(event ? zonedInput(event.allDay ? event.end - 1 : event.end, zone) : `${today}T10:00`);
  const [error, setError] = useState('');
  return <section className="panel planner-panel editor-panel"><h2>{event ? '修改日程' : '添加日程'}</h2><form className="planner-form" onSubmit={async (e) => {
    e.preventDefault();
    try {
      const value = buildEvent({ id: event?.id ?? crypto.randomUUID(), title, kind, location, start, end, allDay, timeZone: zone, linkedWorkRecordId: kind === 'shift' ? linkedWorkRecordId || undefined : undefined });
      const result = await save({ ...value, source: event?.source ?? 'manual', sourceId: event?.sourceId ?? '' });
      if (!result.ok) setError(result.message ?? '保存失败。');
    } catch (reason) { setError(errorText(reason)); }
  }}>
    <label>日程标题<input required maxLength={100} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label>日程类型<select value={kind} onChange={(e) => setKind(e.target.value as PlannerEvent['kind'])}>{Object.entries(kindNames).filter(([k]) => k !== 'focus').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label className="planner-check"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />全天（结束日包含当天）</label>
    <div className="planner-fields"><label>开始日期时间<input required type={allDay ? 'date' : 'datetime-local'} value={allDay ? start.slice(0, 10) : start} onChange={(e) => setStart(allDay ? `${e.target.value}T00:00` : e.target.value)} /></label><label>结束日期时间<input required type={allDay ? 'date' : 'datetime-local'} value={allDay ? end.slice(0, 10) : end} onChange={(e) => setEnd(allDay ? `${e.target.value}T00:00` : e.target.value)} /></label></div>
    <label>地点<input maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} /></label>
    {kind === 'shift' ? <label>关联已记工时<select value={linkedWorkRecordId} onChange={(e) => setLinkedWorkRecordId(e.target.value)}><option value="">尚未记工时（只安排时间）</option>{work.map((record) => <option key={record.id} value={record.id}>{record.date} · {record.title}</option>)}</select><span className="form-hint">关联后，时间表只展示实际工时，不重复显示这条排班。</span></label> : null}
    {kind === 'event' || kind === 'course' ? <p className="form-hint">保存后，可在日程或专注页一键开始计时；实际专注会替换这段计划显示。</p> : null}
    <p className="form-hint">时区：{zone}。排班只安排时间，不会自动增加兼职收入。</p>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <div className="planner-actions"><button className="button primary" disabled={busy}>保存日程</button><button type="button" className="button secondary" onClick={cancel}>取消</button></div>
  </form></section>;
}

export function CourseEditor({ rule, today, save, cancel, busy }: { rule?: CourseRule; today: string; save: Save<CourseRule>; cancel: () => void; busy: boolean }) {
  const [draft, setDraft] = useState<CourseRule>(() => rule ?? { id: crypto.randomUUID(), title: '', location: '', semesterStart: getWeekRange(today).start,
    weekday: 1, startTime: '09:00', endTime: '10:00', firstWeek: 1, lastWeek: 16, parity: 'all', timeZone: localTimeZone(), exceptions: [] });
  const [error, setError] = useState('');
  const change = <K extends keyof CourseRule>(key: K, value: CourseRule[K]) => setDraft((previous) => ({ ...previous, [key]: value }));
  return <section className="panel planner-panel editor-panel"><h2>{rule ? '修改课程规则' : '添加每周课程'}</h2><form className="planner-form" onSubmit={async (e) => {
    e.preventDefault(); const result = await save(draft); if (!result.ok) setError(result.message ?? '保存失败，请检查首周周一与时间。');
  }}>
    <label>课程名称<input required autoFocus maxLength={100} value={draft.title} onChange={(e) => change('title', e.target.value)} /></label>
    <div className="planner-fields"><label>学期首周周一<input required type="date" value={draft.semesterStart} onChange={(e) => change('semesterStart', e.target.value)} /></label><label>星期<select value={draft.weekday} onChange={(e) => change('weekday', Number(e.target.value))}>{['一', '二', '三', '四', '五', '六', '日'].map((day, i) => <option value={i + 1} key={day}>星期{day}</option>)}</select></label></div>
    <div className="planner-fields"><label>上课时间<input required type="time" value={draft.startTime} onChange={(e) => change('startTime', e.target.value)} /></label><label>下课时间<input required type="time" value={draft.endTime} onChange={(e) => change('endTime', e.target.value)} /></label></div>
    <div className="planner-fields"><label>开始周<input required type="number" min={1} max={60} value={draft.firstWeek} onChange={(e) => change('firstWeek', Number(e.target.value))} /></label><label>结束周<input required type="number" min={1} max={60} value={draft.lastWeek} onChange={(e) => change('lastWeek', Number(e.target.value))} /></label></div>
    <label>单双周<select value={draft.parity} onChange={(e) => change('parity', e.target.value as CourseRule['parity'])}><option value="all">每周</option><option value="odd">单周</option><option value="even">双周</option></select></label>
    <label>教室<input maxLength={200} value={draft.location} onChange={(e) => change('location', e.target.value)} /></label>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="planner-actions"><button className="button primary" disabled={busy}>保存课程规则</button><button type="button" className="button secondary" onClick={cancel}>取消</button></div>
  </form></section>;
}

export function CountdownEditor({ item, today, save, cancel, busy }: { item?: Countdown; today: string; save: Save<Countdown>; cancel: () => void; busy: boolean }) {
  const [draft, setDraft] = useState<Countdown>(() => item ?? { id: crypto.randomUUID(), title: '', kind: 'document', date: shiftDate(today, 1) });
  const [error, setError] = useState('');
  return <section className="panel planner-panel editor-panel"><h2>重要日子</h2><form className="planner-form" onSubmit={async (e) => {
    e.preventDefault(); const result = await save(draft); if (!result.ok) setError(result.message ?? '保存失败。');
  }}>
    <label>倒计时标题<input required autoFocus maxLength={100} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
    <label>倒计时类型<select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Countdown['kind'] })}><option value="document">证件办理时限</option><option value="birthday">生日</option></select></label>
    <label>日期<input required type="date" min="2000-01-01" max="2100-12-31" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
    <p className="form-hint">考试和截止日期请添加为日程，会自动出现在倒计时中。生日按下一次日期；2月29日遇非闰年按2月28日。</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="planner-actions"><button className="button primary" disabled={busy}>保存倒计时</button><button type="button" className="button secondary" onClick={cancel}>取消</button></div>
  </form></section>;
}
