import { z } from 'zod';
import { startFocus, transitionFocus } from './focus.ts';
import { reconcileTripEvents } from './tripEvents.ts';

export const idSchema = z.string().trim().min(1).max(160);
const title = z.string().trim().min(1).max(100);
const text = z.string().max(10000);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T12:00:00Z`);
  return v >= '2000-01-01' && v <= '2100-12-31' && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
});
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const stamp = z.number().int().min(946684800000).max(4133980800000);
export const safeUrl = z.string().max(2048).refine((v) => {
  try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
});
const timezone = z.string().min(1).max(100).refine((v) => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } });
export const eventSchema = z.object({
  id: idSchema, title, kind: z.enum(['course', 'shift', 'exam', 'deadline', 'event']), location: z.string().max(200),
  start: stamp, end: stamp, allDay: z.boolean(), timeZone: timezone,
  source: z.enum(['manual', 'ics', 'calendar', 'trip', 'hdu']), sourceId: z.string().max(160),
  linkedWorkRecordId: z.string().max(160).optional(),
}).strict().refine((v) => v.end > v.start, '结束时间应晚于开始时间。');
export const courseSchema = z.object({
  id: idSchema, title, location: z.string().max(200), semesterStart: dateSchema, weekday: z.number().int().min(1).max(7),
  startTime: time, endTime: time, firstWeek: z.number().int().min(1).max(60), lastWeek: z.number().int().min(1).max(60),
  parity: z.enum(['all', 'odd', 'even']), timeZone: timezone,
  exceptions: z.array(z.object({ date: dateSchema, replacement: eventSchema.nullable() }).strict()).max(200),
}).strict().refine((v) => v.lastWeek >= v.firstWeek && v.endTime > v.startTime && new Date(`${v.semesterStart}T12:00:00`).getDay() === 1);
export const focusSchema = z.object({
  id: idSchema, task: title, minutes: z.number().int().min(1).max(180), startedAt: stamp,
  status: z.enum(['running', 'paused', 'completed', 'cancelled']),
  segments: z.array(z.object({ start: stamp, end: stamp.nullable() }).strict()).min(1).max(2000),
  owner: idSchema, epoch: z.number().int().positive(), eventId: idSchema.optional(),
}).strict().superRefine((v, ctx) => {
  let total = 0;
  v.segments.forEach((s, i) => {
    if ((s.end !== null && s.end < s.start) || (i > 0 && (v.segments[i - 1].end === null || s.start < v.segments[i - 1].end!))) ctx.addIssue({ code: 'custom', message: '专注时间片无效。' });
    if (s.end === null && (i !== v.segments.length - 1 || v.status !== 'running')) ctx.addIssue({ code: 'custom', message: '活动时间片状态不一致。' });
    if (s.end !== null) total += s.end - s.start;
  });
  if (v.startedAt !== v.segments[0].start || (v.status === 'running' && v.segments.at(-1)!.end !== null) || total > v.minutes * 60_000 || (v.status === 'completed' && total !== v.minutes * 60_000)) ctx.addIssue({ code: 'custom', message: '专注时长无效。' });
});
export const countdownSchema = z.object({ id: idSchema, title, kind: z.enum(['document', 'birthday']), date: dateSchema }).strict();
export const serviceSchema = z.object({
  id: idSchema, title, category: z.string().min(1).max(40), entryType: z.enum(['web', 'wechat', 'offline']), entry: z.string().min(1).max(2048),
  materials: text, hours: text, steps: text, sourceUrl: z.union([safeUrl, z.literal('')]), sourceUpdated: dateSchema.nullable(), verifiedAt: dateSchema.nullable(),
  miniProgramQr: z.union([safeUrl, z.literal('')]),
}).strict().refine((v) => v.entryType !== 'web' || safeUrl.safeParse(v.entry).success);
const tripItem = z.object({
  id: idSchema, text: z.string().trim().min(1).max(2000),
  startTime: z.union([time, z.literal('')]).default(''), endTime: z.union([time, z.literal('')]).default(''),
  location: z.string().trim().max(200).default(''),
}).strict().refine((v) => !v.startTime || !v.endTime || v.endTime > v.startTime, '结束时间应晚于开始时间。');
const tripPacking = z.object({ id: idSchema, text: z.string().trim().min(1).max(2000), checked: z.boolean() }).strict();
const tripLeg = z.object({
  id: idSchema, mode: z.enum(['train', 'flight', 'bus', 'car', 'other']).default('train'),
  from: title, to: title, date: dateSchema, departTime: z.union([time, z.literal('')]).default(''), arriveTime: z.union([time, z.literal('')]).default(''),
  ref: z.string().trim().max(100).default(''), arriveDate: z.union([dateSchema, z.literal('')]).default(''),
}).strict().refine((v) => !v.arriveDate || v.arriveDate >= v.date, '抵达日期不能早于出发日期。');
const tripStay = z.object({
  id: idSchema, name: title, address: z.string().trim().max(200).default(''), checkIn: dateSchema, checkOut: dateSchema, ref: z.string().trim().max(100).default(''),
}).strict().refine((v) => v.checkOut >= v.checkIn, '退房日期不能早于入住日期。');
const tripBudget = z.object({
  totalCents: z.number().int().min(0).max(1_000_000_000).default(0),
  items: z.array(z.object({ id: idSchema, label: title, amountCents: z.number().int().min(0).max(1_000_000_000), note: z.string().max(500).default('') }).strict()).max(200).default([]),
}).strict();
const tripTodo = z.object({ id: idSchema, text: z.string().trim().min(1).max(200), done: z.boolean() }).strict();
const tripSchedule = z.object({
  timeZone: timezone,
  legs: z.array(idSchema).max(100), stays: z.array(idSchema).max(100), items: z.array(idSchema).max(300),
}).strict();
const unique = <T extends { id: string }>(values: T[]) => new Set(values.map((v) => v.id)).size === values.length;
export const tripSchema = z.object({
  id: idSchema, title, startDate: dateSchema, endDate: dateSchema, notes: text.default(''), packingSource: z.string().max(100).default(''),
  days: z.array(z.object({ date: dateSchema, items: z.array(tripItem).max(100) }).strict()).max(366),
  packing: z.array(tripPacking).max(300),
  visits: z.array(z.object({ id: idSchema, cityId: idSchema, city: title, date: dateSchema, latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), visited: z.boolean() }).strict()).max(200),
  transport: z.array(tripLeg).max(100).default([]).refine(unique),
  lodging: z.array(tripStay).max(100).default([]).refine(unique),
  budget: tripBudget.default(() => ({ totalCents: 0, items: [] })).refine((v) => unique(v.items)),
  todos: z.array(tripTodo).max(300).default([]).refine(unique),
  schedule: tripSchedule.optional(),
}).strict().refine((v) => v.endDate >= v.startDate && Date.parse(v.endDate) - Date.parse(v.startDate) < 366 * 86400000 &&
  v.days.every((d) => d.date >= v.startDate && d.date <= v.endDate && unique(d.items)) && new Set(v.days.map((d) => d.date)).size === v.days.length &&
  v.visits.every((visit) => visit.date >= v.startDate && visit.date <= v.endDate) && unique(v.visits) && unique(v.packing));
export const plannerSchema = z.object({
  version: z.literal(1), events: z.array(eventSchema).max(10000).refine(unique), courseRules: z.array(courseSchema).max(200).refine(unique),
  focusSessions: z.array(focusSchema).max(20000).refine(unique).refine((v) => v.filter((s) => s.status === 'running' || s.status === 'paused').length <= 1),
  countdowns: z.array(countdownSchema).max(1000).refine(unique), trips: z.array(tripSchema).max(500).refine(unique), serviceEntries: z.array(serviceSchema).max(1000).refine(unique),
  preferences: z.object({ focusMinutes: z.number().int().min(1).max(180) }).strict(),
  reminderReceipts: z.array(z.string().max(100)).max(10000),
}).strict();
export type PlannerState = z.infer<typeof plannerSchema>;
export type PlannerEvent = z.infer<typeof eventSchema>;
export type CourseRule = z.infer<typeof courseSchema>;
export type Countdown = z.infer<typeof countdownSchema>;
export type Trip = z.infer<typeof tripSchema>;
export type ServiceEntry = z.infer<typeof serviceSchema>;
export const collectionSchema = z.enum(['events', 'courseRules', 'countdowns', 'trips', 'serviceEntries']);
export type Collection = z.infer<typeof collectionSchema>;
export type Entity = PlannerState[Collection][number];
export const commandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('put'), collection: collectionSchema, value: z.unknown() }).strict(),
  z.object({ kind: z.literal('delete'), collection: collectionSchema, id: idSchema }).strict(),
  z.object({ kind: z.literal('events.import'), sourceId: idSchema, from: stamp, to: stamp, complete: z.boolean(), events: z.array(eventSchema).max(2000).refine(unique) }).strict().refine((v) => v.to > v.from && v.events.every((e) => e.source === 'ics' && e.sourceId === v.sourceId && e.start < v.to && e.end > v.from)),
  z.object({ kind: z.literal('focus.import'), value: focusSchema.refine((v) => v.status === 'completed' || v.status === 'cancelled') }).strict(),
  z.object({ kind: z.literal('focus.start'), id: idSchema, task: title, minutes: z.number().int().min(1).max(180), owner: idSchema, eventId: idSchema.optional() }).strict(),
  z.object({ kind: z.literal('focus.control'), id: idSchema, action: z.enum(['pause', 'resume', 'complete', 'cancel', 'takeover']), owner: idSchema, epoch: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('preferences'), focusMinutes: z.number().int().min(1).max(180) }).strict(),
  z.object({ kind: z.literal('reminder'), key: z.string().min(1).max(100) }).strict(),
]);
export type PlannerCommand = z.infer<typeof commandSchema>;
export function createPlannerState(): PlannerState {
  return { version: 1, events: [], courseRules: [], focusSessions: [], countdowns: [], trips: [], serviceEntries: [], preferences: { focusMinutes: 25 }, reminderReceipts: [] };
}
const schemas = { events: eventSchema, courseRules: courseSchema, countdowns: countdownSchema, trips: tripSchema, serviceEntries: serviceSchema };
export function commandKey(command: PlannerCommand): string {
  if (command.kind === 'put') { const value = schemas[command.collection].parse(command.value); return command.collection === 'events' ? 'events' : `${command.collection}:${value.id}`; }
  if (command.kind === 'delete') return command.collection === 'events' ? 'events' : `${command.collection}:${command.id}`;
  if (command.kind === 'events.import') return 'events';
  if (command.kind === 'focus.import') return `focusHistory:${command.value.id}`;
  if (command.kind.startsWith('focus.')) return 'focus';
  return command.kind === 'reminder' ? `reminder:${command.key}` : 'preferences';
}
export function applyCommand(state: PlannerState, input: PlannerCommand, now: number): PlannerState {
  const command = commandSchema.parse(input);
  const next = structuredClone(state);
  if (command.kind === 'put' && command.collection === 'events') {
    const value = eventSchema.parse(command.value);
    if (value.source === 'trip') throw new Error('旅记生成的日程请在旅记里修改。');
    const existing = next.events.find((event) => event.id === value.id);
    if (existing?.source === 'trip') throw new Error('旅记生成的日程请在旅记里修改。');
    if (existing) next.events[next.events.indexOf(existing)] = value; else next.events.push(value);
  } else if (command.kind === 'put' && command.collection === 'trips') {
    const value = tripSchema.parse(command.value);
    const index = next.trips.findIndex((item) => item.id === value.id);
    if (index === -1) next.trips.push(value); else next.trips[index] = value;
    if (value.schedule) {
      const legIds = new Set(value.transport.map((leg) => leg.id));
      const stayIds = new Set(value.lodging.map((stay) => stay.id));
      const itemIds = new Set(value.days.flatMap((day) => day.items.map((item) => item.id)));
      const linkedOk = value.schedule.legs.every((id) => legIds.has(id))
        && value.schedule.stays.every((id) => stayIds.has(id))
        && value.schedule.items.every((id) => itemIds.has(id));
      if (!linkedOk) throw new Error('旅记日程链接的计划已不存在，请刷新后重新选择。');
      next.events = reconcileTripEvents(next.events, value);
    }
  } else if (command.kind === 'put') {
    const value = schemas[command.collection].parse(command.value);
    const items = next[command.collection] as Entity[];
    const index = items.findIndex((item) => item.id === value.id);
    if (index === -1) items.push(value); else items[index] = value;
  } else if (command.kind === 'delete' && command.collection === 'events') {
    const target = next.events.find((event) => event.id === command.id);
    if (target?.source === 'trip') throw new Error('旅记生成的日程请在旅记里取消，不能直接删除。');
    next.events = next.events.filter((v) => v.id !== command.id);
  } else if (command.kind === 'delete' && command.collection === 'trips') {
    next.trips = next.trips.filter((v) => v.id !== command.id);
    next.events = next.events.filter((event) => !(event.source === 'trip' && event.sourceId === command.id));
  } else if (command.kind === 'delete') {
    Object.assign(next, { [command.collection]: next[command.collection].filter((v) => v.id !== command.id) });
  } else if (command.kind === 'events.import') {
    const incomingIds = new Set(command.events.map((e) => e.id));
    if (state.events.some((e) => incomingIds.has(e.id) && (e.source !== 'ics' || e.sourceId !== command.sourceId))) throw new Error('导入记录标识与其他来源冲突。');
    next.events = [...state.events.filter((e) => !incomingIds.has(e.id) && !(command.complete && e.source === 'ics' && e.sourceId === command.sourceId && e.start < command.to && e.end > command.from)), ...command.events];
  } else if (command.kind === 'focus.import') {
    if (next.focusSessions.some((s) => s.id === command.value.id)) throw new Error('专注记录已存在。');
    next.focusSessions.push(command.value);
  } else if (command.kind === 'focus.start') {
    if (next.focusSessions.some((s) => s.status === 'running' || s.status === 'paused')) throw new Error('已有进行中的专注，请先完成或结束。');
    if (next.focusSessions.some((s) => s.id === command.id)) throw new Error('专注记录已存在。');
    if (command.eventId) {
      const linked = next.events.find((event) => event.id === command.eventId);
      if (!linked) throw new Error('要开始专注的日程已不存在。');
      if (linked.source !== 'manual') throw new Error('只能从手动日程开始专注。');
    }
    next.focusSessions.push(startFocus(command.id, command.task, command.minutes, now, command.owner, command.eventId));
    next.preferences.focusMinutes = command.minutes;
  } else if (command.kind === 'focus.control') {
    const index = next.focusSessions.findIndex((s) => s.id === command.id);
    if (index < 0) throw new Error('专注记录不存在。');
    next.focusSessions[index] = transitionFocus(next.focusSessions[index], command.action, now, command.owner, command.epoch);
  } else if (command.kind === 'preferences') next.preferences.focusMinutes = command.focusMinutes;
  else if (!next.reminderReceipts.includes(command.key)) next.reminderReceipts.push(command.key);
  return plannerSchema.parse(next);
}
