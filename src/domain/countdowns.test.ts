import { describe, expect, it } from 'vitest';
import { getCountdowns } from './countdowns';
import { createPlannerState } from './planner';
import { buildEvent } from './schedule';

describe('countdown dates', () => {
  it('derives exam and deadline dates without storing a second record', () => {
    const state = createPlannerState();
    state.events.push(buildEvent({ id: 'exam', kind: 'exam', title: '考试', location: '', start: '2026-11-23T09:00', end: '2026-11-23T11:00', allDay: false, timeZone: 'Asia/Shanghai' }));
    expect(getCountdowns(state, '2026-11-21')[0]).toMatchObject({ id: 'event:exam', days: 2, title: '考试' });
    state.events = [];
    expect(getCountdowns(state, '2026-11-21')).toEqual([]);
  });
  it('handles year boundaries, today, past deadlines and leap birthdays', () => {
    const state = createPlannerState();
    state.countdowns = [
      { id: 'a', title: '生日', kind: 'birthday', date: '2000-02-29' },
      { id: 'b', title: '证件', kind: 'document', date: '2027-02-28' },
      { id: 'c', title: '已过期', kind: 'document', date: '2027-02-27' },
    ];
    expect(getCountdowns(state, '2027-02-28').map((v) => [v.id, v.days])).toEqual([['a', 0], ['b', 0], ['c', -1]]);
    expect(getCountdowns(state, '2026-12-31').find((v) => v.id === 'a')?.days).toBe(59);
  });
});
