import type { PlannerState } from './planner.ts';
import type { RecordEntry } from './records.ts';
import { expenseCategories } from './records.ts';
import { buildTimeline, scheduleWarnings, type CalendarSource } from './schedule.ts';
import { getCountdowns } from './countdowns.ts';
import { focusedSeconds, focusedSecondsBetween, remainingSeconds, type FocusSession } from './focus.ts';
import { summarize } from './summary.ts';
import { getWeekRange, shiftDate } from './dates.ts';

export type DayBrief = {
  date: string;
  items: { title: string; start: number; end: number; kind: string; location: string; source: string }[];
  next: { title: string; start: number; kind: string } | null;
  countdowns: { title: string; date: string; days: number; kind: string }[];
  expenseCents: number;
  workMinutes: number;
  focusMinutes: number;
  activeFocus: { task: string; remainingMinutes: number } | null;
  warnings: string[];
};

const dayBounds = (date: string) => ({
  start: new Date(`${date}T00:00:00`).getTime(),
  end: new Date(`${shiftDate(date, 1)}T00:00:00`).getTime(),
});

function realRecords(records: readonly RecordEntry[]): readonly RecordEntry[] {
  return records.filter((item) => item.source !== 'demo');
}

function active(state: PlannerState): FocusSession | null {
  return state.focusSessions.find((session) => session.status === 'running' || session.status === 'paused') ?? null;
}

export function buildDayBrief(
  state: PlannerState, records: readonly RecordEntry[], calendars: CalendarSource[], today: string, now = Date.now(),
): DayBrief {
  const timeline = buildTimeline(state, realRecords(records), calendars, today, today, now);
  const bounds = dayBounds(today);
  const summary = summarize(realRecords(records), today, today);
  const running = active(state);
  return {
    date: today,
    items: timeline.slice(0, 12).map((item) => ({
      title: item.title, start: item.start, end: item.end, kind: item.kind, location: item.location, source: item.sourceLabel,
    })),
    next: timeline.find((item) => item.start >= now) ?? null,
    countdowns: getCountdowns(state, today, calendars)
      .filter((item) => item.days >= 0 && item.days <= 7)
      .slice(0, 3)
      .map((item) => ({ title: item.title, date: item.date, days: item.days, kind: item.kind })),
    expenseCents: summary.expenseCents,
    workMinutes: summary.workMinutes,
    focusMinutes: Math.floor(focusedSecondsBetween(
      state.focusSessions.filter((session) => session.status !== 'cancelled'), bounds.start, bounds.end, now,
    ) / 60),
    activeFocus: running ? { task: running.task, remainingMinutes: Math.ceil(remainingSeconds(running, now) / 60) } : null,
    warnings: scheduleWarnings(timeline).map((warning) => warning.text),
  };
}

export type WeekReview = {
  start: string;
  end: string;
  thisWeek: { expenseCents: number; incomeCents: number; netCents: number; workMinutes: number; focusMinutes: number; focusSessions: number };
  lastWeek: { expenseCents: number; incomeCents: number; netCents: number; workMinutes: number; focusMinutes: number; focusSessions: number };
  categories: { category: string; cents: number; share: number }[];
  focusByDay: { date: string; minutes: number }[];
  countdowns: { title: string; date: string; days: number }[];
  warnings: string[];
  topExpense: { title: string; amountCents: number; date: string } | null;
};

function weekBucket(state: PlannerState, records: readonly RecordEntry[], start: string, end: string, now: number) {
  const summary = summarize(records, start, end);
  const bounds = { start: new Date(`${start}T00:00:00`).getTime(), end: new Date(`${shiftDate(end, 1)}T00:00:00`).getTime() };
  const sessions = state.focusSessions.filter((session) => session.status !== 'cancelled');
  return {
    expenseCents: summary.expenseCents, incomeCents: summary.incomeCents, netCents: summary.netCents, workMinutes: summary.workMinutes,
    focusMinutes: Math.floor(focusedSecondsBetween(sessions, bounds.start, bounds.end, now) / 60),
    focusSessions: sessions.filter((session) => session.startedAt >= bounds.start && session.startedAt < bounds.end).length,
  };
}

