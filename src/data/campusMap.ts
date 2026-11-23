import type { CampusCalendar, CampusCard, CampusCourse, CampusExam, CampusNotice } from '../features/campus/campusTypes';
import type { CampusResult } from './campusCloud';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function first(value: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== '') return value[key];
  }
  return undefined;
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function minute(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function dayKey(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const stamp = num(value);
  if (stamp && stamp > 946684800000) return new Date(stamp > 10_000_000_000 ? stamp : stamp * 1000).toISOString().slice(0, 10);
  return null;
}

function arrays(root: unknown): unknown[][] {
  const found: unknown[][] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 3 || !value) return;
    if (Array.isArray(value)) { found.push(value); return; }
    const object = record(value);
    if (!object) return;
    for (const item of Object.values(object)) {
      if (Array.isArray(item)) found.push(item);
      else if (item && typeof item === 'object') visit(item, depth + 1);
    }
  };
  visit(root, 0);
  return found;
}

function looksLikeCourse(value: Record<string, unknown>): boolean {
  const name = first(value, ['name', 'courseName', 'course_name', 'title', 'course', 'className']);
  return Boolean(text(name)) && Boolean(first(value, ['startTime', 'start_time', 'start', 'beginTime', 'begin_time', 'weekday', 'dayOfWeek', 'sections', 'section']));
}

function looksLikeExam(value: Record<string, unknown>): boolean {
  const name = first(value, ['course', 'courseName', 'course_name', 'name', 'title']);
  return Boolean(text(name)) && Boolean(first(value, ['date', 'examDate', 'exam_date', 'startTime', 'start_time', 'start']));
}

export function mapCalendar(result: CampusResult | null): CampusCalendar | null {
  const data = record(result?.data);
  if (!data) return null;
  const source = record(data.data) ?? data;
  const schoolYear = text(first(source, ['schoolYear', 'school_year', 'year']));
  const semester = text(first(source, ['semester', 'term']));
  const startDate = dayKey(first(source, ['termStartDate', 'startDate', 'start_date']));
  const endDate = dayKey(first(source, ['termEndDate', 'endDate', 'end_date']));
  const weekNow = num(first(source, ['weekNow', 'week', 'currentWeek']));
  const termWeeks = num(first(source, ['termWeeks', 'weeks', 'totalWeeks']));
  if (!schoolYear && !semester && !startDate && !weekNow) return null;
  return {
    schoolYear,
    semester,
    startDate,
    endDate,
    weekNow: weekNow === null ? null : Math.trunc(weekNow),
    termWeeks: termWeeks === null ? null : Math.trunc(termWeeks),
  };
}

export function mapCourses(result: CampusResult | null): CampusCourse[] {
  if (!result?.ok || !result.data) return [];
  const seen = new Set<string>();
  const output: CampusCourse[] = [];
  for (const list of arrays(result.data)) {
    for (const entry of list) {
      const value = record(entry);
      if (!value || !looksLikeCourse(value)) continue;
      const name = text(first(value, ['name', 'courseName', 'course_name', 'title', 'course', 'className']));
      if (!name) continue;
      const startTime = minute(first(value, ['startTime', 'start_time', 'start', 'beginTime', 'begin_time']));
      const endTime = minute(first(value, ['endTime', 'end_time', 'end']));
      const weekdayRaw = num(first(value, ['weekday', 'dayOfWeek', 'day_of_week']));
      const date = dayKey(first(value, ['date', 'day', 'startDate']));
      const weekday = weekdayRaw !== null
        ? (weekdayRaw >= 1 && weekdayRaw <= 7 ? Math.trunc(weekdayRaw) : null)
        : date ? new Date(`${date}T12:00:00`).getDay() || 7 : null;
      const id = text(first(value, ['id', 'courseId', 'course_id', 'classId', 'class_id']))
        ?? `${name}-${date ?? weekday ?? 'x'}-${startTime ?? 'x'}`;
      if (seen.has(id)) continue;
      seen.add(id);
      output.push({
        id,
        name,
        teacher: text(first(value, ['teacher', 'teacherName', 'teacher_name'])),
        location: text(first(value, ['location', 'classroom', 'room', 'place', 'address'])),
        weekday,
        startTime,
        endTime,
        sections: text(first(value, ['sections', 'section', 'periods'])),
        weeks: text(first(value, ['weeks', 'weekRange', 'week_range', 'teachingWeeks'])),
        parity: 'all',
      });
    }
  }
  return output.slice(0, 200);
}

