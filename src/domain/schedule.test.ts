import { describe, expect, it } from 'vitest';
import { expandCourse, buildEvent, buildTimeline, scheduleWarnings } from './schedule';
import type { CourseRule, PlannerEvent } from './planner';
import { createPlannerState } from './planner';
import { getCountdowns } from './countdowns';
import { startFocus, transitionFocus } from './focus';

it('calendar classification follows live source updates and disappears after revocation', () => {
  const state = createPlannerState();
  const original: PlannerEvent = { ...buildEvent({ id: 'phone:event', kind: 'event', title: '日历事项', location: '', start: '2026-11-21T09:00', end: '2026-11-21T10:00', allDay: false, timeZone: 'Asia/Shanghai' }), source: 'calendar', sourceId: 'phone' };
  state.events.push({ ...original, kind: 'exam' });
  const sources = [{ sourceId: 'phone', calendarAvailable: true, fetchedAt: original.start, events: [{ ...original, start: original.start + 86400_000, end: original.end + 86400_000 }] }];
  const timeline = buildTimeline(state, [], sources, '2026-11-21', '2026-11-22');
  expect(timeline).toHaveLength(1);
  expect(timeline[0]).toMatchObject({ date: '2026-11-22', kind: 'exam', sourceLabel: '手机日历' });
  expect(getCountdowns(state, '2026-11-21', sources)[0].days).toBe(1);
  sources[0].calendarAvailable = false;
  expect(buildTimeline(state, [], sources, '2026-11-21', '2026-11-22')).toHaveLength(0);
  expect(getCountdowns(state, '2026-11-21', sources)).toHaveLength(0);
});

