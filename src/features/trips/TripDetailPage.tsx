import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePlanner } from '../../data/PlannerProvider';
import { useLocalToday } from '../../data/useLocalToday';
import type { Trip } from '../../domain/planner';
import { cities, copyPacking, moveTripItem, removeTripItem } from '../../domain/trips';
import { localTimeZone } from '../../domain/schedule';
import { PageHeading } from '../../components/PageHeading';
import { PlannerStatus } from '../../components/PlannerStatus';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TripEditor } from './TripEditor';
import { TripPlanPanel } from './TripPlanPanel';
import { TravelTools } from './TravelTools';
import './trips.css';

type Save = (value: Trip) => Promise<boolean>;
type Remove = (value: Trip, description: string) => void;
type DayItem = Trip['days'][number]['items'][number];

function DayItemForm({ value, busy, onSubmit, cancel, submitLabel }: {
  value?: DayItem; busy: boolean;
  onSubmit: (item: DayItem & { startTime: string; endTime: string; location: string }) => void; cancel?: () => void; submitLabel: string;
}) {
  const [text, setText] = useState(value?.text ?? '');
  const [startTime, setStartTime] = useState(value?.startTime ?? '');
  const [endTime, setEndTime] = useState(value?.endTime ?? '');
  const [location, setLocation] = useState(value?.location ?? '');
  const [error, setError] = useState('');
  return <form className="trip-add trip-form" onSubmit={(event) => {
    event.preventDefault();
    if (Boolean(startTime) !== Boolean(endTime)) { setError('时间请一起填写，或都留空表示待定。'); return; }
    if (startTime && endTime <= startTime) { setError('结束时间应晚于开始时间；跨夜活动请拆到两天。'); return; }
    onSubmit({ id: value?.id ?? crypto.randomUUID(), text: text.trim(), startTime, endTime, location: location.trim() });
  }}>
    <label>做什么<textarea required maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="地点、交通、门票或自己的提醒" /></label>
    <div className="form-grid"><label>开始（选填）<input type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); setError(''); }} /></label><label>结束（选填）<input type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); setError(''); }} /></label></div>
    <label>地点（选填）<input maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} /></label>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <div className="planner-actions"><button className="button secondary" disabled={busy || !text.trim()}>{submitLabel}</button>{cancel ? <button type="button" className="button secondary" onClick={cancel}>取消</button> : null}</div>
  </form>;
}

type Selection = { legs: string[]; stays: string[]; items: string[] };
const trimSelection = (value: Selection): Selection => ({ legs: [...new Set(value.legs)], stays: [...new Set(value.stays)], items: [...new Set(value.items)] });

