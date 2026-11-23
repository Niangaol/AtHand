import type { CampusCourse, CampusExam, CampusNotice } from './campusTypes';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

export function weekdayOf(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

const minutes = (time: string | null) => {
  if (!time) return Number.POSITIVE_INFINITY;
  const [hour, minute] = time.split(':').map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : Number.POSITIVE_INFINITY;
};

export function nextCourse(courses: CampusCourse[], now = new Date()): CampusCourse | null {
  const today = weekdayOf(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const rows = courses.filter((course) => course.weekday !== null);
  rows.sort((left, right) => {
    const distance = (course: CampusCourse) => {
      const days = ((course.weekday! - today) + 7) % 7;
      if (days === 0 && course.startTime && minutes(course.startTime) <= nowMinutes) return 7;
      return days;
    };
    return distance(left) - distance(right) || minutes(left.startTime) - minutes(right.startTime) || left.name.localeCompare(right.name);
  });
  return rows[0] ?? null;
}

export function courseWhen(course: CampusCourse): string {
  const day = course.weekday ? `周${WEEK[course.weekday - 1]}` : '星期未提供';
  if (course.startTime) return `${day} ${course.startTime}${course.endTime ? `–${course.endTime}` : ''}`;
  if (course.sections) return `${day} ${course.sections} 节`;
  return day;
}

export function nextExam(exams: CampusExam[], today: string): CampusExam | null {
  return [...exams].filter((exam) => exam.date && exam.date >= today)
    .sort((left, right) => left.date!.localeCompare(right.date!) || minutes(left.startTime) - minutes(right.startTime))[0] ?? null;
}

export function examWhen(exam: CampusExam): string {
  return `${exam.date ?? '日期未定'}${exam.startTime ? ` ${exam.startTime}` : ''}${exam.location ? ` · ${exam.location}` : ''}`;
}

export function noticeTime(notice: CampusNotice): string {
  return notice.published_at ? notice.published_at.slice(0, 10) : '时间未标注';
}