const course: CourseRule = { id: 'math', title: '高数', location: 'A101', semesterStart: '2026-11-02', weekday: 1, startTime: '09:00', endTime: '10:00', firstWeek: 1, lastWeek: 4, parity: 'odd', timeZone: 'Asia/Shanghai', exceptions: [] };
const event = (id: string, kind: PlannerEvent['kind'], start: string, end: string) => buildEvent({ id, kind, title: id, location: '', start, end, allDay: false, timeZone: 'Asia/Shanghai' });
describe('course expansion and schedule projections', () => {
  it('replaces a linked study plan with its actual focus and restores it after cancellation', () => {
    const state = createPlannerState();
    const study = { ...event('study', 'event', '2026-11-21T19:00', '2026-11-21T20:00'), title: '晚间复习' };
    state.events.push(study);
    const begin = new Date('2026-11-21T19:00:00').getTime();
    const completed = transitionFocus(startFocus('focus-study', '晚间复习', 60, begin, 'a', 'study'), 'complete', begin + 3600_000, 'a', 1);
    state.focusSessions.push(completed);
    const completedItems = buildTimeline(state, [], [], '2026-11-21', '2026-11-21');
    expect(completedItems.map((v) => v.sourceLabel)).toEqual(['专注记录']);
    expect(completedItems[0].linkedEventId).toBe('study');
    state.focusSessions = [transitionFocus(startFocus('focus-study', '晚间复习', 60, begin, 'a', 'study'), 'cancel', begin + 600_000, 'a', 1)];
    const cancelled = buildTimeline(state, [], [], '2026-11-21', '2026-11-21');
    expect(cancelled.some((v) => v.sourceLabel === '手动日程')).toBe(true);
    expect(cancelled.some((v) => v.sourceLabel === '专注记录')).toBe(true);
  });
  it('preserves all-day source dates without creating an extra local day', () => {
    const state = createPlannerState();
    state.events.push(buildEvent({ id: 'day', kind: 'exam', title: '全天考试', location: '', start: '2026-11-21', end: '2026-11-21', allDay: true, timeZone: 'Pacific/Honolulu' }));
    expect(buildTimeline(state, [], [], '2026-11-20', '2026-11-23').map((v) => v.date)).toEqual(['2026-11-21']);
    expect(getCountdowns(state, '2026-11-20')[0].days).toBe(1);
  });
  it('expands odd academic weeks and applies single-instance cancellations', () => {
    expect(expandCourse(course, '2026-11-01', '2026-11-30').map((v) => new Date(v.start).toISOString())).toEqual(['2026-11-02T01:00:00.000Z', '2026-11-16T01:00:00.000Z']);
    expect(expandCourse({ ...course, exceptions: [{ date: '2026-11-16', replacement: null }] }, '2026-11-01', '2026-11-30')).toHaveLength(1);
  });
  it('includes a Sunday source course that falls on local Monday', () => {
    const state = createPlannerState();
    state.courseRules.push({ ...course, weekday: 7, startTime: '20:00', endTime: '21:00', parity: 'all', timeZone: 'America/New_York', firstWeek: 1, lastWeek: 1 });
    expect(buildTimeline(state, [], [], '2026-11-09', '2026-11-09')).toHaveLength(1);
  });
  it('warns on a 20-minute midnight overlap before splitting into two 10-minute days', () => {
    const state = createPlannerState();
    state.events = [event('night-course', 'course', '2026-11-20T23:50', '2026-11-21T00:10'), event('night-work', 'shift', '2026-11-20T23:50', '2026-11-21T00:10')];
    const warnings = scheduleWarnings(buildTimeline(state, [], [], '2026-11-20', '2026-11-21'));
    expect(warnings.some((v) => v.rule === 'overlap' && v.text.includes('20分钟'))).toBe(true);
  });
  it('keeps wall-clock course time correct when browser and source timezones differ', () => {
    const [first] = expandCourse({ ...course, timeZone: 'America/New_York', firstWeek: 1, lastWeek: 1 }, '2026-11-01', '2026-11-03');
    expect(new Date(first.start).toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });
  it('uses real overnight work intervals rather than adjusted paid minutes', () => {
    const state = createPlannerState();
    const records = [{ id: 'work', type: 'work' as const, date: '2026-11-20', title: '夜班', startTime: '22:00', endTime: '02:00', durationMinutes: 60, workplaceId: 'a', hourlyRateCents: 2000, amountCents: 2000, source: 'manual' as const }];
    const items = buildTimeline(state, records, [], '2026-11-20', '2026-11-21');
    expect(items).toHaveLength(2);
    expect(items.reduce((sum, e) => sum + (e.end - e.start) / 60000, 0)).toBe(240);
  });
  it('does not double count a planned shift linked to recorded work', () => {
    const state = createPlannerState();
    state.events.push({ ...event('shift', 'shift', '2026-11-20T09:00', '2026-11-20T12:00'), linkedWorkRecordId: 'w' });
    const records = [{ id: 'w', type: 'work' as const, date: '2026-11-20', title: '排班', startTime: '09:00', endTime: '12:00', durationMinutes: 180, workplaceId: 'a', hourlyRateCents: 2000, amountCents: 6000, source: 'manual' as const }];
    expect(buildTimeline(state, records, [], '2026-11-20', '2026-11-20')).toHaveLength(1);
  });
  it('warns only beyond 15-minute course overlap and 8-hour work union', () => {
    const lesson = event('course', 'course', '2026-11-20T09:00', '2026-11-20T10:00');
    expect(scheduleWarnings([lesson, event('work', 'shift', '2026-11-20T09:45', '2026-11-20T17:45')]).map((w) => w.rule)).toEqual([]);
    expect(scheduleWarnings([lesson, event('work', 'shift', '2026-11-20T09:44', '2026-11-20T17:45')]).map((w) => w.rule)).toEqual(['overlap', 'long-shift']);
  });
  it('warns before exams without rejecting a manually entered shift', () => {
    const warnings = scheduleWarnings([event('work', 'shift', '2026-11-20T09:00', '2026-11-20T11:00'), event('exam', 'exam', '2026-11-23T09:00', '2026-11-23T11:00')]);
    expect(warnings.some((w) => w.rule === 'exam-near')).toBe(true);
  });
});
