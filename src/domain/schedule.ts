import { courseSchema, eventSchema } from './planner.ts';
import type { CourseRule, PlannerEvent, PlannerState } from './planner.ts';
import type { RecordEntry } from './records.ts';
import { shiftDate, toDateKey } from './dates.ts';
import { localTimeZone, zonedInput, zonedTimestamp } from './zoned.ts';

export { localTimeZone, zonedInput, zonedTimestamp };
export type EventDraft = {
  id: string; title: string; kind: PlannerEvent['kind']; location: string;
  start: string; end: string; allDay: boolean; timeZone: string; linkedWorkRecordId?: string;
  source?: 'manual' | 'trip' | 'hdu'; sourceId?: string;
};
export function buildEvent(draft: EventDraft): PlannerEvent {
  return eventSchema.parse({ ...draft,
    start: zonedTimestamp(draft.allDay ? `${draft.start.slice(0, 10)}T00:00` : draft.start, draft.timeZone),
    end: zonedTimestamp(draft.allDay ? `${shiftDate(draft.end.slice(0, 10), 1)}T00:00` : draft.end, draft.timeZone),
    source: draft.source ?? 'manual', sourceId: draft.sourceId ?? '',
  });
}
export function expandCourse(input: CourseRule, from: string, to: string): PlannerEvent[] {
  const rule = courseSchema.parse(input);
  const result: PlannerEvent[] = [];
  for (let week = rule.firstWeek; week <= rule.lastWeek; week++) {
    if (rule.parity === 'odd' && week % 2 === 0 || rule.parity === 'even' && week % 2 === 1) continue;
    const date = shiftDate(rule.semesterStart, (week - 1) * 7 + rule.weekday - 1);
    const exception = rule.exceptions.find((e) => e.date === date);
    const event = exception ? exception.replacement : buildEvent({ id: `course:${rule.id}:${date}`, title: rule.title, kind: 'course', location: rule.location,
      start: `${date}T${rule.startTime}`, end: `${date}T${rule.endTime}`, allDay: false, timeZone: rule.timeZone });
    if (event) {
      if (event.start < new Date(`${shiftDate(to, 1)}T00:00:00`).getTime() && event.end > new Date(`${from}T00:00:00`).getTime()) result.push(event);
    }
  }
  return result;
}
export type TimelineItem = {
  id: string; originId: string; date: string; title: string; location: string; kind: PlannerEvent['kind'] | 'focus';
  start: number; end: number; allDay: boolean; sourceLabel: string; intervalStart?: number; intervalEnd?: number;
  eventId?: string; workId?: string; courseId?: string; courseDate?: string; calendarEvent?: PlannerEvent; linkedEventId?: string;
};
export type CalendarSource = { sourceId: string; calendarAvailable: boolean; events: PlannerEvent[]; fetchedAt: number };
export function effectiveEvents(state: PlannerState, calendars: CalendarSource[]): PlannerEvent[] {
  const overrides = new Map(state.events.filter((e) => e.source === 'calendar').map((e) => [`${e.sourceId}:${e.id}`, e.kind]));
  return [...state.events.filter((e) => e.source !== 'calendar'), ...calendars.filter((c) => c.calendarAvailable).flatMap((c) => c.events.map((e) => ({ ...e, kind: overrides.get(`${c.sourceId}:${e.id}`) ?? e.kind })))];
}
type TimelineInput = Omit<TimelineItem, 'date' | 'originId'>;
export function buildTimeline(state: PlannerState, records: readonly RecordEntry[], calendars: CalendarSource[], from: string, to: string, now = Date.now()): TimelineItem[] {
  const inputs: TimelineInput[] = [];
  const realWork = records.filter((r) => r.type === 'work' && r.source !== 'demo');
  const linked = new Set(realWork.map((r) => r.id));
  const focusedEvents = new Set(state.focusSessions.filter((session) => session.status !== 'cancelled' && session.eventId).map((session) => session.eventId!));
  for (const e of effectiveEvents(state, calendars)) {
    if (e.linkedWorkRecordId && linked.has(e.linkedWorkRecordId)) continue;
    if (focusedEvents.has(e.id)) continue;
    inputs.push({ ...e,
      start: e.allDay ? new Date(`${zonedInput(e.start, e.timeZone).slice(0, 10)}T00:00:00`).getTime() : e.start,
      end: e.allDay ? new Date(`${zonedInput(e.end, e.timeZone).slice(0, 10)}T00:00:00`).getTime() : e.end,
      eventId: e.source === 'calendar' ? undefined : e.id, calendarEvent: e.source === 'calendar' ? e : undefined, sourceLabel: e.source === 'calendar' ? '手机日历' : e.source === 'ics' ? 'ICS导入' : e.source === 'trip' ? '旅记' : e.source === 'hdu' ? '杭电助手' : '手动日程' });
  }
  for (const rule of state.courseRules) {
    for (const e of expandCourse(rule, from, to)) inputs.push({ ...e, courseId: rule.id, courseDate: rule.exceptions.find((x) => x.replacement?.id === e.id)?.date ?? zonedInput(e.start, rule.timeZone).slice(0, 10), sourceLabel: '课程规则' });
  }
  for (const work of realWork) {
    if (work.type !== 'work') continue;
    inputs.push({ id: `work:${work.id}`, workId: work.id, title: work.title, location: '', kind: 'shift', allDay: false, sourceLabel: '已记工时',
      start: new Date(`${work.date}T${work.startTime}`).getTime(), end: new Date(`${work.endTime <= work.startTime ? shiftDate(work.date, 1) : work.date}T${work.endTime}`).getTime() });
  }
  for (const session of state.focusSessions) {
    let available = session.minutes * 60_000;
    session.segments.forEach((segment, i) => {
      const end = Math.min(segment.end ?? now, segment.start + available);
      available -= Math.max(0, end - segment.start);
      if (end > segment.start) inputs.push({ id: `focus:${session.id}:${i}`, title: session.task, location: '', kind: 'focus', start: segment.start, end, allDay: false, sourceLabel: '专注记录', linkedEventId: session.eventId });
    });
  }
  const result: TimelineItem[] = [];
  const rangeStart = new Date(`${from}T00:00:00`).getTime();
  const rangeEnd = new Date(`${shiftDate(to, 1)}T00:00:00`).getTime();
  for (const item of inputs) {
    let start = Math.max(item.start, rangeStart);
    const end = Math.min(item.end, rangeEnd);
    while (start < end) {
      const date = toDateKey(new Date(start));
      const stop = Math.min(end, new Date(`${shiftDate(date, 1)}T00:00:00`).getTime());
      result.push({ ...item, intervalStart: item.start, intervalEnd: item.end, id: `${item.id}:${date}`, originId: item.id, date, start, end: stop });
      start = stop;
    }
  }
  return result.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}