function DayPanel({ trip, date, busy, save, remove, existing, onJoin }: { trip: Trip; date: string; busy: boolean; save: Save; remove: Remove; existing: Set<string>; onJoin: (id: string) => void }) {
  const day = trip.days.find((v) => v.date === date);
  const [editing, setEditing] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [target, setTarget] = useState(date);
  if (!day) return null;
  const withItems = (items: DayItem[]): Trip => ({ ...trip, days: trip.days.map((v) => v.date === date ? { ...v, items } : v) });
  async function move(index: number, delta: number) {
    const items = [...day!.items];
    [items[index], items[index + delta]] = [items[index + delta], items[index]];
    await save(withItems(items));
  }
  function toggleJoin(id: string) { onJoin(id); }
  const legs = trip.transport.filter((leg) => leg.date === date || leg.arriveDate === date);
  const stays = trip.lodging.filter((stay) => stay.checkIn === date || (stay.checkOut === date && stay.checkOut > stay.checkIn));
  return <section className="panel planner-panel trip-day" aria-label={`${date}行程`}>
    <h2>{date}</h2>
    {legs.length || stays.length ? <div className="trip-day-fixed">
      {legs.map((leg) => <p key={leg.id}><strong>{leg.from} → {leg.to}</strong>{leg.departTime && leg.arriveTime ? ` · ${leg.departTime} 出发 · ${leg.arriveDate && leg.arriveDate !== leg.date ? `${leg.arriveDate} ` : ''}${leg.arriveTime} 抵达` : ' · 时间待定'}{leg.ref ? ` · ${leg.ref}` : ''}<span className="subtle-tag">交通</span></p>)}
      {stays.map((stay) => <p key={stay.id}><strong>{stay.name}</strong>{stay.checkIn === date ? ' · 入住' : ' · 退房'}{stay.address ? ` · ${stay.address}` : ''}<span className="subtle-tag">住宿</span></p>)}
    </div> : null}
    {!day.items.length ? <p className="form-hint">这一天还没有攻略。</p> : day.items.map((item, index) => <div className="trip-item" key={item.id}>
      {editing === item.id
        ? <DayItemForm value={item} busy={busy} submitLabel="保存攻略" cancel={() => setEditing(null)} onSubmit={async (value) => { if (await save(withItems(day.items.map((v) => v.id === item.id ? value : v)))) setEditing(null); }} />
        : <div className="trip-entry">
          <div className="trip-entry-head"><strong>{item.startTime && item.endTime ? `${item.startTime} — ${item.endTime}` : '时间待定'}</strong>{item.location ? <span>{item.location}</span> : null}{existing.has(item.id) ? <span className="subtle-tag">已加入日程</span> : null}</div>
          <p>{item.text}</p>
          <div className="planner-actions">
            <button className="button secondary compact" aria-label={`上移 ${item.text}`} disabled={busy || index === 0} onClick={() => void move(index, -1)}>上移</button>
            <button className="button secondary compact" aria-label={`下移 ${item.text}`} disabled={busy || index === day.items.length - 1} onClick={() => void move(index, 1)}>下移</button>
            <button className="button secondary compact" disabled={busy} onClick={() => toggleJoin(item.id)}>{existing.has(item.id) ? '取消日程' : '加入日程'}</button>
            <button className="button secondary compact" aria-label={`移到其他日期 ${item.text}`} disabled={busy || trip.days.length < 2} onClick={() => { setMoving(item.id); setTarget(trip.days.find((v) => v.date !== date)?.date ?? date); }}>移日期</button>
            <button className="button secondary compact" disabled={busy} aria-label={`编辑攻略 ${item.text}`} onClick={() => setEditing(item.id)}>编辑</button>
            <button className="button secondary compact" aria-label={`删除攻略 ${item.text}`} disabled={busy} onClick={() => remove(removeTripItem(trip, item.id), existing.has(item.id) ? '这条攻略已加入日程，删除后会一并移除对应日程。' : '删除这条攻略后不能自动恢复。')}>删除</button>
          </div>
        </div>}
      {moving === item.id ? <form className="trip-add" onSubmit={async (event) => {
        event.preventDefault();
        try { if (await save(moveTripItem(trip, date, item.id, target))) setMoving(null); } catch { setMoving(null); }
      }}><label>移动到<input type="date" min={trip.startDate} max={trip.endDate} value={target} onChange={(e) => setTarget(e.target.value)} /></label><button className="button secondary compact" disabled={busy || target === date || !trip.days.some((v) => v.date === target)}>确认移动</button><button type="button" className="button secondary compact" onClick={() => setMoving(null)}>取消</button></form> : null}
    </div>)}
    {editing === null ? <DayItemForm busy={busy} submitLabel="添加攻略" onSubmit={async (value) => { if (await save(withItems([...day.items, value]))) setEditing(null); }} /> : null}
  </section>;
}

