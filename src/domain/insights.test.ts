import { describe, expect, it } from 'vitest';
import { createPlannerState } from './planner.ts';
import { buildEvent } from './schedule.ts';
import { buildDayBrief, buildWeekReview, buildLedgerInsights, buildFocusInsights } from './insights.ts';
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

describe('buildWeekReview', () => {
  it('compares this week with the previous week and ranks categories', () => {
    const state = createPlannerState();
    state.focusSessions.push({
      id: 'f1', task: '复习', minutes: 50, startedAt: at('2026-11-23T19:00'), status: 'completed',
      segments: [{ start: at('2026-11-23T19:00'), end: at('2026-11-23T19:50') }], owner: 'web', epoch: 1,
    });
    const records = [
      record({ id: 'a', date: '2026-11-23', amountCents: 2000, category: '吃饭' }),
      record({ id: 'b', date: '2026-11-24', amountCents: 1000, category: '交通' }),
      record({ id: 'c', date: '2026-11-17', amountCents: 5000, category: '吃饭' }),
    ];
    const facts = buildWeekReview(state, records, [], '2026-11-23', at('2026-11-24T12:00'));
    expect(facts).toMatchObject({ start: '2026-11-23', end: '2026-11-29' });
    expect(facts.thisWeek.expenseCents).toBe(3000);
    expect(facts.lastWeek.expenseCents).toBe(5000);
    expect(facts.thisWeek.focusMinutes).toBe(50);
    expect(facts.categories[0]).toMatchObject({ category: '吃饭', cents: 2000, share: 67 });
    expect(facts.focusByDay).toHaveLength(7);
    expect(facts.focusByDay[0]).toMatchObject({ date: '2026-11-23', minutes: 50 });
  });
});

describe('buildLedgerInsights', () => {
  it('covers the window, compares to the previous window, and ranks categories', () => {
    const records = [
      record({ id: 'a', date: '2026-11-22', amountCents: 2000, category: '吃饭' }),
      record({ id: 'b', date: '2026-11-21', amountCents: 1500, category: '吃饭' }),
      record({ id: 'c', date: '2026-11-10', amountCents: 6000, category: '学习', title: '教材' }),
      record({ id: 'w', date: '2026-11-20', amountCents: 8000, type: 'work', workplaceId: 'u', startTime: '09:00', endTime: '13:00', durationMinutes: 240, hourlyRateCents: 2000, title: '兼职' } as RecordEntry),
    ];
    const facts = buildLedgerInsights(records, '2026-11-23', 7);
    expect(facts.range).toMatchObject({ from: '2026-11-17', to: '2026-11-23', days: 7 });
    expect(facts.expenseCents).toBe(3500);
    expect(facts.previousExpenseCents).toBe(6000);
    expect(facts.deltaPct).toBe(-42);
    expect(facts.categories).toEqual([{ category: '吃饭', cents: 3500, share: 100 }]);
    expect(facts.anomalies).toEqual([]);
  });

  it('flags single expenses above three times the daily average', () => {
    const facts = buildLedgerInsights([
      record({ id: 'a', date: '2026-11-22', amountCents: 2000, category: '吃饭' }),
      record({ id: 'big', date: '2026-11-23', title: '羽绒服', amountCents: 30000, category: '日用' }),
    ], '2026-11-23', 7);
    expect(facts.anomalies).toHaveLength(1);
    expect(facts.anomalies[0].title).toBe('羽绒服');
    expect(facts.topExpenses[0]).toMatchObject({ title: '羽绒服', amountCents: 30000 });
  });

  it('returns deltaPct null when the previous window is empty', () => {
    const facts = buildLedgerInsights([record({ amountCents: 1000 })], '2026-11-23', 7);
    expect(facts.previousExpenseCents).toBe(0);
    expect(facts.deltaPct).toBeNull();
  });
});

function session(id: string, start: string, minutes: number, task = '复习') {
  return {
    id, task, minutes, startedAt: at(start), status: 'completed' as const,
    segments: [{ start: at(start), end: at(start) + minutes * 60_000 }], owner: 'web', epoch: 1,
  };
}

describe('buildFocusInsights', () => {
  it('aggregates totals, streaks and time slots', () => {
    const state = createPlannerState();
    state.focusSessions.push(
      session('f1', '2026-11-23T09:00', 50),
      session('f2', '2026-11-23T20:00', 25, '英语'),
      session('f3', '2026-11-22T14:00', 30),
    );
    const facts = buildFocusInsights(state, '2026-11-23', 7, at('2026-11-23T22:00'));
    expect(facts.days).toBe(7);
    expect(facts.totalMinutes).toBe(105);
    expect(facts.sessions).toBe(3);
    expect(facts.streakDays).toBe(2);
    expect(facts.bestDay).toMatchObject({ date: '2026-11-23', minutes: 75 });
    expect(facts.bySlot.find((slot) => slot.slot === '上午')?.minutes).toBe(50);
    expect(facts.topTasks[0]).toEqual({ task: '复习', minutes: 80 });
  });

  it('handles no sessions', () => {
    const facts = buildFocusInsights(createPlannerState(), '2026-11-23', 7, at('2026-11-23T22:00'));
    expect(facts).toMatchObject({ totalMinutes: 0, sessions: 0, streakDays: 0, bestDay: null, topTasks: [] });
    expect(facts.daily).toHaveLength(7);
  });
});
