import { describe, expect, it } from 'vitest';
import { tripSchema } from './planner';
import { newTrip } from './trips';
import { tripBudgetCents, tripCountdown, tripDaysUntil, tripPlanEvents, tripSelectedEvents, tripTodoProgress, nextTrip } from './tripPlan';

const planned = () => {
  const trip = newTrip('shanghai', '上海周末', '2026-11-28', '2026-11-29');
  trip.transport = [
    { id: 'out', mode: 'train', from: '杭州东', to: '上海虹桥', date: '2026-11-28', departTime: '08:00', arriveTime: '09:00', ref: 'G7301', arriveDate: '' },
    { id: 'night', mode: 'train', from: '上海虹桥', to: '杭州东', date: '2026-11-29', departTime: '22:10', arriveTime: '23:05', ref: '', arriveDate: '' },
  ];
  trip.lodging = [{ id: 'stay', name: '外滩附近', address: '中山东一路', checkIn: '2026-11-28', checkOut: '2026-11-29', ref: '订单 123' }];
  trip.budget = { totalCents: 80000, items: [{ id: 'ticket', label: '车票', amountCents: 14600, note: '往返' }, { id: 'room', label: '住宿', amountCents: 32000, note: '' }] };
  trip.todos = [{ id: 'id', text: '带身份证', done: true }, { id: 'ticket', text: '取纸质票', done: false }];
  return tripSchema.parse(trip);
};

