import { useMemo } from 'react';
import type { Trip } from '../../domain/planner';
import { money } from '../../domain/summary';
import { localTimeZone } from '../../domain/schedule';
import { tripBudgetCents, tripCountdown, tripPlanEvents, tripTodoProgress } from '../../domain/tripPlan';
import { TransportEditor } from './TransportEditor';
import { LodgingEditor } from './LodgingEditor';
import { BudgetPanel } from './BudgetPanel';
import { TripTodos } from './TripTodos';
import './trips.css';

export function TripPlanPanel({ trip, today, busy, save, remove, joined, onJoin, onAdoptAll }: {
  trip: Trip; today: string; busy: boolean;
  save: (value: Trip) => Promise<boolean>;
  remove: (value: Trip, description: string) => void;
  joined: Set<string>;
  onJoin: (kind: 'legs' | 'stays' | 'items', id: string) => void;
  onAdoptAll: () => void;
}) {
  const todo = tripTodoProgress(trip);
  const planned = tripBudgetCents(trip);
  const legacyEvents = useMemo(() => trip.schedule ? [] : tripPlanEvents(trip, localTimeZone()), [trip]);
  return <section className="panel planner-panel trip-plan planner-spaced" aria-label="行前总览">
    <div className="planner-section-title">
      <div><h2>行前总览</h2><p className="trip-plan-phase">{tripCountdown(trip, today)}</p></div>
      {legacyEvents.length ? <button className="button secondary compact" disabled={busy} onClick={onAdoptAll}>把交通、住宿与攻略加入日程</button> : null}
    </div>
    <div className="trip-plan-stats">
      <div><span>交通</span><strong>{trip.transport.length}</strong></div>
      <div><span>住宿</span><strong>{trip.lodging.length}</strong></div>
      <div><span>计划预算</span><strong>¥ {money(planned)}</strong></div>
      <div><span>行前事项</span><strong>{todo.done}/{todo.total}</strong></div>
    </div>
    {trip.schedule ? <p className="form-hint">已加入日程的安排会随旅记一起更新；新增项目默认不加入，需要时再点“加入日程”。</p> : <p className="form-hint">点“加入日程”时，会同步到日程表；之后在旅记里改日期或删除，日程也会一起更新。</p>}
    <TransportEditor trip={trip} busy={busy} save={save} remove={remove}
      scheduled={new Set(trip.transport.filter((leg) => joined.has(`leg:${leg.id}`)).map((leg) => `leg:${leg.id}`))}
      onSchedule={(id) => onJoin('legs', id)} addToSchedule={(id) => onJoin('legs', id)} />
    <LodgingEditor trip={trip} busy={busy} save={save} remove={remove}
      scheduled={new Set(trip.lodging.filter((stay) => joined.has(`stay:${stay.id}`)).map((stay) => `stay:${stay.id}`))}
      onSchedule={(id) => onJoin('stays', id)} addToSchedule={(id) => onJoin('stays', id)} />
    <BudgetPanel trip={trip} busy={busy} save={save} remove={remove} />
    <TripTodos trip={trip} busy={busy} save={save} />
  </section>;
}