function PackingPanel({ trip, allTrips, busy, save, remove }: { trip: Trip; allTrips: Trip[]; busy: boolean; save: Save; remove: Remove }) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const others = allTrips.filter((v) => v.id !== trip.id && v.packing.length).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const [source, setSource] = useState('');
  return <section className="panel planner-panel planner-spaced" aria-label="行李清单"><h2>出门前，逐个确认</h2><p>{trip.packing.filter((v) => v.checked).length}/{trip.packing.length} 已准备</p>{trip.packingSource ? <p>复制自：{trip.packingSource}</p> : null}
    {trip.packing.map((item) => <div className="trip-item" key={item.id}>{editing?.id === item.id
      ? <form className="trip-add" onSubmit={async (event) => { event.preventDefault(); if (await save({ ...trip, packing: trip.packing.map((v) => v.id === item.id ? { ...v, text: editing.text.trim() } : v) })) setEditing(null); }}><label>修改行李<input required maxLength={2000} value={editing.text} onChange={(e) => setEditing({ id: item.id, text: e.target.value })} /></label><button className="button secondary compact" disabled={busy || !editing.text.trim()}>保存</button><button type="button" className="button secondary compact" onClick={() => setEditing(null)}>取消</button></form>
      : <><label><input type="checkbox" checked={item.checked} disabled={busy} onChange={(e) => void save({ ...trip, packing: trip.packing.map((v) => v.id === item.id ? { ...v, checked: e.target.checked } : v) })} /><span>{item.text}</span></label><div className="planner-actions"><button className="button secondary compact" disabled={busy} aria-label={`编辑行李 ${item.text}`} onClick={() => setEditing({ id: item.id, text: item.text })}>编辑</button><button className="button secondary compact" aria-label={`删除行李 ${item.text}`} disabled={busy} onClick={() => remove({ ...trip, packing: trip.packing.filter((v) => v.id !== item.id) }, '删除这件行李，只影响本次旅行。')}>删除</button></div></>}
    </div>)}
    <form className="trip-add" onSubmit={async (event) => { event.preventDefault(); if (await save({ ...trip, packing: [...trip.packing, { id: crypto.randomUUID(), text: text.trim(), checked: false }] })) setText(''); }}><label>行李物品<input required maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} /></label><button className="button secondary" disabled={busy || !text.trim()}>添加行李</button></form>
    {others.length ? <div className="trip-add"><label>清单来源<select value={source} onChange={(e) => setSource(e.target.value)}><option value="">选择一趟旅行</option>{others.map((v) => <option value={v.id} key={v.id}>{v.title}</option>)}</select></label><button className="button secondary" disabled={busy || !others.some((v) => v.id === source)} onClick={() => { const original = others.find((v) => v.id === source)!; const next = { ...trip, packing: copyPacking(original.packing), packingSource: original.title }; if (trip.packing.length) remove(next, '将替换本次行李清单，勾选全部重置；原旅行不受影响。'); else void save(next); }}>复制这份行李清单</button></div> : <p className="form-hint">其他旅行有清单后，可复制过来；两份勾选互不影响。</p>}
  </section>;
}