describe('trip pre-departure plan', () => {
  it('defaults new fields on legacy trips without losing existing content', () => {
    const legacy = newTrip('legacy', '旧旅记', '2026-11-01', '2026-11-02');
    delete (legacy as Partial<typeof legacy>).transport;
    delete (legacy as Partial<typeof legacy>).lodging;
    delete (legacy as Partial<typeof legacy>).budget;
    delete (legacy as Partial<typeof legacy>).todos;
    const parsed = tripSchema.parse(legacy);
    expect(parsed.transport).toEqual([]);
    expect(parsed.lodging).toEqual([]);
    expect(parsed.budget).toEqual({ totalCents: 0, items: [] });
    expect(parsed.todos).toEqual([]);
    expect(parsed.days).toHaveLength(2);
  });

  it('rejects duplicate transport, lodging and todo identities', () => {
    const trip = planned();
    trip.transport.push({ ...trip.transport[0] });
    expect(tripSchema.safeParse(trip).success).toBe(false);
    trip.transport = trip.transport.slice(0, 1);
    trip.todos.push({ ...trip.todos[0] });
    expect(tripSchema.safeParse(trip).success).toBe(false);
  });

  it('sums itemized budget and counts pre-departure todos', () => {
    const trip = planned();
    expect(tripBudgetCents(trip)).toBe(46600);
    expect(tripTodoProgress(trip)).toEqual({ done: 1, total: 2 });
  });

  it('computes departure countdown and the next upcoming or ongoing trip', () => {
    const trip = planned();
    expect(tripDaysUntil(trip, '2026-11-21')).toBe(7);
    expect(tripDaysUntil(trip, '2026-11-28')).toBe(0);
    expect(tripDaysUntil(trip, '2026-11-30')).toBe(-2);
    expect(tripCountdown(trip, '2026-11-21')).toBe('距出发 7 天');
    expect(tripCountdown(trip, '2026-11-28')).toBe('今天出发');
    expect(tripCountdown(trip, '2026-11-29')).toBe('旅行中 · 第 2 天');
    expect(tripCountdown(trip, '2026-11-30')).toBe('已结束 1 天');
    const later = newTrip('later', '北京', '2026-12-05', '2026-12-07');
    const past = newTrip('past', '南京', '2026-11-01', '2026-11-03');
    expect(nextTrip([later, past, trip], '2026-11-28')?.id).toBe('shanghai');
    expect(nextTrip([later, trip], '2026-11-30')?.id).toBe('later');
    expect(nextTrip([past], '2026-11-30')).toBeNull();
    expect(nextTrip([], '2026-11-28')).toBeNull();
  });

  it('turns transport and lodging into deterministic trip events', () => {
    const trip = planned();
    const events = tripPlanEvents(trip, 'Asia/Shanghai');
    expect(events.map((event) => event.id)).toEqual([
      'trip:shanghai:leg:out',
      'trip:shanghai:leg:night',
      'trip:shanghai:stay:stay',
    ]);
    expect(events.every((event) => event.source === 'trip')).toBe(true);
    expect(events[0]).toMatchObject({ title: '杭州东 → 上海虹桥', location: 'G7301', allDay: false });
    expect(events[1].end).toBeGreaterThan(events[1].start);
    expect(events[2]).toMatchObject({ title: '住在 外滩附近', location: '中山东一路', allDay: true });
    expect(tripPlanEvents(trip, 'Asia/Shanghai')).toEqual(events);
  });

  it('ends a lodging event on the checkout morning instead of covering the checkout day', () => {
    const trip = planned();
    const stay = tripPlanEvents(trip, 'Asia/Shanghai')[2];
    expect(stay.start).toBe(Date.parse('2026-11-28T00:00:00+08:00'));
    expect(stay.end).toBe(Date.parse('2026-11-29T00:00:00+08:00'));
  });

  it('honors an explicit arrival date for an overnight leg', () => {
    const trip = planned();
    trip.transport = [{ id: 'night', mode: 'flight', from: '杭州', to: '广州', date: '2026-11-28', departTime: '22:00', arriveTime: '00:30', ref: 'CZ', arriveDate: '2026-11-30' }];
    trip.lodging = [];
    const [leg] = tripPlanEvents(trip, 'Asia/Shanghai');
    expect(leg.start).toBe(Date.parse('2026-11-28T22:00:00+08:00'));
    expect(leg.end).toBe(Date.parse('2026-11-30T00:30:00+08:00'));
  });

  it('turns timed day items into events and keeps untimed ones all day', () => {
    const trip = planned();
    trip.days[0].items = [
      { id: 'timed', text: '外滩夜景', startTime: '19:00', endTime: '21:00', location: '外滩' },
      { id: 'open', text: '看情况', startTime: '', endTime: '', location: '' },
    ];
    const events = tripPlanEvents(trip, 'Asia/Shanghai').filter((event) => event.id.includes(':item:'));
    expect(events.map((event) => event.id)).toEqual(['trip:shanghai:item:timed', 'trip:shanghai:item:open']);
    expect(events[0]).toMatchObject({ title: '外滩夜景', location: '外滩', allDay: false });
    expect(events[1]).toMatchObject({ allDay: true, location: '' });
  });

  it('rebuilds only the explicitly linked plan items once a schedule is set', () => {
    const trip = planned();
    trip.days[0].items = [{ id: 'item', text: '外滩', startTime: '', endTime: '', location: '' }];
    trip.schedule = { timeZone: 'Asia/Shanghai', legs: ['out'], stays: [], items: ['item'] };
    expect(tripSelectedEvents(trip).map((event) => event.id)).toEqual(['trip:shanghai:leg:out', 'trip:shanghai:item:item']);
    expect(tripSelectedEvents({ ...trip, schedule: undefined })).toEqual([]);
  });

  it('keeps an all-day leg when times are missing instead of inventing them', () => {
    const trip = planned();
    trip.transport = [{ id: 'blank', mode: 'car', from: '杭州', to: '湖州', date: '2026-11-28', departTime: '', arriveTime: '', ref: '', arriveDate: '' }];
    trip.lodging = [];
    const [event] = tripPlanEvents(trip, 'Asia/Shanghai');
    expect(event).toMatchObject({ id: 'trip:shanghai:leg:blank', allDay: true, title: '杭州 → 湖州' });
    expect(event.end - event.start).toBe(24 * 3600_000);
  });
});
