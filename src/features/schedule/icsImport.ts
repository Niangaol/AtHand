import ICAL from 'ical.js';
import { eventSchema, dateSchema } from '../../domain/planner';
import type { PlannerEvent } from '../../domain/planner';
import { shiftDate } from '../../domain/dates';
import { zonedTimestamp } from '../../domain/schedule';

export type IcsPreview = { events: PlannerEvent[]; warnings: string[]; complete: boolean; sourceId: string; from: number; to: number };
const MAX_INSTANCES = 2000;
const MAX_ITERATIONS = 10000;
const value = (component: ICAL.Component, key: string) => String(component.getFirstPropertyValue(key) ?? '');
const pad = (n: number) => String(n).padStart(2, '0');
const wall = (time: ICAL.Time) => `${time.year}-${pad(time.month)}-${pad(time.day)}T${pad(time.hour)}:${pad(time.minute)}`;
async function hash(value: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function eventZone(component: ICAL.Component, property: string, fallback: string): string {
  return String(component.getFirstProperty(property)?.getParameter('tzid') ?? fallback);
}
function instant(time: ICAL.Time, zone: string, root: ICAL.Component): number {
  if (time.zone.tzid === 'UTC') return time.toUnixTime() * 1000;
  if (root.getAllSubcomponents('vtimezone').some((c) => value(c, 'tzid') === zone)) return time.toUnixTime() * 1000;
  return zonedTimestamp(wall(time), zone) + time.second * 1000;
}
function knownIana(zone: string): boolean { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; } }

export async function parseIcs(text: string, sourceName: string, fromDate: string, toDate: string, fallbackZone: string): Promise<IcsPreview> {
  if (new TextEncoder().encode(text).length > 1_000_000) throw new Error('ICS文件不能超过1MB。');
  dateSchema.parse(fromDate); dateSchema.parse(toDate);
  if (!sourceName.trim() || sourceName.length > 100) throw new Error('请填写不超过100字的来源名称。');
  if (toDate < fromDate || Date.parse(toDate) - Date.parse(fromDate) > 400 * 86400_000) throw new Error('导入范围不能超过400天。');
  const from = zonedTimestamp(`${fromDate}T00:00`, fallbackZone);
  const to = zonedTimestamp(`${shiftDate(toDate, 1)}T00:00`, fallbackZone);
  const sourceId = `ics:${await hash(sourceName.trim())}`;
  const result: IcsPreview = { events: [], warnings: [], complete: true, sourceId, from, to };
  const root = new ICAL.Component(ICAL.parse(text));
  if (root.name !== 'vcalendar') throw new Error('文件不是有效的iCalendar日历。');
  const components = root.getAllSubcomponents('vevent');
  if (components.length > 3000) throw new Error('文件事件过多，请分批导出。');
  if (root.getAllSubcomponents('vtodo').length) result.warnings.push('文件中的待办（VTODO）未导入，请手动添加截止日期。');
  const groups = new Map<string, ICAL.Component[]>();
  for (const component of components) {
    const uid = value(component, 'uid');
    if (!uid || uid.length > 2048) { result.warnings.push('有事件缺少有效UID，未导入。'); continue; }
    groups.set(uid, [...groups.get(uid) ?? [], component]);
  }
  let iterations = 0;
  for (const [uid, group] of groups) {
    try {
      const latest = new Map<string, ICAL.Component>();
      for (const c of group) {
        const key = value(c, 'recurrence-id');
        const previous = latest.get(key);
        if (!previous || Number(value(c, 'sequence') || 0) >= Number(value(previous, 'sequence') || 0)) latest.set(key, c);
      }
      const master = latest.get('');
      if (!master) throw new Error('缺少重复事件主记录');
      if (value(master, 'status').toUpperCase() === 'CANCELLED') continue;
      const exceptions = [...latest.entries()].filter(([key]) => key !== '');
      if (exceptions.some(([, c]) => c.getFirstProperty('recurrence-id')?.getParameter('range'))) throw new Error('暂不支持THISANDFUTURE调课，请分开导出');
      const cancelled = new Set(exceptions.filter(([, c]) => value(c, 'status').toUpperCase() === 'CANCELLED').map(([key]) => key));
      const event = new ICAL.Event(master, { exceptions: exceptions.filter(([, c]) => value(c, 'status').toUpperCase() !== 'CANCELLED').map(([, c]) => c) });
      const recurrenceTypes = event.getRecurrenceTypes();
      if (recurrenceTypes.SECONDLY || recurrenceTypes.MINUTELY || recurrenceTypes.HOURLY) throw new Error('不支持高频重复规则');
      const lastOriginalDate = exceptions.reduce((last, [key]) => key.slice(0, 10) > last ? key.slice(0, 10) : last, shiftDate(toDate, 7));
      const iterator = event.iterator();
      let occurrence: ICAL.Time | null;
      while ((occurrence = iterator.next())) {
        if (++iterations > MAX_ITERATIONS || result.events.length >= MAX_INSTANCES) throw new Error('重复规则超出本次展开上限');
        if (occurrence.toString().slice(0, 10) > lastOriginalDate) break;
        if (cancelled.has(occurrence.toString())) continue;
        const details = event.getOccurrenceDetails(occurrence);
        const item = details.item;
        const startZone = eventZone(item.component, 'dtstart', fallbackZone);
        const endZone = eventZone(item.component, 'dtend', startZone);
        const start = instant(details.startDate, startZone, root);
        const end = instant(details.endDate, endZone, root);
        if (start >= to || end <= from) continue;
        const id = `ics:${await hash(`${sourceId}\n${uid}\n${occurrence.toString()}`)}`;
        const timeZone = details.startDate.zone.tzid === 'UTC' ? 'UTC' : knownIana(startZone) ? startZone : fallbackZone;
        result.events.push(eventSchema.parse({ id, title: item.summary || '(无标题日程)', kind: 'event', location: item.location || '', start, end,
          allDay: details.startDate.isDate, timeZone, source: 'ics', sourceId }));
      }
    } catch (error) { result.warnings.push(`有一组事件未完整导入：${error instanceof Error && error.name !== 'ZodError' ? error.message : '字段格式不正确'}。`); }
    if (iterations > MAX_ITERATIONS || result.events.length >= MAX_INSTANCES) {
      result.warnings.push('已达到本次展开上限，按部分结果合并，不删除旧日程。');
      break;
    }
  }
  result.complete = result.warnings.length === 0;
  result.events.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return result;
}
