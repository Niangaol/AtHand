import { useState } from 'react';
import type { Trip } from '../../domain/planner';
import { changeTripDates, newTrip, shiftTripDates, tripRangeProblems } from '../../domain/trips';

function preview(trip: Trip, start: string, end: string, shift: boolean): string {
  if (start > end) return '结束日期不能早于出发日期。';
  if (Date.parse(end) - Date.parse(start) >= 366 * 86400000) return '旅行最长 366 天。';
  try {
    if (shift) {
      shiftTripDates(trip, start, end);
      return `顺延后，全部攻略、交通、住宿和城市日期都会整体移动到 ${start} 起。保存前请确认。`;
    }
    const problems = tripRangeProblems(trip, start, end);
    return problems.length ? `这些安排会超出新范围，请先处理：${problems.join('；')}。` : '只调整旅行起止范围，原有日期保持不变。';
  } catch (reason) { return reason instanceof Error ? reason.message : '请检查日期。'; }
}

export function TripEditor({ trip, today, busy, cancel, save }: { trip?: Trip; today: string; busy: boolean; cancel: () => void; save: (value: Trip, expected: Trip | null) => Promise<{ ok: true } | { ok: false; message: string }> }) {
  const [original] = useState(trip ?? null);
  const [title, setTitle] = useState(trip?.title ?? '');
  const [start, setStart] = useState(trip?.startDate ?? today);
  const [end, setEnd] = useState(trip?.endDate ?? today);
  const [notes, setNotes] = useState(trip?.notes ?? '');
  const [shift, setShift] = useState(false);
  const [error, setError] = useState('');
  const hint = trip && (start !== trip.startDate || end !== trip.endDate) ? preview(trip, start, end, shift) : '';
  return <form className="panel planner-panel planner-form planner-spaced" onSubmit={async (event) => {
    event.preventDefault();
    if (start > end) { setError('结束日期不能早于出发日期。'); return; }
    try {
      const reranged = trip ? (shift ? shiftTripDates(trip, start, end) : changeTripDates(trip, start, end)) : newTrip(crypto.randomUUID(), title, start, end);
      const result = await save({ ...reranged, title, notes }, original);
      if (!result.ok) setError(result.message);
    } catch (reason) { setError(reason instanceof Error && reason.name !== 'ZodError' ? reason.message : '请检查名称和日期，旅行最长366天。'); }
  }}><h2>{trip ? '编辑旅行' : '新建旅行'}</h2><label>旅行名称<input required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} /></label><div className="form-grid"><label>出发日期<input required type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label><label>结束日期<input required type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label></div>
    {trip ? <label className="trip-shift"><input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} /><span>整体顺延：攻略、交通、住宿和城市日期一起移动</span></label> : null}
    {hint ? <p className="form-hint" role="status">{hint}</p> : null}
    <label>旅行备注<textarea maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>{error ? <p role="alert" className="form-error">{error}</p> : null}<div className="planner-actions"><button className="button primary" disabled={busy}>保存旅行</button><button type="button" className="button secondary" onClick={cancel}>取消</button></div></form>;
}