export function buildWeekReview(
  state: PlannerState, records: readonly RecordEntry[], calendars: CalendarSource[], anchor: string, now = Date.now(),
): WeekReview {
  const real = realRecords(records);
  const { start, end } = getWeekRange(anchor);
  const previous = getWeekRange(shiftDate(start, -7));
  const timeline = buildTimeline(state, real, calendars, start, end, now);
  const spend = real.filter((item) => item.type === 'expense' && item.date >= start && item.date <= end);
  const total = spend.reduce((sum, item) => sum + item.amountCents, 0);
  const byCategory = expenseCategories
    .map((category) => {
      const cents = spend.filter((item) => item.type === 'expense' && item.category === category).reduce((sum, item) => sum + item.amountCents, 0);
      return { category, cents, share: total ? Math.round((cents / total) * 100) : 0 };
    })
    .filter((item) => item.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  const top = [...spend].sort((a, b) => b.amountCents - a.amountCents)[0];
  const sessions = state.focusSessions.filter((session) => session.status !== 'cancelled');
  return {
    start, end,
    thisWeek: weekBucket(state, real, start, end, now),
    lastWeek: weekBucket(state, real, previous.start, previous.end, now),
    categories: byCategory,
    focusByDay: Array.from({ length: 7 }, (_, index) => {
      const date = shiftDate(start, index);
      const bounds = dayBounds(date);
      return { date, minutes: Math.floor(focusedSecondsBetween(sessions, bounds.start, bounds.end, now) / 60) };
    }),
    countdowns: getCountdowns(state, anchor, calendars).filter((item) => item.days >= 0 && item.days <= 7).slice(0, 5).map((item) => ({ title: item.title, date: item.date, days: item.days })),
    warnings: [...new Set(scheduleWarnings(timeline).map((warning) => warning.text))],
    topExpense: top ? { title: top.title, amountCents: top.amountCents, date: top.date } : null,
  };
}

export type LedgerInsights = {
  range: { from: string; to: string; days: number };
  expenseCents: number;
  incomeCents: number;
  netCents: number;
  dailyAverageExpenseCents: number;
  categories: { category: string; cents: number; share: number }[];
  previousExpenseCents: number;
  deltaPct: number | null;
  topExpenses: { title: string; amountCents: number; date: string; category: string }[];
  anomalies: { title: string; amountCents: number; date: string; reason: string }[];
};

export function buildLedgerInsights(records: readonly RecordEntry[], today: string, days = 30): LedgerInsights {
  const span = Math.min(90, Math.max(7, Math.round(days)));
  const from = shiftDate(today, -(span - 1));
  const previousFrom = shiftDate(from, -span);
  const previousTo = shiftDate(from, -1);
  const real = realRecords(records);
  const window = real.filter((item) => item.date >= from && item.date <= today);
  const previous = real.filter((item) => item.date >= previousFrom && item.date <= previousTo);
  const summary = summarize(window, from, today);
  const expenseCents = summary.expenseCents;
  const dailyAverage = Math.floor(expenseCents / span);
  const expenses = window.filter((item): item is Extract<RecordEntry, { type: 'expense' }> => item.type === 'expense');
  const categories = expenseCategories
    .map((category) => {
      const cents = expenses.filter((item) => item.category === category).reduce((sum, item) => sum + item.amountCents, 0);
      return { category, cents, share: expenseCents ? Math.round((cents / expenseCents) * 100) : 0 };
    })
    .filter((item) => item.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  const previousExpenseCents = summarize(previous, previousFrom, previousTo).expenseCents;
  const sorted = [...expenses].sort((a, b) => b.amountCents - a.amountCents);
  const threshold = Math.max(dailyAverage * 3, 5000);
  return {
    range: { from, to: today, days: span },
    expenseCents, incomeCents: summary.incomeCents, netCents: summary.netCents,
    dailyAverageExpenseCents: dailyAverage,
    categories,
    previousExpenseCents,
    deltaPct: previousExpenseCents ? Math.round(((expenseCents - previousExpenseCents) / previousExpenseCents) * 100) : null,
    topExpenses: sorted.slice(0, 3).map((item) => ({ title: item.title, amountCents: item.amountCents, date: item.date, category: item.category })),
    anomalies: sorted.filter((item) => item.amountCents >= threshold).slice(0, 3).map((item) => ({
      title: item.title, amountCents: item.amountCents, date: item.date,
      reason: `单笔 ¥${(item.amountCents / 100).toFixed(2)}，超过日均的 3 倍`,
    })),
  };
}

export type FocusInsights = {
  days: number;
  totalMinutes: number;
  sessions: number;
  completedSessions: number;
  daily: { date: string; minutes: number }[];
  averagePerActiveDayMinutes: number;
  streakDays: number;
  bestDay: { date: string; minutes: number } | null;
  bySlot: { slot: '上午' | '下午' | '晚上' | '深夜'; minutes: number; share: number }[];
  topTasks: { task: string; minutes: number }[];
};

const slotOf = (hour: number): FocusInsights['bySlot'][number]['slot'] =>
  hour >= 5 && hour < 12 ? '上午' : hour >= 12 && hour < 18 ? '下午' : hour >= 18 && hour < 23 ? '晚上' : '深夜';

export function buildFocusInsights(state: PlannerState, today: string, days = 30, now = Date.now()): FocusInsights {
  const span = Math.min(90, Math.max(7, Math.round(days)));
  const from = shiftDate(today, -(span - 1));
  const sessions = state.focusSessions.filter((item) => item.status !== 'cancelled');
  const daily = Array.from({ length: span }, (_, index) => {
    const date = shiftDate(from, index);
    const bounds = dayBounds(date);
    return { date, minutes: Math.floor(focusedSecondsBetween(sessions, bounds.start, bounds.end, now) / 60) };
  });
  const windowStart = new Date(`${from}T00:00:00`).getTime();
  const windowSessions = sessions.filter((item) => item.startedAt >= windowStart);
  const totalMinutes = daily.reduce((sum, day) => sum + day.minutes, 0);
  const activeDays = daily.filter((day) => day.minutes > 0);
  let streak = 0;
  for (let index = daily.length - 1; index >= 0; index--) {
    if (daily[index].minutes <= 0) break;
    streak += 1;
  }
  const slots = new Map<string, number>();
  const tasks = new Map<string, number>();
  for (const item of windowSessions) {
    const minutes = Math.floor(focusedSeconds(item, now) / 60);
    if (minutes <= 0) continue;
    const slot = slotOf(new Date(item.segments[0].start).getHours());
    slots.set(slot, (slots.get(slot) ?? 0) + minutes);
    tasks.set(item.task, (tasks.get(item.task) ?? 0) + minutes);
  }
  const best = [...daily].sort((a, b) => b.minutes - a.minutes)[0];
  return {
    days: span,
    totalMinutes,
    sessions: windowSessions.length,
    completedSessions: windowSessions.filter((item) => item.status === 'completed').length,
    daily,
    averagePerActiveDayMinutes: activeDays.length ? Math.round(totalMinutes / activeDays.length) : 0,
    streakDays: streak,
    bestDay: best && best.minutes > 0 ? best : null,
    bySlot: (['上午', '下午', '晚上', '深夜'] as const).map((slot) => {
      const minutes = slots.get(slot) ?? 0;
      return { slot, minutes, share: totalMinutes ? Math.round((minutes / totalMinutes) * 100) : 0 };
    }),
    topTasks: [...tasks.entries()].map(([task, minutes]) => ({ task, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, 3),
  };
}

const yuan = (cents: number) => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clock = (stamp: number) => new Date(stamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const sentence = (text: string) => (text.endsWith('。') ? text : `${text}。`);

export function dayBriefNarrative(facts: DayBrief): string {
  const lines: string[] = [];
  if (!facts.items.length) lines.push('今天还没有安排，可以先歇一会儿。');
  else {
    const next = facts.next
      ? `下一项是${facts.next.title}（${clock(facts.next.start)}）`
      : `今天最后一项已经结束`;
    lines.push(`今天 ${facts.items.length} 件事，${next}。`);
  }
  const spend = facts.expenseCents ? `今天支出 ¥${yuan(facts.expenseCents)}` : '今天还没有支出';
  const focus = facts.focusMinutes ? `，专注 ${facts.focusMinutes} 分钟。` : '，还没开始专注。';
  lines.push(`${spend}${focus}`);
  if (facts.countdowns.length) {
    const nearest = facts.countdowns[0];
    lines.push(`最近 ${nearest.days} 天是${nearest.title}，别忘了。`);
  }
  if (facts.warnings.length) lines.push(sentence(facts.warnings[0]));
  return lines.join('');
}

export function weekReviewNarrative(facts: WeekReview): string {
  const lines: string[] = [];
  lines.push(`本周支出 ¥${yuan(facts.thisWeek.expenseCents)}，上周 ¥${yuan(facts.lastWeek.expenseCents)}。`);
  if (facts.categories.length) {
    const top = facts.categories[0];
    lines.push(`花得最多的是${top.category}，占 ${top.share}%。`);
  }
  if (facts.thisWeek.focusMinutes) lines.push(`本周专注 ${facts.thisWeek.focusMinutes} 分钟，共 ${facts.thisWeek.focusSessions} 段。`);
  else lines.push('本周还没有专注记录。');
  if (facts.countdowns.length) lines.push(`未来一周最要紧的是${facts.countdowns[0].title}，还有 ${facts.countdowns[0].days} 天。`);
  return lines.join('');
}
