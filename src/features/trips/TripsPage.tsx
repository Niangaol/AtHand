import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlanner } from '../../data/PlannerProvider';
import { useLocalToday } from '../../data/useLocalToday';
import { cityVisits } from '../../domain/trips';
import { tripBudgetCents, tripCountdown } from '../../domain/tripPlan';
import { money } from '../../domain/summary';
import { PageHeading } from '../../components/PageHeading';
import { PlannerStatus } from '../../components/PlannerStatus';
import { CityMap } from './CityMap';
import { TripEditor } from './TripEditor';
import './trips.css';

export function TripsPage() {
  const { state, dispatch, busy, blocked } = usePlanner();
  const today = useLocalToday();
  const [adding, setAdding] = useState(false);
  return <><PageHeading title="把期待，写成一次出发。" description="按天准备攻略，出门勾选行李，回来收藏走过的城市。" action={<button className="button primary" disabled={blocked} onClick={() => setAdding(true)}>新建旅行</button>} /><PlannerStatus />
    {adding ? <TripEditor today={today} busy={busy} cancel={() => setAdding(false)} save={async (value, expected) => { const result = await dispatch({ kind: 'put', collection: 'trips', value }, expected); if (result.ok) setAdding(false); return result; }} /> : null}
    <div className="service-grid planner-spaced">{[...state.trips].sort((a, b) => {
      const rank = (trip: typeof a) => trip.startDate > today ? 0 : trip.endDate < today ? 2 : 1;
      return rank(a) - rank(b) || (rank(a) === 2 ? b.startDate.localeCompare(a.startDate) : a.startDate.localeCompare(b.startDate));
    }).map((trip) => {
      const budget = tripBudgetCents(trip);
      return <article className="panel planner-panel" key={trip.id}><span className="subtle-tag">{trip.startDate > today ? '计划出发' : trip.endDate < today ? '旅行回忆' : '旅途中'}</span><h2><Link to={`/trips/${encodeURIComponent(trip.id)}`}>{trip.title}</Link></h2><p>{trip.startDate} — {trip.endDate}</p><p>{tripCountdown(trip, today)}{budget ? ` · 预算 ¥ ${money(budget)}` : ''}</p><p>{trip.days.reduce((n, day) => n + day.items.length, 0)} 条攻略 · 行李 {trip.packing.filter((v) => v.checked).length}/{trip.packing.length}</p></article>;
    })}</div>
    {!state.trips.length ? <div className="panel planner-empty planner-spaced"><h2>下一站，想去哪里？</h2><p>新建一趟旅行，从日期和一条攻略开始。所有内容先保存在本机。</p></div> : null}
    <CityMap cities={cityVisits(state.trips, today)} />
  </>;
}