function VisitsPanel({ trip, today, busy, save, remove }: { trip: Trip; today: string; busy: boolean; save: Save; remove: Remove }) {
  const [cityId, setCityId] = useState(cities[0].id);
  const [name, setName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [date, setDate] = useState(trip.startDate);
  const [visited, setVisited] = useState(false);
  return <section className="panel planner-panel planner-spaced" aria-label="本次城市记录"><h2>这一路，经过哪里</h2><p className="form-hint">同一城市的不同到访分别记录；计划城市不会计入足迹。</p>
    {trip.visits.map((v) => <div className="trip-item" key={v.id}><p>{v.city} · {v.date} · {v.visited ? '已到访' : '计划中'}</p><div className="planner-actions"><button className="button secondary compact" disabled={busy || !v.visited && v.date > today} onClick={() => void save({ ...trip, visits: trip.visits.map((item) => item.id === v.id ? { ...item, visited: !item.visited } : item) })}>{v.visited ? '改为计划' : '确认已到访'}</button><button className="button secondary compact" aria-label={`删除城市记录 ${v.city} ${v.date}`} disabled={busy} onClick={() => remove({ ...trip, visits: trip.visits.filter((item) => item.id !== v.id) }, '移除本次到访后，地图次数会重新计算。')}>删除</button></div></div>)}
    <form className="planner-form planner-spaced" onSubmit={async (event) => {
      event.preventDefault();
      const selected = cities.find((v) => v.id === cityId);
      const lat = selected?.latitude ?? Number(latitude); const lon = selected?.longitude ?? Number(longitude);
      const city = selected?.name ?? name.trim();
      const id = selected?.id ?? `custom:${lat.toFixed(4)}:${lon.toFixed(4)}`;
      if (await save({ ...trip, visits: [...trip.visits, { id: crypto.randomUUID(), cityId: id, city, latitude: lat, longitude: lon, date, visited }] })) setVisited(false);
    }}><div className="form-grid"><label>选择城市<select value={cityId} onChange={(e) => setCityId(e.target.value)}>{cities.map((v) => <option value={v.id} key={v.id}>{v.name}</option>)}<option value="custom">其他城市（手填坐标）</option></select></label><label>到访日期<input type="date" required min={trip.startDate} max={visited && today < trip.endDate ? today : trip.endDate} value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
      {cityId === 'custom' ? <><label>城市名称（含地区）<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label><div className="form-grid"><label>纬度<input type="number" required min={-90} max={90} step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} /></label><label>经度<input type="number" required min={-180} max={180} step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} /></label></div><p className="form-hint">城市身份按中心经纬度区分，复访请使用相同坐标；不同地区同名城市不会合并。</p></> : null}
      <label><input type="checkbox" checked={visited} onChange={(e) => setVisited(e.target.checked)} />确认已到访</label><button className="button secondary" disabled={busy}>保存城市记录</button>
    </form>
  </section>;
}

