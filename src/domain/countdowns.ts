import type { PlannerState } from './planner.ts';
import { dateSchema } from './planner.ts';
import { toDateKey } from './dates.ts';
import { effectiveEvents, zonedInput, type CalendarSource } from './schedule.ts';

export type CountdownItem = { id: string; title: string; date: string; kind: 'exam' | 'deadline' | 'document' | 'birthday'; days: number; note: string };
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);
export function getCountdowns(state: PlannerState, today: string, calendars: CalendarSource[] = []): CountdownItem[] {
  const items: CountdownItem[] = [];
  for (const event of effectiveEvents(state, calendars)) {
    if (event.kind !== 'exam' && event.kind !== 'deadline') continue;
    const date = event.allDay ? zonedInput(event.start, event.timeZone).slice(0, 10) : toDateKey(new Date(event.start));
    items.push({ id: `event:${event.id}`, title: event.title, date, kind: event.kind, days: daysBetween(today, date), note: '' });
  }
  for (const item of state.countdowns) {
    let date = item.date;
    let note = '';
    if (item.kind === 'birthday') {
      const occurrence = (year: number) => {
        const value = `${year}${item.date.slice(4)}`;
        if (dateSchema.safeParse(value).success) return value;
        note = '2月29日生日在非闰年按2月28日计算';
        return `${year}-02-28`;
      };
      const year = Number(today.slice(0, 4));
      date = occurrence(year);
      if (date < today) date = occurrence(year + 1);
    }
    items.push({ ...item, date, days: daysBetween(today, date), note });
  }
  return items.sort((a, b) => Number(a.days < 0) - Number(b.days < 0) || (a.days < 0 && b.days < 0 ? b.days - a.days : a.days - b.days) || a.id.localeCompare(b.id));
}
