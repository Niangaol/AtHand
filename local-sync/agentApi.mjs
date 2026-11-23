import crypto from 'node:crypto';
import { z } from 'zod';
import { countdownSchema, courseSchema, dateSchema, eventSchema, idSchema, tripSchema } from '../src/domain/planner.ts';
import { buildTimeline } from '../src/domain/schedule.ts';
import { getCountdowns } from '../src/domain/countdowns.ts';
import { focusedSeconds, focusedSecondsBetween, remainingSeconds } from '../src/domain/focus.ts';
import { getMonthRange, getWeekRange, shiftDate, toDateKey } from '../src/domain/dates.ts';
import { summarize } from '../src/domain/summary.ts';
import { buildRecord, buildWorkplace, parseAmount } from '../src/domain/ledger.ts';
import { isLedgerState } from '../src/data/storage.ts';
import { changeTripDates, cities, newTrip } from '../src/domain/trips.ts';
import { expenseCategories } from '../src/domain/records.ts';
import { buildCampusExamEvents, buildCampusRules, previewCampus } from '../src/domain/campusSync.ts';
import { buildDayBrief, buildFocusInsights, buildLedgerInsights, buildWeekReview } from '../src/domain/insights.ts';

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const MAX_RANGE_DAYS = 62;
const MAX_IDEMPOTENCY = 100;

export class AgentError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const isoInstant = z.string().max(40).refine((value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}, '请使用带时区的ISO时间，例如 2026-11-22T19:00:00+08:00。');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const title = z.string().trim().min(1).max(100);
const location = z.string().trim().max(200);
const category = z.enum(expenseCategories);
const yuan = z.number().positive().max(9_999_999.99);
const notes = z.string().max(10000);

const dayOverviewInput = z.object({ date: dateSchema.optional() }).strict();
const dayBriefInput = z.object({ date: dateSchema.optional() }).strict();
const weekReviewInput = z.object({ anchor: dateSchema.optional() }).strict();
const insightWindowInput = z.object({ days: z.number().int().min(7).max(90).default(30) }).strict();
const scheduleListInput = z.object({ from: dateSchema.optional(), to: dateSchema.optional() }).strict();
const scheduleCreateInput = z.object({
  title, start: isoInstant, end: isoInstant, kind: z.enum(['course', 'shift', 'exam', 'deadline', 'event']).default('event'), location: location.default(''),
}).strict();
const scheduleUpdateInput = z.object({
  id: idSchema, title: title.optional(), start: isoInstant.optional(), end: isoInstant.optional(),
  kind: z.enum(['course', 'shift', 'exam', 'deadline', 'event']).optional(), location: location.optional(),
}).strict().refine((value) => ['title', 'start', 'end', 'kind', 'location'].some((key) => value[key] !== undefined), '至少修改一项。');
const focusStartInput = z.object({ task: title, minutes: z.number().int().min(1).max(180), eventId: idSchema.optional() }).strict();
const focusControlInput = z.object({ action: z.enum(['pause', 'resume', 'cancel', 'complete']), sessionId: idSchema.optional() }).strict();
const emptyInput = z.object({}).strict();
const countdownsListInput = z.object({ withinDays: z.number().int().min(0).max(366).default(30) }).strict();
const countdownCreateInput = z.object({ title, kind: z.enum(['document', 'birthday']), date: dateSchema }).strict();
const countdownUpdateInput = z.object({ id: idSchema, title: title.optional(), kind: z.enum(['document', 'birthday']).optional(), date: dateSchema.optional() }).strict()
  .refine((value) => value.title !== undefined || value.kind !== undefined || value.date !== undefined, '至少修改一项。');
const ledgerSummaryInput = z.object({ from: dateSchema.optional(), to: dateSchema.optional() }).strict();
const ledgerRecordsInput = z.object({
  from: dateSchema.optional(), to: dateSchema.optional(), type: z.enum(['expense', 'work']).optional(), category: category.optional(),
  limit: z.number().int().min(1).max(200).default(50),
}).strict();
const ledgerMonthlyInput = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();
const servicesSearchInput = z.object({ query: z.string().trim().max(100).default(''), category: z.string().trim().max(40).optional() }).strict();

const workplaceAddInput = z.object({ name: z.string().trim().min(1).max(60), hourlyRateYuan: yuan, description: z.string().trim().max(500).default('') }).strict();
const workplaceUpdateInput = z.object({
  id: idSchema, name: z.string().trim().min(1).max(60).optional(), hourlyRateYuan: yuan.optional(), description: z.string().trim().max(500).optional(),
}).strict().refine((value) => value.name !== undefined || value.hourlyRateYuan !== undefined || value.description !== undefined, '至少修改一项。');
const expenseAddInput = z.object({ title: z.string().trim().max(100).default(''), amountYuan: yuan, category, date: dateSchema.optional() }).strict();
const expenseUpdateInput = z.object({
  id: idSchema, title: z.string().trim().max(100).optional(), amountYuan: yuan.optional(), category: category.optional(), date: dateSchema.optional(),
}).strict().refine((value) => value.title !== undefined || value.amountYuan !== undefined || value.category !== undefined || value.date !== undefined, '至少修改一项。');
const workAddInput = z.object({
  workplaceId: idSchema, title: z.string().trim().max(100).default(''), date: dateSchema, startTime: time, endTime: time,
  nextDay: z.boolean().optional(), durationMinutes: z.number().int().min(1).max(1440).optional(), hourlyRateYuan: yuan.optional(),
}).strict();
const workUpdateInput = z.object({
  id: idSchema, workplaceId: idSchema.optional(), title: z.string().trim().max(100).optional(), date: dateSchema.optional(),
  startTime: time.optional(), endTime: time.optional(), nextDay: z.boolean().optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(), hourlyRateYuan: yuan.optional(),
}).strict().refine((value) => ['workplaceId', 'title', 'date', 'startTime', 'endTime', 'nextDay', 'durationMinutes', 'hourlyRateYuan'].some((key) => value[key] !== undefined), '至少修改一项。');

const courseCreateInput = z.object({
  title, location: location.default(''), semesterStart: dateSchema, weekday: z.number().int().min(1).max(7),
  startTime: time, endTime: time, firstWeek: z.number().int().min(1).max(60), lastWeek: z.number().int().min(1).max(60),
  parity: z.enum(['all', 'odd', 'even']).default('all'),
}).strict();
const courseUpdateInput = z.object({
  id: idSchema, title: title.optional(), location: location.optional(), semesterStart: dateSchema.optional(), weekday: z.number().int().min(1).max(7).optional(),
  startTime: time.optional(), endTime: time.optional(), firstWeek: z.number().int().min(1).max(60).optional(), lastWeek: z.number().int().min(1).max(60).optional(),
  parity: z.enum(['all', 'odd', 'even']).optional(),
}).strict().refine((value) => ['title', 'location', 'semesterStart', 'weekday', 'startTime', 'endTime', 'firstWeek', 'lastWeek', 'parity'].some((key) => value[key] !== undefined), '至少修改一项。');
const tripCreateInput = z.object({ title, startDate: dateSchema, endDate: dateSchema, notes: notes.default('') }).strict();
const tripUpdateInput = z.object({ id: idSchema, title: title.optional(), startDate: dateSchema.optional(), endDate: dateSchema.optional(), notes: notes.optional() }).strict()
  .refine((value) => value.title !== undefined || value.startDate !== undefined || value.endDate !== undefined || value.notes !== undefined, '至少修改一项。');
