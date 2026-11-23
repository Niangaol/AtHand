import { describe, expect, it } from 'vitest';
import type { CampusCourse, CampusExam } from './campusTypes';
import { courseWhen, nextCourse, nextExam } from './campusSummary';

const course = (overrides: Partial<CampusCourse>): CampusCourse => ({
  id: 'c', name: '课程', teacher: null, location: null, weekday: 1, startTime: null, endTime: null, sections: null, weeks: null, parity: 'all', ...overrides,
});
const exam = (overrides: Partial<CampusExam>): CampusExam => ({
  id: 'e', course: '考试', date: '2026-12-01', startTime: null, endTime: null, location: null, seat: null, ...overrides,
});

describe('campus summary', () => {
  it('picks the next class today, then the next weekday, and skips classes already over', () => {
    const wednesday = new Date('2026-11-25T10:00:00');
    const courses = [
      course({ id: 'mon', name: '周一课', weekday: 1 }),
      course({ id: 'early', name: '早课', weekday: 3, startTime: '08:00' }),
      course({ id: 'later', name: '下午课', weekday: 3, startTime: '14:00' }),
      course({ id: 'fri', name: '周五课', weekday: 5 }),
    ];
    expect(nextCourse(courses, wednesday)?.id).toBe('later');
    expect(nextCourse(courses, new Date('2026-11-25T15:00:00'))?.id).toBe('fri');
    expect(nextCourse([course({ id: 'unknown', weekday: null })], wednesday)).toBeNull();
  });

  it('formats course and exam timing without inventing fields', () => {
    expect(courseWhen(course({ weekday: 3, startTime: '14:00', endTime: '15:40' }))).toBe('周三 14:00–15:40');
    expect(courseWhen(course({ weekday: 4, sections: '3-4' }))).toBe('周四 3-4 节');
    expect(courseWhen(course({ weekday: null }))).toBe('星期未提供');
  });

  it('finds the nearest future exam and ignores past or undated entries', () => {
    const exams = [
      exam({ id: 'past', date: '2026-11-01' }),
      exam({ id: 'later', date: '2026-12-10', startTime: '09:00' }),
      exam({ id: 'sooner', date: '2026-12-10', startTime: '08:00' }),
      exam({ id: 'undated', date: null }),
    ];
    expect(nextExam(exams, '2026-11-22')?.id).toBe('sooner');
    expect(nextExam([exam({ id: 'past', date: '2026-11-01' })], '2026-11-22')).toBeNull();
  });
});
