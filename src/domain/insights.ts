import type { PlannerState } from './planner.ts';
import type { RecordEntry } from './records.ts';
import { buildTimeline, scheduleWarnings, type CalendarSource } from './schedule.ts';
import { getCountdowns } from './countdowns.ts';
import { focusedSecondsBetween, remainingSeconds, type FocusSession } from './focus.ts';
import { summarize } from './summary.ts';
import { shiftDate } from './dates.ts';

export type DayBrief = {
  date: string;
  items: { title: string; start: number; end: number; kind: string; location: string; source: string }[];
  next: { title: string; start: number; kind: string } | null;
  countdowns: { title: string; date: string; days: number; kind: string }[];
  expenseCents: number;
  workMinutes: number;
  focusMinutes: number;
  activeFocus: { task: string; remainingMinutes: number } | null;
  warnings: string[];
};

const dayBounds = (date: string) => ({
  start: new Date(`${date}T00:00:00`).getTime(),
  end: new Date(`${shiftDate(date, 1)}T00:00:00`).getTime(),
});

function realRecords(records: readonly RecordEntry[]): readonly RecordEntry[] {
  return records.filter((item) => item.source !== 'demo');
}

function active(state: PlannerState): FocusSession | null {
  return state.focusSessions.find((session) => session.status === 'running' || session.status === 'paused') ?? null;
}

export function buildDayBrief(
  state: PlannerState, records: readonly RecordEntry[], calendars: CalendarSource[], today: string, now = Date.now(),
): DayBrief {
  const timeline = buildTimeline(state, realRecords(records), calendars, today, today, now);
  const bounds = dayBounds(today);
  const summary = summarize(realRecords(records), today, today);
  const running = active(state);
  return {
    date: today,
    items: timeline.slice(0, 12).map((item) => ({
      title: item.title, start: item.start, end: item.end, kind: item.kind, location: item.location, source: item.sourceLabel,
    })),
    next: timeline.find((item) => item.start >= now) ?? null,
    countdowns: getCountdowns(state, today, calendars)
      .filter((item) => item.days >= 0 && item.days <= 7)
      .slice(0, 3)
      .map((item) => ({ title: item.title, date: item.date, days: item.days, kind: item.kind })),
    expenseCents: summary.expenseCents,
    workMinutes: summary.workMinutes,
    focusMinutes: Math.floor(focusedSecondsBetween(state.focusSessions, bounds.start, bounds.end, now) / 60),
    activeFocus: running ? { task: running.task, remainingMinutes: Math.ceil(remainingSeconds(running, now) / 60) } : null,
    warnings: scheduleWarnings(timeline).map((warning) => warning.text),
  };
}
