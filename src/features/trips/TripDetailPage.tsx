import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePlanner } from '../../data/PlannerProvider';
import { useLocalToday } from '../../data/useLocalToday';
import type { Trip } from '../../domain/planner';
import { cities, copyPacking } from '../../domain/trips';
import { PageHeading } from '../../components/PageHeading';
import { PlannerStatus } from '../../components/PlannerStatus';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TripEditor } from './TripEditor';
import './trips.css';

type Save = (value: Trip) => Promise<boolean>;
type Remove = (value: Trip, description: string) => void;

function ItemText({ text, busy, save, showText = true }: { text: string; busy: boolean; save: (text: string) => Promise<boolean>; showText?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [saveEdit, setSaveEdit] = useState(() => save);
  return editing ? <form className="trip-add" onSubmit={async (event) => { event.preventDefault(); if (await saveEdit(draft.trim())) setEditing(false); }}><label>修改条目<textarea required maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} /></label><button className="button secondary compact" disabled={busy}>保存条目</button><button type="button" className="button secondary compact" onClick={() => setEditing(false)}>取消编辑</button></form> : <>{showText ? <p>{text}</p> : null}<button className="button secondary compact" disabled={busy} aria-label={`编辑条目 ${text}`} onClick={() => { setDraft(text); setSaveEdit(() => save); setEditing(true); }}>编辑</button></>;
}

function DayPanel({ trip, date, busy, save, remove }: { trip: Trip; date: string; busy: boolean; save: Save; remove: Remove }) {
  const [text, setText] = useState('');
  const day = trip.days.find((v) => v.date === date)!;
  const withItems = (items: typeof day.items): Trip => ({ ...trip, days: trip.days.map((v) => v.date === date ? { ...v, items } : v) });
  async function move(index: number, delta: number) {
    const items = [...day.items];
    [items[index], items[index + delta]] = [items[index + delta], items[index]];
    await save(withItems(items));
  }
  return <section className="panel planner-panel trip-day" aria-label={`${date}行程`}><h2>{date}</h2>{!day.items.length ? <p className="form-hint">这一天还没有攻略。</p> : day.items.map((item, index) => <div className="trip-item" key={item.id}><ItemText text={item.text} busy={busy} save={(text) => save(withItems(day.items.map((v) => v.id === item.id ? { ...v, text } : v)))} /><div className="planner-actions"><button className="button secondary compact" aria-label={`上移 ${item.text}`} disabled={busy || index === 0} onClick={() => void move(index, -1)}>上移</button><button className="button secondary compact" aria-label={`下移 ${item.text}`} disabled={busy || index === day.items.length - 1} onClick={() => void move(index, 1)}>下移</button><button className="button secondary compact" aria-label={`删除攻略 ${item.text}`} disabled={busy} onClick={() => remove(withItems(day.items.filter((v) => v.id !== item.id)), '删除这条攻略后不能自动恢复。')}>删除</button></div></div>)}
    <form className="trip-add" onSubmit={async (event) => { event.preventDefault(); if (await save(withItems([...day.items, { id: crypto.randomUUID(), text: text.trim() }]))) setText(''); }}><label>{date}攻略<textarea required maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="地点、交通、门票或自己的提醒" /></label><button className="button secondary" disabled={busy || !text.trim()} aria-label={`添加${date}攻略`}>添加攻略</button></form>
  </section>;
}

function PackingPanel({ trip, allTrips, busy, save, remove }: { trip: Trip; allTrips: Trip[]; busy: boolean; save: Save; remove: Remove }) {
  const [text, setText] = useState('');
  const others = allTrips.filter((v) => v.id !== trip.id && v.packing.length).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const [source, setSource] = useState('');
  return <section className="panel planner-panel planner-spaced" aria-label="行李清单"><h2>出门前，逐个确认</h2><p>{trip.packing.filter((v) => v.checked).length}/{trip.packing.length} 已准备</p>{trip.packingSource ? <p>复制自：{trip.packingSource}</p> : null}
    {trip.packing.map((item) => <div className="trip-item" key={item.id}><label><input type="checkbox" checked={item.checked} disabled={busy} onChange={(e) => void save({ ...trip, packing: trip.packing.map((v) => v.id === item.id ? { ...v, checked: e.target.checked } : v) })} /><span>{item.text}</span></label><ItemText text={item.text} showText={false} busy={busy} save={(text) => save({ ...trip, packing: trip.packing.map((v) => v.id === item.id ? { ...v, text } : v) })} /><button className="button secondary compact" aria-label={`删除行李 ${item.text}`} disabled={busy} onClick={() => remove({ ...trip, packing: trip.packing.filter((v) => v.id !== item.id) }, '删除这件行李，只影响本次旅行。')}>删除</button></div>)}
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
  const [confirmation, setConfirmation] = useState<{ value: Trip | null; expected: Trip; description: string } | null>(null);
  const trip = state.trips.find((v) => v.id === id);
  if (!trip) return <section className="panel planner-panel"><h1>旅行不存在或已删除</h1><Link to="/trips">返回旅记</Link></section>;
  const save: Save = async (value) => { const result = await dispatch({ kind: 'put', collection: 'trips', value }, trip); setNotice(result.ok ? '已保存旅行。' : result.message); return result.ok; };
  const remove: Remove = (value, description) => setConfirmation({ value, expected: trip, description });
  return <><Link className="text-link" to="/trips">返回旅记</Link><PageHeading title={trip.title} description={`${trip.startDate} — ${trip.endDate}`} /><PlannerStatus />{notice ? <p role="status">{notice}</p> : null}
    {editing ? <TripEditor trip={trip} today={today} busy={busy} cancel={() => setEditing(false)} save={async (value, expected) => { const result = await dispatch({ kind: 'put', collection: 'trips', value }, expected); if (result.ok) setEditing(false); return result; }} /> : <div className="planner-actions"><button className="button secondary" disabled={busy || blocked} onClick={() => setEditing(true)}>编辑旅行</button><button className="button secondary" disabled={busy || blocked} onClick={() => setConfirmation({ value: null, expected: trip, description: '攻略、行李与本次城市记录一并删除，其他旅行不受影响。' })}>删除旅行</button></div>}
    {trip.notes ? <section className="panel planner-panel planner-spaced"><h2>给这趟旅行的备注</h2><p className="service-text">{trip.notes}</p></section> : null}
    <div className="trip-days">{trip.days.map((day) => <DayPanel key={day.date} trip={trip} date={day.date} busy={busy || blocked} save={save} remove={remove} />)}</div>
    <PackingPanel trip={trip} allTrips={state.trips} busy={busy || blocked} save={save} remove={remove} />
    <VisitsPanel key={`${trip.id}:${trip.startDate}:${trip.endDate}`} trip={trip} today={today} busy={busy || blocked} save={save} remove={remove} />
    {confirmation ? <ConfirmDialog title={confirmation.value ? '确认修改这份旅行内容？' : '删除这趟旅行？'} description={confirmation.description} confirmLabel={confirmation.value ? '确认修改' : '确认删除'} onCancel={() => setConfirmation(null)} onConfirm={async () => { if (confirmation.value) { const result = await dispatch({ kind: 'put', collection: 'trips', value: confirmation.value }, confirmation.expected); setNotice(result.ok ? '已保存旅行。' : result.message); setConfirmation(null); } else { const result = await dispatch({ kind: 'delete', collection: 'trips', id: trip.id }, confirmation.expected); if (result.ok) navigate('/trips'); else { setNotice(result.message); setConfirmation(null); } } }} /> : null}
  </>;
}
