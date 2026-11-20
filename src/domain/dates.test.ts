import { describe, expect, it } from 'vitest';
import { getMonthRange, getWeekRange, shiftDate, toDateKey } from './dates';

describe('local calendar dates', () => {
  it('finds leap month boundaries and validates month input', () => {
    expect(getMonthRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(getMonthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(() => getMonthRange('2026-13')).toThrow();
  });
  it('keeps Sunday in the preceding Monday week', () => {
    expect(getWeekRange('2026-11-22')).toEqual({ start: '2026-11-16', end: '2026-11-22' });
  });
  it('spans year boundaries', () => {
    expect(getWeekRange('2027-01-01')).toEqual({ start: '2026-12-28', end: '2027-01-03' });
  });
  it('moves across months and leap days', () => {
    expect(shiftDate('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDate('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('uses the local date instead of the UTC date', () => {
    expect(toDateKey(new Date(2026, 10, 20, 0, 5))).toBe('2026-11-20');
  });
});
