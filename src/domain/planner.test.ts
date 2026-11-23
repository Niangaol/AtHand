import { describe, expect, it } from 'vitest';
import { createPlannerState, plannerSchema, applyCommand } from './planner';
import { newTrip } from './trips';

const scheduledTrip = () => {
  const trip = newTrip('trip-a', '上海周末', '2026-11-28', '2026-11-29');
  trip.transport = [{ id: 'out', mode: 'train', from: '杭州东', to: '上海虹桥', date: '2026-11-28', departTime: '08:00', arriveTime: '09:00', ref: 'G1', arriveDate: '' }];
  trip.lodging = [{ id: 'stay', name: '外滩', address: '', checkIn: '2026-11-28', checkOut: '2026-11-29', ref: '' }];
  trip.days[0].items = [{ id: 'walk', text: '外滩走走', startTime: '', endTime: '', location: '' }];
  trip.schedule = { timeZone: 'Asia/Shanghai', legs: ['out'], stays: ['stay'], items: ['walk'] };
  return trip;
};

const now = Date.parse('2026-11-21T10:00:00+08:00');
describe('planner boundary and commands', () => {
  it('keeps planner entities separate from money and rejects malformed persisted state', () => {
    const empty = createPlannerState();
    expect(plannerSchema.safeParse(empty).success).toBe(true);
    expect(plannerSchema.safeParse({ ...empty, focusSessions: [{ id: 'bad' }] }).success).toBe(false);
    expect(plannerSchema.safeParse({ ...empty, records: [] }).success).toBe(false);
    expect(plannerSchema.safeParse({ ...empty, countdowns: [{ id: 'a', kind: 'birthday', title: 'a', date: '2026-02-30' }] }).success).toBe(false);
  });
  it('allows only one active focus and fences a superseded browser', () => {
    const started = applyCommand(createPlannerState(), { kind: 'focus.start', id: 'one', task: '阅读', minutes: 25, owner: 'a' }, now);
    expect(started.focusSessions[0].status).toBe('running');
    expect(() => applyCommand(started, { kind: 'focus.start', id: 'two', task: '数学', minutes: 25, owner: 'b' }, now)).toThrow();
    const taken = applyCommand(started, { kind: 'focus.control', id: 'one', action: 'takeover', owner: 'b', epoch: 1 }, now + 1000);
    expect(() => applyCommand(taken, { kind: 'focus.control', id: 'one', action: 'pause', owner: 'a', epoch: 1 }, now + 2000)).toThrow();
  });
  it('links a manual study event to the focus session started from it and rejects other sources', () => {
    const base = createPlannerState();
    base.events.push({ id: 'study', title: '复习', kind: 'event', location: '', start: now, end: now + 30 * 60_000, allDay: false, timeZone: 'Asia/Shanghai', source: 'manual', sourceId: '' });
    const started = applyCommand(base, { kind: 'focus.start', id: 'session', task: '复习', minutes: 30, owner: 'a', eventId: 'study' }, now);
    expect(started.focusSessions[0].eventId).toBe('study');
    expect(started.events[0]).not.toHaveProperty('linkedFocusSessionId');
    expect(() => applyCommand(base, { kind: 'focus.start', id: 'x', task: '复习', minutes: 30, owner: 'a', eventId: 'missing' }, now)).toThrow();
    const imported = { ...base.events[0], id: 'ics', source: 'ics' as const, sourceId: 'file' };
    expect(() => applyCommand({ ...base, events: [imported] }, { kind: 'focus.start', id: 'y', task: '复习', minutes: 30, owner: 'a', eventId: 'ics' }, now)).toThrow();
  });
  it('updates and deletes entities without altering other collections', () => {
    const withBirthday = applyCommand(createPlannerState(), { kind: 'put', collection: 'countdowns', value: { id: 'birthday', kind: 'birthday', title: '朋友生日', date: '2000-02-29' } }, now);
    expect(withBirthday.countdowns).toHaveLength(1);
    expect(applyCommand(withBirthday, { kind: 'delete', collection: 'countdowns', id: 'birthday' }, now).countdowns).toHaveLength(0);
    expect(withBirthday.events).toEqual([]);
  });
  it('imports finished local focus history without starting a new timer', () => {
    let local = applyCommand(createPlannerState(), { kind: 'focus.start', id: 'one', task: '阅读', minutes: 1, owner: 'a' }, now);
    local = applyCommand(local, { kind: 'focus.control', id: 'one', action: 'complete', owner: 'a', epoch: 1 }, now + 60_000);
    const imported = applyCommand(createPlannerState(), { kind: 'focus.import', value: local.focusSessions[0] }, now + 99_000);
    expect(imported.focusSessions[0].segments[0].end).toBe(now + 60_000);
    expect(() => applyCommand(createPlannerState(), { kind: 'focus.import', value: { ...local.focusSessions[0], status: 'paused' } }, now)).toThrow();
  });
  it('reconciles only complete ICS source ranges and never deletes manual entries', () => {
    const base = createPlannerState();
    const e = { id: 'ics-a', title: '课程', kind: 'event' as const, location: '', start: now, end: now + 3600_000, allDay: false, timeZone: 'Asia/Shanghai', source: 'ics' as const, sourceId: 'file-a' };
    base.events = [e, { ...e, id: 'manual', source: 'manual', sourceId: '' }, { ...e, id: 'elsewhere', sourceId: 'file-b' }];
    const partial = applyCommand(base, { kind: 'events.import', sourceId: 'file-a', from: now, to: now + 86400_000, complete: false, events: [] }, now);
    expect(partial.events).toHaveLength(3);
    const full = applyCommand(base, { kind: 'events.import', sourceId: 'file-a', from: now, to: now + 86400_000, complete: true, events: [] }, now);
    expect(full.events.map((x) => x.id)).toEqual(['manual', 'elsewhere']);
  });
  it('generates linked trip events atomically and removes them with the trip', () => {
    const trip = scheduledTrip();
    const state = applyCommand(createPlannerState(), { kind: 'put', collection: 'trips', value: trip }, now);
    expect(state.events.map((event) => event.id)).toEqual(['trip:trip-a:leg:out', 'trip:trip-a:stay:stay', 'trip:trip-a:item:walk']);
    expect(state.events.every((event) => event.source === 'trip' && event.sourceId === 'trip-a')).toBe(true);
    const removed = applyCommand(state, { kind: 'delete', collection: 'trips', id: 'trip-a' }, now);
    expect(removed.trips).toEqual([]);
    expect(removed.events).toEqual([]);
  });
  it('leaves legacy trips and their existing events untouched until a schedule is chosen', () => {
    const trip = scheduledTrip();
    delete (trip as Partial<typeof trip>).schedule;
    const manual = { id: 'manual', title: '自己加的', kind: 'event' as const, location: '', start: now, end: now + 3600_000, allDay: false, timeZone: 'Asia/Shanghai', source: 'manual' as const, sourceId: '' };
    const state = applyCommand({ ...createPlannerState(), events: [manual] }, { kind: 'put', collection: 'trips', value: trip }, now);
    expect(state.events.map((event) => event.id)).toEqual(['manual']);
  });
  it('refuses generic event writes to trip-managed copies and forged trip sources', () => {
    const state = applyCommand(createPlannerState(), { kind: 'put', collection: 'trips', value: scheduledTrip() }, now);
    const copy = state.events[0];
    expect(() => applyCommand(state, { kind: 'put', collection: 'events', value: { ...copy, title: '改标题' } }, now)).toThrow(/旅记/);
    expect(() => applyCommand(state, { kind: 'delete', collection: 'events', id: copy.id }, now)).toThrow(/旅记/);
    const forged = { ...copy, id: 'fake' };
    expect(() => applyCommand(createPlannerState(), { kind: 'put', collection: 'events', value: forged }, now)).toThrow(/旅记/);
  });
  it('rejects a linked plan item that is missing and a conflicting event identity', () => {
    const missing = scheduledTrip();
    missing.schedule = { ...missing.schedule!, stays: ['gone'] };
    expect(() => applyCommand(createPlannerState(), { kind: 'put', collection: 'trips', value: missing }, now)).toThrow(/链接/);
    const occupied = { id: 'trip:trip-a:leg:out', title: '别人的', kind: 'event' as const, location: '', start: now, end: now + 3600_000, allDay: false, timeZone: 'Asia/Shanghai', source: 'manual' as const, sourceId: '' };
    expect(() => applyCommand({ ...createPlannerState(), events: [occupied] }, { kind: 'put', collection: 'trips', value: scheduledTrip() }, now)).toThrow(/占用/);
  });
  it('rejects generic writes to focus sessions and unsafe source URLs', () => {
    expect(() => applyCommand(createPlannerState(), { kind: 'put', collection: 'focusSessions', value: {} } as never, now)).toThrow();
    const value = { id: 'a', title: '事项', category: '其他', entryType: 'web', entry: 'javascript:alert(1)', materials: '', hours: '', steps: '', sourceUrl: 'javascript:alert(1)', sourceUpdated: null, verifiedAt: null, miniProgramQr: '' };
    expect(() => applyCommand(createPlannerState(), { kind: 'put', collection: 'serviceEntries', value }, now)).toThrow();
  });
});
