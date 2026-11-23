import type { CampusCalendar, CampusCourse, CampusExam } from '../features/campus/campusTypes.ts';
import type { CourseRule, PlannerEvent } from './planner.ts';
import { buildEvent } from './schedule.ts';
import { sectionClock, semesterMonday, weekRanges } from './campusTimetable.ts';

const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const day = /^\d{4}-\d{2}-\d{2}$/;

export type CampusRuleBuild = { rules: CourseRule[]; warnings: string[] };

function collect(target: string[], warning: string) {
  if (!target.includes(warning)) target.push(warning);
}

export function buildCampusRules(courses: readonly CampusCourse[], calendar: CampusCalendar, timeZone: string): CampusRuleBuild {
  const rules: CourseRule[] = [];
  const warnings: string[] = [];
  if (!calendar.startDate || !day.test(calendar.startDate)) {
    return { rules, warnings: ['missing_calendar'] };
  }
  const semesterStart = semesterMonday(calendar.startDate);
  const seen = new Set<string>();
  for (const course of courses) {
    if (course.weekday === null || course.weekday < 1 || course.weekday > 7) { collect(warnings, 'missing_weekday'); continue; }
    let startTime: string | null = course.startTime && clock.test(course.startTime) ? course.startTime : null;
    let endTime: string | null = course.endTime && clock.test(course.endTime) ? course.endTime : null;
    if (!startTime || !endTime) {
      const fromSections = sectionClock(course.sections);
      startTime = startTime ?? fromSections?.startTime ?? null;
      endTime = endTime ?? fromSections?.endTime ?? null;
    }
    if (!startTime || !endTime || endTime <= startTime) { collect(warnings, 'missing_time'); continue; }
    const ranges = weekRanges(course.weeks);
    if (ranges.length === 0) { collect(warnings, 'missing_weeks'); continue; }
    for (const range of ranges) {
      const parity = course.parity !== 'all' ? course.parity : range.parity;
      const id = ranges.length === 1 ? course.id : `${course.id}:w${range.firstWeek}-${range.lastWeek}`;
      if (seen.has(id)) { collect(warnings, 'duplicate_id'); continue; }
      seen.add(id);
      rules.push({
        id, title: course.name, location: course.location ?? '', semesterStart, weekday: course.weekday,
        startTime, endTime, firstWeek: range.firstWeek, lastWeek: range.lastWeek, parity, timeZone, exceptions: [],
      });
    }
  }
  return { rules, warnings };
}

export type CampusExamBuild = { events: PlannerEvent[]; warnings: string[] };

export function buildCampusExamEvents(exams: readonly CampusExam[], timeZone: string): CampusExamBuild {
  const events: PlannerEvent[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const exam of exams) {
    if (!exam.date || !day.test(exam.date)) { collect(warnings, 'missing_date'); continue; }
    if (seen.has(exam.id)) { collect(warnings, 'duplicate_id'); continue; }
    seen.add(exam.id);
    const timed = exam.startTime && exam.endTime && clock.test(exam.startTime) && clock.test(exam.endTime) && exam.endTime > exam.startTime;
    if (!timed) collect(warnings, exam.startTime || exam.endTime ? 'invalid_time' : 'missing_time');
    try {
      events.push(buildEvent({
        id: exam.id, title: `考试：${exam.course}`, kind: 'exam', location: exam.location ?? '',
        start: `${exam.date}T${timed ? exam.startTime : '00:00'}`, end: `${exam.date}T${timed ? exam.endTime : '00:00'}`,
        allDay: !timed, timeZone, source: 'hdu', sourceId: 'hdu',
      }));
    } catch {
      collect(warnings, 'invalid_exam');
    }
  }
  return { events, warnings };
}

export type CampusBucket<T> = { create: T[]; update: T[]; unchanged: T[]; removed: T[] };
export type CampusPreview = { courses: CampusBucket<CourseRule>; events: CampusBucket<PlannerEvent> };

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${key}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function compare<T extends { id: string }>(existing: readonly T[], incoming: readonly T[]): CampusBucket<T> {
  const before = new Map(existing.map((item) => [item.id, item]));
  const after = new Set(incoming.map((item) => item.id));
  const bucket: CampusBucket<T> = { create: [], update: [], unchanged: [], removed: [] };
  for (const item of incoming) {
    const previous = before.get(item.id);
    if (!previous) bucket.create.push(item);
    else if (stable(previous) === stable(item)) bucket.unchanged.push(item);
    else bucket.update.push(item);
  }
  for (const item of existing) if (!after.has(item.id)) bucket.removed.push(item);
  return bucket;
}

export function previewCampus(
  existingRules: readonly CourseRule[], existingEvents: readonly PlannerEvent[],
  nextRules: readonly CourseRule[], nextEvents: readonly PlannerEvent[],
): CampusPreview {
  return {
    courses: compare(existingRules.filter((rule) => rule.id.startsWith('hdu:course:')), nextRules),
    events: compare(existingEvents.filter((event) => event.source === 'hdu' && event.id.startsWith('hdu:exam:')), nextEvents),
  };
}
