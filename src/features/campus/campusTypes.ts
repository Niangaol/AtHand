import { z } from 'zod';

export const campusStatusSchema = z.object({
  ok: z.literal(true),
  connected: z.boolean(),
  expiresAt: z.string().nullable(),
  personalQueries: z.boolean(),
  lastError: z.string().nullable(),
  personalEnabled: z.boolean(),
  personalAvailable: z.boolean(),
}).strict();
export type CampusStatus = Omit<z.infer<typeof campusStatusSchema>, 'ok'>;

export const campusCalendarSchema = z.object({
  schoolYear: z.string().nullable(),
  semester: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  weekNow: z.number().nullable(),
  termWeeks: z.number().nullable(),
}).strict();
export type CampusCalendar = z.infer<typeof campusCalendarSchema>;

export const campusCourseSchema = z.object({
  id: z.string(),
  name: z.string(),
  teacher: z.string().nullable(),
  location: z.string().nullable(),
  weekday: z.number().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  sections: z.string().nullable(),
  weeks: z.string().nullable(),
  parity: z.enum(['all', 'odd', 'even']),
}).strict();
export const campusCoursesSchema = z.object({
  semester: z.object({
    schoolYear: z.string().nullable(), semester: z.string().nullable(), startDate: z.string().nullable(),
    endDate: z.string().nullable(), week: z.number().nullable(),
  }).strict().nullable(),
  courses: z.array(campusCourseSchema),
}).strict();
export type CampusCourse = z.infer<typeof campusCourseSchema>;
export type CampusCourses = z.infer<typeof campusCoursesSchema>;

export const campusExamSchema = z.object({
  id: z.string(), course: z.string(), date: z.string().nullable(), startTime: z.string().nullable(),
  endTime: z.string().nullable(), location: z.string().nullable(), seat: z.string().nullable(),
}).strict();
export const campusExamsSchema = z.object({ exams: z.array(campusExamSchema) }).strict();
export type CampusExam = z.infer<typeof campusExamSchema>;
export type CampusExams = z.infer<typeof campusExamsSchema>;

export const campusCardSchema = z.object({
  balanceCents: z.number(), maskedNo: z.string().nullable(),
  recent: z.array(z.object({ at: z.string().nullable(), amountCents: z.number(), place: z.string().nullable() }).strict()),
}).strict();
export type CampusCard = z.infer<typeof campusCardSchema>;

export const campusElectricSchema = z.object({
  room: z.string().nullable(), balanceYuan: z.number(), updatedAt: z.string().nullable(),
}).strict();
export type CampusElectric = z.infer<typeof campusElectricSchema>;

export const campusLibrarySchema = z.object({
  loans: z.array(z.object({ title: z.string(), dueDate: z.string().nullable() }).strict()),
  reservations: z.array(z.object({ room: z.string().nullable(), seat: z.string().nullable(), start: z.string().nullable(), end: z.string().nullable() }).strict()),
}).strict();
export type CampusLibrary = z.infer<typeof campusLibrarySchema>;

export const campusNoticeSchema = z.looseObject({
  notice_id: z.string().optional(),
  source_key: z.string().optional(),
  title: z.string(),
  published_at: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  text_preview: z.string().optional(),
  is_demo: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
});
export const campusNoticesSchema = z.looseObject({
  items: z.array(campusNoticeSchema),
  page: z.number().optional(),
  page_size: z.number().optional(),
  has_more: z.boolean().optional(),
  source_states: z.array(z.looseObject({ source_key: z.string().optional(), name: z.string().optional() })).optional(),
  mode: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});
export type CampusNotice = z.infer<typeof campusNoticeSchema>;
export type CampusNotices = z.infer<typeof campusNoticesSchema>;

export const campusAnswerSchema = z.object({
  requestId: z.string(), state: z.string(), route: z.string(), text: z.string(),
  sources: z.array(z.looseObject({ title: z.string().optional(), publisher: z.string().optional(), url: z.string().optional(), published_at: z.string().optional() })),
  warnings: z.array(z.string()), isDemo: z.boolean(), truncated: z.boolean(),
}).strict();
export type CampusAnswer = z.infer<typeof campusAnswerSchema>;

export function envelopeSchema<T extends z.ZodTypeAny>(data: T) {
  return z.looseObject({
    ok: z.literal(true), capability: z.string(), fetchedAt: z.string(), stale: z.boolean(),
    demo: z.boolean(), warnings: z.array(z.string()), data,
  });
}
export type CampusEnvelope<T> = { capability: string; fetchedAt: string; stale: boolean; demo: boolean; warnings: string[]; data: T; cachedAt?: string };
