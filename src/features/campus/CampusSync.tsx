import { useMemo, useState } from 'react';
import { CalendarPlus, CircleAlert } from 'lucide-react';
import { useCampus } from '../../data/CampusProvider';
import { usePlanner } from '../../data/PlannerProvider';
import { buildCampusExamEvents, buildCampusRules, previewCampus } from '../../domain/campusSync';

const CAMPUS_TIME_ZONE = 'Asia/Shanghai';

export function CampusSync() {
  const { status, summary } = useCampus();
  const { state, dispatch, busy } = usePlanner();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const courses = summary.courses;
  const exams = summary.exams;
  const calendar = summary.calendar;
  const timeZone = CAMPUS_TIME_ZONE;

  const built = useMemo(
    () => calendar ? buildCampusRules(courses, calendar, timeZone) : { rules: [], warnings: [] },
    [courses, calendar, timeZone],
  );
  const examBuilt = useMemo(() => buildCampusExamEvents(exams, timeZone), [exams, timeZone]);
  const preview = useMemo(
    () => previewCampus(state.courseRules, state.events, built.rules, examBuilt.events),
    [state.courseRules, state.events, built.rules, examBuilt.events],
  );

  if (!status?.connected) return null;
  if (!calendar?.startDate) return <section className="panel campus-sync" aria-label="课表同步">
    <h2><CalendarPlus size={20} />课表与考试</h2>
    <p className="form-hint">{summary.loading ? '正在读校历…' : '校历缺少开学日期，暂时无法生成学期课程规则。课表和考试仍可在校园页查看。'}</p>
  </section>;

  const courseWrites = [...preview.courses.create, ...preview.courses.update];
  const examWrites = [...preview.events.create, ...preview.events.update];
  const removed = preview.courses.removed.length + preview.events.removed.length;
  const warnings = [...new Set([...built.warnings, ...examBuilt.warnings])];

  async function apply() {
    setWorking(true);
    setMessage('');
    setError('');
    let written = 0;
    for (const rule of courseWrites) {
      const expected = state.courseRules.find((item) => item.id === rule.id) ?? null;
      const result = await dispatch({ kind: 'put', collection: 'courseRules', value: rule }, expected);
      if (!result.ok) { setError(`课程“${rule.title}”没有写入：${result.message}`); setWorking(false); return; }
      written += 1;
    }
    for (const event of examWrites) {
      const expected = state.events.find((item) => item.id === event.id) ?? null;
      const result = await dispatch({ kind: 'put', collection: 'events', value: event }, expected);
      if (!result.ok) { setError(`考试“${event.title}”没有写入：${result.message}`); setWorking(false); return; }
      written += 1;
    }
    setWorking(false);
    setMessage(`已写入 ${written} 条；未变的条目已跳过，已消失的条目不会自动删除。`);
  }

  return <section className="panel campus-sync" aria-label="课表同步">
    <h2><CalendarPlus size={20} />课表与考试</h2>
    <p className="form-hint">同步会生成课程规则和考试日程，日程页与倒计时会自动使用它们。只写入校园来源的条目，不动手动、ICS 和手机日历。</p>
    <dl className="campus-facts">
      <div><dt>课程</dt><dd>新增 {preview.courses.create.length} · 更新 {preview.courses.update.length} · 未变 {preview.courses.unchanged.length} · 已消失 {preview.courses.removed.length}</dd></div>
      <div><dt>考试</dt><dd>新增 {preview.events.create.length} · 更新 {preview.events.update.length} · 未变 {preview.events.unchanged.length} · 已消失 {preview.events.removed.length}</dd></div>
    </dl>
    {warnings.length ? <p className="form-hint"><CircleAlert size={15} />有 {warnings.length} 类字段没有用上：{warnings.join('、')}。缺时间的课程不会硬套作息表。</p> : null}
    {removed ? <p className="form-hint">有 {removed} 条校园条目已不在最新数据里。顺手不会自动删除，请到日程页确认后手动清理。</p> : null}
    <button className="button primary" disabled={busy || working || courseWrites.length + examWrites.length === 0} onClick={() => void apply()}>{working ? '正在写入' : `写入 ${courseWrites.length + examWrites.length} 条`}</button>
    {message ? <p className="form-hint" role="status">{message}</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </section>;
}