type WarningEvent = Pick<TimelineItem, 'id' | 'title' | 'kind' | 'start' | 'end'> & Partial<Pick<TimelineItem, 'originId' | 'intervalStart' | 'intervalEnd'>>;
export type ScheduleWarning = { key: string; rule: 'overlap' | 'long-shift' | 'exam-near'; text: string; ids: string[]; date: string };
export function scheduleWarnings(events: readonly WarningEvent[]): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const shifts = events.filter((e) => e.kind === 'shift');
  const originals = [...new Map(events.map((e) => [e.originId ?? e.id, e])).values()];
  const courses = originals.filter((e) => e.kind === 'course');
  for (const shift of originals.filter((e) => e.kind === 'shift')) {
    for (const course of courses) {
      const overlap = Math.min(shift.intervalEnd ?? shift.end, course.intervalEnd ?? course.end) - Math.max(shift.intervalStart ?? shift.start, course.intervalStart ?? course.start);
      if (overlap > 15 * 60_000) warnings.push({ key: `overlap:${shift.originId ?? shift.id}:${course.originId ?? course.id}`, rule: 'overlap', text: `${shift.title}与${course.title}重叠${Math.ceil(overlap / 60000)}分钟`, ids: events.filter((e) => (e.originId ?? e.id) === (shift.originId ?? shift.id) || (e.originId ?? e.id) === (course.originId ?? course.id)).map((e) => e.id), date: toDateKey(new Date(shift.start)) });
    }
  }
  const perDay = new Map<string, [number, number][]>();
  for (const shift of shifts) {
    let start = shift.start;
    while (start < shift.end) {
      const day = toDateKey(new Date(start));
      const end = Math.min(shift.end, new Date(`${shiftDate(day, 1)}T00:00:00`).getTime());
      perDay.set(day, [...perDay.get(day) ?? [], [start, end]]);
      start = end;
    }
  }
  for (const [date, intervals] of perDay) {
    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let previousEnd = -Infinity;
    for (const [start, end] of intervals) { total += Math.max(0, end - Math.max(start, previousEnd)); previousEnd = Math.max(end, previousEnd); }
    if (total > 8 * 3600_000) warnings.push({ key: `long-shift:v1:${date}`, rule: 'long-shift', date, text: `${date}排班超过8小时，留点时间休息。`, ids: shifts.filter((s) => toDateKey(new Date(s.start)) === date).map((s) => s.id) });
  }
  for (const exam of events.filter((e) => e.kind === 'exam')) {
    const day = toDateKey(new Date(exam.start));
    for (const shift of shifts) {
      const shiftDay = toDateKey(new Date(shift.start));
      if (shiftDay >= shiftDate(day, -3) && shiftDay < day) warnings.push({ key: `exam:${exam.id}:${shift.id}`, rule: 'exam-near', date: shiftDay, ids: [exam.id, shift.id], text: `${exam.title}临近，不建议新增这段排班；仍可自行安排。` });
    }
  }
  return warnings;
}
