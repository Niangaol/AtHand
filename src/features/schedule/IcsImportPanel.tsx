import { useState } from 'react';
import { usePlanner } from '../../data/PlannerProvider';
import { shiftDate } from '../../domain/dates';
import { localTimeZone } from '../../domain/schedule';
import type { IcsPreview } from './icsImport';

export function IcsImportPanel({ today }: { today: string }) {
  const { state, dispatch, busy, blocked } = usePlanner();
  const [source, setSource] = useState('学校课表');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(shiftDate(today, 180));
  const [preview, setPreview] = useState<IcsPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const deleted = preview?.complete ? state.events.filter((e) => e.source === 'ics' && e.sourceId === preview.sourceId && e.start < preview.to && e.end > preview.from && !preview.events.some((n) => n.id === e.id)).length : 0;
  return <details className="panel planner-panel planner-spaced"><summary>从ICS文件导入</summary>
    <p className="form-hint">同一课表请保持来源名称一致。先预览再导入；有解析警告时只合并成功项，不删除旧数据。不会读取文件里的附件或远程链接。</p>
    <div className="planner-form"><label>日历来源名称<input maxLength={100} value={source} onChange={(e) => { setSource(e.target.value); setPreview(null); }} /></label>
      <div className="planner-fields"><label>导入起始日<input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} /></label><label>导入截止日<input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }} /></label></div>
      <label>ICS文件<input type="file" accept=".ics,text/calendar" disabled={loading || busy || blocked} onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        setPreview(null); setMessage(''); setLoading(true);
        try {
          if (file.size > 1_000_000) throw new Error('ICS文件不能超过1MB。');
          const { parseIcs } = await import('./icsImport');
          setPreview(await parseIcs(await file.text(), source, from, to, localTimeZone()));
        } catch (reason) { setMessage(reason instanceof Error && reason.name !== 'ZodError' ? reason.message : '日期或文件格式无效。'); }
        finally { setLoading(false); }
      }} /></label>
    </div>
    {loading ? <p role="status">正在解析ICS文件…</p> : null}
    {message ? <p role="status" className="inline-notice">{message}</p> : null}
    {preview ? <section aria-label="ICS导入预览" className="planner-spaced">
      <h3>导入预览：{preview.events.length}条，移除本来源范围内{deleted}条旧日程</h3>
      {preview.warnings.map((warning, i) => <p className="form-error" key={i}>{warning}</p>)}
      <ul className="planner-list">{preview.events.slice(0, 30).map((e) => <li key={e.id}><strong>{e.title}</strong><span>{new Date(e.start).toLocaleString('zh-CN')}{e.allDay ? ' · 全天' : ''}</span></li>)}</ul>
      {preview.events.length > 30 ? <p>预览仅显示前30条，确认后导入全部{preview.events.length}条。</p> : null}
      <div className="planner-actions"><button className="button primary" disabled={busy || blocked} onClick={async () => {
        const result = await dispatch({ kind: 'events.import', sourceId: preview.sourceId, from: preview.from, to: preview.to, complete: preview.complete, events: preview.events });
        if (result.ok) { setMessage(`已导入或更新${preview.events.length}条日程。`); setPreview(null); }
        else setMessage(result.message);
      }}>确认导入ICS</button><button className="button secondary" onClick={() => setPreview(null)}>取消导入</button></div>
    </section> : null}
  </details>;
}
