import { useState } from 'react';
import type { Trip } from '../../domain/planner';
import { removeTripStay } from '../../domain/trips';

const blank = (start: string, end: string) => ({ id: '', name: '', address: '', checkIn: start, checkOut: end, ref: '' });

export function LodgingEditor({ trip, busy, save, remove, scheduled, onSchedule, addToSchedule }: {
  trip: Trip; busy: boolean; save: (value: Trip) => Promise<boolean>;
  remove: (value: Trip, description: string) => void;
  scheduled: Set<string>; onSchedule: (stayId: string) => void; addToSchedule: (stayId: string) => void;
}) {
  const [draft, setDraft] = useState(() => blank(trip.startDate, trip.endDate));
  const [editing, setEditing] = useState<{ id: string; value: Trip['lodging'][number] } | null>(null);
  const [error, setError] = useState('');
  async function submit(value: Trip['lodging'][number]) {
    if (!value.name.trim()) { setError('请填写住宿名称。'); return; }
    if (value.checkOut <= value.checkIn) { setError('退房日期应晚于入住日期，至少住一晚。'); return; }
    if (await save({ ...trip, lodging: trip.lodging.some((stay) => stay.id === value.id) ? trip.lodging.map((stay) => stay.id === value.id ? value : stay) : [...trip.lodging, value] })) {
      setEditing(null); setError(''); setDraft(blank(trip.startDate, trip.endDate));
    }
  }
  return <section className="trip-plan-block" aria-label="住宿">
    <h3>住哪里</h3>
    {!trip.lodging.length && !editing ? <p className="form-hint">还没订住宿。记下地址和入住日期，到了不用翻聊天记录。</p> : null}
    {trip.lodging.map((stay) => {
      if (editing?.id === stay.id) return <StayForm key={stay.id} value={editing.value} busy={busy} min={trip.startDate} max={trip.endDate} error={error} onChange={(value) => setEditing({ id: stay.id, value })} onSubmit={() => void submit(editing.value)} cancel={() => { setEditing(null); setError(''); }} submitLabel="保存住宿" />;
      const joined = scheduled.has(`stay:${stay.id}`);
      const invalid = stay.checkOut <= stay.checkIn;
      return <div className="trip-item" key={stay.id}>
        <div>
          <strong>{stay.name}</strong>
          <p>{stay.checkIn} 入住 · {stay.checkOut} 退房{stay.address ? ` · ${stay.address}` : ''}{stay.ref ? ` · ${stay.ref}` : ''}</p>
          {invalid ? <p className="form-error">旧记录同天入住退房，请编辑为至少一晚；修正前不会生成日程。</p> : null}
        </div>
        <div className="planner-actions">
          {trip.schedule && !invalid ? <button className="button secondary compact" disabled={busy} aria-label={`${joined ? '取消加入日程' : '加入日程'} 住宿 ${stay.name}`} onClick={() => onSchedule(stay.id)}>{joined ? '已加入 · 取消' : '加入日程'}</button> : null}
          {!trip.schedule && !invalid ? <button className="button secondary compact" disabled={busy} onClick={() => addToSchedule(stay.id)}>加入日程</button> : null}
          <button className="button secondary compact" aria-label={`编辑住宿 ${stay.name}`} disabled={busy} onClick={() => { setEditing({ id: stay.id, value: stay }); setError(''); }}>编辑</button>
          <button className="button secondary compact" aria-label={`删除住宿 ${stay.name}`} disabled={busy} onClick={() => remove(removeTripStay(trip, stay.id), joined ? '这段住宿已加入日程，删除后会一并移除对应日程。' : '删除这段住宿，只影响本次旅行。')}>删除</button>
        </div>
      </div>;
    })}
    {!editing ? <StayForm value={draft} busy={busy} min={trip.startDate} max={trip.endDate} error={error} onChange={(value) => { setDraft(value); setError(''); }} onSubmit={() => void submit({ ...draft, id: crypto.randomUUID() })} submitLabel="添加住宿" /> : null}
  </section>;
}

function StayForm({ value, busy, min, max, error, onChange, onSubmit, cancel, submitLabel }: {
  value: Trip['lodging'][number]; busy: boolean; min: string; max: string; error: string;
  onChange: (value: Trip['lodging'][number]) => void; onSubmit: () => void; cancel?: () => void; submitLabel: string;
}) {
  return <form className="trip-add trip-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <label>住宿名称<input required maxLength={100} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} /></label>
    <label>地址<input maxLength={200} value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} /></label>
    <label>入住日期<input type="date" required min={min} max={value.checkOut > min ? value.checkOut : max} value={value.checkIn} onChange={(e) => onChange({ ...value, checkIn: e.target.value })} /></label>
    <label>退房日期<input type="date" required min={value.checkIn} max={max} value={value.checkOut} onChange={(e) => onChange({ ...value, checkOut: e.target.value })} /></label>
    <label>订单备注<input maxLength={100} value={value.ref} onChange={(e) => onChange({ ...value, ref: e.target.value })} /></label>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <div className="planner-actions"><button className="button secondary" disabled={busy || !value.name.trim() || value.checkOut <= value.checkIn}>{submitLabel}</button>{cancel ? <button type="button" className="button secondary" onClick={cancel}>取消</button> : null}</div>
  </form>;
}
