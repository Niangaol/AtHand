import { useState } from 'react';
import type { Trip } from '../../domain/planner';
import { removeTripLeg } from '../../domain/trips';

function blank(date: string) {
  return { id: '', mode: 'train' as Trip['transport'][number]['mode'], from: '', to: '', date, departTime: '', arriveTime: '', ref: '', arriveDate: date };
}

function legError(draft: Trip['transport'][number]): string {
  if (!draft.from.trim() || !draft.to.trim()) return '请填写出发地和目的地。';
  const timed = Boolean(draft.departTime || draft.arriveTime);
  if (timed && (!draft.departTime || !draft.arriveTime)) return '时间和日期请一起填写，或都留空表示时间待定。';
  if (timed && (draft.arriveDate < draft.date || (draft.arriveDate === draft.date && draft.arriveTime <= draft.departTime))) return '抵达时间应晚于出发时间；跨夜请把抵达日期改为次日。';
  return '';
}

const modes = [
  { value: 'train', label: '火车' },
  { value: 'flight', label: '飞机' },
  { value: 'bus', label: '大巴' },
  { value: 'car', label: '自驾' },
  { value: 'other', label: '其他' },
] as const;
const modeLabel = (value: string) => modes.find((mode) => mode.value === value)?.label ?? '交通';

export function TransportEditor({ trip, busy, save, remove, scheduled, onSchedule, addToSchedule }: {
  trip: Trip; busy: boolean; save: (value: Trip) => Promise<boolean>;
  remove: (value: Trip, description: string) => void;
  scheduled: Set<string>; onSchedule: (legId: string) => void; addToSchedule: (legId: string) => void;
}) {
  const [draft, setDraft] = useState(() => blank(trip.startDate));
  const [editing, setEditing] = useState<{ id: string; value: Trip['transport'][number] } | null>(null);
  const [error, setError] = useState('');
  const amend = (value: Trip['transport'][number]) => setEditing({ id: value.id, value });
  async function submit(value: Trip['transport'][number]) {
    const problem = legError(value);
    if (problem) { setError(problem); return; }
    if (await save({ ...trip, transport: trip.transport.some((leg) => leg.id === value.id) ? trip.transport.map((leg) => leg.id === value.id ? value : leg) : [...trip.transport, value] })) {
      setEditing(null); setError(''); if (!trip.transport.some((leg) => leg.id === value.id)) setDraft(blank(trip.startDate));
    }
  }
  return <section className="trip-plan-block" aria-label="交通">
    <h3>怎么去，怎么回</h3>
    {!trip.transport.length && !editing ? <p className="form-hint">还没安排交通。加上车次或航班，出发前就不会漏。</p> : null}
    {trip.transport.map((leg) => {
      const id = leg.id;
      if (editing?.id === id) return <TransportForm key={id} value={editing.value} busy={busy} min={trip.startDate} max={trip.endDate} error={error} onChange={amend} onSubmit={() => void submit(editing.value)} cancel={() => { setEditing(null); setError(''); }} submitLabel="保存交通" />;
      const eventKey = `leg:${leg.id}`;
      const joined = scheduled.has(eventKey);
      return <div className="trip-item" key={id}>
        <div>
          <strong>{leg.from} → {leg.to}</strong>
          <p>{leg.date}{leg.arriveDate && leg.arriveDate !== leg.date ? ` → ${leg.arriveDate}` : ''}{leg.departTime && leg.arriveTime ? ` · ${leg.departTime} — ${leg.arriveTime}` : ' · 时间待定'} · {modeLabel(leg.mode)}{leg.ref ? ` · ${leg.ref}` : ''}</p>
        </div>
        <div className="planner-actions">
          {trip.schedule ? <button className="button secondary compact" disabled={busy} aria-label={`${joined ? '取消加入日程' : '加入日程'} ${leg.from} 到 ${leg.to}`} onClick={() => onSchedule(leg.id)}>{joined ? '已加入 · 取消' : '加入日程'}</button> : <button className="button secondary compact" disabled={busy} onClick={() => addToSchedule(leg.id)}>加入日程</button>}
          <button className="button secondary compact" disabled={busy} aria-label={`编辑交通 ${leg.from} 到 ${leg.to}`} onClick={() => { amend(leg); setError(''); }}>编辑</button>
          <button className="button secondary compact" aria-label={`删除交通 ${leg.from} 到 ${leg.to}`} disabled={busy} onClick={() => remove(removeTripLeg(trip, leg.id), joined ? '这段交通已加入日程，删除后会一并移除对应日程。' : '删除这段交通，只影响本次旅行。')}>删除</button>
        </div>
      </div>;
    })}
    {!editing ? <TransportForm value={draft} busy={busy} min={trip.startDate} max={trip.endDate} error={error} onChange={(value) => { setDraft(value); setError(''); }} onSubmit={() => void submit({ ...draft, id: crypto.randomUUID() })} submitLabel="添加交通" /> : null}
  </section>;
}

function TransportForm({ value, busy, min, max, error, onChange, onSubmit, cancel, submitLabel }: {
  value: Trip['transport'][number]; busy: boolean; min: string; max: string; error: string;
  onChange: (value: Trip['transport'][number]) => void; onSubmit: () => void; cancel?: () => void; submitLabel: string;
}) {
  return <form className="trip-add trip-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <label>交通方式<select value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as typeof value.mode })}>{modes.map((mode) => <option value={mode.value} key={mode.value}>{mode.label}</option>)}</select></label>
    <label>从哪里出发<input required maxLength={100} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} /></label>
    <label>到哪里<input required maxLength={100} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} /></label>
    <label>出发日期<input type="date" required min={min} max={max} value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value, arriveDate: value.arriveDate && value.arriveDate >= e.target.value ? value.arriveDate : e.target.value })} /></label>
    <label>抵达日期<input type="date" min={value.date} max={max} value={value.arriveDate || value.date} onChange={(e) => onChange({ ...value, arriveDate: e.target.value })} /></label>
    <label>出发时间<input type="time" value={value.departTime} onChange={(e) => onChange({ ...value, departTime: e.target.value })} /></label>
    <label>到达时间<input type="time" value={value.arriveTime} onChange={(e) => onChange({ ...value, arriveTime: e.target.value })} /></label>
    <label>车次 / 航班号<input maxLength={100} value={value.ref} onChange={(e) => onChange({ ...value, ref: e.target.value })} /></label>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <div className="planner-actions"><button className="button secondary" disabled={busy || !value.from.trim() || !value.to.trim()}>{submitLabel}</button>{cancel ? <button type="button" className="button secondary" onClick={cancel}>取消</button> : null}</div>
  </form>;
}
