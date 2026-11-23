import { describe, expect, it } from 'vitest';
import { createPlannerState } from './planner.ts';
import { buildEvent } from './schedule.ts';
import { buildDayBrief } from './insights.ts';
import type { RecordEntry } from './records.ts';

const at = (time: string) => new Date(`${time}+08:00`).getTime();

function record(overrides: Partial<RecordEntry>): RecordEntry {
  return { id: 'r1', date: '2026-11-23', title: '午饭', amountCents: 1850, source: 'manual', type: 'expense', category: '吃饭', ...overrides } as RecordEntry;
}

describe('buildDayBrief', () => {
  it('summarizes the day, skips demo records, and finds the next item', () => {
    const state = createPlannerState();
    state.events.push(buildEvent({ id: 'e1', kind: 'course', title: '高等数学', location: 'A101', start: '2026-11-23T09:00', end: '2026-11-23T11:00', allDay: false, timeZone: 'Asia/Shanghai' }));
    state.events.push(buildEvent({ id: 'e2', kind: 'exam', title: '线代考试', location: '', start: '2026-11-25T14:00', end: '2026-11-25T16:00', allDay: false, timeZone: 'Asia/Shanghai' }));
    const records = [record({}), record({ id: 'r2', amountCents: 99900, source: 'demo' })];
    const facts = buildDayBrief(state, records, [], '2026-11-23', at('2026-11-23T08:00'));
    expect(facts.date).toBe('2026-11-23');
    expect(facts.items.map((item) => item.title)).toEqual(['高等数学']);
    expect(facts.next?.title).toBe('高等数学');
    expect(facts.expenseCents).toBe(1850);
    expect(facts.countdowns.map((item) => item.title)).toEqual(['线代考试']);
    expect(facts.countdowns[0]).toMatchObject({ days: 2 });
  });

  it('returns empty-day shape with next null after the last item', () => {
    const facts = buildDayBrief(createPlannerState(), [], [], '2026-11-23', at('2026-11-23T23:00'));
    expect(facts).toMatchObject({ date: '2026-11-23', items: [], next: null, expenseCents: 0, focusMinutes: 0, activeFocus: null });
    expect(facts.warnings).toEqual([]);
  });
});
