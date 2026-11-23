import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createPlannerState } from '../functions/planner.mjs';

const trip = () => ({
  id: 'trip-a', title: '上海周末', startDate: '2026-11-28', endDate: '2026-11-29', notes: '',
  days: [{ date: '2026-11-28', items: [{ id: 'walk', text: '外滩走走', startTime: '', endTime: '', location: '' }] }, { date: '2026-11-29', items: [] }],
  packing: [], visits: [], transport: [{ id: 'out', mode: 'train', from: '杭州东', to: '上海虹桥', date: '2026-11-28', departTime: '08:00', arriveTime: '09:00', ref: 'G1', arriveDate: '' }],
  lodging: [{ id: 'stay', name: '外滩', address: '', checkIn: '2026-11-28', checkOut: '2026-11-29', ref: '' }],
  budget: { totalCents: 0, items: [] }, todos: [],
  schedule: { timeZone: 'Asia/Shanghai', legs: ['out'], stays: ['stay'], items: ['walk'] },
});

test('Function builds, protects and removes trip-managed schedule copies', () => {
  const state = applyCommand(createPlannerState(), { kind: 'put', collection: 'trips', value: trip() }, 0);
  assert.deepEqual(state.events.map((event) => event.id), ['trip:trip-a:leg:out', 'trip:trip-a:stay:stay', 'trip:trip-a:item:walk']);
  assert.equal(state.events[0].start, Date.parse('2026-11-28T08:00:00+08:00'));
  assert.equal(state.events[1].end, Date.parse('2026-11-29T00:00:00+08:00'));
  const copy = state.events[0];
  assert.throws(() => applyCommand(state, { kind: 'put', collection: 'events', value: { ...copy, title: '改' } }, 0));
  assert.throws(() => applyCommand(state, { kind: 'delete', collection: 'events', id: copy.id }, 0));
  const removed = applyCommand(state, { kind: 'delete', collection: 'trips', id: 'trip-a' }, 0);
  assert.deepEqual(removed.events, []);
});

test('Function accepts a trip whose adopted plan was removed and drops its copy', () => {
  const state = applyCommand(createPlannerState(), { kind: 'put', collection: 'trips', value: trip() }, 0);
  const next = structuredClone(trip());
  next.lodging = [];
  next.schedule = { ...next.schedule, stays: [] };
  const saved = applyCommand(state, { kind: 'put', collection: 'trips', value: next }, 0);
  assert.deepEqual(saved.events.map((event) => event.id), ['trip:trip-a:leg:out', 'trip:trip-a:item:walk']);
});

test('Function rejects missing links and identity collisions and ignores trips without a schedule', () => {
  const missing = trip();
  missing.schedule = { ...missing.schedule, stays: ['gone'] };
  assert.throws(() => applyCommand(createPlannerState(), { kind: 'put', collection: 'trips', value: missing }, 0));
  const occupied = { id: 'trip:trip-a:leg:out', title: '别人的', kind: 'event', location: '', start: 0, end: 1, allDay: false, timeZone: 'Asia/Shanghai', source: 'manual', sourceId: '' };
  assert.throws(() => applyCommand({ ...createPlannerState(), events: [occupied] }, { kind: 'put', collection: 'trips', value: trip() }, 0));
  const legacy = trip();
  delete legacy.schedule;
  assert.deepEqual(applyCommand(createPlannerState(), { kind: 'put', collection: 'trips', value: legacy }, 0).events, []);
});
