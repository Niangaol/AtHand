import { useState } from 'react';
import type { Trip } from '../../domain/planner';
import { changeTripDates, newTrip } from '../../domain/trips';

export function TripEditor({ trip, today, busy, cancel, save }: { trip?: Trip; today: string; busy: boolean; cancel: () => void; save: (value: Trip, expected: Trip | null) => Promise<{ ok: true } | { ok: false; message: string }> }) {
  const [original] = useState(trip ?? null);
  const [title, setTitle] = useState(trip?.title ?? '');
  const [start, setStart] = useState(trip?.startDate ?? today);
  const [end, setEnd] = useState(trip?.endDate ?? today);
  const [notes, setNotes] = useState(trip?.notes ?? '');
  const [error, setError] = useState('');
  return <form className="panel planner-panel planner-form planner-spaced" onSubmit={async (event) => {
    event.preventDefault();
    try {
      const value = trip ? changeTripDates(trip, start, end) : newTrip(crypto.randomUUID(), title, start, end);
      const result = await save({ ...value, title, notes }, original);
      if (!result.ok) setError(result.message);
    } catch (reason) { setError(reason instanceof Error && reason.name !== 'ZodError' ? reason.message : '请检查名称和日期，旅行最长366天。'); }
  }}><h2>{trip ? '编辑旅行' : '新建旅行'}</h2><label>旅行名称<input required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} /></label><div className="form-grid"><label>出发日期<input required type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label><label>结束日期<input required type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label></div><label>旅行备注<textarea maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>{error ? <p role="alert" className="form-error">{error}</p> : null}<div className="planner-actions"><button className="button primary" disabled={busy}>保存旅行</button><button type="button" className="button secondary" onClick={cancel}>取消</button></div></form>;
}