export function TripDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, dispatch, busy, blocked } = usePlanner();
  const today = useLocalToday();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ value: Trip | null; expected: Trip; description: string } | null>(null);
  const [adoption, setAdoption] = useState<Selection | null>(null);
  const trip = state.trips.find((v) => v.id === id);
  const fallback = trip && today >= trip.startDate && today <= trip.endDate ? today : trip?.startDate ?? '';
  const current = day && trip?.days.some((value) => value.date === day) ? day : fallback;
  useEffect(() => { setDay(null); }, [id]);
  if (!trip) return <section className="panel planner-panel"><h1>旅行不存在或已删除</h1><Link to="/trips">返回旅记</Link></section>;
  const save: Save = async (value) => { const result = await dispatch({ kind: 'put', collection: 'trips', value }, trip); setNotice(result.ok ? '已保存旅行。' : result.message); return result.ok; };
  const remove: Remove = (value, description) => setConfirmation({ value, expected: trip, description });
  const linked = state.events.filter((event) => event.source === 'trip' && event.sourceId === trip.id).length;
  const pending: Selection = {
    legs: [...trip.transport.filter((leg) => state.events.some((event) => event.id === `trip:${trip.id}:leg:${leg.id}`)).map((leg) => leg.id), ...(trip.schedule?.legs ?? [])],
    stays: [...trip.lodging.filter((stay) => state.events.some((event) => event.id === `trip:${trip.id}:stay:${stay.id}`)).map((stay) => stay.id), ...(trip.schedule?.stays ?? [])],
    items: [...trip.days.flatMap((day) => day.items.filter((item) => state.events.some((event) => event.id === `trip:${trip.id}:item:${item.id}`)).map((item) => item.id)), ...(trip.schedule?.items ?? [])],
  };
  const joined = new Set<string>([...pending.legs.map((id) => `leg:${id}`), ...pending.stays.map((id) => `stay:${id}`), ...pending.items]);
  const apply = async (value: Selection) => {
    const next = trimSelection(value);
    await save({ ...trip, schedule: { timeZone: trip.schedule?.timeZone ?? localTimeZone(), ...next } });
  };
  const choose = async (value: Selection, wasLegacy: boolean) => {
    if (wasLegacy && linked > 0 && JSON.stringify(trimSelection(value)) !== JSON.stringify(trimSelection(pending))) { setAdoption(value); return; }
    await apply(value);
  };
  const toggle = (kind: keyof Selection, id: string) => {
    const current = pending[kind];
    const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    void choose({ ...pending, [kind]: next }, !trip.schedule);
  };
  const adoptAll = () => void choose({
    legs: [...pending.legs, ...trip.transport.map((leg) => leg.id)],
    stays: [...pending.stays, ...trip.lodging.map((stay) => stay.id)],
    items: [...pending.items, ...trip.days.flatMap((day) => day.items.map((item) => item.id))],
  }, !trip.schedule);
  return <><Link className="text-link" to="/trips">返回旅记</Link><PageHeading title={trip.title} description={`${trip.startDate} — ${trip.endDate}`} /><PlannerStatus />{notice ? <p role="status">{notice}</p> : null}
    {editing ? <TripEditor trip={trip} today={today} busy={busy} cancel={() => setEditing(false)} save={async (value, expected) => { const result = await dispatch({ kind: 'put', collection: 'trips', value }, expected); if (result.ok) setEditing(false); return result; }} /> : <div className="planner-actions"><button className="button secondary" disabled={busy || blocked} onClick={() => setEditing(true)}>编辑旅行</button><button className="button secondary" disabled={busy || blocked} onClick={() => setConfirmation({ value: null, expected: trip, description: `攻略、行李与本次城市记录一并删除${linked ? `，同步移除 ${linked} 条旅记日程` : ''}；其他旅行不受影响。` })}>删除旅行</button></div>}
    <TripPlanPanel trip={trip} today={today} busy={busy || blocked} save={save} remove={remove} joined={new Set([...pending.legs.map((id) => `leg:${id}`), ...pending.stays.map((id) => `stay:${id}`), ...pending.items])} onJoin={(kind, id) => toggle(kind, id)} onAdoptAll={adoptAll} />
    <TravelTools legs={trip.transport} city={trip.visits[0]?.city ?? trip.title} today={today} />
    {adoption ? <ConfirmDialog title="接管并调整这些日程？" description={`这趟旅行已有 ${linked} 条旧日程，会自动保留已加入的条目。确认后按当前选择重建；旧的旅记日程会被替换，其他来源的日程不受影响。`} confirmLabel="确认接管" onCancel={() => setAdoption(null)} onConfirm={async () => {
      const value = adoption; setAdoption(null); await apply(value);
    }} /> : null}
    <nav className="trip-day-tabs" aria-label="选择旅行日期">{trip.days.map((value) => <button key={value.date} className={`button secondary compact${value.date === current ? ' is-selected' : ''}`} aria-pressed={value.date === current} onClick={() => setDay(value.date)}>{value.date.slice(5)}<small>{value.items.length ? `${value.items.length} 条` : '空'}</small></button>)}</nav>
    <DayPanel key={current} trip={trip} date={current} busy={busy || blocked} save={save} remove={remove} existing={joined} onJoin={(id) => toggle('items', id)} />
    {trip.notes ? <section className="panel planner-panel planner-spaced"><h2>给这趟旅行的备注</h2><p className="service-text">{trip.notes}</p></section> : null}
    <PackingPanel trip={trip} allTrips={state.trips} busy={busy || blocked} save={save} remove={remove} />
    <VisitsPanel key={`${trip.id}:${trip.startDate}:${trip.endDate}`} trip={trip} today={today} busy={busy || blocked} save={save} remove={remove} />
    {confirmation ? <ConfirmDialog title={confirmation.value ? '确认修改这份旅行内容？' : '删除这趟旅行？'} description={confirmation.description} confirmLabel={confirmation.value ? '确认修改' : '确认删除'} onCancel={() => setConfirmation(null)} onConfirm={async () => { if (confirmation.value) { const result = await dispatch({ kind: 'put', collection: 'trips', value: confirmation.value }, confirmation.expected); setNotice(result.ok ? '已保存旅行。' : result.message); setConfirmation(null); } else { const result = await dispatch({ kind: 'delete', collection: 'trips', id: trip.id }, confirmation.expected); if (result.ok) navigate('/trips'); else { setNotice(result.message); setConfirmation(null); } } }} /> : null}
  </>;
}
