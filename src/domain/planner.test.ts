import { describe, expect, it } from 'vitest';
import { createPlannerState, plannerSchema, applyCommand } from './planner';

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
  it('rejects generic writes to focus sessions and unsafe source URLs', () => {
    expect(() => applyCommand(createPlannerState(), { kind: 'put', collection: 'focusSessions', value: {} } as never, now)).toThrow();
    const value = { id: 'a', title: '事项', category: '其他', entryType: 'web', entry: 'javascript:alert(1)', materials: '', hours: '', steps: '', sourceUrl: 'javascript:alert(1)', sourceUpdated: null, verifiedAt: null, miniProgramQr: '' };
    expect(() => applyCommand(createPlannerState(), { kind: 'put', collection: 'serviceEntries', value }, now)).toThrow();
  });
});
