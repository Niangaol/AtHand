import { describe, expect, it } from 'vitest';
import { parseIcs } from './icsImport';

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Shunshou test//EN\r\n${body}\r\nEND:VCALENDAR`;
const one = 'BEGIN:VEVENT\r\nUID:math\r\nDTSTART;TZID=Asia/Shanghai:20261121T090000\r\nDTEND;TZID=Asia/Shanghai:20261121T100000\r\nSUMMARY:数学\r\nLOCATION:A101\r\nEND:VEVENT';
describe('ICS import preview', () => {
  it('does not mark a truncated set of independent events complete', async () => {
    const body = Array.from({ length: 2001 }, (_, i) => one.replace('UID:math', `UID:item-${i}`)).join('\r\n');
    const preview = await parseIcs(wrap(body), '大课表', '2026-11-01', '2026-12-01', 'Asia/Shanghai');
    expect(preview.events).toHaveLength(2000);
    expect(preview.complete).toBe(false);
  });
  it('includes exceptions moved into range from far outside it', async () => {
    const master = one.replace('SUMMARY:数学', 'RRULE:FREQ=WEEKLY;COUNT=30\r\nSUMMARY:数学');
    const moved = 'BEGIN:VEVENT\r\nUID:math\r\nRECURRENCE-ID;TZID=Asia/Shanghai:20270220T090000\r\nDTSTART;TZID=Asia/Shanghai:20261122T110000\r\nDTEND;TZID=Asia/Shanghai:20261122T120000\r\nSUMMARY:提前调课\r\nEND:VEVENT';
    const preview = await parseIcs(wrap(`${master}\r\n${moved}`), '课表', '2026-11-21', '2026-11-22', 'Asia/Shanghai');
    expect(preview.events.map((e) => e.title)).toEqual(['数学', '提前调课']);
  });
  it('honors timezone without VTIMEZONE and keeps stable occurrence IDs across reimport', async () => {
    const first = await parseIcs(wrap(one), '课程文件', '2026-11-01', '2026-12-01', 'Asia/Shanghai');
    const again = await parseIcs(wrap(one), '课程文件', '2026-11-01', '2026-12-01', 'Asia/Shanghai');
    expect(first.complete).toBe(true);
    expect(first.events).toHaveLength(1);
    expect(new Date(first.events[0].start).toISOString()).toBe('2026-11-21T01:00:00.000Z');
    expect(first.events[0].id).toBe(again.events[0].id);
    expect(first.events[0].kind).toBe('event');
  });
  it('expands repeats, EXDATE and moved exceptions using the original recurrence identity', async () => {
    const master = one.replace('SUMMARY:数学', 'RRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE;TZID=Asia/Shanghai:20261128T090000\r\nSUMMARY:数学');
    const moved = 'BEGIN:VEVENT\r\nUID:math\r\nRECURRENCE-ID;TZID=Asia/Shanghai:20261205T090000\r\nDTSTART;TZID=Asia/Shanghai:20261206T110000\r\nDTEND;TZID=Asia/Shanghai:20261206T120000\r\nSUMMARY:调课\r\nEND:VEVENT';
    const preview = await parseIcs(wrap(`${master}\r\n${moved}`), '课程', '2026-11-01', '2026-12-31', 'Asia/Shanghai');
    expect(preview.events.map((e) => e.title)).toEqual(['数学', '调课']);
    expect(new Date(preview.events[1].start).toISOString()).toBe('2026-12-06T03:00:00.000Z');
  });
  it('handles cancellation without DTSTART and all-day exclusive DTEND', async () => {
    const allDay = 'BEGIN:VEVENT\r\nUID:holiday\r\nDTSTART;VALUE=DATE:20261121\r\nDTEND;VALUE=DATE:20261123\r\nSUMMARY:休息\r\nEND:VEVENT';
    const cancelled = 'BEGIN:VEVENT\r\nUID:math\r\nSTATUS:CANCELLED\r\nEND:VEVENT';
    const preview = await parseIcs(wrap(`${allDay}\r\n${cancelled}`), '课程', '2026-11-01', '2026-12-01', 'Asia/Shanghai');
    expect(preview.complete).toBe(true);
    expect(preview.events).toHaveLength(1);
    expect(preview.events[0].allDay).toBe(true);
    expect(preview.events[0].end - preview.events[0].start).toBe(48 * 3600_000);
  });
  it('marks unsupported expansion incomplete instead of reporting an empty valid source', async () => {
    const preview = await parseIcs(wrap(one.replace('SUMMARY:数学', 'RRULE:FREQ=SECONDLY\r\nSUMMARY:数学')), '课程', '2026-11-01', '2026-12-01', 'Asia/Shanghai');
    expect(preview.complete).toBe(false);
    expect(preview.warnings.length).toBeGreaterThan(0);
    await expect(parseIcs('x'.repeat(1_100_000), '课程', '2026-11-01', '2026-12-01', 'Asia/Shanghai')).rejects.toThrow();
  });
});
