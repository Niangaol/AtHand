import { describe, expect, it } from 'vitest';
import type { CampusCalendar, CampusCourse, CampusExam } from '../features/campus/campusTypes';
import { buildCampusExamEvents, buildCampusRules, previewCampus } from './campusSync';

const calendar: CampusCalendar = { schoolYear: '2026-2027', semester: '1', startDate: '2026-09-09', endDate: '2027-01-17', weekNow: 10, termWeeks: 18 };
const course = (overrides: Partial<CampusCourse> = {}): CampusCourse => ({
  id: 'hdu:course:abc', name: '高等数学', teacher: '王老师', location: '六教422', weekday: 2,
  startTime: null, endTime: null, sections: '1-2', weeks: '1-16', parity: 'all', ...overrides,
});
const exam = (overrides: Partial<CampusExam> = {}): CampusExam => ({
  id: 'hdu:exam:abc', course: '线性代数', date: '2026-12-20', startTime: '09:00', endTime: '11:00', location: 'A101', seat: '12', ...overrides,
});

describe('campus sync', () => {
  it('turns weekday courses into semester-anchored course rules with official section times', () => {
    const { rules, warnings } = buildCampusRules([course()], calendar, 'Asia/Shanghai');
    expect(warnings).toEqual([]);
    expect(rules[0]).toMatchObject({
      id: 'hdu:course:abc', title: '高等数学', weekday: 2, semesterStart: '2026-09-07',
      startTime: '08:05', endTime: '09:40', firstWeek: 1, lastWeek: 16, parity: 'all',
    });
  });

  it('splits non-contiguous weeks into stable rules and skips un-timeable courses with warnings', () => {
    const split = buildCampusRules([course({ weeks: '1-8,10-16' })], calendar, 'Asia/Shanghai');
    expect(split.rules.map((rule) => rule.id)).toEqual(['hdu:course:abc:w1-8', 'hdu:course:abc:w10-16']);
    const skipped = buildCampusRules([course({ weekday: null }), course({ id: 'two', sections: null })], calendar, 'Asia/Shanghai');
    expect(skipped.rules).toHaveLength(0);
    expect(skipped.warnings).toContain('missing_weekday');
    expect(skipped.warnings).toContain('missing_time');
  });

  it('builds exam events as hdu-sourced entries and leaves undated exams out', () => {
    const { events, warnings } = buildCampusExamEvents([exam(), exam({ id: 'undated', date: null })], 'Asia/Shanghai');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 'hdu:exam:abc', title: '考试：线性代数', kind: 'exam', source: 'hdu', location: 'A101' });
    expect(events[0].end).toBeGreaterThan(events[0].start);
    expect(warnings).toContain('missing_date');
  });

  it('previews create/update/unchanged/removed without touching non-campus entries', () => {
    const rule = buildCampusRules([course()], calendar, 'Asia/Shanghai').rules[0];
    const manual = { ...rule, id: 'manual-rule', title: '手动课程' };
    const first = previewCampus([manual], [], [rule], []);
    expect(first.courses.create.map((item) => item.id)).toEqual(['hdu:course:abc']);
    expect(first.events.create).toEqual([]);
    const second = previewCampus([manual, rule], [], [rule], []);
    expect(second.courses.unchanged.map((item) => item.id)).toEqual(['hdu:course:abc']);
    const removed = previewCampus([manual, rule], [], [], []);
    expect(removed.courses.removed.map((item) => item.id)).toEqual(['hdu:course:abc']);
    expect(removed.courses.removed.some((item) => item.id === 'manual-rule')).toBe(false);
    expect(removed.events.removed).toEqual([]);
  });
});
