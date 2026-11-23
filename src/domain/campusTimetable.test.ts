import { describe, expect, it } from 'vitest';
import { parseSections, sectionClock, semesterMonday, weekRanges } from './campusTimetable';

describe('campus timetable parsing', () => {
  it('maps official HDU section ranges to clock times', () => {
    expect(sectionClock('1-2')).toEqual({ startTime: '08:05', endTime: '09:40' });
    expect(sectionClock('6-8')).toEqual({ startTime: '13:30', endTime: '16:00' });
    expect(sectionClock('10')).toEqual({ startTime: '18:30', endTime: '19:15' });
    expect(sectionClock('13')).toBeNull();
    expect(parseSections('第 6-8 节')).toEqual({ first: 6, last: 8 });
  });

  it('expands contiguous weeks and keeps odd/even parity', () => {
    expect(weekRanges('1-16周')).toEqual([{ firstWeek: 1, lastWeek: 16, parity: 'all' }]);
    expect(weekRanges('第1-15周（单）')).toEqual([{ firstWeek: 1, lastWeek: 15, parity: 'odd' }]);
    expect(weekRanges('2-16周(双)')).toEqual([{ firstWeek: 2, lastWeek: 16, parity: 'even' }]);
    expect(weekRanges('1-8,10-16')).toEqual([{ firstWeek: 1, lastWeek: 8, parity: 'all' }, { firstWeek: 10, lastWeek: 16, parity: 'all' }]);
    expect(weekRanges('没有周次')).toEqual([]);
  });

  it('anchors semester rules on the Monday of the opening week', () => {
    expect(semesterMonday('2026-09-07')).toBe('2026-09-07');
    expect(semesterMonday('2026-09-09')).toBe('2026-09-07');
    expect(semesterMonday('2026-09-13')).toBe('2026-09-07');
  });
});