const tripIdInput = z.object({ id: idSchema }).strict();
const tripDayItemInput = z.object({ tripId: idSchema, date: dateSchema, text: z.string().trim().min(1).max(2000) }).strict();
const tripPackingAddInput = z.object({ tripId: idSchema, text: z.string().trim().min(1).max(2000) }).strict();
const tripPackingSetInput = z.object({ tripId: idSchema, itemId: idSchema, checked: z.boolean() }).strict();
const tripVisitAddInput = z.object({ tripId: idSchema, city: z.string().trim().min(1).max(50), date: dateSchema.optional(), visited: z.boolean().default(false) }).strict();
const campusNoticesInput = z.object({
  q: z.string().trim().max(200).default(''), sourceKey: z.string().trim().max(100).optional(),
  page: z.number().int().min(1).max(100).default(1), pageSize: z.number().int().min(1).max(50).default(20),
}).strict();

const json = (schema) => {
  const value = z.toJSONSchema(schema, { io: 'input' });
  delete value.$schema;
  return value;
};
const dayBounds = (date) => ({
  start: new Date(`${date}T00:00:00`).getTime(),
  end: new Date(`${shiftDate(date, 1)}T00:00:00`).getTime(),
});
const rangeDays = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);
const derivedId = (kind, requestId) => `${kind}-${crypto.createHash('sha256').update(`${kind}:${requestId}`).digest('hex').slice(0, 24)}`;
const localIso = (timestamp, timeZone) => {
  const format = (zone) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
    }).formatToParts(new Date(timestamp));
    const part = (type) => parts.find((item) => item.type === type)?.value ?? '';
    const offset = part('timeZoneName').replace('GMT', '') || '+00:00';
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}${offset}`;
  };
  try { return format(timeZone || TIME_ZONE); } catch { return format(TIME_ZONE); }
};
const toCents = (value) => parseAmount(value.toFixed(2));
const rate = (cents) => (cents / 100).toFixed(2);
const emptyLedger = () => ({ version: 1, records: [], workplaces: [], settings: { hourlyRateCents: 2000 } });
const describeEvent = (event) => ({
  id: event.id, title: event.title, kind: event.kind, location: event.location,
  start: localIso(event.start, event.timeZone), end: localIso(event.end, event.timeZone),
  allDay: event.allDay, timeZone: event.timeZone, source: event.source, sourceId: event.sourceId,
});
const describeSession = (session, now) => ({
  id: session.id, task: session.task, minutes: session.minutes, status: session.status,
  startedAt: localIso(session.startedAt), remainingSeconds: remainingSeconds(session, now), eventId: session.eventId ?? null,
});
const describeTimeline = (item) => ({
  id: `${item.originId}:${item.date}`, originId: item.originId, date: item.date, title: item.title, kind: item.kind,
  start: localIso(item.start, item.timeZone), end: localIso(item.end, item.timeZone), allDay: item.allDay, source: item.sourceLabel,
  eventId: item.eventId ?? null, workId: item.workId ?? null, courseId: item.courseId ?? null, linkedEventId: item.linkedEventId ?? null,
});
const describeRecord = (record, workplaces) => ({
  ...record,
  ...(record.type === 'work' ? { workplaceName: workplaces.find((unit) => unit.id === record.workplaceId)?.name ?? null } : {}),
});
const ledgerResult = (result) => ({ result, revision: null, serverId: null });

export function createAgentApi({ readPlanner, execute, readCalendars, readLedger, writeLedger, campus, mcp, timeZone = TIME_ZONE }) {
  function snapshot() {
    const doc = readPlanner();
    const now = Date.now();
    let ledger = null;
    let ledgerError = null;
    try { ledger = readLedger(); } catch (error) { ledgerError = error; }
    return {
      doc, now, ledger, ledgerError,
      records: ledger?.records ?? [], workplaces: ledger?.workplaces ?? [],
      calendars: readCalendars() ?? [], today: toDateKey(new Date(now)),
    };
  }
  function ledgerSnap() {
    const snap = snapshot();
    if (snap.ledgerError) throw snap.ledgerError;
    return snap;
  }
  function commit(tool, requestId, build) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const snap = snapshot();
      const command = build(snap);
      try {
        return { doc: execute({ operationId: `agent:${tool}:${requestId}`, baseRevision: snap.doc.revision, command }), snap };
      } catch (error) {
        if (error?.message === 'conflict') continue;
        throw error;
      }
    }
    throw new AgentError(409, 'conflict', '数据正在被另一处修改，请稍后重试。');
  }
  function commitLedger(build) {
    const current = readLedger();
    const next = build(current ? structuredClone(current) : emptyLedger());
    if (!isLedgerState(next)) throw new AgentError(400, 'invalid_ledger', '账本校验失败，未保存。');
    writeLedger(next);
    return next;
  }
  function activeSession(state) {
    return state.focusSessions.find((session) => session.status === 'running' || session.status === 'paused');
  }
  function focusMinutes(state, date, now) {
    const week = getWeekRange(date);
    const today = dayBounds(date);
    const first = dayBounds(week.start);
    const last = dayBounds(week.end);
    return {
      todaySeconds: focusedSecondsBetween(state.focusSessions, today.start, today.end, now),
      weekSeconds: focusedSecondsBetween(state.focusSessions, first.start, last.end, now),
    };
  }
  function bounded(from, to) {
    if (rangeDays(from, to) < 0) throw new AgentError(400, 'invalid_range', '结束日期不能早于开始日期。');
    if (rangeDays(from, to) > MAX_RANGE_DAYS) throw new AgentError(400, 'range_too_large', `一次最多查看${MAX_RANGE_DAYS}天。`);
  }
  function tripOrThrow(state, id) {
    const trip = state.trips.find((item) => item.id === id);
    if (!trip) throw new AgentError(404, 'trip_not_found', '这趟旅行不存在。');
    return trip;
  }
  function campusApi() {
    if (!campus) throw new AgentError(503, 'campus_unavailable', '电脑上的校园服务没有启动。');
    return campus();
  }
  function campusFailure(error) {
    const code = typeof error?.code === 'string' ? error.code : 'helper_unavailable';
    const status = code === 'not_connected' ? 409 : code === 'timeout' ? 504 : code === 'helper_unavailable' || code === 'schema_changed' ? 503 : 403;
    const messages = {
      not_connected: '还没有连接杭电助手。',
      personal_disabled: '个人校园数据只读开关未开启。',
      owner_binding_required: '杭电助手未开启本人绑定，个人数据不可用。',
      cli_not_logged_in: '杭电助手还没有登录学校账号。',
      helper_unavailable: '连不上杭电助手，请确认它已经启动。',
      timeout: '杭电助手响应超时。',
      schema_changed: '学校返回的字段和预期不一致，暂时不能同步。',
    };
    throw new AgentError(status, `campus_${code}`, messages[code] ?? (error instanceof Error ? error.message : '校园服务暂时不可用。'));
  }
  function envelopeResult(value) {
    const result = { ...value };
    delete result.ok;
    return result;
  }

  const tools = [
    {
      name: 'day_brief', scope: 'read', input: dayBriefInput,
      description: '今日简报：当天安排、下一项、未来7天倒计时、花费、专注和预警。日期不填就是今天。',
      handler: (args) => {
        const snap = snapshot();
        const date = args.date ?? snap.today;
        const facts = buildDayBrief(snap.doc.state, snap.records, snap.calendars, date, snap.now);
        return { result: { ...facts, timeZone }, revision: snap.doc.revision, serverId: snap.doc.serverId };
      },
    },
    {
      name: 'week_review', scope: 'read', input: weekReviewInput,
      description: '本周复盘：本周与上周的支出、收入、工时、专注对比，分类占比和预警。锚点日期不填就是今天所在周。',
      handler: (args) => {
        const snap = snapshot();
        const facts = buildWeekReview(snap.doc.state, snap.records, snap.calendars, args.anchor ?? snap.today, snap.now);
        return { result: { ...facts, timeZone }, revision: snap.doc.revision, serverId: snap.doc.serverId };
      },
    },
    {
      name: 'ledger_insights', scope: 'read', input: insightWindowInput,
      description: '账本洞察：近 N 天（7-90，默认30）支出、分类占比、与上一周期对比、大额支出和异常单笔。',
      handler: (args) => {
        const snap = snapshot();
        return { result: { ...buildLedgerInsights(snap.records, snap.today, args.days), timeZone }, revision: snap.doc.revision, serverId: snap.doc.serverId };
      },
    },
    {
      name: 'focus_insights', scope: 'read', input: insightWindowInput,
      description: '专注洞察：近 N 天（7-90，默认30）总分钟、每日分布、连续天数、高峰时段和常做任务。',
      handler: (args) => {
        const snap = snapshot();
        return { result: { ...buildFocusInsights(snap.doc.state, snap.today, args.days, snap.now), timeZone }, revision: snap.doc.revision, serverId: snap.doc.serverId };
      },
    },
    {
      name: 'day_overview', scope: 'read', input: dayOverviewInput,
      description: '查看某一天的安排、最近倒计时、进行中的专注和今日/本周专注分钟数。日期不填就是今天。',
      handler: (args) => {
        const snap = snapshot();
        const date = args.date ?? snap.today;
        const items = buildTimeline(snap.doc.state, snap.records, snap.calendars, date, date, snap.now).map(describeTimeline);
        const countdowns = getCountdowns(snap.doc.state, date, snap.calendars).filter((item) => item.days >= 0).slice(0, 10);
        const active = activeSession(snap.doc.state);
        const minutes = focusMinutes(snap.doc.state, date, snap.now);
        return {
          result: { date, timeZone, items, countdowns, focus: { active: active ? describeSession(active, snap.now) : null, todayMinutes: Math.floor(minutes.todaySeconds / 60), weekMinutes: Math.floor(minutes.weekSeconds / 60) }, revision: snap.doc.revision },
          revision: snap.doc.revision, serverId: snap.doc.serverId,
        };
      },
    },
    {
      name: 'schedule_list', scope: 'read', input: scheduleListInput,
      description: '按日期范围查看统一时间表，包含手动日程、课程、已记工时、手机日历和专注记录。默认从今天起7天，最多62天。',
      handler: (args) => {
        const snap = snapshot();
        const from = args.from ?? snap.today;
        const to = args.to ?? shiftDate(from, 6);
        bounded(from, to);
        const items = buildTimeline(snap.doc.state, snap.records, snap.calendars, from, to, snap.now).map(describeTimeline);
        return { result: { from, to, timeZone, items }, revision: snap.doc.revision, serverId: snap.doc.serverId };
      },
    },
    {
      name: 'schedule_create', scope: 'write', input: scheduleCreateInput,
      description: '新建一条手动日程。时间必须带时区偏移，例如 2026-11-22T19:00:00+08:00；暂不支持全天日程。',
      handler: (args, context) => {
        const event = {
          id: derivedId('evt', context.requestId), title: args.title, kind: args.kind, location: args.location,
          start: Date.parse(args.start), end: Date.parse(args.end), allDay: false, timeZone, source: 'manual', sourceId: '',
        };
        const { doc } = commit('schedule_create', context.requestId, () => ({ kind: 'put', collection: 'events', value: eventSchema.parse(event) }));
        return { result: { event: describeEvent(doc.state.events.find((item) => item.id === event.id)) }, revision: doc.revision, serverId: doc.serverId };
      },
    },
    {
      name: 'schedule_update', scope: 'write', input: scheduleUpdateInput,
      description: '修改一条手动日程的标题、时间、类型或地点；手机日历和ICS导入的日程不能改。',
      handler: (args, context) => {
        const { doc } = commit('schedule_update', context.requestId, (snap) => {
          const current = snap.doc.state.events.find((item) => item.id === args.id);
          if (!current) throw new AgentError(404, 'event_not_found', '这条日程不存在。');
          if (current.source !== 'manual') throw new AgentError(400, 'not_editable', '只能修改手动添加的日程。');
          const next = { ...current };
          if (args.title !== undefined) next.title = args.title;
          if (args.kind !== undefined) next.kind = args.kind;
          if (args.location !== undefined) next.location = args.location;
          if (args.start !== undefined) next.start = Date.parse(args.start);
          if (args.end !== undefined) next.end = Date.parse(args.end);
          return { kind: 'put', collection: 'events', value: eventSchema.parse(next) };
        });
        return { result: { event: describeEvent(doc.state.events.find((item) => item.id === args.id)) }, revision: doc.revision, serverId: doc.serverId };
      },
    },
    {
      name: 'courses_list', scope: 'read', input: emptyInput,
      description: '查看每周课程规则。具体某天的课程请用 schedule_list。',
      handler: () => {
        const snap = snapshot();
        return { result: { courses: snap.doc.state.courseRules }, revision: snap.doc.revision, serverId: snap.doc.serverId };
      },
    },
    {
      name: 'courses_create', scope: 'write', input: courseCreateInput,
      description: '新建每周重复课程。semesterStart 必须是某学期首周周一，weekday 用 1-7 表示周一到周日。',
      handler: (args, context) => {
        const course = {
          id: derivedId('course', context.requestId), title: args.title, location: args.location, semesterStart: args.semesterStart,
          weekday: args.weekday, startTime: args.startTime, endTime: args.endTime, firstWeek: args.firstWeek, lastWeek: args.lastWeek,
          parity: args.parity, timeZone, exceptions: [],
        };
        const { doc } = commit('courses_create', context.requestId, () => ({ kind: 'put', collection: 'courseRules', value: courseSchema.parse(course) }));
        return { result: { course: doc.state.courseRules.find((item) => item.id === course.id) }, revision: doc.revision, serverId: doc.serverId };
      },
    },
    {
      name: 'courses_update', scope: 'write', input: courseUpdateInput,
      description: '修改每周课程规则；保留已有的停课/调课例外。',
      handler: (args, context) => {
        const { doc } = commit('courses_update', context.requestId, (snap) => {
          const current = snap.doc.state.courseRules.find((item) => item.id === args.id);
          if (!current) throw new AgentError(404, 'course_not_found', '这条课程规则不存在。');
          const next = { ...current };
          for (const key of ['title', 'location', 'semesterStart', 'weekday', 'startTime', 'endTime', 'firstWeek', 'lastWeek', 'parity']) {
            if (args[key] !== undefined) next[key] = args[key];
          }
          return { kind: 'put', collection: 'courseRules', value: courseSchema.parse(next) };
        });
        return { result: { course: doc.state.courseRules.find((item) => item.id === args.id) }, revision: doc.revision, serverId: doc.serverId };
      },
    },
    {
      name: 'focus_start', scope: 'write', input: focusStartInput,
      description: '开始一段专注（番茄钟），可以关联一条手动日程。已有进行中的专注时不会覆盖，会返回 focus_active。',
      handler: (args, context) => {
        const snap = snapshot();
        const current = activeSession(snap.doc.state);
        if (current) throw new AgentError(409, 'focus_active', '已有进行中的专注，请先完成或结束。', { session: describeSession(current, snap.now) });
        const id = derivedId('focus', context.requestId);
        const owner = `agent:${context.actor}`.slice(0, 160);
        const { doc } = commit('focus_start', context.requestId, () => ({
          kind: 'focus.start', id, task: args.task, minutes: args.minutes, owner,
          ...(args.eventId ? { eventId: args.eventId } : {}),
        }));
        return { result: { session: describeSession(doc.state.focusSessions.find((item) => item.id === id), Date.now()) }, revision: doc.revision, serverId: doc.serverId };
      },
    },
    {
      name: 'focus_control', scope: 'write', input: focusControlInput,
      description: '暂停、继续、完成或结束一段专注。默认操作当前进行中的专注，也可用 sessionId 指定。',
      handler: (args, context) => {
        const initial = snapshot();
        const target = args.sessionId
          ? initial.doc.state.focusSessions.find((item) => item.id === args.sessionId)
          : activeSession(initial.doc.state);
        if (!target) throw new AgentError(409, 'no_active_focus', '现在没有进行中的专注。');
        const ended = target.status === 'completed' || target.status === 'cancelled';
        if (ended) {
          if ((target.status === 'cancelled' && args.action === 'cancel') || (target.status === 'completed' && args.action === 'complete')) {
            return { result: { session: describeSession(target, initial.now), alreadyEnded: true }, revision: initial.doc.revision, serverId: initial.doc.serverId };
          }
          throw new AgentError(409, 'focus_ended', '这段专注已经结束。');
        }
        try {
          const { doc } = commit('focus_control', context.requestId, (snap) => {
            const current = snap.doc.state.focusSessions.find((item) => item.id === target.id);
            if (!current) throw new AgentError(409, 'no_active_focus', '这段专注已经不存在。');
            if (current.status === 'completed' || current.status === 'cancelled') throw new AgentError(409, 'focus_ended', '这段专注已经结束。');
            return { kind: 'focus.control', id: current.id, action: args.action, owner: current.owner, epoch: current.epoch };
          });
          return { result: { session: describeSession(doc.state.focusSessions.find((item) => item.id === target.id), Date.now()) }, revision: doc.revision, serverId: doc.serverId };
        } catch (error) {
          if (String(error?.message).includes('尚未到达计划时长')) {
            const now = snapshot();
            const current = now.doc.state.focusSessions.find((item) => item.id === target.id);
            throw new AgentError(409, 'focus_not_finished', '还没到计划时长；可以暂停或结束本次。', current ? { session: describeSession(current, now.now) } : undefined);
          }
          throw error;
        }
      },
    },
    {
      name: 'focus_summary', scope: 'read', input: emptyInput,
      description: '查看今天和本周的专注分钟数、进行中的专注，以及最近10条专注记录。',
      handler: () => {
        const snap = snapshot();
        const minutes = focusMinutes(snap.doc.state, snap.today, snap.now);
        const week = getWeekRange(snap.today);
        const recent = snap.doc.state.focusSessions
          .filter((session) => session.status === 'completed' || session.status === 'cancelled')
          .sort((a, b) => b.startedAt - a.startedAt)
          .slice(0, 10)
          .map((session) => ({ ...describeSession(session, snap.now), focusedMinutes: Math.floor(focusedSeconds(session, snap.now) / 60) }));
        const active = activeSession(snap.doc.state);
        return {
          result: { date: snap.today, today: { date: snap.today, minutes: Math.floor(minutes.todaySeconds / 60) }, week: { from: week.start, to: week.end, minutes: Math.floor(minutes.weekSeconds / 60) }, active: active ? describeSession(active, snap.now) : null, recent },
          revision: snap.doc.revision, serverId: snap.doc.serverId,
        };
      },
    },
    {
      name: 'countdowns_list', scope: 'read', input: countdownsListInput,
      description: '查看未来一段时间内的考试、截止日、证件和生日倒计时；默认30天。',
      handler: (args) => {
        const snap = snapshot();
        const all = getCountdowns(snap.doc.state, snap.today, snap.calendars);
        const items = all.filter((item) => item.days >= 0 && item.days <= args.withinDays).slice(0, 100);
        const overdue = all.filter((item) => item.days < 0).slice(0, 10);
        return { result: { today: snap.today, withinDays: args.withinDays, items, overdue }, revision: snap.doc.revision, serverId: snap.doc.serverId };
      },
    },
    {
      name: 'countdowns_create', scope: 'write', input: countdownCreateInput,
      description: '添加一条证件或生日倒计时。删除和修改倒计时仍在网页里做。',
      handler: (args, context) => {
        const countdown = { id: derivedId('cd', context.requestId), title: args.title, kind: args.kind, date: args.date };
        const { doc } = commit('countdowns_create', context.requestId, () => ({ kind: 'put', collection: 'countdowns', value: countdownSchema.parse(countdown) }));
        return { result: { countdown: doc.state.countdowns.find((item) => item.id === countdown.id) }, revision: doc.revision, serverId: doc.serverId };
      },
    },
    {
      name: 'countdowns_update', scope: 'write', input: countdownUpdateInput,
      description: '修改倒计时的标题、类型或日期；删除倒计时仍在网页里做。',
      handler: (args, context) => {
        const { doc } = commit('countdowns_update', context.requestId, (snap) => {
          const current = snap.doc.state.countdowns.find((item) => item.id === args.id);
          if (!current) throw new AgentError(404, 'countdown_not_found', '这条倒计时不存在。');
          const next = { ...current };
          if (args.title !== undefined) next.title = args.title;
          if (args.kind !== undefined) next.kind = args.kind;
          if (args.date !== undefined) next.date = args.date;
          return { kind: 'put', collection: 'countdowns', value: countdownSchema.parse(next) };
        });
        return { result: { countdown: doc.state.countdowns.find((item) => item.id === args.id) }, revision: doc.revision, serverId: doc.serverId };
      },
    },
    {
      name: 'services_search', scope: 'read', input: servicesSearchInput,
      description: '搜索校园办事服务的标题、分类、材料和步骤，返回办理入口与已核验的出处；不会代提交或代签字。',
      handler: (args) => {
        const snap = snapshot();
        const query = args.query.toLowerCase();
        const items = snap.doc.state.serviceEntries
          .filter((service) => (!args.category || service.category === args.category) && (!query || [service.title, service.category, service.materials, service.steps].some((value) => value.toLowerCase().includes(query))))
          .slice(0, 20)
          .map((service) => ({
            id: service.id, title: service.title, category: service.category, entryType: service.entryType, entry: service.entry,
            materials: service.materials.slice(0, 800), hours: service.hours.slice(0, 200), steps: service.steps.slice(0, 1500),
            sourceUrl: service.sourceUrl, sourceUpdated: service.sourceUpdated, verifiedAt: service.verifiedAt, miniProgramQr: service.miniProgramQr,
          }));
        return { result: { query: args.query, category: args.category ?? null, items }, revision: snap.doc.revision, serverId: snap.doc.serverId };
      },
    },
    {
      name: 'ledger_summary', scope: 'read', input: ledgerSummaryInput,
      description: '查看账本摘要：收入、支出、净额、工时和支出分类。默认本周；示例数据不计入。金额单位为分。',
      handler: (args) => {
        const snap = ledgerSnap();
        const from = args.from ?? getWeekRange(snap.today).start;
        const to = args.to ?? getWeekRange(snap.today).end;
        bounded(from, to);
        const records = snap.records.filter((record) => record.source !== 'demo' && record.date >= from && record.date <= to);
        const total = summarize(records, from, to);
        const categories = new Map();
        for (const record of records) {
          if (record.type !== 'expense') continue;
          categories.set(record.category, (categories.get(record.category) ?? 0) + record.amountCents);
        }
        return {
          result: { from, to, ...total, expenseByCategory: [...categories].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents) },
          revision: snap.doc.revision, serverId: snap.doc.serverId,
        };
      },
    },
    {
      name: 'ledger_records', scope: 'read', input: ledgerRecordsInput,
      description: '按日期、类型或分类查看最近的收支记录明细；不含示例数据。金额单位为分。',
      handler: (args) => {
        const snap = ledgerSnap();
        const from = args.from ?? shiftDate(snap.today, -30);
        const to = args.to ?? snap.today;
        bounded(from, to);
        const matched = snap.records
          .filter((record) => record.source !== 'demo' && record.date >= from && record.date <= to)
          .filter((record) => !args.type || record.type === args.type)
          .filter((record) => !args.category || (record.type === 'expense' && record.category === args.category))
          .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
        const items = matched.slice(0, args.limit).map((record) => ({
          id: record.id, date: record.date, title: record.title, type: record.type, amountCents: record.amountCents,
          ...(record.type === 'expense' ? { category: record.category } : { durationMinutes: record.durationMinutes, workplaceId: record.workplaceId, workplaceName: snap.workplaces.find((unit) => unit.id === record.workplaceId)?.name ?? null }),
        }));
        return { result: { from, to, type: args.type ?? null, category: args.category ?? null, total: matched.length, items }, revision: snap.doc.revision, serverId: snap.doc.serverId };
      },
    },
    {
      name: 'ledger_monthly', scope: 'read', input: ledgerMonthlyInput,
      description: '查看某个月的收入、支出、净额、工时、支出分类和单位工时；月份格式 YYYY-MM。',
      handler: (args) => {
        const snap = ledgerSnap();
        const { start, end } = getMonthRange(args.month);
        const records = snap.records.filter((record) => record.source !== 'demo' && record.date >= start && record.date <= end);
        const total = summarize(records, start, end);
        const byCategory = new Map();
        const byWorkplace = new Map();
        for (const record of records) {
          if (record.type === 'expense') {
            byCategory.set(record.category, (byCategory.get(record.category) ?? 0) + record.amountCents);
          } else {
            const unit = byWorkplace.get(record.workplaceId) ?? { workplaceId: record.workplaceId, name: snap.workplaces.find((item) => item.id === record.workplaceId)?.name ?? record.workplaceId, amountCents: 0, workMinutes: 0 };
            unit.amountCents += record.amountCents;
            unit.workMinutes += record.durationMinutes;
            byWorkplace.set(record.workplaceId, unit);
          }
        }
        return {
          result: { month: args.month, from: start, to: end, ...total,
            byCategory: [...byCategory].map(([name, cents]) => ({ category: name, cents })).sort((a, b) => b.cents - a.cents),
            byWorkplace: [...byWorkplace.values()].sort((a, b) => b.amountCents - a.amountCents) },
          revision: snap.doc.revision, serverId: snap.doc.serverId,
        };
      },
    },
    {
      name: 'ledger_workplaces', scope: 'read', input: emptyInput,
      description: '查看兼职单位、时薪和说明。',
      handler: () => {
        const snap = ledgerSnap();
        return { result: { workplaces: snap.workplaces }, revision: snap.doc.revision, serverId: snap.doc.serverId };
      },
    },
    {
      name: 'workplaces_add', scope: 'write', input: workplaceAddInput,
      description: '新增兼职单位；时薪按元填写。',
      handler: (args, context) => {
        const id = derivedId('unit', context.requestId);
        const next = commitLedger((ledger) => {
          const existing = ledger.workplaces.find((unit) => unit.id === id);
          if (existing) {
            if (existing.name !== args.name || existing.hourlyRateCents !== toCents(args.hourlyRateYuan) || existing.description !== args.description) throw new AgentError(409, 'request_id_reused', '这个 Idempotency-Key 已经用于另一个不同操作。');
            return ledger;
          }
          if (ledger.workplaces.some((unit) => unit.name === args.name)) throw new AgentError(409, 'duplicate_workplace', '已有同名单位，请换一个名称。');
          const workplace = { ...buildWorkplace(args.name, rate(toCents(args.hourlyRateYuan)), id), description: args.description };
          return { ...ledger, workplaces: [...ledger.workplaces, workplace] };
        });
        return ledgerResult({ workplace: next.workplaces.find((unit) => unit.id === id) });
      },
    },
    {
      name: 'workplaces_update', scope: 'write', input: workplaceUpdateInput,
      description: '修改兼职单位的名称、时薪或说明；不会重算已经记下的工时。',
      handler: (args) => {
        const next = commitLedger((ledger) => {
          const current = ledger.workplaces.find((unit) => unit.id === args.id);
          if (!current) throw new AgentError(404, 'workplace_not_found', '这个单位不存在。');
          const name = args.name ?? current.name;
          if (ledger.workplaces.some((unit) => unit.id !== current.id && unit.name === name)) throw new AgentError(409, 'duplicate_workplace', '已有同名单位，请换一个名称。');
          const rateCents = args.hourlyRateYuan !== undefined ? toCents(args.hourlyRateYuan) : current.hourlyRateCents;
          const workplace = { ...buildWorkplace(name, rate(rateCents), current.id), description: args.description ?? current.description };
          return { ...ledger, workplaces: ledger.workplaces.map((unit) => unit.id === current.id ? workplace : unit) };
        });
        return ledgerResult({ workplace: next.workplaces.find((unit) => unit.id === args.id) });
      },
    },
    {
      name: 'ledger_add_expense', scope: 'write', input: expenseAddInput,
      description: '记一笔支出；金额按元填写，分类使用固定分类，日期默认今天。',
      handler: (args, context) => {
        const date = args.date ?? toDateKey(new Date());
        const id = derivedId('exp', context.requestId);
        const next = commitLedger((ledger) => {
          const desired = buildRecord({ type: 'expense', date, title: args.title, workplaceId: '', startTime: '', endTime: '', nextDay: false, duration: '', hourlyRate: '', amount: args.amountYuan.toFixed(2), category: args.category }, ledger.workplaces, id);
          const existing = ledger.records.find((record) => record.id === id);
          if (existing) {
            if (JSON.stringify(existing) !== JSON.stringify(desired)) throw new AgentError(409, 'request_id_reused', '这个 Idempotency-Key 已经用于另一个不同操作。');
            return ledger;
          }
          return { ...ledger, records: [...ledger.records.filter((record) => record.source !== 'demo'), desired] };
        });
        return ledgerResult({ record: next.records.find((record) => record.id === id) });
      },
    },
    {
      name: 'ledger_update_expense', scope: 'write', input: expenseUpdateInput,
      description: '修改一笔支出的金额、分类、日期或备注；示例记录不能改。',
      handler: (args) => {
        const next = commitLedger((ledger) => {
          const current = ledger.records.find((record) => record.id === args.id);
          if (!current) throw new AgentError(404, 'record_not_found', '这笔记录不存在。');
          if (current.type !== 'expense') throw new AgentError(400, 'not_editable', '这笔记录不是支出。');
          if (current.source === 'demo') throw new AgentError(400, 'not_editable', '示例记录不能修改。');
          const desired = buildRecord({
            type: 'expense', date: args.date ?? current.date, title: args.title ?? current.title, workplaceId: '', startTime: '', endTime: '', nextDay: false, duration: '', hourlyRate: '',
            amount: args.amountYuan !== undefined ? args.amountYuan.toFixed(2) : (current.amountCents / 100).toFixed(2), category: args.category ?? current.category,
          }, ledger.workplaces, current.id);
          return { ...ledger, records: [...ledger.records.filter((record) => record.source !== 'demo' && record.id !== current.id), desired] };
        });
        return ledgerResult({ record: next.records.find((record) => record.id === args.id) });
      },
    },
    {
      name: 'ledger_add_work', scope: 'write', input: workAddInput,
      description: '记一笔工时；时薪默认取单位时薪，跨午夜会自动按次日计算，也可单独指定计薪时长。',
      handler: (args, context) => {
        const id = derivedId('work', context.requestId);
        const next = commitLedger((ledger) => {
          const workplace = ledger.workplaces.find((unit) => unit.id === args.workplaceId);
          if (!workplace) throw new AgentError(404, 'workplace_not_found', '这个兼职单位不存在，请先添加单位。');
          const nextDay = args.nextDay ?? args.endTime <= args.startTime;
          const rateCents = args.hourlyRateYuan !== undefined ? toCents(args.hourlyRateYuan) : workplace.hourlyRateCents;
          const desired = buildRecord({
            type: 'work', date: args.date, title: args.title, workplaceId: workplace.id, startTime: args.startTime, endTime: args.endTime,
            nextDay, duration: args.durationMinutes !== undefined ? String(args.durationMinutes) : '', hourlyRate: rate(rateCents), amount: '', category: '吃饭',
          }, ledger.workplaces, id);
          const existing = ledger.records.find((record) => record.id === id);
          if (existing) {
            if (JSON.stringify(existing) !== JSON.stringify(desired)) throw new AgentError(409, 'request_id_reused', '这个 Idempotency-Key 已经用于另一个不同操作。');
            return ledger;
          }
          return { ...ledger,
            records: [...ledger.records.filter((record) => record.source !== 'demo'), desired],
            workplaces: ledger.workplaces.map((unit) => unit.id === workplace.id ? { ...unit, source: 'manual' } : unit) };
        });
        return ledgerResult({ record: next.records.find((record) => record.id === id) });
      },
    },
    {
      name: 'ledger_update_work', scope: 'write', input: workUpdateInput,
      description: '修改一笔工时；改了时间会重新计时，改了单位会默认使用新单位时薪，示例记录不能改。',
      handler: (args) => {
        const next = commitLedger((ledger) => {
          const current = ledger.records.find((record) => record.id === args.id);
          if (!current) throw new AgentError(404, 'record_not_found', '这笔记录不存在。');
          if (current.type !== 'work') throw new AgentError(400, 'not_editable', '这笔记录不是工时。');
          if (current.source === 'demo') throw new AgentError(400, 'not_editable', '示例记录不能修改。');
          const workplaceId = args.workplaceId ?? current.workplaceId;
          const workplace = ledger.workplaces.find((unit) => unit.id === workplaceId);
          if (!workplace) throw new AgentError(404, 'workplace_not_found', '这个兼职单位不存在。');
          const startTime = args.startTime ?? current.startTime;
          const endTime = args.endTime ?? current.endTime;
          const timesChanged = args.startTime !== undefined || args.endTime !== undefined || args.nextDay !== undefined;
          const nextDay = args.nextDay ?? (timesChanged ? endTime <= startTime : current.endTime <= current.startTime);
          const rateCents = args.hourlyRateYuan !== undefined
            ? toCents(args.hourlyRateYuan)
            : (args.workplaceId !== undefined && args.workplaceId !== current.workplaceId ? workplace.hourlyRateCents : current.hourlyRateCents);
          const desired = buildRecord({
            type: 'work', date: args.date ?? current.date, title: args.title ?? current.title, workplaceId, startTime, endTime,
            nextDay, duration: args.durationMinutes !== undefined ? String(args.durationMinutes) : (timesChanged ? '' : String(current.durationMinutes)),
            hourlyRate: rate(rateCents), amount: '', category: '吃饭',
          }, ledger.workplaces, current.id);
          return { ...ledger,
            records: ledger.records.map((record) => record.id === current.id ? desired : record),
            workplaces: ledger.workplaces.map((unit) => unit.id === workplace.id ? { ...unit, source: 'manual' } : unit) };
        });
        return ledgerResult({ record: next.records.find((record) => record.id === args.id) });
      },
    },
    {
      name: 'trips_list', scope: 'read', input: emptyInput,
      description: '查看旅记列表：日期、天数、攻略条数、打包进度和城市记录数。',
      handler: () => {
        const snap = snapshot();
        const trips = snap.doc.state.trips.map((trip) => ({
          id: trip.id, title: trip.title, startDate: trip.startDate, endDate: trip.endDate, notes: trip.notes.slice(0, 500),
          days: trip.days.length, dayItems: trip.days.reduce((sum, day) => sum + day.items.length, 0),
          packing: { total: trip.packing.length, checked: trip.packing.filter((item) => item.checked).length }, visits: trip.visits.length,
        }));
        return { result: { trips }, revision: snap.doc.revision, serverId: snap.doc.serverId };
      },
    },
    {
      name: 'trips_get', scope: 'read', input: tripIdInput,
      description: '查看一趟旅行的完整攻略、打包清单和城市记录。',
      handler: (args) => {
        const snap = snapshot();
        return { result: { trip: tripOrThrow(snap.doc.state, args.id) }, revision: snap.doc.revision, serverId: snap.doc.serverId };
      },
    },
    {
      name: 'trips_create', scope: 'write', input: tripCreateInput,
      description: '新建一趟旅行，日期范围内每天会自动生成空白攻略分组。',
      handler: (args, context) => {
        const id = derivedId('trip', context.requestId);
        const { doc } = commit('trips_create', context.requestId, () => {
          const trip = newTrip(id, args.title, args.startDate, args.endDate);
          return { kind: 'put', collection: 'trips', value: tripSchema.parse({ ...trip, notes: args.notes }) };
        });
        return { result: { trip: tripOrThrow(doc.state, id) }, revision: doc.revision, serverId: doc.serverId };
      },
    },
    {
      name: 'trips_update', scope: 'write', input: tripUpdateInput,
      description: '修改旅行的标题、日期或备注；缩短日期时如果范围外还有攻略或城市记录，会拒绝并提示先处理。',
      handler: (args, context) => {
        const { doc } = commit('trips_update', context.requestId, (snap) => {
          let trip = tripOrThrow(snap.doc.state, args.id);
          const startDate = args.startDate ?? trip.startDate;
          const endDate = args.endDate ?? trip.endDate;
          if (startDate !== trip.startDate || endDate !== trip.endDate) {
            try { trip = changeTripDates(trip, startDate, endDate); }
            catch (error) { throw new AgentError(400, 'trip_dates_conflict', error instanceof Error ? error.message : '旅行日期调整失败。'); }
          }
          const next = { ...trip };
          if (args.title !== undefined) next.title = args.title;
          if (args.notes !== undefined) next.notes = args.notes;
          return { kind: 'put', collection: 'trips', value: tripSchema.parse(next) };
        });
        return { result: { trip: tripOrThrow(doc.state, args.id) }, revision: doc.revision, serverId: doc.serverId };
      },
    },
    {
      name: 'trips_add_day_item', scope: 'write', input: tripDayItemInput,
      description: '在旅行某一天的攻略里加一条内容。',
      handler: (args, context) => {
        const item = { id: derivedId('tripday', context.requestId), text: args.text };
        const { doc } = commit('trips_add_day_item', context.requestId, (snap) => {
          const trip = tripOrThrow(snap.doc.state, args.tripId);
          if (args.date < trip.startDate || args.date > trip.endDate) throw new AgentError(400, 'date_out_of_range', '这一天不在旅行范围内。');
          const next = structuredClone(trip);
          const day = next.days.find((entry) => entry.date === args.date);
          if (day) {
            if (!day.items.some((entry) => entry.id === item.id)) day.items.push(item);
          } else {
            next.days.push({ date: args.date, items: [item] });
          }
          return { kind: 'put', collection: 'trips', value: tripSchema.parse(next) };
        });
        return { result: { item }, revision: doc.revision, serverId: doc.serverId };
      },
    },
    {
      name: 'trips_add_packing', scope: 'write', input: tripPackingAddInput,
      description: '往旅行打包清单里加一项（默认未勾选）。',
      handler: (args, context) => {
        const item = { id: derivedId('trippack', context.requestId), text: args.text, checked: false };
        const { doc } = commit('trips_add_packing', context.requestId, (snap) => {
          const trip = tripOrThrow(snap.doc.state, args.tripId);
          const next = structuredClone(trip);
          if (!next.packing.some((entry) => entry.id === item.id)) next.packing.push(item);
          return { kind: 'put', collection: 'trips', value: tripSchema.parse(next) };
        });
        return { result: { item }, revision: doc.revision, serverId: doc.serverId };
      },
    },
    {
      name: 'trips_set_packing', scope: 'write', input: tripPackingSetInput,
      description: '勾选或取消勾选旅行打包清单里的一项。',
      handler: (args, context) => {
        const { doc } = commit('trips_set_packing', context.requestId, (snap) => {
          const trip = tripOrThrow(snap.doc.state, args.tripId);
          const next = structuredClone(trip);
          const item = next.packing.find((entry) => entry.id === args.itemId);
          if (!item) throw new AgentError(404, 'packing_not_found', '打包清单里没有这一项。');
          item.checked = args.checked;
          return { kind: 'put', collection: 'trips', value: tripSchema.parse(next) };
        });
        return { result: { item: tripOrThrow(doc.state, args.tripId).packing.find((entry) => entry.id === args.itemId) }, revision: doc.revision, serverId: doc.serverId };
      },
    },
    {
      name: 'trips_add_visit', scope: 'write', input: tripVisitAddInput,
      description: '给旅行添加一个内置城市足迹；城市必须是杭州、上海、北京、南京、苏州、成都、广州或西安之一。',
      handler: (args, context) => {
        const city = cities.find((item) => item.name === args.city || item.id === args.city);
        if (!city) throw new AgentError(404, 'unknown_city', '不支持这个城市，请使用内置城市列表。', { cities: cities.map((item) => item.name) });
        const visit = {
          id: derivedId('tripvisit', context.requestId), cityId: city.id, city: city.name, date: args.date ?? '',
          latitude: city.latitude, longitude: city.longitude, visited: args.visited,
        };
        const { doc } = commit('trips_add_visit', context.requestId, (snap) => {
          const trip = tripOrThrow(snap.doc.state, args.tripId);
          const date = visit.date || trip.startDate;
          if (date < trip.startDate || date > trip.endDate) throw new AgentError(400, 'date_out_of_range', '这一天不在旅行范围内。');
          const next = structuredClone(trip);
          if (!next.visits.some((entry) => entry.id === visit.id)) next.visits.push({ ...visit, date });
          return { kind: 'put', collection: 'trips', value: tripSchema.parse(next) };
        });
        return { result: { visit: tripOrThrow(doc.state, args.tripId).visits.find((entry) => entry.id === visit.id) }, revision: doc.revision, serverId: doc.serverId };
      },
    },
    {
      name: 'campus_status', scope: 'read', input: emptyInput,
      description: '查看杭电助手是否已连接、个人只读数据是否开启、本次会话何时过期。',
      handler: () => {
        const snap = snapshot();
        return { result: envelopeResult(campusApi().state()), revision: snap.doc.revision, serverId: snap.doc.serverId };
      },    },
    {
      name: 'campus_calendar', scope: 'read', input: emptyInput,
      description: '查看学校校历：学年、学期、开学/结课日期、当前教学周和总周数。',
      handler: async () => {
        const snap = snapshot();
        try {
          const value = await campusApi().read('calendar');
          return { result: envelopeResult(value), revision: snap.doc.revision, serverId: snap.doc.serverId };
        } catch (error) { campusFailure(error); }
      },
    },
    {
      name: 'campus_notices', scope: 'read', input: campusNoticesInput,
      description: '搜索校园公开通知，返回标题、来源、发布时间和原文链接；默认第一页20条。',
      handler: async (args) => {
        const snap = snapshot();
        try {
          const value = await campusApi().read('notices', { q: args.q, source_key: args.sourceKey, page: args.page, page_size: args.pageSize });
          return { result: envelopeResult(value), revision: snap.doc.revision, serverId: snap.doc.serverId };
        } catch (error) { campusFailure(error); }
      },
    },
    {
      name: 'campus_courses', scope: 'read', input: emptyInput,
      description: '查看本学期课表（个人只读数据；需要先在网页开启个人数据）。',
      handler: async () => {
        const snap = snapshot();
        try {
          const value = await campusApi().read('courses');
          return { result: envelopeResult(value), revision: snap.doc.revision, serverId: snap.doc.serverId };
        } catch (error) { campusFailure(error); }
      },
    },
    {
      name: 'campus_exams', scope: 'read', input: emptyInput,
      description: '查看本学期考试安排（个人只读数据；需要先在网页开启个人数据）。',
      handler: async () => {
        const snap = snapshot();
        try {
          const value = await campusApi().read('exams');
          return { result: envelopeResult(value), revision: snap.doc.revision, serverId: snap.doc.serverId };
        } catch (error) { campusFailure(error); }
      },
    },
    {
      name: 'campus_life', scope: 'read', input: emptyInput,
      description: '查看饭卡余额与最近流水、电费余额、图书馆借阅和预约。三类数据各自返回成功或错误，互不拖垮。',
      handler: async () => {
        const snap = snapshot();
        try {
          const result = await campusApi().readLife();
          return { result, revision: snap.doc.revision, serverId: snap.doc.serverId };
        } catch (error) { campusFailure(error); }
      },
    },
    {
      name: 'campus_sync_courses', scope: 'write', input: emptyInput,
      description: '把本学期课表同步成日程里的课程规则，只新增或更新杭电助手来源的条目，不删除任何条目。',
      handler: async (args, context) => {
        const api = campusApi();
        let calendar; let bodies;
        try {
          calendar = (await api.read('calendar')).data;
          bodies = (await api.read('courses')).data;
        } catch (error) { campusFailure(error); }
        if (!calendar?.startDate) throw new AgentError(400, 'campus_calendar_missing', '校历缺少开学日期，暂时不能生成课程规则。');
        const built = buildCampusRules(bodies?.courses ?? [], calendar, 'Asia/Shanghai');
        const first = snapshot();
        const preview = previewCampus(first.doc.state.courseRules, first.doc.state.events, built.rules, []);
        const writes = [...preview.courses.create, ...preview.courses.update];
        let doc = first.doc;
        writes.forEach((value, index) => { doc = commit('campus_sync_courses', `${context.requestId}:${index}`, () => ({ kind: 'put', collection: 'courseRules', value })).doc; });
        return {
          result: { written: writes.length, unchanged: preview.courses.unchanged.length, removed: preview.courses.removed.map((rule) => rule.id), warnings: built.warnings },
          revision: doc.revision, serverId: doc.serverId,
        };
      },
    },
    {
      name: 'campus_sync_exams', scope: 'write', input: emptyInput,
      description: '把本学期考试同步成日程事件，只新增或更新杭电助手来源的条目，不删除任何条目。',
      handler: async (args, context) => {
        let bodies;
        try { bodies = (await campusApi().read('exams')).data; } catch (error) { campusFailure(error); }
        const built = buildCampusExamEvents(bodies?.exams ?? [], 'Asia/Shanghai');
        const first = snapshot();
        const preview = previewCampus(first.doc.state.courseRules, first.doc.state.events, [], built.events);
        const writes = [...preview.events.create, ...preview.events.update];
        let doc = first.doc;
        writes.forEach((value, index) => { doc = commit('campus_sync_exams', `${context.requestId}:${index}`, () => ({ kind: 'put', collection: 'events', value })).doc; });
        return {
          result: { written: writes.length, unchanged: preview.events.unchanged.length, removed: preview.events.removed.map((event) => event.id), warnings: built.warnings },
          revision: doc.revision, serverId: doc.serverId,
        };
      },
    },
  ];

  function mcpGateway() {
    return typeof mcp === 'function' ? mcp() : null;
  }

  function mcpInput() {
    return z.looseObject({
      confirmed: z.boolean().optional(),
      requestId: z.string().max(MAX_IDEMPOTENCY).optional(),
    });
  }

  function mcpToolView(tool) {
    const riskLabel = tool.risk === 'order' ? '（会产生订单，必须先让用户确认）' : tool.risk === 'pay' ? '（支付类，不执行，只把支付信息交给用户）' : '';
    return {
      name: tool.name,
      scope: tool.risk === 'read' ? 'read' : 'write',
      description: `[生活服务] ${tool.description || tool.name}${riskLabel}`,
      input: mcpInput(),
      mcp: true,
      risk: tool.risk,
    };
  }

  async function listMcpTools() {
    const gateway = mcpGateway();
    if (!gateway) return { tools: [], errors: [], skipped: [], omittedTools: 0 };
    try {
      return await gateway.listTools({});
    } catch (error) {
      return { tools: [], errors: [{ name: '', code: 'mcp_unavailable', message: error?.message ?? '生活服务没有启动。' }], skipped: [], omittedTools: 0 };
    }
  }

  async function callMcpTool(toolName, args, { requestId, scope }) {
    const gateway = mcpGateway();
    if (!gateway) throw new AgentError(404, 'unknown_tool', '没有这个工具，请先读取 manifest。');
    const listing = await listMcpTools();
    const meta = listing.tools.find((item) => item.name === toolName);
    if (!meta) {
      const skipped = listing.skipped.find((item) => item.name === toolName);
      const failure = listing.errors.find((item) => item.name === toolName) ?? listing.errors[0];
      const message = skipped?.message ?? failure?.message ?? '这个生活服务还没有配置或当前不可用。';
      const code = skipped?.reason ?? failure?.code ?? 'mcp_not_configured';
      throw new AgentError(503, code, message);
    }
    if (meta.risk !== 'read' && scope !== 'write') {
      throw new AgentError(403, 'scope_read_only', '这个令牌是只读的，不能触发下单或支付类操作。');
    }
    const parsed = args && typeof args === 'object' ? args : {};
    const result = await gateway.callTool(toolName, parsed, {
      requestId: parsed.requestId || requestId,
      confirmed: parsed.confirmed === true,
    });
    return { result, revision: null, serverId: null };
  }

  async function manifest(caller) {
    const snap = snapshot();
    const listing = await listMcpTools();
    const builtin = tools.map(({ handler, input, ...tool }) => ({ ...tool, input: json(input) }));
    const external = listing.tools.map((tool) => ({ ...mcpToolView(tool), input: tool.inputSchema ?? { type: 'object', properties: {} } }));
    return {
      api: 'shunshou-agent', version: 1, serverId: snap.doc.serverId, revision: snap.doc.revision, timeZone,
      caller,
      idempotency: { header: 'Idempotency-Key', requiredFor: 'write', minLength: 8, maxLength: MAX_IDEMPOTENCY },
      limits: { maxRangeDays: MAX_RANGE_DAYS },
      tools: [...builtin, ...external],
      mcp: {
        omittedTools: listing.omittedTools ?? 0,
        errors: listing.errors ?? [],
        skipped: listing.skipped ?? [],
      },
    };
  }

  async function call({ tool, arguments: args, requestId = '', scope = 'read', actor = 'web', caller }) {
    const found = tools.find((item) => item.name === tool);
    if (!found) return callMcpTool(tool, args, { requestId, scope });
    if (found.scope === 'write' && scope !== 'write') throw new AgentError(403, 'scope_read_only', '这个令牌是只读的，不能修改内容。');
    if (found.scope === 'write') {
      const key = String(requestId).trim();
      if (key.length < 8 || key.length > MAX_IDEMPOTENCY) throw new AgentError(400, 'missing_idempotency_key', '写操作需要 Idempotency-Key 请求头（8-100个字符）。');
      requestId = key;
    }
    const parsed = found.input.parse(args ?? {});
    try {
      return await found.handler(parsed, { requestId, actor, caller });
    } catch (error) {
      if (error instanceof AgentError) throw error;
      if (error?.name === 'ZodError') throw new AgentError(400, 'invalid_arguments', '参数格式不正确。', { issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
      if (error?.message === 'operation_reused') throw new AgentError(409, 'request_id_reused', '这个 Idempotency-Key 已经用于另一个不同操作，请换一个。');
      if (error?.message === 'conflict') throw new AgentError(409, 'conflict', '数据正在被另一处修改，请重试。');
      if (String(error?.message).includes('已有进行中的专注')) throw new AgentError(409, 'focus_active', error.message);
      if (typeof error?.code === 'string') throw new AgentError(503, 'storage_unavailable', '电脑上的数据暂时不可用，请检查存储文件。');
      throw new AgentError(400, 'tool_rejected', error instanceof Error ? error.message : '操作未完成。');
    }
  }

  return { manifest, call };
}
