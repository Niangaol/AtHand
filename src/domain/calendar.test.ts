import { describe, expect, it } from 'vitest';
import { reconcileCalendar } from './calendar';
import type { CalendarSnapshot, CalendarUpload } from './calendar';

const start = Date.parse('2026-11-21T00:00:00+08:00');
const event = (id: string, at = start + 3600_000) => ({ id, title: id, location: '', kind: 'event' as const, start: at, end: at + 3600_000, allDay: false, timeZone: 'Asia/Shanghai', source: 'calendar' as const, sourceId: 'phone-a' });
const upload = (fields: Partial<CalendarUpload> = {}): CalendarUpload => ({ sourceId: 'phone-a', requestId: 'request', baseRevision: 0, calendarAvailable: true, complete: true, rangeStart: start, rangeEnd: start + 14 * 86400_000, fetchedAt: start + 1000, events: [event('one')], ...fields });
describe('calendar source snapshots', () => {
  it('accepts more than thirty events without truncating the source', () => {
    const result = reconcileCalendar(null, upload({ events: Array.from({ length: 45 }, (_, i) => event(String(i))) }));
    expect(result.events).toHaveLength(45);
  });
  it('only deletes missing entries inside the same successful complete window', () => {
    const first: CalendarSnapshot = { ...reconcileCalendar(null, upload()), events: [event('one'), event('outside', start - 86400_000)] };
    const partial = reconcileCalendar(first, upload({ baseRevision: 1, complete: false, events: [] }));
    expect(partial.events).toHaveLength(2);
    const full = reconcileCalendar(partial, upload({ baseRevision: 2, events: [] }));
    expect(full.events.map((e) => e.id)).toEqual(['outside']);
  });
  it('retains old data but marks it unavailable when calendar permission is revoked', () => {
    const first = reconcileCalendar(null, upload());
    const revoked = reconcileCalendar(first, upload({ baseRevision: 1, calendarAvailable: false, complete: false, events: [] }));
    expect(revoked.calendarAvailable).toBe(false);
    expect(revoked.events).toHaveLength(1);
  });
  it('rejects stale revisions, mixed sources and incomplete unavailable payloads', () => {
    const first = reconcileCalendar(null, upload());
    expect(() => reconcileCalendar(first, upload())).toThrow('conflict');
    expect(() => reconcileCalendar(null, upload({ events: [{ ...event('other'), sourceId: 'other-device' }] }))).toThrow();
    expect(() => reconcileCalendar(null, upload({ calendarAvailable: false }))).toThrow();
  });
});
