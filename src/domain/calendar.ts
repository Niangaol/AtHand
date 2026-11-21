import { z } from 'zod';
import { eventSchema, idSchema } from './planner.ts';

const stamp = z.number().int().min(946684800000).max(4133980800000);
export const calendarSnapshotSchema = z.object({
  sourceId: idSchema, revision: z.number().int().nonnegative(), rangeStart: stamp, rangeEnd: stamp,
  fetchedAt: stamp, calendarAvailable: z.boolean(), complete: z.boolean(), events: z.array(eventSchema).max(20000),
}).strict().refine((v) => v.rangeEnd > v.rangeStart && v.events.every((e) => e.source === 'calendar' && e.sourceId === v.sourceId) && new Set(v.events.map((e) => e.id)).size === v.events.length);
export const calendarUploadSchema = z.object({
  sourceId: idSchema, requestId: idSchema, baseRevision: z.number().int().nonnegative(), rangeStart: stamp, rangeEnd: stamp,
  fetchedAt: stamp, calendarAvailable: z.boolean(), complete: z.boolean(), events: z.array(eventSchema).max(5000),
}).strict().refine((v) => v.rangeEnd > v.rangeStart && v.rangeEnd - v.rangeStart <= 32 * 86400_000 &&
  (v.calendarAvailable || (!v.complete && v.events.length === 0)) &&
  v.events.every((e) => e.source === 'calendar' && e.sourceId === v.sourceId && e.start < v.rangeEnd && e.end > v.rangeStart) && new Set(v.events.map((e) => e.id)).size === v.events.length);
export type CalendarSnapshot = z.infer<typeof calendarSnapshotSchema>;
export type CalendarUpload = z.infer<typeof calendarUploadSchema>;

export function reconcileCalendar(previous: CalendarSnapshot | null, input: CalendarUpload): CalendarSnapshot {
  const value = calendarUploadSchema.parse(input);
  if (previous && previous.sourceId !== value.sourceId) throw new Error('source_mismatch');
  if ((previous?.revision ?? 0) !== value.baseRevision) throw new Error('conflict');
  const incoming = new Set(value.events.map((e) => e.id));
  const retained = (previous?.events ?? []).filter((e) => !incoming.has(e.id) && !(value.calendarAvailable && value.complete && e.start < value.rangeEnd && e.end > value.rangeStart));
  return calendarSnapshotSchema.parse({ sourceId: value.sourceId, revision: value.baseRevision + 1, rangeStart: value.rangeStart, rangeEnd: value.rangeEnd,
    fetchedAt: value.fetchedAt, calendarAvailable: value.calendarAvailable, complete: value.complete, events: [...retained, ...value.events] });
}
