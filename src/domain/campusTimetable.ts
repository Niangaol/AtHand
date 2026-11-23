import { shiftDate } from './dates.ts';

export type SectionTime = { section: number; startTime: string; endTime: string };
export type WeekRange = { firstWeek: number; lastWeek: number; parity: 'all' | 'odd' | 'even' };

/** 下沙校区官方作息（hdu.edu.cn/770/list.htm，2026-11-22 核对）。 */
export const SECTION_TIMES: readonly SectionTime[] = [
  { section: 1, startTime: '08:05', endTime: '08:50' },
  { section: 2, startTime: '08:55', endTime: '09:40' },
  { section: 3, startTime: '10:00', endTime: '10:45' },
  { section: 4, startTime: '10:50', endTime: '11:35' },
  { section: 5, startTime: '11:40', endTime: '12:25' },
  { section: 6, startTime: '13:30', endTime: '14:15' },
  { section: 7, startTime: '14:20', endTime: '15:05' },
  { section: 8, startTime: '15:15', endTime: '16:00' },
  { section: 9, startTime: '16:05', endTime: '16:50' },
  { section: 10, startTime: '18:30', endTime: '19:15' },
  { section: 11, startTime: '19:20', endTime: '20:05' },
  { section: 12, startTime: '20:10', endTime: '20:55' },
];

export function parseSections(value: string | null): { first: number; last: number } | null {
  if (!value) return null;
  const text = value.replace(/第|节|\s/g, '');
  const match = text.match(/^(\d{1,2})(?:\s*[-~—–至]\s*(\d{1,2}))?$/);
  if (!match) return null;
  const first = Number(match[1]);
  const last = Number(match[2] ?? match[1]);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last > 12 || last < first) return null;
  return { first, last };
}

export function sectionClock(value: string | null): { startTime: string; endTime: string } | null {
  const range = parseSections(value);
  if (!range) return null;
  const start = SECTION_TIMES.find((item) => item.section === range.first);
  const end = SECTION_TIMES.find((item) => item.section === range.last);
  return start && end ? { startTime: start.startTime, endTime: end.endTime } : null;
}

export function weekRanges(value: string | null): WeekRange[] {
  if (!value) return [];
  let text = String(value).replace(/[（）()]/g, '').replace(/\s/g, '').replace(/第/g, '').replace(/周/g, '');
  const parity = text.includes('单') ? 'odd' : text.includes('双') ? 'even' : 'all';
  text = text.replace(/单|双/g, '');
  const ranges: WeekRange[] = [];
  for (const part of text.split(/[,，、;；]/)) {
    const match = part.match(/^(\d{1,2})(?:[-~—–至](\d{1,2}))?$/);
    if (!match) continue;
    const firstWeek = Number(match[1]);
    const lastWeek = Number(match[2] ?? match[1]);
    if (!Number.isInteger(firstWeek) || !Number.isInteger(lastWeek) || firstWeek < 1 || lastWeek > 60 || lastWeek < firstWeek) continue;
    ranges.push({ firstWeek, lastWeek, parity });
  }
  return ranges;
}

export function semesterMonday(date: string): string {
  const day = new Date(`${date}T12:00:00`).getDay();
  return shiftDate(date, -((day + 6) % 7));
}