export function mapExams(result: CampusResult | null): CampusExam[] {
  if (!result?.ok || !result.data) return [];
  const seen = new Set<string>();
  const output: CampusExam[] = [];
  for (const list of arrays(result.data)) {
    for (const entry of list) {
      const value = record(entry);
      if (!value || !looksLikeExam(value)) continue;
      const course = text(first(value, ['course', 'courseName', 'course_name', 'name', 'title']));
      if (!course) continue;
      const date = dayKey(first(value, ['date', 'examDate', 'exam_date', 'startTime', 'start_time', 'start']));
      const id = text(first(value, ['id', 'examId', 'exam_id'])) ?? `${course}-${date ?? 'x'}`;
      if (seen.has(id)) continue;
      seen.add(id);
      output.push({
        id,
        course,
        date,
        startTime: minute(first(value, ['startTime', 'start_time', 'start'])),
        endTime: minute(first(value, ['endTime', 'end_time', 'end'])),
        location: text(first(value, ['location', 'room', 'place', 'classroom', 'address'])),
        seat: text(first(value, ['seat', 'seatNo', 'seat_no', 'seatNumber'])),
      });
    }
  }
  return output.slice(0, 200);
}

export function mapCard(result: CampusResult | null): CampusCard | null {
  const data = record(result?.data);
  if (!data) return null;
  const source = record(data.data) ?? data;
  const balanceRaw = num(first(source, ['balanceCents', 'balance_cents']));
  const yuan = num(first(source, ['balance', 'amount', 'money', 'cardBalance', 'card_balance']));
  const balanceCents = balanceRaw !== null ? Math.round(balanceRaw) : yuan !== null ? Math.round(yuan * 100) : null;
  if (balanceCents === null) return null;
  const list = first(source, ['recent', 'consume', 'records', 'list', 'items', 'trades']);
  const recent = Array.isArray(list) ? list.map((entry) => {
    const value = record(entry) ?? {};
    const cents = num(first(value, ['amountCents', 'amount_cents']));
    const valueYuan = num(first(value, ['amount', 'money', 'price']));
    return {
      at: text(first(value, ['at', 'time', 'date', 'createTime', 'created_at'])),
      amountCents: cents !== null ? Math.round(cents) : valueYuan !== null ? Math.round(Math.abs(valueYuan) * 100) : 0,
      place: text(first(value, ['place', 'merchant', 'location', 'name', 'title'])),
    };
  }).filter((item) => item.amountCents > 0).slice(0, 20) : [];
  return {
    balanceCents,
    maskedNo: text(first(source, ['maskedNo', 'masked_no', 'cardNo', 'card_no', 'cardNumber'])),
    recent,
  };
}

export function mapNotices(result: CampusResult | null): CampusNotice[] {
  if (!result?.ok || !result.data) return [];
  const output: CampusNotice[] = [];
  for (const list of arrays(result.data)) {
    for (const entry of list) {
      const value = record(entry);
      if (!value) continue;
      const title = text(first(value, ['title', 'name', 'headline']));
      if (!title) continue;
      output.push({
        notice_id: text(first(value, ['notice_id', 'id'])) ?? undefined,
        source_key: text(first(value, ['source_key', 'source', 'publisher'])) ?? undefined,
        title,
        published_at: text(first(value, ['published_at', 'publishedAt', 'date', 'time', 'created_at'])) ?? undefined,
        url: text(first(value, ['url', 'link', 'href'])) ?? undefined,
        text_preview: text(first(value, ['text_preview', 'summary', 'description', 'content'])) ?? undefined,
      });
    }
    if (output.length >= 30) break;
  }
  return output.slice(0, 20);
}